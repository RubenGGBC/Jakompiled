# Extracción de la ISO en el navegador

> **Estado: probada con una ISO real de Jak II NTSC v2.01 (SCUS-97265).** Extracción en el navegador en unos 2,5 minutos, con un pico de memoria de 5,3 GB y extractor wasm64. El montaje sigue `game.gp`: 150 DGO/CGO, sin objetos faltantes. El runtime lee los datos desde OPFS y llega a la cárcel.
>
> Las pruebas con ISO sintética descritas abajo son anteriores y sirven para comprobar ISO9660 y OPFS sin datos del juego.

En el plan esta tarea estaba en la fase 5. La adelanto porque es lo que separa el motor, que ya corre en el navegador (fase 3.6), de los datos del juego.

## Reglas

Del plan: *"OpenGOAL exige que cada usuario use su propia ISO"*, *"el usuario sube su ISO, y la extracción y los datos se quedan en su navegador (OPFS)"*, *"nunca se alojan ni la ISO ni los assets derivados"*.

- La ISO se lee en el navegador con la API `File`. No hay ninguna petición de red con su contenido.
- Todo lo que sale de ella va al **Origin Private File System** (OPFS) de la página: almacenamiento local, privado y por origen.
- El servidor solo sirve el motor: HTML, JS, `gk.wasm`, `extractor.wasm` y `KERNEL.CGO`/`GAME.CGO`, compilados desde el código fuente.

## Cómo funciona

```
extract.html ── File de la ISO ──▶ extract-worker.js (Worker)
                                    1. ISO9660 → OPFS /iso_data/jak2/...
                                    2. extractor.wasm (WasmFS + OPFS)
                                         validar → descompilar → OPFS /decompiler_out, /out
```

1. **Lectura de la ISO** ([`web/extract-worker.js`](../web/extract-worker.js)): recorre el ISO9660 igual que `common/util/read_iso_file.cpp`, incluido el cambio de nombre `WATER_AN.CGO` → `WATER-AN.CGO`. Escribe cada fichero en OPFS por fragmentos de 16 MB con `FileSystemSyncAccessHandle`. La ISO no se copia entera: se leen solo los rangos de cada fichero.
2. **Extractor** (`extractor.wasm`): es `decompiler/extractor/main.cpp` de OpenGOAL, compilado con Emscripten, sin los pasos de compilar y jugar. El código del juego ya está compilado a wasm desde el código fuente. Se ejecuta con `-g jak2 -f -e -d`: valida contra la base de datos de versiones y descompila los datos (texturas, objetos, niveles `.fr3`).
3. **Sistema de ficheros**: usa WasmFS con el backend OPFS, para que los GB de datos estén en disco y no en memoria ([`web/extract_web.cpp`](../web/extract_web.cpp)):

| Ruta en el módulo | Dónde está |
|---|---|
| `/data` | Proyecto: configuración del descompilador y assets de texturas de OpenGOAL, incrustados en el módulo (12 MB, sin datos del juego) |
| `/data/iso_data` | OPFS `/iso_data`: ficheros de la ISO |
| `/data/decompiler_out` | OPFS `/decompiler_out`: salida del descompilador |
| `/data/out` | OPFS `/out`: niveles `.fr3` para los renderers de PC |
| `/data/log` | OPFS `/log`: registros del extractor |

### Lo que hubo que cambiar para compilarlo

| Problema | Arreglo |
|---|---|
| `xdelta3` asumía `size_t` de 8 bytes (en wasm32 es de 4) | `SIZEOF_SIZE_T` lo da el compilador; `ObjectFileDB` usa `usize_t` para los tamaños de xdelta |
| `tiny_gltf` sustituye `CMAKE_CXX_FLAGS` por `-O3` y perdía `-pthread` | Se le añaden las opciones web al objetivo |
| CMake deduplica opciones repetidas como `--embed-file` | Forma `SHELL:` |
| `/data` incrustado es de solo lectura y el registro quiere `/data/log` | `log` también va a OPFS |
| Las pthreads del módulo cargaban `extract-worker.js` en vez de `extractor.js` | `mainScriptUrlOrBlob` |
| Al proponer una entrada nueva para la base de datos de versiones, el formato tenía 4 campos y 3 argumentos (error de OpenGOAL, también en nativo) | Corregido |

## Montaje de los ficheros del juego

Después de descompilar, el extractor (`--web-build`, [`web/build_game_web.cpp`](../patches/jak-project/0014-jakompiled-web-extractor-build-the-game-s-DGO-CGO-an.patch)) hace lo que `goalc` hace con `(mi)` en el build nativo, salvo compilar código:

