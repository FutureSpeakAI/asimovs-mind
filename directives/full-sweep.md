# Full Sweep — The Overnight Run

## Objective
Comprehensive codebase improvement. Run ALL improvement loops in sequence:
tests, types, performance, security, prompts, documentation. This is the
"leave it running overnight" directive — like autoresearch on a GPU.

NEVER STOP. Do NOT pause to ask the human. The loop runs until the human
interrupts you, period.

## Editable Surface
- src/**/*.ts
- src/**/*.tsx
- tests/**/*.test.ts
- docs/**/*.md

## Metric
Combined health score: (failing tests * 10) + (type errors * 5) + (lint warnings). Lower is better.

## Loop
1. PHASE 1 — FIX: Run fix-tests loop until 0 failures or budget exhausted
2. PHASE 2 — TYPE: Run fix-types loop until 0 errors or budget exhausted
3. PHASE 3 — PERF: Run optimize-startup loop
4. PHASE 4 — SECURE: Run security-hardening loop
5. PHASE 5 — QUALITY: Run prompt evolution on any agent prompts found
6. PHASE 6 — DOCS: Update documentation to reflect all changes
7. GOTO PHASE 1 (improvements in later phases may enable new fixes)

## Constraints
- All constraints from individual directives apply
- Never modify governance files
- Commit after each successful improvement
- Log everything to the results ledger

## Budget
5 minutes per cycle, unlimited cycles

## Circuit Breaker
- 10 consecutive cycles across all phases with zero improvement
- Any governance violation detected by Sentinel
- Build breaks and cannot be repaired in 3 attempts
