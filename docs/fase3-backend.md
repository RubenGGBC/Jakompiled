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
