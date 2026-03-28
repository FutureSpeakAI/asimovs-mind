# Optimize Startup — Parallelize Initialization

## Objective
Minimize application startup time by parallelizing independent initializations.

## Editable Surface
- src/**/index.ts
- src/**/main.ts
- src/**/app.ts

## Metric
Startup time in milliseconds — lower is better.

## Loop
1. Identify sequential initialization chains (`await X(); await Y();`)
2. Determine if X and Y are independent (no shared state)
3. If independent: convert to `await Promise.all([X(), Y()])`
4. Measure startup time before and after
5. If faster: commit. If slower or broken: revert.

## Constraints
- Never change initialization order where dependencies exist
- All initializations must still complete before the app is ready
- Error handling must be preserved (use safe wrappers)
- Never modify the entry point's exports

## Budget
3 minutes per cycle, 10 cycles

## Circuit Breaker
- App fails to start
- Tests fail after change
- Startup time increases
