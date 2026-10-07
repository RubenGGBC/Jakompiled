# Benchmark de la fase 1

Resultados e interpretación: [docs/fase1-benchmark.md](../../docs/fase1-benchmark.md).

| Ruta | Contenido |
|---|---|
| `goal/bench.gc` | Funciones de Jak 2 (`matrix*!`, `sin`, `string=`) y bucles de medida, en GOAL |
| `native/goal_bench.cpp` | Arranca el kernel de Jak 2 (sin ISO), carga `bench.gc` y mide el x86 de `goalc` |
| `wasm/bench.wat` | Traducción a mano a wasm, como la emitiría un backend directo de `goalc` |
| `wasm/run.mjs` | Enlaza y mide un `.wasm` en Node (V8) |
| `ref/bench_ref.c` | Las mismas funciones en C (techo con LLVM, nativo y wasm) |
| `results/` | CSV de la última ejecución y desensamblado x86 de `goalc` |
| `run_all.sh` | Ejecuta todo |

## Reproducir

Requisitos: clang con `wasm-ld`, Node ≥ 22 y npm.

```sh
./run_all.sh 7          # wasm y C, sin la medida de goalc
```

Para la medida nativa de `goalc` hace falta un build de
[jak-project](https://github.com/open-goal/jak-project) (probado con `efb21c3`) con un target más.
Añade al final de `test/CMakeLists.txt`:

```cmake
add_executable(goal-bench /ruta/a/Jakompiled/bench/fase1/native/goal_bench.cpp
               ${CMAKE_CURRENT_LIST_DIR}/goalc/framework/test_runner.cpp)
target_link_libraries(goal-bench common runtime compiler gtest)
```

Después compila y ejecuta. Sin pantalla se pueden desactivar X11 y Wayland de SDL:

```sh
cmake --preset=Release-linux-clang -DSDL_X11=OFF -DSDL_WAYLAND=OFF -DSDL_UNIX_CONSOLE_BUILD=ON
ninja -C build/Release/bin goal-bench
JAK_PROJECT=/ruta/a/jak-project ./run_all.sh 7
```

Para obtener el desensamblado de `goalc`:

```sh
goalc --game jak2 --cmd '(begin (build-kernel) (asm-file "bench.gc" :color :disassemble "out.asm" :disasm-code-only))'
```
