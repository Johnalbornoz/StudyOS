# CANON-R6-PERF-R2R1 — Prepared Activity Stale-Lock Recovery

## 1. STATUS

**CODE PASS.** Surgical repair of CANON-R6-PERF-R2's single declared blocker. No redesign of pre-generation was performed or attempted. `npx tsc --noEmit` clean, full `npx vitest run` green (255 test files / 4637 tests), `npm run build` clean. Not deployed. Migration not applied. Not pushed to `main`.

## 2. BLOCKER

`canonical_prepared_activity` enforces at most one *active* (`PREPARING` or `READY`) row per `(student_id, concept_id, stage, pedagogical_policy_version)` via a partial unique index. However:

- An expired `READY` row (past `expires_at`) remained physically `READY` — still counted as "active" by that index — until something else changed its status.
- A `PREPARING` row whose background invocation died before its own `READY`/`FAILED` transition (serverless instance recycled, uncaught crash before the `try`/`catch` in `prepareCanonicalProveActivity` could run its own failure path) remained `PREPARING` forever.

Either case could permanently occupy the unique-index slot for that canonical identity, silently and indefinitely suppressing all future valid Prove preparation for that student/concept — with no automatic recovery.

## 3. EXPIRED READY

Before the existing `INSERT ... ON CONFLICT DO NOTHING`, `prepareCanonicalProveActivity` now runs:

```sql
UPDATE canonical_prepared_activity
SET status = 'INVALIDATED', failure_reason = 'EXPIRED_TTL'
WHERE student_id = $1 AND concept_id = $2 AND stage = 'PROVE' AND pedagogical_policy_version = $3
  AND status = 'READY' AND expires_at <= NOW()
```

- Scoped to the exact same canonical identity as the INSERT that follows it.
- The row is **never deleted** — it transitions to the existing `INVALIDATED` status, preserved for cost/waste auditing (consistent with how `revalidatePreparedActivity` already invalidates rows at consumption time).
- Rows affected are logged via `prove_pregeneration_expired_invalidated` (id count only).

## 4. STALE PREPARING

A second cleanup UPDATE, run immediately after the first and before the INSERT:

```sql
UPDATE canonical_prepared_activity
SET status = 'FAILED', failure_reason = 'STALE_PREPARATION_LEASE_EXPIRED'
WHERE student_id = $1 AND concept_id = $2 AND stage = 'PROVE' AND pedagogical_policy_version = $3
  AND status = 'PREPARING' AND created_at < NOW() - ($4 || ' milliseconds')::interval
```

- Chosen status: **`FAILED`**, not `INVALIDATED` — per the spec's own explicit preference: the preparation never successfully completed, which is exactly what `FAILED` already means elsewhere in this same function (the `GENERATION_INCOMPLETE` and `UNEXPECTED_ERROR` paths). `INVALIDATED` is reserved for content that *was* successfully produced but is no longer trustworthy (expired, stale novelty, incompatible contract).
- The row is never deleted — preserved for cost/waste auditing.
- This is recovery **only** for abnormal termination. The normal `PREPARING → READY`/`FAILED` transition inside `prepareCanonicalProveActivity`'s own `try`/`catch` is completely unchanged and always wins the race if it completes before the lease expires.
- Rows affected are logged via `prove_pregeneration_stale_preparing_recovered` (id count only).

## 5. LEASE

```ts
export const PREPARATION_LEASE_MS = 5 * 60 * 1000; // 5 minutes
```

**Rationale:** CANON-R6-PERF-R1's own live measurement of the full concurrent-chunked-generation-plus-aggregate-recovery pipeline (the same pipeline `generateCanonicalProveQuestions` runs for pre-generation) was `generationConcurrentMs=14.887s + aggregateRecoveryMs=11.809s = 27.111s` total. 5 minutes is a **>10x margin** over that observed envelope — comfortably longer than any legitimate run, including provider-latency variance or a slower aggregate-recovery round, while remaining bounded so an abandoned invocation cannot block the unique-index slot indefinitely. This satisfies the spec's own "do not make it so short that a legitimate 20-30 second background generation can be invalidated while still running."

`PREPARATION_LEASE_MS` is a **new, separate** constant from `PREPARED_ACTIVITY_TTL_MS` (unchanged at 2 hours) — one governs how long a `PREPARING` row may run before being presumed dead, the other governs how long a `READY` row remains usable. They are never conflated.

## 6. RACE SAFETY

No explicit SQL transaction (`BEGIN`/`COMMIT`) wraps the two cleanup UPDATEs and the subsequent INSERT. This is safe because:

1. Each cleanup UPDATE's own `WHERE` clause only matches a row still in the exact stale state it targets (`status = 'READY' AND expires_at <= NOW()`, or `status = 'PREPARING' AND created_at < NOW() - lease`). If a concurrent racer already transitioned that row (e.g. another request's cleanup UPDATE won first, or the row's own background generation just completed), the clause simply fails to match on this caller's attempt — each UPDATE is independently atomic and idempotent at the single-row level via Postgres's own row-level locking.
2. The pre-existing partial unique index plus `INSERT ... ON CONFLICT DO NOTHING` remains the **sole and final** dedup authority, exactly as before this phase. Regardless of how two concurrent callers' cleanup UPDATEs interleave, at most one of their subsequent INSERTs can ever return a row — the other necessarily observes either the still-active original row or the just-inserted winner's row, and loses via `ON CONFLICT DO NOTHING`.
3. The unique index's definition is **unchanged** by this phase — no weakening.

