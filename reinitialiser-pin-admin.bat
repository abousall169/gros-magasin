@echo off
rem Donne un nouveau code PIN à un administrateur qui a oublié le sien (à lancer sur l'ordinateur serveur).
chcp 65001 >nul
title Nouveau code PIN administrateur
cd /d "%~dp0"
echo.
echo   Nouveau code PIN pour un administrateur
echo.
node --disable-warning=ExperimentalWarning server\reset-pin.js
echo.
pause
