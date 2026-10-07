# Extracción de la ISO en el navegador

> **Estado: lista para probar con una ISO real.** Con una ISO de prueba (sin datos del juego), la página lee el sistema de ficheros ISO9660, copia los ficheros a OPFS byte a byte y arranca el extractor de OpenGOAL compilado a wasm. El extractor valida la versión y se detiene porque el ejecutable de la ISO de prueba no es el de Jak II. Falta comprobar la descompilación con la ISO real, que solo puede hacerse en la máquina del usuario.

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

## Riesgos pendientes

- **Memoria**: el descompilador carga todos los DGO a la vez. En wasm32 el límite es 4 GB. Si no cabe, se descompilará por grupos de DGO (la configuración permite limitar las entradas).
- **Tiempo**: el extractor nativo tarda unos minutos. En wasm será algo más lento; la extracción solo se hace una vez.
- **Siguiente paso**: montar los DGO del juego (código wasm del servidor + datos de OPFS) y que el runtime lea de OPFS.
