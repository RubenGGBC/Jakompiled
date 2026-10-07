# Jakompiled: OpenGOAL (Jak II) en el navegador con WebAssembly

Idioma del proyecto: castellano (docs, mensajes, scripts). Código y comentarios de los parches de jak-project: inglés.

## Reglas que no se rompen

- **La ISO del usuario no se sube nunca**: ni a git, ni a ningún servidor, ni dentro del repo. Debe estar fuera de esta carpeta (p. ej. `~/isos/jak2.iso`). `.gitignore` ya excluye `*.iso`, `iso_data/` y `out/`, pero no la copies aquí.
- Tampoco se sube nada derivado de la ISO: texturas, objetos `raw_obj`, `.fr3`, DGO montados, capturas de registros con datos del juego.
- El servidor solo sirve el motor (compilado desde el código fuente). La extracción ocurre en el navegador y se guarda en OPFS.
- Commits con las líneas de coautoría que haya en uso en la rama; no hacer PR salvo que se pida.

## Estado (ver README.md y docs/)

| Pieza | Estado |
|---|---|
| Runtime (`gk`) en wasm, Chromium | ✅ fases 2–3 |
| Backend wasm de `goalc` | ✅ todo el código de Jak 2: 839 objetos, 18.475 funciones, 0 trampas; idéntico a x86 en 535 casos |
| Kernel GOAL, procesos (JSPI) | ✅ |
| Motor (`GAME.CGO`) en el navegador | ✅ hasta donde necesita datos de la ISO |
| Extracción de la ISO en el navegador (`extract.html`) | ✅ con la ISO real (NTSC v2.01, SCUS-97265): ~2,5 min, pico de 5,3 GB (extractor en wasm64) |
| Montaje de los DGO/CGO desde la ISO (`--web-build`) | ✅ los 150 que monta el build nativo (`game.gp`), 0 objetos sin encontrar |
| Runtime leyendo de OPFS | ✅ con la ISO real: carga `GAME.CGO`, los `.fr3` y llega a `play-boot!` |
| Renderer en WebGL 2 | ⚠️ pinta la pantalla de carga del juego (datos de la ISO); el juego se para antes del primer nivel |
| Input (teclado/mando), sonido | ❌ pendiente |

## Siguiente paso: el renderer llama a código GOAL desde el hilo de gráficos

Arreglado (parche 0021): las listas estáticas de los objetos wasm quedaban mal enlazadas (`lookup-level-info` se salía de la memoria). Ahora el motor carga el nivel `title`.

Fallo actual: en el primer fotograma, `OpenGLRenderer::dispatch_buckets_jak2` → `vif_interrupt_callback` (`game/kernel/common/kmachine.cpp`) → `call_goal` del handler VIF1 de GOAL (`vif1-handler`, `goal_src/jak2/engine/gfx/hw/display.gc`, instalado con `install-handler 5`). Ese código corre en el hilo de gráficos, pero los módulos wasm de GOAL, su tabla y `globalThis.jak` (sp/pp) solo existen en el worker del hilo EE → `TypeError ... reading 'sp'` en `js_get_sp` y `std::terminate`. Opciones: no llamar al handler en la web (solo hace profiling de buckets; comprobarlo) o reenviar la llamada al hilo EE.

Para ver excepciones JS dentro de los workers: CDP con pausa en excepciones (Chromium con `--remote-debugging-port=0` y el puerto leído de `DevToolsActivePort` de su propio perfil; nunca un puerto fijo, puede ser el Chrome del usuario).

Recompilar: `gk`/extractor con Docker `emscripten/emsdk:6.0.11`; `goalc-wasm` (y `KERNEL.CGO`, `CODE.PAK`, `GAME.CGO` con `backend/build_*.sh`) en una imagen Ubuntu 24.04 con clang, lld, cmake, ninja, nasm, python3, libssl-dev (en Windows los `.sh` del repo tienen CRLF: convertirlos dentro del contenedor).

Probar (la ISO va en `iso/`, ignorada por git; en Windows no hay WSL, se compila con Docker `emscripten/emsdk:6.0.11`):

```sh
cd listo-para-probar && node serve.mjs . 8080      # en otra terminal
# PROFILE: perfil persistente (un contexto efímero no tiene cuota de OPFS para 4 GB)
PROFILE=/tmp/perfil PLAYWRIGHT=$(npm root -g)/playwright/index.js node ../web/tests/test-flow.mjs   http://localhost:8080 ../iso/jak2.iso iso,extract,build "calling play-boot" 1800
```

Con `steps=build` (o `extract,build`) se repite solo una parte sobre lo que ya hay en OPFS. Para ver el juego: `http://localhost:8080/?boot=game&display=1`.

Lo aprendido con la ISO real:
- El descompilador necesita ~5,3 GB: el extractor se compila en wasm64 (`-DJAKOMPILED_MEMORY64=ON`, `build-web64/`); `gk` sigue en wasm32.
- Los tamaños de los `.fr3` y de la cabecera zstd van siempre en 8 bytes (antes dependían de `size_t`).
- Pendiente aparte: input (teclado/mando: falta `sdl_controller_db.txt`) y sonido.

## Estructura

- `patches/jak-project/` — parches sobre open-goal/jak-project `efb21c3` (aplicar con `git am`). Ahí está todo el C++: backend wasm (`goalc/wasm`, `IR_wasm.cpp`), runtime web (`web/*.cpp` dentro de jak-project), extractor web, capa GL.
- `web/` — páginas (`index.html`, `boot.js`, `extract.html`, `extract-worker.js`), `serve.mjs` (COOP/COEP), `build_runtime.sh` (compila todo desde cero: jak-project + parches, emsdk, Binaryen, goalc-wasm), `glsl_es.py`, tests.
- `backend/` — tests del backend (`test.sh`, oráculo x86), `test_runtime.sh` (Chromium), `build_kernel.sh`, `build_game.sh`, `build_code.sh` (CODE.PAK).
- `docs/` — plan y diario de cada fase.

Compilar desde cero necesita git, cmake, ninja, clang, nasm, python3 y emsdk 6.0.11 activo (en Windows, WSL).
