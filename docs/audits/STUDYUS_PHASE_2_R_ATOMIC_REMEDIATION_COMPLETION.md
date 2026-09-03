# StudyUs Phase 2-R — Atomic Remediation Step Completion

## 1. Executive Summary

External review correctly found that `completeRemediationStep`'s exactly-once protection (added in Phase 2D) was a read-time guard — `SELECT status` then, separately, `UPDATE` — which protects sequential replay but does not prove correctness when two requests concurrently observe `status = 'active'` before either commits. This phase replaces it with a single atomic `UPDATE ... WHERE status = 'active' RETURNING ...` claim, with every downstream side effect (next-step activation, path-state transition, `resolved_at`, `INTERVENTION_COMPLETED`) running inside the SAME transaction as that claim — using the existing `DbExecutor`/`db.connect()` pattern already established by `mastery.service.ts::updateMastery`, not a new framework. The fix was validated against real PostgreSQL 18.6 with genuinely concurrent invocations, run across two full independent passes (Scenarios A and B each repeated 3× per pass, 6× total): **48 assertions per pass, 96 total, all passing**, including a real, Postgres-raised mid-transaction failure and rollback (Scenario D). 2 new regression tests were added (982 total, up from the 980 baseline), `tsc` is clean, `next build` succeeds. `NEW_MIGRATIONS_PHASE_2_R = 0` — the fix needed no schema change; `remediation_steps.status` was already the step's own stable identity. Production remains untouched at commit `842c0e9`, DB at `4 applied, 2 pending, 0 drifted`.

## 2. The Finding, Precisely

The pre-existing guard:
```ts
if (step.status === 'completed') { return (await loadPath(step.remediation_path_id))!; }
await db.query(`UPDATE remediation_steps SET status = 'completed', ... WHERE id = $1`, [stepId]);
```
Two concurrent callers can both execute the `SELECT`, both observe `status = 'active'`, and both proceed to the `UPDATE` — the `UPDATE` itself carried no `WHERE status = 'active'` predicate, so both would succeed, and every downstream side effect (next-step activation, `resolved_at`, `INTERVENTION_COMPLETED`) would run twice. This is a real, release-blocking gap under Phase 2B's own exactly-once principle, distinct from (and not caught by) the sequential-replay test Phase 2D shipped.

## 3. Design

**Atomic claim.** The single, real fix:
```sql
UPDATE remediation_steps
SET status = 'completed', result = $2, completed_at = NOW()
WHERE id = $1 AND status = 'active'
RETURNING remediation_path_id, step_type, sequence
```
Two genuinely concurrent callers can both reach this statement, but Postgres's own row-level MVCC locking — not application code — decides which one's `WHERE` clause still matches once the other's transaction commits: the winner's claim returns exactly one row; the loser's, re-evaluated against the now-committed (no-longer-`'active'`) row, returns zero. A zero-row claim is `ALREADY_APPLIED` — the caller performs **no** downstream mutation and returns the current (winner's, or its own prior) state.

