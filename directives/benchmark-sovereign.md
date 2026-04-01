---
name: benchmark-sovereign
description: Autoresearch benchmark for the Sovereign Forge. Runs all test suites, records WORKING/NON-WORKING results, fixes failures in a Ralph loop. Target: 0 failures.
---

# Directive: Benchmark Sovereign Forge

## Objective

Run the complete test suite for Asimov's Mind v1.0.0 and fix all failures. This is the autoresearch loop that validates every feature before GitHub release.

## Metric

Number of failing tests across all three suites. Lower is better. Target: **0**.

## Measurement

```bash
cd mcp/vault-server

# Suite 1: Unit tests (crypto, vault, identity, attestation, P2P, privacy shield)
node --test test.js 2>&1 | tail -8

# Suite 2: Integration tests (full lifecycle, HTTP bridge, two-vault P2P)
node --test test-integration.js 2>&1 | tail -8

# Suite 3: Plugin validation (file refs, hooks, governance, skills, agents, docs)
node --test test-plugin-validation.js 2>&1 | tail -8
```

Total test count: **150** (51 unit + 20 integration + 79 validation)

## Editable Surface

- `mcp/vault-server/*.js` — Vault server source
- `hooks/*.py` — Hook scripts
- `governance/*.json` — Governance files
- `skills/*/SKILL.md` — Skill definitions
- `agents/*.md` — Agent definitions
- `personality/friday.md` — Personality
- `plugin.json` — Plugin manifest

## Constraints

- Never weaken a test to make it pass. Fix the code, not the test.
- Never remove a test. If a test is wrong, fix the assertion, don't delete it.
- Never introduce `any` types, `// @ts-ignore`, or `eslint-disable` to bypass issues.
- Never modify governance files in a way that weakens safety floors.
- All three suites must reach 0 failures before the loop exits.

## Loop

```
1. READ    → Run all three test suites. Record total failures.
2. ANALYZE → For each failure: identify root cause (missing file, bad import, wrong logic).
3. FIX     → Apply minimal fix. One fix per failure.
4. VERIFY  → Re-run the failing suite. Confirm fix. Confirm no regressions.
5. COUNT   → Re-run all three suites. Record new total.
6. DECIDE  → If total = 0: EXIT. If total > 0: GOTO 1.
```

## Circuit Breaker

- 20 consecutive iterations with no reduction in failure count → STOP
- Any test suite goes from 0 failures to >0 failures (regression) → STOP and investigate
- Total failures increases by more than 5 in a single iteration → STOP

## Budget

- Max iterations: 30
- Time per iteration: 2 minutes max
- Expected: 0-3 iterations (tests are already green)

## Success Criteria

```
Suite 1 (Unit):        51/51  ✔
Suite 2 (Integration): 20/20  ✔
Suite 3 (Validation):  79/79  ✔
Total:                150/150 ✔
```
