// Flujo completo en una misma sesión del navegador (OPFS se comparte entre páginas del origen):
//  1. extract.html con una ISO (aquí la de prueba): ISO → OPFS, montaje de los DGO/CGO
//  2. index.html?boot=game: el runtime debe usar los ficheros extraídos de OPFS
// Uso: node test-flow.mjs BASE_URL ISO PASOS REGEX_ÉXITO [timeout_s]
// PLAYWRIGHT=$(npm root -g)/playwright/index.js para usar una instalación global.
const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const { chromium } = pw.chromium ? pw : pw.default;
const [base, isoPath, steps, okRegex, timeoutS = "300"] = process.argv.slice(2);
const timeout = Number(timeoutS) * 1000;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext();

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
console.log(`[flow] extracción: ${await waitFor(extract, /\[test\] extraction ok=\w+/)}`);
await extract.close();

const game = await context.newPage();
await game.goto(`${base}/?boot=game`);
const r = await waitFor(game, new RegExp(okRegex));
console.log(`[flow] juego: ${r}`);
console.log(`[test] outcome=${r === "timeout" ? "timeout" : "expected"}`);
await browser.close();
