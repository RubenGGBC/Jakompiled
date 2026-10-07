# Jakompiled

OpenGOAL (Jak and Daxter 1–3) en el navegador con WebAssembly.

- [Plan](docs/plan.md)
- [Fase 0: mapa del pipeline e inventario](docs/fase0-inventario.md)
- [Fase 1: medición de riesgo de rendimiento](docs/fase1-benchmark.md): peor caso ~2x, se puede seguir
- [Fase 2: el runtime en el navegador](docs/fase2-runtime.md): `gk` arranca en Chromium y carga `KERNEL.CGO`
- [Fase 3: backend wasm de goalc](docs/fase3-backend.md) (en curso): el kernel GOAL de Jak 2 compilado a wasm ejecuta procesos en Chromium; todo el motor (`GAME.CGO`) compila a wasm

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
