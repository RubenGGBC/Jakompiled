#!/usr/bin/env python3
"""Fuentes de todo el código de Jak 2 (kernel, motor y niveles), en el orden de compilación.

El orden es el de las entradas (cgo-file "x.gd") de goal_src/jak2/game.gp: cada .gd en orden y,
dentro, sus objetos .o, cada uno la primera vez que aparece (así lo hace el macro cgo-file). Las
fuentes se buscan como en project-lib.gp: en goal_src/jak2 y, si no está, en goal_src/jak1.

Uso: code_sources.py JAK_PROJECT
"""
import os
import re
import sys

root = sys.argv[1]


def index(folder):
    found = {}
    for d, _, files in os.walk(os.path.join(root, folder)):
        for f in files:
            if f.endswith(".gc"):
                found.setdefault(f[:-3], os.path.join(d, f))
    return found


jak2, jak1 = index("goal_src/jak2"), index("goal_src/jak1")
gp = open(os.path.join(root, "goal_src/jak2/game.gp")).read()
seen = set()
for gd in re.findall(r'\(cgo-file "([^"]+)"', gp):
    text = open(os.path.join(root, "goal_src/jak2/dgos", gd)).read()
    for name in re.findall(r'"([^"]+)\.o"', text):
        if name in seen:
            continue
        seen.add(name)
        path = jak2.get(name) or jak1.get(name)
        if path:
            print(os.path.abspath(path))
        elif name != "collide-planes":  # sin fuente en Jak 2 (el original estaba vacío)
            sys.exit(f"code_sources.py: no hay fuente para {name}.o ({gd})")
