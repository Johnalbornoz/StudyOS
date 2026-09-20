# F14 — Date/Clock Stabilization (Workstream G)

## Independent re-investigation (not trusted from F13's own diagnosis without verification)

F13 hypothesized: hard-coded `NOW = new Date('2026-09-10T00:00:00.000Z')` fixtures had drifted relative to the real clock as time passed a hard-coded `2026-09-20` deadline. Re-investigated from scratch this phase:

```
$ date -u
Sun Sep 20 00:35:17 UTC 2026
$ node -e "console.log(new Date().toISOString())"
2026-09-20T00:35:17.578Z
```

The real system clock is `2026-09-20T00:35 UTC` — one line further than F13's own diagnosis went, but it confirms the mechanism precisely: real time has now passed the fixture's `validation_deadline: '2026-09-20T00:00:00.000Z'`.

## Root cause, confirmed by reading the actual source (not assumed)

`src/services/validation-cycle.service.ts`:
- `isValidationCycleOverdue(cycle, now: Date = new Date())` and `daysToValidationDeadline(deadline, now: Date = new Date())` (lines 164/174) both already accept an explicit `now` parameter — a deliberate, existing design for testability.
- `getConceptValidationState` (line 505) calls `isValidationCycleOverdue(cycle)` **without** passing `now` — so it defaults to the real system clock in both production and test.
- The failing test's fixture (`tests/unit/validation-cycle.test.ts`, "'OPEN' (not yet overdue)...") set `validation_deadline: '2026-09-20T00:00:00.000Z'`, correct at the time it was written, now in the past.
- The second file, `tests/unit/decision-context-query-cost.test.ts`, exercises the identical code path indirectly through `getDecisionContext`'s own `validationState` reader, with the same hard-coded `'2026-09-20'` fixture.

Confirmed by running each failing test individually and reading the actual assertion diff (`expected 'OPEN' to be 'OVERDUE'`/`status: 'OVERDUE'` vs. expected `'OPEN'`) — not inferred from the test names alone.

## Fix (smallest, architecture-consistent — no production code changed)

Both `isValidationCycleOverdue`/`daysToValidationDeadline` already support dependency injection of `now`; the actual bug is that the two *tests* rely on the real clock staying behind a fixed fixture date instead of pinning it. Fixed by adding `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'))` (a date safely before both fixtures' `'2026-09-20'` deadline) at the start of the one affected test in each file, with the pre-existing (or newly added) `afterEach(() => vi.useRealTimers())` restoring real time afterward.

No domain behavior was changed. No assertion was weakened — both tests still assert the exact same expected values they always did; only the previously-implicit, silently-relied-upon "real clock happens to be behind the fixture" assumption was made explicit and deterministic.

## Verification

Both tests, and the full suite, pass deterministically regardless of the real wall-clock date going forward: `npx vitest run` → 350 files / 5614 tests, 5614 passing, zero failures (up from F13's own reported 5602/5604 with 2 known-unrelated failures).
