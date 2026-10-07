// Compila y enlaza cada par .vert/.frag de un directorio en WebGL2 (Chromium headless, SwiftShader)
// e imprime los errores. Para los shaders traducidos por web/glsl_es.py.
// Uso: node test-shaders.mjs DIR_SHADERS
// PLAYWRIGHT=$(npm root -g)/playwright/index.js para usar una instalación global.
const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const { chromium } = pw.chromium ? pw : pw.default;
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2];
const names = [...new Set(readdirSync(dir).filter((f) => /\.(vert|frag)$/.test(f)).map((f) => f.replace(/\.(vert|frag)$/, "")))].sort();
const shaders = names.map((n) => ({ n, v: readFileSync(`${dir}/${n}.vert`, "utf8"), f: readFileSync(`${dir}/${n}.frag`, "utf8") }));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const res = await page.evaluate((shaders) => {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return [{ n: "-", err: "no webgl2" }];
  const fix = (s) => s.replaceAll("HEIGHT_SCALE", "0.5").replaceAll("SCISSOR_HEIGHT", "416.0").replaceAll("SCISSOR_ADJUST", "(512.0 / 416.0)");
  const out = [];
  for (const { n, v, f } of shaders) {
    const errs = [];
    const sh = (type, src, tag) => { const s = gl.createShader(type); gl.shaderSource(s, fix(src)); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) errs.push(`${tag}: ${gl.getShaderInfoLog(s).trim()}`); return s; };
    const vs = sh(gl.VERTEX_SHADER, v, "vert"), fs = sh(gl.FRAGMENT_SHADER, f, "frag");
    if (!errs.length) { const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) errs.push(`link: ${gl.getProgramInfoLog(p).trim()}`); }
    out.push({ n, err: errs.join("\n") });
  }
  return out;
}, shaders);
await browser.close();
const bad = res.filter((r) => r.err);
for (const r of bad) console.log(`== ${r.n}\n${r.err}`);
console.log(`[glsl] ${res.length - bad.length}/${res.length} programas compilan y enlazan en WebGL2`);
