#!/usr/bin/env bash
# Monta web/dist con la página, el runtime compilado, KERNEL.CGO y GAME.CGO (si existe).
# Uso: JAK_WEB=/ruta/a/jak-project-web JAK_PROJECT=/ruta/a/jak-project ./build_dist.sh
#   JAK_WEB:     árbol de jak-project con los parches de patches/ y build-web/ compilado
#   JAK_PROJECT: árbol con out/jak2/iso/KERNEL.CGO (el kernel GOAL compilado a wasm,
#                backend/build_kernel.sh)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dist="$here/dist"
rm -rf "$dist" && mkdir -p "$dist/data"
cp "$here/index.html" "$here/boot.js" "$dist/"
cp "$JAK_WEB/build-web/game/gk.js" "$JAK_WEB/build-web/game/gk.wasm" "$dist/"
cp "$JAK_PROJECT/out/jak2/iso/KERNEL.CGO" "$dist/data/"
if [ -f "$JAK_PROJECT/out/jak2/iso/GAME.CGO" ]; then cp "$JAK_PROJECT/out/jak2/iso/GAME.CGO" "$dist/data/"; fi
ls -la "$dist" "$dist/data"
