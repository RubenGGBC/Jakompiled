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
| Renderer en WebGL 2 | ⚠️ menús, escenario (tfrag/tie/shrub, 0025), sombras, efectos y mallas de personajes (merc, 0026). Por comprobar en un navegador con GPU: si los personajes salen bien (en SwiftShader algunos merc salen como cajas rosas planas: ¿textura?) |
| Teclado | ✅ parche 0024. Enter = Start, Espacio = X (confirmar), flechas = cruceta; New Game llega al aviso de guardado y carga los niveles de la cinemática inicial (`introcst`, `village1`, `ctyindb`, `prison`, `forexita`) sin errores |
| Mando, sonido | ❌ pendiente (mando: falta `sdl_controller_db.txt`; sonido: `Cubeb init failed`) |

## Siguiente paso: comprobar los personajes y los errores de WebGL que quedan

Los personajes no se veían porque el loader sube los índices de merc (y hfrag) con el buffer de índices enlazado a `GL_ARRAY_BUFFER`; WebGL 2 no deja enlazar un element array buffer a otro target, así que los índices iban al buffer de vértices y los de índices quedaban a cero (0026: `gl_web.cpp` lo enlaza a `GL_COPY_WRITE_BUFFER`). Descartado por el camino: los modelos sí están en los `.fr3` y se cargan (`ldjakbrn` tiene `jak-highres-prison`), las matrices de huesos que lee Merc2 de la memoria de GOAL son correctas, y el `ERROR: ... could not find a master slot to link` es ruido: `link-art!` se llama dos veces para el mismo art group y la segunda vez la animación ya está enlazada.

Errores de WebGL que quedan (en la cárcel): `texParameter: no texture bound to target` (cientos), `glBlitFramebuffer: Depth/stencil buffer format combination not allowed for blit` (glow, cientos). Chrome deja de informar tras 32 errores por contexto: arreglar estos para ver si hay más detrás.

Arreglado en esta sesión:
- 0022: el renderer simulaba la interrupción VIF1 llamando a código GOAL desde el hilo de gráficos (donde no existen los módulos wasm). En jak2 ese handler solo hace profiling de buckets: en la web no se llama.
- 0023: la compactación del heap de procesos mueve procesos (y sus `cpu-thread`) mientras están suspendidos; el kernel web guardaba la fibra JSPI por dirección del hilo y la perdía (`thread-resume: thread ... has no suspended stack`). Ahora `relocate` de `cpu-thread` llama a `jakompiled-thread-relocate` (cambia código GOAL: hay que recompilar CODE.PAK y volver a montar los DGO con `steps=build`).
- 0024: el bucle de gráficos no vuelve al event loop del worker; procesa en cada fotograma las llamadas que el navegador le reenvía (teclado de SDL).
- 0026: índices de merc y hfrag (ver arriba).
- 0025: los vertex shaders de tfrag/tie/shrub/hfrag declaran el índice de color como `int` y el renderer lo pasa sin signo: WebGL 2 rechazaba todos sus draws. `web/glsl_es.py` los declara sin signo en las versiones GLSL ES (`UNSIGNED_ATTRIBUTES`); `gl_web.cpp` traduce `GL_UNSIGNED_INT_8_8_8_8` y los formatos internos sin tamaño (`GL_RED`, `GL_RG`, `GL_DEPTH_COMPONENT`).

Pendiente conocido: las fibras de procesos que mueren mientras están suspendidos no se liberan (256 KB de pila C cada una) salvo que otro hilo reutilice la dirección.

