#!/usr/bin/env bash
# Compila TODO el código de Jak 2 (kernel, motor y niveles: 839 objetos) con el backend wasm de
# goalc y lo empaqueta en CODE.PAK. En el navegador, tras extraer la ISO, el extractor monta los
# DGO/CGO del juego con este código y los datos de la ISO (web/build_game_web.cpp).
#
# Uso: JAK_PROJECT=/ruta/a/jak-project-con-parches ./build_code.sh SALIDA.PAK
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
goalc_wasm="${GOALC_WASM:-$JAK_PROJECT/build/Release/bin/goalc/goalc-wasm}"
out="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
objs="$(mktemp -d)"
trap 'rm -rf "$objs"' EXIT

mapfile -t sources < <(python3 "$here/code_sources.py" "$JAK_PROJECT")
"$goalc_wasm" --proj-path "$JAK_PROJECT" --shared-memory --trap-unsupported ${GOALC_WASM_FLAGS:-} \
  --out-dir "$objs" "${sources[@]}" | grep -v "debug\]" | grep -v "bytes (module" || true

objects=()
for s in "${sources[@]}"; do objects+=("$objs/$(basename "$s" .gc).o"); done
python3 "$here/make_dgo.py" "$out" "${objects[@]}"
