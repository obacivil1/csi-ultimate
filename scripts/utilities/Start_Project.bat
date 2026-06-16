@echo off
title CSI-Ultimate Launcher
cd /d "%~dp0"

echo =====================================================
echo   CSI-Ultimate — Classifieds Intelligence Platform
echo   Professional Multi-Site Search Engine
echo =====================================================
echo.

:: Kill any leftover processes
taskkill /f /im "node.exe" 2>nul
taskkill /f /im "chrome.exe" 2>nul
timeout /t 2 /nobreak >nul

:: Optional: set CSI_PROXY=http://user:pass@host:port for proxy support
:: set CSI_PROXY=

:: Start Engine Server (port 3031 — main search UI)
set CSI_PORT=3031
echo [1/2] Starting Search Engine on http://localhost:3031 ...
if defined CSI_PROXY (
  echo   Proxy enabled: %CSI_PROXY%
)
start "CSI Search Engine" /min cmd /c "node engine/server.mjs"

:: Wait for server to start
echo [2/2] Waiting for server...
timeout /t 8 /nobreak >nul

echo.
echo =====================================================
echo   CSI-Ultimate is now running!
echo =====================================================
echo.
echo   Search Portal:  http://localhost:3031/search.html
echo   Validation:     http://localhost:3031
echo.
echo   Anti-Detection:
echo   - Stealth plugin + Cloudflare bypass (navigator, webdriver masking)
echo   - Rotating User-Agent, viewport, locale, timezone per session
echo   - Retry logic with block detection (Cloudflare, CAPTCHA, rate-limit)
echo   - Optional proxy: set CSI_PROXY env var before launching
echo   - Image blocking for faster page loads
echo.
echo   No login required — just open and use.
echo.
echo   Search Flow:
echo   1. Select a website from the 6 available sites
echo   2. Choose a real category from that site
echo   3. Set time period (24h / 3d / 1w / 2w / 1m / 3m / All)
echo   4. Enter keyword (e.g. "planning engineer")
echo   5. Click "Start Search" — watch live progress
echo   6. Export results to Excel / CSV / JSON
echo.
echo   Close this window to stop all servers.
echo =====================================================
echo.

:: Open browser to the search page
start http://localhost:3031/search.html

:: Wait and keep window open
pause
taskkill /f /im "node.exe" 2>nul >nul
