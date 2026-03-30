---
name: remember
description: "Teach Agent Friday something. Store tribal knowledge that persists across sessions and propagates through the federation."
user_invocable: true
---

# /remember -- Teach Friday

Store a piece of knowledge that Friday will remember across sessions. This is how tribal knowledge enters the system — decisions, conventions, gotchas, context that lives in your head but should live in the hivemind.

## Usage

```
/remember the auth system uses JWT in httpOnly cookies, not localStorage
/remember deploy to staging before prod, always. We broke prod in January.
/remember the payments API rate limits at 100 req/min per merchant
/remember Alice owns the search infrastructure. Talk to her before changing indexing.
/remember we chose Postgres over Mongo because of transaction requirements
```

## What Happens

1. Parse the memory from the user's message
2. Record it in the unified memory system as an "interaction" evidence with outcome "positive"
3. Also write it to `.asimovs-mind/knowledge/memories.json` (human-readable, version-controlled)
4. Confirm what was stored

## Implementation

When the user invokes `/remember <text>`:

1. Extract the memory text (everything after `/remember`)

2. Run:
```bash
python "${CLAUDE_PLUGIN_ROOT}/discovery/memory.py" record \
  --type interaction \
  --entity "tribal-knowledge" \
  --outcome positive \
  --detail "<the memory text>"
```

3. Read `.asimovs-mind/knowledge/memories.json` (create if missing). It's a JSON array:
```json
[
  {
    "memory": "the auth system uses JWT in httpOnly cookies",
    "recorded": "2026-03-30T10:15:00",
    "recorded_by": "user",
    "tags": ["auth", "security"]
  }
]
```

4. Append the new memory. Auto-generate 1-3 tags from the content (short keywords that the recall system can match on).

5. Write the file back.

6. Confirm:
```
Remembered: "the auth system uses JWT in httpOnly cookies"
Tags: auth, security
This will be available in all future sessions and propagates through git.
```

## How Memories Surface

The personality loader reads `memories.json` at session start. The recall system (`memory.py recall`) searches memories by keyword matching. When the user or an agent works on something related, Friday surfaces the relevant memory:

```
User: "I need to add session persistence"
Friday: "Noted — you told me the auth system uses JWT in httpOnly
         cookies (recorded March 30). I'll make sure the session
         persistence is compatible with that approach."
```

## Federation

Memories live in `.asimovs-mind/knowledge/memories.json`, which is version-controlled. When the team commits and pushes, every node gets the memories. One engineer teaches Friday a convention, the whole team benefits.

## Options

```
/remember <text>          # store a memory
/remember list            # show all stored memories
/remember search <query>  # search memories by keyword
/remember forget <index>  # remove a memory by its index
```
