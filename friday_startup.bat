@echo off
:: FRIDAY Desktop — Startup Script
:: Starts Flask server and opens Chrome with stephencwebster@gmail.com profile

cd /d C:\Users\swebs\Projects\friday-desktop

:: Set environment
set GEMINI_API_KEY=AIzaSyCnAtHOMGadC6KLS93bdUT3ep34pKH27-w
set FRIDAY_USERNAME=stephen@futurespeak.ai
set FRIDAY_PASSWORD=ILoveLibbyLoo0506!!
set FRIDAY_SECRET_KEY=friday-session-secret-changeme
set PYTHONIOENCODING=utf-8

:: Activate venv if it exists
if exist venv\Scripts\activate (
    call venv\Scripts\activate
)

:: Start Flask server in the background (new minimized window)
start "FRIDAY Server" /min python server.py

:: Wait for server to be ready (poll port 3000)
:waitloop
timeout /t 1 /nobreak >nul
powershell -Command "try { $r = Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto waitloop

:: Open Chrome with the stephencwebster@gmail.com profile (Default)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory=Default http://localhost:3000

:: Start Cloudflare Tunnel for remote access
:: Install cloudflared if not present: winget install cloudflare.cloudflared
where cloudflared >nul 2>&1
if %errorlevel%==0 (
    echo Starting Cloudflare Tunnel...
    start "FRIDAY Tunnel" /min cmd /c "cloudflared tunnel --url http://localhost:3000 > "%USERPROFILE%\.friday\tunnel-log.txt" 2>&1"
    :: Wait for tunnel URL to appear in log, then save it
    powershell -Command "$tries=0; while($tries -lt 15){ Start-Sleep 2; $tries++; $log = Get-Content '%USERPROFILE%\.friday\tunnel-log.txt' -ErrorAction SilentlyContinue; $m = $log | Select-String 'https://[^ ]*\.trycloudflare\.com'; if($m){ $url=$m.Matches[0].Value; $url | Out-File '%USERPROFILE%\.friday\tunnel-url.txt' -Encoding utf8; Write-Host \"  [FRIDAY] Tunnel: $url\"; exit 0 } }; Write-Host '  [FRIDAY] Tunnel URL not found yet — check ~/.friday/tunnel-log.txt'"
) else (
    echo [FRIDAY] cloudflared not found. Install with: winget install cloudflare.cloudflared
    echo [FRIDAY] Skipping tunnel — local access only.
)
