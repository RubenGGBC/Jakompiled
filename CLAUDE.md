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
| Renderer en WebGL 2 | ⚠️ menús, escenario (tfrag/tie/shrub, 0025), sombras, efectos y mallas de personajes (merc, 0026; comprobado en Chrome con GPU: Jak se ve) |
| Teclado | ✅ parche 0024. Enter = Start, Espacio = X (confirmar), flechas = cruceta; New Game llega al aviso de guardado y carga los niveles de la cinemática inicial (`introcst`, `village1`, `ctyindb`, `prison`, `forexita`) sin errores |
| Sonido | ✅ parche 0028: cubeb sobre Web Audio (`web/cubeb_web.cpp`: hilo productor → búfer circular en la memoria de wasm → AudioWorklet); arranca con la primera tecla/clic (`[audio] running`). Probado por el usuario: suena bien |
| Mando | ❓ sin probar. El aviso de `sdl_controller_db.txt` no debería importar: SDL3 mapea los mandos con mapping "standard" del navegador |

## Continuación del 2026-10-08 (Windows)

- Rayas de partículas: no reproducidas en las secuencias capturadas en Chrome de Windows. La réplica CPU y transform feedback en GPU coinciden dentro del error numérico; `camera`, `hvdf_offset` y `pfog0` se leen de WebGL idénticos a los subidos, con error GL 0. No hay arreglo del shader confirmado. Diagnóstico y capturas en `web/work/`, ignorado; no distribuirlos.
- Rendimiento: 0030 sustituye la espera normal por `requestAnimationFrame` del worker y usa `MessageChannel` en las rutas sin pacing. El problema adicional era `Atomics.wait`: pedir 1 o 5 ms tarda ~15,6 ms en este Windows. Test de título antes: mediana 39,5 fps; después: 60,0 / 60,0 / 60,0. Cinco tests del reloj pasan. El log `[perf]` ahora incluye input, eventos, GUI, otros y ajustes efectivos. El modo avanzado de lag conserva su limitador.
- Solo cambian los binarios `gk`; no cambia CODE.PAK ni hace falta volver a extraer.
- El usuario autoriza continuar y ejecutar diagnósticos automáticos sin volver a pedir confirmación.
- Fibras corregidas en 0031 y verificadas sin ISO (160 procesos, cero fibras retenidas). Pendiente: recorrido más allá de la cárcel y mando físico si está disponible.

## Contexto anterior: rayas de las partículas 3D y rendimiento (40–47 fps)

**Rayas de colores ("glow bugeados")** en la pantalla de título (Jak transformándose, antorchas) y en el juego: triángulos larguísimos que salen en abanico desde un punto.
- Culpable aislado: renderer `particles` (Sprite3), **solo los sprites 3D** (`rendermode 3` en `sprite3_3d.vert`). Desactivando `m_3d_enable` la imagen sale limpia; ni merc, ni generic, ni glow, ni los sprites 2D.
- Descartado: los datos que llegan de GOAL están sanos (~190 sprites 3D por fotograma, |q|² ≤ 1, escalas normales; las entradas a cero son partículas libres que dan quads degenerados). `quaternion*!` y `quaternion-normalize!` (que usa `sp-process-block-3d`, mips2c) dan lo correcto en wasm: test `backend/tests/unit/quat.gc` (6/6). `xyz_array` son constantes (`sprite.gc`).
- Siguiente paso: replicar en CPU las cuentas del shader para un sprite 3D (camera, `hvdf_offset`, `pfog0`, `xyz_array[vert_id]`) y ver si alguna esquina sale disparada (w ≈ 0 o negativo) ya en las cuentas o solo en la GPU. Sospechas: diferencia de clipping (la capa web ignora `GL_DEPTH_CLAMP`; el "hack" `transformed.xyz *= transformed.w`), o un uniform que en WebGL no llega (comprobar con `glGetError` tras los `glUniform*` de `render_2d_group0`).
- Cómo se aisló (código quitado, está en el historial de esta sesión): `?off=a,b` en la URL → `boot.js` pone `Module.jakompiledOff` → `OpenGLRenderer` (tras `init_bucket_renderers_*`) lo lee con `MAIN_THREAD_EM_ASM` + `stringToUTF8` y desactiva los renderers cuyo nombre contiene a o b; en `Sprite3::render`, claves `s-3d`, `s-2d`, `s-glow` para sus flags. Capturas con `web/tests/play.mjs` (`QUERY=&off=...`, `wait:enter ctysluma,sleep:15,shot:t1`: la pantalla de título sale ~15 s después de `GAMEPLAY: enter ctysluma`; la captura es solo del canvas).
- 0029 arregla otro fallo real del glow: el depth buffer se muestreaba con `GL_LINEAR` (en GLES 3.0 la textura queda incompleta y se lee 0) y todos los glows se veían aunque hubiera algo delante. No era la causa de las rayas.

