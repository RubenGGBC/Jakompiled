@echo off
rem Jakompiled: servidor local + pagina de extraccion. Doble clic en el Explorador.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Falta Node.js: instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este fichero.
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8080/extract.html"
echo Servidor en http://localhost:8080 - cierra esta ventana para pararlo.
node serve.mjs . 8080
