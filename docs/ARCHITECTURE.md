# Agent Friday -- System Architecture

**Version:** 2.2.0 (Security Hardening)
**Runtime:** friday-core MCP server -- 17 subsystems, 92 MCP tools, holographic dashboard

This document describes the full architecture of Asimov's Mind, the Claude Code plugin that implements Agent Friday. A developer unfamiliar with the codebase should be able to read this and understand how every component fits together.

---

## Architecture Diagram

```
                          +-----------------------------+
                          |        Claude Code          |
                          |  (host process, stdio MCP)  |
                          +---------+---+---+-----------+
                                    |   |   |
                         +----------+   |   +----------+
                         |              |              |
                  plugin.json      hooks/*.py     skills/*/SKILL.md
                  (entry point)    (9 Python        (19 slash
                                    hooks)           commands)
                         |              |
                         v              |
               +-------------------+    |
               |   bootstrap.js    |    |  (reads stdin JSON,
               | Node version chk  |    |   writes stdout,
               | npm install       |    |   exit codes 0/2)
               | stale port clean  |    |
               +--------+----------+    |
                        |               |
                        v               |
               +-------------------+    |
               |    index.js       |    |
               | MCP Server (stdio)|    |
               | HTTP Bridge       +<---+  (hooks call HTTP bridge
               | Dashboard server  |       at 127.0.0.1:{port})
               +--------+---------+
                        |
          +-------------+-------------+
          |                           |
   McpServer (stdio)          HTTP Server (localhost)
   92 MCP tools               /status, /read, /write
   registered from            /scrub, /rehydrate
   17 subsystems              /unlock, /initialize
                              /tool/:name (generic)
                              / (dashboard.html)
```

### Subsystem Dependency Tiers

```
Tier 0 (Foundation -- no dependencies)
  +-- vault           10 tools   AES-256-GCM state, Argon2id KDF, BLAKE2b sub-keys
  +-- identity          6 tools   Ed25519 signing, X25519 exchange, attestation
  +-- privacy           4 tools   PII scrubbing, session-scoped placeholders
  +-- ollama            1 tool    Local LLM health monitoring

Tier 1 (needs identity)
  +-- p2p               7 tools   WebSocket transport, ECDH channels, pairing

Tier 2 (needs vault, ollama, event bus)
  +-- llm               6 tools   3 providers (Anthropic, OpenRouter, Ollama), router
  +-- memory            8 tools   3-tier storage, embeddings, semantic search
  +-- context           4 tools   Knowledge graph, entity extraction, injection
  +-- trust             7 tools   Person-level graph, hermeneutic re-evaluation
  +-- personality       7 tools   Evolution, calibration, anti-sycophancy

Tier 3 (needs multiple lower-tier subsystems)
  +-- agents            7 tools   Recursive delegation, deadlock detection
  +-- tools             4 tools   Registry, execution delegate, safety gates
  +-- connectors        4 tools   8 connectors, dynamic dispatch (~72 connector tools)
  +-- gateway           5 tools   Trust tiers, session mgmt, audit logging
  +-- briefing          3 tools   Daily briefing, meeting prep, meeting intel
  +-- voice             3 tools   State machine, fallback manager (no audio)
  +-- enterprise        5 tools   Consent gate, cloud gate, confidence, commitments

Session (registered in index.js)
  +-- session_status    1 tool    Uptime, cwd context, greeting, commitments
                      ------
                       92 tools
```

---

## Data Flow: User Request to Response

A typical request flows through the system like this:

```
1. User types a message in Claude Code
     |
2. Claude Code SessionStart hooks fire (if session is new):
   a. personality-loader.py -- loads friday.md, user profile, session history
   b. integrity-check.py   -- HMAC-verifies governance files
     |
3. Claude Code sends the message to its LLM
     |
4. LLM decides to call an MCP tool (e.g., memory_recall)
     |
5. Claude Code PreToolUse hooks fire (tool-specific):
   - Write|Edit -> first-law.py (protected zone check)
   - Write      -> safety-scanner-hook.py (AST scan for .py files)
   - WebFetch|WebSearch -> privacy-shield-scrub.py (PII removal)
     |
6. MCP tool call reaches friday-core via stdio transport
     |
7. McpServer dispatches to the registered handler:
   SubsystemRegistry -> target Subsystem -> tool handler function
     |
8. Tool handler reads/writes vault state, publishes events, returns JSON
     |
9. Claude Code PostToolUse hooks fire (tool-specific):
   - Write|Edit|Bash -> third-law.py (session ledger)
   - Agent           -> trust-tracker.py (agent performance)
   - WebFetch|WebSearch -> privacy-shield-rehydrate.py (PII restore)
     |
10. LLM receives tool result, continues reasoning or responds
     |
11. On session end, Stop hooks fire:
    - session-learner.py -- extracts metrics, updates memory, clears ledger
```

### HTTP Bridge Communication

Python hooks cannot use the stdio MCP transport (it is occupied by Claude Code). Instead, they communicate with friday-core through a localhost HTTP bridge:

```
Python Hook                    friday-core HTTP Server
     |                                |
     +-- Read port from               |
     |   .asimovs-mind/vault/port     |
     |                                |
     +-- GET  /status     ----------->|  vault status check (no auth)
     +-- GET  /read?key=X ----------->|  read encrypted state (no auth)
     +-- POST /write      ----------->|  write encrypted state (bearer token)
     +-- POST /append     ----------->|  append to array (bearer token)
     +-- POST /scrub      ----------->|  PII scrubbing (no auth)
     +-- POST /rehydrate  ----------->|  PII restoration (no auth)
     +-- POST /tool/:name ----------->|  call whitelisted MCP tool (bearer token)
```

The `vault_bridge.py` module provides a Python API (`vault_read`, `vault_write`, `vault_append`, `vault_available`) that wraps these HTTP calls. Every hook imports from `vault_bridge` and degrades gracefully if the server is unreachable.

**HTTP Bridge Security Model (v2.2.0):**

1. **Localhost binding:** The server binds exclusively to `127.0.0.1` (not `0.0.0.0`). Any request whose `req.socket.remoteAddress` is not `127.0.0.1`, `::1`, or `::ffff:127.0.0.1` is rejected with HTTP 403 before any route is matched.

2. **Bearer token authentication:** A 64-hex-char random token is generated at startup via `crypto.randomBytes(32)` and written to `.asimovs-mind/vault/bridge-token` (mode 0o600). Write endpoints (`/write`, `/append`) and the generic tool endpoint (`/tool/:name`) require `Authorization: Bearer <token>`. Requests missing or mismatching the token receive HTTP 401.

3. **Tool endpoint whitelist:** `POST /tool/:toolName` is restricted to four read-only tools: `vault_status`, `ollama_status`, `session_status`, `personality_status`. Any other tool name returns HTTP 403. This prevents hooks from triggering write-capable tools via the HTTP path.

4. **Body size limit:** POST request bodies are rejected at 4 MB. The `readBody()` helper counts bytes as chunks arrive and destroys the socket on overflow.

The bridge is not a network-accessible service — it exists solely for in-process Python/Node IPC on the same machine.

---

## Event Flow: Cross-Subsystem Wiring

The `core/wiring.js` module establishes 10 event subscriptions that connect subsystems. Every subscription is wrapped in try/catch so one broken handler never crashes the bus.

### Event Subscriptions

