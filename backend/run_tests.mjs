// Fase 3: carga un módulo generado por goalc-wasm, lo enlaza y comprueba cada función.
// Uso: node run_tests.mjs tests/basic.wasm [tests/basic.oracle-x86.txt]
//   El segundo argumento compara, caso a caso, con los resultados del x86 real de goalc
//   (generados por oracle/goal_oracle.cpp).
import { readFileSync } from "node:fs";

const EE_BASE = 0x01000000; // WASM_EE_MAIN_MEM_BASE (common/goal_constants.h)
const S7 = 0x100000; // dirección GOAL de la tabla de símbolos (arbitraria para el test)
const TRUE_OFF = 4; // jak2_symbols::FIX_SYM_TRUE
const SYM_AREA = S7 + 0x1000;
const FUNC_AREA = 0x200000;
const HEAP = 0x300000;
const STACK_TOP = 0x400000; // pila GOAL (crece hacia abajo)

// todas las funciones GOAL tienen el tipo (i64 x 8) -> i64: se rellenan los argumentos con 0
const pad8 = (args) => [...args, ...Array(8 - args.length).fill(0n)];

const bytes = readFileSync(process.argv[2]);
const module = new WebAssembly.Module(bytes);
const memory = new WebAssembly.Memory({ initial: (EE_BASE + 128 * 1024 * 1024) / 65536, maximum: 65536 });
const table = new WebAssembly.Table({ initial: 0, element: "anyfunc" });
const dv = new DataView(memory.buffer);
const g = (addr) => EE_BASE + addr; // dirección GOAL -> índice en la memoria wasm

// "Enlazador": un símbolo por import sym.*, un objeto function por cada función exportada
const symAddr = new Map();
const funcAddr = new Map();
const symbol = (name) => {
  if (!symAddr.has(name)) symAddr.set(name, SYM_AREA + symAddr.size * 16 + 1); // jak2: puntero +1
  return symAddr.get(name);
};
const exportNames = WebAssembly.Module.exports(module).map((e) => e.name);
exportNames.forEach((name, i) => funcAddr.set(name, FUNC_AREA + i * 16));

const i64Global = (v) => new WebAssembly.Global({ value: "i64", mutable: true }, v);
const imports = {
  env: { mem: memory, table, s7: BigInt(S7), sp: i64Global(BigInt(STACK_TOP)), pp: i64Global(0n) },
  sym: {}, func: {},
};
for (const imp of WebAssembly.Module.imports(module)) {
  if (imp.module === "sym") imports.sym[imp.name] = BigInt(symbol(imp.name));
  if (imp.module === "func") imports.func[imp.name] = BigInt(funcAddr.get(imp.name));
}
const instance = new WebAssembly.Instance(module, imports);
const ex = instance.exports;
for (const name of exportNames) {
  const idx = table.grow(1);
  table.set(idx, ex[name]);
  dv.setUint32(g(funcAddr.get(name)), idx, true);
}

// el código de nivel superior define las funciones y los globales en sus símbolos
const topLevel = exportNames.find((n) => n.includes("top-level"));
ex[topLevel](...pad8([]));
const symValue = (name) => dv.getUint32(g(symbol(name) - 1), true);

