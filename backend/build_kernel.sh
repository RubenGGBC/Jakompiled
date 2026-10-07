#!/usr/bin/env bash
# Compila el kernel GOAL de Jak 2 (goal_src/jak2/kernel, en el orden de dgos/kernel.gd) con el
# backend wasm de goalc y monta KERNEL.CGO. Los objetos extra se compilan después del kernel
# (ven sus tipos y macros) y se añaden al final del CGO.
#
# Uso: JAK_PROJECT=/ruta/a/jak-project-con-parches ./build_kernel.sh SALIDA.CGO [extra.gc ...]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
goalc_wasm="${GOALC_WASM:-$JAK_PROJECT/build/Release/bin/goalc/goalc-wasm}"
out="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
objs="$(mktemp -d)"
trap 'rm -rf "$objs"' EXIT

kernel=(gcommon gstring-h gkernel-h gkernel pskernel gstring dgo-h gstate)
inputs=()
for k in "${kernel[@]}"; do inputs+=("$JAK_PROJECT/goal_src/jak2/kernel/$k.gc"); done
for extra in "$@"; do inputs+=("$(cd "$(dirname "$extra")" && pwd)/$(basename "$extra")"); done

# --trap-unsupported: lo poco que el backend aún no soporta (hoy: print de vec4s) se compila a una
# trampa con el nombre de la función, en vez de impedir que se monte el kernel
"$goalc_wasm" --proj-path "$JAK_PROJECT" --shared-memory --trap-unsupported --out-dir "$objs" \
  "${inputs[@]}" | grep -v "debug\]"

objects=()
for i in "${inputs[@]}"; do objects+=("$objs/$(basename "$i" .gc).o"); done
python3 "$here/make_dgo.py" "$out" "${objects[@]}"
