@echo off
REM ============================================================
REM  Sim Clash: arcade 1v1 golf for real launch monitors.
REM  Double-click to play from this source folder.
REM  (Open-Birdie.bat, beside this file, starts the original
REM  simulator instead.)
REM  Needs Node.js 22 or newer (https://nodejs.org). The first
REM  run installs the dependencies, which takes a few minutes.
REM  Close GSPro or any other simulator first: they use the same
REM  launch-monitor port (921) as this game.
REM ============================================================
cd /d "%~dp0"
set BIRDIE_PRODUCT=
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found. Install Node.js 22 or newer from
  echo  https://nodejs.org and double-click this file again.
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo  npm install failed. See the messages above.
    pause
    exit /b 1
  )
)
echo.
echo Starting Sim Clash...
echo (Keys: arrows aim, B ball tray, number keys arm a power-up ball, S sound on/off, F11 full screen.)
echo.
call npm start
if errorlevel 1 pause
