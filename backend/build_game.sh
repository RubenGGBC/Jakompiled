#!/usr/bin/env bash
# Compila el código de GAME.CGO de Jak 2 (el motor: los objetos .o de goal_src/jak2/dgos/game.gd, en
# su orden) con el backend wasm de goalc y monta un GAME.CGO solo con código.
#
# El GAME.CGO real también lleva texturas y art groups (tpage-*.go, *-ag.go). Esos salen de la ISO
# del usuario y se añadirán en el navegador en la fase 4; aquí no hay ningún dato de la ISO.
#
# Uso: JAK_PROJECT=/ruta/a/jak-project-con-parches ./build_game.sh SALIDA.CGO
#   GOALC_WASM_FLAGS: opciones extra para goalc-wasm (p. ej. --debug-calls, que comprueba cada
#   llamada indirecta en el runtime e imprime aquí la lista de puntos de llamada)
#   EMPTY_TPAGE_DIR=1: solo para pruebas sin ISO. Añade un dir-tpages.go vacío (un directorio de
#   texturas con 0 entradas, sin ningún dato del juego) para que el motor pase de texture-upload,
#   que sin él se queda esperando a cargar una textura que no existe.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
goalc_wasm="${GOALC_WASM:-$JAK_PROJECT/build/Release/bin/goalc/goalc-wasm}"
out="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
objs="$(mktemp -d)"
trap 'rm -rf "$objs"' EXIT

# Entradas del CGO en orden: "code <fuente.gc>" o "data <nombre>". Las fuentes se buscan como en
# goal_src/jak2/lib/project-lib.gp: por nombre en goal_src/jak2 y, si no está, en goal_src/jak1
# (pckernel-h, pckernel-common, pc-debug-common). collide-planes no tiene fuente en Jak 2 (el
# fichero original estaba vacío) y se omite.
mapfile -t entries < <(python3 "$here/game_cgo_entries.py" "$JAK_PROJECT" "${EMPTY_TPAGE_DIR:-0}")
game=()
for e in "${entries[@]}"; do
  if [ "${e%% *}" = code ]; then game+=("${e#code }"); fi
done

kernel=(gcommon gstring-h gkernel-h gkernel pskernel gstring dgo-h gstate)
inputs=()
for k in "${kernel[@]}"; do inputs+=("$JAK_PROJECT/goal_src/jak2/kernel/$k.gc"); done
inputs+=("${game[@]}")

# el kernel se compila primero (sus tipos y macros), pero va en KERNEL.CGO, no aquí
"$goalc_wasm" --proj-path "$JAK_PROJECT" --shared-memory --trap-unsupported ${GOALC_WASM_FLAGS:-} \
  --out-dir "$objs" "${inputs[@]}" | grep -v "debug\]" | grep -v "bytes (module" || true

if [ "${EMPTY_TPAGE_DIR:-0}" = 1 ]; then
  # goalc escribe out/jak2/obj/dir-tpages.go con su propio generador (asm-data-file dir-tpages),
  # pero no crea el directorio (en un árbol recién clonado no existe)
  mkdir -p "$JAK_PROJECT/out/jak2/obj"
  : > "$objs/empty-tpage-dir.txt"
  echo "(asm-data-file dir-tpages \"$objs/empty-tpage-dir.txt\")" > "$objs/make-tpage-dir.gc"
  "$goalc_wasm" --proj-path "$JAK_PROJECT" "$objs/make-tpage-dir.gc" "$objs/make-tpage-dir.wasm" \
    >/dev/null
  cp "$JAK_PROJECT/out/jak2/obj/dir-tpages.go" "$objs/dir-tpages.go"
fi

objects=()
for e in "${entries[@]}"; do
  case "$e" in
    code\ *) objects+=("$objs/$(basename "${e#code }" .gc).o") ;;
    data\ *) objects+=("$objs/${e#data }.go") ;;
  esac
done
python3 "$here/make_dgo.py" "$out" "${objects[@]}"