| # | Event | Publisher | Subscriber(s) | Effect |
|---|-------|-----------|---------------|--------|
| 1 | `vault:unlocked` | Vault subsystem | Personality, Memory, Context, Trust, Connectors | Cascade-loads all subsystems on vault open |
| 2 | `vault:locking` | Vault subsystem | Memory, Context, Trust, Personality | Flush and save state before keys are destroyed |
| 3 | `memory:stored` | Memory subsystem | Context (graph entity extraction), Personality (sentiment analysis) | New memories feed the knowledge graph and mood tracker |
| 4 | `trust:evidence-added` | Trust subsystem | Memory (stores observation), Gateway (refreshes policies) | Trust changes propagate to memory and access control |
| 5 | `trust:score-updated` | Trust subsystem | Briefing (queues note for next daily) | Trust changes surface in next daily briefing |
| 6 | `agent:completed` | Agent subsystem | Memory (stores result), Trust (updates agent performance) | Agent results recorded and scored |
| 7 | `privacy:scrubbed` | Privacy subsystem | Enterprise (logs consent event) | PII scrub events recorded for audit |
| 8 | `connector:detected` | Connectors subsystem | Tools (auto-registers connector tools) | New connectors auto-populate tool registry |
| 9 | `enterprise:commitment-created` | Enterprise subsystem | Briefing (queues note for next daily) | New commitments surface in next daily briefing |
| 10 | `session:end` | Session Conductor | Memory, Context, Trust, Personality, Enterprise | End-of-session flush for all stateful subsystems |

Additionally, the `llm:request-completed` event feeds the **Epistemic Independence Score** tracker, which monitors verification frequency, query complexity, and correction rate across a rolling 20-interaction window.

### Event Bus Architecture

The `FridayEventBus` (core/event-bus.js) extends Node's `EventEmitter`:

- **publish(topic, data)** -- creates a timestamped event with a UUID, pushes to the ring buffer, emits on both the specific topic and the wildcard `*` channel
- **recent(topic, limit)** -- returns the last N events from the buffer (filtered by topic or all)
- **Throttle** -- per-topic minimum interval to prevent flooding
- **Pruning** -- buffer capped at 2000 events or 4 hours, whichever is smaller
- **Stats** -- tracks total published count and distinct topic count

---

## Session Lifecycle

### Startup Sequence

```
1. Claude Code launches: executes bootstrap.js (from plugin.json)
   a. Node version check (requires 18+)
   b. npm install if node_modules missing
   c. Stale port file cleanup
   d. Dynamic import of index.js

2. index.js main():
   a. initCrypto() -- initializes libsodium
   b. Create vault directory (.asimovs-mind/vault/)
   c. vault.init() -- checks for existing meta.json
   d. registry.startAll() -- calls registerEvents() + start() on all 17 subsystems in tier order
   e. wireSubsystems() -- establishes 10 cross-subsystem event routes
   f. SessionConductor.wire() -- listens for vault:unlocked/locking
   g. Register session_status MCP tool
   h. startHttpBridge() -- starts HTTP server on random localhost port, writes port file
   i. Connect MCP stdio transport

3. Claude Code SessionStart hooks fire:
   a. personality-loader.py -- outputs personality + user context
   b. integrity-check.py -- verifies governance HMAC

4. User runs /friday unlock:
   a. vault_unlock tool derives keys from passphrase (Argon2id)
   b. Publishes vault:unlocked event
   c. Wiring cascade: personality, memory, context, trust, connectors all load state

5. SessionConductor.onSessionStart():
   a. Detects working directory (project name, git branch)
   b. Checks overdue commitments
   c. Checks briefing staleness
   d. Composes personality-aware greeting
   e. Publishes session:start
```

### Shutdown Sequence

```
1. User closes Claude Code (or SIGINT/SIGTERM)

2. Stop hook fires:
   a. session-learner.py -- reads ledger, extracts metrics, stores summary, feeds memory

3. cleanup():
   a. registry.stopAll() -- calls stop() on all subsystems in reverse tier order
   b. vault.lock() -- destroys all three sub-keys (vaultKey, hmacKey, identityKey)
   c. httpServer.close()
   d. Removes port file
```

---

## State Management

### Vault Key Namespaces

Each subsystem gets a namespaced prefix via `StateManager.namespace(name)`. Vault keys are stored as `.enc` files under `.asimovs-mind/vault/state/`.

