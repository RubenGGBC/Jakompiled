#!/usr/bin/env python3
"""Traduce los shaders de OpenGOAL (GLSL 4.10 core) a GLSL ES 3.00 para WebGL2.

GLSL ES no admite las conversiones implícitas entre int y float, sampler1D, noperspective ni
layout en las variables entre etapas, y los shaders las usan cientos de veces. En vez de
reescribirlos a mano, cada etapa pasa por el compilador de referencia de Khronos:

    GLSL 4.10 --glslang (SPIR-V para OpenGL)--> SPIR-V --SPIRV-Cross--> GLSL ES 3.00

SPIRV-Cross conserva los nombres de uniforms, atributos y variables entre etapas (el runtime
busca los uniforms por nombre) y escribe todas las conversiones de forma explícita.

Los marcadores que Shader.cpp sustituye en tiempo de ejecución (HEIGHT_SCALE...) dependen del
juego, así que se genera un directorio por juego.

Uso: glsl_es.py GLSLANG SPIRV_CROSS DIR_SHADERS DIR_SALIDA [jak1|jak2|jak3]
"""
import os
import re
import subprocess
import sys
import tempfile

glslang, spirv_cross, src_dir, out_dir = sys.argv[1:5]
game = sys.argv[5] if len(sys.argv) > 5 else "jak2"

# los mismos valores que Shader::Shader en game/graphics/opengl_renderer/Shader.cpp
height_scale = "1.0" if game == "jak1" else "0.5"
scissor_height = "448.0" if game == "jak1" else "416.0"
placeholders = {
    "HEIGHT_SCALE": height_scale,
    "SCISSOR_HEIGHT": scissor_height,
    "SCISSOR_ADJUST": f"(512.0 / {scissor_height})",
}


# noperspective no existe en GLSL ES. Solo se puede quitar si gl_Position.w es constante (entonces
# la interpolación con y sin perspectiva coincide). Comprobado a mano en cada shader de la lista.
NOPERSPECTIVE_W_IS_ONE = {"sky"}  # sky.vert: gl_Position = vec4(..., 1.0)


def postprocess(name, out):
    if "noperspective" not in out:
        return out, None
    if name not in NOPERSPECTIVE_W_IS_ONE:
        return None, "usa noperspective y no está comprobado que gl_Position.w sea constante"
    out = re.sub(r"#extension GL_NV_shader_noperspective_interpolation : require\n", "", out)
    return out.replace("noperspective ", ""), None


def preprocess(src):
    for k, v in placeholders.items():
        src = src.replace(k, v)
    return src


def translate(path, stage, tmp):
    src = preprocess(open(path).read())
    inp = os.path.join(tmp, f"in.{stage}")
    spv = os.path.join(tmp, f"out.{stage}.spv")
    open(inp, "w").write(src)
    # -G: SPIR-V para OpenGL (uniforms sueltos); --aml/--amb: ubicaciones automáticas
    r = subprocess.run([glslang, "-G", "--aml", "--amb", "-S", stage, "-o", spv, inp],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None, (r.stdout + r.stderr).strip()
    r = subprocess.run([spirv_cross, "--es", "--version", "300", spv], capture_output=True, text=True)
    if r.returncode != 0:
        return None, (r.stdout + r.stderr).strip()
    return r.stdout, None


os.makedirs(out_dir, exist_ok=True)
ok = failed = 0
with tempfile.TemporaryDirectory() as tmp:
    for name in sorted(os.listdir(src_dir)):
        m = re.match(r"(.+)\.(vert|frag)$", name)
        if not m:
            continue
        out, err = translate(os.path.join(src_dir, name), m.group(2), tmp)
        if out is not None:
            out, err = postprocess(m.group(1), out)
        if out is None:
            failed += 1
            print(f"== {name}\n{err}")
            continue
        open(os.path.join(out_dir, name), "w").write(out)
        ok += 1
print(f"[glsl_es] {ok} shaders traducidos, {failed} con errores ({game})")
sys.exit(1 if failed else 0)
