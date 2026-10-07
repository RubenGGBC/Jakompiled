// Jakompiled: arranque de gk.js (runtime de OpenGOAL compilado con Emscripten).
// KERNEL.CGO lo genera goalc a partir del código fuente (no contiene datos de la ISO);
// se descarga y se copia al sistema de ficheros virtual antes de llamar a main().

const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");

function log(line) {
  logEl.textContent += line + "\n";
  console.log(line);
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls ?? "";
}

if (!crossOriginIsolated) {
  setStatus("Falta aislamiento cross-origin (cabeceras COOP/COEP): SharedArrayBuffer no está disponible.", "err");
}

var Module = {
  arguments: ["-g", "jak2", "-v", "--no-display", "--proj-path", "/data", "--", "-fakeiso", "-nosound"],
  preRun: [
    () => {
      Module.FS.mkdirTree("/data/out/jak2/iso");
      Module.FS.mkdirTree("/data/goal_src/user");
      Module.addRunDependency("kernel-cgo");
      fetch("data/KERNEL.CGO")
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buf) => {
          Module.FS.writeFile("/data/out/jak2/iso/KERNEL.CGO", new Uint8Array(buf));
          log(`[boot] KERNEL.CGO: ${buf.byteLength} bytes`);
          Module.removeRunDependency("kernel-cgo");
        })
        .catch((e) => setStatus(`No se pudo descargar KERNEL.CGO: ${e}`, "err"));
    },
  ],
  print: (text) => log(text),
  printErr: (text) => {
    log(text);
    if (text.includes("[jakompiled]")) setStatus("El kernel llegó al primer salto a código GOAL (fin de la fase 2).", "ok");
  },
  onAbort: (what) => log(`[boot] abort: ${what}`),
};
