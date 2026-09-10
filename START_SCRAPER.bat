@echo off
title CSI Ultimate Scraper
cd /d "%~dp0app"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║     CSI Ultimate Scraper v1.0        ║
echo  ║    منصة السحب الاحترافية             ║
echo  ╚══════════════════════════════════════╝
echo.
echo  🚀 جاري تشغيل الخادم...
echo.

start /b "" node server.mjs > "%TEMP%\csi-server.log" 2>&1

echo  ⏳ انتظر حتى يتم تجهيز الخادم...
:waitloop
timeout /t 2 /nobreak >nul
netstat -an 2>nul | findstr "0.0.0.0:3456" >nul
if errorlevel 1 goto waitloop

echo  ✅ الخادم جاهز على http://localhost:3456
start "" http://localhost:3456

echo.
echo  اضغط Ctrl+C لإيقاف الخادم
echo.
pause >nul
