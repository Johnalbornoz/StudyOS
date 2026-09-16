# Canonical Gaps for Remediation

Consolidated, fix-ready list. **No fixes are implemented here.** This is the handoff artifact for a separate, future remediation phase. Ordered by severity.

## BLOCKER

### AUDIT-001 — PRACTICE consistency window missing
- **What:** implement a "2 of last 3 valid Practice attempts ≥80%" window as the PRACTICE satisfaction rule, replacing the current single-qualifying-attempt rule.
- **Where:** `src/lib/pedagogical-engine/engine.ts`, PRACTICE branch of `replay()`.
- **Blocking decision needed first:** AUDIT-001-AMBIGUITY (does the window reset on rollback?).
- **Test file ready:** `tests/unit/audit-canon-v2-practice-consistency.test.ts` (currently 7 red).

### AUDIT-002 — RETAIN two-strike rule missing
- **What:** only a SECOND consecutive Retention failure (since the last qualifying Prove) should roll back to PROVE; the first failure should leave PROVE/RETAIN untouched and permit an immediate retry with new questions.
- **Where:** `src/lib/pedagogical-engine/engine.ts`, RETENTION_CHECK branch of `replay()`.
- **Test file ready:** `tests/unit/audit-canon-v2-retain-two-strike.test.ts` (currently 1 red).

### AUDIT-003 — TRANSFER Case B (retention-weakness → RETAIN) missing
- **What:** add a 4th TRANSFER failure classification distinct from the current 3, targeting a RETAIN-only rollback with immediate retry and no 3-day wait.
- **Where:** `src/lib/pedagogical-engine/types.ts` (`RollbackCase`, `RawEvidenceItem`), `engine.ts` (TRANSFER failure branch).
- **Blocking decision needed first:** what real, non-score-based signal distinguishes "retention weakness" from "foundational failure" (parallel to the existing `transferFoundationalFailureIndicated`); also note real Transfer evidence has no per-challenge breakdown source today at all (separate, pre-existing gap — `TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE`), so this may need to be sequenced after that is resolved.
- **Test file ready:** `tests/unit/audit-canon-v2-transfer-classification.test.ts` (currently all green — proves the gap via source audit, not a runtime red).

### AUDIT-004 — Legacy migration can fabricate higher-stage recognition
- **What:** narrow `evaluateLegacyRecognition` to LEARN-only (recommended, closes the gap at its source), or at minimum filter `scripts/canon-r4r1-pre-v1-learn-baseline.ts`'s call to `applyRecognitions` to `requirement === 'LEARN'` only.
- **Where:** `src/lib/pedagogical-migration/legacy-recognition.ts` and/or `scripts/canon-r4r1-pre-v1-learn-baseline.ts`.
- **Urgency note:** this script has never been run against any real environment — **it must not be run with `--apply` until this is fixed**, regardless of remediation scheduling for the other findings.
- **Test file ready:** `tests/unit/audit-canon-v2-legacy-fabrication.test.ts` (currently all green — proves the capability exists; should be inverted to assert its ABSENCE once fixed).

## P1

### AUDIT-005 — Per-attempt critical-misconception detection unwired
- **What:** either wire a real per-attempt misconception link into `fetchStudyUSEvidenceRows`, or formally accept the global-flag-only design as sufficient (a product decision, not purely an engineering one) and remove the now-misleading per-item field/branches, or leave as documented future work.
- **Where:** `src/lib/pedagogical-shadow/evidence-fetch.ts`, `evidence-adapter.ts`, `src/lib/pedagogical-migration/new-evidence-capture-contract.ts` (already documents the target shape).

### AUDIT-006 — `canonical-learning-progress.ts` canonical-engine wiring needs verification
- **What:** trace every caller of `buildCanonicalLearningProgress` (My Path, Subjects concept rows) and confirm each applies an equivalent `isCanonicalEngineV1Enabled` + `getCanonicalPedagogicalDecision` override, matching ConceptMission/Today's pattern — or add it if missing.
- **Where:** `src/lib/lx/canonical-learning-progress.ts` and its callers (not yet identified in this audit).

## P2

### AUDIT-007 — Dead code: `composeEffectiveMigratedDecision`
- **What:** remove or explicitly mark `@deprecated` — superseded by CANON-R4R1's `recognizedRequirements` engine extension, never called from any live route.
- **Where:** `src/lib/pedagogical-migration/effective-decision.ts`.

## Specification clarifications needed before remediation can proceed on some items

- **AUDIT-001-AMBIGUITY:** PRACTICE window reset-on-rollback semantics.
- **AUDIT-003-AMBIGUITY:** the TRANSFER "85 overall, 80/80/75" worked example's internal arithmetic inconsistency — clarify whether "overall" is a simple mean or an item-weighted computation.

## Explicitly NOT gaps (verified PASS, no action needed)

- LEARN's exclusive->80 bar, LEARN_CHECK-only qualification, and the LEARN-exempt misconception override.
- PROVE's exact-10/independence/rollback-to-PRACTICE contract, novelty-preserving immutable-history behavior.
- RETAIN's 3-day temporal gate, novelty requirement, and "new Prove → new window from zero" reset.
- TRANSFER's per-challenge-floor-plus-overall-average check, and Cases A/C/D's rollback directions (only Case B is missing).
- The global critical-misconception override and its score-cannot-clear-it resolution model.
- REINFORCE overlay tagging does not corrupt PRACTICE evidence qualification (now protected by a regression-guard test).
- Server-side contract authority (fresh re-verification, fail-closed, no client-controlled item count/difficulty/mode).
- Prepared-activity/cache correctness (pre-generation trigger gated on a fresh canonical EXECUTABLE/PROVE decision, consumption re-verification, stale-row recovery) — already certified in the prior CANON-R6-PERF-R2/R2R1 phases this session.
- The `isCanonicalEngineV1Enabled` feature gate itself: hard-off in Production, never on-by-default, and consistently used by all 4 real call sites checked (session/start, generate-and-take, ConceptMission, Today).
