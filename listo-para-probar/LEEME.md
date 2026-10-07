# Jakompiled listo para probar

Esta carpeta tiene el motor ya compilado: el runtime de OpenGOAL (`gk.wasm`), el extractor (`extractor.wasm`) y todo el código del juego compilado a wasm desde el código fuente (`data/CODE.PAK`, `data/*.CGO`). **No contiene nada de la ISO ni datos del juego.** Esos salen de tu propia ISO, en tu navegador.

## Qué necesitas

- **Google Chrome** de escritorio, actualizado (o Edge).
- **Node.js** (versión LTS): <https://nodejs.org>. Solo hace de servidor local para servir esta carpeta con las cabeceras que necesita el navegador.
- Tu **ISO de Jak II NTSC-U** (SCUS-97265).
- Espacio libre en disco: unos **10 GB**. El navegador guarda los ficheros de la ISO y los datos extraídos en su almacenamiento privado.

## Pasos

### macOS

1. Descarga la carpeta `listo-para-probar` (o el repo entero).
2. Doble clic en `abrir-mac.command`. Si macOS no te deja abrirlo, haz clic derecho → Abrir, o en Terminal:
   ```sh
   cd ruta/a/listo-para-probar
   chmod +x abrir-mac.command
   ./abrir-mac.command
   ```
3. Se abre Chrome en `http://localhost:8080/extract.html`. Si se abre otro navegador, copia la dirección en Chrome.

### Windows

1. Descarga la carpeta `listo-para-probar` (o el repo entero).
2. Doble clic en `abrir-windows.bat`. Si Windows avisa ("Windows protegió su PC"): Más información → Ejecutar de todas formas.
3. Se abre el navegador en `http://localhost:8080/extract.html`. Si no es Chrome o Edge, copia la dirección en Chrome.

### En la página

1. Elige tu ISO. No se sube a ningún sitio: se lee desde tu disco.
2. Espera. Primero copia los ficheros de la ISO (barra de progreso) y luego descomprime los datos del juego. Puede tardar bastantes minutos. No cierres la pestaña.
3. Al terminar, verás **"Extracción terminada"** o un error.
4. **Copia todo el texto del registro** de la página (Ctrl+A / Cmd+A sobre él, o selecciónalo) y pégamelo. Si algo falla, con eso puedo arreglarlo.
5. Si la extracción terminó, abre en Chrome **`http://localhost:8080/?boot=game&display=1`**. El juego arranca con los datos extraídos de tu ISO (solo hace falta extraer una vez). Copia también ese registro y, si se ve algo en el recuadro negro, haz una captura.

Para parar el servidor, cierra la ventana negra (Terminal o símbolo del sistema).

## Si algo va mal

- *"Falta aislamiento cross-origin"*: has abierto el HTML directamente. Ábrelo con `abrir-mac.command` / `abrir-windows.bat`, desde `http://localhost:8080`.
- *"Falta Node.js"*: instálalo desde nodejs.org y vuelve a abrir el script.
- La pestaña se cierra o se queda sin memoria: dímelo con lo último que salió en el registro.
