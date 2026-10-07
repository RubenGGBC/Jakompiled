# Fase 1: medición de riesgo de rendimiento

> **Resultado: el peor caso medido es ~2x, por debajo del umbral de 3x del plan. Se puede seguir.**
> En código escalar, un backend wasm sencillo más `wasm-opt` iguala o supera al x86 que emite hoy `goalc`. El coste real está en dos sitios: las llamadas (~+1 ns cada una por `call_indirect`) y el SIMD de V8 (~2x en el cuerpo de `matrix*!`).

Código y datos: [`bench/fase1/`](../bench/fase1/). Para reproducirlo no hace falta la ISO.

## Qué se ha medido

Tres funciones reales de Jak 2, copiadas literalmente, más una función vacía para aislar el coste de llamada:

| Función | Origen | Qué representa |
|---|---|---|
| `bench-nop` | (vacía) | Coste de una llamada GOAL a una función global |
| `matrix*!` | `engine/math/matrix.gc` | Matemática vectorial con registros `vf` (SIMD) |
| `sin` | `engine/math/trigonometry.gc` | Float escalar con conversiones int↔float |
| `string=` | `kernel/gstring.gc` | Enteros: bucle, cargas de bytes, ramas y booleanos GOAL |

Cada bucle llama a la función N veces **a través de su símbolo global**, como hace el juego. Se comparan cinco variantes:

| Variante | Cómo se obtiene |
|---|---|
| **goalc x86** (referencia) | El x86-64 real de `goalc`, ejecutado en el runtime de OpenGOAL con el kernel de Jak 2 |
| **wasm ingenuo** | WAT escrito a mano imitando lo que emitiría un backend directo desde el IR de `goalc` (ver ABI abajo) |
| **wasm + wasm-opt** | Lo anterior pasado por `wasm-opt -O3` (Binaryen) |
| C nativo | Las mismas funciones en C con `clang -O2`: el techo con un compilador maduro |
| C → wasm | El mismo C con `clang --target=wasm32 -O2 -msimd128` |

Las cinco variantes devuelven resultados idénticos en los cuatro bucles.

### ABI modelada para el backend wasm

Es la que propone el plan y la que asume [`bench.wat`](../bench/fase1/wasm/bench.wat):

- La memoria GOAL es la memoria lineal y un puntero GOAL es una dirección wasm.
- Los registros GPR son locales `i64`, con `i32.wrap_i64` en cada acceso a memoria.
- Los floats viajan en GPR mediante bitcast, como en el x86 de `goalc`.
- Los registros `vf` son locales `v128`, y `.mul.x.vf` se traduce como `f32x4.mul` + `i8x16.shuffle` (broadcast).
- `s7` es un global, `#f` = `s7` y `#t` = `s7 + 4`. Los booleanos se materializan como símbolos, igual que hace `goalc`.
- Una llamada global carga el valor del símbolo (el objeto `function`), lee de ahí el índice en la `Table` y hace `call_indirect`. Las firmas son uniformes por aridad: `(i64 × n) → i64`.
- La pila GOAL (`new 'stack`) es una pila en memoria lineal con un puntero global.

Para que la versión ingenua sea fiel, cada función se cotejó con el desensamblado de `goalc` ([`goalc_x86_disasm.txt`](../bench/fase1/results/goalc_x86_disasm.txt)).

## Resultados

Máquina: VM con 4 vCPU Intel Xeon a 2,1 GHz, Node 22 (V8 12.4, el motor de Chrome) y clang 18. Mediana de 7 repeticiones. **Ruido entre ejecuciones: ±15–20 %** (VM compartida).

**ns por iteración** (llamada + cuerpo):

| Benchmark | goalc x86 | wasm ingenuo | wasm + wasm-opt | **ratio wasm-opt / x86** | C nativo | C → wasm |
|---|---:|---:|---:|---:|---:|---:|
| llamada vacía | 1,33 | 2,35 | 2,44 | **1,8x** | 1,26 | 1,91 |
| `matrix*!` | 4,15 | 7,85 | 8,27 | **2,0x** | 4,82 | 7,38 |
| `sin` | 18,40 | 6,76 | 5,89 | **0,32x** | 9,09 | 5,56 |
| `string=` | 64,3 | 53,7 | 23,7 | **0,37x** | 12,0 | 15,9 |

En otras ejecuciones los ratios oscilaron entre 1,5x y 1,8x para la llamada y entre 1,3x y 2,0x para `matrix*!`. Los CSV completos están en [`bench/fase1/results/`](../bench/fase1/results/).

