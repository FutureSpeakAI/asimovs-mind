# Asimov's Mind -- Product Roadmap

### From Claude Code plugin to the Agent Friday kernel

This document describes the evolution of Asimov's Mind from a governed self-improvement plugin to the portable intelligence and governance kernel that powers Agent Friday across every runtime. Current version: v1.0.0.

Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI).

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

#### Sovereign Vault (shipped in v1.0.0)

**MCP Server: `mcp/vault-server/`**

Persistent sidecar MCP server providing:
- AES-256-GCM encrypted state storage for all persistent data
- Argon2id key derivation (opslimit=4, memlimit=256MB)
- BLAKE2b sub-key derivation: vault key, HMAC key, identity key
- SecureBuffer key material protection with cryptographic wipe on destroy
- Canary-based passphrase verification
- Automatic migration of plaintext state on first initialization
- HTTP bridge on localhost for Python hook access

**Files:**
- `mcp/vault-server/index.js` -- MCP server + HTTP bridge
- `mcp/vault-server/vault.js` -- SovereignVault + OllamaMonitor classes
- `mcp/vault-server/crypto.js` -- All cryptographic primitives

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

### v1.1.0 -- Full Local Sovereignty: Claude Code on Ollama, Zero Cloud Dependency

The infrastructure is ready. The vault, P2P channels, federation, routing, trust graph, memory, and all governance hooks already function without cloud API access. This release makes local-only operation a first-class, documented, tested configuration.

**What ships:**
- `api_free_capable` safety floor enforcing that no plugin feature requires cloud API access
- `/route local-only` command: guided setup that verifies Ollama, checks models, activates local-only routing, and reports capability status
- `directives/local-sovereignty.md`: full documentation of requirements, capabilities, and setup path
- Personality update: Friday acknowledges local-only mode and is honest about model capability tradeoffs
- Verification that all governance hooks, all agents, and all skills function when Claude Code runs against Ollama instead of the Anthropic API

**What it means:** The Privacy Shield was always a compromise -- scrubbing PII before sending it to a cloud you don't control. Local-only mode eliminates the compromise. No data leaves. No API keys. No billing. No rate limits. The sovereignty promise is fully realized.

**What's left:** Only the Claude Code runtime configuration. Everything else is already built.

---

### v1.2.0 -- Multi-Platform Agent

#### 6. Slack Bridge

MCP server, same pattern as Telegram. Adds channel-aware context (the agent knows which Slack channel a message came from and adjusts trust tier accordingly: DM = owner tier, public channel = group tier).

#### 7. Discord Bridge

MCP server. Same governance. Adds role-based trust mapping (Discord roles map to cLaw trust tiers).

#### 8. Signal Bridge

MCP server via signal-cli. End-to-end encrypted by default (Signal handles this). The most sovereignty-aligned messaging platform.

#### 9. TTS Output

Two paths:

**Local (Chatterbox/Kokoro):** If Ollama or a local TTS model is available, the agent can speak responses. An MCP server wraps the TTS engine. Output is piped to system audio.

**Cloud (Gemini Live):** An MCP server wraps Gemini's multimodal API. The agent can have voice conversations. This requires a Gemini API key and sends audio to Google's servers (governance must inform the user of this tradeoff).

A `/speak` skill toggles TTS on/off. When on, every response is also spoken. Governed by a new cLaw floor: `tts_provider_consent: true` -- the user must explicitly consent to cloud TTS.

---

### v1.3.0 -- The Trust Web

#### 10. Agent Performance Tracker

Persistent scoring of agent effectiveness:
```json
{
  "debugger": { "deployed": 47, "kept": 43, "reverted": 4, "keep_rate": 0.91 },
  "git-loader": { "deployed": 12, "kept": 5, "reverted": 7, "keep_rate": 0.42 },
  "optimizer": { "deployed": 31, "kept": 24, "reverted": 7, "keep_rate": 0.77 }
}
```

The Swarm Coordinator uses these scores to prioritize deployment. Low-performing agents get fewer cycles. The Meta-Improver targets them for prompt evolution.

#### 11. Repo Trust Graph

Persistent scoring of GitHub repos based on discovery outcomes:
```json
{
  "KellerJordan/Muon": { "discoveries": 3, "kept": 2, "trust": 0.92 },
  "facebookresearch/schedule_free": { "discoveries": 1, "kept": 0, "trust": 0.65, "note": "blocked by typing_extensions dep" }
}
```

GitScout uses these scores to boost/penalize repos in future searches. The federation shares these scores via Git, so one node's trust assessments benefit all nodes.

#### 12. Web Content Trust Layer

PreToolUse hook on WebFetch/WebSearch that:
1. Checks the URL against a known-unreliable-sources list
2. Annotates results with a confidence flag
3. Logs all web fetches to the session ledger
4. Never blocks (informational, not enforcement) -- but the agent sees the annotations and can factor them into its reasoning

---

### v2.0.0 -- Financial Transactions (Future)

#### 13. Transaction MCP Server

Wraps a payment API (Stripe Connect for fiat, Lightning Network for bitcoin). Governed by new cLaws:
- Maximum transaction amount per session (safety floor)
- Require explicit user approval for amounts > threshold
- Full audit trail in `.asimovs-mind/transactions.jsonl`
- Only owner trust tier can authorize payments

#### 14. Code Marketplace

Agents can buy and sell code snippets:
- Agent A has a well-tested retry handler (provenance: kept 15 times, trust 0.95)
- Agent B needs a retry handler
- Transaction: B pays A $0.02, receives the code with provenance
- cLaws verify: license allows resale, code passes safety scan, user consented

This is the monetized version of the federation. The free version (Git-based sharing) remains the default.

---

## The Holistic View