// ---- utilidades
const f32bits = (x) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x, true); return BigInt(b.getUint32(0, true)); };
const bitsf32 = (v) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, Number(BigInt.asUintN(32, v)), true); return b.getFloat32(0, true); };
const I = (x) => BigInt(x);
const call = (name, ...args) => ex[name](...pad8(args.map((a) => (typeof a === "bigint" ? a : BigInt(a)))));
const f32 = Math.fround;

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = typeof want === "function" ? want(got) : got === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label} = ${got}${ok ? "" : `  (esperado ${want})`}`);
}

// ---- quat.gc: quaternion*! y quaternion-normalize! contra el cálculo en JS
if (exportNames.includes("t-qmul")) {
  const pack = (x, y, z, w) => [f32bits(x) | (f32bits(y) << 32n), f32bits(z) | (f32bits(w) << 32n)];
  const run = (name, qa, qb) => {
    const [a0, a1] = pack(...qa), [b0, b1] = pack(...qb);
    const r = [0, 1].map((sel) => BigInt.asUintN(64, call(name, BigInt.asIntN(64, a0), BigInt.asIntN(64, a1), BigInt.asIntN(64, b0), BigInt.asIntN(64, b1), sel)));
    return [bitsf32(r[0]), bitsf32(r[0] >> 32n), bitsf32(r[1]), bitsf32(r[1] >> 32n)];
  };
  const near = (want) => (got) => got.every((v, i) => Math.abs(v - want[i]) < 1e-4 * Math.max(1, Math.abs(want[i])));
  const cases = [[[0.1, 0.2, 0.3, 0.927], [0.5, -0.5, 0.5, 0.5]], [[0, 0, 0.7071, 0.7071], [0.7071, 0, 0, 0.7071]],
    [[0.3, -0.1, 0.2, 0.9], [-0.2, 0.4, 0.1, 0.88]]];
  for (const [p, q] of cases) {
    const [x1, y1, z1, w1] = p, [x2, y2, z2, w2] = q;
    // Hamilton: p * q
    const want = [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
      w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2];
    const got = run("t-qmul", p, q);
    const wantSwap = (() => { const [a, b, c, d] = q, [e, f, gg, h] = p;
      return [d * e + a * h + b * gg - c * f, d * f - a * gg + b * h + c * e, d * gg + a * f - b * e + c * h, d * h - a * e - b * f - c * gg]; })();
    check(`t-qmul ${p} ${q} -> ${got.map((v) => v.toFixed(4))}`, got, (g) => near(want)(g) || near(wantSwap)(g));
  }
  for (const p of [[0.1, 0.2, 0.3, 0.927], [1, 2, 3, 4], [0, 0, 0, 2]]) {
    const n = Math.hypot(...p);
    const got = run("t-qnorm", p, [0, 0, 0, 0]);
    check(`t-qnorm ${p} -> ${got.map((v) => v.toFixed(4))}`, got, near(p.map((v) => v / n)));
  }
}

// ---- tests propios de basic.gc (los demás ficheros solo se comparan con el oráculo x86)
const isBasic = exportNames.includes("t-add");
if (isBasic) {
  check("t-add 40 2", call("t-add", 40, 2), 42n);
  check("t-add -5 3", call("t-add", -5, 3), -2n);
  check("t-arith 7 2", call("t-arith", 7, 2), 7n * 2n - 3n);
  check("t-arith -9 2", call("t-arith", -9, 2), -18n - -4n);
  check("t-mod 17 5", call("t-mod", 17, 5), 2n);
  check("t-mod -17 5", call("t-mod", -17, 5), -2n);
  check("t-shift 100 3", call("t-shift", 100, 3), 800n + 25n + 50n);
  check("t-shift -100 3", call("t-shift", -100, 3), -800n + -25n + BigInt.asIntN(64, BigInt.asUintN(64, -100n) >> 1n));
  check("t-logic 12 10", call("t-logic", 12, 10), (12n & 10n) ^ (12n | 7n) ^ ~10n);
  for (const [x, want] of [[-3, -1n], [0, 0n], [5, 1n], [50, 2n]]) check(`t-cond ${x}`, call("t-cond", x), want);
  check("t-loop 10", call("t-loop", 10), 285n);
  check("t-loop 0", call("t-loop", 0), 0n);
  check("t-early 3", call("t-early", 3), 3n);
  check("t-early 9", call("t-early", 9), 100n);
  for (const [x, want] of [[0, 0n], [5, 1n], [10, 0n]]) check(`t-bool ${x}`, call("t-bool", x), want);
  check("t-sym-bool 5 == #t", call("t-sym-bool", 5), BigInt(S7 + TRUE_OFF));
  check("t-sym-bool 1 == #f", call("t-sym-bool", 1), BigInt(S7));
  check("t-fact 10 (recursiva, vía símbolo)", call("t-fact", 10), 3628800n);
  check("t-fact 20 (multiplicación de 32 bits, como en PS2)", call("t-fact", 20), -2102132736n);
  check("t-call3 1 2 3", call("t-call3", 1, 2, 3), 6n);
  check("t-global-set 7", call("t-global-set", 7), 21n);
  check("*t-global* en memoria", symValue("*t-global*"), 21);

  // memoria: un array de int32 en el heap GOAL
  for (let i = 0; i < 5; i++) dv.setInt32(g(HEAP + 4 * i), (i + 1) * 10, true);
  check("t-mem suma", call("t-mem", HEAP, 5), 150n);
  check("t-mem escribe", [0, 1, 2, 3, 4].map((i) => dv.getInt32(g(HEAP + 4 * i), true)).join(","), "20,40,60,80,100");
  dv.setInt8(g(HEAP + 64), -7);
  dv.setUint8(g(HEAP + 65), 250);
  check("t-sext int8/uint8", call("t-sext", HEAP + 64, HEAP + 65), -7000n + 250n);

  // flotantes
  {
    const a = 3.5, b = 1.25;
    const want = BigInt(Math.trunc(f32(1000 * f32(f32(f32(f32(f32(a * b) + f32(a / b)) + Math.min(a, b)) + Math.max(a, b)) + f32(a - b)))));
    check("t-float 3.5 1.25", call("t-float", f32bits(a), f32bits(b)), want);
  }
  check("t-f2i 7.9", call("t-f2i", f32bits(7.9)), 7n);
  check("t-f2i -7.9", call("t-f2i", f32bits(-7.9)), -7n);
  check("t-f2i NaN (x86: INT_MIN)", call("t-f2i", f32bits(NaN)), -2147483648n);
  check("t-f2i 3e9 (x86: INT_MIN)", call("t-f2i", f32bits(3e9)), -2147483648n);
  check("t-i2f 7", bitsf32(call("t-i2f", 7)), 3.5);
  check("t-fcmp 1 2", call("t-fcmp", f32bits(1), f32bits(2)), 1n);
  check("t-fcmp 2 2", call("t-fcmp", f32bits(2), f32bits(2)), 10n);
  check("t-fcmp 3 2", call("t-fcmp", f32bits(3), f32bits(2)), 100n);
  check("t-fcmp NaN 2 (comiss: < y = ciertos)", call("t-fcmp", f32bits(NaN), f32bits(2)), 11n);
}

// ---- comparación con el x86 nativo de goalc
if (process.argv[3]) {
  console.log("\n== comparación con x86 (goalc nativo)");
  let same = 0, diff = 0;
  for (const line of readFileSync(process.argv[3], "utf8").split("\n")) {
    const m = line.match(/^ORACLE \((\S+)(.*)\) => (-?\d+)$/);
    if (!m) continue;
    const [, fn, argText, nativeText] = m;
    const args = [...argText.matchAll(/\(the-as float #x([0-9a-f]+)\)|(-?\d+)/g)].map((a) =>
      a[1] !== undefined ? BigInt("0x" + a[1]) : BigInt(a[2]));
    const wasm = BigInt.asIntN(64, ex[fn](...pad8(args)));
    const native = BigInt(nativeText);
    if (wasm === native) same++;
    else {
      diff++;
      console.log(`DIFF (${fn}${argText}): wasm ${wasm}, x86 ${native}`);
    }
  }
  console.log(`${same} iguales a x86, ${diff} distintos`);
  if (diff) fail += diff;
}

console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
