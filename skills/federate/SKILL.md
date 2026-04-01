---
name: federate
description: "Initialize and manage this project as an Asimov's Mind federation node. Sets up Ed25519 identity, cLaw attestation, governance signing, knowledge store, and agent discovery."
user_invocable: true
---

# /federate -- Federation Management

Initialize and manage this project as an Asimov's Mind federation node. Creates the `.asimovs-mind/` directory, generates Ed25519 identity keypairs, produces cLaw attestations, signs governance files, sets up the knowledge store, and discovers available agents.

## Usage

```
/federate init              # Initialize federation node
/federate status            # Show node status
/federate verify            # Re-verify governance integrity
/federate agents            # List all discovered agents
/federate sync              # Explain federation state propagation
```

## Instructions

### `/federate init`

Initialize this project as a federation node. This is idempotent -- running it again re-signs governance and re-discovers agents.

**Step 1: Create directory structure**

```
.asimovs-mind/
  config.json               # Node identity and metadata
  trust.json                # Trust scores for agents and sources
  governance-manifest.json  # HMAC hashes of governance files
  session-ledger.jsonl      # Current session activity (cleared each session)
  session-history.jsonl     # Full session history (append-only)
  user-profile.json         # User preferences from /friday profile
  .salt                     # Random salt for HMAC derivation
  knowledge/
    recent-sessions.json    # Last 5 session summaries
  agents/
    (project-local agent overrides go here)
  federation/
    node-identity.json      # Ed25519 public key for this node
    attestation.json        # Latest cLaw attestation
    trust-summary.json      # Aggregated public trust scores for peers
```

Create all directories. Do not overwrite existing files (preserve user data).

**Step 2: Generate salt**

Generate a random 32-character hex string and write it to `.asimovs-mind/.salt`. Only generate if the file does not already exist (preserve existing salt to maintain hash continuity).

**Step 3: Generate Ed25519 identity keypair**

Call the `identity_generate` MCP tool to create an Ed25519 keypair for this node:

1. Call `identity_generate` with the node identifier (hostname + project path hash)
2. The private key is stored securely in the vault (never written to disk in plaintext)
3. Write the public key to `.asimovs-mind/federation/node-identity.json`:

```json
{
  "description": "Ed25519 public identity for this federation node. Private key stored in vault.",
  "version": "1.0.0",
  "node_id": "hostname-project-hash",
  "public_key": "base64-encoded-ed25519-public-key",
  "public_key_format": "Ed25519 base64",
  "created_at": "ISO timestamp",
  "rotated_at": null,
  "key_source": "vault:identity-keypair"
}
```

If an identity already exists (node-identity.json has a non-null public_key), skip generation. Existing identities are preserved to maintain federation continuity. To rotate keys, use a separate key-rotation workflow.

**Step 4: Sign governance files**

For each file in `${CLAUDE_PLUGIN_ROOT}/governance/`:
1. Read the file contents
2. Derive the HMAC key: `SHA256(hostname + ":" + project_path + ":" + salt)`
3. Compute `HMAC-SHA256(file_contents, key)`
4. Store the hash in the manifest

Write `.asimovs-mind/governance-manifest.json`:

```json
{
  "signed_at": "ISO timestamp",
  "plugin_root": "/path/to/plugin",
  "files": {
    "governance/laws.json": "hex-hash",
    "governance/protected-zones.json": "hex-hash",
    "governance/safety-floors.json": "hex-hash",
    "governance/discovery-rules.json": "hex-hash"
  }
}
```

**Step 5: Generate cLaw attestation**

Call the `attestation_generate` MCP tool to produce a cryptographic attestation of governance integrity:

1. Gather the governance manifest (all file hashes from Step 4)
2. Call `attestation_generate` with the governance hash and the node's Ed25519 private key (retrieved from vault)
3. The attestation is a signed statement proving this node's governance files are intact at this point in time
4. Write the attestation to `.asimovs-mind/federation/attestation.json`:

```json
{
  "description": "Latest cLaw attestation. Cryptographically signed proof that governance files are intact.",
  "version": "1.0.0",
  "attestation": "base64-encoded-ed25519-signature",
  "signed_at": "ISO timestamp",
  "signer_public_key": "base64-encoded-public-key",
  "governance_hash": "SHA256 of concatenated governance file hashes",
  "algorithm": "Ed25519",
  "files_attested": [
    "governance/laws.json",
    "governance/protected-zones.json",
    "governance/safety-floors.json",
    "governance/discovery-rules.json"
  ]
}
```

**Step 6: Discover agents**

Glob for all agent definition files:
- `${CLAUDE_PLUGIN_ROOT}/agents/**/*.md` -- plugin-provided agents
- `.asimovs-mind/agents/**/*.md` -- project-local agent overrides

Count total unique agents (by filename, project-local overrides plugin).

**Step 7: Write node config**

Write `.asimovs-mind/config.json`:

```json
{
  "node_id": "hostname-based identifier",
  "hostname": "machine hostname",
  "project_path": "/absolute/path/to/project",
  "initialized_at": "ISO timestamp",
  "last_verified": "ISO timestamp",
  "agent_count": 15,
  "governance_integrity": "verified",
  "identity_public_key": "first 16 chars of public key...",
  "attestation_age_seconds": 0,
  "plugin_version": "from plugin.json"
}
```

Read `${CLAUDE_PLUGIN_ROOT}/plugin.json` to get the plugin version.

**Step 8: Report**

Print:

```
Federation node initialized. N agents discovered. Governance signed.
Identity: Ed25519 keypair generated (public key: <first 16 chars>...)
Attestation: cLaw governance attested at <timestamp>
```

### `/federate status`

Gather and display node status:

