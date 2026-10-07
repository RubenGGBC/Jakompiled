# Fase 0: mapa del pipeline e inventario

Análisis estático de `open-goal/jak-project`, commit `efb21c3` (2026-09-30). Para reproducirlo no hace falta ninguna ISO.

> **Resumen.** El renderer está mejor de lo esperado: WebGL2 basta y WebGPU no hace falta. El suspend de procesos está peor: no usa libco, sino asm escrito en GOAL que copia la pila, y eso cambia el plan B. Hay un backend ARM64 en desarrollo en upstream que sirve de plantilla para el backend wasm.

---

## 1. Pipeline de `goalc`

```
.gc ──goos/reader──► Compiler (goalc/compiler/compilation/*.cpp)
                         │  genera
                         ▼
                 IR (goalc/compiler/IR.h, 43 clases IR_*)
                   con registros virtuales (IRegister)
                         │
            regalloc (goalc/regalloc/Allocator_v2.cpp)
                         │  AllocationResult
                         ▼
   IR::do_codegen_x86 / IR::do_codegen_arm64  ──►  IGen (IGenX86 / IGenARM64)
                         │
             ObjectGenerator (goalc/emitter/ObjectGenerator.cpp)
                         │  segmentos + tabla de enlace (common/link_types.h)
                         ▼
                   objeto .o  ──► klink (game/kernel/jakN/klink.cpp) parchea y salta
```

- **Punto de inserción del backend wasm.** Se añadiría `InstructionSet::WASM` (`goalc/emitter/InstructionSet.h`) y un `do_codegen_wasm` en cada una de las 43 clases IR. El backend wasm **no usa el regalloc**: cada `IRegister` se convierte en un local de wasm (`i64`, `f32` o `v128` según su clase).
- **Plantilla: el port ARM64 de upstream.** Ya existen `IGenARM64` (~3.300 líneas), `do_codegen_arm64` en todo el IR, ramas `INSTRUCTION_SET 'arm64` en el kernel GOAL, tipos de enlace `LINK_ARM64_*` en `klink` y `test/test_emitter_arm64.cpp`. Hay que tocar los mismos sitios. Conviene seguir ese trabajo y, si es posible, colaborar con quien lo lleva.
- **Flujo de control.** El IR usa etiquetas y saltos (`IR_GotoLabel`, `IR_ConditionalBranch`), y wasm exige control estructurado. Recomendación: emitir a través de la **API C de Binaryen**, que trae Relooper (CFG → bloques estructurados), validación y optimizador. Así no hace falta escribir un stackifier propio.

### Código del juego que el backend tiene que aceptar

| | Jak 1 | Jak 2 | Jak 3 |
|---|---|---|---|
| Ficheros `.gc` | 533 | 849 | 1.041 |
| Líneas `.gc` | 326k | 895k | 1.072k |
| `rlet` (asm inline) | 286 en 63 ficheros | 554 en 172 | 447 en 150 |
| Operaciones `.xxx.vf` | 2.106 | 3.698 | 2.871 |
| `asm-func` | 10 (gkernel + joint) | 9 (gkernel) | 9 (gkernel) |
| Funciones mips2c (C++) | 25 / 33k líneas | 28 / 36k | 28 / 33k |

- Casi todos los `rlet` solo declaran registros `vf` sin fijar cuál. Pasan a locales `v128` y SIMD128 sin problema.
- Los `rlet` que fijan **registros físicos** (`r13`/`pp`, `r15`/`off`, `rsp`, `rbx`…) están casi todos en `kernel/gkernel.gc` y `kernel/gstate.gc`, los únicos ficheros con `#cond INSTRUCTION_SET`. Ahí haría falta una tercera rama `'wasm` escrita a mano, igual que se hizo para ARM64.
- **mips2c** son las funciones más calientes que la descompilación no podía expresar en GOAL. Ya son C++ y Emscripten las compila (una por juego usa intrínsecos SSE, que Emscripten emula con `-msimd128`). Desde GOAL se llaman por el trampolín `_mips2c_call_systemv`, que en wasm se convierte en una importación.

## 2. Suspend/resume: corrección al plan

El plan atribuía el suspend de procesos a libco. **Es incorrecto.** En OpenGOAL, `thread-suspend` y `thread-resume` son `asm-func` escritas en GOAL (`goal_src/jakN/kernel/gkernel.gc`, ~línea 640). Al suspender:

1. Sacan la dirección de retorno de la pila nativa y la guardan en `thread.pc`.
2. Guardan `rsp` y los registros callee-saved en el `cpu-thread`.
3. **Copian la pila del proceso**, palabra a palabra, al área de guardado del thread.
4. Restauran `*kernel-sp*` y hacen `ret` hacia el kernel.

Al reanudar se hace lo contrario. Este diseño es imposible en wasm, porque la pila de valores y los locales no son direccionables. libco solo se usa para los hilos del IOP simulado (`game/system/IOP_Kernel.h`).

Consecuencias:

