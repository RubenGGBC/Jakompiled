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

### Reproducir

```sh
web/build_runtime.sh
JAK_PROJECT=web/work/jak-project backend/test.sh            # tests unitarios + oráculo x86
JAK_PROJECT=web/work/jak-project backend/test_runtime.sh    # GOAL/wasm dentro del runtime, en Chromium
```

## 3.4 El kernel GOAL de Jak 2, compilado a wasm, ejecuta procesos

> **Resultado: el kernel GOAL real de Jak 2 (`KERNEL.CGO`: `gcommon`, `gkernel`, `gstring`, `gstate`... 226 funciones) está compilado a WebAssembly y arranca en Chromium.** Construye sus pools de procesos, pasa la comprobación de versión del runtime y ejecuta el despachador en cada frame. Un objeto de prueba crea un proceso con las macros del juego, y el kernel lo planifica: el proceso se suspende y se reanuda entre frames, usa `catch`/`throw`, cambia de estado con `go` y se desactiva al terminar.

```
[info] Got correct kernel version 2.0
kernel: machine started
[GOAL/wasm] proceso arrancado en #<process process running :state #f :stack 0/256 :heap 384/16384 @ #x1d99b4>
[GOAL/wasm] proceso: frame 0 (reanudado por el kernel)
[GOAL/wasm] proceso: frame 1 (reanudado por el kernel)
[GOAL/wasm] proceso: frame 2 (reanudado por el kernel)
[GOAL/wasm] throw desde dentro del catch con 70
[GOAL/wasm] catch-frame devolvió 70
[GOAL/wasm] estado procs-final, argumento 42
[GOAL/wasm] procs-final: frame 0
[GOAL/wasm] procs-final: frame 1
[GOAL/wasm] fin del estado: el proceso se desactiva
```

Programa de prueba: [`backend/tests/runtime/procs.gc`](../backend/tests/runtime/procs.gc). El `#<process ...>` lo imprime el método `print` del tipo `process`, código GOAL del kernel. Después el kernel sigue ejecutando frames sin procesos, estable.

### El problema: las `asm-func` del kernel

En x86, el kernel cambia de proceso con ensamblador escrito en GOAL: guarda registros, copia la pila del proceso a una zona de respaldo y salta a direcciones guardadas. Wasm no tiene pila direccionable ni saltos arbitrarios. Sustitución:

| Primitiva x86 | Qué hace | En wasm |
|---|---|---|
| `thread-resume` | Restaura pila y registros, salta al `pc` del hilo | Arranca o despierta la **pila JSPI** del hilo; el hilo EE (kernel) queda suspendido hasta que el proceso cede |
| `thread-suspend` | Guarda pila y registros, vuelve al kernel | Cede a la pila del kernel (JSPI); la pila GOAL se respalda igual que en x86 |
| `set-to-run-bootstrap` | Primer código de un hilo: llama a la función guardada | Función GOAL normal, que corre en la pila nueva |
| `return-from-thread(-dead)`, `abandon-thread` | Vuelve al kernel desde el proceso | Excepción `ThreadExit` |
| `go` (desde el hilo principal) | Reinicia la pila y salta al código del nuevo estado | Excepción `ThreadRestart`, recogida al inicio de la pila del proceso |
| `catch-frame` / `throw-dispatch` | `setjmp`/`longjmp` | `try`/`catch` C++ con la excepción `GoalThrow` |
| `reset-and-call` | trans/post en un hilo temporal | Llamada con la pila GOAL del hilo, recogiendo `ThreadExit` |

- **La contabilidad sigue en GOAL.** El parche `0008` añade a `gkernel.gc` y `gstate.gc` una rama `(#cond ((eq? INSTRUCTION_SET 'wasm) ...))` con versiones GOAL de esas funciones. Mantienen la pila de respaldo, `stack-frame-top`, el estado del proceso y `top-thread` como en x86, y solo llaman al runtime (`jakompiled-*`) para lo que GOAL no puede hacer. **El kernel x86 compilado con los parches es idéntico byte a byte al original.**
- **Excepciones wasm nativas** (`-fwasm-exceptions`). JSPI no puede suspender a través de frames JS, y las excepciones de Emscripten basadas en JS los añaden. Con las nativas, el `throw` atraviesa frames C++ y GOAL sin problemas.
- **Dos pilas por proceso, más la GOAL.** Cada pila JSPI de proceso tiene además su propia **pila C** (`__stack_pointer` de Emscripten, 256 KB), que se cambia en cada reanudación y suspensión. Sin eso, los frames C++ de un proceso suspendido quedarían debajo del kernel y se pisarían. La pila GOAL (`env.sp`) y `pp` (`env.pp`) son globals wasm compartidos por todos los módulos.
- **JSPI con pthreads en Emscripten 6 funciona.** Lo verifiqué antes con un ejemplo mínimo: suspender dentro de `main` (con `PROXY_TO_PTHREAD`) y dentro de un pthread creado.

