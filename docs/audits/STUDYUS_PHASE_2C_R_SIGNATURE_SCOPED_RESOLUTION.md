# StudyUs Phase 2C-R — Signature-Scoped Misconception Resolution

## 1. Executive Summary

Phase 2C's own self-disclosed Remaining Risk #1 — "resolution is concept-wide, not per-signature" — was confirmed by external review to be a real, exploitable defect: `resolveActiveMisconceptionsForConcept` bulk-resolved **every** `ACTIVE` misconception signature on a concept whenever a single qualifying `EXPLANATION`/`SOLO_VERIFICATION` evidence event occurred, even when two or more signatures were simultaneously active and the evidence only genuinely addressed one. This created a false-positive `VALIDATED_MASTERY` path: a student could clear an unrelated critical misconception's gate by resolving a different one.

Phase 2C-R replaces that function with `resolveMisconceptionSignatures`, a primitive that transitions **only** the signature ids it is explicitly given, and wires a deterministic scope-decision policy into `mastery.service.ts::updateMastery`: an explicit scope wins when a caller supplies one (none currently do); otherwise the conservative fallback applies — the single `ACTIVE` signature on this concept resolves **only** when there is exactly one; two or more `ACTIVE` signatures with no explicit scope resolve **none** of them. Ambiguity is never guessed away.

No schema change was required — Phase 2C's lifecycle columns (`status`, `resolved_at`, `resolved_by_evidence_id`, `reactivation_count`) already carried everything this fix needs. `NEW_MIGRATIONS_DURING_2C_R = 0`. A second, smaller lifecycle-unawareness defect was found during the Step 1 fresh audit in `tutor-strategy.service.ts` (a raw query missing `status = 'ACTIVE'`) and fixed as a one-line, directly-related addition.

All 11 new required regression tests pass, the full suite (949/949) passes, `tsc` is clean, `npm run build` succeeds, and `npm run db:status` is unchanged (3 applied, 1 pending, 0 drifted — the same single Phase 2C migration, still not applied). No commit, no push, no deploy, no migration apply.

## 2. The External Review Finding (Verbatim Principle)

> "RESOLUTION IS CURRENTLY CONCEPT-WIDE RATHER THAN MISCONCEPTION-SIGNATURE-SCOPED. This must be remediated before Phase 2C can be deployed."
>
> "A MISCONCEPTION MAY ONLY BE RESOLVED BY EVIDENCE WHOSE SCOPE CAN BE ASSOCIATED WITH THAT SPECIFIC MISCONCEPTION SIGNATURE."

## 3. Root Cause Analysis

Phase 2C's `resolveActiveMisconceptionsForConcept(studentId, conceptId, evidenceId)` ran, in essence:

```sql
UPDATE student_misconceptions SET status = 'RESOLVED', ...
WHERE student_id = $1 AND concept_id = $2 AND status = 'ACTIVE'
```

This treats *concept identity* as sufficient *resolution identity*. It is not: a concept can host multiple, independently-acquired misconception signatures (e.g. `FORCE_ALONG_VELOCITY` and `NORMAL_FORCE_CONFUSION` on the same mechanics concept). One Explain & Defend response scoring 90% on Understanding is evidence the student correctly reasoned about *whatever that specific response addressed* — not proof every distinct misconception ever recorded on that concept has vanished. Phase 2C's own report already applied exactly this principle to reject ordinary quiz/Transfer evidence as a resolution signal (§20-23 of that report); it was simply never applied to the resolver's own `WHERE` clause.

## 4. Step 1 — Resolution-Signal Source Audit

Every candidate source of an explicit evidence→signature link was audited directly against the current codebase (not assumed):

