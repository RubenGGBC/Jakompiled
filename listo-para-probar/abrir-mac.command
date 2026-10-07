#!/bin/bash
# Jakompiled: servidor local + página de extracción. Doble clic en Finder (o ./abrir-mac.command).
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Falta Node.js: instálalo desde https://nodejs.org (versión LTS) y vuelve a abrir este fichero."
  read -r -p "Pulsa Enter para cerrar"
  exit 1
fi
(sleep 1; open "http://localhost:8080/extract.html") &
echo "Servidor en http://localhost:8080 — cierra esta ventana para pararlo."
node serve.mjs . 8080
