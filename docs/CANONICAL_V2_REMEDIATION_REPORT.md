# STUDYUS — CANONICAL POLICY V2 — FULL REMEDIATION + CERTIFICATION

**Branch:** `tmp/lx1`. Production and `main` untouched, unpushed. No migration applied. Canonical engine v1 remains hard-disabled in Production (unchanged, verified below).

## 1. EXECUTIVE SUMMARY

All four BLOCKER findings from the prior audit (AUDIT-001 through AUDIT-004) are **closed**, with real, passing, unmocked tests proving the corrected behavior against the frozen policy's own worked examples. AUDIT-005 (per-attempt misconception wiring) and AUDIT-006 (UI canonical authority) are also **closed**. Two additional investigations (Section 9: same-request evidence visibility; Section 10: Practice difficulty consistency) found the underlying mechanisms **already correct** by source analysis — no defect could be reproduced, and permanent regression-guard tests were added for both. One **newly-discovered defect** (a `REINFORCE` intervention could silently substitute a 2–3 item Practice-shaped contract for a real PROVE/RETAIN/TRANSFER contract) was found and fixed during remediation, per this task's own "fix it if unambiguously required by policy" instruction.

**One gate is not fully closed**, and per this task's own explicit rule ("If ANY of these conditions fail: FINAL VERDICT = FAIL"), that yields:

## FINAL CERTIFICATION VERDICT: **FAIL**

