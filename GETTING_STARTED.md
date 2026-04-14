# Getting Started with Asimov's Mind

## Prerequisites

| Requirement | Minimum | What it's for |
|------------|---------|---------------|
| Python | 3.10+ | Core systems, MCP servers, Desktop OS, hooks |
| Node.js | 18+ | Claude Code plugin (friday-core MCP server) |
| Claude Code | Latest | Plugin host |
| Anthropic API key | Required | Claude Code |
| Gemini API key | Optional | Image gen, TTS, video, music (gemini-mcp) |
| Ollama | Optional | Local-only operation (zero cloud dependency) |

## Installation

### One-Command Setup (Recommended)

```bash
git clone https://github.com/FutureSpeakAI/asimovs-mind.git
cd asimovs-mind

# Mac/Linux
./setup.sh

# Windows
setup.bat
```

The setup script:
1. Creates a Python virtual environment
2. Installs all Python dependencies (core systems, MCP servers, Desktop OS)
3. Installs Node.js dependencies for friday-core
4. Builds the Friday Desktop UI
5. Creates `.env` from template if not present

### Manual Installation

```bash
# Clone
git clone https://github.com/FutureSpeakAI/asimovs-mind.git
cd asimovs-mind

# Python dependencies
python -m venv .venv
source .venv/bin/activate    # Mac/Linux
.venv\Scripts\activate       # Windows
pip install -r requirements.txt

# Node.js dependencies
cd mcp/friday-core && npm install && cd ../..

# Build Desktop UI
cd interfaces/desktop && python build_ui.py && cd ../..

# Configure
cp templates/env.example .env
# Edit .env with your API keys

# Install as Claude Code plugin
claude plugin add .
```

### MCP Servers (Optional)

The Python MCP servers are independent of the Claude Code plugin and can be added separately:

```bash
# Core systems MCP (32 tools wrapping all 7 Python systems)
claude mcp add friday-core-py -- python mcp-servers/core-mcp/server.py

# Gemini creative capabilities (8 tools: image, TTS, video, music)
claude mcp add friday-gemini -- python mcp-servers/gemini-mcp/server.py
```

## First Session

Three steps. Takes about two minutes.

### Step 1: Initialize the Sovereign Vault

When the MCP server starts, it prints a local URL like `http://127.0.0.1:{port}/`. Open that URL in your browser. The passphrase gate lets you unlock the vault directly -- the passphrase is sent straight to the local HTTP bridge and never appears in the Claude Code conversation transcript.

This is the recommended path. Your passphrase is never exposed to the API channel.

Alternatively, run `/friday unlock` in the conversation and type your passphrase there (minimum 8 words). This works, but the passphrase will appear in the session transcript.

The vault encrypts all state with AES-256-GCM. The passphrase never leaves your machine.

### Step 2: Open the Friday Dashboard

The same URL you used for the passphrase gate is the dashboard. After unlocking, refresh it (or navigate to `http://127.0.0.1:{port}/`). The dashboard shows system health, memory stats, trust graph, P2P peers, and all 18 subsystem status indicators in a Three.js holographic interface.

### Step 3: Create Your Profile

Run `/onboard` and answer 8 questions about how you work.

Friday adapts to your preferences, communication style, and workflow patterns. Question 8 (the "mother question") calibrates anti-sycophancy and challenge level.

### You're Ready

Try these commands to explore what's available:

| Command | What it does |
|---------|-------------|
| `/help` | Categorized command reference |
| `/briefing` | Get your daily briefing |
| `/memory recall "auth"` | Search Friday's memory |
| `/trust "Alice"` | Check the trust graph |
| `/status` | Rich system health (calls 9 MCP tools) |
| `/discover` | Find and integrate code from GitHub |
| `/unleash` | Deploy the agent swarm |
| `/peer listen` | Start encrypted P2P communications |

## Subsequent Sessions

On each session start, open the browser URL shown on startup to enter your passphrase. This keeps it out of the API transcript entirely and is the recommended approach. The dashboard loads automatically after unlock.

