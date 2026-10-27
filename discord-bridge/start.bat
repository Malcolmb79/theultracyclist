@echo off
title Ultra Cyclist Discord bridge
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node bridge.mjs
pause
