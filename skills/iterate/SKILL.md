---
name: iterate
description: "Run a single autoresearch iteration loop from a directive file. Reads a program.md-style directive, then loops: modify, execute, measure, keep/discard."
user_invocable: true
---

# /iterate — Run an Autoresearch Loop

Execute a single autoresearch-style iteration loop guided by a directive file.

## Usage

```
/iterate fix-tests        # Run the test-fixing directive
/iterate optimize-prompts # Run prompt evolution
/iterate <path-to-md>     # Run any custom directive
```

## Instructions

1. If the argument is a short name (no path separator), look for it in `${CLAUDE_PLUGIN_ROOT}/directives/<name>.md` first, then in the project's `dev/` directory.
2. Load and parse the directive file — extract objective, editable surface, metric, loop steps, constraints, budget, and circuit breakers.
3. Run the iteration loop:
   - Measure baseline metric
   - For each cycle: plan modification → execute → measure → keep if improved, discard if not
   - Respect the budget (time per cycle, max cycles)
   - Halt on circuit breaker conditions
4. Log all results to a structured format
5. Report the final summary: cycles run, improvements kept, baseline vs final metric
