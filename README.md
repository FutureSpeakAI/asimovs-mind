# Asimov's Mind

### The complete Agent Friday ecosystem. 18 subsystems. 91+ MCP tools. 7 core Python systems. Holographic desktop. AI career pipeline.

Asimov's Mind is the overarching AI agent architecture. Agent Friday is the AI persona that runs on it. Friday Desktop is one of its interfaces. This repo bundles the complete ecosystem:

- **Claude Code Plugin** — 18 subsystems, 91 MCP tools, 17 slash commands, 10 Python hooks, 16 specialist agents
- **7 Core Python Systems** — Sovereign Vault, Privacy Shield, Trust Graph, Cognitive Memory, Personality Evolution, Epistemic Score, HMAC Integrity
- **Python MCP Servers** — Core systems FastMCP server (33 tools) + Gemini creative capabilities (8 tools: image gen, TTS, video, music)
- **Friday Desktop** — Holographic OS with Flask backend, React frontend, Three.js 3D visualization with 13 evolution structures
- **Career-Ops** — AI-powered job search pipeline (evaluation, CV generation, portal scanning, batch processing)

All state AES-256-GCM encrypted. Ed25519 cryptographic identity. Privacy Shield PII scrubbing. Ollama local-first routing. Coordinated N-agent swarm. Bounded by Asimov's cLaws.

Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI). Standing on the shoulders of [Karpathy's autoresearch](https://github.com/karpathy/autoresearch).

> **New here?** Run `setup.sh` (Mac/Linux) or `setup.bat` (Windows) and you're up in two minutes.

---

## Quick Start

```bash
# Clone and install everything
git clone https://github.com/FutureSpeakAI/asimovs-mind.git
cd asimovs-mind

# One-command setup (creates venv, installs deps, builds UI)
./setup.sh          # Mac/Linux
setup.bat           # Windows

# Edit .env with your API keys
# Then install the Claude Code plugin:
claude plugin add .

# First session
/friday unlock              # initialize encrypted vault
/onboard                    # meet Agent Friday (8-question interview)
/status                     # system health dashboard
```

Open `http://localhost:{port}/` for the holographic dashboard. See [GETTING_STARTED.md](GETTING_STARTED.md) for the full walkthrough.

---

## What Agent Friday Is

Agent Friday is not a generic coding assistant. It is a governed AI runtime with a persistent identity, encrypted memory, and the ability to earn your trust over time.

Friday remembers what you worked on last session. It knows which repos have been reliable and which agents perform best. It detects sycophancy and pushes back when you need it. It runs overnight improvement loops under governance that makes unsupervised operation safe. And it coordinates a swarm of specialist agents that grows to fit the work.

Every piece of state is encrypted on your machine. The passphrase never leaves. The governance cannot be overridden.

---

## Architecture

The `friday-core` MCP server loads 18 subsystems in dependency order, exposing 91 MCP tools (plus 4 connector meta-tools that dispatch to ~65 dynamic connector tools) and a holographic dashboard.

```
                      friday-core MCP Server
                      ======================
Tier 0 (Foundation)
  +-- Vault          10 tools   AES-256-GCM state, Argon2id KDF, BLAKE2b sub-keys
  +-- Identity        6 tools   Ed25519 signing, X25519 exchange, attestation
  +-- Privacy         4 tools   PII scrubbing, session-scoped placeholders
  +-- Ollama          1 tool    Local LLM health monitoring

Tier 1 (Transport)
  +-- P2P             7 tools   WebSocket transport, ECDH channels, pairing

Tier 2 (Intelligence)
  +-- LLM             6 tools   3 providers, intelligence router, budget tracking
  +-- Memory          8 tools   3-tier storage, embeddings, semantic search
  +-- Context         4 tools   Knowledge graph, entity extraction, injection
  +-- Trust           7 tools   Person-level graph, hermeneutic re-evaluation
  +-- Personality     7 tools   Evolution, calibration, anti-sycophancy

Tier 3 (Services)
  +-- Agents          7 tools   Recursive delegation, deadlock detection
  +-- Tools           4 tools   Registry, execution delegate, safety gates
  +-- Connectors    4+~65       8 connectors, dynamic dispatch
  +-- Gateway         5 tools   Trust tiers, session mgmt, audit logging
  +-- Briefing        3 tools   Daily briefing, meeting prep, meeting intel
  +-- Voice           3 tools   State machine, fallback manager
  +-- Enterprise      5 tools   Consent gate, cloud gate, confidence, commitments
  +-- Session         1 tool    Uptime, cwd context, greeting, commitments
                   ------
                   91 tools + holographic dashboard
```

10 Python hooks enforce governance at the Claude Code level: protected zone enforcement, AST safety scanning, PII scrubbing/rehydration, session ledger, agent performance tracking, personality loading, governance integrity verification, session learning, vault bridge auth, and crash safety.

17 slash commands (`/friday unlock`, `/onboard`, `/discover`, `/unleash`, `/remember`, `/status`, `/help`, and more) provide the user-facing interface.

Full architecture documentation: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

---

## Subsystems at a Glance

| Subsystem | Tools | What it does |
|-----------|:-----:|-------------|
| Vault | 10 | AES-256-GCM encrypted state with Argon2id KDF and BLAKE2b sub-keys |
| Identity | 6 | Ed25519 signing, X25519 key exchange, cLaw attestation |
| Privacy | 4 | PII detection and scrubbing (7 categories, FNV-1a placeholders) |
| Ollama | 1 | Local LLM health monitoring and model discovery |
| P2P | 7 | Encrypted peer-to-peer communication (WebSocket + ECDH + Ed25519) |
| LLM | 6 | 3-provider routing (Anthropic, OpenRouter, Ollama) with budget tracking |
| Memory | 8 | 3-tier storage (short/medium/long), Ollama embeddings, semantic search |
| Context | 4 | Knowledge graph with automatic entity extraction and context injection |
| Trust | 7 | Person-level trust graph, 5 dimensions, hermeneutic re-evaluation |
| Personality | 7 | Profile, 6 adaptive dimensions, anti-sycophancy, mood, evolution |
| Agents | 7 | Recursive delegation, awareness mesh, deadlock detection, teams |
| Tools | 4 | Dynamic tool registry with safety levels and audit trail |
| Connectors | 4+~65 | 8 connector modules (~65 dynamic tools): git, terminal, powershell, perplexity, firecrawl, comms |
| Gateway | 5 | 5-tier trust hierarchy, session management, append-only audit log |
| Briefing | 3 | Daily briefings, meeting prep, post-meeting intelligence |
| Voice | 3 | Voice pipeline state machine and fallback coordination |
| Enterprise | 5 | Consent gates, cloud gates, confidence scoring, commitment tracking |
| Session | 1 | Uptime, working directory context, greeting, pending commitments |

Per-subsystem deep dive: **[docs/SUBSYSTEM_GUIDE.md](docs/SUBSYSTEM_GUIDE.md)**

---

## Security Hardening (v2.2.0 -- v2.3.0)

v2.2.0 opened with a full security audit. v2.3.0 continued with 50 improvement cycles -- covering persistence, P2P, dashboard, hooks, and testing. The swarm ran on itself.

### Security (v2.2.0)

- **Path traversal blocked** -- vault keys validated against strict allowlist; resolved paths checked for containment; keys capped at 128 characters
- **Governance bypass closed** -- absolute paths into the plugin root no longer skip protected-zone checks in `first-law.py`
- **HTTP bridge authenticated** -- write endpoints require a bearer token generated at startup; `/tool/:name` restricted to 4 read-only tools; body size capped at 4 MB
- **P2P locked to loopback** -- WebSocket server binds `127.0.0.1`, not `0.0.0.0`
- **Signature-before-decrypt** -- P2P protocol verifies Ed25519 signatures before decrypting message payloads
- **Safety scanner hardened** -- writes to `hooks/` and `governance/` always scanned regardless of provenance markers
- **Dead code removed** -- `mcp/vault-server/` (160 KB precursor to friday-core) deleted

### Architecture and Persistence (v2.3.0)

- **OllamaMonitor extracted** -- single shared instance via `deps`; no more duplicate polling loops
- **SessionSubsystem** added as the 18th subsystem; `session_status` tool no longer registered directly in `main()`
- **State persistence fixed** -- `state.get`/`state.set` bugs resolved across 8 subsystems; state now survives restarts correctly
- **Namespace separator** -- vault key namespace separator changed from `/` to `:`; vault now rejects `/` in key names
- **Parallel tier startup** -- subsystem tiers start concurrently within each tier; startup time reduced
- **O(1) intelligence router** -- LLM routing no longer iterates all models on every request

### P2P and Dashboard (v2.3.0)

- **P2P handshake completes** -- full ECDH + HKDF key derivation now runs to completion; session keys derived correctly
- **HKDF key derivation** -- proper HKDF added to P2P channel setup
- **Ed25519 signature verification** -- incoming P2P message signatures verified against stored peer public keys
- **XSS fixed in dashboard** -- all user-supplied values rendered through `escHtml()` before insertion into the DOM
- **Content Security Policy** -- dashboard now emits a CSP header blocking inline script injection

### Hooks and Testing (v2.3.0)

- **Hook auth fix** -- hooks correctly read and send the vault bridge bearer token on all authenticated requests
- **Crash safety** -- hooks handle missing stdin, malformed JSON, and vault-unavailable gracefully without crashing the tool call
- **Stdin handling** -- hooks no longer block indefinitely when stdin is closed
- **Test count** -- 159 tests at v2.2.0 start; 442 tests (264 + 178) at v2.3.0, zero failures; new files cover P2P handshake, dashboard escaping, hook edge cases, and subsystem persistence

Full changelog: **[CHANGELOG.md](CHANGELOG.md)**

---

## Asimov's cLaws

Governance is not a constraint on autonomy. It is what enables autonomy at scale.

**First Law -- Do No Harm.** Protected zones block writes to governance files, credentials, and vault state. AST safety scanning blocks dangerous code patterns before they reach your project.

**Second Law -- Obey Protocol.** Directives define editable surfaces, budgets, and circuit breakers. The discovery pipeline enforces a mandatory sequence: scout, scan, adapt, test, keep/discard.

**Third Law -- Preserve Progress.** Git commit on improvement, git revert on regression. Append-only session ledger. Provenance tracking on all imported code.

**Meta-Law -- Governance Immutability.** No agent can modify the governance framework. Safety floors can be raised but never lowered. HMAC-SHA256 integrity verification runs at every session start.

Our research showed ungoverned agents crash 56% of the time. Governed agents crash 22%. The governed swarm degrades 3x slower. Paper and code: [asimovs-mind-research](https://github.com/FutureSpeakAI/asimovs-mind-research).

---

## Neural Binding (v2.1.0)

The subsystems are not isolated silos. The neural binding layer wires them into a single intelligence.

**Event Wiring** (`core/wiring.js`) -- 10 cross-subsystem event subscriptions. Trust changes flow to memory and briefing. Agent completions update the context graph. Privacy scrubs log to enterprise audit. Vault unlock cascades to load all stateful subsystems.

**Session Conductor** (`core/session-conductor.js`) -- Orchestrates session lifecycle: working directory detection, overdue commitment check, briefing staleness, personality-aware greeting. One event replaces a dozen manual tool calls.

**Epistemic Independence Score** (`core/eis.js`) -- Measures how much the user pushes back against Friday. Three signals: verification frequency, query complexity, correction rate. The EIS backs the anti-sycophancy claim with a running metric. When independence declines, challenge level increases.

---

## The Dashboard

Open `http://localhost:{port}/` after unlocking the vault. The holographic dashboard shows:

- Vault status and Ollama health indicators
- 18 subsystem status dots (clickable for detail)
- Memory particle field (400 particles colored by tier, bound to real memory entries)
- Neural grid with connection lines and a central orb (pulse rate tracks event activity)
- P2P peer list and trust summary
- Memory search bar (queries the 3-tier store from the browser)
- Passphrase gate (unlock without touching the API transcript)

Built with Three.js. Live-polling every 5 seconds. Mobile-responsive via Tailscale.

---

## See It in Action

```bash
/friday unlock                                         # open the encrypted vault
/onboard                                               # meet Agent Friday
/status                                                # system health (calls 9 MCP tools)
/briefing                                              # daily briefing
/memory recall "auth system"                           # semantic memory search
/trust "Alice" reliability                             # check trust graph
/discover a retry mechanism with exponential backoff   # the hivemind moment
/unleash                                               # deploy the full swarm
/iterate fix-tests                                     # autoresearch loop
/friday mode creative                                  # switch modes
/remember the auth uses JWT in httpOnly cookies         # teach Friday
/federate init                                         # initialize federation node
/create-agent CSS layout specialist                    # grow the swarm
/breed "code review specialist"                        # spawn a local model
/evolve "You are a helpful assistant..."               # evolve a prompt
/route status                                          # check Ollama + routing
/diagnose                                              # codebase health check
/govern verify                                         # governance audit
/peer listen                                           # start encrypted P2P
/help                                                  # categorized command reference
```

---

## Documentation

| Document | What it covers |
|----------|---------------|
| [GETTING_STARTED.md](GETTING_STARTED.md) | Installation, first-run setup, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system architecture, data flow, event wiring, security model |
| [docs/SUBSYSTEM_GUIDE.md](docs/SUBSYSTEM_GUIDE.md) | Deep dive into each of the 18 subsystems |
| [docs/HOOKS_GUIDE.md](docs/HOOKS_GUIDE.md) | All 10 Python hooks: triggers, behavior, vault bridge |
| [docs/SKILLS_GUIDE.md](docs/SKILLS_GUIDE.md) | All 17 slash commands: usage, MCP tools called |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Complete MCP tool reference (91 tools, all parameters) |
| [governance/conformance-report.md](governance/conformance-report.md) | cLaw Specification conformance audit |
| [ROADMAP.md](ROADMAP.md) | Product roadmap from v0.1.0 through v3.0.0 |
| [CHANGELOG.md](CHANGELOG.md) | Version history (Keep a Changelog format) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to add connectors, subsystems, and skills |
| [SECURITY.md](SECURITY.md) | Security model, known limitations, vulnerability reporting |
| [tools/career-ops/README.md](tools/career-ops/README.md) | Career-ops job search pipeline documentation |
| [tools/career-ops/DATA_CONTRACT.md](tools/career-ops/DATA_CONTRACT.md) | User vs system layer data contract |
| [mcp-servers/gemini-mcp/README.md](mcp-servers/gemini-mcp/README.md) | Gemini MCP server setup and tools |
| [interfaces/desktop/vibe-mode/README.md](interfaces/desktop/vibe-mode/README.md) | Vibe Mode 3D visualization architecture |

---

## Full Ecosystem Map

This repo contains the complete Asimov's Mind ecosystem. The hierarchy:

```
asimovs-mind/                        ← you are here
│
├── mcp/friday-core/                  Node.js MCP server (18 subsystems, 91 tools)
│   ├── core/                         Vault, crypto, event bus, session conductor, EIS
│   ├── subsystems/                   19 subsystem directories
│   └── test/                         442 tests (0 failures)
│
├── core/                             7 standalone Python systems (with tests + CLI)
│   ├── cognitive-memory/             3-tier memory: short → medium → long
│   ├── epistemic-score/              6-metric user independence tracking
│   ├── personality-evolution/        30 traits, maturity ramp, anti-sycophancy
│   ├── privacy-shield/               9-category PII detection with FNV-1a hashing
│   ├── sovereign-vault/              AES-256-GCM with Argon2id KDF
│   ├── trust-graph/                  5-dimension person-level credibility model
│   └── hmac-integrity/               HMAC-SHA256 governance file protection
│
├── mcp-servers/                      Python MCP servers (FastMCP)
│   ├── core-mcp/                     Unified server wrapping all 7 core systems (33 tools)
│   └── gemini-mcp/                   Gemini creative: image, TTS, video, music (8 tools)
│
├── interfaces/
│   └── desktop/                      Friday Desktop OS
│       ├── server.py                 Flask backend with REST API
│       ├── ui_parts/                 Modular HTML/React components
│       ├── vibe-mode/                Three.js 3D: 13 structures, audio-reactive, mood system
│       └── build_ui.py               Assembles ui_parts/ into index.html
│
├── tools/
│   └── career-ops/                   AI job search pipeline
│       ├── modes/                    Evaluation, PDF gen, scanning, interview prep
│       ├── dashboard/                Go TUI dashboard
│       └── templates/                CV template, portal config, state definitions
│
├── hooks/                            10 Python governance hooks
├── skills/                           17 slash commands
├── agents/                           16 specialist agent definitions
├── governance/                       cLaws, protected zones, safety floors
├── templates/                        New user setup templates + .env.example
├── docs/                             Architecture, API reference, guides
│
├── setup.sh / setup.bat              One-command installer
├── requirements.txt                  Python dependencies (all components)
├── plugin.json                       Claude Code plugin manifest
└── README.md                         This file
```

### Prerequisites

| Requirement | Minimum | What it's for |
|------------|---------|---------------|
| Python | 3.10+ | Core systems, MCP servers, Desktop OS, hooks |
| Node.js | 18+ | Claude Code plugin (friday-core MCP server) |
| Claude Code | Latest | Plugin host |
| Gemini API key | — | Image gen, TTS, video, music (optional) |
| Anthropic API key | — | Claude Code (required) |

### Python Core Systems

Each of the 7 core systems is a standalone Python module with its own test suite and CLI. They can be used independently or composed through the unified MCP server.

| System | Module | Tests | Purpose |
|--------|--------|:-----:|---------|
| Sovereign Vault | `core/sovereign-vault/` | 20+ | AES-256-GCM encryption with Argon2id KDF |
| Privacy Shield | `core/privacy-shield/` | 50+ | PII detection across 9 categories |
| Trust Graph | `core/trust-graph/` | 50+ | 5-dimension person-level credibility |
| Cognitive Memory | `core/cognitive-memory/` | 50+ | 3-tier memory with consolidation |
| Personality Evolution | `core/personality-evolution/` | 50+ | 30-trait evolution with anti-sycophancy |
| Epistemic Score | `core/epistemic-score/` | 50+ | 6-metric independence tracking |
| HMAC Integrity | `core/hmac-integrity/` | 68 | HMAC-SHA256 governance protection |

Run all tests: `cd core/<system> && python -m pytest test_*.py`

### Career-Ops

AI-powered job search pipeline. Evaluate offers (A-F scoring), generate ATS-optimized CVs, scan 45+ company portals, batch process, and track applications.

Originally by [santifer](https://github.com/santifer/career-ops). Integrated into Asimov's Mind as a tool.

```bash
cd tools/career-ops
npm install            # Playwright for PDF generation
node doctor.mjs        # Verify setup
```

User data (applications, reports, CVs) lives in gitignored directories. See `tools/career-ops/DATA_CONTRACT.md`.

### Gemini Creative MCP Server

8 tools for creative generation via Google's Gemini API:

| Tool | What it does |
|------|-------------|
| `gemini_generate_image` | Text-to-image (Nano Banana Pro, Flash fallback) |
| `gemini_generate_text` | Creative text generation |
| `gemini_describe_image` | Vision analysis of image files |
| `gemini_text_to_speech` | TTS with 8 voice options |
| `gemini_creative_remix` | Style transfer on existing images |
| `gemini_generate_code_art` | p5.js generative art from description |
| `gemini_generate_video` | Veo video generation (1-3 min async) |
| `gemini_generate_music` | Lyria music generation (full tracks or clips) |

Add to Claude Code: `claude mcp add friday-gemini -- python mcp-servers/gemini-mcp/server.py`

### Friday Desktop

Holographic desktop OS with 10+ workspaces, real-time data feeds, and a Three.js 3D scene that evolves with Friday's personality.

```bash
cd interfaces/desktop
python build_ui.py     # Assemble UI from parts
python server.py       # Start at http://localhost:3000
```

Vibe Mode features 13 evolution structures (CUBES → EDEN), audio-reactive animation, mood system (6 moods), and personality-to-visual mapping.

---

## Credits

**[FutureSpeak.AI](https://github.com/FutureSpeakAI)** created Asimov's Mind, the cLaws governance framework, the friday-core runtime, the unified memory system, GitScout, GitLoader, and the capability discovery system.

**[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** by FutureSpeak.AI is the origin of the cLaw governance system, the trust graph, the self-improvement engines, and the GitLoader architecture. The nexus-os intelligence stack (12 subsystems) was ported into friday-core for v2.0.0. Agent Friday (Electron) remains the reference desktop implementation with voice and GUI; Asimov's Mind is the reference CLI/server implementation.

**[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy is the foundation -- the modify-measure-keep/discard loop that started it all. We proved governance improves it and extended it to ecosystem scale.

**Claude Opus 4.6** by Anthropic powers the intelligence behind Agent Friday and co-authored significant portions of the codebase and documentation.

Part of the **Asimov Federation** -- governed AI agents sharing improvements, knowledge, and trust across machines through git.

## License

MIT
