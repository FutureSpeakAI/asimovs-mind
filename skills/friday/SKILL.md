---
name: friday
description: "Agent Friday mode switching and status. Control how Friday communicates and behaves."
user_invocable: true
---

# /friday — Agent Friday Control

Manage Agent Friday's communication mode, view status, and configure your profile.

## Usage

```
/friday                     # Show current mode and brief status
/friday mode focus          # Minimal output, pure execution
/friday mode partner        # Collaborative, thinks aloud (default)
/friday mode teacher        # Explains decisions, educational
/friday mode creative       # Expressive, makes media, takes risks
/friday mode sentinel       # Paranoid security, extra verification
/friday status              # Detailed status dashboard
/friday profile             # Show/edit user profile
```

## Instructions

### `/friday` (no arguments)

Read `.asimovs-mind/user-profile.json` and display:

```
Agent Friday | Mode: partner
Session: 12 files modified, 3 commits
Governance: verified
```

If no profile exists, show:

```
Agent Friday | Mode: partner (default)
No user profile configured. Run /friday profile to set up.
```

### `/friday mode <mode>`

Valid modes: `focus`, `partner`, `teacher`, `creative`, `sentinel`.

1. Read `.asimovs-mind/user-profile.json` (create if missing)
2. Update the `mode` field to the requested mode
3. Write the file back
4. Confirm: "Mode switched to **[mode]**."

Mode effects on behavior:
- **focus**: Minimal commentary. Execute tasks with short confirmations. No explanations unless asked. Prefer code over words.
- **partner**: Think aloud. Explain reasoning. Ask clarifying questions. Suggest improvements. This is the default.
- **teacher**: Explain every decision. Link to docs. Show alternatives considered. Teach patterns and anti-patterns.
- **creative**: Take creative risks. Generate media descriptions. Use metaphor. Propose unconventional solutions. Push boundaries.
- **sentinel**: Extra verification on every action. Double-check file paths. Confirm before destructive operations. Report security concerns proactively.

### `/friday status`

Gather and display a detailed status dashboard:

1. Read `.asimovs-mind/user-profile.json` for mode and preferences
2. Read `.asimovs-mind/knowledge/recent-sessions.json` for session history
3. Read `.asimovs-mind/config.json` for federation status
4. Read `.asimovs-mind/governance-manifest.json` for integrity status
5. Count agents in `${CLAUDE_PLUGIN_ROOT}/agents/` and `.asimovs-mind/agents/`

Display:

```
═══ AGENT FRIDAY — STATUS ═══

Mode: partner
User: [name]
Preferences: [summary]

Session History (last 5):
  [timestamp] 12 files, 3 commits — "Auth refactor"
  [timestamp]  4 files, 1 commit  — "Test cleanup"

Federation:
  Agents: N discovered
  Governance: verified | WARNING
  Node: [hostname]

Memory:
  Evidence: N observations
  Trusted entities: N (N high trust, N caution)
  Knowledge graph: N entities, N connections
  Top trusted: entity1 (0.95), entity2 (0.88)

Knowledge Store:
  Sessions recorded: N
  Ledger entries: N (current session)
```

To get the memory data, run:
```bash
python "${CLAUDE_PLUGIN_ROOT}/discovery/memory.py" status
python "${CLAUDE_PLUGIN_ROOT}/discovery/memory.py" trust --all
```

### `/friday profile`

Interactive profile setup/edit. Read `.asimovs-mind/user-profile.json` if it exists, then ask the user:

1. **Name**: What should Friday call you?
2. **Language preference**: Primary programming language/stack
3. **Style**: How do you prefer communication? (concise/detailed/casual/formal)
4. **Verbosity**: How much explanation? (minimal/moderate/thorough)
5. **Focus areas**: What are you usually working on? (comma-separated)

Write the profile to `.asimovs-mind/user-profile.json`:

```json
{
  "name": "...",
  "mode": "partner",
  "preferences": {
    "language": "TypeScript",
    "style": "concise",
    "verbosity": "moderate",
    "focus_areas": ["backend", "testing"]
  },
  "created": "ISO timestamp",
  "updated": "ISO timestamp"
}
```

Ensure `.asimovs-mind/` directory exists before writing. The personality-loader.py hook reads this file at session start to shape Friday's behavior.
