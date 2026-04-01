# Agent Friday -- Skills Guide

Reference for all 19 slash commands available in Asimov's Mind. Skills are user-invokable commands that instruct Claude Code how to behave when triggered. Each skill is defined as a `SKILL.md` file with YAML frontmatter and markdown instructions.

---

## How Skills Work in Claude Code

Skills are markdown files in `skills/<name>/SKILL.md`. When a user types `/<name>` in Claude Code, the skill's instructions are loaded and guide the LLM's behavior. Skills can call MCP tools, read files, run commands, or orchestrate complex multi-step workflows.

### Skill File Format

```markdown
---
name: skill-name
description: "One-line description shown in help."
user_invocable: true
---

# /skill-name -- Title

Instructions for the LLM when this skill is invoked.
Can include tool call patterns, decision logic, output format, etc.
```

---

## Governance

### /friday unlock

**Trigger:** `/friday unlock` or `/friday unlock status`
**Purpose:** Initialize or unlock the encrypted Sovereign Vault.
**MCP Tools Called:** `vault_status`, `vault_initialize`, `vault_unlock`

**What it does:**
1. Checks vault status via `vault_status`
2. If uninitialized: guides user through passphrase creation, calls `vault_initialize`
3. If locked: prompts for passphrase, calls `vault_unlock`
4. Shows the dashboard URL (`http://localhost:{port}/`)
5. Recommends the browser-based unlock form to keep the passphrase out of the API transcript

---

### /govern

**Trigger:** `/govern`, `/govern laws`, `/govern zones`, `/govern floors`, `/govern verify`, `/govern add-zone <pattern>`
**Purpose:** View, verify, and manage the cLaw governance framework.
**MCP Tools Called:** None directly (reads governance JSON files)

**What it does:**
- `/govern` -- Full governance dashboard: laws, zones, floors, compliance
- `/govern laws` -- Display the Three Laws + Meta-Law
- `/govern zones` -- Show protected zone patterns
- `/govern floors` -- Show safety floor thresholds
- `/govern verify` -- Run compliance audit (check hooks, files, safety floors)
- `/govern add-zone` -- Add a project-specific protected zone to `.asimovs-mind/protected-zones.json`

---

### /federate

**Trigger:** `/federate init|status|verify|agents|sync`
**Purpose:** Initialize and manage federation node identity and governance.
**MCP Tools Called:** `identity_generate`, `attestation_generate`, `vault_write`, `vault_read`

**What it does:**
- `init` -- Creates `.asimovs-mind/` directory, generates Ed25519 identity, produces cLaw attestation, signs governance files with HMAC, initializes knowledge store, discovers agents
- `status` -- Shows node identity, attestation age, governance integrity, agent count
- `verify` -- Re-runs governance HMAC verification
- `agents` -- Lists all discovered agents (plugin + project-local)
- `sync` -- Explains how federation state propagates through git

---

## Agent Friday

### /friday

**Trigger:** `/friday`, `/friday mode <mode>`, `/friday status`
**Purpose:** Mode switching and status for Agent Friday.
**MCP Tools Called:** `personality_profile`, `vault_status`

**Modes:**
| Mode | Behavior |
|------|----------|
| `focus` | Minimal output, pure execution |
| `partner` | Collaborative, thinks aloud (default) |
| `teacher` | Explains decisions, educational |
| `creative` | Expressive, makes media, takes risks |
| `sentinel` | Paranoid security, extra verification |

---

### /onboard

**Trigger:** `/onboard`
**Purpose:** First-time onboarding interview (8 questions). Creates the user profile.
**MCP Tools Called:** `vault_status`, `vault_write` (to save profile)

**What it does:**
1. Checks vault status (requires unlocked vault)
2. Runs a conversational 8-question interview about working style, preferences, and values
3. Question 8 is the "mother question" that calibrates anti-sycophancy challenge level
4. Saves the user profile to the vault as `user-profile`

---

### /help

**Trigger:** `/help`, `/help <category>`
**Purpose:** Categorized command reference for all skills.
**MCP Tools Called:** None

**Categories:** Governance, Agent Friday, Intelligence, Swarm, Discovery, Communication, Memory, Daily Operations

---

### /status

**Trigger:** `/status`
**Purpose:** Comprehensive system health dashboard.
**MCP Tools Called:** `vault_status`, `session_status`, `memory_status`, `trust_graph_status`, `personality_profile`, `ollama_status`, `connector_status`, `privacy_stats`, `enterprise_commitment_track` (status action)

Synthesizes results from 9+ MCP tools into a compact status block.

---

## Intelligence

### /route

