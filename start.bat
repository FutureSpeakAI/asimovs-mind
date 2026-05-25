@echo off
title FRIDAY Desktop — Live OS
color 0B

set GEMINI_API_KEY=AIzaSyCnAtHOMGadC6KLS93bdUT3ep34pKH27-w
:: PASTE Anthropic API key below (used for all text chat / reasoning). Get one at https://console.anthropic.com
set ANTHROPIC_API_KEY=
:: Optional override: defaults to claude-sonnet-4-6 (standard). Use claude-opus-4-7 for heavier reasoning, claude-haiku-4-5-20251001 for snappy lookups.
set ANTHROPIC_MODEL=claude-sonnet-4-6
set FRIDAY_USERNAME=stephen@futurespeak.ai
set FRIDAY_PASSWORD=ILoveLibbyLoo0506!!
set FRIDAY_SECRET_KEY=friday-session-secret-changeme

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
start "" "http://loc