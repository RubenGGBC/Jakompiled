#!/usr/bin/env bash
# Fase 3: pruebas de punta a punta en Chromium headless, con el runtime (gk) compilado a wasm.
#
#  1. hello: un objeto GOAL suelto como KERNEL.CGO; llama a funciones C del runtime (_format).
#  2. procs: el kernel GOAL real de Jak 2 compilado a wasm, más un objeto que crea un proceso:
#     suspend/resume entre frames (JSPI), catch/throw, go y desactivación del proceso.
#  3. game: arranque normal (-boot) con KERNEL.CGO y GAME.CGO, todo el motor compilado a wasm.
#     Sin la ISO no hay texturas: la prueba pasa si se enlazan y ejecutan los objetos del motor
#     hasta texture-finish, el primero que necesita las texturas del juego (fase 4).
#
# Uso: JAK_PROJECT=/ruta/a/jak-project-con-parches ./test_runtime.sh
#   Necesita web/dist montado (web/build_runtime.sh) y Playwright (PLAYWRIGHT=ruta a playwright).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
web="$here/../web"
goalc_wasm="${GOALC_WASM:-$JAK_PROJECT/build/Release/bin/goalc/goalc-wasm}"
work="$(mktemp -d)"
trap 'rm -rf "$work"; [ -n "${server:-}" ] && kill $server' EXIT
status=0

run_case() {  # nombre, KERNEL.CGO, regex de éxito, [GAME.CGO]
  rm -rf "$work/dist" && cp -r "$web/dist" "$work/dist"
  cp "$2" "$work/dist/data/KERNEL.CGO"
  local query=""
  if [ -n "${4:-}" ]; then
    cp "$4" "$work/dist/data/GAME.CGO"
    query="?boot=game"
  fi
  echo "== $1"
  node "$web/test-boot.mjs" "http://localhost:$port/$query" 180 "$3" \
    | grep -E "GOAL/wasm|\[test\]|link finish: texture-finish" || status=1
}

port=$((20000 + RANDOM % 20000))
node "$web/serve.mjs" "$work/dist" "$port" >/dev/null &
server=$!
mkdir -p "$work/dist"
sleep 1

"$goalc_wasm" --proj-path "$JAK_PROJECT" --shared-memory "$here/tests/runtime/hello.gc" "$work/hello.o" \
  | grep -v "debug\]" || true
python3 "$here/make_dgo.py" "$work/hello.CGO" "$work/hello.o" >/dev/null
run_case hello "$work/hello.CGO" "\[GOAL/wasm\] flotante"

GOALC_WASM="$goalc_wasm" "$here/build_kernel.sh" "$work/procs.CGO" "$here/tests/runtime/procs.gc" >/dev/null
run_case procs "$work/procs.CGO" "el proceso se desactiva"

GOALC_WASM="$goalc_wasm" "$here/build_kernel.sh" "$work/KERNEL.CGO" >/dev/null
EMPTY_TPAGE_DIR=1 GOALC_WASM="$goalc_wasm" "$here/build_game.sh" "$work/GAME.CGO" >/dev/null
run_case game "$work/KERNEL.CGO" "link finish: texture-finish" "$work/GAME.CGO"
exit $status
