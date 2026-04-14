#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Asimov's Mind — Setup Script (macOS / Linux)
# One command to install the full Agent Friday ecosystem.
# ──────────────────────────────────────────────────────────────────
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
FRIDAY_DATA="${FRIDAY_DATA_DIR:-$HOME/.friday}"

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║         ASIMOV'S MIND — SETUP                   ║${NC}"
echo -e "${CYAN}  ║         Agent Friday Ecosystem Installer         ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Check prerequisites ──────────────────────────────────────────
echo -e "${YELLOW}[1/7] Checking prerequisites...${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}ERROR: Python 3 not found. Install Python 3.10+ first.${NC}"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "  Python $PYTHON_VERSION found"

if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}  WARNING: Node.js not found. The Claude Code plugin requires Node 18+.${NC}"
    echo -e "${YELLOW}  You can install it later: https://nodejs.org/${NC}"
else
    NODE_VERSION=$(node --version)
    echo "  Node.js $NODE_VERSION found"
fi

# ── Create .friday data directory ────────────────────────────────
echo -e "${YELLOW}[2/7] Creating data directory at $FRIDAY_DATA...${NC}"

mkdir -p "$FRIDAY_DATA/vault"
mkdir -p "$FRIDAY_DATA/integrity"
mkdir -p "$FRIDAY_DATA/audio-cache"
mkdir -p "$FRIDAY_DATA/vibe-code-logs"
echo "  Created $FRIDAY_DATA/"

# ── Create Python virtual environment ────────────────────────────
echo -e "${YELLOW}[3/7] Creating Python virtual environment...${NC}"

if [ ! -d "$REPO_DIR/venv" ]; then
    python3 -m venv "$REPO_DIR/venv"
    echo "  Created venv/"
else
    echo "  venv/ already exists, skipping"
fi

source "$REPO_DIR/venv/bin/activate"

# ── Install Python dependencies ──────────────────────────────────
echo -e "${YELLOW}[4/7] Installing Python dependencies...${NC}"
pip install -q -r "$REPO_DIR/requirements.txt"
echo "  All Python packages installed"

# ── Install Node.js dependencies (Claude Code plugin) ───────────
echo -e "${YELLOW}[5/7] Installing Node.js dependencies...${NC}"

if command -v node &> /dev/null; then
    cd "$REPO_DIR/mcp/friday-core"
    if [ -f "package.json" ]; then
        npm install --silent 2>/dev/null || echo "  npm install skipped (will auto-install on first run)"
    fi
    cd "$REPO_DIR"

    # Desktop OS (Playwright for testing)
    if [ -f "$REPO_DIR/interfaces/desktop/package.json" ]; then
        cd "$REPO_DIR/interfaces/desktop"
        npm install --silent 2>/dev/null || true
        cd "$REPO_DIR"
    fi
    echo "  Node packages installed"
else
    echo "  Skipped (Node.js not installed)"
fi

# ── Create .env from template ────────────────────────────────────
echo -e "${YELLOW}[6/7] Setting up environment...${NC}"

if [ ! -f "$REPO_DIR/.env" ]; then
    cp "$REPO_DIR/templates/env.example" "$REPO_DIR/.env"
    echo "  Created .env from template — edit it with your API keys"
else
    echo "  .env already exists, skipping"
fi

# ── Build Desktop UI ─────────────────────────────────────────────
echo -e "${YELLOW}[7/7] Building Desktop UI...${NC}"

if [ -f "$REPO_DIR/interfaces/desktop/build_ui.py" ]; then
    cd "$REPO_DIR/interfaces/desktop"
    python3 build_ui.py
    cd "$REPO_DIR"
    echo "  Desktop UI assembled"
else
    echo "  Skipped (build_ui.py not found)"
fi

# ── Done ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  ╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║         SETUP COMPLETE                          ║${NC}"
echo -e "${GREEN}  ╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Next steps:${NC}"
echo ""
echo "  1. Edit .env with your API keys:"
echo "     - GEMINI_API_KEY (for image/video/music generation)"
echo "     - ANTHROPIC_API_KEY (for Claude Code)"
echo ""
echo "  2. Install the Claude Code plugin:"
echo "     claude plugin install ."
echo ""
echo "  3. Start a Claude Code session and try:"
echo "     /friday          — talk to Agent Friday"
echo "     /status          — system health dashboard"
echo "     /onboard         — first-time personality setup"
echo "     /unlock          — initialize the encrypted vault"
echo ""
echo "  4. Launch Friday Desktop (optional):"
echo "     source venv/bin/activate"
echo "     cd interfaces/desktop && python3 server.py"
echo "     Open http://localhost:3000"
echo ""
echo "  5. Add MCP servers to Claude Code (optional):"
echo "     claude mcp add friday-core -- python3 mcp-servers/core-mcp/server.py"
echo "     claude mcp add friday-gemini -- python3 mcp-servers/gemini-mcp/server.py"
echo ""
echo -e "  ${YELLOW}Data directory: $FRIDAY_DATA${NC}"
echo -e "  ${YELLOW}Documentation: README.md, docs/, GETTING_STARTED.md${NC}"
echo ""
