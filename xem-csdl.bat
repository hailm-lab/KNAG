@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Mo giao dien dong lenh psql toi co so du lieu baogia. Go \dt de xem bang, \q de thoat.
node tools\pg.js psql
pause