### Cambios en el backend

- `pp` (proceso actual, `r13`) y el puntero de pila GOAL son **globals `i64` mutables** importados (`env.pp`, `env.sp`). Los registros que el compilador fija a `r13` (`self` de los behaviors, `rlet` sobre `pp`) leen y escriben `env.pp`; `r14` (tabla de símbolos) lee `s7`.
- **Variables en la pila** (`new 'stack`, `IR_GetStackAddr`): marco alineado a 16 bytes en la pila GOAL, que vive en memoria GOAL como en la PS2.
- `INSTRUCTION_SET` vale `'wasm` al compilar con `goalc-wasm`; `(break)` → `unreachable`.
- `goalc-wasm --out-dir` compila varios ficheros en orden, como la construcción de un DGO. `--trap-unsupported` convierte en trampa (con nombre) las funciones que el backend aún no soporta: hoy, solo `print` de `vec4s`, que recibe un valor de 128 bits.

### Parches

| Parche | Contenido |
|---|---|
| `0007` | `goalc`: `pp`/`sp` globales, pila GOAL, `INSTRUCTION_SET 'wasm`, compilación multi-fichero |
| `0008` | `goal_src/jak2/kernel`: versiones wasm de las `asm-func` del kernel (+172 líneas) |
| `0009` | Runtime: procesos sobre pilas JSPI, excepciones, primitivas `jakompiled-*`; 80 registros más a `GOAL_C_FN` |

## 3.5 Instrucciones de 128 bits: todo el motor compila a wasm

> **Resultado: las 9.063 funciones de `GAME.CGO` (kernel + 436 ficheros del motor) compilan a wasm sin ninguna trampa.** Antes de esta sección, 1.096 funciones no compilaban. Las instrucciones nuevas dan el mismo resultado que el x86 de `goalc` en **464 de 464 casos**, incluidos NaN, ±inf, ±0 y valores fuera de rango.

### Medida de partida

Para saber qué faltaba, compilé con `goalc-wasm --trap-unsupported` los 444 objetos de `GAME.CGO`, en el orden del DGO. Una función que usa algo no soportado se compila como una trampa (`unreachable`) y se anota la primera instrucción que falló. Compilar todo el motor tarda ~15 s.

| Primera instrucción no soportada | Funciones |
|---|---:|
| `.sub.vf` | 283 |
| `.pcpyld` | 182 |
| `.mov` entre clases de registro (`IR_RegSetAsm`) | 171 |
| `.add.vf` | 96 |
| `.xor.vf` | 78 |
| `.splat.vf` | 59 |
| Argumentos de 128 bits | 54 |
| Puntero a símbolo en un registro no entero | 53 |
| `.wait.vf` (aparecía al resolver las anteriores) | 57 |
| `.mul.vf`, `.blend.vf`, `&var`, `.pxor`, `.pcpyud`, retornos de 128 bits... | resto |

Tras esta sección: **0**.

### Cómo se traduce

Cada instrucción reproduce la instrucción AVX que emite el x86, con el mismo orden de operandos que usa `IR.cpp`:

