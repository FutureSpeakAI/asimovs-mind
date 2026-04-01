# FutureSpeak.AI Website Alignment Check

**Plugin:** Asimov's Mind v1.0.0
**Date:** 2026-04-01
**Purpose:** Verify which claims made on the FutureSpeak.AI website about Asimov's Mind are now accurate, partially accurate, or still false after the Sovereign Forge implementation.

---

## Implementation Decision

**Agent Friday (Electron)** remains the reference desktop implementation. It provides the voice pipeline (PersonaPlex), GUI, system tray daemon, and the original nexus-os module that the Sovereign Vault was ported from.

**Asimov's Mind (Claude Code plugin)** becomes the reference CLI/server implementation. It provides the full governance kernel, encrypted state, Ed25519 identity, Privacy Shield, intelligence routing, and the entire agent swarm -- all accessible from any terminal without requiring Electron.

Both implementations share the same cLaw governance specification, the same Three Laws, and the same cryptographic primitives (Argon2id, AES-256-GCM, BLAKE2b, Ed25519). The vault's key hierarchy and encryption format are compatible between implementations.

---

## Claim Verification

### Claim: "Safety Enforced by Math, Not Promises"

**Status: TRUE**

Evidence:
- HMAC-SHA256 verification of governance files at every session start (`hooks/integrity-check.py`)
- AES-256-GCM encryption of all persistent state with authenticated encryption (auth tag verification)
- Argon2id key derivation with 256MB memory-hard parameter
- Ed25519 digital signatures for cLaw attestation
- BLAKE2b sub-key derivation for cryptographic key separation
- SecureBuffer with cryptographic wipe on destruction
- Canary-based passphrase verification using XSalsa20-Poly1305

The governance integrity check, encryption, key derivation, and attestation are all mathematically verifiable. They do not depend on policy compliance or honor-system promises. The cryptographic primitives are provided by libsodium, a well-audited library.

Caveat: The "math" enforces integrity and confidentiality of stored state. It does not enforce behavioral compliance -- the LLM could still be prompt-injected into ignoring governance warnings. The hooks block certain actions (writes to protected zones), but safe mode after tampering detection is advisory.

---

### Claim: "Does Not Phone Home"

**Status: PARTIALLY TRUE**

Evidence for the claim:
- The Sovereign Vault is entirely local. No vault data is sent to any remote server.
- The Privacy Shield scrubs PII from WebFetch and WebSearch requests before they leave the machine.
- The vault server listens only on `127.0.0.1` and rejects non-localhost connections.
- Ed25519 private keys never leave the local machine.
- PII mappings are held in memory only and never written to disk.
- Ollama monitoring connects only to the local Ollama instance.
- Federation syncs through git (user-controlled), not through any FutureSpeak.AI server.

Evidence against the claim:
- **Claude Code's primary API channel sends all conversation data to Anthropic.** Every message, every code snippet, every tool result passes through Anthropic's cloud API. This is a structural dependency of running inside Claude Code, not something the plugin controls.
- In `auto`, `local_preferred`, or `cloud_preferred` routing modes, inference requests go to Anthropic's API.
- If the user enters their passphrase in the conversation (instead of using the browser form), it appears in the API transcript.

Website copy change needed:
- Qualify the claim. Suggested text: "The Asimov's Mind plugin does not phone home. No vault data, no telemetry, no analytics leave your machine. However, Claude Code itself communicates with Anthropic's API for inference. The Privacy Shield scrubs PII from web requests, but the core conversation channel is outside the plugin's control. For full local operation, use `/route policy local_only` with Ollama."

---

### Claim: "Sovereign-Local Agent"

**Status: PARTIALLY TRUE**

Evidence for the claim:
- All persistent state encrypted locally (AES-256-GCM)
- Passphrase-derived keys that never leave the machine
- Ed25519 identity generated and stored locally
- Ollama integration provides a path to fully local inference
- `local_only` routing policy eliminates cloud dependency entirely
- Privacy Shield prevents PII leakage on web requests
- Safety floors enforce encryption and privacy as non-optional

Evidence against the claim:
- **The default operating mode depends on Anthropic's cloud API for primary intelligence.** Without Ollama, the agent cannot function at all in local_only mode.
- Claude Code itself is an Anthropic product -- the plugin runs inside Anthropic's runtime.
- The `auto` and `cloud_preferred` routing policies send inference to the cloud.
- Local models (as of 2026) are significantly less capable than cloud models for complex reasoning, multi-file refactoring, and long-context tasks.

Website copy change needed:
- Qualify the claim. Suggested text: "Asimov's Mind is sovereign-local by architecture. All state is encrypted on your machine. All keys are derived from your passphrase. With Ollama and local models, Friday operates with zero cloud dependency. In cloud-assisted mode, the Privacy Shield scrubs outbound requests, but the primary inference channel runs through Anthropic's API. Sovereignty is a spectrum -- the plugin gives you the controls to choose your position on it."

---

### Claim: "Governed by cLaws"

**Status: TRUE**

Evidence:
- `governance/laws.json` defines Three Laws + Meta-Law
- Nine hooks enforce governance at every lifecycle stage:
  - SessionStart: personality-loader, integrity-check
  - PreToolUse: first-law (Write|Edit), safety-scanner (Write), privacy-shield-scrub (WebFetch|WebSearch)
  - PostToolUse: third-law (Write|Edit|Bash), trust-tracker (Agent), privacy-shield-rehydrate (WebFetch|WebSearch)
  - Stop: session-learner
- Protected zones block modification of governance files, credentials, vault contents
- Safety floors enforce minimum thresholds that cannot be lowered
- HMAC integrity verification at session start
- AST safety scanning on code writes
- Discovery pipeline enforces mandatory step order
- The Meta-Law is enforced: governance files are in protected zones, HMAC-signed, and monitored by the Sentinel agent

