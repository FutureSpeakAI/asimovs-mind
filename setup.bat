@echo off
REM ──────────────────────────────────────────────────────────────
REM Asimov's Mind — Setup Script (Windows)
REM One command to install the full Agent Friday ecosystem.
REM ──────────────────────────────────────────────────────────────

title Asimov's Mind Setup
color 0B

echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║         ASIMOV'S MIND — SETUP                   ║
echo   ║         Agent Friday Ecosystem Installer         ║
echo   ╚══════════════════════════════════════════════════╝
echo.

set "REPO_DIR=%~dp0"
set "FRIDAY_DATA=%USERPROFILE%\.friday"

REM ── Check prerequisites ──────────────────────────────────────
echo [1/7] Checking prerequisites...

python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

python -c "import sys; print(f'  Python {sys.version_info.major}.{sys.version_info.minor} found')"

node --version >nul 2>&1
if errorlevel 1 (
    echo   WARNING: Node.js not found. The Claude Code plugin requires Node 18+.
    echo   Install from: https://nodejs.org/
) else (
    for /f %%v in ('node --version') do echo   Node.js %%v found
)

REM ── Create .friday data directory ──────────────────────────────
echo [2/7] Creating data directory at %FRIDAY_DATA%...

if not exist "%FRIDAY_DATA%" mkdir "%FRIDAY_DATA%"
if not exist "%FRIDAY_DATA%\vault" mkdir "%FRIDAY_DATA%\vault"
if not exist "%FRIDAY_DATA%\integrity" mkdir "%FRIDAY_DATA%\integrity"
if not exist "%FRIDAY_DATA%\audio-cache" mkdir "%FRIDAY_DATA%\audio-cache"
if not exist "%FRIDAY_DATA%\vibe-code-logs" mkdir "%FRIDAY_DATA%\vibe-code-logs"
echo   Created %FRIDAY_DATA%\

REM ── Create Python virtual environment ──────────────────────────
echo [3/7] Creating Python virtual environment...

if not exist "%REPO_DIR%venv" (
    python -m venv "%REPO_DIR%venv"
    echo   Created venv\
) else (
    echo   venv\ already exists, skipping
)

call "%REPO_DIR%venv\Scripts\activate.bat"

REM ── Install Python dependencies ────────────────────────────────
echo [4/7] Installing Python dependencies...

pip install -q -r "%REPO_DIR%requirements.txt"
echo   All Python packages installed

REM ── Install Node.js dependencies ───────────────────────────────
echo [5/7] Installing Node.js dependencies...

node --version >nul 2>&1
if not errorlevel 1 (
    if exist "%REPO_DIR%mcp\friday-core\package.json" (
        pushd "%REPO_DIR%mcp\friday-core"
        npm install --silent 2>nul
        popd
    )
    if exist "%REPO_DIR%interfaces\desktop\package.json" (
        pushd "%REPO_DIR%interfaces\desktop"
        npm install --silent 2>nul
        popd
    )
    echo   Node packages installed
) else (
    echo   Skipped ^(Node.js not installed^)
)

REM ── Create .env from template ──────────────────────────────────
echo [6/7] Setting up environment...

if not exist "%REPO_DIR%.env" (
    copy "%REPO_DIR%templates\env.example" "%REPO_DIR%.env" >nul
    echo   Created .env from template — edit it with your API keys
) else (
    echo   .env already exists, skipping
)

REM ── Build Desktop UI ───────────────────────────────────────────
echo [7/7] Building Desktop UI...

if exist "%REPO_DIR%interfaces\desktop\build_ui.py" (
    pushd "%REPO_DIR%interfaces\desktop"
    python build_ui.py
    popd
    echo   Desktop UI assembled
) else (
    echo   Skipped
)

REM ── Done ───────────────────────────────────────────────────────
echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║         SETUP COMPLETE                          ║
echo   ╚══════════════════════════════════════════════════╝
echo.
echo   Next steps:
echo.
echo   1. Edit .env with your API keys:
echo      - GEMINI_API_KEY (for image/video/music generation)
echo      - ANTHROPIC_API_KEY (for Claude Code)
echo.
echo   2. Install the Claude Code plugin:
echo      claude plugin install .
echo.
echo   3. Start a Claude Code session and try:
echo      /friday          — talk to Agent Friday
echo      /status          — system health dashboard
echo      /onboard         — first-time personality setup
echo      /unlock          — initialize the encrypted vault
echo.
echo   4. Launch Friday Desktop (optional):
echo      call venv\Scripts\activate
echo      cd interfaces\desktop ^&^& python server.py
echo      Open http://localhost:3000
echo.
echo   5. Add Python MCP servers to Claude Code (optional):
echo      claude mcp add friday-core -- python mcp-servers\core-mcp\server.py
echo      claude mcp add friday-gemini -- python mcp-servers\gemini-mcp\server.py
echo.
echo   Data directory: %FRIDAY_DATA%
echo   Documentation: README.md, docs\, GETTING_STARTED.md
echo.

pause
