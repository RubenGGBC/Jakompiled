# Plan: OpenGOAL en el navegador con WebAssembly

**Objetivo:** Jak 2 jugable en el navegador, con Jak 1 como banco de pruebas y Jak 3 como extensión opcional.
**Base:** [OpenGOAL](https://opengoal.dev) (`jak-project`), el port nativo de la trilogía hecho por descompilación, no por emulación.

---

## 1. Por qué Jak 2 (y no Jak 3)

| Criterio | Jak 1 | Jak 2 | Jak 3 |
|---|---|---|---|
| Estado en OpenGOAL | Estable | Maduro, con pocos bugs conocidos | Beta (abril 2026) |
| Renderers extra | Base | Algunos propios | + `hfrag`, `prim` |
| Música | Secuenciada | Secuenciada | Streaming |
| Papel en el plan | Banco de pruebas del backend | **Objetivo principal** | Extensión opcional |

- **Aislar tus bugs.** Con un port de base maduro, un fallo casi seguro está en tu código. En Jak 3 no sabrás si una textura rota viene de tu renderer o de un bug ya existente.
- **Reutilización.** Los tres juegos comparten `goalc` y la mayor parte del runtime. El backend wasm, el suspend de procesos y el grueso del renderer sirven para todos.
- **Jak 3 después.** Partiendo de Jak 2 funcionando, Jak 3 se reduce a añadir `hfrag`, `prim` y el audio en streaming.

---

## 2. El problema central

Pipeline de OpenGOAL:

```
ISO del usuario → extractor → decompilador → código .gc (GOAL)
                                                   │
                                                 goalc
                                                   │
                                        código máquina x86-64 (DGO)
                                                   │
                         runtime gk (C++) carga, enlaza y salta al código
```

- Emscripten compila sin problema el runtime en C++.
- **Lo que no puede ejecutar es el x86-64 que emite `goalc`.** El trabajo principal es escribir un backend wasm para `goalc`.

### Alternativas descartadas

| Opción | Problema |
|---|---|
| Intérprete/JIT de x86-64 en wasm | Rendimiento probablemente inaceptable |
| Emulador de PS2 en wasm (p. ej. builds web de Play!) | Mala compatibilidad y rendimiento con juegos que exprimen las VU; útil solo como baseline |

---

## 3. Problemas técnicos clave

| Problema | Detalle | Solución propuesta |
|---|---|---|
| **Backend wasm** | `goalc` emite x86-64 | Generar wasm desde el IR, antes del regalloc y del emitter x86 |
| **Modelo de enlace** | El kernel copia bytes ejecutables y salta a ellos | Un módulo wasm por objeto, con `Memory` y `Table` importadas; los punteros a función pasan a ser índices de la tabla |
| **Punteros GOAL** | 32 bits relativos a una base | Encajan de forma natural con wasm32 |
| **Suspend/resume de procesos** | Intercambio de pilas (libco, asm) que wasm no permite | Primero JSPI; plan B con Emscripten fibers + Asyncify |
| **Registros `vf`** | Inline asm vectorial (`rlet`) | Mapear a SIMD128 (p. ej. `.mul.vf` → `f32x4.mul`) |
| **Renderer** | OpenGL de escritorio y WebGL2 ≈ GLES 3.0 | Auditar features de GL 4.x; si hay compute o SSBO → WebGPU. Shaders a GLSL ES 3.00 |
| **Hilos** | EE/IOP simulados en hilos | `-pthread`, SharedArrayBuffer y cabeceras COOP/COEP |
| **Audio / input** | Pasan por SDL | Port SDL de Emscripten (Web Audio + Gamepad API) |
| **Datos** | Varios GB extraídos de la ISO | OPFS; extracción en el navegador o con una herramienta nativa previa |

---

## 4. Fases

> Duraciones orientativas con dedicación parcial. La fase 3 es la de mayor riesgo y la que más puede variar.

### Fase 0 — Preparación (1–2 semanas)
- [ ] Compilar OpenGOAL nativo y jugar Jak 1 y Jak 2 con ISOs propias
- [x] Mapear el pipeline de `goalc`: IR → register allocator → emitter x86 ([fase0-inventario.md](fase0-inventario.md))
- [x] Inventario del renderer: `grep` de llamadas `gl*`, versión de GL, compute shaders, SSBOs, extensiones
- [ ] Preguntar en el Discord y los issues de OpenGOAL por intentos previos de wasm o ARM

**Salida:** documento con el mapa del pipeline y la lista de features de GL a sustituir.

### Fase 1 — Medición de riesgo (1–2 semanas)
- [x] Elegir 2–3 funciones GOAL calientes (colisión, matemáticas vectoriales)
- [x] Traducirlas a mano a wasm (WAT o C compilado con Emscripten)
- [x] Hacer benchmark frente a la versión x86 nativa ([fase1-benchmark.md](fase1-benchmark.md): peor caso ~2x)

**Salida:** factor de ralentización medido. **Si sale peor de 3x, replantear antes de seguir.**

### Fase 2 — Runtime en Emscripten (2–4 semanas)
- [x] Compilar `gk` con `-pthread` ([fase2-runtime.md](fase2-runtime.md))
- [x] Renderer y audio en stub; carga de objetos GOAL desactivada
- [x] Sistema de ficheros: preload para pruebas y OPFS más adelante (preload hecho; OPFS pendiente)
- [x] Servidor local con cabeceras COOP/COEP

**Salida:** el kernel C++ arranca en el navegador e intenta cargar el primer DGO.

### Fase 3 — Backend wasm en `goalc` (2–4 meses)
- [x] Subconjunto mínimo: aritmética entera, llamadas, load/store ([fase3-backend.md](fase3-backend.md): idéntico a x86 en 71/71 casos)
- [x] Tests con programas GOAL fuera del juego, p. ej. `(format #t "hola")` (corre dentro del runtime en Chromium, 3.3)
- [x] Modelo de enlace: módulo por objeto, `Memory` y `Table` compartidas (módulo incrustado en el objeto GOAL, 3.3)
- [x] Registros `vf` → SIMD128 (3.5: idéntico a x86 en 464/464 casos; todo `GAME.CGO` compila a wasm)
- [x] Suspend/resume: JSPI, con Asyncify como plan B (JSPI, 3.4: el kernel GOAL real ejecuta procesos en Chromium)

**Salida:** el kernel GOAL de Jak 1 compilado a wasm arranca y ejecuta procesos que se suspenden y reanudan.
> **Conseguido (con Jak 2 en vez de Jak 1):** el kernel GOAL de Jak 2 ejecuta procesos con suspend/resume (3.4), y el motor completo (`GAME.CGO`) se carga y se ejecuta en el navegador hasta que necesita datos de la ISO (3.6).

### Fase 4 — Jak 1 arrancando (1–2 meses)
- [ ] Renderer en WebGL2, o en WebGPU según el inventario de la fase 0
- [ ] Portar shaders a GLSL ES
- [ ] Empezar por el pipeline más simple que pinte algo e ir añadiendo renderers

**Salida:** un nivel de Jak 1 en pantalla con Jak moviéndose.

### Fase 5 — Jak 2 jugable (2–3 meses)
- [ ] Renderers propios de Jak 2
- [ ] Audio: SDL → Web Audio
- [ ] Input: Gamepad API
- [ ] Extracción de la ISO y persistencia en OPFS
- [ ] Optimización con el profiler del navegador: draw calls, tamaño de módulos, tiempos de carga

**Salida:** Jak 2 completable de principio a fin en Chrome de escritorio a un framerate estable.

### Fase 6 — Jak 3 (opcional)
- [ ] Renderers `hfrag` y `prim`
- [ ] Música en streaming

**Total estimado:** 6–12 meses.

---

## 5. Expectativas de rendimiento y compatibilidad

- **CPU:** cuenta con wasm 1,5–2x más lento que nativo, y algo peor si usas Asyncify. La fase 1 da el número real.
- **GPU:** WebGL2 añade overhead por draw call; WebGPU lo mitiga.
- **Navegadores:** Chrome/Edge de escritorio desde el principio. Firefox y Safari dependen de JSPI, SharedArrayBuffer y SIMD.
- **Móvil:** no es un objetivo inicial.
- **Primera carga:** lenta por la extracción de varios GB; las siguientes leen de OPFS.

---

## 6. Legal y distribución

- OpenGOAL exige que cada usuario use su propia ISO. La versión web debe hacer lo mismo.
- **Se sirve solo el motor.** El usuario sube su ISO, y la extracción y los datos se quedan en su navegador (OPFS).
- **Nunca** se alojan ni la ISO ni los assets derivados.

---

## 7. Riesgos principales

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Rendimiento insuficiente | Proyecto inviable | Medirlo en la fase 1, antes de invertir meses |
| Suspend de procesos complejo | Bloquea la fase 3 | Atacarlo pronto; JSPI con Asyncify de plan B |
| Renderer dependiente de GL 4.x | Reescritura grande | Inventario en la fase 0; WebGPU si hace falta |
| Cambios upstream en OpenGOAL | Merges costosos | Fijar una versión y rebasar por hitos |
