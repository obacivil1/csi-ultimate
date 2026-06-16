@echo off
title CSI-Ultimate Interactive Launcher
cd /d "%~dp0"
echo [1/6] Checking project structure...
if not exist "core\run.mjs" (echo FAIL: core\run.mjs not found & pause & exit /b 1)
echo [2/6] Checking Node.js...
node --version >"%TEMP%\_csi_ver.tmp" 2>&1
if errorlevel 1 (echo FAIL: Node.js not found & type "%TEMP%\_csi_ver.tmp" 2>nul & pause & exit /b 1)
set /p NVER=<"%TEMP%\_csi_ver.tmp"
del "%TEMP%\_csi_ver.tmp" 2>nul
echo [3/6] Node %NVER%
echo [4/6] Loading site list...
echo [5/6] Preparing menu...
echo [6/6] Ready.
ping -n 2 127.0.0.1 >nul
cls
echo.
echo   ================================================
echo     CSI-Ultimate  -  Extraction Pipeline
echo   ================================================
echo.
echo   Select target site:
echo.
echo     1) Expatriates (Riyadh)
echo     2) Gumtree
echo     3) Craigslist London
echo     4) Preloved
echo     5) OLX Pakistan
echo     6) OpenSooq Saudi Arabia
echo     7) Indeed Saudi Arabia ^(requires CSI_INDEED_PUBLISHER_ID^)
echo.
echo     H) HARD MODE ^(headed + stealth, for Cloudflare sites^)
echo     E) EXTREME MODE ^(AI stealth + fingerprint rotation + RSS + API fallback^)
echo.
set /p "CHOICE=  Enter number [1-7] or H/E for stealth modes: "
if /i "%CHOICE%"=="E" set EXTREME=--extreme& set HARD= --hard& goto :pick_mode
if /i "%CHOICE%"=="H" set HARD=--hard& goto :pick_mode
if "%CHOICE%"=="1" set HOST=expatriates.com& set SNAME=Expatriates
if "%CHOICE%"=="2" set HOST=gumtree.com& set SNAME=Gumtree
if "%CHOICE%"=="3" set HOST=london.craigslist.org& set SNAME=Craigslist
if "%CHOICE%"=="4" set HOST=preloved.co.uk& set SNAME=Preloved
if "%CHOICE%"=="5" set HOST=olx.com.pk& set SNAME=OLX
if "%CHOICE%"=="6" set HOST=sa.opensooq.com& set SNAME=OpenSooq
if "%CHOICE%"=="7" set HOST=sa.indeed.com& set SNAME=Indeed
if not defined HOST (echo Invalid choice & pause & exit /b 1)
goto :input_key

:pick_mode
cls
echo.
echo   ================================================
echo     %EXTREME%%HARD% ^- %EXTREME: =-AI%Advanced Stealth
echo   ================================================
echo.
if defined EXTREME (
echo     Extreme: API fallback ^> RSS ^> Browser with AI stealth
echo     Full fingerprint rotation + human behavior mimicry
echo     Mobile UA + WebRTC + Canvas + WebGL spoofing
echo     Smart content wait + adaptive retry
echo.
) else (
echo     Hard: Headed browser + fresh context per ad
echo     WebGL/Canvas fingerprint spoofing
echo.
)
echo   Select target site:
echo.
echo     1) Expatriates (Riyadh)
echo     2) Gumtree
echo     3) Craigslist London
echo     4) Preloved
echo     5) OLX Pakistan
echo     6) OpenSooq Saudi Arabia
echo     7) Indeed Saudi Arabia ^(API/RSS fallback^)
echo.
set /p "SITE=  Enter number [1-7]: "
if "%SITE%"=="1" set HOST=expatriates.com& set SNAME=Expatriates
if "%SITE%"=="2" set HOST=gumtree.com& set SNAME=Gumtree
if "%SITE%"=="3" set HOST=london.craigslist.org& set SNAME=Craigslist
if "%SITE%"=="4" set HOST=preloved.co.uk& set SNAME=Preloved
if "%SITE%"=="5" set HOST=olx.com.pk& set SNAME=OLX
if "%SITE%"=="6" set HOST=sa.opensooq.com& set SNAME=OpenSooq
if "%SITE%"=="7" set HOST=sa.indeed.com& set SNAME=Indeed
if not defined HOST (echo Invalid choice & pause & exit /b 1)

:input_key
set CAT=Jobs
echo.
set /p "KEYWORD=  Keyword (e.g. Planning Engineer): "
set /p "TIME=  Timeframe [24h/3d/1w/2w/1m/3m/all] (default 1w): "
if "%TIME%"=="" set TIME=1w
cls
echo.
echo   ================================================
echo           Launching Extraction
echo   ================================================
echo.
echo     Site:      %SNAME% (%HOST%)
echo     Category:  %CAT%
echo     Keyword:   %KEYWORD%
echo     Timeframe: %TIME%
if defined EXTREME echo     Mode:      EXTREME (AI stealth + API fallback)
if defined HARD if not defined EXTREME echo     Mode:      HARD (headed + stealth)
echo.
echo   Running: node core/run.mjs %HOST% Jobs "%KEYWORD%" %TIME% --uat %HARD% %EXTREME%
echo.
echo   ================================================
echo   Press Ctrl+C to abort.
echo   ================================================
echo.
node core\run.mjs "%HOST%" "%CAT%" "%KEYWORD%" "%TIME%" --uat %HARD% %EXTREME%
echo.
echo   ================================================
echo   Extraction Complete! Check data\ folder.
echo   ================================================
echo.
pause