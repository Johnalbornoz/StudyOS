# StudyUs Phase 4-R — Pending Verification Actionability Closure

- Prepared: 2026-09-03
- Base commit (production baseline, unchanged): `39d246e5b48897675b1fdeabbc1f465baa430fab`
- Working tree: **implementation + validation only, NOT released** — nothing committed, pushed, or deployed. No production migration applied (none was needed).
- Baseline: 89 test files / 1050 tests passing (Phase 4 local implementation). Final: **89 test files / 1072 tests passing** (+22 new tests, 0 new files added to the count that changes — the two Phase 4 test files were extended, not duplicated).

Scope: **Fix ONLY** the one release-blocking finding — `VERIFICATION_PENDING` must map to an executable, server-authoritative continuation of the *existing* pending verification. Phase 4A–4G not reopened; Phase 5 not begun.

---

## 1 — Fresh Pending-Verification Audit

Traced fresh from source (not from the Phase 4 report's assumptions):

- **`verification_attempts`** (unchanged schema): `id`, `quiz_session_id` (text), `student_id`, `concept_id`, `verification_question` (jsonb, the full question payload, already persisted), `outcome` (`CONFIRMED`/`CONTRADICTED`/`INCONCLUSIVE`/`NULL`), `created_at`, `resolved_at`, `variant_equivalence_confidence`. No uniqueness constraint on `(student_id, concept_id) WHERE outcome IS NULL` — see §4.
- **`getPendingVerificationAttempt(quizSessionId, conceptId, studentId)`** (`assessment-verification.service.ts`, unmodified): `SELECT ... WHERE quiz_session_id = $1 AND concept_id = $2 AND student_id = $3 AND outcome IS NULL ORDER BY created_at DESC LIMIT 1`. This is the **existing, certified, single source of truth** for "is there a genuinely resumable attempt right now" — reused verbatim by every new code path this remediation adds, never reimplemented.
- **`getAssessmentStateForConcept`/`AssessmentStateSummary`**: before this remediation, `hasPendingVerification` was a bare boolean, computed from `SELECT COUNT(*)::int AS n FROM verification_attempts WHERE student_id = $1 AND concept_id = $2 AND outcome IS NULL` — enough to know *that* something was pending, not enough to *act* on it.
- **`VERIFICATION_PENDING` signal creation** (`adaptive-learning-orchestrator.service.ts`, Phase 4): fired only on the boolean, carried **zero** identifying information.
- **`LearningSignal`/`LearningDecision`** (`adaptive-learning-policy.ts`): no field existed to carry a verification attempt's identity through to a decision.
- **`selectActivityType`**: `VERIFICATION_PENDING` had no branch at all — fell through to whatever a lower-precedence rule picked (confirmed by direct re-reading, not assumed).
- **`learning-execution-policy.ts`/`learning-execution-scheduler.service.ts`**: pure time-fitting and IO-loading only; neither references verification at all — correctly out of scope for this fix (confirmed unmodified, §16).
- **`learning-session-engine.service.ts`**: `SOLO_VERIFY`'s case was a documented placeholder — `quizLaunch('cumulative_assessment', decision)` — which would have **started an entirely new Cumulative Assessment quiz**, never resuming anything, and risking a **second** verification trigger cycle for the same concept.
- **Verification UI/API flow**: `verificationQuestion` was, before this remediation, shown to the client **only once**, inline, in the same response that triggered it (`generate-and-take`'s `verificationNeeded` array). There was no route to re-fetch a pending verification's question later — confirmed by grepping every caller of `getPendingVerificationAttempt`: exactly one, the POST handler in `verify/route.ts`, which requires the client to already possess `quizId`/`conceptId` from that one-time response. This is the real gap Findings 8/9 ask to be closed.

---

## 2 — Canonical Pending Verification Identity

Implemented exactly the preferred contract: `VERIFICATION_PENDING` signal → `verificationAttemptId` + `quizSessionId` + `conceptId` (already on the signal) → `SOLO_VERIFY` → resume the existing attempt. No new identifiers were invented — `verification_attempts.id` and `.quiz_session_id` are the only two needed, both already existed.

**Never trusted from the client**: the identity is read server-side, once, inside `loadLearningSignals` (from `getAssessmentStateForConcept`, itself reading directly from `verification_attempts`), carried through the pure policy untouched, and **re-verified again at launch time** (§8) via the same certified `getPendingVerificationAttempt` lookup, scoped by the server-known `studentId` — never by anything the client supplies.

---

## 3 — Assessment State Extension

`AssessmentStateSummary.pendingVerification: PendingVerificationLocator | null` added:

```ts
export interface PendingVerificationLocator {
  verificationAttemptId: string;
  quizSessionId: string;
  conceptId: string;
  createdAt: string;
}
```

**Zero new queries.** The existing `COUNT(*)` query (which only ever fed the boolean) was upgraded in place to `SELECT id, quiz_session_id, created_at FROM verification_attempts WHERE student_id = $1 AND concept_id = $2 AND outcome IS NULL ORDER BY created_at DESC LIMIT 1` — the exact same query slot, same parameters, same bound (`LIMIT 1`), now returning enough to act rather than just a count. `hasPendingVerification` is now derived from `rows.length > 0` (unchanged truth value). No second reader was created — this is the same, single `getAssessmentStateForConcept` function, extended.

Confirmed by a dedicated test (`assessment-verification.service.test.ts`): `getAssessmentStateForConcept` still issues exactly 5 queries after this extension. Also confirmed by re-measuring the full decision-computation path end-to-end: **24 total queries for 1 concept, identical to the count measured in Phase 4's own original certification** — no regression.

Does not expose the question payload or response history — a caller that needs the question fetches it itself, server-side, via the new GET route (§8), from this same `verificationAttemptId`.

---

## 4 — Multiple Pending Attempts

**Audited, not guessed.** No uniqueness constraint exists on `verification_attempts (student_id, concept_id) WHERE outcome IS NULL` — each row is independently scoped to its own `quiz_session_id`, so two different Assessment-mode attempts on different days can each legitimately leave their own unresolved verification for the same concept. **Multiple pending attempts CAN legitimately coexist.**

**Deterministic selection rule**: the single most recently *created* one — `ORDER BY created_at DESC LIMIT 1` — reusing the **exact same rule** `getPendingVerificationAttempt` already applies for its own quiz-session-scoped lookup (not invented for this remediation). Older/historical unresolved rows are never deleted, never silently resolved, never touched — they simply aren't the currently-actionable one. No migration was created to "clean this up" — none was needed or appropriate.

---

## 5 — Learning Signal Provenance

`LearningSignal` gained two new first-class optional fields (matching the existing `remediationPathId`/`diagnosisId`/`occurrenceId` provenance convention, not buried in `metadata`):

```ts
verificationAttemptId?: string;
quizSessionId?: string;
```

`ConceptDecisionContext` gained matching `verificationAttemptIds: string[]` / `quizSessionIds: string[]` collections (same array-of-provenance convention as `remediationPathIds` etc.), and `LearningDecision` gained singular `verificationAttemptId?`/`quizSessionId?` fields, populated exactly like `remediationPathId: context.remediationPathIds[0]`. The orchestrator's signal-creation site now populates both directly from `assessmentState.pendingVerification` — never a boolean-only signal.

---

## 6 — Decision Policy

`selectActivityType` gained an explicit `if (types.has('VERIFICATION_PENDING')) return 'SOLO_VERIFY';` branch, positioned at the same precedence tier `computeLearningState` already gives `PENDING_VERIFICATION` (after misconception/prerequisite/repair, ahead of retention/transfer/independence) — no reordering of the existing hard-blocker precedence. `selectTargetDimension` maps `SOLO_VERIFY → 'VALIDATION'` (a "confirm/close the loop on evidence we already have" concern, the same category as `INTERVENION_REQUIRED`/`CALIBRATION_CONFLICT`, distinct from `SOLO_CHECK`'s `'INDEPENDENCE'`).

**No new ActivityType invented.** `SOLO_VERIFY` already existed in the taxonomy (audited first, per the task's explicit instruction) — it was simply never *selected* by the policy before. Confirmed: `RESUME_VERIFICATION`/`VERIFY_PENDING`/any other alias — zero occurrences anywhere in the diff.

Target concept: `decision.actionConceptId` (already the concept the `VERIFICATION_PENDING` signal points at — the concept the pending attempt itself belongs to, never a different one).

---

## 7 — Priority Semantics

**Global band ordering not reopened.** `VERIFICATION_PENDING`'s own band (35, set in Phase 4, unchanged) still sits below `ACTIVE_ESCALATION`(90)/`PREREQUISITE_GAP`(80) — a critical misconception or active remediation still correctly outranks a pending verification and selects its own `ActivityType` instead (`PRACTICE`/`REMEDIATION`, never `SOLO_VERIFY`), verified by two dedicated regression tests (§15 items 14–15). This remediation only changed what happens **once `VERIFICATION_PENDING` is already the dominant/selected signal** — from "falls through to something else" to "correctly selects `SOLO_VERIFY`."

---

## 8 — Execution Layer

Freshly audited `learning-session-engine.service.ts` (the one file this remediation is explicitly authorized to change). New `verificationLaunch` function, wired into the existing `SOLO_VERIFY` switch case (replacing the old placeholder), implementing exactly the 6 required steps:

1. **Learner ownership** — reuses the existing, unmodified `verifyConceptOwnership` universal gate (unchanged, runs before the switch).
2. **Attempt still unresolved** — re-reads via `getPendingVerificationAttempt(decision.quizSessionId, decision.actionConceptId, studentId)` at **launch time**, not trusting the decision's own (possibly stale) snapshot.
3. **Concept/session consistency** — the same call is scoped by all three identifiers; additionally, the re-read row's own `id` is compared against `decision.verificationAttemptId` — a mismatch (a *different*, newer pending attempt now exists for the same triple) fails closed rather than resuming the wrong one.
4. **Resume the existing attempt** — returns a `READY` launch pointing at `/dashboard/quiz` with `subjectId`, `conceptId`, `quizId` (the *existing* `quiz_session_id`), and `verifyAttemptId` (the confirmed-current attempt id).
5. **Never creates another verification attempt** — `verificationLaunch` issues only `SELECT` queries (the ownership check + `getPendingVerificationAttempt`); confirmed by a dedicated test asserting no query matching `/^INSERT/i` is ever issued.
6. **Fails safely if already resolved** — if `getPendingVerificationAttempt` returns `null` (its own `outcome IS NULL` filter no longer matches), `verificationLaunch` returns `UNAVAILABLE` with a clear reason — never a fabricated `READY`.

**No suitable existing resumable UI route existed** (confirmed in §1), so the smallest continuation path was implemented, confined to the minimum necessary:

- **New `GET /api/quizzes/verify`** (added to the *same* existing route file, not a new file): takes `studentId`/`quizId`/`conceptId`, reuses `verifyStudentAccess`, `getQuizSession`, and `getPendingVerificationAttempt` **verbatim** (all pre-existing, unmodified), returns `{ pending: { verificationAttemptId, conceptId, question } }` or `{ pending: null }` (never an error) when nothing is currently pending. No new assessment semantics — purely a read of already-computed, already-persisted state. The POST handler is **byte-for-byte unmodified** (confirmed: `git diff` shows zero lines removed from it — the GET handler is purely appended).
- **Quiz page (`/dashboard/quiz/page.tsx`) — smallest possible addition**: a new, entirely self-contained branch gated on a `verifyAttemptId` URL parameter, checked *before* the existing setup/loading/quiz/results phase machine. It never enters that machine at all (no `generate-and-take` call, no new `quiz_sessions` row). It fetches the new GET route, and reuses the **existing** `MathText`/`VisualAidView`/`MathAnswerEditor` components (the same ones the original inline verification block already used) to render the question and submit the answer through the **unmodified** POST pipeline. This is additive, isolated code — the existing quiz-taking flow's own rendering logic was not touched, reorganized, or reused/coerced into a new shape. One new i18n key pair (`quiz.verificationNotPending`, added in all 5 locales) covers the honest "not pending anymore" state (Finding 9) — copy only, no new logic.

---

## 9 — Stale Decision Safety

Directly implements the required scenario: T0 (decision computed, `VERIFICATION_PENDING`) → T1 (resolved elsewhere) → T2 (student clicks the old decision). At T2, `verificationLaunch`'s re-read of `getPendingVerificationAttempt` correctly returns `null` (the row's `outcome` is no longer `NULL`), so `startLearningSession` returns `UNAVAILABLE` — no duplicate verification, no new pending attempt, no cognitive mutation. Verified by a dedicated test. The GET continuation route independently provides the same safety at the UI layer (`{pending: null}`, rendered as the honest "not pending anymore" state) for the case where the student had already reached the resume page before T1.

---

## 10 — Exactly-Once

**All Phase 2B/Phase 3 contracts preserved, not replaced.** The resolved verification-answer submission still goes through the **exact same, unmodified** `POST /api/quizzes/verify` → `resolveVerificationAttempt` (its own atomic `WHERE outcome IS NULL` claim, untouched) → `submitQualifiedAssessmentEvidence` → `updateMastery` (its own `operation_key` idempotency, untouched) pipeline. This remediation adds **no second write path** — `verificationLaunch` and the new GET route are both 100% read-only (confirmed by dedicated tests asserting zero `INSERT` queries from either). A double-click on the "Verify" action re-runs `startLearningSession` twice; both calls independently re-verify against the same live `verification_attempts` row and produce the identical `READY` launch — confirmed by a dedicated double-launch test (§15 item 8).

---

## 11 — Same-Question Safety

**Not regressed.** `verificationLaunch` never reads or writes `verification_question`/`variant_equivalence_confidence` — it only checks `id` for a match. The question payload returned by the new GET route is `pending.verificationQuestion`, read **verbatim** from the already-persisted row via the unmodified `getPendingVerificationAttempt` — never regenerated, never re-derived. The freshness/`wasFreshQuestion` logic inside `POST /api/quizzes/verify` is byte-for-byte unchanged (confirmed via `git diff`: zero lines removed from that handler). A resumed attempt answers the exact same question it always would have.

---

## 12 — Insufficient Independent Evidence — Distinctness Audit

Confirmed unchanged in semantics, and now explicitly regression-tested side-by-side (not just asserted separately, as Phase 4 originally left it): the same `ConceptKnowledgeState` fed two different signals produces two genuinely different `(learningState, activityType, targetDimension)` triples —

| | `VERIFICATION_PENDING` | `INSUFFICIENT_INDEPENDENT_EVIDENCE` |
|---|---|---|
| Meaning | Complete an **already-created** verification requirement | Obtain **initial** independent evidence |
| `learningState` | `PENDING_VERIFICATION` | `INSUFFICIENT_INDEPENDENT_EVIDENCE` |
| `activityType` | `SOLO_VERIFY` | `SOLO_CHECK` |
| `targetDimension` | `VALIDATION` | `INDEPENDENCE` |

A third test confirms that when both signals are present on the same concept simultaneously, `VERIFICATION_PENDING`'s higher precedence tier correctly wins the `activityType` selection, while both signals remain visible in the decision's `signals` evidence trail (neither is silently dropped).

---

## 13 — Query Cost

**`NEW_ASSESSMENT_QUERIES_PER_CONCEPT = 0`** for the decision-computation step — achieved exactly as the task's own target anticipated: the pending-attempt identity is returned from the *existing* bounded query (§3), not a new one. Directly re-measured: the full decision-computation path still issues exactly **24 total queries for 1 concept**, identical to Phase 4's own original measurement.

One additional bounded query (`getPendingVerificationAttempt`, itself an existing, certified, single-row `LIMIT 1` lookup) is genuinely necessary and was added — but only at **execution/launch time** (`startLearningSession`), when `SOLO_VERIFY` is actually being resumed, never during the per-concept decision-computation scan. This is a different cost class entirely: it happens once, only when a student actually acts on the recommendation, not once per concept per decision-list computation. No unbounded history, no per-question N+1, no full verification history read anywhere in this remediation.

---

## 14 — No Migration Expected

**`NEW_MIGRATIONS_PHASE_4_R = 0`.** No schema change was needed — every identifier this remediation exposes (`verification_attempts.id`, `.quiz_session_id`, `.created_at`) already existed. `npm run db:status`: unchanged, 6 applied / 0 pending / 0 drifted, confirmed before and after.

---

## 15 — Release-Blocking Tests

All 18 required items covered, all passing:

| # | Requirement | Where |
|---|---|---|
| 1 | pending verification → `LearningState PENDING_VERIFICATION` | `phase-4-learning-state-decision-policy.test.ts` |
| 2 | primary signal → `activityType SOLO_VERIFY` | same file |
| 3 | `reasonCode = VERIFICATION_PENDING` | same file |
| 4 | decision carries exact existing `verificationAttemptId` | same file |
| 5 | decision carries `quizSessionId` | same file |
| 6 | starting decision resumes the existing attempt | `learning-session-engine.test.ts` |
| 7 | zero new `verification_attempts` on resume | same file (no `INSERT` assertion) |
| 8 | double launch → zero duplicate attempts | same file (new double-launch test) |
| 9 | already-resolved attempt at launch → fails safely | same file |
| 10 | foreign learner blocked | same file |
| 11 | `VERIFICATION_PENDING`/`INSUFFICIENT_INDEPENDENT_EVIDENCE` remain distinct | `phase-4-learning-state-decision-policy.test.ts` (side-by-side test) |
| 12 | fresh variant semantics preserved | preserved structurally — POST handler byte-identical (§11); existing Phase 3-R tests re-run passing |
| 13 | same-question fallback cognitive-evidence block preserved | same as above |
| 14 | active remediation still outranks `VERIFICATION_PENDING` | `phase-4-learning-state-decision-policy.test.ts` (new precedence test) |
| 15 | critical misconception still outranks `VERIFICATION_PENDING` | same file (new precedence test) |
| 16 | `policyVersion` audited and decided | bumped 2 → 3 (genuine `selectActivityType` mapping change for an *existing* signal, not merely an addition) — audited explicitly, not silently left at 2; test confirms the value and that every decision carries it |
| 17 | deterministic same input → same decision | existing Phase 4 determinism tests re-run passing (no randomness added) |
| 18 | no query-cost regression | §13, re-measured 24/24 |

Full regression: **1072/1072 passing**, 89 files.

---

## 16 — Protected Systems

Confirmed byte-identical via `git diff --quiet HEAD`, both before and after this remediation: `src/lib/algorithms/mastery.ts`, `src/services/knowledge-state.service.ts`, `src/lib/verification-triggers.ts`, `src/services/misconception.service.ts`, `src/services/remediation.service.ts`, `src/services/validation-cycle.service.ts`, `src/services/assessment-verification.service.ts`'s **verification/evidence functions** (`recalculateConfidenceAfterVerification`, `submitQualifiedAssessmentEvidence`, `getPendingVerificationAttempt`, `resolveVerificationAttempt` — the diff is confined entirely to `AssessmentStateSummary`'s interface and `getAssessmentStateForConcept`'s pending-query section, confirmed via `git diff`'s hunk headers), `next-best-action-v3.service.ts`, `learning-execution-policy.ts`, `learning-execution-scheduler.service.ts`.

The one execution-layer file explicitly authorized — `learning-session-engine.service.ts` — was changed minimally and specifically for `SOLO_VERIFY` (`verificationLaunch` + the one switch-case line); every other `ActivityType` case (`PRACTICE`, `REVIEW`, `SOLO_CHECK`, `DIAGNOSTIC_CHECK`, `CUMULATIVE_ASSESSMENT`, `MOCK_EXAM`, `REMEDIATION`, `TRANSFER`) confirmed unmodified by the full existing test suite for that file passing unchanged.

---

## 17 — Validation

```
npx tsc --noEmit    -> clean
npx vitest run      -> 89 test files, 1072 tests, all passing
npm run build       -> clean, all routes compile (including the new GET handler)
npm run db:status   -> 6 applied, 0 pending, 0 drifted (unchanged)
```

No new SQL, schema, or transaction behavior was introduced — every change is either a read-only query upgrade (§3), a read-only execution-layer check (§8), or additive pure-policy/UI code. Per the task's own instruction, no separate disposable-PostgreSQL validation phase was required or performed.

---

## Final Status

| Field | Value |
|---|---|
| PENDING_VERIFICATION_STATE | CERTIFIED |
| PENDING_VERIFICATION_ACTION | SOLO_VERIFY |
| PENDING_VERIFICATION_EXACT_ATTEMPT_IDENTITY | VERIFIED |
| PENDING_VERIFICATION_RESUME_PATH | VERIFIED |
| NEW_VERIFICATION_ATTEMPTS_ON_RESUME | 0 |
| DUPLICATE_VERIFICATION_ATTEMPTS_ON_DOUBLE_LAUNCH | 0 |
| STALE_RESOLVED_ATTEMPT_LAUNCH | SAFE |
| FOREIGN_ATTEMPT_ACCESS | BLOCKED |
| INSUFFICIENT_INDEPENDENT_EVIDENCE_ACTION | SOLO_CHECK |
| SAME_QUESTION_SAFETY | PRESERVED |
| QUERY_COST | BOUNDED |
| NEW_MIGRATIONS_PHASE_4_R | 0 |
| FULL_TEST_COUNT | 1072 |
| PHASE_4_RELEASE_BLOCKER_CLOSED | YES |
| READY_FOR_PHASE_4_PRODUCTION_RELEASE | YES |
| READY_FOR_PHASE_5 | YES |

**This remediation closes the single release-blocking finding — `VERIFICATION_PENDING` now maps to `SOLO_VERIFY`, an executable, server-authoritative, exactly-once-safe continuation of the exact existing pending verification attempt, reusing the pre-existing `SOLO_VERIFY` ActivityType and every certified read/write pipeline verbatim.** Phase 4A–4G were not reopened; global priority-band ordering, protected systems, and Phase 3/3-R's exactly-once and same-question contracts were all confirmed unchanged, not merely assumed.

Per this remediation's explicit closing instruction: **not committed, not pushed, not deployed, no production migration applied, Phase 5 not begun.**