**Single transaction.** `completeRemediationStep` now checks out one connection (`db.connect()`) and wraps the claim plus every downstream effect — next-step activation, path-state transition, `resolved_at`, and (via `loadPath`'s new optional `client` parameter, threaded through) the `INTERVENTION_COMPLETED` `recordDecisionEvent` call — inside one `BEGIN`/`COMMIT`, with `ROLLBACK` on any failure. This is the exact `DbExecutor`-threading pattern already established by `mastery.service.ts::updateMastery` and reused, not reinvented, per the task's own instruction.

**No new identity, no new migration.** The claim key is `remediation_steps.status` itself — already the step's own stable identity since Phase 2D's original design. No column, index, or table was added.

**SOLO_VERIFY retry preserved by construction.** A failed final verification's existing behavior (reopen the step to `'active'` within the same winning transaction) is unchanged, and now happens under the SAME row lock the winning claim already holds — no re-fetch race is possible. Because the only identity this flow has across a failed-then-retried attempt is this same `stepId` cycling `active↔completed` (audited explicitly — no per-attempt identity exists anywhere in this flow to bind to instead), a genuinely new subsequent attempt claims the row again exactly as any other completion does, once the failing transaction commits its reopen.

**Analytics stays outside the atomic boundary** (unchanged Phase 2B/2C/2D convention) but is now only ever reached by the genuine winner, after a successful `COMMIT` — never by a loser or a rolled-back attempt.

## 4. Implementation

Two files touched, nothing else:
- `src/services/remediation.service.ts`: `loadPath` gained an optional `client: DbExecutor = db` parameter (additive — every other existing caller is unaffected, since it defaults to the pool exactly as before); `completeRemediationStep` was rewritten around the atomic claim + single transaction described above.
- `tests/unit/remediation.test.ts`: the `@/lib/db` mock gained a `connect()` method (routing through the same `queryMock`, so every pre-existing assertion in the file continues to work unchanged); the `completeRemediationStep` test block was rewritten and extended.

One real bug was found and fixed during this phase's own test-writing: the initial implementation checked `claim.rowCount === 0`, but a `RETURNING` clause's row *count* is not guaranteed to be populated identically across every driver/mock shape — the correct, harness-independent check is `claim.rows.length === 0`, which is what actually reflects "did this UPDATE's `RETURNING` produce a row." Fixed before any test was considered passing; real production `pg` behavior is unaffected either way (`rowCount` and `rows.length` agree for a real `RETURNING` result), but the fix is strictly more robust.

## 5. Real PostgreSQL 18.6 Concurrency Validation

Disposable PostgreSQL 18.6 (exact production version match), built via the governed migration runner on top of the certified baseline + the 3 already-applied migrations (mirroring production's real current `4 applied, 2 pending` state exactly — the two migrations from the prior Phase 2 Master Completion phase were deliberately left un-applied, since this fix needs neither). A legitimate diagnosis→remediation-path→steps fixture was created per scenario via the real `startRemediation`; every scenario below calls the real, unmodified `completeRemediationStep` — never mocked.

**Scenario A — concurrent terminal completion** (3× per pass, 2 full passes = 6 runs, 36 assertions): two genuinely concurrent `completeRemediationStep` calls (`Promise.allSettled`) against the SAME active terminal step. Every run: both calls returned successfully; the path resolved to `RESOLVED` exactly once (verified against the real database row, not just the return value); `resolved_at` was set; the terminal step itself shows `completed` exactly once; exactly one `INTERVENTION_COMPLETED` row exists in `decision_events`.

**Scenario B — concurrent non-terminal completion** (3× per pass, 6 runs, 36 assertions): two genuinely concurrent calls against the same active non-terminal (first) step. Every run: the step completed exactly once; the next step activated exactly once, ending `active` (never duplicated, never left `pending`); the path's final state was a valid non-terminal state (`REPAIRING`/`VERIFYING`); zero `INTERVENTION_COMPLETED` events.

**Scenario C — sequential replay**: a genuine completion followed by a real replay of the identical request. `resolved_at` was byte-identical (same `Date` value) before and after the replay; `decision_events` count stayed at exactly 1.

**Scenario D — failure rollback**: a precisely-scoped, temporary Postgres trigger (matched only on `decision_type = 'INTERVENTION_COMPLETED' AND source_event_id = '<this path's id>'`, so it could never fire for any other row) made the real `decision_events` INSERT genuinely fail — a real Postgres exception, not a fabricated in-code fault, raised strictly *after* the atomic claim had already committed its portion of the in-progress transaction. `completeRemediationStep` genuinely threw; the real database was then confirmed, by direct read, to show the step back at `status = 'active'`/`completed_at = NULL` and the path still not `RESOLVED`/`resolved_at` still `NULL` — the whole transaction, including the already-succeeded claim, was rolled back. The fault-injecting trigger was then dropped and the SAME `completeRemediationStep` call retried: it applied successfully, exactly once (`decision_events` count went from 0 to 1, not 2).

(An earlier attempt at Scenario D deleted the fixture's `concepts` row to try to force an FK failure — this incidentally surfaced a genuine, previously-undocumented fact from the Phase 2 Master Completion audit: `remediation_paths.target_concept_id`/`root_cause_concept_id` and `remediation_steps.concept_id` **do** carry real `ON DELETE CASCADE` foreign keys to `concepts`, contrary to that report's §3.1 table, which described them as "FK-shaped (no formal FK constraint)." This is a correction to a prior report's documentation, not a defect in anything Phase 2-R touched — noted here for the record, not acted on further per this phase's explicit "fix ONLY completeRemediationStep" scope.)

**Total: 48 assertions × 2 independent full passes = 96, all passing.** The ephemeral instance was fully torn down (no process left running, no data retained) before this report was written.

## 6. Tests

2 new regression tests added to `tests/unit/remediation.test.ts` (alongside the 3 pre-existing tests, rewritten for the new atomic-claim query shape):
1. Sequential replay — the atomic claim itself matches zero rows on replay; exactly one UPDATE-shaped statement ever ran (the claim attempt); no downstream mutation; no duplicate `INTERVENTION_COMPLETED`.
2. Genuine first completion (terminal) — atomic claim succeeds, mutates, emits exactly one `INTERVENTION_COMPLETED`, `recordDecisionEvent` called with the transactional client (not the pool default).
3. Failed final `SOLO_VERIFY` reopens the step within the same transaction — the retry path remains open, confirmed by the reopening `UPDATE` appearing before `COMMIT`.
4. **New**: `STEP_NOT_FOUND` — a genuinely nonexistent `stepId` is rejected (and rolled back), never silently treated as an already-applied replay.
5. **New**: a genuine failure after the claim succeeds (a later same-transaction operation) rolls back — the claim itself is reverted; a subsequent retry with the same `stepId` applies exactly once.

Items 1-3, 5-7 from the task's required list are covered by the combination of these mocked unit tests (proving the LOGIC handles each possible outcome deterministically) and the real-Postgres scenarios in §5 (proving genuine concurrent access actually produces "claim succeeds exactly once" as an emergent property of Postgres's own locking — the actual claim that needs empirical, not simulated, proof).

## 7. Full Test Results

```
npx vitest run
 Test Files  86 passed (86)
      Tests  982 passed (982)
```
982 − 980 = 2 new tests, both additive (no existing test was deleted, weakened, or skipped).

## 8. TypeScript / Build

`npx tsc --noEmit` — clean. `npm run build` — succeeds, full route manifest generated.

## 9. Protected Systems

```
git diff --stat 842c0e9 -- src/lib/algorithms/mastery.ts src/services/knowledge-state.service.ts src/lib/verification-triggers.ts
```
Empty — confirmed byte-identical. `MASTERY_FORMULA_CHANGES = 0`, `KNOWLEDGE_STATE_THRESHOLD_CHANGES = 0`, `VERIFICATION_ALGORITHM_CHANGES = 0`. Mastery/Knowledge-State thresholds, the misconception lifecycle, KVR14, the error-taxonomy mapping, and every Twin/`DecisionContext` contract were not touched — confirmed by `git diff --stat` showing exactly the two files named in §4 and nothing else changed by this phase.

## 10. Migration

`NEW_MIGRATIONS_PHASE_2_R = 0`. No schema change was made or needed — `remediation_steps.status` already carried the identity the atomic claim uses.

## 11. Database Status

```
npm run db:status (production, read-only)
Applied (4): ai_execution_and_decision_audit, evidence_idempotency, misconception_lifecycle, STUDYUS_BASELINE_2026_08
Pending (2): 20260904_1000_intervention_lifecycle_concurrency, 20260905_1000_error_taxonomy_reconciliation
SUMMARY: 4 applied, 2 pending, 0 drifted.
```
Unchanged throughout this phase — no migration was applied.

## 12. Production Baseline

```
git rev-parse HEAD         = 842c0e9b25d9188e883fb1573e6c00af59c216f3
git rev-parse origin/main  = 842c0e9b25d9188e883fb1573e6c00af59c216f3
```
Unchanged throughout this phase.

## 13. Git Diff

```
git diff --stat -- src/services/remediation.service.ts tests/unit/remediation.test.ts
 src/services/remediation.service.ts | 265 ++++++++++++++++++++++++++++++------
 tests/unit/remediation.test.ts      | 210 +++++++++++++++++++++++++++-
 2 files changed, 431 insertions(+), 44 deletions(-)
```
Exactly the two files this phase was scoped to touch. All other working-tree changes present (Digital Twin/misconception/validation-cycle/error-taxonomy files, the two pending migrations, the untracked documentation backlog) are carried over unmodified from the prior Phase 2 Master Completion turn — confirmed by this section's own diff scoping, not re-touched here.

## 14. Remaining Risks

1. **A narrow, disclosed (not newly introduced) edge case**: two genuinely concurrent completion requests for the SAME step that BOTH report `success: false` on a terminal `SOLO_VERIFY` could, in principle, both observe a genuine `active→completed` claim in sequence (the first's reopen-to-`'active'` making the row claimable again before the second's blocked UPDATE re-evaluates) — resulting in duplicate benign analytics calls, but never a duplicate `INTERVENTION_COMPLETED` event, never a duplicate `resolved_at`, and never a duplicate real resolution (since `succeeded === false` never resolves the path). This is not one of the task's required scenarios (which specify successful terminal/non-terminal completion), and closing it would require a per-attempt identity this flow does not have and was explicitly instructed not to fabricate (§SOLO_VERIFY: "audit the actual identity available… before changing behavior"). Non-blocking.
2. **Documentation correction surfaced, not acted on** (§5): the Phase 2 Master Completion report's §3.1 table incorrectly stated `remediation_paths`/`remediation_steps` carry no formal FK to `concepts`; they do (`ON DELETE CASCADE`). Left as a disclosed correction per this phase's explicit scope ("do not reopen 2D/2E/2F/2G").

Both **NON-BLOCKING**.

## 15. Final Decision

```
ATOMIC_STEP_COMPLETION = VERIFIED
CONCURRENT_TERMINAL_COMPLETION = VERIFIED
CONCURRENT_NON_TERMINAL_COMPLETION = VERIFIED
DUPLICATE_INTERVENTION_COMPLETION_EVENTS = 0
REPLAY_CHANGES_RESOLVED_AT = NO
TRANSACTION_ROLLBACK = VERIFIED
GENUINE_SOLO_VERIFY_RETRY = PRESERVED
NEW_MIGRATIONS_PHASE_2_R = 0
FULL_TEST_COUNT = 982
PHASE_2_RELEASE_BLOCKER_CLOSED = YES
READY_FOR_PHASE_2_PRODUCTION_RELEASE = YES
```

Per the task's explicit instructions: this phase did not commit, push, deploy, apply production migrations, or start Phase 3.