No caveats. This claim is straightforwardly true. The governance framework is comprehensive, immutable, and cryptographically verified.

---

### Claim: "Encrypted State"

**Status: TRUE**

Evidence:
- AES-256-GCM with 12-byte random IV and 16-byte auth tag
- Argon2id key derivation (opslimit=4, memlimit=256MB)
- BLAKE2b sub-key derivation for key separation
- All vault state stored as `.enc` files
- `encryption_at_rest` safety floor is `true` and cannot be lowered
- Automatic migration of plaintext state on vault initialization
- SecureBuffer wipes key material on destruction

No caveats. This claim is unambiguously true.

---

### Claim: "Privacy-First"

**Status: PARTIALLY TRUE**

Evidence for the claim:
- Privacy Shield scrubs PII from WebFetch and WebSearch
- Seven PII categories detected: API keys, credit cards, SSNs, emails, phones, IPs, filesystem paths
- PII mappings held in memory only
- `privacy_shield_on_cloud` safety floor is mandatory
- `local_model_preferred` safety floor encourages local inference
- Browser-based vault unlock keeps passphrase out of API transcript

Evidence against the claim:
- Claude Code's API channel is not covered by the Privacy Shield
- In non-local_only modes, code and conversation content is sent to Anthropic
- PII scrubbing uses regex patterns that may miss novel PII formats
- The user can bypass browser unlock and enter passphrase in conversation

Website copy change needed:
- Suggested text: "Privacy-first architecture. All state encrypted. PII scrubbed from web requests. Local inference available via Ollama. The Privacy Shield protects the tools the agent uses. The core inference channel to Anthropic's API is outside the plugin's control -- for full privacy, use local_only mode."

---

### Claim: "Ed25519 Cryptographic Identity"

**Status: TRUE**

Evidence:
- Ed25519 signing keypair generated via libsodium
- X25519 exchange keypair generated via libsodium
- Private keys encrypted with vault identity sub-key (XSalsa20-Poly1305)
- cLaw attestation: SHA-256 laws hash + timestamp + Ed25519 signature
- Attestation verification with 5-minute expiry
- MCP tools: identity_generate, identity_status, identity_sign, identity_verify, attestation_generate, attestation_verify

No caveats. The cryptographic identity system is fully implemented.

---

### Claim: "Self-Improving Agent Swarm"

**Status: TRUE**

Evidence:
- 16 built-in agents across Discovery, Improvement, Governance, Learning, and Infrastructure categories
- Dynamic agent discovery at swarm cycle start
- `/create-agent` for user-defined specialists
- 6 autoresearch-style directives with measure-modify-keep/discard loops
- Meta-Improver creates new agents bounded by Meta-Law
- Governed by cLaws at every step

No caveats. This has been true since v0.3.0 and remains true.

---

## Summary of Website Copy Changes Needed

| Claim | Current Accuracy | Action Required |
|-------|:---:|---|
| Safety Enforced by Math | TRUE | None -- claim is accurate |
| Does Not Phone Home | PARTIALLY TRUE | Add qualifier about Claude Code API channel |
| Sovereign-Local Agent | PARTIALLY TRUE | Add qualifier about cloud dependency, describe sovereignty spectrum |
| Governed by cLaws | TRUE | None -- claim is accurate |
| Encrypted State | TRUE | None -- claim is accurate |
| Privacy-First | PARTIALLY TRUE | Add qualifier about API channel, mention local_only for full privacy |
| Ed25519 Identity | TRUE | None -- claim is accurate |
| Self-Improving Swarm | TRUE | None -- claim is accurate |

### Recommended New Claims to Add

1. **"AES-256-GCM Encrypted Vault"** -- New capability shipped in v1.0.0. Should be featured prominently.
2. **"Privacy Shield"** -- New capability. Describe PII scrubbing with appropriate scope limitations.
3. **"Intelligence Router"** -- New capability. Describe Ollama integration and routing policies.
4. **"Browser-Based Passphrase Entry"** -- Differentiator. The passphrase never touches the API transcript when using the browser form.

### Recommended Disclosures to Add

1. **Claude Code API dependency** -- Be transparent about the structural limitation. Users running Claude Code send conversation data to Anthropic. The plugin mitigates this (Privacy Shield, local_only mode) but cannot eliminate it while running inside Claude Code.
2. **local_only mode** -- Present this as the path to true sovereignty. Describe what capabilities are available locally and what is lost without cloud inference.
3. **Passphrase leakage risk** -- Be transparent about conversation-based passphrase entry. Recommend browser entry. Explain why.

---

## Implementation Notes

The reference architecture is now:

```
FutureSpeak.AI Ecosystem
|
+-- Agent Friday (Electron) -- Reference desktop implementation
|   +-- PersonaPlex voice pipeline
|   +-- GUI (settings, trust graph, chat)
|   +-- System tray daemon
|   +-- nexus-os (original vault, original Privacy Shield)
|   +-- Asimov's Mind kernel (embedded)
|
+-- Asimov's Mind (Claude Code Plugin) -- Reference CLI/server implementation
    +-- Sovereign Vault MCP server
    +-- 9 governance hooks
    +-- 15 skills
    +-- 16 agents
    +-- 6 directives
    +-- Privacy Shield hooks
    +-- Ed25519 identity
    +-- Ollama intelligence router
    +-- Full governance kernel
```

Both implementations share:
- cLaw governance specification
- Three Laws + Meta-Law
- Argon2id + AES-256-GCM + BLAKE2b key hierarchy
- Ed25519 + X25519 keypairs
- Privacy Shield PII patterns
- Trust tier system
- Federation via git