1. Read `.asimovs-mind/config.json` for node identity
2. Read `.asimovs-mind/governance-manifest.json` for signing info
3. Count agents (plugin + project-local)
4. Read `.asimovs-mind/trust.json` for trust scores (if exists)
5. Check governance integrity by running the same HMAC verification as `integrity-check.py`
6. Read `.asimovs-mind/federation/node-identity.json` for identity public key
7. Read `.asimovs-mind/federation/attestation.json` for attestation age
8. Read `.asimovs-mind/federation/trust-summary.json` for peer trust summary

Display:

```
=== FEDERATION NODE STATUS ===

Node: [hostname]
Project: [project path]
Initialized: [timestamp]
Plugin: asimovs-mind v[version]

Identity:
  Public Key: [first 32 chars of Ed25519 public key]...
  Key Created: [timestamp]
  Key Source: vault:identity-keypair

Attestation:
  Status: valid | expired | missing
  Signed: [timestamp]
  Age: [N hours/days ago]
  Files Attested: N governance files

Agents: N discovered
  Plugin: M agents
  Local:  K overrides

Governance:
  Files signed: N
  Integrity: verified | WARNING
  Last verified: [timestamp]

Federation Peers:
  Total: N peers
  High trust: N | Moderate: N | Low: N
  [or "No peers discovered yet"]

Trust Store:
  [N entries or "empty"]
```

### `/federate verify`

Re-run governance integrity verification using cryptographic attestation:

1. For each file in `.asimovs-mind/governance-manifest.json`, recompute HMAC-SHA256
2. Compare against stored hashes
3. Call `attestation_verify` MCP tool to cryptographically verify the cLaw attestation:
   - Pass the current governance hash (recomputed from files)
   - Pass the stored attestation signature from `.asimovs-mind/federation/attestation.json`
   - Pass the node's public key from `.asimovs-mind/federation/node-identity.json`
   - The tool verifies the Ed25519 signature matches the governance state
4. Report results per-file and attestation status:

```
Governance Verification:
  governance/laws.json              OK verified
  governance/protected-zones.json   OK verified
  governance/safety-floors.json     OK verified
  governance/discovery-rules.json   OK verified

HMAC Integrity: All governance files verified. No tampering detected.

Cryptographic Attestation:
  Signature: valid
  Signer: [first 16 chars of public key]...
  Attested: [timestamp] ([age] ago)
  Governance Hash: matches current state

All checks passed. Governance integrity confirmed via HMAC and Ed25519 attestation.
```

Or if mismatches are found:

```
Governance Verification:
  governance/laws.json              OK verified
  governance/protected-zones.json   FAIL MODIFIED
  governance/safety-floors.json     OK verified
  governance/discovery-rules.json   OK verified

HMAC Integrity: WARNING: 1 governance file has been modified externally.

Cryptographic Attestation:
  Signature: INVALID -- governance hash does not match attested state
  Last valid attestation: [timestamp]

WARNING: Governance state has diverged from last attestation.
Re-sign with /federate init or investigate the change.
```

Update `last_verified` timestamp in `.asimovs-mind/config.json`.

### `/federate agents`

List all discovered agents with their source:

1. Glob `${CLAUDE_PLUGIN_ROOT}/agents/**/*.md` for plugin agents
2. Glob `.asimovs-mind/agents/**/*.md` for project-local agents
3. Read the YAML frontmatter from each to get name and description

Display:

```
=== DISCOVERED AGENTS ===

Plugin Agents (from asimovs-mind):
  meta-improver    -- Recursive self-improvement engine
  debugger         -- Autonomous bug hunting and fixing
  optimizer        -- Performance measurement and tuning
  git-scout        -- GitHub code discovery
  git-loader       -- Code integration pipeline
  sentinel         -- Security and compliance verification
  ...

Project-Local Agents:
  (none)

Total: N agents available
```

If a project-local agent has the same name as a plugin agent, mark it as an override:

```
Project-Local Agents:
  debugger (overrides plugin)  -- Custom debugger with project-specific rules
```

### `/federate sync`

Explain how federation state propagates via git and what is public vs private.

**Display this explanation:**

```
=== FEDERATION STATE SYNC ===

Federation state propagates through git. When you commit and push
.asimovs-mind/, peers can discover your node's public identity and
governance attestations. Private state never leaves your machine.

PUBLIC (committed to git, visible to federation peers):
  .asimovs-mind/federation/
    node-identity.json       Ed25519 public key
    attestation.json         cLaw governance attestation
    trust-summary.json       Aggregated peer trust (no raw scores)
  .asimovs-mind/agents/       Project-local agent definitions
  .asimovs-mind/knowledge/    Non-sensitive knowledge graph data
  .asimovs-mind/config.json   Node metadata (no secrets)
  .asimovs-mind/governance-manifest.json   HMAC hashes of governance files

PRIVATE (git-ignored, encrypted in vault):
  .asimovs-mind/vault/        AES-256-GCM encrypted state
    Contains: trust scores, evidence log, entity graph,
              session history, automation patterns,
              provenance ledger, Ed25519 private key
  .asimovs-mind/session-ledger.jsonl   Temporary session data
  .asimovs-mind/*.migrated    Old plaintext files

SYNC WORKFLOW:
  1. /federate init           Generate identity + sign governance
  2. git add .asimovs-mind/   Stage public federation state
  3. git commit + push        Propagate to peers
  4. Peers pull and run /federate verify to validate your attestation

The .asimovs-mind/.gitignore ensures vault/, session-ledger.jsonl,
and *.migrated are never committed. All sensitive state stays local
and encrypted.
```

Then list the contents of `.asimovs-mind/.gitignore` to confirm the boundary is correctly configured.
