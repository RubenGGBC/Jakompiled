# Jakompiled

OpenGOAL (Jak and Daxter 1–3) en el navegador con WebAssembly.

**Para probar con tu ISO sin compilar nada:** [`listo-para-probar/`](listo-para-probar/LEEME.md) (macOS y Windows).

**Estado (Jak II, ISO NTSC v2.01):** desde la ISO hasta el juego, todo en el navegador. La ISO se extrae en el navegador, los DGO se montan con el código compilado a wasm, y el juego arranca: intro, pantalla de título, menú, New Game, cinemáticas y la cárcel, con escenario, personajes y efectos, jugable con teclado y con sonido. Sin errores de WebGL hasta la cárcel. Falta probar el mando y más allá de la cárcel.

- [Plan](docs/plan.md)
- [Fase 0: mapa del pipeline e inventario](docs/fase0-inventario.md)
- [Fase 1: medición de riesgo de rendimiento](docs/fase1-benchmark.md): peor caso ~2x, se puede seguir
- [Fase 2: el runtime en el navegador](docs/fase2-runtime.md): `gk` arranca en Chromium y carga `KERNEL.CGO`
- [Fase 3: backend wasm de goalc](docs/fase3-backend.md): todo el código de Jak 2 (839 objetos) compila a wasm; con la ISO real el motor carga los niveles y llega a la cárcel (3.7: procesos reubicados por la compactación del heap)
- [Fase 4: gráficos en WebGL 2](docs/fase4-graficos.md) (en curso): escenario, personajes y efectos se ven en WebGL 2 (4.2: lo que WebGL 2 no acepta y cómo se arregló); teclado (4.3), sonido por Web Audio. Falta probar el mando
- [Extracción de la ISO en el navegador](docs/extraccion-iso.md) (probada con una ISO real): ISO → OPFS y extractor de OpenGOAL en wasm, sin que nada salga del navegador

Basado en [open-goal/jak-project](https://github.com/open-goal/jak-project), commit de referencia `efb21c3`.

## Estructura

| Ruta | Contenido |
|---|---|
| `docs/` | Plan e informes de cada fase |
| `bench/fase1/` | Benchmark de rendimiento x86 frente a wasm |
| `patches/jak-project/` | Cambios sobre jak-project (`efb21c3`) para compilar con Emscripten |
| `backend/` | Tests del backend wasm de goalc y oráculo x86 |
| `web/` | Página, servidor COOP/COEP, test en Chromium y scripts de compilación |

**Cada usuario aporta su propia ISO. Este repositorio nunca contendrá ISOs ni assets derivados.**
