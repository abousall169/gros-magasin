@echo off
rem Démarre le logiciel de caisse (Windows). Double-cliquez sur ce fichier.
chcp 65001 >nul
title Caisse - logiciel du magasin (laissez cette fenêtre ouverte)
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000

rem --- Déjà en marche (par exemple grâce au démarrage automatique) ?
curl -s -m 2 http://127.0.0.1:%PORT%/api/health 2>nul | find "grand-magasin" >nul
if not errorlevel 1 (
  echo.
  echo   La caisse tourne déjà sur cet ordinateur : rien à faire.
  echo   Ouvrez http://localhost:%PORT% dans le navigateur.
  echo   Pour l'arrêter : desinstaller-demarrage-auto.bat
  start "" http://localhost:%PORT%
  pause
  exit /b
)

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

rem --- Le certificat HTTPS couvre aussi le point d'accès mobile de Windows, même activé après la caisse.
set "TLS_NAMES=192.168.137.1,%TLS_NAMES%"
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"
node --disable-warning=ExperimentalWarning server\index.js
echo.
echo   Le logiciel est arrêté.
pause