| GOAL | x86 | wasm |
|---|---|---|
| `.add/.sub/.mul/.div.vf` | `vaddps`... | `f32x4.add`... |
| `.max.vf a b` | `vmaxps`: `a > b ? a : b` (b si hay NaN) | `f32x4.pmax(b, a)`, que es exactamente eso |
| `.min.vf a b` | `vminps` | `f32x4.pmin(b, a)` |
| `.ftoi.vf` | `vcvttps2dq`: NaN y fuera de rango → `0x80000000` | `i32x4.trunc_sat_f32x4_s` + `v128.bitselect` con la máscara de rango |
| `.itof.vf`, `.sqrt.vf`, `.xor.vf` | `vcvtdq2ps`, `vsqrtps`, `vxorps` | `f32x4.convert_i32x4_s`, `f32x4.sqrt`, `v128.xor` |
| Máscaras (`:mask`), `.blend.vf` | `vblendps` | `i8x16.shuffle` |
| `.add.x.vf`..., `.splat.vf`, `.swizzle.vf` | `vshufps` | `i8x16.shuffle` |
| `.pext{l,u}{b,h,w}`, `.pcpyld`, `.pcpyud` | `vpunpck{l,h}{bw,wd,dq,qdq}` | `i8x16.shuffle` |
| `.pceq*`, `.pcgt*`, `.psubw`, `.paddb`, `.por`... | `vpcmpeq*`, `vpcmpgt*`... | `i*x*.eq`, `i*x*.gt_s`... |
| `.ppacb` (`vpackuswb`) | Bytes con saturación sin signo | `i8x16.narrow_i16x8_u` |
| `.pw.sll/srl/sra`, `.ph.sll/srl` | `vpslld`...: desplazar ≥ ancho da 0 (o el signo) | `i32x4.shl`..., con el caso ≥ ancho aparte (wasm usa el módulo) |
| `vpsrldq`, `vpslldq`, `vpshuflw`, `vpshufhw` | — | `i8x16.shuffle` con ceros |
| `.nop.vf`, `.wait.vf` | `nop`, `fwait` | Nada |

Otros tres cambios del ABI:

- **`&var`**: una variable cuya dirección se toma ya no es un local wasm. Vive en el marco de la función en la pila GOAL, detrás de las variables de pila, como en x86.
- **Argumentos y retornos de 128 bits**: la firma única `(i64 × 8) → i64` no los admite. El argumento i va en la ranura i de una zona fija de la memoria wasm (`WASM_SIMD_ARG_AREA`, debajo de la memoria EE) y el retorno en la ranura 8. Solo el hilo EE ejecuta GOAL, y la función los lee en el prólogo, antes de cualquier llamada o `suspend`.
- **`self` de un `defbehavior`** no cuenta para el límite de 8 argumentos (va en `pp`).

### Validación

[`tests/unit/simd.gc`](../backend/tests/unit/simd.gc) tiene 46 tests: todas las operaciones vf (con máscaras, broadcast y `outer.product`, que usa swizzle), todas las de enteros de 128 bits, una función recursiva que recibe y devuelve `uint128`, y `&var`. Se ejecuta con 5 pares de vectores que incluyen NaN, ±inf, −0, `3e9`, `INT_MIN` y bytes con el bit alto. Cada caso devuelve una mitad del resultado:

```
== comparación con x86 (goalc nativo)
464 iguales a x86, 0 distintos
```

Los 71 casos de `basic.gc` siguen idénticos, y las pruebas `hello` y `procs` en Chromium siguen pasando.

### Parche

| Parche | Contenido |
|---|---|
| `0010` | `goalc`: instrucciones vf y de enteros de 128 bits, `&var`, argumentos/retornos de 128 bits |

### Pendiente en la fase 3

| Tarea | Estado |
|---|---|
| Aritmética, floats, control de flujo, llamadas, memoria | ✅ (3.2) |
| Datos estáticos, enlace en `klink`, llamadas C ↔ GOAL | ✅ (3.3) |
| Kernel GOAL completo, procesos, suspend/resume, `go`, `catch`/`throw` | ✅ (3.4) |
| Registros `vf` → SIMD128, enteros de 128 bits | ✅ (3.5) |
| Argumentos y retornos de 128 bits, `&var` | ✅ (3.5) |
| Compilar `GAME.CGO` (motor del juego) con el backend | ✅ (3.5): 9.063 funciones, 0 trampas |
| Funciones mips2c (C++ llamado desde GOAL con el ABI de la PS2) | Pendiente: las usa el motor |
| Cargar y ejecutar `GAME.CGO` en el runtime web | Siguiente objetivo |

### Reproducir

```sh
web/build_runtime.sh                                       # gk, Binaryen, goalc-wasm y KERNEL.CGO en wasm
JAK_PROJECT=web/work/jak-project backend/test.sh           # tests unitarios + oráculo x86
JAK_PROJECT=web/work/jak-project backend/test_runtime.sh   # hello + kernel con procesos, en Chromium
```
