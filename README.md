# Asimov's Mind

### Agent Friday lives here. 18 subsystems. 91 MCP tools. One holographic dashboard.

A Claude Code plugin that is Agent Friday: a full AI runtime with 18 subsystems, 3-provider LLM routing, 3-tier memory with semantic search, person-level trust graphs, personality evolution with anti-sycophancy calibration, recursive agent delegation, 8 connectors with ~65 dynamic tools, enterprise consent gates, daily briefings, meeting intelligence, and a Three.js holographic dashboard. All state AES-256-GCM encrypted. Ed25519 cryptographic identity. Privacy Shield PII scrubbing. Ollama local-first routing. Coordinated N-agent swarm. Bounded by Asimov's cLaws.

Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI). Standing on the shoulders of [Karpathy's autoresearch](https://github.com/karpathy/autoresearch).

> **New here?** See [GETTING_STARTED.md](GETTING_STARTED.md) for installation and first-run setup in under two minutes.

---

## Quick Start

```bash
# Install from GitHub
claude plugin add https://github.com/FutureSpeakAI/asimovs-mind

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

---

## Credits

**[FutureSpeak.AI](https://github.com/FutureSpeakAI)** created Asimov's Mind, the cLaws governance framework, the friday-core runtime, the unified memory system, GitScout, GitLoader, and the capability discovery system.

**[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** by FutureSpeak.AI is the origin of the cLaw governance system, the trust graph, the self-improvement engines, and the GitLoader architecture. The nexus-os intelligence stack (12 subsystems) was ported into friday-core for v2.0.0. Agent Friday (Electron) remains the reference desktop implementation with voice and GUI; Asimov's Mind is the reference CLI/server implementation.

**[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy is the foundation -- the modify-measure-keep/discard loop that started it all. We proved governance improves it and extended it to ecosystem scale.

**Claude Opus 4.6** by Anthropic powers the intelligence behind Agent Friday and co-authored significant portions of the codebase and documentation.

Part of the **Asimov Federation** -- governed AI agents sharing improvements, knowledge, and trust across machines through git.

## License

MIT
