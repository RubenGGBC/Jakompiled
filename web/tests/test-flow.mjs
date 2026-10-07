// Flujo completo en una misma sesión del navegador (OPFS se comparte entre páginas del origen):
//  1. extract.html con una ISO (aquí la de prueba): ISO → OPFS, montaje de los DGO/CGO
//  2. index.html?boot=game: el runtime debe usar los ficheros extraídos de OPFS
// Uso: node test-flow.mjs BASE_URL ISO PASOS REGEX_ÉXITO [timeout_s]
// PLAYWRIGHT=$(npm root -g)/playwright/index.js para usar una instalación global.
import { pathToFileURL } from "node:url";
// En Windows import() no acepta rutas absolutas (C:\...): hay que pasarlas como file://.
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : "playwright");
const { chromium } = pw.chromium ? pw : pw.default;
const [base, isoPath, steps, okRegex, timeoutS = "300"] = process.argv.slice(2);
const timeout = Number(timeoutS) * 1000;
const args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
// PROFILE=dir: perfil persistente. Con una ISO real hace falta: un contexto efímero (incógnito)
// tiene una cuota de OPFS muy pequeña para los ~4,4 GB de la ISO más lo extraído.
const context = process.env.PROFILE
  ? await chromium.launchPersistentContext(process.env.PROFILE, { args })
  : await (await chromium.launch({ args })).newContext();
const browser = { close: () => context.close() };

function waitFor(page, regex) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout"), timeout);
    page.on("console", (m) => {
      const text = m.text();
      console.log(text);
      const r = text.match(regex);
      if (r) { clearTimeout(t); resolve(r[0]); }
    });
  });
}

const extract = await context.newPage();
await extract.goto(`${base}/extract.html?steps=${steps}`);
await extract.setInputFiles("#iso", isoPath);
const ex = await waitFor(extract, /\[test\] extraction ok=\w+/);
console.log(`[flow] extracción: ${ex}`);
if (ex !== "[test] extraction ok=true") {
  // sin esto el juego arrancaba con los ficheros servidos con la página y el test "pasaba"
  console.log("[test] outcome=extraction-failed");
  await browser.close();
  process.exit(1);
}
await extract.close();

const game = await context.newPage();
await game.goto(`${base}/?boot=game`);
const r = await waitFor(game, new RegExp(okRegex));
console.log(`[flow] juego: ${r}`);
console.log(`[test] outcome=${r === "timeout" ? "timeout" : "expected"}`);
await browser.close();
