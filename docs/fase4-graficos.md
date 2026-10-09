# Fase 4: gráficos en WebGL 2

> **Estado: con la ISO real el juego se ve y se juega con teclado hasta la cárcel.** Logos de la intro, pantalla de título con Haven City de fondo, menú principal, New Game, cinemáticas y la cárcel con escenario, personajes (Jak), sombras y efectos. Chrome no informa de ningún error de WebGL desde el arranque hasta la cárcel. El sonido por Web Audio está implementado y probado por el usuario (0028). Falta probar el mando y más allá de la cárcel; las partículas 3D presentan rayas de colores pendientes de diagnóstico. Detalles en [4.2](#42-con-la-iso-real-lo-que-webgl-2-no-acepta).

Antes (sin datos de la ISO): `gk` crea un contexto WebGL 2 desde su hilo principal (una pthread), compila los **92 shaders** del renderer traducidos a GLSL ES y ejecuta el bucle de render a la vez que el EE arranca el kernel.

Prueba: `index.html?display=1` (kernel) o `?boot=game&display=1` (motor).

## Qué hace falta y qué no

El renderer de OpenGOAL usa OpenGL 4.3 core. WebGL 2 equivale a OpenGL ES 3.0. Inventario:

| | Cantidad | Solución |
|---|---:|---|
| Funciones GL distintas que usa el renderer | 104 | 91 existen en WebGL 2 |
| Funciones que no existen en WebGL 2 | 13 | Equivalentes en [`web/gl_web.cpp`](../patches/jak-project/0013-jakompiled-web-OpenGOAL-s-OpenGL-renderer-on-WebGL-2.patch) (tabla abajo) |
| Shaders (GLSL 4.10 core) | 92 (46 programas) | Traducción automática a GLSL ES 3.00 |

### Shaders: glslang + SPIRV-Cross

Una traducción ingenua (solo cambiar `#version`) compila 8 de 46 programas. Casi todos los errores son conversiones implícitas entre `int` y `float`, que GLSL 4.10 permite y GLSL ES no: hay cientos. Además aparecen `sampler1D` y `noperspective`.

[`web/glsl_es.py`](../web/glsl_es.py) pasa cada shader por las herramientas de referencia de Khronos:

```
GLSL 4.10 --glslang--> SPIR-V (OpenGL) --SPIRV-Cross--> GLSL ES 3.00
```

SPIRV-Cross conserva los nombres (el runtime busca uniforms y atributos por nombre), escribe todas las conversiones explícitas y cambia `sampler1D` por `sampler2D`. `noperspective` solo aparece en `sky`, donde `gl_Position.w` es siempre 1 y la interpolación es la misma con o sin perspectiva; el script solo lo quita en los shaders comprobados así.

Resultado en WebGL 2 (Chromium, [`web/tests/test-shaders.mjs`](../web/tests/test-shaders.mjs)):

```
[glsl] 46/46 programas compilan y enlazan en WebGL2
```

Los shaders traducidos están en `game/graphics/opengl_renderer/shaders_es/jak2/` (parche `0013`) y van incrustados en `gk.wasm`. Los valores que `Shader.cpp` sustituye en tiempo de ejecución (`HEIGHT_SCALE`...) dependen del juego, así que hay un directorio por juego.

### Las 13 funciones que faltan

| OpenGL 4.3 | Uso en el renderer | En WebGL 2 |
|---|---|---|
| `glPrimitiveRestartIndex` | Siempre `UINT32_MAX` | WebGL 2 reinicia siempre en el índice máximo: nada |
| `glPolygonMode` | Vista de alambre (depuración) | Nada |
| `glTexImage1D`, `glTexSubImage1D` | Colores por hora del día, tabla del limo | Textura 2D de altura 1 (los shaders ya usan `sampler2D`) |
| `glMultiDrawElements` | tfrag, tie, shrub | Un `glDrawElements` por dibujo |
| `glFramebufferTexture` | Cielo, océano | `glFramebufferTexture2D` |
| `glGetTexLevelParameteriv` | Tamaño de texturas | Tamaños apuntados al crear cada textura |
| `glGetTexImage` | Lectura de texturas | A través de un framebuffer y `glReadPixels` |
| `glColorMaski` | Siempre el buffer 0 | `glColorMask` |
| `glClearDepth` | | `glClearDepthf` |
| `glTexImage2DMultisample` | MSAA | Sin MSAA en web |
| `glDebugMessage*` | Mensajes de depuración | Nada |

Además, `gl_web.cpp` convierte `GL_TEXTURE_1D` en `GL_TEXTURE_2D` y `GL_UNSIGNED_INT_8_8_8_8_REV` (38 usos) en `GL_UNSIGNED_BYTE`, que con `GL_RGBA` son los mismos bytes en una máquina little-endian. También ignora capacidades que solo existen en escritorio (`GL_PRIMITIVE_RESTART`, `GL_DEBUG_OUTPUT`...).

glad carga todo como si fuera OpenGL 4.3. Las funciones que el navegador no tiene quedan a NULL, y `gl_web.cpp` las rellena.

### Contexto y bucle de render

- SDL3 ya sabe crear contextos WebGL 2. En web se pide un perfil ES 3.0.
- El `<canvas>` se transfiere como OffscreenCanvas a la pthread de `main()` (`-sOFFSCREENCANVASES_TO_PTHREAD=#canvas`), que es donde OpenGOAL ejecuta su bucle de render.
- En cada `SDL_GL_SwapWindow`, SDL hace `emscripten_sleep(0)`, que con JSPI suspende el bucle y devuelve el control al navegador para que presente el frame.

### Incompatibilidad encontrada al arrancar

`FramebufferTexturePair` (océano) ponía el nivel *i* de mipmap en `COLOR_ATTACHMENT0 + i` con `drawBuffers = {COLOR_ATTACHMENT0 + i}`. En WebGL 2, igual que en GLES, la entrada *i* de `drawBuffers` solo puede ser `COLOR_ATTACHMENTi`. En web cada nivel va en el attachment 0 de su framebuffer, como ya hace el resto del renderer al dibujar.

### Sin datos de la ISO

Sin `GAME.fr3` (texturas comunes, que genera el extractor), el renderer arranca en web con un nivel común vacío y sin animaciones de textura, como Jak 1. Así se puede probar todo lo demás sin la ISO.

## 4.2 Con la ISO real: lo que WebGL 2 no acepta

Con los `.fr3` y los DGO montados desde la ISO (en OPFS), el renderer ya tenía datos. Lo primero que se vio fueron los menús (2D) bien y el juego en 3D casi vacío: solo partículas y brillos sobre negro, y luego el escenario sin personajes. En todos los casos la causa era la misma: OpenGL de escritorio tolera cosas que WebGL 2 rechaza, y WebGL 2 no deja que fallen en silencio: **rechaza el draw o la llamada entera** y sigue.

| Síntoma | Causa | Arreglo | Parche |
|---|---|---|---|
| Escenario (tfrag, tie, shrub, hfrag) en negro, solo partículas | Los vertex shaders declaran el índice de color por hora del día como `int` (y `uv`, `vi` en hfrag) y el renderer lo pasa sin signo (`glVertexAttribIPointer` con `GL_UNSIGNED_SHORT/BYTE/INT`). WebGL 2 exige que el tipo base coincida: `Vertex shader input type does not match the type of the bound vertex attribute` | `web/glsl_es.py` declara esos atributos sin signo en las versiones GLSL ES y los convierte (`in uint X_u;` + `#define X int(X_u)`), lista `UNSIGNED_ATTRIBUTES` | 0025 |
| Colores del escenario a negro | La textura de colores por hora del día se crea con `GL_UNSIGNED_INT_8_8_8_8` (sin `_REV`), que WebGL 2 no admite: la textura no se crea | `gl_web.cpp`: sin datos, `GL_UNSIGNED_BYTE` | 0025 |
| Texturas animadas que no existen; `glGenerateMipmap` falla | `TextureAnimator` crea texturas con formato interno sin tamaño `GL_RED` | `GL_R8` (y `GL_RG` → `GL_RG8`) | 0025 |
| Personajes invisibles (se ve la sombra de Jak pero no su malla) | El loader sube los índices de merc y hfrag con el buffer de índices enlazado a `GL_ARRAY_BUFFER`. WebGL 2 no deja enlazar un *element array buffer* a otro target: el `bindBuffer` falla, los índices van al buffer de vértices y el de índices queda a cero, así que cada triángulo es un punto | `gl_web.cpp` enlaza esos buffers a `GL_COPY_WRITE_BUFFER` (que admite cualquier buffer) y redirige los `glBufferData`/`glBufferSubData` que siguen | 0026 |
| Glow: `glBlitFramebuffer: Depth/stencil buffer format combination not allowed` | La textura de profundidad de las sondas del glow se recrea con `GL_DEPTH_COMPONENT` sin tamaño y recibe un blit del framebuffer `D24S8`; WebGL 2 solo hace blit entre formatos idénticos | `GL_DEPTH24_STENCIL8` | 0027 |
| Cientos de `texParameter: no texture bound to target` | `EyeRenderer` pone parámetros de textura antes de enlazar ninguna. En escritorio se aplican a la textura por defecto (sin efecto) | Se ignoran sin textura enlazada | 0027 |

Lo que se descartó por el camino, para no volver a mirarlo:

- Los modelos de los personajes sí están en los `.fr3` (por ejemplo `jak-highres-prison` en `ldjakbrn.fr3`) y el loader los carga; los avisos de modelo que falta solo salen en los primeros fotogramas, mientras el nivel se carga.
- Las matrices de huesos que Merc2 lee de la memoria de GOAL son correctas (rotaciones ortonormales, traslaciones en coordenadas del mundo): el cálculo de huesos en wasm funciona.
- El layout `std140` del bloque `ub_bones` coincide con lo que sube el C++ (128 bytes por hueso).

### Cómo se depura

- **Los errores de WebGL salen en la consola del worker** que tiene el OffscreenCanvas, no en la de la página, y Playwright no los ve. Con CDP: `Target.setAutoAttach` a nivel de navegador con `flatten` (navegar de `about:blank` a una página con COOP/COEP cambia de proceso y de target, así que adjuntarse a la página antes de navegar no sirve) y `Log.enable` en cada sesión. **Chrome solo informa de los 32 primeros errores por contexto**: los errores repetidos esconden los demás, por eso conviene dejar la consola limpia.
- **Qué renderer falla**: envolver en `gl_web.cpp` `glUseProgram` y `glDrawElements`/`glDrawArrays`, y contar draws, índices y `glGetError` por shader (nombre desde `Shader::Shader`). Así se vio que shrub tenía todos sus draws rechazados y que tfrag/tie no dibujaban nada.
- **Quién hace una llamada**: `EM_ASM({ err(new Error().stack) })` da la pila con nombres de función (el módulo se compila con `--profiling-funcs`); `emscripten_get_callstack` devuelve vacío en esta pthread.
- **Llegar a una escena con Playwright**: el input lee el estado del teclado una vez por fotograma, así que hay que mantener la tecla ~1,5 s; y es más fiable guiarse por la consola del juego (`Load soundbank menu1` = menú abierto, `introcst` = partida empezada, `GAMEPLAY: enter prison`) que por tiempos.

## 4.3 Teclado (parche 0024)

Con `-sPROXY_TO_PTHREAD`, el bucle de gráficos (`Gfx::Loop`) corre en una pthread que nunca vuelve al bucle de eventos de su worker. SDL registra los eventos de teclado del navegador desde ese hilo, y Emscripten se los entrega como llamadas encoladas a ese hilo, que solo se ejecutan cuando procesa su cola. `GLDisplay::process_sdl_events` llama a `emscripten_current_thread_process_queued_calls()` antes de `SDL_PollEvent` en cada fotograma. (El cambio está en el código de OpenGOAL, no en SDL.)

Teclas por defecto de OpenGOAL:

| Tecla | Botón |
|---|---|
| Enter | Start |
| Espacio | X (confirmar, saltar) |
| E / F / R | Círculo / Cuadrado / Triángulo |
| Flechas | Cruceta (menús) |
| WASD | Stick izquierdo |
| IJKL | Stick derecho (cámara) |
| Q / O | L1 / R1 |
| 1 / P | L2 / R2 |

## Lo siguiente

- Diagnosticar las rayas de las partículas 3D: reproducir en CPU los cálculos de `sprite3_3d.vert`, comprobar uniforms y clipping. Desactivar los sprites 3D elimina las rayas; las pruebas de cuaterniones no muestran errores.
- Completar la medición del bucle de render. El log `[perf]` (0029) mide unos 47 fps en el título: EE 0,8 ms, render 4,3 ms y swap 5,6 ms; faltan partes del bucle por medir.
- Probar el mando. SDL3 usa el mapping estándar del navegador; la ausencia de `sdl_controller_db.txt` no demuestra un fallo.
- Jugar más allá de la cárcel y anotar lo que falle.

El parche 0028 implementa cubeb sobre Web Audio: hilo productor → búfer circular en memoria wasm → AudioWorklet. El audio arranca con la primera tecla o clic (`[audio] running`) y el usuario ha confirmado que suena bien. El parche 0029 usa `GL_NEAREST` para muestrear profundidad en glow; corrige su oclusión, pero no las rayas de los sprites 3D.

## 4.4 Diagnóstico de partículas en Windows (2026-10-08)

Se repitió el flujo con la ISO local y un perfil aislado de Chrome: 150 DGO/CGO, 0 objetos faltantes y arranque desde OPFS. Se capturaron secuencias de la introducción y del título. En estas capturas no se reprodujo el abanico de triángulos descrito anteriormente; eso no demuestra que esté arreglado en otros equipos.

La réplica CPU de `sprite3_3d.vert` detecta quads próximos al plano de cámara y esquinas con `w` de signos distintos. Una comparación independiente mediante transform feedback en WebGL 2 reproduce las posiciones CPU dentro del error de coma flotante, incluso para esos quads. La lectura de `camera`, `hvdf_offset` y `pfog0` con `glGetUniformfv` coincide exactamente con lo enviado; tanto las subidas como las lecturas devuelven error GL 0.

No se cambia el shader sin una reproducción del fallo. La instrumentación y las capturas permanecen en `web/work/` (ignorado por git); las capturas y las trazas derivadas de la ISO no se distribuyen.

### Diagnóstico opcional en macOS (Apple M1, Chrome 146)

El usuario reproduce brillos defectuosos y polígonos estirados del escenario con
`ANGLE Metal Renderer: Apple M1`, Chrome 146.0.7680.177, macOS 26.6.2.
El usuario confirma que `split-strips` elimina los artefactos, con una bajada de
rendimiento. Esto acota el fallo a la ruta de dibujo con primitive restart; no
identifica por sí solo el defecto interno de ANGLE. `gpu-diagnostics.js` permite comparar modos sobre
el mismo perfil y origen, sin recompilar ni volver a extraer la ISO:

- `?boot=game&display=1&gpu-test=split-strips`: separa los draws de tiras y abanicos
  en los índices de reinicio. Conserva orden, winding e instancias. Lee los índices
  cuando cambia el buffer y puede reducir el rendimiento. Permite investigar la
  ruta de primitive restart sin cambiar las posiciones de los vértices.
- `?boot=game&display=1&gpu-test=no-sprites3d`: oculta solo los sprites de modo 3
  del shader `sprite3_3d`, conservando sus modos 2D/HUD y el resto de shaders.
- `?boot=game&display=1&gpu-test=triangles`: convierte las tiras/abanicos con
  reinicios a una lista de triángulos y realiza una llamada por draw original.
  Conserva winding y provoking vertex, guarda las conversiones por buffer/rango
  y las libera al actualizar o eliminar el buffer. Evita repetir la lectura,
  conversión y subida de rangos estáticos. El usuario indica caídas junto a
  tuberías con humo, pero la inspección posterior de Chrome confirma que la
  pestaña seguía en `split-strips`; no valida el rendimiento de `triangles`.
  Sprite3 sube índices con `glBufferData` cada frame:
  ahora se copian desde la fuente CPU de esa llamada, sin leerlos de la GPU.
  Si son idénticos se conserva la conversión; `bufferSubData` actualiza la copia
  CPU respetando offsets y longitudes de las sobrecargas usadas por Emscripten.
  Pendiente de medir los FPS del cambio en la escena de las tuberías.

El script instala los hooks también en los pthreads que ejecutan el renderer.
Sin esos parámetros no instala hooks. Los catorce tests de
`node --test web/tests/test-gpu-diagnostics.mjs` comprueban la redirección de
workers, separación de índices de 8/16/32 bits, offsets, instancias, caché e
invalidación y selección del shader, además de conversión de triángulos,
liberación de buffers y reutilización de mil tiras en un draw. Son tests de
lógica con WebGL simulado; queda pendiente comparar el modo `triangles` en la
escena del usuario.

## 4.5 Ritmo de fotogramas en Windows (parche 0030)

La prueba `web/tests/test-frame-pacing.mjs`, con un perfil de Chrome aislado y la ISO ya extraída, fallaba con una mediana de 39,5 fps. Las nuevas medidas completan el bucle: input, eventos, GUI y tiempo restante, además de render, limitador y presentación.

Dos esperas añadían retrasos que no eran trabajo del motor: los temporizadores encadenados de `SDL_GL_SwapWindow` costaban unos 4,8 ms por fotograma; `std::this_thread::sleep_for` usa `Atomics.wait` en Emscripten, y en este Windows una espera solicitada de 1 o 5 ms tarda unos 15,6 ms.

El runtime web usa `requestAnimationFrame` del worker para el limitador habitual, conservando el objetivo de FPS con plazos acumulados. Tras una pausa larga reinicia el plazo. Sin limitador, o con el modo avanzado de lag, cede mediante `MessageChannel`; el limitador avanzado y el build nativo conservan su implementación. La opción de vsync nativa no controla la presentación de WebGL. El ritmo normal queda limitado por la frecuencia de presentación del navegador.

Resultado del mismo test: **60,0 / 60,0 / 60,0 fps**, mediana **60,0** (umbral: 55). EE: 0,2–0,4 ms; render: 6,0–7,4 ms; GUI: 2,5–3,4 ms; limitador/presentación: el resto hasta 16,7 ms. No es una medida del resto de niveles.

También pasan cinco pruebas deterministas (`node web/tests/test-web-frame-clock.mjs`): objetivos de 30 y 60 fps, pantalla de 144 Hz, pausa larga y cambio de objetivo. El test de rendimiento requiere `PROFILE`, `CHANNEL=chrome` y `PLAYWRIGHT`, igual que `play.mjs`.

Solo cambian `gk.js` y `gk.wasm`: no hace falta extraer de nuevo ni reconstruir los DGO.

## 4.6. Fibras de procesos desactivados (2026-10-08)

El parche 0031 elimina la entrada JSPI y libera la pila C antes de devolver un proceso desactivado a su pool. Cuando el proceso se mata a sí mismo, ThreadExit conserva la responsabilidad de liberar la pila al salir. Una prueba sin ISO crea y mata 160 procesos suspendidos: antes retenía 160 fibras y después quedan cero. También pasa la regresión de suspensión, catch, cambio de estado y autodesactivación.

Distribución recompilada con el nuevo kernel. Como cambia código GOAL, hay que reconstruir los DGO en OPFS (`extract.html?steps=build`); selecciona de nuevo la ISO en esa página para iniciar el proceso, que reutiliza los datos ya extraídos.

Validación del 0031 con ISO real: DGO reconstruidos correctamente, título e introducción a 60 fps; en la cárcel, múltiples ventanas estables de 60 fps, movimiento, golpe, salto y muerte/reaparición por teclado sin excepciones registradas. AudioContext activo. Ningún mando conectado (`getGamepads`: cuatro entradas vacías). El recorrido completo más allá de la cárcel sigue pendiente.

Revisión independiente: sin hallazgos importantes. La prueba automática cuenta las fibras JSPI; no mide directamente la memoria de las pilas C. La liberación y eliminación de su mapa se han revisado en el código.
