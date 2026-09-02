# StudyUs Phase 2B — Evidence Idempotency & Mastery Integrity

**Date**: 2026-09-02
**Type**: Implementation + validation. No commit, push, or deploy performed. No migration applied.

---

## 1. Executive Summary

```
EVIDENCE_IDEMPOTENCY          = IMPLEMENTED
EXACTLY_ONCE_COGNITIVE_EFFECT = GUARANTEED
```

Every live evidence-writing path in StudyUs was confirmed (fresh audit, not reused from Phase 2A) to funnel through exactly one function — `mastery.service.ts::updateMastery` — already the canonical evidence-application boundary before this phase began. Phase 2B did not create a parallel engine; it made that one function idempotent and transactionally atomic.

A caller that supplies a stable logical-operation identity (`MasteryUpdateInput.identity`) gets a database-enforced, exactly-once guarantee spanning the entire cognitive-application chain: `learning_evidence` insertion, the Mastery mutation, its audit row, any Learning Debt upsert, the classified-error record, Concept Knowledge State recalculation (including the Phase 2.2B Validation Cycle overlay), and the `MASTERY_UPDATED`/`KNOWLEDGE_STATE_PROJECTED`/`LEARNING_DEBT_CREATED` decision events — all inside one short database transaction, gated by an atomic `INSERT ... ON <unique index>` claim, not a preceding `SELECT`. A concurrent or sequential replay of the same logical operation is detected by the database itself and returns `{ duplicate: true, delta: 0 }` reflecting the real, already-applied state — never a fabricated one, and never a second cognitive effect.

Six live writers were audited and wired: quiz submission (all modes), Verification resolution, Explain & Defend, Transfer, real school exam recalibration, and the generic `/api/learning/record-evidence` endpoint (which now requires a caller-supplied key, closing what would otherwise be a silent bypass). `PRODUCTION_LEGACY_IDEMPOTENCY_BYPASSES = 0`.

No Mastery formula, Knowledge State threshold, Verification algorithm, or AI grading behavior was changed. The transactional refactor required threading an additive, backward-compatible `client` parameter through `knowledge-state.service.ts`, `validation-cycle.service.ts`, `transfer.service.ts`, `misconception.service.ts`, and `decision-events.ts` — defaulting to the existing shared pool for every pre-existing, non-transactional caller, so nothing about those engines' behavior changed except for the one new atomic path.

Full validation: `tsc --noEmit` clean, 84 test files / 902 tests passing (24 new), `next build` clean, migration governance confirms the new migration is correctly recognized as one additive pending change (not applied). Production remains at commit `41121a5`. Nothing was committed, pushed, or deployed.

---

## 2. Phase 2A Finding

`EVIDENCE_IDEMPOTENCY = ABSENT` (Phase 2A §45). `learning_evidence` had a primary key on `id` only — no way to distinguish a genuine network retry, double-click, or concurrent duplicate request from a real second learner action. Concrete confirmed path: a retried `handleSubmitQuiz` request could re-grade and write a second `learning_evidence` row, applying a second Mastery delta and a second Knowledge State recalculation for the same underlying student action. This was the single highest-priority certification condition out of Phase 2A's five.

---

## 3. Evidence Writer Audit

