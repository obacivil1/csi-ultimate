@echo off
rem مُشغّل بلا نافذة سوداء — يستعمل pythonw.exe (لا يظهر أي طرفية).
rem للتشغيل المزدوج: انقر نقرًا مزدوجًا على start_gui.bat

cd /d "%~dp0"
where pythonw >nul 2>&1
if errorlevel 1 (
  echo لم أجد pythonw على الجهاز — ثبت بايثون وأعد المحاولة.
  pause
  exit /b 1
)
start "" pythonw "%~dp0gui\app.py"