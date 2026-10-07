#!/usr/bin/env python3
"""Empaqueta objetos GOAL en un DGO/CGO (mismo formato que common/util/DgoWriter.cpp).

Uso: make_dgo.py SALIDA.CGO objeto1.o [objeto2.o ...]
El nombre de cada objeto dentro del DGO es el nombre del fichero sin extensión.
"""
import os
import struct
import sys


def cstr(text, n):
    data = text.encode()[: n - 1]
    return data + b"\0" * (n - len(data))


out, objects = sys.argv[1], sys.argv[2:]
blob = struct.pack("<I", len(objects)) + cstr(os.path.basename(out), 60)
for path in objects:
    data = open(path, "rb").read()
    blob += struct.pack("<I", len(data)) + cstr(os.path.splitext(os.path.basename(path))[0], 60) + data
    blob += b"\0" * (-len(blob) % 16)
open(out, "wb").write(blob)
print(f"{out}: {len(objects)} objetos, {len(blob)} bytes")
