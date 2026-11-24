@echo off
REM ============================================================
REM  Double-click this file to open Open-Birdie (desktop app):
REM  the original golf simulator this repository is built on.
REM  The arcade game is "Sim Clash.bat", beside this file.
REM  It launches the Electron app, which starts the local
REM  server and opens the game window automatically.
REM ============================================================
cd /d "%~dp0"
REM  This repository starts the game unless it is told otherwise (docs/sim-clash-shell.md).
set BIRDIE_PRODUCT=open-birdie
echo Starting Open-Birdie...
echo (A game window will open in a few seconds.)
echo.
call npm start
if errorlevel 1 (
  echo.
  echo -------------------------------------------------------
  echo  Open-Birdie did not start.
  echo  First-time setup? Install Node.js from https://nodejs.org
  echo  then, in this folder, run:  npm install
  echo -------------------------------------------------------
  pause
)
