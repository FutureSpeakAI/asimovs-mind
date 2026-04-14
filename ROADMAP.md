# Asimov's Mind -- Product Roadmap

### From Claude Code plugin to the full AI agent ecosystem

This document describes the evolution of Asimov's Mind from a governed self-improvement plugin to the complete AI agent ecosystem: 7 core Python systems, 18-subsystem Node.js MCP server, holographic 3D desktop, AI career pipeline, and an encrypted P2P federation. Current version: v3.0.0.

Built by [Stephen C. Webster](https://github.com/FutureSpeakAI) / [FutureSpeak.AI](https://github.com/FutureSpeakAI). Browse all 49 repos at [github.com/FutureSpeakAI](https://github.com/FutureSpeakAI).

---

## The Architecture

```
                        +-----------------------+
                        |     USER              |
                        |  (developer, team,    |
                        |   organization)       |
                        +-----------+-----------+
                                    |
                    +---------------+---------------+
                    |               |               |
              +-----+-----+  +-----+-----+  +------+------+
              |  Terminal  |  | Telegram  |  |   Agent     |
              | Claude Code|  | Slack     |  |   Friday    |
              | (CLI)      |  | Discord   |  |  (Electron) |
              |            |  | Signal    |  |             |
              +-----+------+  +-----+-----+  +------+-----+
                    |               |               |
                    +---------------+---------------+
                                    |
                    +---------------+---------------+
                    |                               |
                    |     ASIMOV'S MIND KERNEL      |
                    |                               |
                    |  +-------------------------+  |
                    |  |      GOVERNANCE          |  |
                    |  |  cLaws (Three Laws)      |  |
                    |  |  Hooks (enforcement)     |  |
                    |  |  HMAC (integrity)        |  |
                    |  |  Protected zones         |  |
                    |  |  Safety floors           |  |
                    |  +-------------------------+  |
                    |                               |
                    |  +-------------------------+  |
                    |  |      SOVEREIGN VAULT     |  |
                    |  |  AES-256-GCM state       |  |
                    |  |  Argon2id KDF            |  |
                    |  |  BLAKE2b sub-keys        |  |
                    |  |  Ed25519 identity        |  |
                    |  |  Privacy Shield          |  |
                    |  +-------------------------+  |
                    |                               |
                    |  +-------------------------+  |
                    |  |      INTELLIGENCE        |  |
                    |  |  N-agent swarm           |  |
                    |  |  GitScout + GitLoader    |  |
                    |  |  Knowledge store         |  |
                    |  |  Trust tracker           |  |
                    |  |  Provenance ledger       |  |
                    |  |  Safety scanner (AST)    |  |
                    |  |  Ollama router           |  |
                    |  +-------------------------+  |
                    |                               |
                    |  +-------------------------+  |
                    |  |      PERSONALITY         |  |
                    |  |  Agent Friday identity   |  |
                    |  |  Cross-session memory    |  |
                    |  |  Behavioral patterns     |  |
                    |  |  User preference model   |  |
                    |  +-------------------------+  |
                    |                               |
                    |  +-------------------------+  |
                    |  |      FEDERATION          |  |
                    |  |  Git-based sync          |  |
                    |  |  Shared provenance       |  |
                    |  |  Project-local agents    |  |
                    |  |  Trust propagation       |  |
                    |  +-------------------------+  |
                    |                               |
                    +---------------+---------------+
                                    |
                    +---------------+---------------+
                    |               |               |
              +-----+-----+  +-----+-----+  +------+------+
              |  GitHub    |  |  Ollama   |  |  Payment    |
              |  (code     |  |  (local   |  |  APIs       |
              |  ecosystem)|  |  models)  |  |  (future)   |
              +-----------+  +-----------+  +-------------+
```

The kernel is the same everywhere. The runtime (CLI, Electron, messaging) is a thin wrapper. Governance travels with the kernel. Intelligence travels with the kernel. Personality travels with the kernel. Encryption travels with the kernel.

---

## Release Plan

### v0.3.0 -- Initial Release (shipped)

What existed in the original release:

- N agents (dynamic discovery + creation via Meta-Improver and /create-agent)
- GitScout + GitLoader (GitHub code discovery pipeline)
- Safety scanner (AST-based, Tier 1/2/3)
- Provenance tracking (append-only ledger)
- cLaws governance (Three Laws + Meta-Law in JSON)
- 3 enforcement hooks (First Law, Third Law, safety scanner)
- 9 skills, 6 directives
- Portable governance spec + LangChain/CrewAI/AutoGen adapters

### v1.0.0 -- The Agent Friday Kernel (shipped)

**The plugin that makes Claude Code feel like Agent Friday.**

Everything from v0.3.0, plus:

#### Sovereign Vault (shipped in v1.0.0, migrated to friday-core in v2.0.0)

**MCP Server: `mcp/friday-core/` (Tier 0 subsystem since v2.0.0)**

> Note: `mcp/vault-server/` was the standalone vault MCP server from v1.0.0. It was removed in v2.2.0 (dead code since v2.0.0 replaced it with the friday-core subsystem architecture). The vault capability is documented here for historical completeness.

Sovereign Vault capabilities (now in friday-core vault subsystem):
- AES-256-GCM encrypted state storage for all persistent data
- Argon2id key derivation (opslimit=4, memlimit=256MB)
- BLAKE2b sub-key derivation: vault key, HMAC key, identity key
- SecureBuffer key material protection with cryptographic wipe on destroy
- Canary-based passphrase verification
- Automatic migration of plaintext state on first initialization
- HTTP bridge on localhost for Python hook access (with bearer token auth since v2.2.0)

**Current files (v2.3.0):**
- `mcp/friday-core/core/vault.js` -- SovereignVault class
- `mcp/friday-core/core/crypto.js` -- All cryptographic primitives
- `mcp/friday-core/core/ollama-monitor.js` -- OllamaMonitor (extracted from vault.js in v2.2.0)
- `mcp/friday-core/subsystems/vault/index.js` -- 10 MCP tools for vault operations

#### Privacy Shield (shipped in v1.0.0)

**Hooks: `hooks/privacy-shield-scrub.py`, `hooks/privacy-shield-rehydrate.py`**

PreToolUse and PostToolUse hooks on WebFetch/WebSearch that:
1. Scrub outbound requests for PII (API keys, credit cards, SSNs, emails, phones, IPs, filesystem paths)
2. Replace with deterministic session-scoped FNV-1a placeholders
3. Hold mappings in memory only (never written to disk)
4. Rehydrate responses so the user sees real data
5. Degrade gracefully -- if vault is not running, requests pass through unchanged

#### Ed25519 Identity (shipped in v1.0.0)

**Vault tools: `identity_generate`, `identity_sign`, `identity_verify`**

- Ed25519 signing keypair + X25519 exchange keypair via libsodium
- Private keys encrypted with vault identity sub-key
- cLaw attestation: SHA-256 laws hash + timestamp + Ed25519 signature
- Attestation verification with 5-minute expiry window

#### Intelligence Router (shipped in v1.0.0)

**Skill: `/route`**
**Vault tool: `ollama_status`**

- Ollama health monitoring (available models, loaded models, VRAM usage)
- Four routing policies: auto, local_preferred, local_only, cloud_preferred
- Per-task model recommendations based on privacy, complexity, and capability
- Routing config stored encrypted in vault
- `privacy_shield_on_cloud` and `local_model_preferred` safety floors

#### Personality Layer (shipped in v1.0.0)

**File: `personality/friday.md`**

Agent Friday's identity, loaded on every session via a SessionStart hook. Not a system prompt -- a living document that evolves with the user relationship.

**File: `hooks/personality-loader.py`** -- SessionStart hook that loads personality, user profile, recent sessions, and vault status.

**File: `hooks/session-learner.py`** -- Stop hook that extracts learnings, updates session history, and feeds the memory system.

#### HMAC Integrity (shipped in v1.0.0)

**File: `hooks/integrity-check.py`**

SessionStart hook that HMAC-SHA256 verifies governance files against the signed manifest. Tampering triggers a warning and safe mode. When the vault is available, the manifest is read from encrypted storage.

#### Vault Unlock (shipped in v1.0.0)

**Skill: `/friday unlock`**

Browser-based passphrase entry that keeps the passphrase out of the API transcript. Handles first-time initialization, unlocking, and status checks.

#### Additional Hooks (shipped in v1.0.0)

- `hooks/trust-tracker.py` -- PostToolUse on Agent: tracks agent performance scores
- `hooks/vault_bridge.py` -- Python utility for hooks to access vault via HTTP bridge

---

### v2.0.0 -- Agent Friday Complete (shipped)

**The full Agent Friday runtime inside Claude Code.** 17 subsystems, 89 MCP tools at launch (grew to 91 across 18 subsystems by v2.3.0), holographic dashboard.

Everything from v1.0.0, plus the complete intelligence port from nexus-os:

- **friday-core MCP server** -- replaced vault-server with unified 17-subsystem runtime, loaded in 4 dependency tiers (vault-server removed in v2.2.0)
- **LLM subsystem** (6 tools) -- 3 providers, intelligence router, budget tracking
- **Memory subsystem** (8 tools) -- 3-tier storage, embeddings, semantic search
- **Context subsystem** (4 tools) -- knowledge graph, entity extraction, context injection
- **Trust subsystem** (6 tools) -- person-level graph, hermeneutic re-evaluation, time decay
- **Personality subsystem** (6 tools) -- evolution, calibration, anti-sycophancy detection
- **Agent subsystem** (7 tools) -- recursive delegation, deadlock detection
- **Tools subsystem** (4 tools) -- registry, execution delegate, safety gates
- **Connectors subsystem** (4 + 72 tools) -- 9 connectors with dynamic dispatch
- **Gateway subsystem** (5 tools) -- trust tiers, session management, audit logging
- **Briefing subsystem** (3 tools) -- daily briefing, meeting prep, meeting intel
- **Voice subsystem** (3 tools) -- state machine, fallback manager (no audio)
- **Enterprise subsystem** (5 tools) -- consent gate, cloud gate, confidence, commitments
- **Friday Dashboard** -- Three.js holographic interface at `http://localhost:{port}/`

---

### v2.1.0 -- Neural Binding (shipped)

The subsystems learn to talk to each other. The system becomes one intelligence.

- `core/wiring.js`: 10 cross-subsystem event subscriptions (the nervous system)
- `core/session-conductor.js`: session lifecycle orchestration with personality-aware greeting
- `core/eis.js`: Epistemic Independence Score (verification + complexity + correction)
- `/help` and `/status` skills overhauled
- Memory auto-extraction from trust/agent/connector/enterprise events
- Dashboard: live particle data binding, connection indicator, memory search
- GitHub CI, issue templates, PR template, CONTRIBUTING.md, SECURITY.md

---

### v2.2.0 -- Security Hardening (shipped)

Full security audit. 7 vulnerability classes closed. 160 KB dead code removed:
- Path traversal blocked in vault keys
- Governance bypass closed (absolute-path normalization)
- HTTP bridge authenticated (bearer token)
- P2P locked to loopback, signature-before-decrypt
- Safety scanner hardened for hooks/ and governance/ writes

---

### v2.3.0 -- 50-Cycle Hardening Run (shipped)

**18 subsystems, 91 MCP tools, 442 tests.** A 50-cycle automated hardening run that exercised the full runtime and resolved a class of persistence, namespace, and architectural inconsistencies.

#### Persistence Layer Fix

All subsystem state access migrated from the informal `state.get/set` API to the correct `state.read/write` contract required by `StateManager`. Affected subsystems: memory, context, trust, personality, agents, briefing, enterprise, and session.

#### Namespace Separator Standardisation

State keys now consistently use `:` as the namespace separator between the subsystem prefix and the key name (e.g. `memory:observations`). Keys using `/` were rejected by `vault.js` `validateKey()` at runtime; all affected call sites have been corrected.

#### Session Subsystem (18th subsystem)

`session_status` was previously registered directly in `main()`, outside the subsystem pipeline. It is now a proper `SessionSubsystem` class registered at Tier 3. The `SessionConductor` is injected into the subsystem after `startAll()` via `setConductor()`.

#### Event Bus Error Isolation

`FridayEventBus` now uses an internal `#safeDispatch` method that wraps each listener in a try/catch. A throwing subscriber no longer prevents downstream subscribers or the wildcard `*` channel from receiving the event.

#### HTTP Bridge Rate Limiting

A token-bucket rate limiter (100 requests per second per source IP) was added to the HTTP bridge. Requests exceeding the limit receive HTTP 429. This closes a potential denial-of-service vector from a misbehaving hook.

#### Tool Count Reconciliation

The Personality subsystem was audited and confirmed to expose 6 tools (not 7 as previously documented). The total across all 18 subsystems is 91 static tools plus up to 65 dynamic connector tools.

---

### v3.0.0 -- Full Python Ecosystem (shipped)

The complete Asimov's Mind ecosystem in a single repo:

- **7 Core Python Systems** (`core/`) -- Sovereign Vault, Privacy Shield, Trust Graph, Cognitive Memory, Personality Evolution, Epistemic Score, HMAC Integrity. Each standalone with CLI, tests, and README. 350+ tests total.
- **Core MCP Server** (`mcp-servers/core-mcp/`) -- FastMCP wrapping all 7 systems as 32 MCP tools
- **Gemini MCP Server** (`mcp-servers/gemini-mcp/`) -- 8 creative tools: image gen, TTS (Gemini 2.5 Flash Preview TTS), vision, music (Lyria), video (Veo), code art
- **Friday Desktop** (`interfaces/desktop/`) -- holographic 3D desktop OS with Flask backend, React frontend, Three.js 3D visualization (13 evolution structures, mood system, audio-reactive animation, MediaPipe hand/face tracking), 11 workspaces
- **Career-Ops Pipeline** (`tools/career-ops/`) -- AI job search with A-F scoring, ATS-optimized CV generation, 45+ portal scanning via Playwright, batch processing, interview prep
- **Setup scripts** -- one-command installation for Mac/Linux/Windows
- **Full documentation rewrite** -- README with attribution, standalone repo cross-references, credits

Each major component also exists as a standalone repo under [github.com/FutureSpeakAI](https://github.com/FutureSpeakAI) (49 repos).

---

### v4.0.0 -- Financial Transactions (future)

#### Transaction MCP Server

Wraps a payment API (Stripe Connect for fiat, Lightning Network for bitcoin). Governed by new cLaws:
- Maximum transaction amount per session (safety floor)
- Require explicit user approval for amounts > threshold
- Full audit trail in `.asimovs-mind/transactions.jsonl`
- Only owner trust tier can authorize payments

#### Code Marketplace

Agents can buy and sell code snippets:
- Agent A has a well-tested retry handler (provenance: kept 15 times, trust 0.95)
- Agent B needs a retry handler
- Transaction: B pays A $0.02, receives the code with provenance
- cLaws verify: license allows resale, code passes safety scan, user consented

This is the monetized version of the federation. The free version (Git-based sharing) remains the default.

---

## The Holistic View

With v2.0.0 shipped, here is what a user experiences:

**Morning:**
```
$ claude
Good morning. Since your last session:
- 3 federation nodes pushed improvements to the shared repo
- GitScout found 2 new candidates for the auth refactor
- Test pass rate is 97% (up from 94% yesterday)
- The debugger agent resolved 3 test failures overnight via /schedule

What would you like to work on?
```

**During work:**
```
> /discover a rate limiter for the API gateway

Searching GitHub... Found 7 candidates.
Top recommendation: express-rate-limit (trust: 0.91, Tier 1)
Safety scan: PASS (0 findings)
Adapting to your Express middleware pattern...

INTEGRATION REVIEW
==================
Source: nfriedly/express-rate-limit
License: MIT
Component: rateLimit middleware (47 lines)
Trust tier: 1 (verified)

Proceeding. Tests passing. Committed.
```

**From Telegram while away from desk:**
```
You: status?
Friday: Auth refactor branch has 7 commits. Tests passing.
        The rate limiter you added is handling 450 req/min in dev.
        One type error in session-handler.ts -- want me to fix it?
You: fix it
Friday: Fixed. Committed. Tests passing. Type-clean.
```

**Overnight:**
```
/iterate full-sweep
/schedule "0 2 * * *" /iterate discover

(Agent runs autonomously from 2am, governed by cLaws)
(Morning: you wake up to a session log of improvements)
```

**Across the team:**
```
Developer A: /discover a WebSocket reconnection handler
  -> Found, scanned, integrated, committed with provenance

Developer B: git pull
  -> Sees the integration with full attribution
  -> Trust score inherited from A's node
  -> Their agent knows this code was safety-scanned and tested
```

---

## What Stays in Agent Friday (Electron)

These features require the full Electron runtime and will NOT be ported to the Claude Code plugin:

- **PersonaPlex voice loop** (real-time STT + LLM + TTS pipeline with audio capture)
- **System tray / always-on daemon** (background process)
- **Native GUI** (settings, trust graph visualization, chat interface)

The following features were originally planned as Electron-only but have been shipped in the plugin:

- **Sovereign Vault** -- Now in `mcp/friday-core/` as the Tier 0 vault subsystem (standalone `mcp/vault-server/` removed in v2.2.0)
- **Ed25519 persistent identity** -- Now in the identity subsystem via libsodium
- **Privacy Shield** -- Now in `hooks/privacy-shield-scrub.py` and `hooks/privacy-shield-rehydrate.py`
- **Intelligence Router** -- Now in the LLM subsystem with `/route` skill
- **Full intelligence stack** -- LLM, Memory, Context, Trust, Personality, Agent, Tools, Connectors, Gateway, Briefing, Voice, Enterprise all ported from nexus-os in v2.0.0
- **Holographic Dashboard** -- Three.js desktop served at `http://localhost:{port}/`

Agent Friday (Electron) remains the reference desktop implementation with real-time voice and native GUI. Asimov's Mind (Claude Code plugin) is the reference CLI/server implementation with the full 18-subsystem runtime, 91 MCP tools, and holographic dashboard.

---

## File Manifest (v3.0.0)

```
asimovs-mind/
+-- plugin.json                        # Claude Code plugin manifest
+-- README.md                          # Comprehensive project documentation
+-- CHANGELOG.md                       # Version history (Keep a Changelog format)
+-- ROADMAP.md                         # This file
+-- GETTING_STARTED.md                 # Installation and first-run guide
+-- CONTRIBUTING.md                    # Contribution guide
+-- SECURITY.md                        # Security model and vulnerability reporting
+-- setup.sh / setup.bat               # One-command installer (Mac/Linux, Windows)
+-- requirements.txt                   # Unified Python dependencies
+-- core/                              # 7 standalone Python systems (350+ tests)
|   +-- sovereign-vault/               # AES-256-GCM + Argon2id encryption
|   +-- privacy-shield/                # PII detection across 9 categories
|   +-- trust-graph/                   # 5-dimension person-level credibility
|   +-- cognitive-memory/              # 3-tier memory with consolidation
|   +-- personality-evolution/         # 30-trait evolution with anti-sycophancy
|   +-- epistemic-score/               # 6-metric independence tracking
|   +-- hmac-integrity/                # HMAC-SHA256 governance protection
+-- mcp/friday-core/                   # Node.js MCP server (18 subsystems, 91 tools)
|   +-- core/                          # Vault, crypto, event bus, wiring, EIS
|   +-- subsystems/                    # 18 subsystem directories
|   +-- test/                          # 442 tests (0 failures)
+-- mcp-servers/
|   +-- core-mcp/                      # FastMCP wrapping 7 core systems (32 tools)
|   +-- gemini-mcp/                    # Gemini creative: image, TTS, video, music (8 tools)
+-- interfaces/desktop/                # Friday Desktop OS
|   +-- server.py                      # Flask backend
|   +-- ui_parts/                      # React frontend components
|   +-- vibe-mode/                     # Three.js 3D: 13 structures, mood, audio
+-- tools/career-ops/                  # AI job search pipeline
+-- hooks/                             # 10 Python governance hooks
+-- skills/                            # 17 slash commands
+-- agents/                            # 16 specialist agent definitions
+-- governance/                        # cLaws, protected zones, safety floors
+-- templates/                         # Setup templates + .env.example
+-- docs/                              # Architecture, API reference, guides
```

---

## Credits

**[Stephen C. Webster / FutureSpeak.AI](https://github.com/FutureSpeakAI)** -- Creator of Asimov's Mind, the cLaws governance framework, Agent Friday, the Sovereign Vault, and the 49-repo FutureSpeakAI ecosystem.

**[Andrej Karpathy](https://github.com/karpathy)** -- [autoresearch](https://github.com/karpathy/autoresearch) is the foundation. The modify-measure-keep/discard iteration pattern at the core of every directive.

**[Isaac Asimov](https://en.wikipedia.org/wiki/Isaac_Asimov)** -- The Three Laws of Robotics (1942) inspired the cLaws governance framework.

**Claude Opus 4.6** by Anthropic -- Co-authored significant portions of the codebase and documentation.

See the [README](README.md) for full attribution, technology credits, and standalone repo links.