| Source | Finding | Classification |
|---|---|---|
| Explain & Defend generation (`explain/generate/route.ts`) | Produces a free-form prompt/rubric for the concept; no signature id is selected or targeted before the student responds. | **NONE** |
| Explain & Defend evaluation (`explain/submit/route.ts`) | Classifies a signature **only** when the rubric flags `misconceptionDetected` — i.e. only on the *observation* path. When the response instead qualifies as *resolution* evidence (no misconception detected, high score), no classification runs and no signature id exists to attach. | **NONE** |
| Verification generation/persistence (`quizzes/verify/route.ts`, `quizzes/generate-and-take/route.ts`) | Grep-confirmed zero occurrences of `signatureId`/`misconception` in the verify route. `verification_attempts` schema carries no misconception-signature column (confirmed via baseline schema grep). | **NONE** |
| Remediation metadata (`remediation/*`) | Grep-confirmed zero occurrences of a signature-id field on remediation paths/steps. | **NONE** |
| `learning_evidence.metadata` (generic JSON) | Structurally capable of carrying a signature id, but no current writer populates one there for resolution purposes — using it now would mean fabricating a linkage no upstream generation step actually establishes. | **NONE (structurally AMBIGUOUS, not exploited)** |

**Conclusion:** no explicit, non-fabricated evidence→signature scope exists anywhere in the current system. The Step 5 conservative fallback (single-active-signature) is therefore the only currently-viable resolution mechanism beyond "resolve nothing" — confirmed by direct grep against `src/app/api/cognitive/explain/*`, `src/app/api/quizzes/verify/route.ts`, `src/app/api/cognitive/transfer/submit/route.ts`, and remediation routes/services, not merely asserted.

## 5. The New Resolution-Scope Rule

**Concept identity is not sufficient resolution identity.** No API may implement an unrestricted `WHERE student_id = ? AND concept_id = ? AND status = 'ACTIVE'` bulk resolution. Every resolution path must supply an explicit, bounded set of signature ids to `resolveMisconceptionSignatures` — either from genuine caller-supplied scope, or from the single-active fallback, or (default) from an empty set that resolves nothing.

## 6. The Signature-Scoped Resolution Primitive

[`misconception.service.ts`](../../src/services/misconception.service.ts) — `resolveActiveMisconceptionsForConcept` removed entirely; replaced with:

- **`getActiveMisconceptionSignatureIdsForConcept(studentId, conceptId, client)`** — the resolution-scope decision *input*: every currently-`ACTIVE` signature id for this (student, concept), one bounded query.
- **`resolveMisconceptionSignatures(studentId, conceptId, signatureIds, resolvedByEvidenceId, client)`** — the resolution *primitive*. Transitions only the given `signatureIds`; the SQL's own join/`WHERE` independently re-verifies each id belongs to `conceptId` and is currently `ACTIVE` — a foreign or stale id is silently excluded, never trusted. An empty `signatureIds` array is a pure no-op that issues **zero queries** (the ambiguous/ zero-active case never touches the database at all). Idempotent by construction: replaying after everything is already `RESOLVED` matches zero rows.

```sql
UPDATE student_misconceptions sm
SET status = 'RESOLVED', resolved_at = NOW(), resolved_by_evidence_id = $4
FROM misconception_signatures ms
WHERE sm.misconception_signature_id = ms.id
  AND sm.student_id = $1 AND ms.concept_id = $2 AND sm.status = 'ACTIVE'
  AND sm.misconception_signature_id = ANY($3::uuid[])
RETURNING sm.misconception_signature_id, ms.misconception_code, ms.is_critical
```

The signature-id list is a real, parameterized `uuid[]` array — never string-interpolated (verified by a dedicated test asserting `params[2]` equality, not just SQL-text shape).

