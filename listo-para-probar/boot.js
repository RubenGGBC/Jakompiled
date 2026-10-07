// Jakompiled: arranque de gk.js (runtime de OpenGOAL compilado con Emscripten).
// KERNEL.CGO lo genera goalc a partir del código fuente (no contiene datos de la ISO);
// se descarga y se copia al sistema de ficheros virtual antes de llamar a main().
//
// ?boot=game: arranque normal del juego (-boot). El runtime carga además GAME.CGO (el motor,
// también compilado a wasm desde el código fuente) y llama a play-boot.
// ?display=1: con gráficos (WebGL 2 en el <canvas>); sin él, el runtime arranca con --no-display.

const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");

function log(line) {
  line = line.replace(/\x1b\[[0-9;]*m/g, ""); // colores ANSI del logger de OpenGOAL
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

const params = new URLSearchParams(location.search);
const bootGame = params.get("boot") === "game";
const display = params.get("display") === "1";
const gameArgs = ["-fakeiso", "-nosound", ...(bootGame ? ["-boot"] : [])];
const cgoFiles = ["KERNEL.CGO", ...(bootGame ? ["GAME.CGO"] : [])];

var Module = {
  arguments: ["-g", "jak2", "-v", ...(display ? [] : ["--no-display"]), "--proj-path", "/data", "--", ...gameArgs],
  canvas: document.getElementById("canvas"),
  preRun: [
    () => {
      Module.FS.mkdirTree("/data/out/jak2/iso");
      Module.FS.mkdirTree("/data/goal_src/user");
      for (const name of cgoFiles) {
        Module.addRunDependency(name);
        fetch(`data/${name}`)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then((buf) => {
            Module.FS.writeFile(`/data/out/jak2/iso/${name}`, new Uint8Array(buf));
            log(`[boot] ${name}: ${buf.byteLength} bytes`);
            Module.removeRunDependency(name);
          })
          .catch((e) => setStatus(`No se pudo descargar ${name}: ${e}`, "err"));
      }
    },
  ],
  print: (text) => log(text),
  printErr: (text) => {
    log(text);
    if (text.includes("[jakompiled]")) setStatus("El kernel llegó al primer salto a código GOAL (fin de la fase 2).", "ok");
  },
  onAbort: (what) => log(`[boot] abort: ${what}`),
};
