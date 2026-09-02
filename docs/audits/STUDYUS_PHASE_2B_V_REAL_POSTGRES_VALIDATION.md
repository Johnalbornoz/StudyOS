# StudyUs Phase 2B-V — Real PostgreSQL Idempotency Validation

**Date**: 2026-09-02
**Type**: Validation only. No architecture change. No commit, push, or deploy. No production migration applied.

---

## 1. Executive Summary

```
REAL_POSTGRES_IDEMPOTENCY = VERIFIED
```

Every mechanism Phase 2B's design depends on was exercised against a real, running PostgreSQL engine — not a mock: the partial unique index's atomic claim semantics, the exact `23505`/constraint-name error contract `mastery.service.ts` checks, a genuine two-connection concurrent race (both directions of winner ordering), rollback-then-retry, distinct-key non-serialization, concept-scoped identity, the `mastery_records` `FOR UPDATE` row-lock serialization Phase 2B introduced, and `assessment_results.submission_token` uniqueness. All passed. Beyond the required scope, the actual, unmodified `mastery.service.ts::updateMastery` application code was run directly against the real database (not just its SQL primitives): a genuine mid-transaction failure was induced (not fabricated — the ephemeral database's own empty `mastery_policies` table, a real precondition, made `getActiveMasteryPolicy()` throw for real, deep inside the transaction, exactly where Step 12 asks for), and the full rollback — zero evidence, zero Mastery mutation, zero Knowledge State row, zero decision events — was confirmed directly from the database, followed by a successful single retry and a second replay that correctly reported `duplicate: true` with unchanged row counts throughout.

The validation environment was an ephemeral, disposable local PostgreSQL 14 instance built via the project's own already-established mechanism (`scripts/db-migration-test.sh`/`db-reproducibility-test.sh`, from Phase 0D/0E2) — never production, never a new cloud resource. It has since been destroyed. No synthetic learner activity was ever written to production. Production remains at commit `41121a5`, migration state unchanged (`2 applied, 1 pending, 0 drifted`). Source diff for this phase: zero (this report is the only new artifact).

---

## 2. Validation Environment

```
POSTGRES_VALIDATION_TARGET = LOCAL_EPHEMERAL_POSTGRES
```

No staging PostgreSQL instance exists for this project (single-environment indie deployment — confirmed by this session's repeated production-read-only work across prior phases). No established Neon branch-management mechanism exists either: the repo's `.neon` file is a minimal feature-init marker, not a Neon CLI project link or branch-provisioning setup — using it would mean *creating* new cloud infrastructure, which this phase's own safety rule prohibits absent an already-established mechanism. `LOCAL_EPHEMERAL_POSTGRES` was therefore the correct, and only safely-available, target — and it is itself an already-established project mechanism, not new infrastructure: `scripts/db-migration-test.sh` and `scripts/db-reproducibility-test.sh` (committed, Phase 0D/0E2) already implement exactly this technique for exactly this purpose.

- **PostgreSQL major version**: 14 (14.21, Homebrew `postgresql@14`).
- **How established as non-production**: a fresh `initdb` data directory under a scratch `mktemp -d` path, configured `listen_addresses = ''` (no TCP/network listener at all) and `unix_socket_directories` pointed at that same scratch directory — reachable only via a local Unix socket path, never a network address. The application's own `.env.local`/`DATABASE_URL` was never read by any step of this validation; the ephemeral instance's connection string was passed explicitly, in-process, to each validation script.
- **Real learner data**: none. Built from `database/baseline/STUDYUS_BASELINE_2026_08.sql`, a schema-only `pg_dump` snapshot with zero data rows. Every row inserted during this validation was a synthetic fixture (a test student/subject/concept chain) created solely for this run and destroyed with the instance at the end (§16).
- **Credentials**: none exist for this target — a local Unix-socket connection with `trust` authentication carries no password. No connection string, socket path, or credential was ever logged to this report or its intermediate output beyond the ephemeral, self-destroyed scratch-directory path itself (already deleted).

---

## 3. PostgreSQL Version Compatibility

```
POSTGRES_VERSION_COMPATIBILITY = COMPATIBLE
```

Production (read-only `SELECT version()`, already an established read-only check pattern from prior phases): **PostgreSQL 18.6**. Validation target: **PostgreSQL 14.21**. This is a real, disclosed four-major-version gap — not a MATCH — but every mechanism Phase 2B's guarantee depends on is long-stable, foundational PostgreSQL behavior with no material semantic difference across this range: partial unique indexes (since 9.0), `INSERT ... ON CONFLICT DO NOTHING` (since 9.5), `SELECT ... FOR UPDATE` row-level locking, and the `23505`/`constraint`-name shape of a unique-violation error have not changed in any way relevant to this design between PG14 and PG18. No PG17+-only feature this migration or `mastery.service.ts` depends on was found (the one PG17+-only construct in this codebase, `transaction_timeout` in the baseline dump's own preamble, is unrelated session-config noise the existing reproducibility scripts already document and neutralize for local testing — Phase 2B's migration file uses none of it). `COMPATIBLE`, not `MISMATCH`.

---

## 4. Migration Execution

```
MIGRATION_EXECUTION = PASS
```

The exact file `database/migrations/20260901_1200_evidence_idempotency.sql` was applied via the governed runner (`npx tsx scripts/db-migrate.ts`, no manual DDL) after the ephemeral database was brought to the baseline schema + ledger-bootstrapped state and the prerequisite `20260831_1400_ai_execution_and_decision_audit.sql` migration (also applied via the same governed runner, reaching the exact ledger state real production has today). Before applying: `learning_evidence.operation_key`, `assessment_results.submission_token`, and both new indexes were confirmed absent. After applying:

- `learning_evidence.operation_key`: exists, `nullable=YES`, `type=text`.
- `assessment_results.submission_token`: exists, `nullable=YES`, `type=text`.
- `learning_evidence_operation_key_unique_idx`: exists — `CREATE UNIQUE INDEX ... ON learning_evidence USING btree (operation_key) WHERE (operation_key IS NOT NULL)`.
- `assessment_results_submission_token_unique_idx`: exists — `CREATE UNIQUE INDEX ... ON assessment_results USING btree (submission_token) WHERE (submission_token IS NOT NULL)`.

Both indexes confirmed **partial** (`WHERE ... IS NOT NULL`), exactly as designed.

---

## 5. Migration Reapplication

```
MIGRATION_REAPPLICATION = SAFE
```

Two independent checks, both clean:

1. **Ledger-level**: running `npm run db:status` again after the apply correctly shows `0 pending` — the governed runner recognizes both migrations as already recorded and would not attempt to re-run either.
2. **Raw-SQL-level** (the more rigorous test of the file's own `IF NOT EXISTS`/`CREATE ... IF NOT EXISTS` clauses, bypassing the ledger entirely): the exact migration file was re-executed a second time directly (`psql -f <the exact file>`). Result: exit code `0`, four `NOTICE`s (`column "operation_key" ... already exists, skipping`, `relation "learning_evidence_operation_key_unique_idx" already exists, skipping`, and the two `assessment_results` equivalents) — no `ERROR`, no schema corruption, index count unchanged (2 before, 2 after), column count unchanged (2 before, 2 after).

---

## 6. Partial Unique Index Verification

Confirmed directly from `pg_indexes`/`pg_index` catalogs (not inferred): both indexes carry the exact `WHERE (operation_key IS NOT NULL)` / `WHERE (submission_token IS NOT NULL)` predicate. §16 of Step 6 (NULL coexistence) independently confirms this predicate's real effect: three `learning_evidence` rows with `operation_key IS NULL` and two `assessment_results` rows with `submission_token IS NULL` were inserted without any conflict, proving NULL values are correctly excluded from uniqueness enforcement — historical/unprotected rows genuinely coexist freely.

---

## 7. PostgreSQL Duplicate Error Contract

```
POSTGRES_DUPLICATE_ERROR_CONTRACT = VERIFIED
```

Using the real `pg` driver (the same package `src/lib/db.ts` uses — not `psql` text parsing) against a genuine duplicate insert:

```
err.code       === "23505"                                          -> VERIFIED
err.constraint === "learning_evidence_operation_key_unique_idx"      -> VERIFIED
err.table      === "learning_evidence"                               -> VERIFIED
```

This is the exact predicate `mastery.service.ts::isOperationKeyConflict` checks (`err.code === '23505' && err.constraint === '<index name>'`). The real driver's error object matches it precisely — the mocked test fixtures used in Phase 2B's own unit tests (`tests/unit/evidence-idempotency.test.ts`) were not assuming incorrect behavior.

---

## 8. Sequential Duplicate

Verified via raw SQL (`psql`) first: insert `K` once — success; insert `K` again — `ERROR: duplicate key value violates unique constraint "learning_evidence_operation_key_unique_idx"`, `DETAIL: Key (operation_key)=(...) already exists.` Then verified again at the application level in §13/Step 12 below (a second real `updateMastery` call with the same identity correctly reports `duplicate: true`).

---

## 9. Concurrent Duplicate Race

```
REAL_POSTGRES_UNIQUE_RACE = PASS
```

Two independent `pg.Client` connections, genuine overlap (not simulated): Transaction A `BEGIN`s and inserts operation key `K` inside an open, uncommitted transaction. Transaction B, on its own connection, `BEGIN`s and attempts to insert the same `K` while A's transaction is still open — B's insert is issued and its promise is left pending (not awaited) while a 300ms delay elapses, then A `COMMIT`s. Result: A succeeds; B's pending insert then resolves with a rejection, `err.code === '23505'`, `err.constraint === 'learning_evidence_operation_key_unique_idx'`. Not both succeeding.

Repeated with reversed winner ordering (B claims first, holds, A attempts and waits, B commits): same result — A fails with the identical error shape. The database resolves the race by claim order, not by which application-level connection happens to be "first" in code.

---

## 10. Rollback Claim Recovery

```
ROLLED_BACK_CLAIM_RETRY = PASS
```

Transaction A `BEGIN`s, inserts `K`, holds. Transaction B `BEGIN`s and attempts to insert the same `K` — its insert blocks (genuinely, confirmed: B's promise had not resolved after 300ms while A was open). Transaction A then `ROLLBACK`s instead of committing. B's blocked insert then resolves **successfully**. Final state: exactly one row exists for `K` — A's rolled-back attempt left none. This is the precise database-level behavior Phase 2B's transaction design depends on: a failed cognitive transaction does not permanently consume the logical operation identity, and this was proven with real Postgres locking, not assumed.

---

## 11. Distinct Operation Concurrency

Two concurrent transactions, `K1` and `K2` (genuinely distinct operation keys), both `BEGIN`, both insert, both `COMMIT` — both succeeded with no blocking or interference. The uniqueness mechanism serializes only identical logical identities, confirmed directly (not inferred from the unique-index design alone).

---

## 12. Concept-Scoped Identity

Using the real `buildOperationKey` encoding: `QUIZ_SUBMISSION::<quizId>::<CONCEPT_A>` and `QUIZ_SUBMISSION::<quizId>::<CONCEPT_B>` (same `quizId`, different concepts) both inserted successfully. A replay of `QUIZ_SUBMISSION::<quizId>::<CONCEPT_A>` then failed with `23505` on the exact same constraint. Confirms the required multi-concept semantics — "same quiz, different concept" and "same quiz, same concept, replayed" are correctly distinguished — against the actual unique index, not just the pure `buildOperationKey` unit tests already in the Phase 2B suite.

---

## 13. Cognitive Transaction Rollback

```
APPLICATION_TRANSACTION_VALIDATION = FULL
```

The real, unmodified `mastery.service.ts::updateMastery` was imported and invoked directly against the ephemeral database (`DATABASE_URL` pointed at it via the process environment, `.env.local` never read). Failure injection was **not fabricated** — it used a genuine precondition of this fresh environment: `mastery_policies` starts empty (a schema-only baseline restore, confirmed `0` rows before the call), so `getActiveMasteryPolicy()` genuinely throws `NO_MASTERY_POLICY` from deep inside `recalculateConceptKnowledgeState` — after the `learning_evidence` insert (the idempotency claim), the `mastery_records` update, and the `mastery_events` insert had all already executed inside the same open transaction, and before the transaction reached `COMMIT`. Confirmed directly from the database after the failed call:

| Table | Rows for this identity/concept |
|---|---|
| `learning_evidence` | 0 |
| `mastery_records` | 0 |
| `mastery_events` | 0 |
| `concept_knowledge_state` | 0 |
| `decision_events` (`MASTERY_UPDATED`) | 0 |
| `decision_events` (`KNOWLEDGE_STATE_PROJECTED`) | 0 |

A real `mastery_policies` row was then inserted (fixing the underlying cause, exactly as a real remediation would) and the **same logical identity** was retried: it applied successfully exactly once — `learning_evidence=1`, `mastery_records=1` (non-zero score), `mastery_events=1`, `concept_knowledge_state=1`, `MASTERY_UPDATED=1`, `KNOWLEDGE_STATE_PROJECTED=1`. A **second** replay of that now-successful identity correctly reported `duplicate: true`, and every row count above remained unchanged. This is a full, real, end-to-end proof — through the actual application code, not database primitives alone — that a mid-transaction failure leaves zero partial state and that the identical operation can be safely retried exactly once.

---

## 14. Mastery Row Serialization

```
CONCURRENT_DISTINCT_MASTERY_APPLICATIONS = SERIALIZED
```

Reproduced the exact `INSERT ... ON CONFLICT DO NOTHING` + `SELECT ... FOR UPDATE` shape `mastery.service.ts` uses. Transaction A locks the row (`mastery_score = 50` at the time), holds it open. Transaction B attempts the identical locked `SELECT ... FOR UPDATE` on the same row concurrently — confirmed to genuinely **block** (a `Promise.race` against a 500ms timer resolved to "still blocked," not to B's query). A then updates the row to `mastery_score = 65` and commits, releasing the lock. B's blocked query then resolves and reads `mastery_score = 65` — A's committed value, not the stale `50` it would have read had it proceeded without blocking. This directly confirms Phase 2B's `FOR UPDATE` addition genuinely serializes two distinct concurrent Mastery-affecting operations on the same student+concept row, closing the lost-update risk a naive read-then-write would have had. `LOST_UPDATE_RISK` was not observed.

---

## 15. Assessment Submission Token

Same-token resubmission: a second `assessment_results` insert with an already-used `submission_token` failed with `23505` on `assessment_results_submission_token_unique_idx`, confirmed via the real driver's error fields. A **different** token for the **same** `occurrence_id` — modeling a deliberate correction/re-entry, exactly the case Phase 2B's design was built not to collapse — succeeded, confirmed by a returned new row id. Correction semantics were not altered by this validation; this only confirms the mechanism behaves as designed against a real database.

---

## 16. Index Health

```
IDEMPOTENCY_INDEX_HEALTH = PASS
```

`pg_index`/`pg_class` catalog query on both new indexes: `indisvalid = t`, `indisready = t`, `indisunique = t` for both `learning_evidence_operation_key_unique_idx` and `assessment_results_submission_token_unique_idx`. No performance benchmarking was performed (not required by this phase).

---

## 17. Validation Fixture Cleanup

```
VALIDATION_FIXTURES_CLEANED = DISPOSABLE_DB_DESTROYED
```

The entire ephemeral instance was disposable by construction (§2) — its Postgres server process was stopped (`pg_ctl ... -m immediate stop`) and its whole scratch data directory deleted at the end of this validation. Confirmed afterward: no residual files under the scratch path, no residual Postgres process for this instance. No shared/persistent environment existed to selectively clean, so full destruction was the correct and complete cleanup.

---

## 18. Production State Confirmation

```
git rev-parse HEAD         -> 41121a5df2b97dffa5ae97ad01ae8269baf9fcc5   (unchanged)
git rev-parse origin/main  -> 41121a5df2b97dffa5ae97ad01ae8269baf9fcc5   (unchanged)

npm run db:status (production, read-only):
  LEDGER = FOUND
  Applied (2): 20260831_1400_ai_execution_and_decision_audit, STUDYUS_BASELINE_2026_08
  Pending (1): 20260901_1200_evidence_idempotency
  SUMMARY: 2 applied, 1 pending, 0 drifted.
```

Identical to the state recorded at the end of Phase 2B, before this validation phase began. Production was never mutated: every SQL statement in this validation ran against a Unix-socket-only, locally-scoped ephemeral instance with its own independent connection string — production's `DATABASE_URL`/`.env.local` was read exactly once, read-only, solely for the `SELECT version()` check in §3, and never for anything else in this phase.

---

## 19. Application Validation

```
npx tsc --noEmit   -> clean, 0 errors
npx vitest run     -> 84 test files, 902 tests, all passing (unchanged from Phase 2B)
npm run build      -> succeeded, clean
```

No source modification was needed to make validation pass — no PostgreSQL incompatibility was discovered.

---

## 20. Source Diff

```
SOURCE_CODE_CHANGES  = 0
MIGRATION_CHANGES    = 0
```

`git diff --stat` at the end of this phase is byte-identical to its state at the end of Phase 2B (26 files changed, 1039 insertions, 466 deletions — the same set, confirmed by direct comparison). The only new artifact from this phase is this report. Every validation script used during this phase (bash + a `pg`-driver TypeScript file) lived under `/tmp`/a session scratch directory or a transient `scripts/.tmp/` copy needed only for Node module resolution — never committed, and confirmed removed (`git status` shows no trace).

---

## 21. Remaining Risks

Maximum five.

1. **Version gap between the validation target (PG14) and production (PG18).** Disclosed and assessed as immaterial for the specific mechanisms tested (§3) — but a validation against a PG18 (or PG17+) instance specifically would remove even that residual doubt, since none currently exists locally.
2. **Single-machine concurrency, not multi-instance/multi-region.** Both connections in every race test ran from one process on one machine against one local Postgres instance. Production (Neon, pooled, possibly geo-distributed connections) could theoretically exhibit different network-level timing, though the actual serialization guarantee under test is enforced by Postgres's own lock manager, not by anything network-topology-dependent.
3. **Synthetic fixtures used simplified/minimal valid data** (e.g. a single test student, subject, and a handful of concepts) rather than a realistic multi-student, multi-concept production-shaped dataset. Sufficient to prove the mechanisms under test; not a load or scale test.
4. **No test of a Neon-specific behavior** (e.g. connection pooling via PgBouncer/Neon's proxy, which the real `db.connect()` calls in production pass through) — this validation used direct `pg.Client` connections to a bare local instance, not through any pooling proxy layer. Standard unique-index/lock-manager semantics are not expected to differ through a transaction-mode pooler for the single-statement-per-transaction patterns Phase 2B uses, but this was not directly observed.
5. **This validation exercised the mechanisms in isolation and via one full application-level scenario (§13), not the complete set of six production writers end-to-end** (quiz/verification/explain/transfer/exam-result/record-evidence) against a real database — those six were already covered individually by Phase 2B's own mocked unit tests, and all route through the identical `updateMastery` code path just proven for real here, but a full real-database run of, say, the exam-result submission-token path through actual application code (mirroring §13's depth) was not additionally performed.

---

## 22. Definition of Done

- [x] safe non-production PostgreSQL used
- [x] actual migration applied
- [x] migration safely reapplied
- [x] NULL historical rows remain valid
- [x] actual 23505 error contract verified
- [x] concurrent same-key race verified
- [x] rolled-back claim can be retried
- [x] distinct keys coexist
- [x] concept-scoped identities verified
- [x] cognitive transaction rollback verified
- [x] mastery-row serialization verified
- [x] assessment token uniqueness verified
- [x] indexes valid/ready
- [x] fixtures cleaned
- [x] production untouched
- [x] tests pass
- [x] build passes
- [x] source unchanged

---

## 23. Final Decision

**A. Does real PostgreSQL enforce one winner for the same operation key?**
**YES.**

**B. Can a waiting duplicate succeed if the first transaction rolls back?**
**YES.**

**C. Does PostgreSQL expose the unique violation exactly as the application expects?**
**YES.**

**D. Are distinct learner operations unaffected?**
**YES.**

**E. Are multi-concept operations correctly independent?**
**YES.**

**F. Are concurrent distinct operations on one mastery row serialized safely?**
**YES.**

**G. Is the assessment submission-token behavior correct?**
**YES.**

**H. Did the actual migration execute correctly?**
**YES.**

**I. Was production untouched?**
**YES.**

**J. Is REAL_POSTGRES_IDEMPOTENCY = VERIFIED?**
**YES.**

**K. Is Phase 2B ready for production release?**
**YES** — the release gate this phase existed to close (real-database validation) is now closed, with a real application-level end-to-end proof (§13) exceeding the phase's own minimum bar. The five items in §21 are residual, narrower considerations, not blockers.

**L. Remaining blockers.**
**NONE.**