**Trigger:** `/route status`, `/route policy <policy>`, `/route recommend <task>`
**Purpose:** Intelligence router management for local/cloud model selection.
**MCP Tools Called:** `ollama_status`, `llm_status`, `llm_model_list`, `llm_route`, `llm_set_provider`

**Routing policies:** `auto`, `local_preferred`, `local_only`, `cloud_preferred`

---

### /remember

**Trigger:** `/remember <knowledge>`
**Purpose:** Store tribal knowledge that persists across sessions and propagates through federation.
**MCP Tools Called:** `memory_store` (medium-tier, fact category, high confidence)

**Example:** `/remember the auth system uses JWT in httpOnly cookies, not localStorage`

---

## Swarm

### /unleash

**Trigger:** `/unleash`
**Purpose:** Deploy the full agent swarm on the current codebase.
**MCP Tools Called:** `agent_spawn`, `agent_list_capabilities`, `connector_detect`

**Deployment waves:**
1. Independent agents (diagnosis, scanning, fixing)
2. Dependent agents (improvement, evolution)
3. Meta-agents (self-improvement, memory, documentation)
4. Discovery (GitScout + GitLoader if needed)
5. Synthesis report

---

### /iterate

**Trigger:** `/iterate <directive-name>` or `/iterate <path-to-md>`
**Purpose:** Run a single autoresearch-style iteration loop from a directive file.
**MCP Tools Called:** Various, depending on the directive (Bash for measurement, Write/Edit for modifications)

**Built-in directives:** `fix-tests`, `fix-types`, `optimize-startup`, `security-hardening`, `discover`, `full-sweep`

**Loop pattern:** Measure baseline -> Plan modification -> Modify -> Measure -> Improved? Commit. Regressed? Revert. Budget exhausted? Halt.

---

### /create-agent

**Trigger:** `/create-agent <description>`
**Purpose:** Create a new specialist agent for the swarm.
**MCP Tools Called:** None (writes an `.md` file to `.asimovs-mind/agents/`)

**Example:** `/create-agent CSS layout specialist that fixes responsive design issues`

The agent is automatically discovered by the Swarm Coordinator on the next cycle.

---

### /breed

**Trigger:** `/breed "<specialization>" [base-model] [--generations N]`
**Purpose:** Breed a specialized Ollama model through iterative prompt evolution and benchmarking.
**MCP Tools Called:** `ollama_status`, `llm_complete` (for evolution and judging)

---

### /evolve

**Trigger:** `/evolve "<prompt>"` or `/evolve --file <path>`
**Purpose:** Evolve a system prompt through iterative judge-scored evaluation.
**MCP Tools Called:** `llm_complete` (for mutation, testing, and scoring)

---

## Discovery

### /discover

**Trigger:** `/discover <what you need>`
**Purpose:** Search GitHub for code solutions, safety-scan them, and integrate.
**MCP Tools Called:** `memory_recall` (check existing knowledge), `connector_execute` (git operations)

**Pipeline:** Scout (search GitHub) -> Scan (AST safety analysis) -> Adapt (modify for project) -> Test (verify) -> Keep/Discard (commit or revert)

---

### /diagnose

**Trigger:** `/diagnose`
**Purpose:** Comprehensive codebase health check.
**MCP Tools Called:** None directly (runs Bash commands for tests, types, lint, deps, build, git)

**Checks:** Tests, TypeScript types, lint, dependency audit, build status, git status.

---

## Communication

### /peer

**Trigger:** `/peer`, `/peer listen`, `/peer connect <address>`, `/peer send <id> <msg>`, etc.
**Purpose:** Encrypted P2P communication with other Asimov Agents.
**MCP Tools Called:** `peer_listen`, `peer_connect`, `peer_list`, `peer_send`, `peer_send_file`, `peer_disconnect`, `peer_pairing_code`

---

## Daily Operations

### /briefing (via LLM instruction)

**Trigger:** User asks for a briefing or the session conductor detects a stale briefing.
**Purpose:** Generate a daily briefing from commitments, activity, and calendar data.
**MCP Tools Called:** `briefing_daily`, `enterprise_commitment_track`, `memory_recall`

---

## How to Add a New Skill

1. **Create the directory:** `skills/my-skill/`
2. **Create SKILL.md** with YAML frontmatter:
   ```yaml
   ---
   name: my-skill
   description: "One-line description."
   user_invocable: true
   ---
   ```
3. **Write the instructions** in the markdown body. Be specific about:
   - Which MCP tools to call and in what order
   - Expected input format (what the user types after the slash command)
   - Output format (what the user should see)
   - Error handling (what to do if tools fail)
4. **Test** by running `/<your-skill>` in Claude Code with the plugin loaded.

No registration step is needed. Claude Code discovers all `skills/*/SKILL.md` files automatically.
