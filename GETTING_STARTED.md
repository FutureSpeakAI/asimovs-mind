# Getting Started with Asimov's Mind

## Prerequisites

- **Node.js 18+** -- required for the friday-core MCP server
- **Python 3.7+** -- required for governance hooks
- **Claude Code** -- installed and working
- **Ollama** (optional) -- for local-only operation without cloud API dependency

## Installation

```bash
# From the Claude Code marketplace
claude plugin add asimovs-mind

# OR from source
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

Run `/friday unlock` and choose a passphrase (minimum 8 words).

The vault encrypts all your state with AES-256-GCM. Your passphrase never leaves the machine.

For extra security, open the browser link shown in the output to enter your passphrase there. This keeps it out of the API transcript entirely.

### Step 2: Open the Friday Dashboard

Open `http://localhost:{port}/` in your browser (the port is shown in the unlock output). The dashboard shows system health, memory stats, trust graph, P2P peers, and all 17 subsystem status indicators in a Three.js holographic interface.

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

On each session start, unlock your vault:

```
/friday unlock
```

Or open the browser URL shown on startup to enter your passphrase without it touching the API transcript. Then open `http://localhost:{port}/` for the dashboard -- it shows all 17 subsystem status indicators, memory stats, trust summary, and P2P peers.

### Daily use

These three commands cover most of what you need at the start of a session:

| Command | What it does |
|---------|-------------|
| `/briefing` | What happened since your last session -- commits, discoveries, test results |
| `/memory recall "topic"` | Search Friday's 3-tier memory for anything related |
| `/trust "PersonName" reliability` | Check or update trust graph for a person or repo |
| `/status` | Rich system health -- vault, memory, trust, all 17 subsystems |
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