## Interpretación

### 1. Llamadas: unos +1 ns cada una (~1,8x)

Una llamada GOAL en wasm cuesta: cargar el símbolo, cargar el índice, `call_indirect` (con su comprobación de firma) y el prólogo de V8. El x86 de `goalc` hace `mov` + `add r15` + `call`. Incluso C → wasm paga un sobrecoste parecido (1,9 frente a 1,26 ns).

**Consecuencia:** el código GOAL que encadena muchas funciones pequeñas será el más penalizado. Mitigaciones para la fase 3:
- Usar `call` directo cuando el destino sea conocido en el mismo objeto.
- Inline de *getters* triviales.
- Medir la alternativa de guardar el índice de tabla en el propio símbolo, para ahorrarse una carga.

### 2. SIMD: el cuerpo de `matrix*!` tarda ~2x

Descontando la llamada, el cuerpo cuesta ~2,8 ns en x86 y ~5,8 ns en wasm. **LLVM tampoco lo hace mejor** (C → wasm: ~5,5 ns), así que el límite está en cómo V8 traduce SIMD128 y no en la calidad del backend. Se probó una alternativa (`f32x4.splat` + `extract_lane`) y salió peor (~9,4 ns), por lo que `i8x16.shuffle` es la traducción correcta del broadcast. Las funciones con mucho `vf` serán las más lentas en el navegador, pero dentro del margen.

### 3. Escalar: wasm iguala o supera al x86 actual de `goalc`

No es mérito de wasm, sino que `goalc` genera x86 poco optimizado:

- **`sin`**: `goalc` emite `cvtsi2ss xmm7, ebp` sin limpiar antes `xmm7`. Esa instrucción conserva el resto del registro, así que depende de su valor anterior, que es el acumulador de la iteración previa. Eso **encadena cada `sin` con el anterior** y anula el paralelismo de la CPU (18,4 ns). V8 rompe esa dependencia (~6 ns). Incluso el C nativo es más lento que wasm aquí (9,1 ns), así que este benchmark no debe leerse como "wasm es 3x más rápido". Lo que muestra es que la latencia de float escalar no penaliza en wasm.
- **`string=`**: `goalc` materializa cada `zero?`/`and`/`or` como símbolo `#t`/`#f` y lo compara con `#f`, con ramas en cada paso. Traducido tal cual a wasm queda en 53,7 ns. `wasm-opt` limpia esos patrones (selects y CSE) y V8 los convierte en `cmov`, con lo que baja a 23,7 ns.

**Consecuencia:** pasar por Binaryen no es opcional. La diferencia entre la versión ingenua y la optimizada llega a 2,3x en `string=`. La fase 3 debe emitir a través de Binaryen y ejecutar su optimizador sobre cada módulo.

## Qué NO mide esta fase

- **Suspend/resume con JSPI.** Entrar y salir de un proceso tendrá un coste por proceso y por frame que aquí no aparece. Es el siguiente riesgo a medir, al principio de la fase 3.
- **Programas grandes.** Son microbenchmarks con caché caliente. El tamaño del código, la presión en la caché de instrucciones y el tiempo de compilación de cientos de módulos (Liftoff → TurboFan) se medirán cuando haya un backend real.
- **Otros navegadores.** Solo se ha medido V8 (Chrome y Edge). SpiderMonkey y JavaScriptCore quedan pendientes.
- **mips2c.** Las funciones más pesadas del juego ya son C++ y las compilará Emscripten. Su ratio debería parecerse a la columna "C → wasm / C nativo": 1,3–1,5x en estas pruebas.

## Decisión

| Criterio del plan | Resultado |
|---|---|
| Ralentización ≤ 3x | ✅ Peor caso ~2x (SIMD), llamadas ~1,8x, escalar ≤ 1x |
| Seguir a la fase 2 | ✅ Sí |

Cambios para el plan:
1. **Fase 3:** emitir con Binaryen y ejecutar `wasm-opt` es requisito, no opción. La versión ingenua puede ser 2x más lenta.
2. **Fase 3:** optimizar las llamadas (`call` directo dentro del mismo objeto, menos cargas por llamada), porque son el sobrecoste más generalizado.
3. **Fase 3:** medir JSPI pronto, porque es la parte del rendimiento que falta.
4. **Opcional, aparte del port:** los defectos de codegen x86 encontrados (la dependencia falsa de `cvtsi2ss`, los booleanos materializados) se pueden reportar a OpenGOAL.