With v1.0 shipped, here is what a user experiences:

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

- **PersonaPlex voice loop** (real-time STT + LLM + TTS pipeline)
- **System tray / always-on daemon** (background process)
- **GUI** (settings, trust graph visualization, chat interface)

The following features were originally planned as Electron-only but have been shipped in the v1.0.0 plugin:

- **Sovereign Vault** -- Now in `mcp/vault-server/` as an MCP sidecar
- **Ed25519 persistent identity** -- Now in the vault server via libsodium
- **Privacy Shield** -- Now in `hooks/privacy-shield-scrub.py` and `hooks/privacy-shield-rehydrate.py`
- **Intelligence Router** -- Now in `/route` skill with Ollama monitoring via vault MCP server

Agent Friday (Electron) remains the reference desktop implementation with voice, GUI, and system tray. Asimov's Mind (Claude Code plugin) is the reference CLI/server implementation with the full governance kernel, encrypted state, and cryptographic identity.

---

## File Manifest (v1.0.0)

```
asimovs-mind/
+-- plugin.json                        # Claude Code plugin manifest (v1.0.0)
+-- README.md                          # Plugin documentation
+-- ROADMAP.md                         # This file
+-- governance/
|   +-- laws.json                      # Three Laws + Meta-Law
|   +-- protected-zones.json           # Immutable file patterns
|   +-- safety-floors.json             # Tunable minimums (encryption, privacy, etc.)
|   +-- discovery-rules.json           # Code import governance
|   +-- conformance-report.md          # cLaw Specification conformance audit
|   +-- website-alignment.md           # FutureSpeak.AI website claim verification
+-- personality/
|   +-- friday.md                      # Agent Friday identity
+-- agents/
|   +-- git-scout.md                   # GitHub code discovery
|   +-- git-loader.md                  # Safe code integration
|   +-- sentinel.md                    # Governance enforcement
|   +-- swarm-coordinator.md           # Wave orchestration (N agents)
|   +-- meta-improver.md              # Self-improvement + agent creation
|   +-- debugger.md                   # Test repair
|   +-- optimizer.md                  # Performance optimization
|   +-- evolver.md                    # Prompt engineering
|   +-- breeder.md                    # Ollama model evolution
|   +-- auditor.md                    # Security scanning
|   +-- documenter.md                 # Docs sync
|   +-- librarian.md                  # Cross-session memory
|   +-- scout.md                      # Web research
|   +-- architect.md                  # Structural analysis
|   +-- creative.md                   # Contextual media generation
|   +-- workflow-observer.md          # Pattern recognition
+-- skills/
|   +-- discover/SKILL.md             # /discover
|   +-- create-agent/SKILL.md         # /create-agent
|   +-- unleash/SKILL.md              # /unleash
|   +-- federate/SKILL.md             # /federate
|   +-- iterate/SKILL.md              # /iterate
|   +-- diagnose/SKILL.md             # /diagnose
|   +-- govern/SKILL.md               # /govern
|   +-- breed/SKILL.md                # /breed
|   +-- evolve/SKILL.md               # /evolve
|   +-- status/SKILL.md               # /status
|   +-- onboard/SKILL.md              # /onboard
|   +-- friday/SKILL.md               # /friday
|   +-- remember/SKILL.md             # /remember
|   +-- route/SKILL.md                # /route (intelligence router)
|   +-- unlock/SKILL.md               # /friday unlock (vault)
+-- hooks/
|   +-- first-law.py                   # PreToolUse: protected zone enforcement
|   +-- third-law.py                   # PostToolUse: session ledger
|   +-- safety-scanner-hook.py         # PreToolUse: AST scan on write
|   +-- personality-loader.py          # SessionStart: personality + memory
|   +-- session-learner.py             # Stop: extract learnings
|   +-- integrity-check.py            # SessionStart: HMAC governance verify
|   +-- trust-tracker.py              # PostToolUse: agent performance
|   +-- privacy-shield-scrub.py       # PreToolUse: PII scrub on WebFetch/WebSearch
|   +-- privacy-shield-rehydrate.py   # PostToolUse: PII restore from responses
|   +-- vault_bridge.py               # Python utility: hook-to-vault HTTP bridge
+-- mcp/
|   +-- vault-server/                  # Sovereign Vault MCP server
|       +-- index.js                   # MCP + HTTP bridge entry point
|       +-- vault.js                   # SovereignVault + OllamaMonitor
|       +-- crypto.js                  # AES-256-GCM, Argon2id, Ed25519, BLAKE2b
|       +-- package.json               # Dependencies (MCP SDK, libsodium-sumo)
+-- discovery/
|   +-- safety_scanner.py             # AST analysis (standalone)
|   +-- provenance.py                 # Attribution CLI
|   +-- memory.py                     # Unified trust graph + knowledge graph + RAG
+-- directives/
|   +-- discover.md                    # Autonomous discovery loop
|   +-- full-sweep.md                 # The overnight run
|   +-- fix-tests.md                  # Test pass rate
|   +-- fix-types.md                  # TypeScript compliance
|   +-- optimize-startup.md           # Initialization time
|   +-- security-hardening.md         # OWASP vulnerabilities
+-- framework/
    +-- spec.json                      # Portable governance spec
    +-- adapters/                      # LangChain, CrewAI, AutoGen
```

---

## Credits

**[FutureSpeak.AI](https://github.com/FutureSpeakAI)** -- Creator of Asimov's Mind, the cLaws governance framework, the Sovereign Vault, and the Agent Friday ecosystem.

**[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** -- The full AI assistant that this kernel powers. The trust graph, sovereign vault, agent network, and voice pipeline live there.

**[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy -- The iteration pattern at the core of every directive.
