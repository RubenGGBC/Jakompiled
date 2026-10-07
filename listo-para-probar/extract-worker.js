// Jakompiled: extracción de la ISO del usuario, dentro de un Worker.
//
//  1. Lee el sistema de ficheros ISO9660 directamente del File elegido por el usuario y escribe
//     cada fichero en OPFS (/iso_data/jak2/...), como hace common/util/read_iso_file.cpp.
//     La ISO no se copia entera ni sale del navegador.
//  2. Ejecuta el extractor de OpenGOAL compilado a wasm (extractor.js, WasmFS + OPFS): valida
//     la versión del juego y descompila los datos (objetos, texturas, niveles .fr3) a OPFS.
//
// Mensajes: recibe {iso: File, steps: ["iso", "extract"]}; envía {log}, {progress} y {done}.

const SECTOR = 0x800;

function post(kind, value) {
  postMessage({ [kind]: value });
}

async function read(file, offset, size) {
  return new DataView(await file.slice(offset, offset + size).arrayBuffer());
}

// Árbol de ficheros de la ISO, igual que find_files_in_iso / add_from_dir en C++
async function isoEntries(file) {
  const pvd = await read(file, 0x10 * SECTOR, SECTOR);
  const magic = String.fromCharCode(...new Uint8Array(pvd.buffer, 1, 5));
  if (pvd.getUint8(0) !== 1 || magic !== "CD001") {
    throw new Error("El fichero no es una imagen ISO9660 (falta el descriptor de volumen primario)");
  }
  const pathTableSector = pvd.getUint32(0x8c, true);
  const pt = await read(file, pathTableSector * SECTOR, 8);
  const rootExtent = pt.getUint32(2, true);
  const root = await read(file, rootExtent * SECTOR, 16);
  const rootSize = root.getUint32(10, true);

  const files = [];
  async function addFromDir(sector, size, prefix) {
    const dir = await read(file, sector * SECTOR, size);
    let offset = 0;
    while (offset < size) {
      const recordSize = dir.getUint8(offset);
      if (recordSize === 0) {
        offset = (offset & ~(SECTOR - 1)) + SECTOR; // el resto del sector está vacío
        continue;
      }
      const kind = dir.getUint8(offset + 0x21);
      if (kind !== 0 && kind !== 1) { // 0 y 1: entradas "." y ".."
        const extent = dir.getUint32(offset + 2, true);
        const entrySize = dir.getUint32(offset + 10, true);
        const nameLen = dir.getUint8(offset + 32);
        let name = String.fromCharCode(...new Uint8Array(dir.buffer, offset + 0x21, nameLen));
        const isDir = !name.endsWith(";1");
        if (isDir) {
          await addFromDir(extent, entrySize, `${prefix}${name}/`);
        } else {
          name = name.slice(0, -2);
          if (name === "WATER_AN.CGO") name = "WATER-AN.CGO"; // como unpack_entry en C++
          files.push({ path: prefix + name, offset: extent * SECTOR, size: entrySize });
        }
      }
      offset += recordSize;
    }
  }
  await addFromDir(rootExtent, rootSize, "");
  return files;
}

async function opfsDir(path, create = true) {
  let dir = await navigator.storage.getDirectory();
  for (const part of path.split("/").filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function extractIso(file) {
  post("log", `[iso] ${file.name}: ${(file.size / 2 ** 30).toFixed(2)} GB`);
  const entries = await isoEntries(file);
  const total = entries.reduce((s, e) => s + e.size, 0);
  post("log", `[iso] ${entries.length} ficheros, ${(total / 2 ** 30).toFixed(2)} GB`);

  // empezar de cero: una extracción anterior a medias no debe mezclarse con esta
  const root = await navigator.storage.getDirectory();
  await root.removeEntry("iso_data", { recursive: true }).catch(() => {});
  const out = await opfsDir("iso_data/jak2");

  const CHUNK = 16 * 2 ** 20;
  let done = 0;
  const t0 = performance.now();
  for (const e of entries) {
    const parts = e.path.split("/");
    const name = parts.pop();
    let dir = out;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
    const handle = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
    handle.truncate(0);
    for (let pos = 0; pos < e.size; pos += CHUNK) {
      const n = Math.min(CHUNK, e.size - pos);
      const data = new Uint8Array(await file.slice(e.offset + pos, e.offset + pos + n).arrayBuffer());
      handle.write(data, { at: pos });
      done += n;
      post("progress", { step: "iso", done, total, file: e.path });
    }
    handle.flush();
    handle.close();
  }
  post("log", `[iso] extraída en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

async function runExtractor() {
  importScripts("extractor.js");
  const module = await createExtractor({
    print: (t) => post("log", t),
    printErr: (t) => post("log", t),
    // las pthreads del módulo cargan este script (no extract-worker.js)
    mainScriptUrlOrBlob: "extractor.js",
  });
  post("log", "[extractor] validando y descomprimiendo los datos del juego...");
  try {
    return module.callMain(["-g", "jak2", "--proj-path", "/data", "-f", "-e", "-d", "/data/iso_data/jak2"]);
  } catch (e) {
    if (e && e.name === "ExitStatus") return e.status; // exit() de main con EXIT_RUNTIME
    throw e;
  }
}

onmessage = async (ev) => {
  const { iso, steps = ["iso", "extract"] } = ev.data;
  try {
    if (steps.includes("iso")) await extractIso(iso);
    let code = 0;
    if (steps.includes("extract")) code = await runExtractor();
    post("done", { ok: code === 0, code });
  } catch (e) {
    post("log", `[error] ${e && e.stack ? e.stack : e}`);
    post("done", { ok: false, error: String(e) });
  }
};
