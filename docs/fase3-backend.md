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
| Funciones | Exportadas con su nombre `goalc`; tipo `(i64 × 8) → i64` para todas (ver 3.3) |
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

[`backend/oracle/goal_oracle.cpp`](../backend/oracle/goal_oracle.cpp) arranca el runtime nativo de OpenGOAL (kernel de Jak 2, sin ISO). Carga [`tests/unit/basic.gc`](../backend/tests/unit/basic.gc) con el `goalc` original (x86, sin parches) y evalúa los 71 casos de [`basic.cases`](../backend/tests/unit/basic.cases). [`run_tests.mjs`](../backend/run_tests.mjs) ejecuta los mismos casos en wasm y compara con [`basic.oracle-x86.txt`](../backend/tests/unit/basic.oracle-x86.txt):

```
== comparación con x86 (goalc nativo)
71 iguales a x86, 0 distintos

40 ok, 0 fallos
```

Los casos incluyen desbordamientos de 32 y 64 bits, desplazamientos de 63 y 64 posiciones, recursión hasta `20!`, NaN en conversiones y comparaciones, `±3e9 → int` y `-0.0 = 0.0`. El oráculo detectó un error en mis propias expectativas: había supuesto que `*` era de 64 bits.

### Reproducir

```sh
web/build_runtime.sh                     # también compila Binaryen y goalc-wasm
JAK_PROJECT=web/work/jak-project backend/test.sh
```

## 3.3 GOAL en wasm dentro del runtime, en el navegador

> **Resultado: el primer código GOAL compilado a WebAssembly se ejecuta dentro del runtime de OpenGOAL en Chromium.** `goalc-wasm` genera un objeto GOAL normal con el módulo wasm dentro. El runtime lo carga por el IOP como un DGO más, `klink` lo enlaza, se instancia el módulo y se ejecuta su código, que llama a funciones C del runtime:

```
[jakompiled] hello: instantiating 670 byte wasm module
[GOAL/wasm] hola desde GOAL compilado a WebAssembly
[GOAL/wasm] (+ 2 3) = 5, (hello-fact 10) = 3628800
[GOAL/wasm] cadena estática: "jakompiled" (suma de bytes 1056)
[GOAL/wasm] flotante: 3.5000
```

Programa: [`backend/tests/runtime/hello.gc`](../backend/tests/runtime/hello.gc). Prueba: [`backend/test_runtime.sh`](../backend/test_runtime.sh), que lo empaqueta como `KERNEL.CGO` y arranca el runtime en Chromium headless. Después el arranque se detiene con `Kernel version mismatch`, como se espera: el objeto de prueba no es el kernel real.

### Objetos GOAL para wasm

El objeto `.o` conserva el formato v3 de OpenGOAL, así que `klink` lo enlaza sin cambios: estáticos, etiquetas de tipo y símbolos dentro de los datos. Lo que cambia es el contenido del "código":

```
segmento top-level                       segmento main
┌─────────────────────────────┐          ┌─────────────────────────────┐
│ [tipo function]             │          │ [tipo function]             │
│ índice en tabla │ ─offset──┐│          │ índice en tabla │ 0          │  ← 8 bytes por función
│ ...estáticos...           │ │          │ ...                         │
│ AWJK │ tamaño │ módulo wasm◄┘          │ estáticos (cadenas, etc.)   │
└─────────────────────────────┘          └─────────────────────────────┘
```

- **Función = 8 bytes.** El índice de su código en la tabla wasm, que rellena `__link`, y, solo en la de nivel superior, la distancia hasta el módulo incrustado.
- **Módulo al final del segmento top-level.** Así su tamaño no desplaza nada, y se libera junto con ese segmento tras ejecutar el objeto. `goalc-wasm` hace dos pasadas: primero calcula la disposición del objeto y luego genera el wasm con esos offsets.
- **Direcciones dentro del objeto:** `seg.main` / `seg.debug` / `seg.top-level` (importadas) + offset fijo. Las referencias a símbolos se resuelven por nombre al instanciar (`sym.<nombre>` → `intern_from_c`), sin tablas de enlace en el código.
- **`__link`:** exportada por cada módulo. Hace `table.grow(ref.func f)` de cada función y escribe el índice en su objeto `function`.

### ABI: una sola firma para todas las funciones GOAL

Se cambia `(i64 × n) → i64` por **`(i64 × 8) → i64` para todas**, y el llamador rellena con ceros. En x86, llamar a una función con más o menos argumentos de los que espera funciona, porque los registros sobrantes se ignoran, y GOAL lo usa: métodos, conversiones de tipo de función y `run-function-in-process`, que siempre pasa 6. Wasm comprueba la firma exacta en cada `call_indirect` y abortaría. Los 71 casos del oráculo siguen iguales a x86 con la nueva ABI.

### Llamadas entre C y GOAL

- **C → GOAL** (`call_goal`, `call_goal_on_stack`, mips2c): el objeto `function` contiene un índice de tabla, que para Emscripten es un puntero a función C. Llamar a GOAL desde C es una llamada indirecta normal a `u64(*)(u64 × 8)`, sin JS ni ensamblador ([`web/asm_funcs_web.cpp`](../patches/jak-project/)).
- **GOAL → C** (`format`, `print`, `malloc`...): en nativo, cada función C registrada lleva un stub de código máquina que salta a ella con los registros de GOAL. En wasm, `GOAL_C_FN(f)` genera por plantilla un adaptador `u64(u64 × 8)` a partir de la firma real de `f`: convierte cada argumento y extiende el resultado como en x86. Las funciones variádicas (`format`) usan `GOAL_C_STACK_FN`, que pasa los 8 argumentos como array. En nativo ambas macros son `(void*)f`, así que el código generado no cambia.
- **517 registros convertidos** de forma mecánica en los 4 juegos (`kscheme`, `kmachine`, `ksound`).

### Parches

| Parche | Contenido |
|---|---|
| `0005` | `goalc`: objetos GOAL para wasm (stubs, estáticos, módulo incrustado, `__link`), ABI de 8 argumentos |
| `0006` | Runtime: instanciar el código wasm al enlazar (`klink` de Jak 2), llamadas C ↔ GOAL, `GOAL_C_FN` |

### Pendiente en la fase 3

| Tarea | Estado |
|---|---|
| Aritmética, floats, control de flujo, llamadas, memoria | ✅ (3.2) |
| Datos estáticos y enlace real en `klink` | ✅ (3.3) |
| Llamadas a funciones C del runtime | ✅ (3.3) |
| Registros `vf` → SIMD128 | Pendiente |
| Pila de GOAL (`new 'stack`, `IR_GetStackAddr`), behaviors (`self`/`pp`), `arg3_is_pp` | Pendiente |
| Compilar el kernel GOAL real (`KERNEL.CGO`: `gcommon`, `gkernel`...) con el backend | Siguiente objetivo; incluye las `asm-func` del kernel |
| Suspend/resume con JSPI dentro del runtime | Pendiente; coste medido (3.1) |
| Jak 1 y Jak 3 en `klink` | Pendiente (solo Jak 2 enlaza wasm) |

### Reproducir

```sh
web/build_runtime.sh
JAK_PROJECT=web/work/jak-project backend/test.sh            # tests unitarios + oráculo x86
JAK_PROJECT=web/work/jak-project backend/test_runtime.sh    # GOAL/wasm dentro del runtime, en Chromium
```
