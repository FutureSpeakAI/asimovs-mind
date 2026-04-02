# Getting Started with Asimov's Mind

## Prerequisites

- **Node.js 18+** -- required for the friday-core MCP server
- **Python 3.7+** -- required for governance hooks
- **Claude Code** -- installed and working
- **Ollama** (optional) -- for local-only operation without cloud API dependency

## Installation

```bash
# Install directly from GitHub
claude plugin add https://github.com/FutureSpeakAI/asimovs-mind

# OR clone and install from source
git clone https://github.com/FutureSpeakAI/asimovs-mind.git
claude plugin install ./asimovs-mind
```

The friday-core server auto-installs its npm dependencies on first start. If this fails, run manually:

```bash
cd path/to/asimovs-mind/mcp/friday-core && npm install
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

### Step 4: You're Ready

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

On each session start, open the browser URL shown on startup to enter your passphrase. This keeps it out of the API transcript entirely and is the recommended approach. The dashboard loads automatically after unlock -- it shows all 18 subsystem status indicators, memory stats, trust summary, and P2P peers.

If you prefer the conversation-based flow, run `/friday unlock` in the chat instead.

### Daily use

These three commands cover most of what you need at the start of a session:

| Command | What it does |
|---------|-------------|
| `/briefing` | What happened since your last session -- commits, discoveries, test results |
| `/memory recall "topic"` | Search Friday's 3-tier memory for anything related |
| `/trust "PersonName" reliability` | Check or update trust graph for a person or repo |
| `/status` | Rich system health -- vault, memory, trust, all 18 subsystems |
| `/help` | Categorized command reference for all skills |

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
Verify Node.js 18+ (`node --version`) and Python 3.7+ (`python3 --version` or `python --version`).

## Next Steps

- `/remember` -- Teach Friday facts about your codebase that persist across sessions
- `/create-agent` -- Build custom specialist agents for your project
- `/iterate fix-tests` -- Run an autonomous test-repair loop
- `/govern verify` -- Audit governance integrity
- `/diagnose` -- Get a full codebase health check

See the [README](README.md) for architecture details, the research behind governance, and the full feature set.
