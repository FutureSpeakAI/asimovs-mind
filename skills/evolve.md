---
name: evolve
description: "Evolve a system prompt through iterative judge-scored evaluation. Mutates, tests, scores, and keeps only improvements."
user_invocable: true
---

# /evolve — Evolve a Prompt

Iteratively improve a system prompt using autonomous evolution.

## Usage

```
/evolve "You are a helpful assistant..."    # Evolve an inline prompt
/evolve --file src/prompts/system.txt       # Evolve a prompt from file
/evolve --persona "code reviewer"           # Evolve with persona context
```

## Instructions

1. Parse the prompt from arguments (inline text or file path)
2. Spawn the `evolver` agent with the prompt and any persona context
3. The evolver will: baseline → mutate → test → judge → keep/discard → repeat
4. Report the evolved prompt with before/after scores
