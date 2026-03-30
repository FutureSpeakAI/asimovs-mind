---
name: discover
description: "Search GitHub for code that solves a problem, scan it for safety, and integrate it into the current project — all governed by Asimov's cLaws."
user_invocable: true
---

# /discover — Capability Discovery

Search GitHub for existing solutions, safety-scan them, adapt them to your project, and integrate them. Every step is governed by Asimov's cLaws.

## Usage

```
/discover <what you need>
```

Examples:
- `/discover a retry mechanism with exponential backoff`
- `/discover SOAP optimizer for PyTorch`
- `/discover rate limiting middleware for Express`
- `/discover a Redis-based caching layer`

## What Happens

1. **GitScout** searches GitHub for repos matching your need
2. You review the top candidates and pick one (or let the agent choose)
3. **GitLoader** fetches the code, safety-scans it, adapts it, and integrates it
4. Tests are run automatically — if they fail, the code is reverted
5. Full provenance is recorded (source, license, trust scores, outcome)

## Implementation

When the user invokes `/discover`:

1. Parse the user's description of what they need
2. Determine the project's language and conventions by reading the codebase
3. Spawn the **git-scout** agent with the search query
4. Present the GitScout report to the user
5. Ask which candidate to proceed with (or auto-select the top recommendation if trust tier 1)
6. Spawn the **git-loader** agent with the selected candidate
7. Report the outcome (integrated, reverted, or blocked)

## Governance

All Three Laws apply:
- **First Law:** Safety scanner must PASS before any code touches the project
- **Second Law:** Pipeline order is mandatory, no steps skipped
- **Third Law:** Full attribution and provenance tracking

If discovery is being run as part of an autonomous loop (via `/iterate discover`), the circuit breaker fires after 2 consecutive failed integrations.

## Options

- `/discover <query>` — full pipeline (scout → load → test)
- `/discover scout <query>` — search only, don't integrate
- `/discover scan <file>` — run safety scanner on a local file
- `/discover history` — show provenance log of past discoveries
