#!/usr/bin/env python3
"""Entradas de GAME.CGO (goal_src/jak2/dgos/game.gd) en orden, para build_game.sh.

Uso: game_cgo_entries.py JAK_PROJECT EMPTY_TPAGE_DIR(0|1)
Imprime "code <fuente.gc>" por cada objeto de código y, con EMPTY_TPAGE_DIR=1, "data dir-tpages"
donde va el directorio de texturas. Los demás datos (.go) salen de la ISO y no se incluyen.
"""
import os
import re
import sys

root, empty_tpage_dir = sys.argv[1], sys.argv[2] == "1"


def index(folder):
    found = {}
    for d, _, files in os.walk(os.path.join(root, folder)):
        for f in files:
            if f.endswith(".gc"):
                found.setdefault(f[:-3], os.path.join(d, f))
    return found


jak2, jak1 = index("goal_src/jak2"), index("goal_src/jak1")
gd = open(os.path.join(root, "goal_src/jak2/dgos/game.gd")).read()
for name, ext in re.findall(r'"([^"]+)\.(o|go)"', gd):
    if ext == "go":
        if name == "dir-tpages" and empty_tpage_dir:
            print("data dir-tpages")
        continue
    path = jak2.get(name) or jak1.get(name)
    if path:
        print("code " + path)
    elif name != "collide-planes":
        sys.exit(f"game_cgo_entries.py: no hay fuente para {name}.o")
