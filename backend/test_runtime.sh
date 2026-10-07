#!/usr/bin/env bash
# Fase 3: prueba de punta a punta. Compila tests/runtime/hello.gc con goalc-wasm a un objeto GOAL,
# lo empaqueta como KERNEL.CGO y arranca el runtime (gk en wasm) en Chromium headless: el runtime
# carga el objeto, instancia su módulo wasm y ejecuta su código, que imprime con _format.
#
# Uso: JAK_PROJECT=/ruta/a/jak-project-con-parches ./test_runtime.sh
#   Necesita web/dist montado (web/build_runtime.sh) y Playwright (PLAYWRIGHT=ruta a playwright).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
web="$here/../web"
goalc_wasm="${GOALC_WASM:-$JAK_PROJECT/build/Release/bin/goalc/goalc-wasm}"
work="$(mktemp -d)"
trap 'rm -rf "$work"; [ -n "${server:-}" ] && kill $server' EXIT

"$goalc_wasm" --proj-path "$JAK_PROJECT" --shared-memory "$here/tests/runtime/hello.gc" "$work/hello.o" \
  | grep -v "debug\]" || true
# una copia de dist con este objeto como KERNEL.CGO
cp -r "$web/dist" "$work/dist"
python3 "$here/make_dgo.py" "$work/dist/data/KERNEL.CGO" "$work/hello.o"

port=$((20000 + RANDOM % 20000))
node "$web/serve.mjs" "$work/dist" "$port" >/dev/null &
server=$!
sleep 1
node "$web/test-boot.mjs" "http://localhost:$port/" 60 "\[GOAL/wasm\] flotante" | grep -E "GOAL/wasm|\[test\]"