Two racing Practice submissions for the same canonical identity therefore still produce at most one active preparation, with or without either racer's cleanup UPDATEs finding stale rows to retire.

## 7. TTL SEMANTICS

Both required properties now hold for an expired `READY` row:

- **Not consumable:** `revalidatePreparedActivity` already rejects `expiresAt < Date.now()` with reason `EXPIRED` — unchanged by this phase.
- **Not blocking:** the new expired-READY cleanup UPDATE retires the row to `INVALIDATED` before any new INSERT is attempted, so it no longer occupies the unique index — the gap this phase closes.

## 8. OBSERVABILITY

Two new events, both logged via the existing `safeLog` helper (never breaks the caller on a logging failure), both carrying only `studentId`, `conceptId`, and an affected-row `count` — never question content:

- `prove_pregeneration_expired_invalidated`
- `prove_pregeneration_stale_preparing_recovered`

These are distinct from the existing `prove_pregeneration_started`/`_ready`/`_failed`/`_consumed`/`_invalidated`/`_skipped_duplicate` events (all unchanged), letting cost/waste analysis distinguish normal TTL expiry and normal in-request failure from crashed/abandoned background preparation.

## 9. TESTS

New file `tests/unit/canon-r6-perf-r2r1-stale-preparation-recovery.test.ts` (21 tests), covering the required 10-item matrix:

1. Non-expired READY still blocks a new preparation.
2. Expired READY is retired to `INVALIDATED` before the new INSERT, correctly scoped, never deletes, logs the new event.
3. A fresh preparation is created once the expired row is retired.
4. A PREPARING row still inside its lease still blocks a new preparation.
5. A stale PREPARING row is retired to `FAILED` (never `INVALIDATED`), correctly scoped, uses `PREPARATION_LEASE_MS`, logs the new event; plus a lease-value/margin assertion.
6. A fresh preparation is created once a stale PREPARING row is recovered.
7. Concurrent preparation attempts for the same identity still yield at most one active row (consequence-level + unique-index-unchanged + no-explicit-transaction source-audit assertions).
8. TTL semantics: expired row is both non-blocking (cross-referencing tests 2/3) and non-consumable (unchanged `revalidatePreparedActivity` EXPIRED path).
9. No DB migration schema change required (status CHECK already includes INVALIDATED/FAILED; `expires_at`/`created_at`/`failure_reason` already exist; only the same unapplied migration file gained a clarifying comment, no second migration, no `ALTER TABLE`).
10. Firewall: `PREPARED_ACTIVITY_TTL_MS` unchanged at 2 hours, `PREPARATION_LEASE_MS` is a distinct new constant, consumption/compatibility/lookup functions untouched, the certified generation pipeline and focus-loading UX component untouched, and the two new log calls never include question content.

The pre-existing `tests/unit/canon-r6-perf-r2-prove-pregeneration.test.ts` was updated (not weakened) to account for the two new leading cleanup UPDATE calls now issued by every `prepareCanonicalProveActivity` invocation — call-count and call-index assertions shifted from `[1]`/count `1` to `[3]`/count `3` accordingly; all prior assertions on the actual insert/READY/FAILED behavior are preserved unchanged.

## 10. FULL REGRESSION

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **255 test files, 4637 tests, all passing.**
- `npm run build`: clean.

## 11. DB IMPACT

**No schema change required.** The existing (still unapplied) migration `database/migrations/20260916_1000_canon_r6_perf_r2_canonical_prepared_activity.sql` already:

- CHECK-constrains `status` to include `'INVALIDATED'` and `'FAILED'`.
- Has `expires_at`, `created_at`, and `failure_reason` columns.

Per Part 12's instruction, since a small clarifying note was worth leaving for a future reader, that note was added to this SAME unapplied migration file (no second migration file was created, no `ALTER TABLE`). The migration remains **not applied** to any environment in this session (no live DB access).

## 12. FILES CHANGED

- `src/services/canonical-prepared-activity.service.ts` — added `PREPARATION_LEASE_MS`; added the two stale-row cleanup UPDATEs (with their own try/catch, non-fatal on error) and their observability logging, run before the existing INSERT.
- `database/migrations/20260916_1000_canon_r6_perf_r2_canonical_prepared_activity.sql` — added a clarifying doc-comment only; zero schema/DDL changes.
- `tests/unit/canon-r6-perf-r2-prove-pregeneration.test.ts` — updated mock-call sequencing/indices to account for the two new leading cleanup queries; no assertion weakened.
- `tests/unit/canon-r6-perf-r2r1-stale-preparation-recovery.test.ts` (new) — the 10-item required test matrix, 21 tests.
- `docs/CANON_R6_PERF_R2R1_STALE_PREPARATION_RECOVERY.md` (new, this report).

No changes to: the canonical engine, `canonical-prove-generation.service.ts` (the certified generator/chunking/Quality Gate/novelty pipeline), `ProveFocusLoading.tsx` or any other focus-loading UX file, `revalidatePreparedActivity`/`consumePreparedActivity`/`isPreparedActivityContractCompatible`/`findActivePreparedActivity` internals, `PREPARED_ACTIVITY_TTL_MS`, `route.ts`, or any other learning stage.

## 13. COMMITS

1. `fix: retire stale prepared-Prove rows before new preparation` — implementation + tests.
2. `docs: CANON-R6-PERF-R2R1 stale preparation recovery report` — this report.

---

**STOP after code + report. Not deployed. Migration not applied. Not pushed to `main`.**
