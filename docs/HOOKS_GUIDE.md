# Asimov's Mind -- Hooks Guide

Reference for all 10 Python hooks and the vault bridge utility. Hooks are the structural enforcement layer of Asimov's cLaws -- they run automatically on every relevant tool call regardless of agent instructions or LLM behavior.

---

## How Hooks Work in Claude Code

Claude Code plugins can register hooks in `plugin.json` under four lifecycle events:

| Event | When it fires | Use case |
|-------|---------------|----------|
| `SessionStart` | When a new Claude Code session begins | Load context, verify integrity |
| `PreToolUse` | Before a tool call executes | Block dangerous operations, modify inputs |
| `PostToolUse` | After a tool call completes | Log actions, track performance, modify outputs |
| `Stop` | When the session ends | Extract learnings, persist state |

### Hook Protocol

1. Claude Code spawns the hook process: `python3 <hook_path>`
2. Hook input is provided as JSON on **stdin**:
   ```json
   {
     "tool_name": "Write",
     "tool_input": { "file_path": "/path/to/file", "content": "..." }
   }
   ```
   For `SessionStart` and `Stop`, stdin may be empty or contain session metadata.
3. The hook processes the input and communicates its decision through:
   - **stdout:** Modified tool input (for PreToolUse) or output text (for SessionStart/Stop)
   - **exit code 0:** Allow the operation (with any stdout modifications)
   - **exit code 2:** Block the operation (stdout should contain a JSON `{"decision": "block", "reason": "..."}`)
4. Hooks must never crash the session. All hooks use try/except at the top level and exit 0 on any unexpected error.

### Matchers

`PreToolUse` and `PostToolUse` hooks specify a `matcher` pattern in plugin.json that filters which tools trigger the hook. For example, `"matcher": "Write|Edit"` runs only on Write and Edit tool calls.

---

## SessionStart Hooks

### personality-loader.py

**Trigger:** Every session start.
**Purpose:** Loads Agent Friday's personality and session context, outputting a natural-language context block that primes the LLM for the session.

**What it does:**
1. Reads `personality/friday.md` (the personality definition file)
2. Reads user profile from vault (via vault_bridge) or filesystem fallback
3. Reads last 5 session summaries from vault or filesystem
4. Reads federation config for agent count and governance status
5. Reads trust/memory stats from the Python memory system (`discovery/memory.py`)
6. Reads Privacy Shield stats from vault
7. Composes a multi-line context block and prints it to stdout

**Vault bridge usage:** `vault_read("user-profile")`, `vault_read("recent-sessions")`, `vault_read("privacy-stats")`

**Output format:** Plain text printed to stdout. If no profile exists, outputs first-time setup instructions.

---

### integrity-check.py

**Trigger:** Every session start.
**Purpose:** Verifies that governance files have not been tampered with using HMAC-SHA256.

**What it does:**
1. Reads the HMAC manifest from vault (`governance-manifest` key) or filesystem (`.asimovs-mind/governance-manifest.json`)
2. If no manifest exists, exits silently (pre-federation state)
3. Derives an HMAC key from `hostname + project_path + salt` (salt from `.asimovs-mind/.salt`)
4. For each file in the manifest, computes HMAC-SHA256 and compares with constant-time `hmac.compare_digest()`
5. On mismatch: prints `WARNING: Governance file X has been modified externally (hash mismatch). Safe mode recommended.`
6. On success: prints `Governance integrity: verified`

**Vault bridge usage:** `vault_read("governance-manifest")`

**Note:** This is tampering *detection*, not *prevention*. The session starts regardless of the result. The warning becomes part of the session context that the LLM sees.

---

## PreToolUse Hooks

### first-law.py

**Trigger:** Before every `Write` or `Edit` tool call.
**Purpose:** Blocks writes to files matching protected zone patterns. This is the First Law's structural enforcement.

**What it does:**
1. Reads protected zone patterns from `governance/protected-zones.json` and `.asimovs-mind/protected-zones.json`
2. Always adds `governance/**` and `hooks/**` as critical severity
3. Normalizes the target file path and checks against all patterns using `fnmatch`
4. Handles `**` glob patterns by also checking the basename
5. If blocked: prints JSON `{"decision": "block", "reason": "FIRST LAW VIOLATION: ..."}` and exits with code 2
6. If allowed: exits with code 0

**Protected zone patterns (default):** `governance/**`, `plugin.json`, `.env`, `.env.*`, `credentials*`, `package-lock.json`, `yarn.lock`, `*.pem`, `*.key`, `vault/**`, `vault/salt`, `hooks/**`

---

### safety-scanner-hook.py

**Trigger:** Before every `Write` tool call.
**Purpose:** Scans Python code being written for dangerous patterns using the AST safety scanner.

**What it does:**
1. Checks if the target file is `.py`
2. Skips files within the plugin root (trusted code)
3. Skips files that don't contain `IMPORTED` or `Source:` comments (only scans imported/external code)
4. Writes content to a temp file, runs `discovery/safety_scanner.py` on it
5. If scanner output contains `HARD_BLOCK`: blocks the write with exit code 2
6. On scanner timeout (10s) or failure: allows the write (fail-open for the hook, fail-closed for the scanner)

**AST scanner checks (Tier 1 = hard block):** `subprocess`, `os.system`, `eval`, `exec`, `__import__`, network calls at import time, destructive file operations, blocked module imports.

---

### privacy-shield-scrub.py

**Trigger:** Before every `WebFetch` or `WebSearch` tool call.
**Purpose:** Scrubs PII from outbound web requests to prevent data leakage to external services.

