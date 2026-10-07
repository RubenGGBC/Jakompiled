# Fase 3: backend wasm de `goalc`

Diario de la fase más larga del plan. Cada sección es un hito.

## 3.1 Suspender procesos con JSPI: coste medido

> **Resultado: JSPI es viable.** Un cambio de proceso (kernel → proceso → kernel) cuesta **~0,4–0,6 µs** con hasta 500 procesos y ~1 µs con 2.000. Eso son **~0,3 ms por frame con 500 procesos**, el 2 % de los 16,6 ms de un frame a 60 fps. No hace falta el plan C (procesos como máquinas de estado).

### Modelo

[`bench/fase3-jspi/jspi.wat`](../bench/fase3-jspi/jspi.wat) reproduce el bucle del kernel GOAL. En cada frame recorre P procesos, y cada uno ejecuta `(loop (do-work) (suspend))`:

- **Con JSPI:** cada proceso tiene su propia pila (una llamada `WebAssembly.promising` que no termina nunca). `resume` y `suspend` son imports `WebAssembly.Suspending`, así que cada cambio pasa por una promesa de JS y una microtarea.
- **Base:** el proceso es una función normal que hace una iteración y vuelve, mediante `call_indirect`. Es lo que daría compilar los procesos como máquinas de estado, sin pilas.

### Resultados

Chromium 141 (V8 14.1), headless, 3 ejecuciones, en el hilo principal y en un Worker. El runtime corre en Workers, así que esa es la cifra relevante.

| Procesos | JSPI, ns por cambio (hilo principal) | JSPI, ns por cambio (Worker) | ms por frame (Worker) | Llamada normal |
|---:|---:|---:|---:|---:|
| 10 | 420–510 | 350–400 | 0,004 | ~1 ns |
| 100 | 410–470 | 380–480 | 0,04 | ~1 ns |
| 500 | 580–610 | 470–600 | 0,23–0,30 | ~1 ns |
| 2.000 | 820–1.100 | 820–970 | 1,6–1,9 | ~1 ns |

Las cifras de la llamada normal están en el límite de resolución de `performance.now()`. Las cuatro configuraciones verificaron que cada proceso ejecutó exactamente un paso por frame.

### Consecuencias para el diseño

- El kernel de procesos se queda como está: cada proceso GOAL tiene su pila y `suspend` es un import de JSPI. No hay que transformar el código GOAL.
- **Requisito nuevo:** con JSPI, suspender devuelve el control hasta el `promising` más cercano. Si el dispatcher de GOAL se llama desde C++ (`KernelCheckAndDispatch` → `call_goal`), también quedan en la pila suspendida los frames C++ del hilo EE. Por tanto el runtime necesita `-sJSPI` de Emscripten, con el bucle del EE dentro de un contexto `promising`. Hay que verificar que JSPI y pthreads funcionan juntos en Emscripten 6.
- El coste crece con el número de procesos porque cada pila suspendida ocupa memoria y caché. Los ~200–500 procesos habituales de Jak 2 quedan en la zona barata.

## 3.2 Primer subconjunto del backend: IR → wasm

> **Resultado: `goalc` ya emite WebAssembly.** Funciones con aritmética entera y flotante, control de flujo, llamadas a través de símbolos, globales y acceso a memoria. **Los 71 casos del oráculo dan exactamente los mismos bits que el x86 nativo de `goalc`**, incluidos NaN, desbordamientos y conversiones fuera de rango. Además pasan 40 tests propios.

Código: parche [`0004`](../patches/jak-project/0004-goalc-WebAssembly-backend-first-subset.patch) (unas 1.000 líneas nuevas) y pruebas en [`backend/`](../backend/).

### Diseño

```
.gc ─► front end de goalc (sin cambios) ─► IR (registros virtuales)
                                             │
                                             ├─ x86 / ARM64: regalloc ─► IGen ─► código máquina
                                             │
                                             └─ wasm: FunctionGen (un local por registro virtual)
                                                    ─► bloques básicos ─► Relooper de Binaryen
                                                    ─► validación + optimizador (-O2) ─► .wasm
```

- **Sin asignación de registros.** Cada `IRegister` es un local de wasm (`i64` si es GPR, `f32` si es float, `v128` si es de 128 bits). El motor de JS asigna los registros de verdad.
- **Integración mínima con el IR.** La clase base `IR` gana dos métodos virtuales: `do_codegen_wasm`, cuya versión por defecto informa de la instrucción no soportada, y `wasm_branch_target`. Cada instrucción soportada implementa su traducción en [`IR_wasm.cpp`](../patches/jak-project/0004-goalc-WebAssembly-backend-first-subset.patch), junto a su versión x86. Las instrucciones aún no cubiertas fallan con un mensaje claro, así que se puede avanzar instrucción a instrucción.
- **Flujo de control.** Los bloques básicos se reconstruyen a partir de las etiquetas del IR (destinos de salto y la instrucción siguiente a cada salto). El Relooper de Binaryen los convierte en `block`/`loop`/`if`.
- **Semántica idéntica a x86, bit a bit**, en los casos que wasm define de otra forma:

