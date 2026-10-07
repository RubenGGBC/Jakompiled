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
| Extracción de la ISO en el navegador (`extract.html`) | ⚠️ probada solo con una ISO falsa |
| Montaje de los 168 DGO/CGO desde la ISO (`--web-build`) | ⚠️ probado solo con la ISO falsa |
| Runtime leyendo de OPFS | ✅ probado con la ISO falsa (`web/tests/test-flow.mjs`) |
| Renderer en WebGL 2 | ⚠️ arranca y compila los 92 shaders; sin datos no hay nada que pintar |
| Input (teclado/mando), sonido | ❌ pendiente |

## Siguiente paso: probar con la ISO real (NTSC-U, SCUS-97265)

Lo más rápido, sin compilar nada (`listo-para-probar/` ya está compilado):

```sh
cd listo-para-probar && node serve.mjs . 8080      # en otra terminal
# extracción en Chromium headless (Playwright) con la ISO, sin que salga del disco:
PLAYWRIGHT=$(npm root -g)/playwright/index.js node ../web/tests/test-flow.mjs \
  http://localhost:8080 /RUTA/A/jak2.iso iso,extract,build "link finish: texture-finish|GFX Loop" 3600
```

Requiere Node.js y Playwright (`npm i -g playwright && npx playwright install chromium`). O a mano: abrir `http://localhost:8080/extract.html` en Chrome, elegir la ISO y después `http://localhost:8080/?boot=game&display=1`.

Riesgos a vigilar con datos reales:
- Memoria del descompilador (wasm32: 4 GB). Si no cabe, descompilar por grupos de DGO.
- `dir-tpages`, texto del juego y montaje de DGO (`web/build_game_web.cpp`) solo se han probado sin datos.
- Presentación de frames del canvas (OffscreenCanvas + JSPI) y formatos de textura en WebGL 2 (`web/gl_web.cpp`).

## Estructura

- `patches/jak-project/` — parches sobre open-goal/jak-project `efb21c3` (aplicar con `git am`). Ahí está todo el C++: backend wasm (`goalc/wasm`, `IR_wasm.cpp`), runtime web (`web/*.cpp` dentro de jak-project), extractor web, capa GL.
- `web/` — páginas (`index.html`, `boot.js`, `extract.html`, `extract-worker.js`), `serve.mjs` (COOP/COEP), `build_runtime.sh` (compila todo desde cero: jak-project + parches, emsdk, Binaryen, goalc-wasm), `glsl_es.py`, tests.
- `backend/` — tests del backend (`test.sh`, oráculo x86), `test_runtime.sh` (Chromium), `build_kernel.sh`, `build_game.sh`, `build_code.sh` (CODE.PAK).
- `docs/` — plan y diario de cada fase.

Compilar desde cero necesita git, cmake, ninja, clang, nasm, python3 y emsdk 6.0.11 activo (en Windows, WSL).
