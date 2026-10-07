// Fase 1: ejecuta bench.wasm en V8 (el motor de Chrome) y mide cada bucle.
// Hace de "enlazador": rellena la tabla de símbolos, los objetos function y las cadenas.
// Uso: node run.mjs <fichero.wasm> [repeticiones]

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const file = process.argv[2] ?? "bench.wasm";
const reps = Number(process.argv[3] ?? 5);

const { instance } = await WebAssembly.instantiate(readFileSync(file));
const ex = instance.exports;
// módulo de referencia en C (bench_ref.c): mismas funciones con prefijo ref_ y sin enlace GOAL
const isRef = "ref_nop_loop" in ex;
const fn = (name) => (isRef ? ex[name.replace("bench-", "ref_").replace("-", "_")] : ex[name]);
if (!isRef) linkGoal(ex);

function linkGoal(ex) {
  const mem = new DataView(ex.mem.buffer);
  const s7 = Number(ex.s7.value);

  // objetos function: un stub de 16 bytes que guarda el índice en la Table
  const FUNC_OBJS = 0x20000;
  const symbols = { 0x100: 0, 0x104: 1, 0x108: 2, 0x10c: 3 }; // offset de símbolo -> índice
  for (const [symOff, tableIdx] of Object.entries(symbols)) {
    const fobj = FUNC_OBJS + tableIdx * 16;
    mem.setUint32(fobj, tableIdx, true);
    mem.setUint32(s7 + Number(symOff), fobj, true);
  }

  // cadenas GOAL: allocated-length en +0, datos en +4, terminadas en 0
  const text = "the quick brown fox jumps over!!";
  for (const base of [0x30000, 0x30100]) {
    mem.setInt32(base, text.length + 1, true);
    for (let i = 0; i < text.length; i++) mem.setUint8(base + 4 + i, text.charCodeAt(i));
    mem.setUint8(base + 4 + text.length, 0);
  }
}

const benches = [
  ["bench-nop-loop", 200000000n],
  ["bench-matrix-loop", 100000000n],
  ["bench-sin-loop", 200000000n],
  ["bench-string-loop", 10000000n],
];

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

// calentamiento para que V8 suba las funciones a TurboFan
for (const [name, n] of benches) fn(name)(n / 100n);

console.log("benchmark,iteraciones,segundos,ns_por_iter,resultado");
for (const [name, n] of benches) {
  const times = [];
  let result;
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    result = fn(name)(n);
    times.push((performance.now() - t0) / 1000);
  }
  const s = median(times);
  console.log(`${name},${n},${s.toFixed(4)},${((s * 1e9) / Number(n)).toFixed(3)},${result}`);
}