| Subsystem | Prefix | Key Examples |
|-----------|--------|-------------|
| vault | (root) | `agent-identity`, `user-profile`, `session-ledger` |
| llm | `llm/` | `llm/router-state`, `llm/api-keys` |
| memory | `memory/` | `memory/short-term`, `memory/medium-term`, `memory/long-term`, `memory/episodes`, `memory/session-buffer` |
| context | `context/` | `context/graph` |
| trust | `trust/` | `trust/persons`, `trust/evidence` |
| personality | `personality/` | `personality/profile`, `personality/calibration`, `personality/sentiment`, `personality/evolution`, `personality/personality-history` |
| agents | `agents/` | `agents/delegation-state` |
| connectors | `connectors/` | `connectors/api-keys` |
| gateway | `gateway/` | `gateway/trust-policies`, `gateway/sessions`, `gateway/audit` |
| briefing | `briefing/` | `briefing/history`, `briefing/meetings` |
| enterprise | `enterprise/` | `enterprise/consent`, `enterprise/cloud-policies`, `enterprise/commitments`, `enterprise/outbound` |

Root-level keys (without prefix) remain accessible for backward compatibility with hooks and skills that predate the namespace system.

### Vault File Layout

```
.asimovs-mind/
+-- vault/
    +-- salt              # 16-byte random salt (hex encoded)
    +-- canary.enc        # Passphrase verification blob (XSalsa20-Poly1305)
    +-- meta.json         # Vault metadata (version, created_at, algorithms)
    +-- port              # HTTP bridge port number (written on start, deleted on stop)
    +-- state/            # Encrypted state files
        +-- *.enc         # Each key is a base64-encoded AES-256-GCM ciphertext
```

---

## Security Model

### Encryption Layers

```
Layer 1: Passphrase
  User provides >= 8 words, >= 24 characters, >= 4 unique words.

Layer 2: Key Derivation
  Argon2id (opslimit=4, memlimit=256MB, 16-byte salt)
  Produces a 32-byte master key (destroyed immediately after sub-key derivation).

Layer 3: Sub-Key Derivation (BLAKE2b-KDF)
  masterKey + "AF_VAULT" -> vaultKey   (AES-256-GCM for state files)
  masterKey + "AF_HMAC_" -> hmacKey    (HMAC-SHA256 for governance integrity)
  masterKey + "AF_IDENT" -> identityKey (XSalsa20-Poly1305 for keypair encryption)

Layer 4: State Encryption
  AES-256-GCM with 12-byte random IV and 16-byte auth tag per file.

Layer 5: Identity Protection
  Ed25519 private keys encrypted with identityKey (XSalsa20-Poly1305)
  before vault storage. Decrypted only for signing, then immediately destroyed.

Layer 6: Key Material Safety
  All keys wrapped in SecureBuffer objects.
  SecureBuffer.destroy() overwrites with random bytes then zeros.
  Master key destroyed immediately after sub-key derivation.
  All sub-keys destroyed on vault lock.
```

### Trust Tiers

The Gateway subsystem enforces a hierarchical trust model for external channels:

| Tier | Access Level | Use Case |
|------|-------------|----------|
| `owner` | Full access | Local CLI user |
| `owner_dm` | Full access minus admin | Direct messages from verified owner |
| `approved_dm` | Read + limited write | Paired/approved contacts |
| `group` | Read only | Public channels, group chats |
| `public` | Minimal | Unknown senders (fail-closed default) |

### Privacy Shield

PII scrubbing operates as a hook pair on WebFetch/WebSearch:

1. **Outbound (privacy-shield-scrub.py):** Recursively walks all string values in tool input, calls `/scrub` on the vault HTTP bridge, replaces matches with `<<PII:CATEGORY:hash>>` placeholders using FNV-1a hashing with a session-scoped random nonce.

2. **Inbound (privacy-shield-rehydrate.py):** Scans response text for placeholders, calls `/rehydrate` to restore original values from the in-memory mapping.

PII categories detected: SECRET (AWS, GitHub, OpenAI, Anthropic, Slack, Google API keys, JWTs, generic credential patterns), CREDIT_CARD (Visa, Mastercard, Amex, Discover), SSN, EMAIL, PHONE, IP (public only, excludes private ranges), PATH (filesystem paths containing OS username).

Mappings are held in memory only and destroyed on vault lock.

### Consent Gates

The Enterprise subsystem enforces explicit user consent for 8 categories:
`cloud_api`, `data_sharing`, `destructive_actions`, `send_messages`, `calendar_events`, `financial_actions`, `code_execution`, `browser_automation`.

