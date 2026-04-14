# Asimov's Mind — Developer Reference

**Current version:** 3.0.0 (Full Python Ecosystem)
**MCP server:** `mcp/friday-core/` — 18 subsystems, 91 tools, HTTP bridge, holographic dashboard
**Python stack:** `core/` — 7 standalone systems | `mcp-servers/` — core-mcp (32 tools), gemini-mcp (8 tools) | `interfaces/desktop/` — Friday Desktop OS

---

## Quick Commands

```bash
# Run all tests
cd mcp/friday-core && npm test

# Run a specific test file
cd mcp/friday-core && node --test test/test-core.js

# Start the MCP server directly (for debugging)
cd mcp/friday-core && node bootstrap.js

# Check vault state directory
ls .asimovs-mind/vault/

# Read bridge token (for manual HTTP bridge calls)
cat .asimovs-mind/vault/bridge-token

# Hit the HTTP bridge manually (read-only, no auth needed)
curl http://127.0.0.1:$(cat .asimovs-mind/vault/port)/status
```

---

## Architecture in One Page

```
Claude Code
  |-- plugin.json          entry point: loads friday-core, registers 9 hooks
  |-- hooks/*.py           Python pre/post tool hooks (read stdin JSON, write stdout, exit 0/2)
  |-- skills/*/SKILL.md    19 slash commands
  |
  v
mcp/friday-core/
  bootstrap.js             Node version check, npm install if needed, then imports index.js
  index.js                 Creates vault, event bus, OllamaMonitor, registers 18 subsystems,
                           starts HTTP bridge on random 127.0.0.1 port, writes port file
  core/
    vault.js               SovereignVault (AES-256-GCM state, Argon2id KDF)
    crypto.js              All libsodium primitives
    ollama-monitor.js      OllamaMonitor — single shared instance via deps object
    event-bus.js           FridayEventBus (ring buffer, per-topic throttle, wildcard channel)
    wiring.js              10 cross-subsystem event subscriptions
    session-conductor.js   Session lifecycle: greeting, commitments, project detection
    eis.js                 Epistemic Independence Score tracker
  subsystems/              18 directories, each exports a Subsystem subclass
```

**Subsystem load order (4 tiers):**

| Tier | Subsystems |
|------|-----------|
| 0 | vault, identity, privacy, ollama |
| 1 | p2p (needs identity) |
| 2 | llm, memory, context, trust, personality (need vault/ollama/event bus) |
| 3 | agents, tools, connectors, gateway, briefing, voice, enterprise, session |

---

## Key Patterns

### Adding a new subsystem

1. Create `mcp/friday-core/subsystems/<name>/index.js` exporting a class that extends `Subsystem`.
2. Override `registerTools(server)` to call `server.tool(...)` for each MCP tool.
3. Import and register it in `index.js` at the correct tier using the tier registration syntax:
   ```js
   registry.register(new MySubsystem(deps), { tier: 2 });
   ```
4. Add it to the tool count comment in `index.js`.
5. Update the subsystem count in `CLAUDE.md`, `docs/API_REFERENCE.md`, `ROADMAP.md`, and `governance/conformance-report.md`.

### Subsystem constructor

Every subsystem receives `deps = { vault, eventBus, stateManager, logger, ollamaMonitor }`. Access namespaced state via `this.state = deps.stateManager.namespace('myname')`.

### Event bus

Publish: `deps.eventBus.publish('topic:action', { ...data })`.
Subscribe: `deps.eventBus.subscribe('topic:action', handler)` — wrap in try/catch.
All 10 cross-subsystem routes live in `core/wiring.js`. Add new routes there, not in subsystem constructors.

The event bus uses `#safeDispatch` internally so a throwing subscriber never prevents downstream subscribers or the wildcard channel from running. Each listener is called individually with its own try/catch; errors are re-emitted on the `error` channel if a listener exists, otherwise swallowed. This means event handlers do not need to be wrapped in try/catch for error isolation, but should still handle errors they intend to act on.

### HTTP bridge (Python hooks)

Hooks cannot use stdio MCP. They use the HTTP bridge:

```python
from vault_bridge import vault_read, vault_write, vault_available

if vault_available():
    data = vault_read('my-key')
    vault_write('my-key', {'updated': True})
```

`vault_bridge.py` reads the port from `.asimovs-mind/vault/port` and the bearer token from `.asimovs-mind/vault/bridge-token`. It sends `Authorization: Bearer <token>` on all write requests automatically.

