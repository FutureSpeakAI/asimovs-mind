# Fix Types — TypeScript Strict Compliance

## Objective
Zero TypeScript compilation errors.

## Editable Surface
- src/**/*.ts
- src/**/*.tsx

## Metric
`npx tsc --noEmit 2>&1 | grep -c 'error TS' || echo 0`

## Loop
1. Run `npx tsc --noEmit`
2. Group errors by file
3. Fix the type error properly (no `any`, no @ts-ignore)
4. Re-run and count remaining errors
5. If count decreased: commit. If not: revert.

## Constraints
- NEVER use `any` or @ts-ignore
- Fix the type, don't suppress the error
- Maintain backward compatibility of exported interfaces

## Budget
2 minutes per cycle, 40 cycles

## Circuit Breaker
- `any` type introduced
- Error count increases by 5+ in one cycle
