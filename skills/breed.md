---
name: breed
description: "Breed a specialized Ollama model for a specific task. Creates, benchmarks, and iteratively improves a local model."
user_invocable: true
---

# /breed — Breed a Specialized Model

Create and evolve a task-specific Ollama model.

## Usage

```
/breed "code review specialist"          # Breed from default base (llama3.2)
/breed "research synthesizer" mistral    # Breed from specific base model
/breed "data extractor" --generations 15 # Custom generation count
```

## Instructions

1. Parse the task description and optional base model from arguments
2. Verify Ollama is running: `curl -s http://localhost:11434/api/tags`
3. Spawn the `breeder` agent with the task description
4. The breeder will handle: initial design → create → benchmark → mutate → iterate
5. Report the final model name and how to use it

The bred model will be named `asimov-bred-<task>-final` and available via `ollama run <name>`.