- `thread-suspend` y `thread-resume` pasan a ser **intrínsecos del runtime** importados por los módulos GOAL. Hay que cambiarlos en el `gkernel.gc` de cada juego.
- **JSPI** sigue siendo la opción A. Cada proceso se ejecuta en su propia pila suspendible: entrar en un proceso es una llamada a un export `promising`, y suspender es una importación `suspending`. Coste: el bucle de procesos del kernel pasa a ser asíncrono. Hay que medir el overhead por proceso y frame.
- **Asyncify pierde fuerza como plan B.** Instrumenta un único módulo, y el modelo "un módulo por objeto" lo reparte en cientos. Habría que fusionar módulos en tiempo de carga o renunciar a la carga incremental.
- **Plan C: transformación propia en `goalc`.** `goalc` sabe qué llamadas pueden suspender y podría generar máquinas de estado. Es complejo pero no depende del navegador.
- **A vigilar:** la propuesta de *stack switching* de wasm (`cont.new`/`resume`/`suspend`) encaja exactamente con este caso. Hay que comprobar su estado en Chrome antes de la fase 3.

## 3. Modelo de enlace

- `klink` recorre una tabla de enlace (`LINK_SYMBOL_OFFSET`, `LINK_TYPE_PTR`, `LINK_PTR`, `LINK_ARM64_*`) y **parchea bytes del código** para fijar offsets de símbolos y punteros entre segmentos.
- En wasm se puede mantener la idea. `goalc` emite las constantes a parchear como `i32.const` con LEB128 rellenado a 5 bytes, y el enlazador las parchea en el binario antes de `WebAssembly.compile`. Esto evita miles de imports de globals.
- Memoria y `Table` compartidas, como en el plan. Un objeto `function` de GOAL es un `basic` cuyo cuerpo es el código. En wasm su cuerpo sería un pequeño stub que guarda el índice en la `Table`, y las llamadas serían `call_indirect` sobre ese índice.

## 4. Renderer: inventario de OpenGL

**Conclusión: WebGL2 es suficiente. No hace falta WebGPU.**

- Contexto **OpenGL 4.1 core**, con 92 shaders, todos `#version 410 core`.
- **Ninguno** de los bloqueantes temidos: 0 compute shaders, 0 SSBO, 0 geometry shaders, nada de draw indirect ni `glBufferStorage`/`glMapBuffer`.
- Las llamadas de dibujo son simples: `glDrawElements` (43), `glDrawArrays` (39), `glDrawArraysInstanced` (1).
- Se usan UBO (`GL_UNIFORM_BUFFER`), `texelFetch`, `flat` y `glBlitFramebuffer`, y todo eso existe en GLES 3.0.

Lo que hay que adaptar:

| Feature | Usos | Sustitución en WebGL2 |
|---|---|---|
| `GL_TEXTURE_1D` / `sampler1D` | 5 `.cpp`, 7 shaders (TFragment, Tie3, Shrub, Hfrag, TextureAnimator) | Textura 2D de N×1 |
| `GL_UNSIGNED_INT_8_8_8_8_REV` | 38 | `GL_UNSIGNED_BYTE` (mismo layout en little-endian) |
| `glPrimitiveRestartIndex(UINT32_MAX)` | 20 | WebGL2 siempre reinicia con el índice máximo. Compatible porque los índices son de 32 bits (no hay `glDrawElements` con `GL_UNSIGNED_SHORT`) |
| `noperspective` | sky.vert/frag | Interpolación manual (multiplicar y dividir por w) |
| `glPolygonMode` | Wireframe de depuración (Direct, Shadow, CollideMesh) | Quitar |
| `glGetTexImage`, `glDebugMessageCallback` | Depuración | Quitar |
| Shaders `#version 410 core` | 92 | Reescribir la cabecera a `#version 300 es` + `precision`, preferiblemente en `Shader.cpp` al cargar |

`Hfrag` (de Jak 3) ya está en el árbol, así que la fase 6 tiene menos renderer nuevo del previsto.

## 5. Hilos

- Usan `std::thread`: `SystemThread` (EE e IOP), `Loader` (carga de niveles en el renderer) y `Deci2Server` (socket del listener de depuración, que se elimina en web).
- Los hilos del IOP usan **libco** (`co_create`). En Emscripten hay que sustituirlo por `emscripten_fiber_*` o reescribir el planificador del IOP. Es acotado, porque solo afecta a la parte de sonido y carga.

## 6. Intentos previos

No hay ningún port a wasm público conocido (búsqueda en GitHub y la web, octubre de 2026). Sigue pendiente preguntar en el Discord de OpenGOAL, sobre todo a quienes hacen el port ARM64.

## 7. Cambios propuestos al plan

1. **Fase 3:** emitir mediante Binaryen (Relooper) y tomar el port ARM64 como guía de qué tocar.
2. **Suspend:** el riesgo pasa de "hay que sustituir libco" a "hay que reescribir `thread-suspend`/`thread-resume` como intrínsecos". JSPI pasa a ser casi obligatorio, porque Asyncify choca con "un módulo por objeto".
3. **Fase 4:** descartar WebGPU. Basta WebGL2 con las adaptaciones de la tabla.
4. **Fase 1:** las funciones calientes más duras ya están en mips2c (C++). Para el benchmark del backend conviene elegir funciones GOAL con muchos `vf` (matemáticas vectoriales, `joint`).

## 8. Cuándo hace falta la ISO

- **Fases 1–3: no hace falta.** `goalc` compila `goal_src/` sin datos del juego. El kernel GOAL y los programas de prueba no necesitan assets.
- **Fase 0 (jugar en nativo) y fase 4 en adelante: sí.** Se usa en la máquina local con el extractor oficial. **No se sube nunca** al repositorio ni a un entorno en la nube (ver §6 del plan).