| Operación | x86 (`goalc`) | wasm emitido |
|---|---|---|
| float → int (`cvttss2si`) | NaN y fuera de rango → `INT_MIN` | `trunc_sat` + comprobación de rango + `select` |
| `fmin` / `fmax` (`minss`/`maxss`) | `a < b ? a : b`; con NaN, el segundo | `select` sobre `lt`/`gt` (no `f32.min`, que propaga NaN) |
| Comparación float (`comiss` + saltos sin signo) | NaN hace ciertos `=`, `<`, `<=` | condición `or` "unordered" |
| `*`, `/`, `mod` de enteros | 32 bits con extensión de signo (como PS2) | `i32.mul`/`div`/`rem` + `i64.extend_i32_s` |
| Float en registro entero | `movd` + `movsxd` | `i32.reinterpret_f32` + `i64.extend_i32_s` |

### ABI implementada

| Elemento | En wasm |
|---|---|
| Memoria GOAL | `env.mem` importada; puntero GOAL `p` → `load/store (i32.wrap p)` con `offset` inmediato = `WASM_EE_MAIN_MEM_BASE` (16 MB) + campo |
| Funciones | Exportadas con su nombre `goalc`; tipo `(i64 × n) → i64` |
| Llamada a función | Cargar el valor del símbolo → el objeto `function` contiene el índice en `env.table` → `call_indirect` |
| `s7`, `#t`, `#f` | Global `env.s7`; `#f` = `s7`, `#t` = `s7 + 4` (Jak 2) |
| Símbolos | Un global importado `sym.<nombre>` con la dirección GOAL del símbolo; el valor está en `símbolo − 1` (Jak 2) |
| Dirección de una función | Global importado `func.<nombre>` |
| Constantes float | Inmediatos `f32.const`. En x86 son datos estáticos del objeto |

Así queda la función recursiva `t-fact` después del optimizador:

```wasm
(func (param i64) (result i64)
  local.get 0  i64.const 1  i64.gt_s
  if (result i64)
    local.get 0  i32.wrap_i64                ;; n (multiplicación de 32 bits)
    local.get 0  i64.const 1  i64.sub        ;; argumento: n - 1
    global.get 1  i32.wrap_i64               ;; símbolo t-fact
    i64.load32_u offset=16777215             ;; valor del símbolo (base EE - 1)
    i32.wrap_i64  i32.load offset=16777216   ;; índice en la tabla, guardado en el objeto function
    call_indirect (type 1)
    i32.wrap_i64  i32.mul  i64.extend_i32_s  ;; como en PS2
  else
    i64.const 1
  end)
```

### Validación: oráculo x86

[`backend/oracle/goal_oracle.cpp`](../backend/oracle/goal_oracle.cpp) arranca el runtime nativo de OpenGOAL (kernel de Jak 2, sin ISO). Carga [`tests/basic.gc`](../backend/tests/basic.gc) con el `goalc` original (x86, sin parches) y evalúa los 71 casos de [`basic.cases`](../backend/tests/basic.cases). [`run_tests.mjs`](../backend/run_tests.mjs) ejecuta los mismos casos en wasm y compara con [`basic.oracle-x86.txt`](../backend/tests/basic.oracle-x86.txt):

```
== comparación con x86 (goalc nativo)
71 iguales a x86, 0 distintos

40 ok, 0 fallos
```

Los casos incluyen desbordamientos de 32 y 64 bits, desplazamientos de 63 y 64 posiciones, recursión hasta `20!`, NaN en conversiones y comparaciones, `±3e9 → int` y `-0.0 = 0.0`. El oráculo detectó un error en mis propias expectativas: había supuesto que `*` era de 64 bits.

### Pendiente en la fase 3

| Tarea | Estado |
|---|---|
| Aritmética entera, llamadas, load/store | ✅ |
| Floats, comparaciones, control de flujo | ✅ |
| Datos estáticos del objeto (cadenas, estructuras, pares), `IR_StaticVarAddr` | Pendiente: requiere emitir el segmento de datos junto al módulo |
| Llamadas a funciones C del runtime (`format`, `print`...) | Pendiente: integración con el runtime web |
| Registros `vf` → SIMD128 (`IR_VFMath*`, `IR_SplatVF`, `IR_BlendVF`...) | Pendiente |
| Pila (`new 'stack`, `IR_GetStackAddr`, `IR_RegValAddr`), behaviors (`self`/`pp`) | Pendiente |
| Modelo de enlace real en `klink` (instanciar el módulo al cargar el objeto) | Pendiente |
| Suspend/resume con JSPI dentro del runtime (`-sJSPI` + pthreads) | Pendiente; coste ya medido (3.1) |
| `asm-func` del kernel (`gkernel.gc`) escritas a mano para wasm | Pendiente |

### Reproducir

```sh
web/build_runtime.sh                     # también compila Binaryen y goalc-wasm
JAK_PROJECT=web/work/jak-project backend/test.sh
```
