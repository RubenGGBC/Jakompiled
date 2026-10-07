// Ejecuta bench.js en Chromium (hilo principal y Worker) y muestra una tabla.
// Uso: PLAYWRIGHT=$(npm root -g)/playwright/index.js node run.mjs <jspi.wasm> [repeticiones]
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const { chromium } = pw.chromium ? pw : pw.default;

const wasm = readFileSync(process.argv[2]);
const reps = Number(process.argv[3] ?? 3);
const benchJs = readFileSync(new URL("./bench.js", import.meta.url));
const server = createServer((req, res) => {
  if (req.url === "/bench.js") res.writeHead(200, { "Content-Type": "text/javascript" }).end(benchJs);
  else if (req.url === "/jspi.wasm") res.writeHead(200, { "Content-Type": "application/wasm" }).end(wasm);
  else res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><script src='/bench.js'></script>");
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
console.log(`chromium ${browser.version()}`);
console.log("contexto,procesos,frames,jspi_ns_por_cambio,llamada_ns_por_cambio,jspi_ms_por_frame,ok");
for (let r = 0; r < reps; r++) {
  for (const where of ["main", "worker"]) {
    const res = await page.evaluate(async (where) => {
      const bytes = await (await fetch("/jspi.wasm")).arrayBuffer();
      if (where === "main") return runBench(bytes);
      const w = new Worker("/bench.js");
      return new Promise((ok) => { w.onmessage = (e) => ok(e.data); w.postMessage(bytes); });
    }, where);
    for (const x of res) {
      console.log([where, x.procs, x.frames, x.jspi_ns_per_switch.toFixed(0), x.plain_ns_per_switch.toFixed(1),
        x.jspi_ms_per_frame.toFixed(3), x.ok].join(","));
    }
  }
}
await browser.close();
server.close();
