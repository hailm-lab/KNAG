@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo CANH BAO: lenh nay XOA toan bo du lieu hien tai va nap lai du lieu mau ban dau.
set /p OK=Go DONG Y de tiep tuc: 
if /i not "%OK%"=="DONG Y" (
  echo Da huy.
  pause
  exit /b 0
)
node --no-warnings server\seed.js --reset
pause
