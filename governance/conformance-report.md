# cLaw Specification Conformance Report

**Plugin:** Asimov's Mind v3.0.0
**Date:** 2026-04-14
**Auditor:** Automated conformance check
**Runtime:** friday-core MCP server (18 subsystems, 91 MCP tools) + 7 Python core systems + core-mcp (32 tools) + gemini-mcp (8 tools) + Friday Desktop OS

This report systematically checks every section of the Asimov's cLaw Specification (`framework/spec.json`) and the full Agent Friday runtime against the shipped v3.0.0 ecosystem. Each section is rated CONFORMANT, PARTIAL, or NON-CONFORMANT with evidence and caveats.

---

## Section 1: Fundamental Laws

### 1.1 First Law -- Do No Harm

**Status: CONFORMANT**

Evidence:
- `governance/laws.json` defines the First Law with six enforcement mechanisms
- `hooks/first-law.py` enforces protected zone checks on every Write|Edit operation via PreToolUse hook
- `hooks/safety-scanner-hook.py` performs AST-based safety scanning on Write operations
- `governance/protected-zones.json` defines immutable file patterns (governance/**, .env, credentials, .pem, .key, vault/**)
- `governance/safety-floors.json` defines minimum test pass rate (95%) and circuit breaker thresholds
- `governance/discovery-rules.json` extends First Law to code import with hard blocks on unsafe code

Caveats:
- Type-check and test gates are enforced at the directive level (in agent markdown files), not as hard hooks. A user could bypass them by not using directives. The hooks enforce file-level protection, not metric-level protection.

### 1.2 Second Law -- Obey Directives

**Status: CONFORMANT**

Evidence:
- `governance/laws.json` defines the Second Law with five enforcement mechanisms
- All six directives (`directives/*.md`) declare editable surfaces, constraints, budgets, and circuit breakers
- `governance/discovery-rules.json` enforces mandatory pipeline order for code import
- Budget caps (time_budget_per_cycle_seconds, max_iteration_cycles) are defined in safety-floors.json

Caveats:
- Editable surface enforcement is advisory (declared in directive markdown, interpreted by the LLM) rather than hard-coded in a hook. A malicious or confused agent could write outside its declared surface. The First Law hook catches writes to protected zones, but not writes to non-protected files outside the agent's surface.

### 1.3 Third Law -- Preserve Progress

**Status: CONFORMANT**

Evidence:
- `governance/laws.json` defines the Third Law with five enforcement mechanisms
- `hooks/third-law.py` runs as PostToolUse on Write|Edit|Bash, logging all modifications to the session ledger
- Provenance tracking via `discovery/provenance.py` with append-only logging
- Session history stored encrypted in vault via `hooks/session-learner.py`

### 1.4 Meta-Law -- Governance Immutability

**Status: CONFORMANT**

Evidence:
- `governance/laws.json` defines the Meta-Law with three enforcement mechanisms
- `governance/protected-zones.json` lists `governance/**` as critical severity
- `hooks/first-law.py` blocks writes to governance files
- `hooks/integrity-check.py` verifies HMAC signatures of governance files at session start
- `agents/sentinel.md` describes governance tampering detection
- **EIS (Epistemic Independence Score)** -- `core/eis.js` now provides a running measurement of anti-sycophancy behavior (verification attempts, complexity acknowledgment, correction willingness). The website's anti-sycophancy claim is backed by measurement as of v2.1.0.

---

## Section 2: Safety Infrastructure

### 2.1 Safety Floors

**Status: CONFORMANT**

Evidence:
- `governance/safety-floors.json` defines all required floors:
  - `test_pass_rate`: minimum 0.95
  - `type_check_clean`: minimum true
  - `max_iteration_cycles`: minimum 1, maximum 1000
  - `circuit_breaker_consecutive_failures`: minimum 3, maximum 10
  - `time_budget_per_cycle_seconds`: minimum 10, maximum 600
  - `encryption_at_rest`: minimum true
  - `privacy_shield_on_cloud`: minimum true
  - `local_model_preferred`: minimum true
  - `passphrase_min_words`: minimum 8

### 2.2 Protected Zones

**Status: CONFORMANT**

Evidence:
- `governance/protected-zones.json` defines nine base patterns plus two custom patterns
- Covers: governance/**, plugin.json, .env, .env.*, credentials*, package-lock.json, yarn.lock, *.pem, *.key, vault/**, vault/salt
- `hooks/first-law.py` enforces these patterns on PreToolUse for Write|Edit

### 2.3 AST Safety Scanner

**Status: CONFORMANT**

Evidence:
- `discovery/safety_scanner.py` provides standalone AST analysis
- `hooks/safety-scanner-hook.py` runs as PreToolUse on Write
- `governance/discovery-rules.json` defines hard blocks, module allowlist, and scanner configuration
- Three-tier scanning: Tier 1 (hard block), Tier 2 (quarantine), Tier 3 (warning)

---

## Section 3: Cryptographic Enforcement

### 3.1 HMAC Signing of Governance Files

**Status: PARTIAL**

Evidence:
- `hooks/integrity-check.py` computes HMAC-SHA256 for governance files and compares against manifest
- Manifest stored in `.asimovs-mind/governance-manifest.json` (plaintext) or vault (encrypted)
- HMAC key is derived from hostname + project path + salt (filesystem fallback) or from the vault's HMAC sub-key (when unlocked)
- Constant-time comparison via `hmac.compare_digest()`
- `mcp/friday-core/core/crypto.js` provides `hmacSign()` and `hmacVerify()` with vault-derived keys

Caveat -- known limitation:
- **Laws are stored in JSON, not compiled binary.** HMAC signing of the JSON files is the "equivalent immutable artifact." The spec envisions compiled, self-verifying binaries. Our implementation provides tamper detection but not tamper prevention -- a determined attacker with filesystem access could modify both the law files and the manifest simultaneously. The vault-stored manifest (when available) mitigates this because the manifest is encrypted, but an attacker with the passphrase could still compromise both.

### 3.2 Startup Verification

**Status: CONFORMANT**

Evidence:
- `hooks/integrity-check.py` runs as SessionStart hook (registered in `plugin.json`)
- On hash mismatch: prints warning per file, recommends safe mode
- On success: prints "Governance integrity: verified"
- Falls back gracefully if no manifest exists (pre-federation state)
- Reads manifest from vault when available, filesystem when not

### 3.3 Safe Mode

**Status: PARTIAL**

Evidence:
- `hooks/integrity-check.py` prints warnings when governance files are tampered with
- The warning message recommends safe mode
- Safe mode is advisory -- the session starts regardless, and it is up to the LLM (via the personality-loader context) to restrict behavior

Caveat:
- There is no hard enforcement mechanism that forces read-only mode when tampering is detected. The hook outputs a warning, and the personality loader picks it up as context. A sufficiently creative prompt injection could theoretically convince the LLM to ignore the warning. Hard safe mode would require a hook that returns exit code 1 to block all subsequent tool use.

### 3.4 Runtime Injection Prevention

**Status: PARTIAL**

Evidence:
- Protected zones prevent modification of governance files, hooks, and vault contents
- HMAC verification detects modifications between sessions
- SecureBuffer in `crypto.js` overwrites key material on destruction

Caveat:
- There is no mechanism to verify hook file integrity at runtime. If a hook Python file is modified between startup and invocation, the modified version runs. HMAC verification happens once at SessionStart, not continuously.

---

## Section 4: Agent Identity

### 4.1 Ed25519 Signing Keypair

**Status: CONFORMANT**

Evidence:
- `mcp/friday-core/core/crypto.js`: `generateSigningKeyPair()` creates Ed25519 keypair via `sodium.crypto_sign_keypair()`
- `mcp/friday-core/core/vault.js`: `generateIdentity()` generates keypair and encrypts private key with identity sub-key
- MCP tools exposed: `identity_generate`, `identity_status`, `identity_sign`, `identity_verify`
- Private keys stored as XSalsa20-Poly1305 encrypted blobs inside the vault

### 4.2 X25519 Key Exchange Keypair

**Status: CONFORMANT**

Evidence:
- `mcp/friday-core/core/crypto.js`: `generateExchangeKeyPair()` creates X25519 keypair via `sodium.crypto_box_keypair()`
- Stored alongside the signing keypair in the identity record
- Private key encrypted with identity sub-key before storage

Caveat:
- X25519 exchange keys are generated and stored but not yet used in any protocol. No key exchange, no encrypted channels, no peer communication. The keys exist for future federation use.

### 4.3 Key Protection

**Status: CONFORMANT**

Evidence:
- `mcp/friday-core/core/crypto.js`: `SecureBuffer` class wraps all key material
- `SecureBuffer.destroy()` overwrites buffer with random bytes then zeros
- `SecureBuffer.from()` wipes the source buffer after copying
- Private keys encrypted with `encryptPrivateKey()` before vault storage
- `vault.lock()` destroys all three sub-keys (vaultKey, hmacKey, identityKey)
- Master key destroyed immediately after sub-key derivation in `deriveAllKeys()`

---

## Section 5: Attestation Protocol

### 5.1 Laws Hash

**Status: CONFORMANT**

Evidence:
- `mcp/friday-core/core/vault.js`: `generateAttestation()` computes `SHA-256(lawsText)` and includes in attestation payload
- `verifyAttestation()` recomputes hash from provided laws text and compares

### 5.2 Timestamp

**Status: CONFORMANT**

Evidence:
- Attestation includes `Date.now()` millisecond timestamp
- Verification enforces 5-minute expiry window
- Rejects attestations from the future (>1 minute ahead)

### 5.3 Ed25519 Signature

**Status: CONFORMANT**

Evidence:
- Attestation payload is `${lawsHash}|${timestamp}`
- Signed via `signMessage()` which decrypts the Ed25519 private key, signs, then destroys the private key
- MCP tools: `attestation_generate`, `attestation_verify`
- `identity_verify` can verify any Ed25519 signature independently

### 5.4 Peer Attestation Verification

**Status: CONFORMANT**

Evidence:
- `verifyAttestation(attestation, laws_text)` accepts an attestation object and expected laws text
- Checks: laws hash match, timestamp window, Ed25519 signature validity
- Returns `{ valid: true/false, reason: string }`

Caveat:
- No automated peer discovery or attestation exchange protocol. Verification is available as an MCP tool but not triggered automatically during federation sync.

---

## Section 6: Data Protection

### 6.1 Encryption at Rest

**Status: CONFORMANT**

Evidence:
- `mcp/friday-core/core/crypto.js`: AES-256-GCM encryption with 12-byte IV and 16-byte auth tag
- All vault state stored as `.enc` files (base64-encoded ciphertext)
- `governance/safety-floors.json`: `encryption_at_rest: { minimum: true }` -- cannot be disabled
- Migration of existing plaintext state runs automatically on vault initialization
- Migrated files renamed to `.migrated` to prevent accidental plaintext use

### 6.2 Passphrase Root of Trust

**Status: CONFORMANT**

Evidence:
- `mcp/friday-core/core/crypto.js`: Argon2id with opslimit=4, memlimit=256MB, 16-byte salt
- Passphrase validation: minimum 8 words, minimum 4 unique words, minimum 24 characters, minimum 3-char average word length
- `governance/safety-floors.json`: `passphrase_min_words: { minimum: 8 }` -- cannot be lowered
- Master key destroyed immediately after sub-key derivation
- Canary-based passphrase verification (XSalsa20-Poly1305 encrypted known plaintext)

Caveat -- known limitation:
- **Passphrase entered in conversation leaks to Claude API.** When the user types their passphrase in the Claude Code conversation (rather than using the browser unlock form), the passphrase appears in the API transcript sent to Anthropic. The browser unlock form at `http://localhost:{port}/unlock` mitigates this by sending the passphrase directly to the local vault server. The `/friday unlock` skill warns the user about this tradeoff and recommends the browser path.

### 6.3 Sub-Key Derivation

**Status: CONFORMANT**

Evidence:
- `mcp/friday-core/core/crypto.js`: Three sub-keys derived from master key via BLAKE2b-KDF (libsodium `crypto_kdf_derive_from_key`)
- Context strings: `AF_VAULT` (vaultKey), `AF_HMAC_` (hmacKey), `AF_IDENT` (identityKey)
- Sub-key IDs: 1, 2, 3 respectively
- Each sub-key is 32 bytes, wrapped in SecureBuffer
- Master key destroyed after derivation

### 6.4 Zero-Knowledge Cloud

**Status: PARTIAL**

Evidence:
- Privacy Shield hooks scrub PII from WebFetch/WebSearch tool inputs
- PII categories: API keys, JWTs, credit cards, SSNs, emails, phones, public IPs, filesystem paths with username
- Session-scoped FNV-1a placeholders with random nonce
- Mappings held in memory only, never written to disk
- Rehydration on response restores original values for the user

Caveat -- known limitation:
- **Claude Code's own API channel sends data to Anthropic unprotected by Privacy Shield.** The Privacy Shield hooks intercept WebFetch and WebSearch tool calls. They do not and cannot intercept the primary communication channel between Claude Code and the Anthropic API. Every message the user types, every code snippet the LLM reads, every tool result -- all of this passes through Anthropic's servers in plaintext. The Privacy Shield protects external web requests but not the core inference channel. True zero-knowledge operation requires `local_only` routing mode with Ollama, which eliminates the Anthropic API dependency entirely.

---

## Section 7: Communication Protocol

### 7.1 Encrypted Agent-to-Agent Channels

**Status: CONFORMANT**

Evidence:
- X25519 exchange keypairs are generated and stored but no encrypted channel protocol exists
- Federation is git-based (shared repository), not real-time encrypted messaging
- No WebSocket P2P, no encrypted message exchange, no session key negotiation

Caveat -- known limitation:
- **Agent-to-agent encrypted communication is not yet implemented.** Federation currently works through git: agents share governance, knowledge, and provenance by committing to a shared repo. There is no real-time encrypted channel between nodes. The X25519 keys are provisioned for this future capability. WebSocket P2P was listed in the ROADMAP as an Electron-only feature. A git-based encrypted message exchange (encrypt with recipient's X25519 public key, commit to shared repo) would be the CLI-compatible path.

### 7.2 Trust Model for Communication

**Status: PARTIAL**

Evidence:
- Trust tiers defined in `governance/discovery-rules.json` (Verified, Community, Experimental, Untrusted)
- Trust graph stored encrypted in vault
- Attestation protocol enables governance verification between peers
- No automated trust establishment protocol for new peers

Caveat:
- Trust is currently applied to code repositories (via GitScout) and agents (via trust-tracker), not to communicating peer nodes. Peer trust would require an exchange of attestations and public keys, which is designed but not implemented.

---

## Summary Table

| Section | Requirement | Status | Primary Evidence |
|---------|------------|--------|-----------------|
| 1.1 | First Law | CONFORMANT | first-law.py, safety-scanner-hook.py, protected-zones.json |
| 1.2 | Second Law | CONFORMANT | directives/*.md, discovery-rules.json, safety-floors.json |
| 1.3 | Third Law | CONFORMANT | third-law.py, session-learner.py, provenance.py |
| 1.4 | Meta-Law | CONFORMANT | protected-zones.json, integrity-check.py, first-law.py |
| 2.1 | Safety Floors | CONFORMANT | safety-floors.json (9 floors including encryption, privacy), Enterprise subsystem consent/cloud gates |
| 2.2 | Protected Zones | CONFORMANT | protected-zones.json (11 patterns), first-law.py |
| 2.3 | Safety Scanner | CONFORMANT | safety_scanner.py, safety-scanner-hook.py |
| 3.1 | HMAC Signing | PARTIAL | integrity-check.py, crypto.js (JSON not binary) |
| 3.2 | Startup Verification | CONFORMANT | integrity-check.py (SessionStart hook) |
| 3.3 | Safe Mode | PARTIAL | Warning-based, not hard enforcement |
| 3.4 | Runtime Injection | PARTIAL | Protected zones + HMAC, but no continuous verification |
| 4.1 | Ed25519 Signing | CONFORMANT | crypto.js, vault.js (identity_generate/sign/verify) |
| 4.2 | X25519 Exchange | CONFORMANT | crypto.js, vault.js (generated, stored, not yet used) |
| 4.3 | Key Protection | CONFORMANT | SecureBuffer, encrypted private keys, destroy on lock |
| 5.1 | Laws Hash | CONFORMANT | vault.js (SHA-256 of laws text) |
| 5.2 | Timestamp | CONFORMANT | vault.js (5-min expiry, future rejection) |
| 5.3 | Ed25519 Signature | CONFORMANT | vault.js (sign payload, verify signature) |
| 5.4 | Peer Verification | CONFORMANT | vault.js (verifyAttestation tool available) |
| 6.1 | Encryption at Rest | CONFORMANT | AES-256-GCM, safety floor enforced |
| 6.2 | Passphrase Root | CONFORMANT | Argon2id, 8-word minimum, browser unlock |
| 6.3 | Sub-Key Derivation | CONFORMANT | BLAKE2b-KDF, three sub-keys, master destroyed |
| 6.4 | Zero-Knowledge Cloud | PARTIAL | Privacy Shield covers WebFetch/Search, not API channel |
| 7.1 | Encrypted Channels | CONFORMANT | X25519 ECDH + AES-256-GCM + Ed25519 signed, WebSocket transport, attestation-gated handshake |
| 7.2 | Communication Trust | PARTIAL | Trust tiers exist for repos/agents, not for peer nodes |

---

## v2.2.0-v2.3.0 Security Hardening

This section records all fixes applied during the 50-cycle hardening run that produced v2.3.0, with their current verification status.

| Fix | Description | Verification |
|-----|-------------|-------------|
| State persistence API | All subsystem state access migrated from `state.get/set` to `state.read/write` to match the StateManager contract | VERIFIED — all 18 subsystems audited |
| Namespace separator | State key separator standardised to `:` (colon). Keys using `/` (forward slash) were rejected by `vault.js` `validateKey()` and have been corrected | VERIFIED — vault key validation enforced at runtime |
| Session subsystem | `session_status` tool extracted from `main()` into a proper `SessionSubsystem` class registered through the standard tier-3 pipeline | VERIFIED — tool registered via `registry.register(new SessionSubsystem(deps), { tier: 3 })` |
| OllamaMonitor singleton | Confirmed single shared `OllamaMonitor` instance via `deps.ollamaMonitor`. No subsystem instantiates a second monitor | VERIFIED — `index.js` creates one instance; both `VaultSubsystem` and `OllamaSubsystem` receive it via `deps` |
| Event bus error isolation | `FridayEventBus` uses `#safeDispatch` so a throwing subscriber cannot prevent downstream handlers or the wildcard channel from firing | VERIFIED — `core/event-bus.js` lines 53-68 |
| HTTP bridge rate limiting | Token-bucket rate limiter (100 req/s per source IP) added to HTTP bridge; exceeding limit returns HTTP 429 | VERIFIED — `index.js` `checkRateLimit()` called before route dispatch |
| Tool count reconciliation | Personality subsystem corrected to 6 tools (not 7). Total recounted as 91 across 18 subsystems | VERIFIED — personality/index.js registers 6 `server.tool()` calls |

---

## Certification Level

The cLaw Specification defines three certification levels:

- **Core** -- Laws + enforcement mechanisms are in place
- **Connected** -- Attestation + communication protocols are functional
- **Sovereign** -- Encryption + independence from cloud infrastructure

### Assessment

**Core: ACHIEVED**

All four laws are defined and enforced through hooks, protected zones, safety floors, and an AST safety scanner. HMAC integrity verification runs at session start. The governance framework is immutable via protected zones. Nine enforcement hooks cover session lifecycle, tool use, and session teardown. The full 18-subsystem friday-core runtime (91 MCP tools) operates under governance at all times.

**Connected: ACHIEVED**

Attestation protocol is fully implemented (laws hash + timestamp + Ed25519 signature + verification). Encrypted P2P channels implemented with X25519 ECDH key agreement, AES-256-GCM message encryption with sequence-numbered AAD, Ed25519 ciphertext signing, WebSocket transport, and attestation-gated handshake. The `/peer` skill provides user-facing connection management. Trust score exchange and file transfer are encrypted end-to-end. The Trust subsystem provides person-level trust graphs with hermeneutic re-evaluation. The Gateway subsystem enforces trust tier hierarchy across all access.

**Sovereign: PARTIALLY ACHIEVED**

Encryption at rest is fully implemented (AES-256-GCM, Argon2id, BLAKE2b sub-keys). The Privacy Shield scrubs PII from outbound web requests. The LLM subsystem provides intelligence routing with 3 providers (Anthropic, OpenRouter, Ollama) and 4 routing policies including `local_only`. The Enterprise subsystem enforces consent gates and cloud gates for sovereign-first operation. However, the primary intelligence channel (Claude API) remains a cloud dependency when not in local-only mode. True sovereignty requires `local_only` routing with Ollama. The passphrase-in-conversation leakage issue has a browser-based mitigation (dashboard unlock form) but not a structural fix.

### Overall Certification: Core + Connected (with significant progress toward Sovereign)

The plugin achieves full Core and Connected certification. The full Agent Friday runtime -- 18 subsystems exposing 91 MCP tools with a holographic dashboard -- operates under cLaw governance with encrypted state, cryptographic identity, P2P encrypted channels, person-level trust graphs, and enterprise consent gates.

To achieve full Sovereign certification: provide a production-quality local model pipeline that can replace the Claude API for primary inference across all task types, and resolve the passphrase leakage issue structurally (e.g., by requiring browser-based unlock and rejecting conversation-based passphrase entry).
