// Juega con el teclado sobre lo que ya hay en OPFS (hace falta haber extraído antes, p. ej. con
// test-flow.mjs y el mismo PROFILE) y va dejando capturas y el nivel del sonido.
// Uso: node play.mjs BASE_URL DIR_SALIDA GUION
//   GUION: pasos separados por comas:
//     wait:REGEX[:s]  espera a que salga REGEX en la consola (timeout en s, 600 por defecto)
//     key:TECLA[:ms]  mantiene pulsada la tecla (1500 ms por defecto; el juego lee el teclado
//                     una vez por fotograma)
//     sleep:s         espera
//     shot:NOMBRE     captura en DIR_SALIDA/NOMBRE.png
//     audio           nivel del sonido (RMS) que sale del AudioWorklet
// PROFILE=dir (obligatorio, el de la extracción), CHANNEL=chrome, PLAYWRIGHT=ruta de playwright.
import { pathToFileURL } from "node:url";
import { mkdirSync, appendFileSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : "playwright");
const { chromium } = pw.chromium ? pw : pw.default;
const [base, out, script] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(process.env.PROFILE, {
  ...(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {}),
  viewport: { width: 1280, height: 720 },
  // sin esto el AudioContext no arranca sin un gesto "real"
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await context.newPage();
const lines = [];
let waiter = null;
page.on("console", (m) => {
  const text = m.text();
  appendFileSync(`${out}/console.log`, text + "\n");
  lines.push(text);
  if (waiter && waiter.re.test(text)) { waiter.done(text); waiter = null; }
});
page.on("pageerror", (e) => appendFileSync(`${out}/console.log`, `[pageerror] ${e}\n`));
const t0 = Date.now();
const log = (s) => console.log(`[play ${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
await page.goto(`${base}/?boot=game&display=1${process.env.QUERY ?? ""}`);

for (const step of script.split(",")) {
  const [cmd, ...a] = step.split(":");
  if (cmd === "wait") {
    const re = new RegExp(a[0]);
    const hit = lines.find((l) => re.test(l));
    const r = hit ?? await new Promise((done) => {
      const t = setTimeout(() => { waiter = null; done("timeout"); }, Number(a[1] ?? 600) * 1000);
      waiter = { re, done: (x) => { clearTimeout(t); done(x); } };
    });
    log(`wait ${a[0]}: ${r}`);
  } else if (cmd === "key") {
    await page.keyboard.down(a[0]);
    await page.waitForTimeout(Number(a[1] ?? 1500));
    await page.keyboard.up(a[0]);
    log(`key ${a[0]}`);
  } else if (cmd === "sleep") {
    await page.waitForTimeout(Number(a[0]) * 1000);
  } else if (cmd === "shot") {
    await page.locator("#canvas").screenshot({ path: `${out}/${a[0]}.png` });
    log(`shot ${a[0]}`);
  } else if (cmd === "audio") {
    const r = await page.evaluate(async () => {
      const ctx = Module.jakompiledAudio, node = Module.jakompiledAudioNode;
      if (!ctx || !node) return "sin AudioContext";
      const an = ctx.createAnalyser();
      an.fftSize = 32768;
      node.connect(an);
      await new Promise((r) => setTimeout(r, 1000));
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      node.disconnect(an);
      let s = 0, peak = 0;
      for (const x of buf) { s += x * x; peak = Math.max(peak, Math.abs(x)); }
      return `${ctx.state} rms=${Math.sqrt(s / buf.length).toFixed(4)} pico=${peak.toFixed(3)}`;
    });
    log(`audio ${r}`);
  }
}
await context.close();