The remaining gap is narrow and precisely scoped: **"real Transfer evidence executable end-to-end"** (Section 5 / delivery gate) has been closed at the **adapter + engine level** (a real, depth-tagged, fail-closed data contract now exists and is fully tested with real function calls), but **not** via a live canonical Transfer generation/session/submission UI pipeline — because no such pipeline exists anywhere in this codebase today (canonical Transfer generation is explicitly `NOT_READY` per `activity-launch-readiness.ts`'s own pre-existing design, the same status Retention shared before CANON-R6 built it out). Building that pipeline is a multi-week-scale feature comparable in size to all of CANON-R6's Prove work combined, was not scoped by this task's own text ("Add persistence fields / metadata / adapter mapping **as required**" — not "build a new generation/session/execution feature"), and doing so unreviewed would be exactly the kind of unscoped invention Section 18 forbids ("DO NOT invent the rule"). This is presented as the flagged ambiguity per Section 18, not resolved unilaterally — see Section 5 below for the exact question and both interpretations.

Every other mandatory delivery-gate condition is met: 0 BLOCKER findings remain, AUDIT-001–006 are all closed, the full test suite (265 files / 4748 tests) is green, TypeScript is clean, the production build is clean, zero tests are skipped, and no previously-red audit test was weakened — each was fixed by correcting the implementation, exactly as required.

## 2. EXACT PRODUCTION FILES CHANGED

| File | Change |
|---|---|
| `src/lib/pedagogical-engine/types.ts` | Renamed `transferFoundationalFailureIndicated: boolean` → `transferFailureDiagnostic?: TransferFailureDiagnostic` (new 3-value enum); renamed `RollbackCase` members to match Policy V2's own A/B/C/D lettering exactly, adding the new `TRANSFER_CASE_B_RETENTION_WEAKNESS`. |
| `src/lib/pedagogical-engine/engine.ts` | Core remediation: PRACTICE 2-of-3 window with rollback-triggered reset (AUDIT-001); RETAIN two-strike counter (AUDIT-002); TRANSFER 4-way classification incl. new Case B (AUDIT-003); corrected `intervention`/contract-shape decoupling (discovered-defect fix). |
| `src/lib/pedagogical-engine/index.ts` | Exports the new `TransferFailureDiagnostic` type. |
| `src/lib/pedagogical-migration/legacy-recognition.ts` | AUDIT-004: removed the PRACTICE/PROVE/RETAIN/TRANSFER cascading recognition ladder at its source — returns at most a single LEARN recognition. |
| `src/lib/pedagogical-migration/recognition-persistence-adapter.ts` | AUDIT-004 defense-in-depth: `applyRecognitions` now rejects (and logs) any non-LEARN recognition from any caller, independent of the source-level fix. |
| `src/lib/pedagogical-migration/new-evidence-capture-contract.ts` | Renamed the Transfer diagnostic field to match the engine's new type. |
| `src/lib/pedagogical-shadow/types.ts` | AUDIT-005/Section 5: added `StudyUSTransferChallengeScore`, replaced the unusable `perChallengeScores?: number[]` placeholder with a real depth-tagged `transferChallenges?` field; renamed the diagnostic field. |
| `src/lib/pedagogical-shadow/evidence-adapter.ts` | Real, fail-closed mapping from depth-tagged `transferChallenges` into the engine's ordered `[NEAR, CONTEXTUAL, HIGHER]` triple; renamed diagnostic field mapping. |
| `src/lib/pedagogical-shadow/evidence-fetch.ts` | AUDIT-005: added the real `has_item_critical_misconception` SQL join (against `student_misconceptions.evidence`'s existing `observedByEvidenceId` link, already written by `mastery.service.ts`); added `transferChallenges`/`transferFailureDiagnostic` column selection. |
| `src/services/progress-overview.service.ts` | AUDIT-006: added the One-Authority-Rule canonical-engine override to the Progress page's per-concept rows, matching ConceptMission/Today's existing pattern. |
| `src/lib/pedagogical-decision/concept-mission-override.ts` | Updated one `RollbackCase` string literal to the new naming. |
| `scripts/canon-r4r1-pre-v1-learn-baseline.ts` | Reports `rejectedHigherStage` from the new defense-in-depth guard; documents `higherLegacyCounts` as a permanent regression sentinel. |

No other production file was touched. No migration was created or applied. No routing, generation, or session-launch file for TRANSFER was created (see Section 5).

## 3. EXACT POLICY BEHAVIOR IMPLEMENTED

- **PRACTICE**: satisfied only when ≥2 of the last 3 structurally-valid attempts (right activity type, right prerequisite, right difficulty range, no blocking misconception) score ≥80%. The window resets to empty the instant a rollback lands back on PRACTICE (a genuine Prove failure, or a Transfer Case C/D rollback) — prior attempts remain in immutable History but occupy no window slot for the new cycle.
- **RETAIN**: a first Retention failure in a cycle leaves PROVE/RETAIN untouched and RETAIN immediately re-attemptable, no wait. Only a second **consecutive** failure in the same cycle (since the last qualifying Prove) rolls back to PROVE. A new qualifying Prove resets the strike counter to zero.
- **TRANSFER**: overall = simple arithmetic mean of the 3 challenge scores (frozen decision — the policy's own "85/80/80/75" example is internally inconsistent and is documented, not silently reinterpreted). Four classifications, driven by an explicit `transferFailureDiagnostic` signal (plus the pre-existing `hasCriticalMisconception` for Case D), never inferred from score: Case A (stay TRANSFER, immediate retry), Case B (rollback to RETAIN only, immediate retry, no new wait, PROVE untouched — **newly implemented**), Case C (rollback to PRACTICE, window reset), Case D (rollback to PRACTICE, window reset).
- **Legacy migration**: recognizes LEARN only, ever — enforced at both the computation source and the persistence boundary.
- **Per-attempt misconception**: wired to the real `observedByEvidenceId` link `mastery.service.ts` already writes; the historical, immutable per-attempt fact is now genuinely queryable and consumed by the engine's existing (previously dead) `hasCriticalMisconception` per-item gate.
- **UI authority**: the Progress page now follows the same One-Authority-Rule override as ConceptMission and Today.

## 4. AUDIT FINDINGS — BEFORE / ROOT CAUSE / FIX / TEST / RESULT

### AUDIT-001 — PRACTICE consistency window
- **Before:** a single qualifying attempt satisfied PRACTICE.
- **Root cause:** the engine had no window/counter of any kind — `practiceSatisfied` was set `true` on the first qualifying item and never revisited.
- **Fix:** `src/lib/pedagogical-engine/engine.ts` — a `practiceWindow: boolean[]` accumulator (window-eligible = structurally valid regardless of score; pass = score ≥80), satisfied the first time the last-3 slice contains ≥2 passes, sticky thereafter; reset to `[]` on any rollback to PRACTICE.
- **Test:** `tests/unit/audit-canon-v2-practice-consistency.test.ts` (19 tests, including the policy's own verbatim `[100,40,40] → UNSATISFIED` example and the window-reset proof).
- **Result:** CLOSED. All tests pass.

### AUDIT-002 — RETAIN two-strike rule
- **Before:** any single Retention failure rolled back to PROVE.
- **Root cause:** no per-cycle strike counter existed.
- **Fix:** `engine.ts` — `retainStrikeCount`, incremented on each `FAILED_ATTEMPT`, only triggering the PROVE rollback at ≥2; reset to 0 on any new qualifying Prove or qualifying Retain.
- **Test:** `tests/unit/audit-canon-v2-retain-two-strike.test.ts` (13 tests, including the exact 2-strike sequence and stale-cycle-contamination guard).
- **Result:** CLOSED.

### AUDIT-003 — TRANSFER 4-way classification
- **Before:** only 3 buckets existed, with a letter mismatch against policy (the engine's own "B" meant policy's "C"); no case rolled back to RETAIN at all.
- **Root cause:** CANON-R2R1's original 3-way diagnosis predates Policy V2's 4-way requirement.
- **Fix:** `types.ts` (`TransferFailureDiagnostic` enum, relettered `RollbackCase`), `engine.ts` (new Case B branch: rollback to RETAIN only, no window/strike reset, no wait — since `proveQualifyingAt` is untouched and already in the past by the time Transfer is reachable).
- **Test:** `tests/unit/audit-canon-v2-transfer-classification.test.ts` (11 tests, including the same `[40,40,40]` score pattern producing 3 different rollback targets purely from the diagnostic signal).
- **Result:** CLOSED.

### AUDIT-004 — Legacy migration fabrication
- **Before:** `evaluateLegacyRecognition` granted PROVE/RETAIN/TRANSFER from old mastery scores alone; the one real CLI applied all of it unfiltered.
- **Root cause:** the higher-stage cascading ladder was never removed after CANON-R4R1's later, narrower LEARN-only baseline decision superseded it in spirit but not in code.
- **Fix (defense in depth):** `legacy-recognition.ts` returns at most one LEARN recognition, full stop; `recognition-persistence-adapter.ts`'s `applyRecognitions` independently rejects (and logs `legacy_recognition_higher_stage_rejected`) any non-LEARN recognition regardless of source.
- **Test:** `tests/unit/audit-canon-v2-legacy-fabrication.test.ts` (7 tests, including a direct proof that a maximally-strong legacy record still yields only LEARN, and that the defense-in-depth guard independently blocks a hand-crafted PROVE recognition).
- **Result:** CLOSED. **11 pre-existing tests** across 3 other files (`canon-r4-legacy-compatibility.test.ts`, `canon-r4r1-pre-v1-learn-baseline.test.ts`, `canon-r4r1a-preexisting-concept-population-fix.test.ts`) that documented the OLD cascading behavior were updated to assert the corrected, policy-compliant behavior instead — not weakened, corrected.

### AUDIT-005 — Per-attempt critical misconception
- **Before:** `fetchStudyUSEvidenceRows` never selected a source column; the per-item flag always defaulted to `false`.
- **Root cause:** documented, deliberate deferral (`new-evidence-capture-contract.ts` explicitly flagged this as future work) — but the REAL write-side link already existed and was already exercised (`mastery.service.ts` already threads `learningEvidenceId` into `recordStudentMisconception` as `observedByEvidenceId`, persisted inside `student_misconceptions.evidence`).
- **Fix:** `evidence-fetch.ts` adds an `EXISTS` join against `student_misconceptions`/`misconception_signatures`, matching `sm.evidence @> jsonb_build_array(jsonb_build_object('observedByEvidenceId', le.id::text))` for `is_critical = true` signatures — deliberately NOT filtered by current `status`, since this is an immutable historical fact, distinct from the GLOBAL current-state flag.
- **Test:** `tests/unit/audit-canon-v2-learn-prove-misconception.test.ts` (AUDIT-005 block, 5 tests, including an end-to-end adapter-to-engine proof).
- **Result:** CLOSED.

### AUDIT-006 — UI canonical authority
- **Before:** `canonical-learning-progress.ts`'s consumers were untraced.
- **Root cause:** `progress-overview.service.ts` (the Progress page) never applied the One-Authority-Rule override that ConceptMission and Today both already had.
- **Fix:** added the identical override pattern, per-concept, gated on `isCanonicalEngineV1Enabled()`, degrading safely to the legacy view on any read failure.
- **Test:** `tests/unit/audit-canon-v2-ui-authority-closure.test.ts` (6 tests).
- **Result:** CLOSED. `old-canonical-snapshot.ts` (the shadow-comparison harness's own "old system" side) was confirmed to be intentionally, explicitly legacy-only and left unchanged.

### Discovered defect (not in the original audit) — REINFORCE contract-shape leakage
- **Before:** `engine.ts` set `intervention = 'REINFORCE'` for ANY active rollback, which forced `buildActivityContract` to substitute its 2–3 item, Practice-shaped contract even when the real stage was PROVE, RETAIN, or TRANSFER — e.g. a Transfer Case A retry ("stay TRANSFER, immediate retry") would have been served a 2-3 item Practice drill instead of the real 3-challenge Transfer contract.
- **Root cause:** `intervention` conflated "an overlay/observability flag" with "which contract shape to build."
- **Fix:** decoupled the two — `intervention` (reported on the decision, for observability — unchanged, already-certified value) is now separate from `applyReinforceShape` (used only to decide contract shape, `true` only when `stage === 'PRACTICE'`). `buildActivityContract.ts` itself is untouched; only `engine.ts`'s own use of it changed.
- **Test:** `tests/unit/audit-canon-v2-transfer-classification.test.ts`'s "gets the REAL 3-challenge Transfer contract" test, plus `tests/unit/audit-canon-v2-retain-two-strike.test.ts`'s "gets the real 10-item independent Retain contract" test; `canon-r2-pedagogical-engine.test.ts` test 55 updated to document the fix location without weakening its own (still-true) pure-function assertion.
- **Result:** FIXED, per this task's own "fix it if unambiguously required by the frozen policy" instruction (Policy V2's PROVE/RETAIN/TRANSFER contracts are explicit and exact; no rollback state changes them).

## 5. FLAGGED AMBIGUITY — REAL TRANSFER EVIDENCE PIPELINE SCOPE

**Exact question:** does "TRANSFER must become genuinely E2E-testable" / "real Transfer evidence is executable end-to-end" (Section 5 / delivery gate) mean:

- **(a)** the adapter and engine must be able to correctly consume real, well-formed per-challenge Transfer data the moment some future write path produces it (fail-closed otherwise) — i.e. close the gap at the data-contract layer, or
- **(b)** a live canonical Transfer generation/session-launch/submission UI pipeline (a new `canonical_transfer` quiz mode, mirroring everything CANON-R6 built for canonical Prove: generation, session authorization, submission, Results wiring) must be built and shipped in this same remediation.

**Affected code:** `src/lib/pedagogical-shadow/{types.ts, evidence-adapter.ts, evidence-fetch.ts}` (interpretation (a), built this phase); `src/lib/pedagogical-decision/canonical-session-launch.ts`'s own `resolveV1ActivityLaunchReadiness` (still reports TRANSFER as `NOT_READY`, unchanged — interpretation (b), not built).

**What was built (interpretation (a)):** a real, versioned, depth-tagged `StudyUSTransferChallengeScore` schema; a real SQL read path selecting it; real, fail-closed adapter logic that orders it into the engine's `[NEAR, CONTEXTUAL, HIGHER]` triple or rejects it outright (never a partial/best-effort mapping) — all genuinely exercised by real, unmocked function calls against constructed fixtures representing what a future real write would look like.

**What was NOT built (interpretation (b)):** any generation prompt, session-launch wiring, submission route, or Results UI for a `canonical_transfer` mode. `resolveV1ActivityLaunchReadiness` still returns `NOT_READY` for TRANSFER, exactly as it did before this phase — consistent with, not a regression of, the pre-existing design (Retention had this same status before its own separately-reviewed CANON-R6 phase built it out).

**Consequence of each option:** (a) is what this phase delivered — a real, tested, closed data-contract gap, achievable within this remediation's own stated scope ("Add persistence fields / metadata / adapter mapping as required"). (b) is a new, multi-week-scale feature (on the order of the entire CANON-R6-PERF-R1/R2/R2R1 body of work already completed earlier in this session for Prove) that was not concretely scoped by this task's text and was not attempted, per Section 18's explicit "do not invent the rule" instruction for exactly this kind of open-ended expansion. **This is why the final verdict is FAIL rather than PASS** — pending an explicit product/engineering decision on which interpretation the delivery gate actually requires.

## 6. PRACTICE-WINDOW IMPLEMENTATION

See Section 4 (AUDIT-001) above and `src/lib/pedagogical-engine/engine.ts`'s own inline documentation at the `practiceWindow` declaration and its 3 reset points (PROVE failure, TRANSFER Case C, TRANSFER Case D).

## 7. RETAIN TWO-STRIKE IMPLEMENTATION

See Section 4 (AUDIT-002) above and `engine.ts`'s `retainStrikeCount` declaration and its 3 touch points (increment on failure, reset on new qualifying Prove, reset on qualifying Retain).

## 8. TRANSFER CLASSIFICATION/EVIDENCE IMPLEMENTATION

See Section 4 (AUDIT-003) and Section 5 (the flagged scope ambiguity) above.

## 9. LEGACY MIGRATION HARDENING

See Section 4 (AUDIT-004) above — source-level removal plus an independent persistence-boundary guard, satisfying the task's own explicit "defense in depth is required."

## 10. MISCONCEPTION LIFECYCLE

Per-attempt: now wired (AUDIT-005). Global: `activeCriticalMisconception` (unchanged, already correct) forces `stage='PRACTICE'`/`intervention='REINFORCE'` for any stage but LEARN, and resolution (`misconception.service.ts`'s `isMisconceptionResolutionEvidence`) requires dedicated EXPLANATION or SOLO_VERIFICATION evidence, unassisted — an ordinary high score on any other activity type can never clear it. Both mechanisms — verified together in `tests/unit/audit-canon-v2-learn-prove-misconception.test.ts` — jointly satisfy DETECTED → ACTIVE → RESOLVED.

## 11. SAME-REQUEST EVIDENCE FIX

Investigated exhaustively; **no defect found**. `updateMastery` synchronously awaits `COMMIT` before returning; the submission route awaits the full evidence-write `Promise.all` before ever reaching the canonical re-fetch; `getCanonicalPedagogicalDecision` has no caching; the database is a single connection pool with no read-replica split, so no replication-lag window can exist. See `tests/unit/audit-canon-v2-same-request-evidence-visibility.test.ts` for the full investigation writeup and permanent regression guard.

## 12. DIFFICULTY CONSISTENCY

Investigated exhaustively; **no defect found** in the v1 override path (`if (v1Marker) { maxQuestions = ...; v1EffectiveDifficulty = ...; }` is unconditional and always wins). The reported "D2 vs D1" symptom is fully explained by the canonical engine being hard-disabled in Production (confirmed, unchanged, verified again below) — every real Production Practice generation today runs through the pre-existing, independent LEGACY `resolveTargetDifficulty` authority instead, which has its own, differently-designed misconception-driven D1 floor. This is two valid, differently-designed authorities coexisting while the canonical gate is off, not a silent remap. See `tests/unit/audit-canon-v2-difficulty-consistency.test.ts`.

## 13. TEST COUNTS

| Stage | Files | Tests | Pass | Fail |
|---|---|---|---|---|
| Baseline (audit phase end) | 262 | 4724 | 4716 | 8 (documented AUDIT-001/002 findings) |
| Final (this remediation) | 265 | 4748 | 4748 | 0 |

3 new test files added (`audit-canon-v2-difficulty-consistency`, `audit-canon-v2-same-request-evidence-visibility`, `audit-canon-v2-ui-authority-closure`); 8 existing test files updated (3 audit files converted from "proves the gap" to "proves the fix"; 5 pre-existing CANON-R2/R2R1/R4/R4R1/R4R1A/R6 files updated where their own fixtures encoded now-superseded pre-V2 behavior). Zero tests skipped (`.skip`/`.todo`/`xit`/`xdescribe` search: zero matches). `npx tsc --noEmit`: clean. `npm run build`: clean.

## 14. FULL-SCENARIO CERTIFICATION RESULTS

All required scenarios (A–J) are covered by the audit and remediation test suites:
- **A (Happy path), C (Prove-failure reset), D (Retain second chance), E (Retain hard failure):** `audit-canon-v2-full-scenarios.test.ts`, `audit-canon-v2-practice-consistency.test.ts`, `audit-canon-v2-retain-two-strike.test.ts` — all pass.
- **B (Practice not enough until 2-of-3):** `audit-canon-v2-practice-consistency.test.ts`'s boundary matrix — passes, including the exact `[100,40,40,100,100]`-style sequences.
- **F (Transfer application failure), G (Transfer retention failure), H (Transfer foundation failure):** `audit-canon-v2-transfer-classification.test.ts` — all pass, including the window-reset-after-foundational-rollback proof.
- **I (Critical misconception block/resolve):** `audit-canon-v2-learn-prove-misconception.test.ts` — passes.
- **J (Same-request visibility):** investigated and found already-correct; regression guard added (`audit-canon-v2-same-request-evidence-visibility.test.ts`).

## 15. REMAINING RISKS

1. **The flagged Transfer-pipeline scope ambiguity (Section 5)** — the single reason this certification is FAIL, not PASS. Requires an explicit product/engineering decision before either closing it (interpretation (a), already done) or scheduling the larger feature (interpretation (b)).
2. **AUDIT-004's mitigating fact remains true but unverified against a live database:** the `pedagogical_requirement_recognition` table has still never been applied to any environment (confirmed via the same self-documenting headers as the prior audit) — the source-level fix and defense-in-depth guard both exist now, but neither has been exercised against a real Postgres instance in this no-DB-access environment.
3. **AUDIT-005's SQL join (`evidence-fetch.ts`) is untested against a live database** for the same reason — its correctness is verified by careful, explicit reasoning about Postgres `jsonb` containment semantics and by the adapter/engine-level unit tests, but has not been run against real `learning_evidence`/`student_misconceptions` rows.
4. **`progress-overview.service.ts`'s new per-concept canonical override** issues one additional DB read per already-mastered concept when the canonical gate is on (never in Production today) — acceptable given the gate's current scope, but worth a batched-query follow-up if/when the gate is ever enabled for a student with very many concepts.
5. Dead code `composeEffectiveMigratedDecision` (AUDIT-007, P2, noted in the prior audit) was not removed in this remediation — it remains unused, harmless, and out of this task's explicit BLOCKER/AUDIT-001–006 scope.

## 16. EXPLICIT CONFIRMATION

- `main` untouched. Nothing pushed.
- Production untouched. No migration applied anywhere.
- The canonical engine v1 Production gate remains hard-OFF: `isCanonicalEngineV1Enabled()` still returns `false` unconditionally whenever `VERCEL_ENV === 'production'`, unchanged by this remediation, re-verified by `tests/unit/audit-canon-v2-feature-gate-and-ui-authority.test.ts` (pre-existing, still green).

---

**FINAL CERTIFICATION VERDICT: FAIL** — pending the Section 5 scope decision. Every other mandatory gate is met.
