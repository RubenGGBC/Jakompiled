// Fase 3: mide JSPI frente a llamadas normales. Funciona en una página o en un Worker.
// runBench(wasmBytes) -> resultados por número de procesos.
async function runBench(bytes) {
  let ex;
  const waiting = []; // pid -> resolve() que reanuda el proceso
  let kernelWake = null; // resolve() que reanuda el kernel
  let current = -1;
  let startProc;

  const imports = {
    env: {
      // kernel: cede el control al proceso pid y espera a que este se suspenda
      resume: new WebAssembly.Suspending((pid) => new Promise((resolve) => {
        kernelWake = resolve;
        current = pid;
        if (waiting[pid]) {
          const r = waiting[pid];
          waiting[pid] = null;
          r();
        } else {
          startProc(pid);
        }
      })),
      // proceso: se suspende y despierta al kernel
      suspend: new WebAssembly.Suspending(() => new Promise((resolve) => {
        waiting[current] = resolve;
        const k = kernelWake;
        kernelWake = null;
        k();
      })),
    },
  };
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  ex = instance.exports;
  const procPromising = WebAssembly.promising(ex.proc);
  startProc = (pid) => { procPromising(pid); };
  const kernelJspi = WebAssembly.promising(ex.kernel_jspi);

  const mem = new Int32Array(ex.mem.buffer);
  const results = [];
  for (const procs of [10, 100, 500, 2000]) {
    if (procs * 4 > ex.mem.buffer.byteLength) break;
    const frames = Math.max(20, Math.floor(200000 / procs));
    // calentamiento (también arranca las pilas de los procesos)
    await kernelJspi(5, procs);
    ex.kernel_plain(5, procs);

    mem.fill(0);
    let t0 = performance.now();
    await kernelJspi(frames, procs);
    const jspiMs = performance.now() - t0;
    const okJspi = mem[0] === frames && mem[procs - 1] === frames;

    t0 = performance.now();
    ex.kernel_plain(frames, procs);
    const plainMs = performance.now() - t0;

    const switches = frames * procs;
    results.push({
      procs,
      frames,
      jspi_ns_per_switch: (jspiMs * 1e6) / switches,
      plain_ns_per_switch: (plainMs * 1e6) / switches,
      jspi_ms_per_frame: jspiMs / frames,
      ok: okJspi,
    });
  }
  return results;
}
if (typeof self !== "undefined" && typeof window === "undefined") {
  self.onmessage = async (e) => self.postMessage(await runBench(e.data));
}
