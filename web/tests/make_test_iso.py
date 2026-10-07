#!/usr/bin/env python3
"""ISO de prueba para web/extract.html, sin ningún dato del juego (requiere pycdlib).

Tiene la misma forma que la ISO de Jak II (SYSTEM.CNF, SCUS_972.65, DGO/, CGO/...) pero los
ficheros son inventados: sirve para probar la lectura ISO9660, la escritura en OPFS y el arranque
del extractor, que debe fallar al validar porque el ejecutable no es el del juego.

Uso: make_test_iso.py SALIDA.iso
"""
import io
import sys

import pycdlib

iso = pycdlib.PyCdlib()
iso.new(interchange_level=1)


def add(path, data):
    iso.add_fp(io.BytesIO(data), len(data), path)


add("/SYSTEM.CNF;1", b"BOOT2 = cdrom0:\\SCUS_972.65;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n")
add("/SCUS_972.65;1", b"\x7fELF" + bytes(4092))
iso.add_directory("/DGO")
iso.add_directory("/CGO")
add("/DGO/TEST.DGO;1", bytes(range(256)) * 64)
add("/CGO/WATER_AN.CGO;1", b"water" * 1000)
# un fichero de más de un fragmento de 16 MB, para la copia por partes
add("/CGO/BIG.CGO;1", bytes(i % 251 for i in range(20 * 2**20)))
iso.write(sys.argv[1])
iso.close()
