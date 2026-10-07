#!/usr/bin/env bash
# Compila el runtime de OpenGOAL (gk) para el navegador y monta web/dist.
#
#   1. Clona jak-project en el commit de referencia y aplica patches/jak-project
#   2. Compila gk.js + gk.wasm con Emscripten (emsdk activo: source emsdk_env.sh)
#   3. Compila Binaryen y goalc en nativo (incluido goalc-wasm, el backend wasm de la fase 3)
#   4. Compila el kernel GOAL a wasm y monta KERNEL.CGO (backend/build_kernel.sh, sin ISO)
#   5. Lo copia todo a web/dist
#
# Uso: ./build_runtime.sh [directorio-de-trabajo]   (por defecto: web/work)
# Requisitos: git, cmake, ninja, clang, nasm, emsdk (emcc en el PATH)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
work="$(mkdir -p "${1:-$here/work}" && cd "${1:-$here/work}" && pwd)"
commit=efb21c3e8c5a40a74f2e86510f915da55eaeba34
src="$work/jak-project"

command -v emcc >/dev/null || { echo "no se encuentra emcc: ejecuta antes 'source <emsdk>/emsdk_env.sh'"; exit 1; }

if [ ! -d "$src/.git" ]; then
  git init -q "$src"
  git -C "$src" remote add origin https://github.com/open-goal/jak-project.git
  git -C "$src" fetch -q --depth 1 origin "$commit"
  git -C "$src" checkout -q FETCH_HEAD
  git -C "$src" -c user.name=jakompiled -c user.email=jakompiled@localhost \
    am -q "$repo"/patches/jak-project/*.patch
fi

echo "== gk (wasm)"
emcmake cmake -S "$src/web" -B "$src/build-web" -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
ninja -C "$src/build-web" gk

echo "== Binaryen (lo usa el backend wasm de goalc)"
binaryen="$work/binaryen"
if [ ! -f "$binaryen/install/include/binaryen-c.h" ]; then
  [ -d "$binaryen/.git" ] || git clone -q --depth 1 --branch version_133 \
    https://github.com/WebAssembly/binaryen.git "$binaryen"
  git -C "$binaryen" submodule update -q --init --depth 1
  cmake -S "$binaryen" -B "$binaryen/build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DBUILD_TESTS=OFF -DBUILD_TOOLS=OFF \
    -DENABLE_WERROR=OFF -DCMAKE_INSTALL_PREFIX="$binaryen/install" >/dev/null
  ninja -C "$binaryen/build" install >/dev/null
fi

echo "== goalc y goalc-wasm (nativo)"
cmake -S "$src" -B "$src/build/Release/bin" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DSDL_X11=OFF -DSDL_WAYLAND=OFF -DSDL_UNIX_CONSOLE_BUILD=ON \
  -DBINARYEN_ROOT="$binaryen/install" >/dev/null
ninja -C "$src/build/Release/bin" goalc goalc-wasm

echo "== KERNEL.CGO (kernel GOAL compilado a wasm)"
mkdir -p "$src/out/jak2/iso"
JAK_PROJECT="$src" "$repo/backend/build_kernel.sh" "$src/out/jak2/iso/KERNEL.CGO"

echo "== dist"
JAK_WEB="$src" JAK_PROJECT="$src" "$here/build_dist.sh"