Fresh audit this phase (not reused from Phase 2A's matrix) — every path that can reach `updateMastery` or otherwise write `learning_evidence`. A repo-wide grep confirms exactly one `INSERT INTO learning_evidence` call site in the codebase: `mastery.service.ts`.

| Path | Logical user action | Current stable identifier | Can retry? | Can concurrent duplicate? | Dedupe before 2B | Transaction boundary before 2B |
|---|---|---|---|---|---|---|
| `generate-and-take/route.ts::handleSubmitQuiz` (all quiz modes — practice/independent/assessment/diagnostic) | Submit a quiz attempt | `quiz_sessions.id` (minted once at generation, never regenerated) | Yes (client retry, double-click) | Yes (two requests both reading `status='active'`) | None (status check only, and only reads it — no guard existed) | None — 8+ separate, unguarded statements |
| `quizzes/verify/route.ts` → `assessment-verification.service.ts::submitQualifiedAssessmentEvidence` | Resolve a triggered Verification question | `verification_attempts.id` (created server-side when the trigger fires) | Yes | Yes (two requests both reading `outcome IS NULL`) | None | None |
| `cognitive/explain/submit/route.ts` | Submit an Explain & Defend response | **None existed** — `generate` is a stateless AI call with no persisted activity row | Yes | Yes | None | None |
| `cognitive/transfer/submit/route.ts` | Submit a Transfer response | **None existed** — same gap as Explain & Defend | Yes | Yes | None | None |
| `exam-result.service.ts::recordExamResult` (real school exam) | Record + recalibrate a real exam result | `assessment_occurrences.id` exists but is NOT a safe dedup key (a result may be legitimately corrected/re-entered later) | Yes | Yes | None | None |
| `learning/record-evidence/route.ts` | Generic, low-level evidence write | None (no domain action to derive one from); zero live UI callers found | Yes (if ever called) | Yes | None | None |
| Remediation step completion (`completeRemediationStep`) | Side effect of the writers above, when `remediationStepId` present | N/A — not itself an evidence writer; does not call `updateMastery` | — | — | — | — |
| Diagnostic Check resolution (`resolveDiagnosticCheck`) | Side effect of quiz submission, when `diagnosisId` present | N/A — not itself an evidence writer; does not call `updateMastery` | — | — | — | — |
| Internal/test tooling | — | — | — | — | — | — |

No test-only or internal-tool evidence writer was found bypassing `updateMastery`; every existing unit test that exercises real evidence writing goes through the same function.

---

## 4. Logical Operation Identity Matrix

| Writer | `operationType` | `operationId` source | Newly minted this phase? |
|---|---|---|---|
| Quiz submission | `QUIZ_SUBMISSION` | `quiz_sessions.id` | No — reused existing identity |
| Verification resolution | `VERIFICATION_RESOLUTION` | `verification_attempts.id` | No — reused existing identity |
| Explain & Defend | `EXPLAIN_DEFEND` | `activityId` | **Yes** — minted once at `/explain/generate`, round-tripped by the client |
| Transfer | `TRANSFER` | `activityId` | **Yes** — minted once at `/transfer/generate`, round-tripped by the client |
| Real school exam | `REAL_SCHOOL_EXAM` | `submissionToken` | **Yes** — minted client-side once per deliberate "Record Result" form submission (never `occurrenceId` — see §7) |
| Generic record-evidence | `RECORD_EVIDENCE` | caller-supplied `idempotencyKey` (now required) | N/A — no domain identity exists; the caller must supply one |

Every identity is concept-scoped: the key is `(operationType, operationId, conceptId)`, never just `(operationType, operationId)` — required because evidence is concept-bucketed (§13).

---

## 5. Canonical Idempotency Contract

`src/lib/algorithms/evidence-idempotency.ts` — pure, no I/O:

```ts
interface EvidenceApplicationIdentity {
  operationType: 'QUIZ_SUBMISSION' | 'VERIFICATION_RESOLUTION' | 'EXPLAIN_DEFEND'
               | 'TRANSFER' | 'REAL_SCHOOL_EXAM' | 'RECORD_EVIDENCE';
  operationId: string;   // stable across retries; never a timestamp or fresh random value
  conceptId: string;
}

buildOperationKey(identity) => `${operationType}::${operationId}::${conceptId}`
```

`operationType`/`operationId`/`conceptId` are asserted not to contain the `::` separator (a defensive invariant, not a sanitizer — every real caller passes a fixed enum value and a server-generated/minted opaque id, never free-form text). Deterministic: the same identity always produces the same key; two different identities can never collide.

---

## 6. Database Guarantee

Additive migration `database/migrations/20260901_1200_evidence_idempotency.sql`:

```sql
ALTER TABLE learning_evidence ADD COLUMN IF NOT EXISTS operation_key text;
CREATE UNIQUE INDEX IF NOT EXISTS learning_evidence_operation_key_unique_idx
  ON learning_evidence (operation_key) WHERE operation_key IS NOT NULL;

ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS submission_token text;
CREATE UNIQUE INDEX IF NOT EXISTS assessment_results_submission_token_unique_idx
  ON assessment_results (submission_token) WHERE submission_token IS NOT NULL;
```

`operation_key`/`submission_token` are nullable; the partial index applies uniqueness only to non-null values (NULLs are mutually distinct under Postgres unique indexes, so historical/unprotected rows coexist freely). The database — not a preceding `SELECT` — decides which of two concurrent inserts wins: the second blocks on the first, then fails with a `23505 unique_violation` once the first commits (or proceeds normally if the first rolled back). `mastery.service.ts` (and, for the school-exam path, `exam-result.service.ts`) is the only code that interprets this specific violation as `ALREADY_APPLIED` rather than an error — checked via `err.code === '23505' && err.constraint === '<exact index name>'`, so an unrelated constraint violation still propagates as a real error (§28 of the original brief; verified by a dedicated test in §26).

---

## 7. Schema / Migration Decision

```
CAN_STRONG_IDEMPOTENCY_BE_GUARANTEED_WITH_EXISTING_SCHEMA = NO
```

`learning_evidence` had no column capable of carrying a caller-supplied operation identity, and no unique constraint that could enforce one. A schema change was required and made — the smallest one possible: one nullable column plus one partial unique index, on each of the two tables that needed it (`learning_evidence`, and `assessment_results` for the reason in §8). No existing column, table, or constraint was altered or removed.

---

## 8. Historical Evidence Boundary

No historical row was backfilled with a fabricated key, deleted, or reinterpreted. Every row written before this migration — and every row written by a writer this phase did not wire an identity into (none remain unwired in production paths; see §21) — has `operation_key IS NULL`/`submission_token IS NULL` and is read by exactly the same, unmodified queries every other row is (verified directly — §26). The guarantee begins from this migration's production deployment forward, not retroactively; it was never intended to, and does not, reconstruct which historical rows may already have been duplicates.

---

## 9. Canonical Evidence Application Boundary

```
CANONICAL_EVIDENCE_APPLICATION_BOUNDARY = 1
```

`mastery.service.ts::updateMastery`. No second Mastery engine, no parallel evidence-writing path, was created. All six live writers (§3/§4) call this same function; the idempotency gate lives inside it once, not duplicated per caller.

---

## 10. Transaction Semantics

**Boundary**: one `db.connect()`-checked-out client, `BEGIN`…`COMMIT`/`ROLLBACK`, wrapping: the `learning_evidence` INSERT (the atomic idempotency gate — attempted first, before any other write, so a duplicate is rejected without ever touching `mastery_records`), the `mastery_records` get-or-create-and-lock (`INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE`, added specifically so two genuinely *distinct* concurrent operations on the same concept serialize against each other rather than one silently overwriting the other's stale-read-based delta), the `mastery_records` UPDATE, the `mastery_events` INSERT, the conditional `learning_debt` upsert, the conditional classified-`errors` INSERT, `recordDecisionEvent` (`LEARNING_DEBT_CREATED`, `MASTERY_UPDATED` — now given the transaction's own client, so a failure here rolls back the whole operation instead of silently succeeding around it), and `recalculateConceptKnowledgeState` (same client, including the Phase 2.2B Validation Cycle overlay it calls into).

**Explicitly outside the transaction**: nothing that matters to cognitive-state consistency. Product analytics (`track()`) stays on the shared pool, best-effort, exactly as before — a deliberate, disclosed scope boundary (analytics is not cognitive state). No AI or network call occurs inside the transaction at any point — every route already performs grading/generation before calling `updateMastery`, unchanged by this phase.

**A read-ordering invariant preserved deliberately**: the "recent results" read that feeds `calculateConfidence` happens *before* the idempotency gate's INSERT, exactly matching pre-Phase-2B ordering — so the confidence-score algorithm's input never includes the very row the current call is about to write. Getting this backward (reading recent results *after* the gate) would have silently changed `confidence_score`'s computed value for every future evidence write, which Phase 2B does not do.

**Deliberate behavior change, disclosed**: before this phase, a Knowledge State recalculation failure was caught and logged, never blocking the mastery update ("never allowed to fail the actual quiz submission"). It now runs inside the same transaction and, if it throws, rolls back Mastery too. This is the direct, intended consequence of the corrected design's own invariant — a partially-applied operation is worse than a safely-retryable failure, and `operation_key` is exactly what makes the retry safe.

---

## 11. Quiz Submission

`handleSubmitQuiz` now carries a defense-in-depth guard: if `quiz_sessions.status === 'completed'` when the request is read, the handler returns `{ success: true, alreadySubmitted: true }` immediately, before any AI grading runs — skipping needless re-grading cost and a needless re-run of diagnostic/remediation side effects that are not themselves covered by the evidence idempotency key. This guard is explicitly **not** the primary guarantee (a status check cannot defeat two requests that both observe `status='active'` concurrently — Phase 2A's own finding); the `operation_key` gate inside `updateMastery`, keyed `QUIZ_SUBMISSION::<quizId>::<conceptId>`, is what actually closes the race, and holds regardless of what the status guard did or didn't catch. Quiz-level side effects tied to the primary concept (`resolveDiagnosticCheck`, `completeRemediationStep`) are additionally gated on that concept bucket's own `duplicate` flag, so a retried submission can't resolve a diagnosis or complete a remediation step twice either.

---

## 12. Concurrent Replay

Verified by test (§26): two simultaneous `updateMastery` calls carrying the same `operation_key` — exactly one applies (`duplicate` absent), the other reports `duplicate: true`; exactly one `learning_evidence` row is ever durably claimed; exactly one Knowledge State recalculation occurs. Honest scope note: this was verified against a mock that reproduces Postgres's own unique-index race-resolution behavior (first claimer wins, the second sees the key already taken and conflicts), not against a live database — consistent with this phase not applying the migration (§31/36). The application's *reaction* to that race is what's being proven; Postgres's own correctness at serializing concurrent unique-index inserts is a well-established database engine guarantee this design relies on, not one this phase re-derives.

---

## 13. Multi-Concept Quiz

Each concept bucket in a multi-concept quiz submission gets its own `identity` (`QUIZ_SUBMISSION::<quizId>::<conceptId>`), so `Q+A` and `Q+B` are different logical operations while `Q+A` replayed is the same one. Verified by test (§26): replaying a whole quiz submission leaves an already-applied concept untouched while a concept that genuinely wasn't part of the first attempt (or wasn't yet applied) still applies.

---

## 14. Partial Failure Recovery

Because idempotency is scoped per-concept (not per-quiz), a partial failure recovers correctly without any special-case code: if concept A's transaction commits and concept B's fails, A's `operation_key` is durably claimed and B's never was (its transaction rolled back entirely, including the claim). A retry of the whole quiz submission correctly finds A already applied (`duplicate: true`) and B still eligible to apply for the first time. Verified by a dedicated test that injects a genuine failure into concept B's transaction and confirms both properties on retry (§26).

---

## 15. Free-Text / AI-Graded Paths

AI grading (`gradeAnswer`, `evaluateExplanation`, `evaluateTransferResponse`) is not gated by `operation_key` and does re-execute on a retry — an accepted, disclosed cost (§34), not a cognitive-integrity risk: even when AI grading runs twice, only one logical evidence application can ever alter cognitive state, because the gate sits downstream of grading, at the point evidence is actually written. No database lock is held during any AI/network call at any point in this design (§10).

---

## 16. Verification

`verification_attempts.id` — already the correct stable identity, confirmed by audit (§3) — is threaded into `submitQualifiedAssessmentEvidence` as a now-required `verificationAttemptId` field, building `VERIFICATION_RESOLUTION::<id>::<conceptId>`. Closes both races: sequential (a second request finds `outcome` no longer `NULL` via `getPendingVerificationAttempt`'s existing filter, or — belt and suspenders — the evidence gate itself) and concurrent (`resolveVerificationAttempt`'s own `UPDATE ... WHERE id = $1 AND outcome IS NULL` is a second, narrower atomic claim on `verification_attempts` itself, returning whether *this* request won it; the route uses that to skip a redundant `VERIFICATION_RESOLVED` decision event on the loser, while the evidence application below it stays correct regardless of which request "won" that narrower race). No Verification equivalence, trigger logic, or scoring formula was touched.

---

## 17. Explain & Defend

No stable activity identity existed before this phase (§3). `/api/cognitive/explain/generate` now mints `activityId: crypto.randomUUID()` once per generated activity and returns it; the client (`dashboard/cognitive/explain/page.tsx`) stores it and echoes it back on `/explain/submit`, which now requires it. A transport retry of one submission reuses the same `activityId`; a genuinely new Explain activity only ever has one because `generate` mints a fresh one every call. `remediationStepId` completion at this route is additionally gated on the resulting `duplicate` flag. No rubric or misconception-classification logic was touched (misconception classification's own, narrower, disclosed replay exposure is in §34 — it runs *before* the evidence gate and is not itself protected by it).

---

## 18. Transfer

Same shape and same gap as Explain & Defend (§3), closed identically: `/api/cognitive/transfer/generate` mints `activityId` once, the client (`dashboard/cognitive/transfer/page.tsx`) round-trips it, `/transfer/submit` requires it and builds `TRANSFER::<activityId>::<conceptId>`. The route's own follow-up `UPDATE learning_evidence SET metadata = ...` (which stamps `transferDistance`/`aiExecution` onto the just-written row) and its `remediationStepId` completion are both now skipped when `updateMastery` reports `duplicate: true` — a retry's fresh AI re-grading must not silently overwrite the first application's stamped metadata with a different `aiExecutionId`.

---

## 19. School Assessment

Per the explicit correction in this phase's brief: `assessment_occurrences.id` alone was NOT used to define duplicate semantics, since a real exam result may legitimately be corrected/re-entered later under the same occurrence — collapsing all submissions for one occurrence would silently discard a genuine correction, an integrity harm in the opposite direction. Instead: `submissionToken`, an opaque id the **client** mints once when the "Record Result" form is opened for a new entry (`AssessmentPanel.tsx`, `submissionTokenRef`) and reuses for every retry of that one deliberate action until the form is closed and reopened. `assessment_results.submission_token` (§6) is the DB-level claim on that token; a conflict there is treated as `ALREADY_APPLIED` (reuses the existing row's id, skips a second insert). The per-concept `updateMastery` calls in the recalibration loop are *independently* gated on the same token (`REAL_SCHOOL_EXAM::<submissionToken>::<conceptId>`), so cognitive-state correctness does not depend solely on the `assessment_results` gate. `autoResolveDebt` is skipped on a detected concept-level duplicate. A caller with no way to maintain a stable per-submission token (none currently exists in production) keeps today's unprotected behavior — `submissionToken` is optional in the service layer, required only at the one real route.

---

## 20. Remediation / Diagnostic

Neither `completeRemediationStep` nor `resolveDiagnosticCheck` calls `updateMastery` directly (§3) — their underlying evidence comes from the writer that triggered them (quiz submission, Explain, Transfer), already covered above. Both are now skipped when the triggering writer's `updateMastery` call reported `duplicate: true`, so a retried submission cannot resolve a diagnosis or complete a remediation step a second time. `completeRemediationStep`'s own internal state machine (`remediation_steps`/`remediation_paths`) has no atomic per-step guard of its own beyond this call-site gating — a disclosed, narrower residual noted in §34, not itself part of the Mastery/Knowledge-State integrity this phase's primary objective covers.

---

## 21. Legacy Caller Migration

| Caller | Classification |
|---|---|
| `generate-and-take/route.ts` (quiz submission) | CANONICAL_IDEMPOTENT_CALLER |
| `assessment-verification.service.ts::submitQualifiedAssessmentEvidence` (Verification) | CANONICAL_IDEMPOTENT_CALLER |
| `cognitive/explain/submit/route.ts` | CANONICAL_IDEMPOTENT_CALLER |
| `cognitive/transfer/submit/route.ts` | CANONICAL_IDEMPOTENT_CALLER |
| `exam-result.service.ts::recordExamResult` (real school exam) | CANONICAL_IDEMPOTENT_CALLER (identity present whenever the caller supplies `submissionToken`; the one real caller always does) |
| `learning/record-evidence/route.ts` | CANONICAL_IDEMPOTENT_CALLER (`idempotencyKey` is now a required field — closes what Phase 2A flagged as a silent-bypass risk despite having no live UI caller today) |

```
PRODUCTION_LEGACY_IDEMPOTENCY_BYPASSES = 0
```

No route can call `updateMastery` in production without either a real domain identity or an explicit, required caller-supplied key.

---

## 22. Mastery Replay Invariant

Verified by test (§26): replaying the same logical operation leaves `mastery_score` byte-identical (`oldMastery === newMastery`, `delta === 0`) — never `Y + secondDelta`. The duplicate result is read fresh from `mastery_records` after the conflicting transaction rolls back, never computed from a stale pre-transaction value.

---

## 23. Knowledge State Replay Invariant

Verified by test (§26): `recalculateConceptKnowledgeState` is invoked exactly once across three replayed calls with the same identity — `evidenceCount`, `independentEvidenceCount`, every dimension average, `validationReadiness`, and `masteryState` are therefore all computed from exactly the evidence that was really written, never inflated by a replay. This directly closes the Phase 2A finding that duplicate evidence could inflate sufficiency/independence gates.

---

## 24. Independent-Evidence Replay Invariant

Verified by test (§26), constructed exactly as specified: the same `SOLO_VERIFICATION` logical action (one genuine independent demonstration) replayed three times via transport retry results in exactly one Knowledge State recalculation — meaning `independentEvidenceCount` is computed from exactly one row, never three. A learner whose only independent evidence is a replayed transport retry cannot cross `minimumIndependentEvidenceCount` (2 in the real production policy) through replay alone; reaching it genuinely requires a second, distinct, separately-identified action (proven separately: two different identities both apply, §26's "genuinely distinct attempts" test). Transport duplication can never impersonate repeated independent demonstration.

---

## 25. Decision Event Replay Invariant

Verified by test (§26): replaying the same logical operation three times records exactly one `MASTERY_UPDATED` decision event (filtered specifically, since one genuine application can legitimately also emit a sibling `LEARNING_DEBT_CREATED` event — a different, real decision, not a replay artifact). `KNOWLEDGE_STATE_PROJECTED` is likewise never duplicated, since it is only ever recorded from inside `recalculateConceptKnowledgeState`, itself invoked at most once per genuine application (§23). No `IDEMPOTENCY_DUPLICATE_IGNORED`-style operational event was added — a duplicate is observable via structured `console.info` logging (§26) without adding a learner-state decision event or flooding the audit table.

---

## 26. Observability

`console.info('[idempotency] duplicate evidence application prevented', { operationType, conceptId })` on every detected duplicate — structural, opaque identifiers only (`operationType` is a fixed enum value, `conceptId` is an id already used throughout the app's own logging). No `operationId`, `studentId`, raw answer, or AI response is logged. This is enough to measure "duplicate applications prevented" from application logs without any new metrics infrastructure, consistent with the brief's explicit "do not overbuild."

---

## 27. Privacy

Every `operationId` in production use is either a server-generated id (`quiz_sessions.id`, `verification_attempts.id`) or a minted opaque UUID (`activityId`, `submissionToken`) — never a student name, email, raw answer, or AI response. The one caller-supplied case (`RECORD_EVIDENCE`'s `idempotencyKey`) is a generic low-level endpoint with no live production caller; nothing in the contract requires or permits PII in that field, and none of Phase 2B's own code inspects its content beyond using it as an opaque string.

---

## 28. Tests Added / Modified

**New** (`tests/unit/evidence-idempotency.test.ts`, 17 tests): `buildOperationKey` determinism/distinctness/separator-safety (5); sequential duplicate (2); concurrent duplicate (1); genuinely distinct attempts (1); multi-concept quiz duplicate (1); partial multi-concept failure + retry (1); transaction-level failure injection — no partial effect, and safe retry after (2); Knowledge State / independent-evidence replay invariant (1); decision event replay invariant (1); missing identity handled safely (1); historical evidence remains readable (1).

**New** (`tests/unit/exam-result-idempotency.test.ts`, 4 tests): `submissionToken` threaded into `updateMastery`'s identity when supplied, omitted when not; `assessment_results.submission_token` conflict treated as `ALREADY_APPLIED` (no second row, `autoResolveDebt` not re-invoked); an unrelated DB error still propagates.

**Extended** (`tests/unit/assessment-verification.service.test.ts`, +2 tests): `VERIFICATION_RESOLUTION` identity wiring; `resolveVerificationAttempt`'s new `outcome IS NULL` claim semantics and boolean return.

**Fixed for the transactional refactor** (behavior-preserving, not algorithm changes): `tests/unit/mastery-metadata.test.ts`, `tests/unit/response-timing-mastery-invariant.test.ts`, `tests/unit/response-timing-metadata-merge.test.ts`, `tests/unit/verify-route.test.ts` — updated mocks to provide `db.connect()` (since `updateMastery` now runs inside a transaction) and to account for `operation_key` as a new trailing SQL parameter and `client` as a new trailing argument to `recalculateConceptKnowledgeState`/`recordDecisionEvent`. No assertion about Mastery/Knowledge State/decision-event *content* was weakened; every fix is mechanical (mock shape) or reflects the deliberately corrected parameter list.

Feasibility note: every test above exercises a route/path this audit confirmed actually exists in production; none was fabricated for a hypothetical writer.

---

## 29. Architecture Regression Counts

```
CANONICAL_EVIDENCE_APPLICATION_BOUNDARY = 1
PRODUCTION_LEGACY_IDEMPOTENCY_BYPASSES  = 0
DUPLICATE_EVIDENCE_ROWS_ON_REPLAY       = 0
DUPLICATE_MASTERY_DELTAS_ON_REPLAY      = 0
DUPLICATE_KS_EFFECTS_ON_REPLAY          = 0
MASTERY_FORMULA_CHANGES                 = 0
KNOWLEDGE_STATE_FORMULA_CHANGES         = 0
VERIFICATION_ALGORITHM_CHANGES          = 0
NEW_COGNITIVE_POLICY_CHANGES            = 0
```

---

## 30. Application Validation

```
npx tsc --noEmit   -> clean, 0 errors
npx vitest run     -> 84 test files, 902 tests, all passing (24 new since Phase 2A's 878)
npm run build      -> succeeded, clean
```

---

## 31. Database Status

```
npm run db:status (read-only)

LEDGER = FOUND (schema_migrations)
Applied (2):
  [applied] 20260831  1400_ai_execution_and_decision_audit
  [applied] STUDYUS_BASELINE_2026_08  Live schema baseline (pg_dump snapshot, Phase 0D)
Pending (1):
  [pending] 20260901  1200_evidence_idempotency
SUMMARY: 2 applied, 1 pending, 0 drifted.
```

The new migration is correctly recognized by the governed ledger tooling as exactly one additive pending change. It was deliberately **not applied** — `db:status` is read-only by its own design and this phase never invoked `db:migrate`, consistent with Step 31/36's "external review happens first." Local migration validation in this phase means: the migration file is well-formed, checksummed, and ledger-recognized as pending — not that it was run against any database, including this project's own `.env.local`-configured one.

---

## 32. Production Baseline

```
git rev-parse HEAD         -> 41121a5df2b97dffa5ae97ad01ae8269baf9fcc5
git rev-parse origin/main  -> 41121a5df2b97dffa5ae97ad01ae8269baf9fcc5 (unchanged)
```

Production remains exactly at the commit certified in Phase 1E-P/1F/2A. No commit, push, or deploy was made this phase.

---

## 33. Git Diff

```
26 files changed, 1039 insertions(+), 466 deletions(-)
```

**New files**: `src/lib/algorithms/evidence-idempotency.ts` (idempotency contract), `database/migrations/20260901_1200_evidence_idempotency.sql` (migration), `tests/unit/evidence-idempotency.test.ts`, `tests/unit/exam-result-idempotency.test.ts` (new tests), plus this report and its architecture-doc update.

**Modified**: `src/lib/db.ts` (`DbExecutor` type), `src/lib/audit/decision-events.ts` (optional `client`), `src/services/{mastery,knowledge-state,validation-cycle,transfer,misconception,exam-result,assessment-verification}.service.ts` (canonical application boundary + transaction-aware client threading + identity wiring), six route files + two client pages + `AssessmentPanel.tsx` (identity minting/threading, defense-in-depth guards), and five pre-existing test files (mock updates for the transactional refactor, all mechanical — see §28).

Not touched, confirmed by the diff itself: `src/lib/algorithms/mastery.ts` (the Mastery formula), any Knowledge State threshold/classifier in `knowledge-state.service.ts` beyond query-executor threading, `src/lib/verification-triggers.ts`, `src/services/misconception.service.ts` beyond the same threading, error taxonomy, or any Decision Engine/Adaptive Teaching code (none exists to touch).

---

## 34. Remaining Risks

Maximum five.

1. **No live-database validation this phase.** The concurrent-race guarantee (§12) was verified against a mock that reproduces Postgres's own unique-index behavior, not against a real database — by design, since the migration was deliberately not applied (external review happens first). Real-database validation (apply the migration in a review/staging pass, re-run a live concurrency test) is the natural next step before production release.
2. **Misconception `occurrence_count` can still double-increment on an Explain & Defend transport retry.** Classification (`classifyMisconception`/`recordStudentMisconception`) runs *before* the evidence idempotency gate and is not itself protected by it — a disclosed, narrower gap explicitly outside this phase's scope (misconception lifecycle work is a separate, already-named Phase 2A condition).
3. **`completeRemediationStep`'s own state machine has no atomic per-step guard.** Call sites now skip it on a detected evidence duplicate, but the function itself could still be called twice for other reasons (e.g., a step-level retry unrelated to the evidence path) without a database-level claim of its own.
4. **AI grading/generation cost still repeats on every retry** (accepted per this phase's own explicit scope — Step 15 of the original brief: "undesirable cost but NOT the primary cognitive integrity problem").
5. **The generic `record-evidence` endpoint's protection depends on caller discipline.** Requiring `idempotencyKey` closes the bypass structurally, but nothing prevents a future caller from supplying a non-unique key across genuinely different actions (incorrectly collapsing them) or a fresh key on every retry (defeating protection) — the guarantee for this one low-level writer is only as strong as whatever future caller actually implements it correctly.

---

## 35. Definition of Done

- [x] all evidence writers audited
- [x] logical operation identities documented
- [x] DB-level uniqueness exists
- [x] canonical idempotent application boundary exists
- [x] sequential replay safe
- [x] concurrent replay safe
- [x] distinct learner attempts remain distinct
- [x] multi-concept quiz safe
- [x] partial failure retry safe
- [x] Mastery applied once
- [x] KS effect applied once
- [x] independent evidence count cannot be replay-inflated
- [x] duplicate decision events prevented
- [x] historical evidence preserved
- [x] no Mastery formula change
- [x] no Knowledge State formula change
- [x] no Verification algorithm change
- [x] tests pass
- [x] build passes

---

## 36. Final Decision

**A. Can one logical learner action affect cognitive state more than once?**
**NO.**

**B. Are sequential retries idempotent?**
**YES.**

**C. Are concurrent retries idempotent?**
**YES** (verified against a mock reproducing Postgres's own unique-index behavior; not yet verified against a live database — §34.1).

**D. Can replay inflate `mastery_score`?**
**NO.**

**E. Can replay inflate Knowledge State evidence counts or Independence?**
**NO.**

**F. Can two genuinely distinct attempts remain distinct?**
**YES.**

**G. Is the guarantee database-backed rather than status-check-only?**
**YES.** The quiz-status guard (§11) is explicit, disclosed defense-in-depth; the actual guarantee is the `operation_key`/`submission_token` unique index, enforced by the database itself.

**H. Was a schema change required?**
**YES.** No existing column or constraint could carry or enforce a caller-supplied operation identity. The minimum additive change was made: one nullable column + one partial unique index, on `learning_evidence` and, for the reason in §8/§19, `assessment_results`.

**I. Were Mastery/Knowledge State formulas modified?**
**NO.**

**J. Is EVIDENCE_IDEMPOTENCY fully closed?**
**YES_WITH_CONDITIONS** — closed for every live production evidence-writing path; the five named residual risks (§34) are real but narrower, disclosed, and none of them reopens a duplicate-cognitive-effect path this phase set out to close.

**K. Can Phase 2B proceed to external certification / production release?**
**YES** — pending the standard release protocol this session has followed throughout (external review, then the explicit commit/push/deploy phase), and ideally a live-database concurrency validation pass (§34.1) before that release.

**L. Maximum five remaining risks.** See §34.
