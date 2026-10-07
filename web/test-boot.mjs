// Arranca la página en Chromium headless y comprueba hasta dónde llega el runtime.
// Uso: node test-boot.mjs [url] [timeout_s] [regex_de_éxito]
//   Sin regex: comprueba que el runtime llega al primer salto a código GOAL (fase 2).
//   Con regex: espera a que alguna línea la cumpla (p. ej. la salida de un programa GOAL).
// PLAYWRIGHT permite usar una instalación global: PLAYWRIGHT=$(npm root -g)/playwright/index.js
// SCREENSHOT=fichero.png guarda una captura de la página al terminar.
const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const { chromium } = pw.chromium ? pw : pw.default;

const url = process.argv[2] ?? "http://localhost:8080/";
const timeoutMs = Number(process.argv[3] ?? 120) * 1000;
const expect = process.argv[4] ? new RegExp(process.argv[4]) : null;

// WebGL 2 por software (SwiftShader) en headless
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const lines = [];
let done;
const finished = new Promise((r) => (done = r));
page.on("console", (msg) => {
  const text = msg.text();
  lines.push(text);
  console.log(text);
  if (text.includes("stopping") || text.includes("[boot] abort") || text.includes("RuntimeError")) {
    done("stopped");
  }
  if (expect && expect.test(text)) done("expected");
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(url);
const isolated = await page.evaluate(() => crossOriginIsolated);
console.log(`[test] crossOriginIsolated=${isolated}`);
const outcome = await Promise.race([finished, new Promise((r) => setTimeout(() => r("timeout"), timeoutMs))]);
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
await browser.close();

if (expect) {
  const ok = outcome === "expected";
  console.log(`[test] outcome=${outcome} expected_output=${ok}`);
  process.exit(ok ? 0 : 1);
}
const reached = lines.some((l) => l.includes("[jakompiled]") && l.includes("GOAL"));
console.log(`[test] outcome=${outcome} reached_goal_call=${reached}`);
process.exit(reached ? 0 : 1);
