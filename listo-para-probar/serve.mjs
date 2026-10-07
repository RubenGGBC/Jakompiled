// Servidor estático con las cabeceras COOP/COEP que exige SharedArrayBuffer (pthreads).
// Uso: node serve.mjs <directorio> [puerto]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8080);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  const file = join(root, rel === "" ? "index.html" : rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}/ -> ${root}`));
