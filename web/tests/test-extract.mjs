// Prueba de web/extract.html en Chromium headless con una ISO (normalmente la de prueba de
// make_test_iso.py). Elige el fichero, espera a que termine y lista lo que quedó en OPFS.
// Uso: node test-extract.mjs URL ISO [timeout_s]
// PLAYWRIGHT=$(npm root -g)/playwright/index.js para usar una instalación global.
const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const { chromium } = pw.chromium ? pw : pw.default;

const [url, isoPath, timeoutS = "120"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
let done;
const finished = new Promise((r) => (done = r));
page.on("console", (msg) => {
  const text = msg.text();
  console.log(text);
  const m = text.match(/^\[test\] extraction ok=(\w+)/);
  if (m) done(m[1]);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(url);
await page.setInputFiles("#iso", isoPath);
const outcome = await Promise.race([
  finished,
  new Promise((r) => setTimeout(() => r("timeout"), Number(timeoutS) * 1000)),
]);

// contenido de OPFS: ruta, tamaño y una suma simple de los bytes
const listing = await page.evaluate(async () => {
  const out = [];
  async function walk(dir, prefix) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === "directory") await walk(h, `${prefix}${name}/`);
      else {
        const f = await h.getFile();
        const bytes = new Uint8Array(await f.arrayBuffer());
        let sum = 0;
        for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i] * (i % 7 + 1)) >>> 0;
        out.push(`${prefix}${name} ${f.size} ${sum}`);
      }
    }
  }
  await walk(await navigator.storage.getDirectory(), "/");
  return out.sort();
});
console.log("[opfs]\n" + listing.join("\n"));
console.log(`[test] outcome=${outcome}`);
await browser.close();
