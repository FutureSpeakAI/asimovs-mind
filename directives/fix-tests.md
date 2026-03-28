# Fix Tests — Autonomous Test Repair

## Objective
Achieve 100% test pass rate by systematically fixing failing tests.

## Editable Surface
- src/**/*.ts
- src/**/*.tsx
- tests/**/*.test.ts

## Metric
Number of failing tests — lower is better.
`npm test 2>&1 | grep -oP '\d+ failed' | grep -oP '\d+' || echo 0`

## Loop
1. Run full test suite and capture output
2. Parse for failing test names and error messages
3. Read the first failing test file and its source
4. Diagnose: source bug or stale test?
5. Apply minimal fix (prefer source fix)
6. Verify with specific test file
7. Run full suite to check regressions
8. If improved: commit. If not: revert.

## Constraints
- Never delete or skip tests
- Never use `any` type or @ts-ignore
- Never modify protected zone files
- One fix per cycle

## Budget
3 minutes per cycle, 30 cycles

## Circuit Breaker
- TypeScript compilation fails
- Test count drops (tests deleted)
- 5 consecutive failures with no improvement
