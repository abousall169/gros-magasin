@echo off
rem Fait démarrer la caisse toute seule avec ce PC (même après une coupure de courant).
chcp 65001 >nul
title Installer le démarrage automatique de la caisse

rem --- Droits administrateur (démarrage avant l'ouverture de session et ouverture du pare-feu)
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Demande des droits administrateur...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
echo.
echo   La caisse va démarrer toute seule avec ce PC, et redémarrer seule si elle s'arrête.
echo.
choice /c ON /m "  Empêcher la mise en veille du PC sur secteur (recommandé pour un serveur) "
set SLEEP=
if %errorlevel%==1 set SLEEP=-PreventSleep

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-autostart.ps1" -Mode Boot %SLEEP%
echo.
pause
