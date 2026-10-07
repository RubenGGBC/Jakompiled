# Fase 4: gráficos en WebGL 2

> **Estado: el renderer de OpenGOAL arranca en el navegador.** `gk` crea un contexto WebGL 2 desde su hilo principal (una pthread), compila los **92 shaders** del renderer traducidos a GLSL ES y ejecuta el bucle de render a la vez que el EE arranca el kernel. El canvas sale negro porque todavía no hay nada que pintar: las texturas y los niveles (`.fr3`) salen de la ISO del usuario.

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

## Lo siguiente

- Comprobar que el navegador presenta los frames: con datos de la ISO habrá algo que ver.
- Leer los `.fr3` y los DGO desde OPFS (salida del extractor).
- Medir el rendimiento con un nivel real (draw calls, `glMultiDrawElements` en bucle).