**Rendimiento**: 0029 saca cada 5 s en la consola `[perf] fps | wait-for-ee (ee), render, limiter, swap, worst frame`. En la pantalla de título (Chrome de Playwright): ~47 fps, `wait-for-ee 0.0 (ee 0.8)`, `render 4.3`, `limiter 0.3`, `swap 5.6`, peor fotograma ~35 ms. Conclusiones: el código GOAL no es el cuello de botella; `swap` (el `emscripten_sleep(0)` de `SDL_GL_SwapWindow`: `setTimeout` encadenado, Chrome lo alarga a ≥4 ms) se come 5,6 ms; y las partes medidas suman ~11 ms de ~21 ms: falta medir el resto del bucle (`process_sdl_events` con `emscripten_current_thread_process_queued_calls`, imgui, polling de input). Ideas: sincronizar con `requestAnimationFrame` del worker en vez de `setTimeout(0)`, y quitar `-sASSERTIONS=1` del enlazado de `gk`.

## Después: jugar más allá de la cárcel y anotar lo que falle (y probar el mando)

Los personajes no se veían porque el loader sube los índices de merc (y hfrag) con el buffer de índices enlazado a `GL_ARRAY_BUFFER`; WebGL 2 no deja enlazar un element array buffer a otro target, así que los índices iban al buffer de vértices y los de índices quedaban a cero (0026: `gl_web.cpp` lo enlaza a `GL_COPY_WRITE_BUFFER`). Descartado por el camino: los modelos sí están en los `.fr3` y se cargan (`ldjakbrn` tiene `jak-highres-prison`), las matrices de huesos que lee Merc2 de la memoria de GOAL son correctas, y el `ERROR: ... could not find a master slot to link` es ruido: `link-art!` se llama dos veces para el mismo art group y la segunda vez la animación ya está enlazada.

Errores de WebGL: ninguno desde el arranque hasta la cárcel (0027 quitó los del glow y los `texParameter` de EyeRenderer). Solo quedan avisos de rendimiento por `ReadPixels`.

Arreglado en esta sesión:
- 0022: el renderer simulaba la interrupción VIF1 llamando a código GOAL desde el hilo de gráficos (donde no existen los módulos wasm). En jak2 ese handler solo hace profiling de buckets: en la web no se llama.
- 0023: la compactación del heap de procesos mueve procesos (y sus `cpu-thread`) mientras están suspendidos; el kernel web guardaba la fibra JSPI por dirección del hilo y la perdía (`thread-resume: thread ... has no suspended stack`). Ahora `relocate` de `cpu-thread` llama a `jakompiled-thread-relocate` (cambia código GOAL: hay que recompilar CODE.PAK y volver a montar los DGO con `steps=build`).
- 0029: texturas de profundidad con `GL_NEAREST` (glow) y el log `[perf]`.
- 0028: sonido por Web Audio (ver la tabla).
- 0024: el bucle de gráficos no vuelve al event loop del worker; procesa en cada fotograma las llamadas que el navegador le reenvía (teclado de SDL).
- 0027: sin errores de WebGL hasta la cárcel: la textura de profundidad del glow se crea como `GL_DEPTH24_STENCIL8` (el blit exige el mismo formato que el framebuffer) y se ignoran los `glTexParameter` sin textura enlazada (EyeRenderer).
- 0026: índices de merc y hfrag (ver arriba).
- 0025: los vertex shaders de tfrag/tie/shrub/hfrag declaran el índice de color como `int` y el renderer lo pasa sin signo: WebGL 2 rechazaba todos sus draws. `web/glsl_es.py` los declara sin signo en las versiones GLSL ES (`UNSIGNED_ATTRIBUTES`); `gl_web.cpp` traduce `GL_UNSIGNED_INT_8_8_8_8` y los formatos internos sin tamaño (`GL_RED`, `GL_RG`, `GL_DEPTH_COMPONENT`).

