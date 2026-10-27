@echo off
chcp 65001 >nul
cd /d "%~dp0"
node --no-warnings tools\backup.js
pause