| Fichero | De dónde sale |
|---|---|
| `dir-tpages.go` | Compilador de datos de `goalc`, desde la salida del descompilador |
| `*COMMON.TXT` (texto del juego) | Ídem, con `game_text.txt` del descompilador y los JSON del proyecto |
| `*SUBTI2.TXT` (subtítulos) | Ídem, con los JSON del proyecto |
| Los 150 DGO/CGO seleccionados por `goal_src/jak2/game.gp` | Código: `CODE.PAK`, servido con la página. Datos: `raw_obj` del descompilador (tu ISO) |

`CODE.PAK` ([`backend/build_code.sh`](../backend/build_code.sh)) contiene **todo el código del juego compilado a wasm**: kernel, motor y niveles, **839 objetos y 18.475 funciones, sin ninguna trampa**, 21 MB. Se compilan en el orden de `goal_src/jak2/game.gp` ([`backend/code_sources.py`](../backend/code_sources.py)).

Los nombres dentro de cada DGO siguen las reglas de la herramienta `dgo` de `goalc`: sin `.o`, sin `.go` y, en los art groups, sin `-ag.go`.

## El runtime lee de OPFS

`gk` también usa WasmFS ([parche 0015](../patches/jak-project/0015-jakompiled-web-runtime-WasmFS-OPFS-play-from-the-ext.patch)). Al arrancar, si OPFS tiene una ISO extraída, `out/jak2/iso` se llena de enlaces a:
- los DGO/CGO y textos montados en el navegador;
- los ficheros de la ISO que el build nativo copia ahí (`STR`, `SBK`, `MUS`, `VAG`, `SCREEN1.*`): se enlazan, no se copian.

Además, `out/jak2/fr3` apunta a los niveles extraídos. Sin ISO extraída, se usan los CGO servidos con la página. El enlace del directorio de usuario a OPFS puede fallar si WasmFS ya creó `/home/web_user`. Desde 0032 las partidas se persisten explícitamente en localStorage y se restauran al arrancar, independientemente de ese enlace.

Prueba del flujo completo en una misma sesión del navegador ([`web/tests/test-flow.mjs`](../web/tests/test-flow.mjs)), con la ISO de prueba:

```
[warn] GAME.CGO: no code object collide-planes.o (not in CODE.PAK)     ← igual que en nativo
[build] 168 DGO/CGO files, 1828 missing objects                         ← los datos que no tiene la ISO de prueba
[jakompiled] game files: the extracted ISO in OPFS (191 files)
[Load and Link DGO From C (fast)] game
got 436 objects, name GAME.CGO
link finish: texture-upload
```

## Prueba sin ISO

[`web/tests/make_test_iso.py`](../web/tests/make_test_iso.py) crea una ISO con la forma de la de Jak II (`SYSTEM.CNF`, `SCUS_972.65`, `DGO/`, `CGO/`) pero con contenido inventado. [`web/tests/test-extract.mjs`](../web/tests/test-extract.mjs) la elige en la página desde Chromium headless y lista OPFS al terminar:

```
[iso] 5 ficheros, 0.02 GB
[iso] extraída en 0.2 s
[info] Extracting ISO to temporary dir at: /data/iso_data/_temp
[error] ELF Hash '15259909539989834962' not found in the validation database ...
[warn] unable to determine game version from buildinfo.json file, defaulting to Jak 1 ...
[opfs]
/iso_data/jak2/CGO/BIG.CGO 20971520 1895809952        ← suma idéntica a la del original
/iso_data/jak2/CGO/WATER-AN.CGO 5000 2187459          ← renombrado como en C++
/iso_data/jak2/buildinfo.json 77 18149                ← escrito por el extractor (WasmFS → OPFS)
/log/extractor.2026-10-07T18-30-36.log 901 283011
```

Es el mismo resultado que daría el extractor nativo con esa ISO.

## Probar con tu ISO

1. Compila y monta la web (Linux o macOS; en Windows, WSL): `web/build_runtime.sh`. Necesita git, cmake, ninja, clang, nasm, python3 y emsdk activo.
2. Sirve la página: `node web/serve.mjs web/dist 8080` (pone las cabeceras COOP/COEP).
3. Abre `http://localhost:8080/extract.html` en Chrome de escritorio y elige tu ISO de Jak II (NTSC-U, SCUS-97265).
4. Al terminar, copia el registro de la página. Si algo falla, el registro completo también está en OPFS (`/log`).
5. Abre `http://localhost:8080/?boot=game&display=1`: el juego arranca con los datos extraídos.

## Riesgos pendientes

- **Memoria**: la ISO real supera el límite de 4 GB de wasm32; se usa el extractor wasm64 (pico medido de 5,3 GB). El runtime sigue en wasm32.
- **Tiempo**: el extractor nativo tarda unos minutos. En wasm será algo más lento; la extracción solo se hace una vez.
- **Cobertura**: el montaje con datos reales está probado hasta la cárcel; falta validar el resto de niveles durante el juego.