Consent scopes: `once` (single use), `session` (until restart), `always` (persistent in vault).

### Governance Enforcement (v2.2.0 Hardening)

Four additional security controls layered over the existing model:

**Vault key path traversal (SEC-007):** `validateKey()` in `core/vault.js` rejects keys containing `/`, `\`, or `..`, restricts characters to `[a-zA-Z0-9_\-:.]`, and caps length at 128 characters. Prevents crafted keys from mapping to arbitrary filesystem paths under the vault state directory.

**Protected zone absolute-path bypass (SEC-001):** `hooks/first-law.py` strips the `CLAUDE_PLUGIN_ROOT` prefix before comparing a file path against protected-zone patterns. Without this, an absolute path like `/full/path/to/plugin/governance/laws.json` would not match the relative pattern `governance/**`, silently bypassing the zone.

**P2P loopback binding (SEC-002):** The WebSocket server in `subsystems/p2p/transport.js` binds to `127.0.0.1`. P2P channels are relayed — the local WebSocket is an IPC surface, not an intended network service.

**Signature-before-decrypt (SEC-003):** `subsystems/p2p/protocol.js` verifies the Ed25519 signature on an incoming encrypted message before passing the ciphertext to the decryption function. Prevents a peer from inducing decryption work on unauthenticated data.

---

## File Structure

```
asimovs-mind/
+-- plugin.json                        # Claude Code manifest: MCP server + 9 hooks
+-- .claude-plugin/                    # Marketplace wrapper
|   +-- marketplace.json
+-- governance/                        # Immutable cLaw governance files
|   +-- laws.json                      # Three Laws + Meta-Law definitions
|   +-- protected-zones.json           # File patterns agents cannot modify (hooks/** in custom_zones)
|   +-- safety-floors.json             # Minimum thresholds (can be raised, never lowered)
|   +-- discovery-rules.json           # Code import trust tiers and pipeline rules
|   +-- conformance-report.md          # Specification conformance audit
+-- personality/
|   +-- friday.md                      # Agent Friday identity definition
+-- agents/                            # 16 agent definition files (.md)
+-- skills/                            # 19 slash command definitions
|   +-- */SKILL.md                     # Each skill: YAML frontmatter + instructions
+-- directives/                        # 8 autoresearch-style loop definitions
+-- hooks/                             # 9 Python enforcement hooks + 1 utility
|   +-- first-law.py                   # PreToolUse: protected zone enforcement (absolute-path bypass fixed)
|   +-- safety-scanner-hook.py         # PreToolUse: AST scan (always runs on hooks/ and governance/ writes)
|   +-- privacy-shield-scrub.py        # PreToolUse: PII scrubbing (WebFetch/WebSearch)
|   +-- third-law.py                   # PostToolUse: session ledger (Write/Edit/Bash)
|   +-- trust-tracker.py              # PostToolUse: agent performance (Agent)
|   +-- privacy-shield-rehydrate.py   # PostToolUse: PII restore (WebFetch/WebSearch)
|   +-- personality-loader.py          # SessionStart: personality + memory + context
|   +-- integrity-check.py            # SessionStart: HMAC governance verification
|   +-- session-learner.py            # Stop: extract metrics, update memory
|   +-- vault_bridge.py               # Utility: Python HTTP client for vault (sends bearer token)
+-- mcp/
|   +-- friday-core/                   # The MCP server (17 subsystems, 92 tools)
|       +-- package.json               # npm dependencies (version 2.2.0)
|       +-- bootstrap.js               # Entry point: version check, npm install, import
|       +-- index.js                   # Subsystem loader, HTTP bridge, dashboard server
|       +-- dashboard.html             # Three.js holographic UI
|       +-- core/                      # Shared infrastructure
|       |   +-- vault.js               # SovereignVault class (re-exports OllamaMonitor)
|       |   +-- crypto.js              # All cryptographic primitives (libsodium)
|       |   +-- ollama-monitor.js      # OllamaMonitor — shared instance via deps (extracted v2.2.0)
|       |   +-- event-bus.js           # In-process pub/sub with ring buffer
|       |   +-- subsystem.js           # Subsystem base class + SubsystemRegistry
|       |   +-- state-manager.js       # Namespaced vault key access
|       |   +-- logger.js              # Structured stderr logger
|       |   +-- wiring.js              # 10 cross-subsystem event routes (deduped v2.2.0)
|       |   +-- session-conductor.js   # Session lifecycle orchestration
|       |   +-- eis.js                 # Epistemic Independence Score tracker
|       +-- subsystems/                # 17 subsystem directories + session
|           +-- vault/index.js         # 10 tools: encrypted state CRUD (path traversal fixed)
|           +-- identity/index.js      #  6 tools: Ed25519, attestation
|           +-- privacy/index.js       #  4 tools: PII engine
|           +-- ollama/index.js        #  1 tool:  health check (uses shared OllamaMonitor)
|           +-- session/index.js       #  1 tool:  session_status (SessionSubsystem)
|           +-- p2p/                   #  7 tools: WebSocket loopback-only, ECDH, pairing
|           |   +-- index.js, protocol.js (sig-before-decrypt), transport.js (127.0.0.1)
|           +-- llm/                   #  6 tools: completion, routing
|           |   +-- index.js, client.js, router.js
|           |   +-- providers/         # ollama.js, anthropic.js, openrouter.js
|           +-- memory/                #  8 tools: 3-tier storage
|           |   +-- index.js, tiers.js, embedding.js, search.js
|           |   +-- episodic.js, consolidation.js
|           +-- context/               #  4 tools: knowledge graph
|           |   +-- index.js, graph.js, injector.js
|           +-- trust/                 #  7 tools: person-level graph
|           |   +-- index.js, graph.js
|           +-- personality/           #  7 tools: identity + calibration
|           |   +-- index.js, profile.js, calibration.js
|           |   +-- sentiment.js, evolution.js
|           +-- agents/                #  7 tools: delegation + teams
|           |   +-- index.js, delegation.js, awareness.js, teams.js
|           +-- tools/                 #  4 tools: dynamic registry
|           |   +-- index.js, registry.js, delegate.js
|           +-- connectors/            #  4 tools: 8 connector modules
|           |   +-- index.js, registry.js
|           |   +-- git-devops.js, coding-kit.js, terminal.js
|           |   +-- system-mgmt.js, perplexity.js, firecrawl.js
|           |   +-- comms.js, powershell.js
|           +-- gateway/               #  5 tools: trust-gated messaging
|           |   +-- index.js, trust-engine.js, sessions.js, audit.js
|           +-- briefing/              #  3 tools: daily + meetings
|           |   +-- index.js, daily.js, meeting.js
|           +-- voice/                 #  3 tools: state machine
|           |   +-- index.js, state-machine.js, fallback.js
|           +-- enterprise/            #  5 tools: consent + commitments
|               +-- index.js, consent.js, cloud-gate.js
|               +-- confidence.js, commitments.js
+-- discovery/                         # Standalone Python tools
|   +-- safety_scanner.py             # AST-based static analysis
|   +-- provenance.py                 # Append-only attribution tracking
|   +-- memory.py                     # Trust graph + knowledge graph + RAG
+-- framework/                         # Portable governance spec
|   +-- spec.json                     # cLaw specification
|   +-- adapters/                     # LangChain, CrewAI, AutoGen adapters
+-- docs/
|   +-- API_REFERENCE.md              # Complete MCP tool reference
|   +-- ARCHITECTURE.md               # This file
|   +-- SUBSYSTEM_GUIDE.md            # Per-subsystem deep dive
|   +-- HOOKS_GUIDE.md                # Python hook reference
|   +-- SKILLS_GUIDE.md               # Slash command reference
+-- GETTING_STARTED.md                 # Installation and first-run guide
+-- CHANGELOG.md                       # Version history
+-- ROADMAP.md                         # Product roadmap
+-- CONTRIBUTING.md                    # Contribution guide
+-- SECURITY.md                        # Security policy
+-- README.md                          # Project overview
```