Corregido en 0031: `deactivate` libera la fibra JSPI y su pila C cuando otro proceso la mata suspendida; la autodesactivación conserva su pila hasta ThreadExit. Prueba de 160 procesos: 160 fibras retenidas antes, cero después. Regresión suspend/catch/estados correcta. Recompilados runtime, CODE.PAK, KERNEL.CGO y GAME.CGO; reconstruir DGO en OPFS con `steps=build` para actualizar el kernel del juego.

Depurar el renderer:
- Los errores de WebGL salen en la consola del worker que tiene el OffscreenCanvas, no en la de la página. Con CDP: `Target.setAutoAttach` a nivel de navegador (`flatten`; navegar de `about:blank` a la página con COOP/COEP cambia de proceso y de target) y `Log.enable` en cada sesión; Chrome solo imprime los 32 primeros errores por contexto.
- Para saber qué renderer falla: envolver en `gl_web.cpp` `glUseProgram`/`glDrawElements`/`glDrawArrays` y contar draws y `glGetError` por shader (nombre desde `Shader::Shader`). Se usó y se quitó; está en el historial de esta sesión, no en el repo.
- Teclas por defecto: Enter = Start, Espacio = X, flechas = cruceta, WASD = stick izquierdo. Para llegar a la cárcel: Enter, Espacio (New Game), Espacio (aviso de guardado) y esperar. Con Playwright: el input lee el estado del teclado una vez por fotograma, así que hay que mantener la tecla pulsada ~1,5 s, y conviene guiarse por la consola (`Load soundbank menu1` = menú abierto, `introcst` = partida empezada) en vez de por tiempos.
- `web/tests/play.mjs` juega con un guion (`wait:`, `key:`, `shot:`, `audio`) sobre un perfil ya extraído. El usuario autoriza ahora las sesiones automáticas de diagnóstico y pruebas (08/10/2026); usar perfiles propios, sin tocar su Chrome personal.
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
- Pendiente aparte: probar el mando.

## Estructura

- `patches/jak-project/` — parches sobre open-goal/jak-project `efb21c3` (aplicar con `git am`). Ahí está todo el C++: backend wasm (`goalc/wasm`, `IR_wasm.cpp`), runtime web (`web/*.cpp` dentro de jak-project), extractor web, capa GL.
- `web/` — páginas (`index.html`, `boot.js`, `extract.html`, `extract-worker.js`), `serve.mjs` (COOP/COEP), `build_runtime.sh` (compila todo desde cero: jak-project + parches, emsdk, Binaryen, goalc-wasm), `glsl_es.py`, tests.
- `backend/` — tests del backend (`test.sh`, oráculo x86), `test_runtime.sh` (Chromium), `build_kernel.sh`, `build_game.sh`, `build_code.sh` (CODE.PAK).
- `docs/` — plan y diario de cada fase.

Compilar desde cero necesita git, cmake, ninja, clang, nasm, python3 y emsdk 6.0.11 activo (en Windows, WSL).

Pruebas de continuación: `web/tests/test-web-frame-clock.mjs` (5 casos), `test-frame-pacing.mjs` (ISO en PROFILE), `test-fiber-cleanup.mjs` (kernel con `backend/tests/runtime/fiber-cleanup.gc`, sin ISO). Parches 0030 y 0031.

Validación del 0031 con ISO real: DGO reconstruidos correctamente, título e introducción a 60 fps; en la cárcel, múltiples ventanas estables de 60 fps, movimiento, golpe, salto y muerte/reaparición por teclado sin excepciones registradas. AudioContext activo. Ningún mando conectado (`getGamepads`: cuatro entradas vacías). El recorrido completo más allá de la cárcel sigue pendiente.
