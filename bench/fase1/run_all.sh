#!/usr/bin/env bash
# Fase 1: ejecuta las cinco variantes del benchmark y deja los CSV en results/.
#
# Requisitos: clang (con wasm-ld), node >= 22, npm (instala wabt y binaryen en tools/)
# y un build de jak-project con el target goal-bench (ver README.md).
#
# Uso: JAK_PROJECT=/ruta/a/jak-project ./run_all.sh [repeticiones]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
reps="${1:-5}"
out="$here/results"
build="$here/build"
mkdir -p "$out" "$build"

if [ ! -x "$here/tools/node_modules/.bin/wat2wasm" ]; then
  (cd "$here/tools" && npm install --silent)
fi
bin="$here/tools/node_modules/.bin"

echo "== wasm: goalc ingenuo (WAT a mano) y tras wasm-opt -O3"
"$bin/wat2wasm" "$here/wasm/bench.wat" -o "$build/goal_naive.wasm"
"$bin/wasm-opt" -O3 --enable-simd --enable-nontrapping-float-to-int \
  "$build/goal_naive.wasm" -o "$build/goal_opt.wasm"
node "$here/wasm/run.mjs" "$build/goal_naive.wasm" "$reps" | tee "$out/wasm_goal_naive.csv"
node "$here/wasm/run.mjs" "$build/goal_opt.wasm" "$reps" | tee "$out/wasm_goal_opt.csv"

echo "== referencia C (clang -O2): nativo y wasm32"
clang -O2 -o "$build/bench_ref" "$here/ref/bench_ref.c"
clang --target=wasm32 -O2 -msimd128 -nostdlib -Wl,--no-entry -Wl,--export-dynamic \
  -o "$build/bench_ref.wasm" "$here/ref/bench_ref.c"
"$build/bench_ref" "$reps" | tee "$out/native_c.csv"
node "$here/wasm/run.mjs" "$build/bench_ref.wasm" "$reps" | tee "$out/wasm_c.csv"

if [ -n "${JAK_PROJECT:-}" ]; then
  echo "== nativo: goalc x86-64 en el runtime real de OpenGOAL"
  (cd "$JAK_PROJECT" && ./build/Release/bin/goal-bench "$here/goal/bench.gc" "$reps") \
    | grep -E '^(benchmark|bench-)' | tee "$out/native_goalc.csv"
else
  echo "(JAK_PROJECT no definido: se omite la medida nativa de goalc)"
fi