This cleanly separates **policy** ("what evidence justifies resolving what," decided by the caller) from **mechanics** ("how a resolution safely applies," enforced unconditionally by the primitive's own SQL) — the same separation the rest of Phase 2B/2C already uses between algorithm code and DB-mechanics code.

## 7. The Explicit-Scope-Or-Fallback Decision Logic

Inside [`mastery.service.ts::updateMastery`](../../src/services/mastery.service.ts):

```ts
let scopeIds: string[];
if (input.resolvedMisconceptionSignatureIds && input.resolvedMisconceptionSignatureIds.length > 0) {
  scopeIds = input.resolvedMisconceptionSignatureIds;
} else {
  const activeSignatureIds = await getActiveMisconceptionSignatureIdsForConcept(studentId, conceptId, client);
  scopeIds = activeSignatureIds.length === 1 ? activeSignatureIds : [];
}
if (scopeIds.length > 0) {
  const resolved = await resolveMisconceptionSignatures(studentId, conceptId, scopeIds, learningEvidenceId, client);
  for (const r of resolved) {
    await recordDecisionEvent({ decisionType: 'MISCONCEPTION_RESOLVED', ... }, client);
  }
}
```

A new optional input field, `MasteryUpdateInput.resolvedMisconceptionSignatureIds?: string[]`, was added (additive, backward-compatible — every existing caller that omits it gets exactly the fallback behavior). The whole block runs inside the same transaction as the evidence insert and Knowledge State recalculation, unchanged from Phase 2B/2C's transactional boundary — no new idempotency mechanism was introduced; a transport replay of the triggering request is rejected by Phase 2B's own `operation_key` gate before this block is ever reached a second time.

`decision_events` rows are emitted **only** for signatures `resolveMisconceptionSignatures` actually returned as resolved — never for signatures that were merely in scope but already resolved, foreign, or excluded (test 9, §18).

## 8. Why Explain & Defend / Verification Were Not Retargeted

Step 6/7 asked whether Explain & Defend or Verification generation could be made misconception-targeted with a small additive change. The audit (§4) found the underlying reason no explicit link exists is structural: generation happens *before* the student responds, so the system does not yet know which misconception (if any) the response will or won't demonstrate resolving. Building a reliable, server-verifiable "this specific response targets signature X" capability would require a new activity-persistence architecture (e.g. binding a generated Explain prompt to a specific candidate signature at *generation* time, then verifying the response against that binding at *evaluation* time) — a material new capability, not a small plumbing change.

Per the task's explicit instruction, this was **not** built in 2C-R. The conservative single-active fallback is used instead, and this future targeted-activity capability is documented here as a candidate for a later phase, not implemented now.

## 9. Additional Finding: `tutor-strategy.service.ts` (Outside Literal Scope, Same Spirit)

The Step 1 fresh audit found `buildCompactTutorContext` running a raw misconception query with **no lifecycle filter at all**:

```sql
SELECT 1 FROM student_misconceptions sm JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
WHERE sm.student_id = $1 AND ms.concept_id = $2 AND sm.occurrence_count >= 2 LIMIT 1
```

feeding `hasRecurringMisconception` into tutor strategy selection. This predates Phase 2C's lifecycle work and was missed by Phase 2C's own consumer audit — a fully `RESOLVED` misconception could still bias tutor strategy selection. This is the exact lifecycle-unawareness pattern Phase 2C exists to close, just on a consumer outside the literal external-review finding. Fixed as a one-line, additive scope: `AND sm.status = 'ACTIVE'`. [`tutor-strategy.service.ts:107`](../../src/services/tutor-strategy.service.ts#L107).

A broader consumer sweep (`grep -rln "student_misconceptions" src/`) confirmed the only other consumers are `misconception.service.ts` itself and `learner-twin/readers.ts`, and the latter goes through the already-lifecycle-aware `getMisconceptionCountsForConcept` — no raw SQL, no further findings.

## 10. Consumer Audit — No Remaining Concept-Wide Resolution Path

`grep -rn "resolveActiveMisconceptionsForConcept" src/ tests/` returns zero code references (only a doc-comment note in the replacement function and the historical Phase 2C report, both expected and correct). `CONCEPT_WIDE_UNSCOPED_RESOLUTION_PATHS = 0`.

## 11. Anti-Circularity (Unchanged from Phase 2C)

`resolveMisconceptionSignatures`'s SQL touches only `student_misconceptions`/`misconception_signatures` — confirmed directly, by a dedicated test asserting the query text contains no reference to `mastery_state`/`concept_knowledge_state`/`validated_mastery`. Resolution is decided purely from the current evidence application's own `result`/`sourceType`/`aiAssistanceType`/`scorePercent` (via `isMisconceptionResolutionEvidence`, itself untouched) plus the scope decision above — never from any Knowledge State field.

## 12. Exactly-Once Contract Preservation

No new idempotency layer was introduced. Phase 2B's `operation_key` gate (the sole `INSERT INTO learning_evidence` call site, one atomic transaction) is reused verbatim: a transport replay of the triggering request is rejected before the resolution block is ever reached again, so a replayed resolving request cannot re-resolve, re-emit a `MISCONCEPTION_RESOLVED` event, or double-count anything (test 10, §18). `DUPLICATE_MISCONCEPTION_EFFECTS_ON_REPLAY = 0`.

## 13. Reactivation Semantics (Unchanged, Correctly Scoped)

`recordStudentMisconception` is untouched by 2C-R — it already operated on exactly one `signatureId` per call, so it was never subject to the concept-wide bulk-resolution defect. Test 11 (§18) confirms end-to-end that reactivating one signature while a second, unrelated signature is independently `ACTIVE` never touches the second signature's `status` or `reactivation_count`.

## 14. Decision Events

`MISCONCEPTION_RESOLVED` is emitted once per **actually-resolved** signature (inside the `for (const r of resolved)` loop over `resolveMisconceptionSignatures`'s own return value — never over the requested scope). `reasonDetails.misconceptionCode`/`isCritical` are read from that same per-signature result row, so an event for signature A can never carry signature B's code. Verified directly (test 9, §18) using the test harness's now-exposed `recordDecisionEventMock`.

## 15. Mastery Formula / Knowledge State Thresholds / Verification Algorithm — Zero Changes

`calculateMasteryDelta`'s signature is unchanged (`MASTERY_FORMULA_CHANGES = 0`, proven by the pre-existing arity assertion test). `determineMasteryState`/`determineValidationReadiness` and `REAL_POLICY`'s threshold values are untouched (`KNOWLEDGE_STATE_THRESHOLD_CHANGES = 0`). `src/lib/verification-triggers.ts` has zero diff against `HEAD` (`VERIFICATION_ALGORITHM_CHANGES = 0`) — confirmed by `git diff --stat`, empty output.

## 16. Migration Surface

`NEW_MIGRATIONS_DURING_2C_R = 0`. Phase 2C's existing migration (`database/migrations/20260903_1000_misconception_lifecycle.sql`) already carries every column this fix needs (`status`, `resolved_at`, `resolved_by_evidence_id`, `reactivation_count`). 2C-R is purely an application-logic scoping change (new `WHERE`/`ANY($3::uuid[])` clause plus caller-side decision logic) — no schema was touched, and none was needed.

## 17. Architecture Regression Counts

```
CANONICAL_MISCONCEPTION_CURRENT_STATE_MODEL         = 1
CONCEPT_WIDE_UNSCOPED_RESOLUTION_PATHS               = 0
MULTI_ACTIVE_SIGNATURES_RESOLVED_BY_UNSCOPED_EVIDENCE = 0
RESOLVED_CRITICAL_MISCONCEPTIONS_BLOCKING_VALIDATION = 0
ACTIVE_CRITICAL_MISCONCEPTIONS_BYPASSED_BY_VALIDATION = 0
DUPLICATE_MISCONCEPTION_EFFECTS_ON_REPLAY            = 0
MASTERY_FORMULA_CHANGES                              = 0
KNOWLEDGE_STATE_THRESHOLD_CHANGES                    = 0
VERIFICATION_ALGORITHM_CHANGES                       = 0
NEW_MIGRATIONS_DURING_2C_R                           = 0
```

## 18. Required Tests (Step 24 — All 14)

All in [`tests/unit/misconception-lifecycle.test.ts`](../../tests/unit/misconception-lifecycle.test.ts) unless noted.

| # | Scenario | Test |
|---|---|---|
| 1 | Two ACTIVE signatures + evidence explicitly scoped to A → only A resolves, B stays ACTIVE | "two ACTIVE signatures + evidence explicitly scoped to sig-A" |
| 2 | Two ACTIVE signatures + unscoped qualifying evidence → neither resolves, zero `MISCONCEPTION_RESOLVED` events | "two ACTIVE signatures + UNSCOPED qualifying evidence" |
| 3 | Explicit single-active-fallback, distinctly proven | "explicit single-active fallback, distinctly proven" |
| 4 | A signature ACTIVE on a different concept is excluded from the fallback and never resolves | "a signature ACTIVE on a DIFFERENT concept is excluded..." |
| 5 | Pure `determineMasteryState`: B alone (still ACTIVE/critical) continues blocking `VALIDATED_MASTERY` after A resolves | §B, "two independent signatures, A resolves but B stays ACTIVE/critical" |
| 6 | B resolves only once its own qualifying, explicitly-scoped evidence arrives (a second, separate call) | "B resolves only once its OWN qualifying evidence arrives" |
| 7 | Explicit multi-signature scope resolves both | "explicit multi-signature scope resolves BOTH" |
| 8 | `resolved_by_evidence_id` correct per-signature | "resolved_by_evidence_id is correct PER-SIGNATURE" |
| 9 | `MISCONCEPTION_RESOLVED` events emitted only for actually-resolved signatures | "decision events are emitted only for signatures ACTUALLY resolved" |
| 10 | Replay of a scoped resolution remains idempotent | "replay of a scoped resolution remains idempotent" |
| 11 | Reactivation with 2+ signatures present stays scoped to the reactivating signature only | "reactivation with 2+ ACTIVE/RESOLVED signatures present..." |
| 12 | Original Phase 2C false-negative-Mastery closure still passes with the new code path | Pre-existing "Step 33 (release-blocking)" describe block — re-run, still passing |
| 13 | All Phase 2B exactly-once tests still pass | `tests/unit/evidence-idempotency.test.ts` — re-run, 17/17 passing |
| 14 | All pre-existing Phase 2C lifecycle tests still pass | Full `misconception-lifecycle.test.ts` file — re-run, 47/47 passing |

11 new `it()` blocks were added (tests 1–4, 6–11 in the file, plus test 5 in the pure-classifier section); tests 12–14 are re-confirmations of already-existing coverage, not new tests.

## 19. Test Results

```
npx vitest run
 Test Files  85 passed (85)
      Tests  949 passed (949)
```

Baseline before 2C-R's additions: 938 (Phase 2C's own final count). 949 − 938 = 11, matching the 11 new tests added above exactly. `misconception-lifecycle.test.ts` alone: 47/47 passing (up from the file's pre-2C-R count).

## 20. Type Check

```
npx tsc --noEmit
```
Clean — zero errors.

## 21. Build

```
npm run build
```
Succeeds — full route manifest generated, no build errors.

## 22. Database Migration Status

```
npm run db:status
LEDGER = FOUND (schema_migrations)
Applied (3): ai_execution_and_decision_audit, evidence_idempotency, STUDYUS_BASELINE_2026_08
Pending (1): 20260903_1000_misconception_lifecycle
SUMMARY: 3 applied, 1 pending, 0 drifted.
```
Unchanged from before 2C-R. The Phase 2C migration remains pending, **not applied**, per the task's explicit instruction.

## 23. Production Baseline Confirmation

```
git rev-parse HEAD         = 19b325bc6425bd71139d2036e21463a0f3be6324
git rev-parse origin/main  = 19b325bc6425bd71139d2036e21463a0f3be6324
```
Identical — no commit, no push occurred during 2C-R.

## 24. Git Diff Scope

Files touched by 2C-R specifically (verified via `git diff --stat` against `HEAD`):

```
src/services/mastery.service.ts         | 148 ++++++++++++
src/services/misconception.service.ts   | 216 +++++++++++++++
src/services/tutor-strategy.service.ts  |   7 +-
tests/unit/evidence-idempotency.test.ts |  26 ++-
```
plus one new untracked file: `tests/unit/misconception-lifecycle.test.ts` (extended in place from Phase 2C's version with the §18 additions).

`src/lib/algorithms/mastery.ts`, `src/services/knowledge-state.service.ts`, `src/lib/verification-triggers.ts` — **zero diff**, confirmed by `git diff --stat` returning empty output for all three. No Mastery formula file, no Knowledge State threshold file, no Verification algorithm file, no second misconception table, no Decision Engine, and no Phase 2D file was touched.

(The broader working tree also carries pre-existing, uncommitted diffs from earlier phases in this session — e.g. `docs/architecture/phase-2-2-knowledge-validation.md`, `src/lib/learner-twin/*`, various `docs/audits/*` reports — none of which 2C-R created or modified; they predate this phase and are out of its scope.)

## 25. Non-Goals Confirmed Untouched

Per the task's explicit non-goals: the `ACTIVE`/`RESOLVED` lifecycle model itself, misconception identity (`student_id`, `misconception_signature_id`), `occurrence_count`/reactivation semantics, the Mastery formula, Knowledge State thresholds, the Verification algorithm, and evidence weights are all unchanged — confirmed structurally above (§15, §24) rather than merely asserted. No second misconception table was created. Phase 2D, Adaptive Teaching, and cognitive-progression work were not started.

## 26. Remaining Risks / Known Limitations

1. **No writer currently supplies explicit resolution scope.** The `resolvedMisconceptionSignatureIds` field exists and is fully wired, but every current caller (Explain & Defend, Verification) relies on the single-active fallback, because no generation-time architecture yet binds a response to a specific candidate signature (§8). When two or more signatures are simultaneously `ACTIVE` on one concept, resolution stalls until enough of them independently drop to one remaining `ACTIVE` signature, or until a future targeted-activity capability supplies explicit scope. This is the deliberate, documented cost of "evidence honesty over resolution rate."
2. **`tutor-strategy.service.ts`'s fix is a scope-narrowing, not a re-audit of tutor strategy quality** — it corrects the lifecycle bug found, but a full audit of `selectTutorStrategy`'s broader logic was out of scope for 2C-R.

## 27. Definition of Done

- [x] `resolveActiveMisconceptionsForConcept` removed; zero remaining code references.
- [x] Signature-scoped primitive (`resolveMisconceptionSignatures`) implemented, tested, and the sole resolution write path.
- [x] Explicit-scope-or-single-active-fallback decision logic implemented in `updateMastery`.
- [x] `tutor-strategy.service.ts` lifecycle-awareness fix applied and verified against its own tests.
- [x] All 14 Step 24 required tests present and passing (11 new, 3 re-confirmed).
- [x] Full suite passing: 949/949.
- [x] `tsc --noEmit` clean.
- [x] `npm run build` succeeds.
- [x] `npm run db:status`: 3 applied, 1 pending, 0 drifted — unchanged, migration not applied.
- [x] `HEAD` === `origin/main` === `19b325b` — no commit, no push.
- [x] Git diff scope matches Step 26 restrictions exactly; zero diff on the three explicitly protected files.
- [x] No Phase 2D work started.

## 28. Final Decision

**A. Is the external review finding remediated?** Yes — concept-wide bulk resolution is removed; every resolution path is signature-scoped.

**B. Is the fix minimal and non-overbuilt?** Yes — no new schema, no new idempotency system, no speculative targeted-activity architecture; the conservative fallback was used exactly where the audit showed no honest alternative exists.

**C. Does the fix preserve Phase 2B's exactly-once contract?** Yes — reuses the existing `operation_key` transaction gate verbatim; no second layer introduced.

**D. Does the fix preserve Phase 2C's false-negative-Mastery closure?** Yes — re-confirmed passing, unchanged.

**E. Is ambiguity ever silently resolved in the student's favor?** No — two or more `ACTIVE` signatures with no explicit scope resolve nothing; `UNKNOWN`/`AMBIGUOUS` remains `ACTIVE`.

**F. Were any non-goal systems touched?** No — Mastery formula, Knowledge State thresholds, Verification algorithm, and misconception identity are all confirmed byte-identical or logically unchanged.

**G. Is the migration surface expanded?** No — zero new migrations; the one Phase 2C migration remains pending and unapplied, exactly as instructed.

**H. Is the working tree safe (no commit/push/deploy)?** Yes — `HEAD`/`origin/main` unchanged at `19b325b`; verified directly.

**I. Are there residual risks worth flagging before any future phase?** Yes — §26: the single-active fallback is a real, accepted limitation until a future targeted-activity capability exists; this is documented, not hidden.

**J. Is Phase 2C-R ready to stand as a release-blocking fix, pending the team's own commit/deploy decision?** Yes, on the evidence above — no code path remaining that permits unscoped resolution, all required regression scenarios pass, and every explicit non-goal was left untouched.

**Per the task's explicit instructions: Phase 2D was not started. Nothing was committed, pushed, deployed, or applied to production.**
