@echo off
rem Démarre le logiciel de caisse (Windows). Double-cliquez sur ce fichier.
chcp 65001 >nul
title Caisse - logiciel du magasin (laissez cette fenêtre ouverte)
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installé sur cet ordinateur.
  echo   Téléchargez la version LTS sur https://nodejs.org puis relancez ce fichier.
  start "" https://nodejs.org/fr/download
  pause
  exit /b 1
)

if not exist node_modules (
  echo   Première installation : une connexion Internet est nécessaire une seule fois...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo   L'installation a échoué. Vérifiez la connexion Internet puis relancez.
    pause
    exit /b 1
  )
)

start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"
node --disable-warning=ExperimentalWarning server\index.js
echo.
echo   Le logiciel est arrêté.
pause
