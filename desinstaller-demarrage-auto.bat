@echo off
rem Retire le démarrage automatique de la caisse (les données sont conservées).
chcp 65001 >nul
title Retirer le démarrage automatique de la caisse

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Demande des droits administrateur...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\uninstall-autostart.ps1"
echo.
pause
