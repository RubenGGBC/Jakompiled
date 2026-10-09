# Plan: Jak 3 en WebAssembly

Punto de partida (2026-10-09): Jak 2 funciona en el navegador de principio a fin con la ISO del usuario (extracción, DGO, renderer WebGL 2, teclado, sonido, guardado). Casi todo lo construido es común a los juegos de OpenGOAL; este plan es lo que falta para Jak 3.

## Medición inicial

Todo el código de Jak 3 compilado con el backend wasm actual (`goalc-wasm --game jak3`, parches 0001–0032), en el orden de `goal_src/jak3/game.gp`:

| | Jak 2 | Jak 3 |
|---|---:|---:|
| Objetos de código | 839 | **1.033** (todos compilan) |
| DGO/CGO | 168 (150 en `game.gp`) | 274 |
| Funciones que caen en trampa | 0 | **1.450** |
| Tiempo de compilación | 51 s | 63 s |

Causas de las 1.450 trampas:

| Funciones | Causa | Arreglo |
|---:|---|---|
| 1.438 | El macro `suspend` (`gkernel-h.gc`) y `gstate.gc` leen `rsp` para comprobar el tamaño de la pila | El mismo que en Jak 2 (parche 0008): en wasm se omite la comprobación; `thread-suspend` ya la hace |
| 8 | `asm-func` del kernel: `thread-resume`, `thread-suspend`, `set-to-run-bootstrap`, `return-from-thread(-dead)`, `reset-and-call`, `new catch-frame`, `throw-dispatch` | Versiones `INSTRUCTION_SET 'wasm` como las de Jak 2, sobre las mismas primitivas `jakompiled-*` |
| 4 | Variables fijadas a `r15` (base de la memoria GOAL) | Revisar uno a uno (en Jak 2 no aparecieron) |

## Qué es común y qué es de Jak 2

Ya sirve para Jak 3 sin cambios (o casi):
- Backend wasm de `goalc` completo (vf/SIMD128, 128 bits, ABI, objetos, `--debug-calls`).
- Runtime: JSPI y fibras, excepciones, adaptadores `GOAL_C_FN` (Jak 3 ya está convertido en `kscheme`/`kmachine`), mips2c (tabla común; 28 funciones de Jak 3), `nothing`/`zero-func`, WasmFS + OPFS (`runtime_fs_web.cpp` recibe el juego), sonido (cubeb sobre Web Audio), ritmo de fotogramas, guardado.
- Capa WebGL 2 (`gl_web.cpp`) y traductor de shaders (`glsl_es.py` ya genera por juego).
- Extractor en wasm64 y montaje de DGO (falta parametrizar el juego).

Específico de Jak 2 que hay que generalizar o portar:

| Pieza | Dónde | Trabajo |
|---|---|---|
| Enlace de módulos wasm al cargar un objeto | hook en `jak2::klink` (`link_wasm_object`) | Mismo hook en `jak3::klink` |
| Símbolos (`jakompiled_intern`), primitivas `jakompiled-*`, `return-from-thread-dead` | `goal_wasm_link.cpp`, `goal_kernel_web.cpp` (llaman a `jak2::`) | Elegir según `g_game_version` |
| Funciones C con `arg3_is_pp` (`new` de basic, `method-set!`...) | Adaptadores en `jak2/kscheme.cpp` | Los mismos en `jak3/kscheme.cpp` (o sacarlos a un fichero común) |
| Kernel GOAL (`gkernel.gc`, `gkernel-h.gc`, `gstate.gc`) | parches 0008 y 0023 para `goal_src/jak2/kernel` | Portar a `goal_src/jak3/kernel` (incluido `jakompiled-thread-relocate`) |
| Interrupción VIF1 simulada | 0022, solo Jak 2 | Comprobar qué hace el handler de Jak 3 |
| Scripts | `code_sources.py`, `build_code.sh`, `build_kernel.sh`, `build_game_web.cpp` (`kGame = "jak2"`), embebidos del extractor (`decompiler/config/jak2`, `game/assets/jak2`, `dgos`) | Parámetro de juego en todos |
| Páginas | `boot.js` y `extract.html` asumen `-g jak2` | `?game=jak3`, y la extracción detecta el juego por el serial de la ISO |

## Fases

### J3-1. Código y kernel (sin ISO)
1. `suspend`/`gstate` y las 8 `asm-func` en `goal_src/jak3/kernel` (`#cond` de `INSTRUCTION_SET 'wasm`), revisar los 4 casos de `r15`.
2. Objetivo medible: **1.033 objetos, 0 trampas**.
3. Pruebas: los tests de procesos (`backend/tests/runtime/procs.gc`) con el kernel de Jak 3; oráculo x86 con `--game jak3` para `basic.gc` y `simd.gc`.

### J3-2. Runtime (sin ISO)
1. Hook de klink, símbolos y primitivas por juego, adaptadores `arg3_is_pp` en Jak 3.
2. `build_code.sh`/`build_kernel.sh`/`build_game.sh` con `GAME=jak3`; `CODE.PAK` de Jak 3.
3. Objetivo medible: con `?game=jak3&boot=game`, `KERNEL.CGO` y `GAME.CGO` de Jak 3 enlazan y ejecutan en Chromium hasta el primer objeto que necesita datos de la ISO (como 3.6 en Jak 2).

### J3-3. Extracción (con la ISO de Jak 3, en local)
1. Extractor con la configuración de Jak 3 (`decompiler/config/jak3`, 5,6 MB) y sus assets; `--web-build` con los 274 `.gd`.
2. Vigilar memoria y tiempo: Jak 3 es más grande que Jak 2 (pico de 5,3 GB en Jak 2 con el extractor wasm64).
3. Objetivo: todos los DGO de `game.gp` de Jak 3 montados con 0 objetos sin encontrar, y el runtime llega a `play-boot`.

### J3-4. Gráficos y juego (con la ISO, en local)
1. Shaders: `glsl_es.py ... jak3` y `test-shaders.mjs` (mismos valores de `HEIGHT_SCALE`/`SCISSOR` que Jak 2).
2. `init_bucket_renderers_jak3`: renderers propios de Jak 3 que Jak 2 no ejercitaba. El plan original nombraba `hfrag` y `prim`. Ir pantalla a pantalla como en Jak 2: título → menú → primera cinemática → Haven/desierto.
3. Overlord de Jak 3 (`game/overlord/jak3`, sistema de ISO y sonido distinto del de Jak 2): música y streaming.
4. Revisar las animaciones de texturas de Jak 3 (`TextureAnimator`) y el VIF1.

### J3-5. Pulido
Rendimiento (Jak 3 es más pesado), mando, guardado, y una página que permita elegir juego (Jak 2 / Jak 3) con una ISO extraída de cada uno.

## Estimación honesta

- **J3-1 y J3-2**: casi todo es portar lo que ya existe para Jak 2. Unos días de trabajo, sin ISO.
- **J3-3 y J3-4**: dependen de probar con la ISO real. En Jak 2 el grueso de los arreglos salió al ver el juego en marcha (índices de merc, glow, fibras al compactar el heap). Para Jak 3, razonablemente **una a tres semanas** de iteraciones, según cuántos renderers o sistemas nuevos fallen.
- Riesgo principal: memoria del extractor y renderers específicos de Jak 3.

## Lo que hace falta del usuario

- Su ISO de **Jak 3** (NTSC-U, SCUS-97330 es la mejor soportada por OpenGOAL), en su máquina. Las mismas reglas que con Jak 2: no se sube a ningún sitio.
- Las fases J3-3 y J3-4 se hacen en local con Claude Code, como la prueba de Jak 2.