If you prefer the conversation-based flow, run `/friday unlock` in the chat instead.

### Daily Use

| Command | What it does |
|---------|-------------|
| `/briefing` | What happened since your last session |
| `/memory recall "topic"` | Search Friday's 3-tier memory |
| `/trust "PersonName" reliability` | Check or update trust graph |
| `/status` | Rich system health -- vault, memory, trust, all 18 subsystems |
| `/help` | Categorized command reference for all skills |

## Python Core Systems

The 7 core Python systems in `core/` are standalone modules. You can use them independently of the Claude Code plugin:

```bash
# Run a specific system's tests
cd core/sovereign-vault && python -m pytest test_vault.py
cd core/trust-graph && python -m pytest test_trust_graph.py

# Use a system's CLI
cd core/trust-graph && python cli.py add "Alice" reliability 0.85
cd core/cognitive-memory && python cli.py store "The auth uses JWT" --tier short
cd core/epistemic-score && python cli.py log --independence 0.7
```

Each system also has a standalone repo under [FutureSpeakAI](https://github.com/FutureSpeakAI) -- see the [README](README.md) for links.

## Friday Desktop

The holographic desktop OS runs independently of Claude Code:

```bash
cd interfaces/desktop
python build_ui.py     # Build the UI from modular components
python server.py       # Start at http://localhost:3000
```

Features: 11 workspaces, Three.js 3D scene with 13 evolution structures, mood system, audio-reactive animation, MediaPipe hand/face tracking.

## Career-Ops Pipeline

The AI job search pipeline has its own setup:

```bash
cd tools/career-ops
npm install            # Playwright for PDF generation
node doctor.mjs        # Verify setup
```

See [tools/career-ops/README.md](tools/career-ops/README.md) for full documentation.

## Optional: Local-Only Mode

Run everything on your machine with zero cloud dependency.

1. Install [Ollama](https://ollama.ai)
2. Pull a model:
   ```bash
   ollama pull llama3.2
   ```
3. Activate local routing:
   ```
   /route local-only
   ```

All intelligence stays on your machine. No API keys, no billing, no data leaving your hardware. See `directives/local-sovereignty.md` for the full guide.

## For Hook Developers

Python hooks communicate with the MCP server through the HTTP bridge rather than stdio MCP. The bridge requires a bearer token for all write operations.

The token is generated at startup and written to `.asimovs-mind/vault/bridge-token` (permissions 0o600). Use `vault_bridge.py` from the plugin to handle this automatically:

```python
from vault_bridge import vault_read, vault_write, vault_available

if vault_available():
    data = vault_read('my-namespace:my-key')
    vault_write('my-namespace:my-key', {'updated': True})
```

`vault_bridge.py` reads the port from `.asimovs-mind/vault/port` and the bearer token from `.asimovs-mind/vault/bridge-token`, and includes `Authorization: Bearer <token>` on all authenticated requests automatically.

Note that vault keys use `:` as the namespace separator. Keys containing `/` are rejected by the vault.

## Troubleshooting

**"Vault server not available"**
Run `npm install` in the `mcp/friday-core/` directory.

**"python3 not found"**
Ensure Python 3 is in your PATH. On Windows, try `python` instead of `python3`.

**"Vault locked"**
Run `/friday unlock` to enter your passphrase.

**Dependencies won't install**
Verify Node.js 18+ (`node --version`) and Python 3.10+ (`python --version`).

**Desktop UI build fails**
Run `cd interfaces/desktop && python build_ui.py` manually.

## Next Steps

- `/remember` -- Teach Friday facts about your codebase that persist across sessions
- `/create-agent` -- Build custom specialist agents for your project
- `/iterate fix-tests` -- Run an autonomous test-repair loop
- `/govern verify` -- Audit governance integrity
- `/diagnose` -- Get a full codebase health check

See the [README](README.md) for the full architecture, standalone repo links, and credits.

Join us on [Discord](https://discord.gg/f2VM6qNk).
