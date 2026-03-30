---
name: federate
description: "Initialize and manage this project as an Asimov's Mind federation node. Sets up governance signing, knowledge store, and agent discovery."
user_invocable: true
---

# /federate — Federation Management

Initialize and manage this project as an Asimov's Mind federation node. Creates the `.asimovs-mind/` directory, signs governance files, sets up the knowledge store, and discovers available agents.

## Usage

```
/federate init              # Initialize federation node
/federate status            # Show node status
/federate verify            # Re-verify governance integrity
/federate agents            # List all discovered agents
```

## Instructions

### `/federate init`

Initialize this project as a federation node. This is idempotent — running it again re-signs governance and re-discovers agents.

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
```

Create all directories. Do not overwrite existing files (preserve user data).

**Step 2: Generate salt**

Generate a random 32-character hex string and write it to `.asimovs-mind/.salt`. Only generate if the file does not already exist (preserve existing salt to maintain hash continuity).

**Step 3: Sign governance files**

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

**Step 4: Discover agents**

Glob for all agent definition files:
- `${CLAUDE_PLUGIN_ROOT}/agents/**/*.md` — plugin-provided agents
- `.asimovs-mind/agents/**/*.md` — project-local agent overrides

Count total unique agents (by filename, project-local overrides plugin).

**Step 5: Write node config**

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
  "plugin_version": "from plugin.json"
}
```

Read `${CLAUDE_PLUGIN_ROOT}/plugin.json` to get the plugin version.

**Step 6: Report**

Print:

```
Federation node initialized. N agents discovered. Governance signed.
```

### `/federate status`

Gather and display node status:

1. Read `.asimovs-mind/config.json` for node identity
2. Read `.asimovs-mind/governance-manifest.json` for signing info
3. Count agents (plugin + project-local)
4. Read `.asimovs-mind/trust.json` for trust scores (if exists)
5. Check governance integrity by running the same HMAC verification as `integrity-check.py`

Display:

```
═══ FEDERATION NODE STATUS ═══

Node: [hostname]
Project: [project path]
Initialized: [timestamp]
Plugin: asimovs-mind v[version]

Agents: N discovered
  Plugin: M agents
  Local:  K overrides

Governance:
  Files signed: N
  Integrity: verified | WARNING
  Last verified: [timestamp]

Trust Store:
  [N entries or "empty"]
```

### `/federate verify`

Re-run governance integrity verification:

1. For each file in `.asimovs-mind/governance-manifest.json`, recompute HMAC-SHA256
2. Compare against stored hashes
3. Report results per-file:

```
Governance Verification:
  governance/laws.json              ✓ verified
  governance/protected-zones.json   ✓ verified
  governance/safety-floors.json     ✓ verified
  governance/discovery-rules.json   ✓ verified

All governance files verified. No tampering detected.
```

Or if mismatches are found:

```
Governance Verification:
  governance/laws.json              ✓ verified
  governance/protected-zones.json   ✗ MODIFIED
  governance/safety-floors.json     ✓ verified
  governance/discovery-rules.json   ✓ verified

WARNING: 1 governance file has been modified externally.
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
═══ DISCOVERED AGENTS ═══

Plugin Agents (from asimovs-mind):
  meta-improver    — Recursive self-improvement engine
  debugger         — Autonomous bug hunting and fixing
  optimizer        — Performance measurement and tuning
  git-scout        — GitHub code discovery
  git-loader       — Code integration pipeline
  sentinel         — Security and compliance verification
  ...

Project-Local Agents:
  (none)

Total: N agents available
```

If a project-local agent has the same name as a plugin agent, mark it as an override:

```
Project-Local Agents:
  debugger (overrides plugin)  — Custom debugger with project-specific rules
```