Depurar el renderer:
- Los errores de WebGL salen en la consola del worker que tiene el OffscreenCanvas, no en la de la página. Con CDP: `Target.setAutoAttach` a nivel de navegador (`flatten`; navegar de `about:blank` a la página con COOP/COEP cambia de proceso y de target) y `Log.enable` en cada sesión; Chrome solo imprime los 32 primeros errores por contexto.
- Para saber qué renderer falla: envolver en `gl_web.cpp` `glUseProgram`/`glDrawElements`/`glDrawArrays` y contar draws y `glGetError` por shader (nombre desde `Shader::Shader`). Se usó y se quitó; está en el historial de esta sesión, no en el repo.
- Teclas por defecto: Enter = Start, Espacio = X, flechas = cruceta, WASD = stick izquierdo. Para llegar a la cárcel: Enter, Espacio (New Game), Espacio (aviso de guardado) y esperar. Con Playwright: el input lee el estado del teclado una vez por fotograma, así que hay que mantener la tecla pulsada ~1,5 s, y conviene guiarse por la consola (`Load soundbank menu1` = menú abierto, `introcst` = partida empezada) en vez de por tiempos.
- Para mirar dentro de OPFS (tamaños de los `.fr3`, logs del extractor en `/log`): una página del mismo origen con `navigator.storage.getDirectory()`.
- Trazas temporales en GOAL (p. ej. `format 0` en `link-art!`): recompilar CODE.PAK (~10 min emulado), copiarlo a `listo-para-probar/data` y volver a montar los DGO (`steps=build`). Restaurar el CODE.PAK limpio después (se puede comprobar con `cmp` contra el de git).
- Para regenerar los shaders: `python3 web/glsl_es.py glslang spirv-cross <jak-project>/game/graphics/opengl_renderer/shaders <jak-project>/game/graphics/opengl_renderer/shaders_es/jak2 jak2` en un Ubuntu con `glslang-tools` y `spirv-cross`.

Para ver excepciones JS dentro de los workers: CDP con pausa en excepciones (Chromium con `--remote-debugging-port=0` y el puerto leído de `DevToolsActivePort` de su propio perfil; nunca un puerto fijo, puede ser el Chrome del usuario).

Recompilar: `gk`/extractor con Docker `emscripten/emsdk:6.0.11` (instalar `ninja-build` dentro); `goalc-wasm` (y `KERNEL.CGO`, `CODE.PAK`, `GAME.CGO` con `backend/build_*.sh`, el GAME.CGO servido con `EMPTY_TPAGE_DIR=1`) en una imagen Ubuntu 24.04 con clang, lld, cmake, ninja, nasm, python3, libssl-dev (en Windows los `.sh` del repo tienen CRLF: convertirlos dentro del contenedor). En un Mac con Apple Silicon la imagen tiene que ser `--platform linux/amd64` (en aarch64 el CMake de jak-project pasa `-mavx`); `goalc-wasm` enlaza con `.so` por RPATH absoluto, así que hay que montar el árbol en la misma ruta al compilarlo y al usarlo. El árbol de trabajo (jak-project + parches) va en `web/work/`, ignorado por git.

Probar (la ISO va en `iso/`, ignorada por git; en Windows no hay WSL, se compila con Docker `emscripten/emsdk:6.0.11`):

```sh
cd listo-para-probar && node serve.mjs . 8080      # en otra terminal
# PROFILE: perfil persistente (un contexto efímero no tiene cuota de OPFS para 4 GB)
# CHANNEL=chrome: usa el Chrome instalado (con el perfil de PROFILE, no el del usuario)
PROFILE=/tmp/perfil PLAYWRIGHT=$(npm root -g)/playwright/index.js node ../web/tests/test-flow.mjs   http://localhost:8080 ../iso/jak2.iso iso,extract,build "calling play-boot" 1800
```

Con `steps=build` (o `extract,build`) se repite solo una parte sobre lo que ya hay en OPFS. Para ver el juego: `http://localhost:8080/?boot=game&display=1`.

Lo aprendido con la ISO real:
- El descompilador necesita ~5,3 GB: el extractor se compila en wasm64 (`-DJAKOMPILED_MEMORY64=ON`, `build-web64/`); `gk` sigue en wasm32.
- Los tamaños de los `.fr3` y de la cabecera zstd van siempre en 8 bytes (antes dependían de `size_t`).
- Pendiente aparte: mando (falta `sdl_controller_db.txt`) y sonido.

## Estructura

- `patches/jak-project/` — parches sobre open-goal/jak-project `efb21c3` (aplicar con `git am`). Ahí está todo el C++: backend wasm (`goalc/wasm`, `IR_wasm.cpp`), runtime web (`web/*.cpp` dentro de jak-project), extractor web, capa GL.
- `web/` — páginas (`index.html`, `boot.js`, `extract.html`, `extract-worker.js`), `serve.mjs` (COOP/COEP), `build_runtime.sh` (compila todo desde cero: jak-project + parches, emsdk, Binaryen, goalc-wasm), `glsl_es.py`, tests.
- `backend/` — tests del backend (`test.sh`, oráculo x86), `test_runtime.sh` (Chromium), `build_kernel.sh`, `build_game.sh`, `build_code.sh` (CODE.PAK).
- `docs/` — plan y diario de cada fase.

Compilar desde cero necesita git, cmake, ninja, clang, nasm, python3 y emsdk 6.0.11 activo (en Windows, WSL).
