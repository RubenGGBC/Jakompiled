#!/usr/bin/env bash
# Fase 3: compila tests/unit/*.gc con goalc-wasm y los ejecuta en Node.
# Compara con los resultados del x86 nativo de goalc guardados en tests/unit/*.oracle-x86.txt
# (para regenerarlos: oracle/goal_oracle.cpp, ver docs/fase3-backend.md).
#
# Uso: JAK_PROJECT=/ruta/a/jak-project-con-parches ./test.sh
#   (JAK_PROJECT debe tener compilado build/Release/bin/goalc/goalc-wasm; web/build_runtime.sh lo hace)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
goalc_wasm="${GOALC_WASM:-$JAK_PROJECT/build/Release/bin/goalc/goalc-wasm}"
status=0
for gc in "$here"/tests/unit/*.gc; do
  name="$(basename "$gc" .gc)"
  "$goalc_wasm" --proj-path "$JAK_PROJECT" "$gc" "$here/tests/unit/$name.wasm" | grep -v "debug\]" || true
  oracle="$here/tests/unit/$name.oracle-x86.txt"
  node "$here/run_tests.mjs" "$here/tests/unit/$name.wasm" $([ -f "$oracle" ] && echo "$oracle") || status=1
done
exit $status
