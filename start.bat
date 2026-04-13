@echo off
title FRIDAY Desktop — Live OS
color 0B

set GEMINI_API_KEY=AIzaSyCnAtHOMGadC6KLS93bdUT3ep34pKH27-w

echo.
echo   ╔══════════════════════════════════════╗
echo   ║     FRIDAY DESKTOP — LIVE SERVER     ║
echo   ╠══════════════════════════════════════╣
echo   ║  http://localhost:3000               ║
echo   ║  Flask + Gemini API                  ║
echo   ╚══════════════════════════════════════╝
echo.

cd /d C:\Users\swebs\Projects\friday-desktop

:: Activate venv and start server
call venv\Scripts\activate

:: Open browser after a short delay
start "" "http://localhost:3000"

:: Start Flask server (blocks until Ctrl+C)
python server.py

pause
