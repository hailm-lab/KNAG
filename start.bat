@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js ban 22 tro len: https://nodejs.org
  pause
  exit /b 1
)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NV=%%v
if %NV% LSS 22 (
  echo Can Node.js ban 22 tro len, may dang co ban %NV%.
  pause
  exit /b 1
)
if not exist node_modules\pg (
  echo Dang cai thu vien pg lan dau...
  call npm install --no-audit --no-fund
)
if not exist client\dist\index.html node tools\build-client.js
if "%PORT%"=="" set PORT=8080
start "" cmd /c "timeout /t 6 >nul & start http://localhost:%PORT%"
echo Dang khoi dong PostgreSQL rieng va may chu (lan dau mat khoang 20 giay)...
node --no-warnings server\server.js
pause
