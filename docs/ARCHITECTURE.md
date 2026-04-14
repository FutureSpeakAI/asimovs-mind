# Asimov's Mind -- System Architecture

**Version:** 3.0.0
**Runtime:** friday-core MCP server (18 subsystems, 91 MCP tools) + core-mcp Python server (32 tools) + gemini-mcp (8 tools) + Friday Desktop OS + career-ops pipeline

This document describes the full architecture of Asimov's Mind -- the AI agent ecosystem that implements Agent Friday. A developer unfamiliar with the codebase should be able to read this and understand how every component fits together.

For standalone repos of individual components, see the [README](../README.md).

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
                  (entry point)    (10 Python       (17 slash
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
   91 MCP tools               /status, /read, /write
   registered from            /scrub, /rehydrate
   18 subsystems              /unlock, /initialize
                              /tool/:name (generic)
                              / (dashboard.html)

===== Parallel Python Stack =====

   core/                        mcp-servers/
   7 standalone systems         core-mcp/ (32 tools, FastMCP)
   (vault, privacy, trust,     gemini-mcp/ (8 tools, FastMCP)
    memory, personality,
    epistemic, hmac)            interfaces/desktop/
                                Flask + React + Three.js
   tools/career-ops/            Holographic 3D OS
   AI job search pipeline
```

### Subsystem Dependency Tiers

Subsystems within the same tier start in parallel (`Promise.all`). Tiers run in ascending order (0 before 1, 1 before 2, etc.).

```
Tier 0 (Foundation -- no dependencies, parallel startup)
  +-- vault           10 tools   AES-256-GCM state, Argon2id KDF, BLAKE2b sub-keys
  +-- identity         6 tools   Ed25519 signing, X25519 exchange, attestation
  +-- privacy          4 tools   PII scrubbing, session-scoped placeholders
  +-- ollama           1 tool    Local LLM health monitoring

Tier 1 (needs identity, parallel startup within tier)
  +-- p2p              7 tools   WebSocket transport, ECDH channels, pairing

Tier 2 (needs vault, ollama, event bus, parallel startup within tier)
  +-- llm              6 tools   3 providers (Anthropic, OpenRouter, Ollama), router
  +-- memory           8 tools   3-tier storage, embeddings, semantic search
  +-- context          4 tools   Knowledge graph, entity extraction, injection
  +-- trust            7 tools   Person-level graph, hermeneutic re-evaluation
  +-- personality      7 tools   Evolution, calibration, anti-sycophancy

Tier 3 (needs multiple lower-tier subsystems, parallel startup within tier)
  +-- agents           7 tools   Recursive delegation, deadlock detection
  +-- tools            4 tools   Registry, execution delegate, safety gates
  +-- connectors       4 tools   8 connectors, dynamic dispatch (~72 connector tools)
  +-- gateway          5 tools   Trust tiers, session mgmt, audit logging
  +-- briefing         3 tools   Daily briefing, meeting prep, meeting intel
  +-- voice            3 tools   State machine, fallback manager (no audio)
  +-- enterprise       5 tools   Consent gate, cloud gate, confidence, commitments
  +-- session          1 tool    Uptime, cwd context, greeting, commitments
                     ------
                      91 tools
```

The `SessionSubsystem` is registered at Tier 3 but receives its `SessionConductor` via late injection (`setConductor()`) after `registry.startAll()` completes, following the same pattern as `VaultSubsystem.setRegistry()`.

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

**HTTP Bridge Security Model (v2.3.0):**

1. **Localhost binding:** The server binds exclusively to `127.0.0.1` (not `0.0.0.0`). Any request whose `req.socket.remoteAddress` is not `127.0.0.1`, `::1`, or `::ffff:127.0.0.1` is rejected with HTTP 403 before any route is matched.

2. **Rate limiting:** A token-bucket limiter allows 100 requests/second per source IP (burst capacity = 100 tokens). Requests that exceed this receive HTTP 429. Tokens refill proportionally to elapsed time.

3. **Bearer token authentication:** A 64-hex-char random token is generated at startup via `crypto.randomBytes(32)` and written to `.asimovs-mind/vault/bridge-token` (mode 0o600). Write endpoints (`/write`, `/append`) and the generic tool endpoint (`/tool/:name`) require `Authorization: Bearer <token>`. Requests missing or mismatching the token receive HTTP 401.

4. **Tool endpoint whitelist:** `POST /tool/:toolName` is restricted to four read-only tools: `vault_status`, `ollama_status`, `session_status`, `personality_status`. Any other tool name returns HTTP 403. This prevents hooks from triggering write-capable tools via the HTTP path.

5. **Body size limit:** POST request bodies are rejected at 4 MB. The `readBody()` helper counts bytes as chunks arrive and destroys the socket on overflow.

The bridge is not a network-accessible service -- it exists solely for in-process Python/Node IPC on the same machine.

---

## Event Flow: Cross-Subsystem Wiring

The `core/wiring.js` module establishes event subscriptions that connect subsystems. Every subscription is wrapped in try/catch so one broken handler never crashes the bus. The bus itself provides an additional safety layer via `#safeDispatch` -- see "Event Bus Architecture" below.

### Event Subscriptions

| # | Event | Publisher | Subscriber(s) | Effect |
|---|-------|-----------|---------------|--------|
| 1 | `vault:unlocked` | Vault subsystem | Personality, Memory, Context, Trust, Connectors | Cascade-loads all subsystems on vault open |
| 2 | `vault:locking` | Vault subsystem | Memory, Context, Trust, Personality | Flush and save state before keys are destroyed |
| 3 | `memory:stored` | Memory subsystem | Context (graph entity extraction), Personality (sentiment analysis) | New memories feed the knowledge graph and mood tracker |
| 4 | `trust:evidence-added` | Trust subsystem | Gateway (refreshes policies) | Trust changes propagate to access control |
| 5 | `trust:score-updated` | Trust subsystem | Briefing (queues note for next daily) | Trust changes surface in next daily briefing |
| 6 | `agent:completed` | Agent subsystem | Trust (updates agent performance) | Agent results scored |
| 7 | `privacy:scrubbed` | Privacy subsystem | Enterprise (logs consent event) | PII scrub events recorded for audit |
| 8 | `connector:detected` | Connectors subsystem | Tools (auto-registers connector tools) | New connectors auto-populate tool registry |
| 9 | `enterprise:commitment-created` | Enterprise subsystem | Briefing (queues note for next daily) | New commitments surface in next daily briefing |
| 10 | `session:end` | Session Conductor | Memory, Context, Trust, Personality, Enterprise | End-of-session flush for all stateful subsystems |

Additionally, the `llm:request-completed` event feeds the **Epistemic Independence Score** tracker, which monitors verification frequency, query complexity, and correction rate across a rolling 20-interaction window. When the EIS score drops below threshold, the tracker publishes `eis:updated` with a recommendation that the wiring layer uses to raise the personality challenge level automatically.

### Event Bus Architecture

The `FridayEventBus` (core/event-bus.js) extends Node's `EventEmitter`:

- **publish(topic, data)** -- creates a timestamped event with a UUID, pushes to the ring buffer, emits on both the specific topic and the wildcard `*` channel via `#safeDispatch`
- **#safeDispatch(channel, event)** -- iterates listeners individually; a throwing subscriber never prevents subsequent subscribers from running and never crashes the process. If an `error` listener is registered the error is forwarded there; otherwise it is swallowed.
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
   d. registry.startAll() -- calls registerEvents() on all 18 subsystems,
      then starts tiers 0-3 in order; subsystems within each tier start
      in parallel via Promise.all()
   e. wireSubsystems() -- establishes cross-subsystem event routes
   f. SessionConductor.wire() -- listens for vault:unlocked/locking
   g. registry.get('session').setConductor(conductor) -- late-inject conductor
   h. startHttpBridge() -- starts HTTP server on random localhost port, writes port file
   i. Connect MCP stdio transport
   j. Register SIGINT/SIGTERM handlers for graceful shutdown
   k. Register unhandledRejection handler (logs + cleanup + exit 1)

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
1. SIGINT or SIGTERM received (e.g., user closes Claude Code)
   - process.on('SIGINT'/'SIGTERM') fires cleanup() then process.exit(0)

2. unhandledRejection (from subsystem background timers or event handlers):
   - Logged to stderr
   - cleanup() called, then process.exit(1) to avoid degraded state

3. cleanup():
   a. registry.stopAll() -- calls stop() on all 18 subsystems in reverse
      registration order
   b. vault.lock() -- destroys all three sub-keys (vaultKey, hmacKey, identityKey)
   c. httpServer.close()
   d. Removes port file (.asimovs-mind/vault/port)

4. Stop hook fires (Claude Code side, may overlap with server shutdown):
   a. session-learner.py -- reads ledger, extracts metrics, stores summary,
      feeds memory
```

Note: `process.on('exit')` is intentionally not used for cleanup. Exit handlers must be synchronous; `cleanup()` is async. Registering async cleanup on `exit` causes all awaited work to be silently dropped.

---

## State Management

### Vault Key Namespaces

Each subsystem gets a namespaced prefix via `StateManager.namespace(name)`. The separator is `:` (colon), not `/`. Vault key validation rejects path separators (`/` and `\`) but explicitly allows colons, so all subsystem keys take the form `subsystemname:key-name`.

Vault keys are stored as `.enc` files under `.asimovs-mind/vault/state/`.

| Subsystem | Prefix | Key Examples |
|-----------|--------|-------------|
| vault | (root) | `agent-identity`, `user-profile`, `session-ledger` |
| llm | `llm:` | `llm:router-state`, `llm:api-keys` |
| memory | `memory:` | `memory:short-term`, `memory:medium-term`, `memory:long-term`, `memory:episodes`, `memory:session-buffer` |
| context | `context:` | `context:graph` |
| trust | `trust:` | `trust:persons`, `trust:evidence` |
| personality | `personality:` | `personality:profile`, `personality:calibration`, `personality:sentiment`, `personality:evolution`, `personality:personality-history` |
| agents | `agents:` | `agents:delegation-state` |
| connectors | `connectors:` | `connectors:api-keys` |
| gateway | `gateway:` | `gateway:trust-policies`, `gateway:sessions`, `gateway:audit` |
| briefing | `briefing:` | `briefing:history`, `briefing:meetings` |
| enterprise | `enterprise:` | `enterprise:consent`, `enterprise:cloud-policies`, `enterprise:commitments`, `enterprise:outbound` |

Root-level keys (without prefix) remain accessible for backward compatibility with hooks and skills that predate the namespace system.

### Vault File Layout

```
.asimovs-mind/
+-- vault/
    +-- salt              # 16-byte random salt (hex encoded)
    +-- canary.enc        # Passphrase verification blob (XSalsa20-Poly1305)
    +-- meta.json         # Vault metadata (version, created_at, algorithms)
    +-- port              # HTTP bridge port number (written on start, deleted on stop)
    +-- bridge-token      # 64-hex bearer token (mode 0o600, written on start)
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

### P2P Encryption

The P2P handshake is fully implemented (not a stub). The complete flow:

```
1. Agent A sends HANDSHAKE: own X25519 exchange public key + Ed25519-signed
   cLaw attestation
2. Agent B verifies attestation, derives session keys, sends HANDSHAKE_ACK
   with own exchange public key + attestation
3. Agent A verifies the ack's Ed25519 signature before processing the ack,
   then derives session keys from the ECDH shared secret
4. Session keys derived via HKDF (RFC 5869, SHA-256):
   - Salt: SHA-256 of the sorted pair of exchange public keys
   - HKDF-Extract: PRK = HMAC-SHA256(salt, sharedSecret)
   - HKDF-Expand: two separate keys via info bytes 0x01 / 0x02
   - Direction: the peer with the "lower" public key sends on key 1
5. All subsequent messages: AES-256-GCM encrypted + Ed25519 signed
   - Signature covers the ciphertext (not plaintext)
   - Signature verified BEFORE decryption (SEC-003)
6. Sequence numbers in AAD prevent message reordering and replay
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

Consent scopes: `once` (single use, consumed on check), `session` (until restart), `always` (persistent in vault).

`peekConsent(category)` checks consent state without consuming a `once`-scoped grant. Use this when you need to check eligibility before committing to an action.

### Governance Enforcement

**Vault key path traversal (SEC-007):** `validateKey()` in `core/vault.js` rejects keys containing `/`, `\`, or `..`, restricts characters to `[a-zA-Z0-9_\-:.]`, and caps length at 128 characters. Prevents crafted keys from mapping to arbitrary filesystem paths under the vault state directory.

**Protected zone absolute-path bypass (SEC-001):** `hooks/first-law.py` strips the `CLAUDE_PLUGIN_ROOT` prefix before comparing a file path against protected-zone patterns. Without this, an absolute path like `/full/path/to/plugin/governance/laws.json` would not match the relative pattern `governance/**`, silently bypassing the zone.

**P2P loopback binding (SEC-002):** The WebSocket server in `subsystems/p2p/transport.js` binds to `127.0.0.1`. P2P channels are relayed -- the local WebSocket is an IPC surface, not an intended network service.

**Signature-before-decrypt (SEC-003):** `subsystems/p2p/protocol.js` verifies the Ed25519 signature on an incoming encrypted message before passing the ciphertext to the decryption function. Prevents a peer from inducing decryption work on unauthenticated data.

---

## File Structure

```
asimovs-mind/
+-- plugin.json                        # Claude Code manifest: MCP server + 10 hooks
+-- setup.sh / setup.bat               # One-command installer
+-- requirements.txt                   # Unified Python dependencies
+-- core/                              # 7 standalone Python systems (350+ tests)
|   +-- sovereign-vault/               # AES-256-GCM + Argon2id encryption
|   +-- privacy-shield/                # PII detection across 9 categories
|   +-- trust-graph/                   # 5-dimension person-level credibility
|   +-- cognitive-memory/              # 3-tier memory with consolidation
|   +-- personality-evolution/         # 30-trait evolution with anti-sycophancy
|   +-- epistemic-score/               # 6-metric independence tracking
|   +-- hmac-integrity/                # HMAC-SHA256 governance protection
+-- mcp/
|   +-- friday-core/                   # Node.js MCP server (18 subsystems, 91 tools)
|       +-- bootstrap.js               # Entry point: version check, npm install, import
|       +-- index.js                   # Subsystem loader, HTTP bridge, dashboard server
|       +-- dashboard.html             # Three.js holographic UI
|       +-- core/                      # Shared infrastructure
|       |   +-- vault.js               # SovereignVault class
|       |   +-- crypto.js              # All cryptographic primitives (libsodium)
|       |   +-- ollama-monitor.js      # OllamaMonitor (shared instance via deps)
|       |   +-- event-bus.js           # Pub/sub with ring buffer + #safeDispatch
|       |   +-- subsystem.js           # Base class + SubsystemRegistry
|       |   +-- state-manager.js       # Namespaced vault key access (separator: ":")
|       |   +-- logger.js, wiring.js, session-conductor.js, eis.js
|       +-- subsystems/                # 18 subsystem directories (91 tools total)
|       +-- test/                      # 442 tests (0 failures)
+-- mcp-servers/
|   +-- core-mcp/                      # FastMCP wrapping 7 Python systems (32 tools)
|   +-- gemini-mcp/                    # Gemini creative: image, TTS, video, music (8 tools)
+-- interfaces/
|   +-- desktop/                       # Friday Desktop OS
|       +-- server.py                  # Flask backend
|       +-- ui_parts/                  # Modular React components
|       +-- vibe-mode/                 # Three.js 3D: 13 structures, mood, audio
|       +-- build_ui.py                # Assembles UI into index.html
+-- tools/
|   +-- career-ops/                    # AI job search pipeline
+-- hooks/                             # 10 Python governance hooks
+-- skills/                            # 17 slash commands
+-- agents/                            # 16 specialist agent definitions
+-- governance/                        # cLaws, protected zones, safety floors
+-- personality/                       # Agent Friday identity (friday.md)
+-- discovery/                         # Safety scanner, provenance, memory
+-- framework/                         # Portable governance spec + adapters
+-- templates/                         # .env.example + friday-data/ setup
+-- docs/                              # Architecture, API reference, guides
```