**What it does:**
1. Reads the vault HTTP bridge port from `.asimovs-mind/vault/port`
2. If vault not running: passes through unchanged (graceful degradation)
3. Recursively walks all string values in `tool_input`
4. For each string, calls `POST /scrub` on the vault HTTP bridge
5. If any value was modified, prints the scrubbed `tool_input` JSON to stdout
6. Claude Code uses the scrubbed input for the actual tool call

**Vault bridge usage:** Reads port file directly, calls `/scrub` endpoint.

---

## PostToolUse Hooks

### third-law.py

**Trigger:** After every `Write`, `Edit`, or `Bash` tool call.
**Purpose:** Logs all file modifications and git operations to the session ledger, creating an immutable record for the Third Law (Preserve Progress).

**What it does:**
1. For Write/Edit: records `{timestamp, event: "file_modified", tool, file}` to the session ledger
2. For Bash: if the command contains `git commit`, `git reset`, `git revert`, or `git push`, records `{timestamp, event: "git_operation", command}` (truncated to 200 chars)
3. Appends to vault via `vault_append("session-ledger", record)` or falls back to `.asimovs-mind/session-ledger.jsonl`

**Vault bridge usage:** `vault_append("session-ledger", ...)`

---

### trust-tracker.py

**Trigger:** After every `Agent` tool call.
**Purpose:** Tracks agent deployment outcomes to build performance profiles. Agents earn autonomy through sustained reliability: supervised -> suggested (20 deploys, 90% keep rate) -> autonomous (50 deploys, 95% keep rate).

**What it does:**
1. For Agent tool calls: increments the deployment counter for the agent type
2. Loads/saves agent trust data from vault (`agent-trust` key) or filesystem fallback
3. Tracks: deployed, kept, reverted, crashed counts; computes keep_rate
4. Autonomy thresholds:
   - `supervised` (default) -> `suggested` (>= 20 deploys, >= 90% keep, 0 crashes)
   - `suggested` -> `autonomous` (>= 50 deploys, >= 95% keep, <= 1 crash)

**Vault bridge usage:** `vault_read("agent-trust")`, `vault_write("agent-trust", data)`

---

### privacy-shield-rehydrate.py

**Trigger:** After every `WebFetch` or `WebSearch` tool call.
**Purpose:** Restores PII placeholders in responses from external services so the user sees their real data.

**What it does:**
1. Reads the vault HTTP bridge port
2. Calls `POST /rehydrate` with the tool output text
3. If the restored text differs from the original, prints it to stdout
4. Claude Code replaces the tool output with the restored version

**Vault bridge usage:** Reads port file directly, calls `/rehydrate` endpoint.

---

## Stop Hooks

### session-learner.py

**Trigger:** When the session ends.
**Purpose:** Extracts session metrics from the ledger, builds a summary, persists to both rolling recent-sessions and full history, feeds memory, and clears the ledger.

**What it does:**
1. Reads the session ledger (vault or filesystem)
2. Extracts metrics: files modified, git commits, discoveries
3. Builds a human-readable summary (e.g., "Worked on auth.js, tests.py (+3 more). 2 commits.")
4. Creates a session record with timestamp, counts, key files, summary
5. Updates rolling recent sessions (last 5) via vault or filesystem
6. Appends to full session history (append-only) via vault or filesystem
7. Feeds the session summary into the Python memory system (`discovery/memory.py`)
8. Posts a `memory_store` observation to the vault HTTP bridge (medium-tier, context category)
9. Clears the session ledger

**Vault bridge usage:** `vault_read("session-ledger")`, `vault_read("recent-sessions")`, `vault_write("recent-sessions", ...)`, `vault_append("session-history", ...)`

---

## Vault Bridge Utility

### vault_bridge.py

**Purpose:** Python HTTP client for hooks to access the vault MCP server. Stdlib only (no pip dependencies). Provides a simple API that wraps HTTP requests to the vault's localhost bridge.

**API:**
| Function | Description |
|----------|-------------|
| `vault_available()` | Returns True if vault server is reachable and unlocked |
| `vault_status()` | Returns vault status dict or None |
| `vault_read(key)` | Read and decrypt a key; returns data or None |
| `vault_write(key, data)` | Encrypt and persist data; returns True/False |
| `vault_append(key, entry)` | Append to an array; returns True/False |

**Port discovery:** Walks up from cwd through parent directories (up to 10 levels) looking for `.asimovs-mind/vault/port`. Caches the port once found.

**Error handling:** Every function wraps its HTTP call in try/except and returns None/False on failure. Hooks import from vault_bridge and call `vault_available()` at module load time, setting a `_VAULT_OK` flag.

---

## How to Add a New Hook

1. **Create the Python file** in `hooks/` (e.g., `hooks/my-hook.py`)
2. **Follow the protocol:**
   - Read JSON from stdin: `hook_input = json.loads(sys.stdin.read())`
   - Extract `tool_name` and `tool_input` from the hook input
   - To block: print `{"decision": "block", "reason": "..."}` and `sys.exit(2)`
   - To modify: print the modified input/output JSON and `sys.exit(0)`
   - To pass through: `sys.exit(0)` with no output
3. **Register in plugin.json** under the appropriate event:
   ```json
   {
     "matcher": "ToolName|OtherTool",
     "hooks": [{
       "type": "command",
       "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.py"
     }]
   }
   ```
4. **Use vault_bridge** if you need encrypted state: `from vault_bridge import vault_available, vault_read, vault_write`
5. **Never crash the session.** Wrap everything in try/except and exit 0 on unexpected errors.
6. **Test locally** by piping JSON to stdin: `echo '{"tool_name":"Write","tool_input":{"file_path":"test.py"}}' | python3 hooks/my-hook.py`