**Rate limiting:** The HTTP bridge enforces a token-bucket rate limiter of 100 requests per second per source IP. Requests that exceed this limit receive HTTP 429 `{ "error": "Rate limit exceeded" }`. Python hooks should handle 429 responses with a brief back-off before retrying. The rate limit only applies to the localhost bridge — it is not a concern under normal hook operation.

### Hook return protocol

- Exit 0, empty stdout = allow the tool call
- Exit 2, stdout = `{"decision": "block", "reason": "..."}` = block with reason shown to user
- Exit 0, stdout = `{"hookSpecificOutput": {...}}` = allowed, with metadata

---

## Security Invariants

These must not be broken. If a PR changes any of these, it needs explicit review.

| Invariant | Where enforced |
|-----------|---------------|
| Vault keys cannot contain path separators or `..` | `core/vault.js` `validateKey()` |
| Protected zones checked against both relative and absolute paths | `hooks/first-law.py` (CLAUDE_PLUGIN_ROOT stripped before comparison) |
| HTTP bridge only accepts 127.0.0.1 connections | `index.js` remoteAddress check at top of every request handler |
| Write endpoints require bearer token | `index.js` `requiresAuth` check before route matching |
| `/tool/:name` restricted to 4 read-only tools | `index.js` `HTTP_TOOL_WHITELIST` |
| POST bodies capped at 4 MB | `index.js` `readBody()` |
| P2P WebSocket binds to 127.0.0.1 only | `subsystems/p2p/transport.js` |
| P2P: signature verified before decryption | `subsystems/p2p/protocol.js` |
| Safety scanner always runs on hooks/ and governance/ writes | `hooks/safety-scanner-hook.py` |
| hooks/** in protected zones config | `governance/protected-zones.json` custom_zones |

---

## Gotchas

**`mcp/vault-server/` is gone.** It was removed in v2.2.0. All references to it in docs and skills are historical. The vault lives in `mcp/friday-core/subsystems/vault/` and `mcp/friday-core/core/vault.js`.

**OllamaMonitor is a shared instance.** Both `VaultSubsystem` and `OllamaSubsystem` receive the same `OllamaMonitor` via `deps.ollamaMonitor`. Do not instantiate a second one — it would run a separate polling loop.

**`session_status` is a SessionSubsystem tool.** It is no longer registered directly in `main()`. It lives in `subsystems/session/index.js` and is registered through the standard subsystem pipeline.

**Duplicate event subscriptions in wiring.js were a bug.** Each event route must appear exactly once. Check before adding new subscriptions.

**`core/vault.js` re-exports OllamaMonitor.** Backward-compat: `import { OllamaMonitor } from './vault.js'` still works. Prefer `import { OllamaMonitor } from './ollama-monitor.js'` for clarity.

**Hook stdin is a full JSON object**, not just the tool arguments. The top-level keys are `tool_name`, `tool_input`, `hook_event_name`, `session_id`, etc.

**Protected-zone patterns are relative.** `governance/**` matches `governance/laws.json`, not `/abs/path/governance/laws.json`. The absolute-path bypass fix in `first-law.py` handles this by stripping `CLAUDE_PLUGIN_ROOT` before comparison.

**The `.asimovs-mind/` directory is per-project.** It is created in `process.env.CLAUDE_PROJECT_ROOT || process.cwd()` at MCP server startup. Each project gets its own encrypted vault, port file, and federation state.

**State namespace separator is `:` not `/`.** When constructing namespaced state keys, the separator between the subsystem namespace and the key name is a colon, e.g. `memory:observations`. Using a forward slash will conflict with vault key validation, which treats `/` as a path separator and rejects keys containing it. Always use `this.state.read('my-key')` and `this.state.write('my-key', value)` within a subsystem — the namespace prefix is added automatically.

---

## File Locations for Common Tasks

| Task | File |
|------|------|
| Add a governance law | `governance/laws.json` |
| Add a protected file pattern | `governance/protected-zones.json` (custom_zones only — core zones are immutable) |
| Change a safety floor | `governance/safety-floors.json` (can only be raised, never lowered) |
| Add a skill | `skills/<name>/SKILL.md` |
| Add an agent | `agents/<name>.md` |
| Modify session greeting | `mcp/friday-core/core/session-conductor.js` |
| Add a cross-subsystem event route | `mcp/friday-core/core/wiring.js` |
| Modify HTTP bridge endpoints | `mcp/friday-core/index.js` `startHttpBridge()` |
| Add a vault tool | `mcp/friday-core/subsystems/vault/index.js` |
| Modify PII detection patterns | `mcp/friday-core/subsystems/privacy/index.js` |
| Change P2P message handling | `mcp/friday-core/subsystems/p2p/protocol.js` |
