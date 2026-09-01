# StudyUs Phase 1C-R — Canonical Decision Consumer Closure

**Date**: 2026-08-31
**Scope**: Narrow remediation of a Phase 1C external-review finding — migrate every live decision-adjacent consumer of `getLearnerConceptState` onto the canonical Digital Learning Twin boundary (`getDecisionContext`), close the boundary with a static architecture test, and disposition the now-zero-caller legacy function.
**Deployment status**: **NOT DEPLOYED.** Nothing in this remediation has been committed, pushed, or deployed. Production HEAD remains `afa2e2a1ce5db450d4ee9541890aff94d9a34b96` (Phase 0G). Phase 1D has not started.

---

## 1. Executive Summary

**`CANONICAL_LEARNER_MODEL_BOUNDARY = CLOSED`**

All three decision-adjacent consumers of the deprecated `getLearnerConceptState` — `remediation.service.ts`, `cognitive-diagnosis.service.ts` (2 call sites), `tutor-strategy.service.ts` — now call the canonical `getDecisionContext` instead. `getLearnerConceptState` has zero live callers anywhere in `src/`, is marked `@deprecated`, and is retained, unmodified, only because two test files use it as a permanent before/after equivalence proof. A static architecture test now fails the suite if any application/service code reintroduces a live import of it. The forward-looking retention semantic Phase 1C discovered (`100 - forgettingRisk`, not the Knowledge State `retentionScore` dimension) was preserved exactly at all three call sites, with dedicated regression coverage proving it. No decision output (remediation pattern, diagnosis score, tutor strategy) changed for any tested fixture. No schema, telemetry, or algorithm changed.

---

## 2. External Review Finding

Phase 1C's report (§16/§17) classified `getLearnerConceptState`'s three remaining decision-adjacent callers as `DOMAIN_SPECIFIC_AND_JUSTIFIED`, reasoning that they called the same certified atomic algorithms the new Twin also called, so no algorithm was duplicated. External review found this the wrong test: the architecture requirement is not "do not duplicate algorithms" but **"important learner-state decision consumers must enter through the canonical Learner Model boundary"** — `getDecisionContext`, feeding remediation, cognitive diagnosis, tutor strategy, and a future Decision Engine. A function can avoid algorithm duplication and still be a second, live learner-state entry point; `getLearnerConceptState` was exactly that.

---

## 3. Pre-Remediation Caller Audit

Fresh grep, not assumed from Phase 1C:

```
LIVE_EXTERNAL_CALLERS_OF_getLearnerConceptState = 3 files, 4 call sites
  src/services/remediation.service.ts            (1 call site, startRemediation)
  src/services/cognitive-diagnosis.service.ts     (2 call sites, detectCognitiveIssue + generateRootCauseHypotheses)
  src/services/tutor-strategy.service.ts          (1 call site, buildCompactTutorContext)
```

Confirmed via `grep -rn getLearnerConceptState src/ tests/` — no other application/service file referenced it as a live call; the UI page migrated in Phase 1C ([concepts/\[conceptId\]/page.tsx](../../src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx)) only carries prose comments, not a live call. Matches the task's expectation exactly.

---

## 4. Consumer Field Matrix

| Consumer | Field read | Meaning | Old source (`LearnerConceptState`) | New source (`DecisionContext`) | Migration possible? |
|---|---|---|---|---|---|
| `remediation.service.ts::determineRemediationPattern` | `masteryScore` | mastery 0–100 | `state.masteryScore` | `dc.mastery.score` | YES |
| " | `retention` | forward-looking, spaced-repetition (`100 - forgettingRisk`) | `state.retention` | `100 - dc.retention.forgettingRisk` | YES, with inversion |
| " | `independentMastery` | independent-evidence mastery | `state.independentMastery` | `dc.independence.independentMastery` | YES |
| " | `confidenceCalibration.label` | OVERCONFIDENT/etc | `state.confidenceCalibration.label` | `dc.metacognition.confidenceCalibration.label` | YES |
| `cognitive-diagnosis.service.ts::detectCognitiveIssue` | `masteryScore`, `independentMastery`, `confidenceCalibration.label` | same as above | `state.*` | `dc.mastery.score` / `dc.independence.independentMastery` / `dc.metacognition.confidenceCalibration.label` | YES |
| `cognitive-diagnosis.service.ts::generateRootCauseHypotheses` | `masteryScore`, `retention`, `independentMastery` (→ `learnerGapFactor`) | same as above | `candidateState.*` | `dc.mastery.score` / `100 - dc.retention.forgettingRisk` / `dc.independence.independentMastery` | YES |
| " | `evidenceStrength` (→ `evidenceConfidenceFactor`) | HIGH/MEDIUM/LOW/null | `candidateState.evidenceStrength` | `dc.independence.evidenceStrength` | YES |
| `tutor-strategy.service.ts::buildCompactTutorContext` | `masteryScore`, `retention`, `independentMastery`, `confidenceCalibration.label` | same as above | `state.*` | same mapping as remediation | YES |

**Not used by any consumer**: `LearnerConceptState.confidence` (self-reported average) — none of the three files read it. No gap; nothing to migrate for that field.

---

## 5. `DecisionContext` Changes

**None required.** `getDecisionContext` (built in Phase 1C) already carries every signal these three consumers need — `mastery.score`, `retention.forgettingRisk`, `independence.independentMastery`, `independence.evidenceStrength`, `metacognition.confidenceCalibration` — with no gaps. No field was added to `DecisionContext` or `types.ts`. Per Step 4/Step 5, no naming change was needed either: the type already exposes the two retention signals under distinct, unambiguous names (`retentionScore` vs. `forgettingRisk`), so no third retention interpretation was introduced.

One incidental extra query exists: `getDecisionContext` looks up a concept's `subject_id` (needed for `readAssessmentPressure`) before reading `mastery_records`, where `getLearnerConceptState` queried `mastery_records` directly. This was verified **not** to be able to change `null`-return behavior: `mastery_records.concept_id` carries a `FOREIGN KEY … REFERENCES concepts(id)` constraint (`mastery_records_concept_id_fkey`, confirmed via live schema introspection this phase), so a `mastery_records` row can never exist for a concept that doesn't. See §18 for the perf note.

---

## 6. Retention Semantic Preservation

Phase 1C's critical finding — `retention.retentionScore` (Knowledge State dimension, backward-looking) and `retention.forgettingRisk` (spaced-repetition, forward-looking, algebraically `100 - retention` under the old field) must never be conflated — is a release-blocking invariant for this remediation, since all three migrated consumers read the OLD forward-looking value. Every call site now computes:

```ts
const retention = dc.retention.forgettingRisk !== null ? 100 - dc.retention.forgettingRisk : null;
```

— never `dc.retention.retentionScore`. This is documented inline at all three call sites and pinned by dedicated tests (§7–9, §15) using fixtures where `retentionScore` and `forgettingRisk`-derived retention are deliberately set to **different** values, so a future accidental substitution fails loudly.

---

## 7. Remediation Migration

`remediation.service.ts` no longer imports or calls `getLearnerConceptState` (only its type, `LearnerConceptState`, for the adapter's return shape). `startRemediation` now calls `getDecisionContext(diagnosis.studentId, diagnosis.candidateConceptId)` and passes the result through a new, small, pure, exported adapter:

```ts
export function toCandidateState(dc: DecisionContext | null): LearnerConceptState | null
```

which maps `DecisionContext` fields onto exactly the shape `determineRemediationPattern` already expects — **`determineRemediationPattern` itself is completely unchanged**, byte-for-byte, preserving the existing, tested pattern-selection algorithm exactly. `tests/unit/remediation.test.ts`'s existing pure-function tests for `determineRemediationPattern` needed no changes; only its mocks were swapped (`getLearnerConceptState` → `getDecisionContext`) since `startRemediation`'s dependency changed. New regression tests (`tests/unit/decision-consumer-migration-regression.test.ts`) prove `determineRemediationPattern(legacyFixture)` and `determineRemediationPattern(toCandidateState(equivalentDecisionContextFixture))` agree for DEFAULT, LOW_MASTERY, LOW_RETENTION (with deliberately conflicting `retentionScore`/`forgettingRisk` to prove the inversion, not the KS dimension, drives it), OVERCONFIDENT, and the `null` case.

---

## 8. Cognitive Diagnosis Migration

Both call sites in `cognitive-diagnosis.service.ts` migrated:

- `detectCognitiveIssue` now calls `getDecisionContext` and reads `decisionContext.mastery.score`, `decisionContext.independence.independentMastery`, `decisionContext.metacognition.confidenceCalibration.label` inline — the `null`/insufficient-evidence guard (`decisionContext &&`) is preserved exactly.
- `generateRootCauseHypotheses` now calls `getDecisionContext(studentId, rel.sourceConceptId)` per candidate, computes `candidateRetention = 100 - candidateDecisionContext.retention.forgettingRisk` (or `null`), and passes it to the unchanged, pure `learnerGapFactor(masteryScore, retention, independentMastery)`; `evidenceConfidenceFactor` now receives `candidateDecisionContext.independence.evidenceStrength`.

None of `errorTypeRelevance`, `evidenceConfidenceFactor`, `learnerGapFactor`, `recurrenceFactor`, `computeRootCauseScore`, `classifyDiagnosisState`, or `evaluateDiagnosticCheck` — the diagnosis engine's actual scoring rules — changed. `tests/unit/cognitive-diagnosis.test.ts`'s existing pure-function tests (none of which mock `getLearnerConceptState`) needed zero changes and still pass unmodified. New regression tests prove `learnerGapFactor`'s and `evidenceConfidenceFactor`'s inputs are identical whether sourced from a legacy fixture or the equivalent canonical `DecisionContext` fixture, including the insufficient-evidence (`null`) case and a deliberately conflicting retention-dimension fixture.

---

## 9. Tutor Strategy Migration

`tutor-strategy.service.ts::buildCompactTutorContext` now calls `getDecisionContext(studentId, conceptId)`, computes the forward-looking `retention` value once at the top of the function, and passes `decisionContext.mastery.score` / `retention` / `decisionContext.independence.independentMastery` / `decisionContext.metacognition.confidenceCalibration.label` into the completely unchanged, pure `selectTutorStrategy`. The human-readable `summary` string construction (`Mastery X%`, `Retention Y%`, `Independent Mastery Z%`) was updated to read from the same local variables, preserving its exact output for the same inputs. `tests/unit/tutor-strategy.test.ts`'s existing pure-function tests needed zero changes. New regression tests prove `selectTutorStrategy`'s output is identical between the legacy and canonical paths for a low-retention fixture (RETRIEVAL, with a deliberately conflicting `retentionScore`) and an overconfident fixture (SOCRATIC).

---

## 10. Legacy Function Final Disposition

`getLearnerConceptState`: **B — MARK DEPRECATED / KEEP TEMPORARILY, zero live callers.**

Chosen over full removal because two legitimate test files still call it directly as a permanent before/after equivalence proof, not as scaffolding to be deleted: `tests/unit/learner-twin-consumer-regression.test.ts` (proves the Phase 1C concept-detail-page migration preserved output) and `tests/unit/remediation.test.ts` (its `state()` fixture helper still types against `LearnerConceptState`, now purely for `determineRemediationPattern`'s own pure-function tests, unrelated to any live call). Removing the function would force gutting real regression coverage for no architectural benefit — the important invariant ("no live consumer uses it as a learner-state entry point") is already satisfied without deleting it. Per Step 9, the function now carries:

```ts
/**
 * @deprecated Use `getDecisionContext`/`getConceptView` from `@/lib/learner-twin`.
 * No new callers. ...
 */
```

Its implementation is completely unmodified — zero risk to the two tests that depend on it.

---

## 11. Canonical Boundary Architecture Test

New file: `tests/unit/canonical-learner-model-boundary.test.ts` (2 tests). It walks every `.ts`/`.tsx` file under `src/`, strips comments (so prose discussion of the deprecated function, e.g. in the migrated concept-detail page's commentary, doesn't false-positive), and asserts the string `getLearnerConceptState` appears in no file except `src/services/learner-model.service.ts` itself. A second test asserts all three migrated consumers actually import `getDecisionContext` from `@/lib/learner-twin`. This is a permanent regression guard: any future PR that reintroduces a live `getLearnerConceptState` import anywhere in application/service code fails the suite.

---

## 12. Projection Consistency

`tests/unit/learner-twin.test.ts`'s existing "Projection consistency" describe block was extended with a new test asserting `getConceptView` and `getDecisionContext`, against the same fixture, agree exactly on: `mastery.score`, `independence.independentMastery`, `independence.evidenceStrength`, `retention.forgettingRisk`, `retention.retentionScore`, `metacognition.confidenceCalibration`, `misconceptions` (activeCount/criticalCount/recurringCount), and `assessmentContext`/`assessmentPressure`. All pass, confirming both projections trace to the same underlying sub-readers (§6 of the Phase 1C report), not independent computations.

---

## 13. Legacy Read Model Classification (re-evaluated)

| Function | Classification | Reasoning |
|---|---|---|
| `getSubjectLearnerModel` | `CANONICAL_INTERNAL_PRIMITIVE` | Sole live caller is `src/lib/learner-twin/service.ts` (internal to the canonical boundary); its former external caller (subject page) now calls `getSubjectView`. |
| `getLearnerConceptState` | `DEPRECATED_ZERO_CALLER` | Zero live callers in `src/` (§3, §10); retained only for two test files' before/after equivalence proofs. No longer a second learner-state entry point. |
| `getLearningOSSnapshot` | `DOMAIN_OUTPUT_NOT_LEARNER_MODEL` | Unchanged from Phase 1C: a decision/plan generator (invokes `getLearningDecisions` and Phase 3D orchestrator functions), not an alternative source of learner *state*. |
| `getStudentProgressOverview` | `DOMAIN_OUTPUT_NOT_LEARNER_MODEL` | Unchanged from Phase 1C: gamification/achievement aggregation (validated-mastery/retention-demonstrated/independent-evidence counts gated by mastery-policy thresholds), a distinct concept the Twin does not model. |

Using the strict definition required by this remediation — *"a live callable API/function directly consumed by application or decision code as an alternative source of learner state rather than through the canonical Learner Twin projections"* — none of the four remaining functions qualifies. `getLearningOSSnapshot` and `getStudentProgressOverview` are not alternative *learner-state* sources at all (planning/decision output and gamification output, respectively, not mastery/knowledge-state/retention/etc.); `getSubjectLearnerModel` is internal to the canonical boundary itself; `getLearnerConceptState` has no live consumer left.

---

## 14. Architecture Regression Counts

```
CANONICAL_LEARNER_MODEL_SERVICE           = 1
LIVE_EXTERNAL_CALLERS_OF_getLearnerConceptState = 0
DECISION_CONSUMERS_BYPASSING_LEARNER_TWIN = 0
FRAGMENTED_LIVE_LEARNER_READ_MODELS       = 0
LEARNER_MODEL_DB_WRITES                   = 0
NEW_SCHEMA_CHANGES                        = 0
NEW_BEHAVIOR_TELEMETRY                    = 0
NEW_DERIVED_1E_METRICS                    = 0
```

---

## 15. Tests Added / Modified

| File | Status | Tests | Covers |
|---|---|---|---|
| `tests/unit/decision-consumer-migration-regression.test.ts` | NEW | 13 | Remediation (5: DEFAULT/LOW_MASTERY/LOW_RETENTION/OVERCONFIDENT/null), cognitive diagnosis (3: `learnerGapFactor` equivalence + null case, `evidenceConfidenceFactor` equivalence), tutor strategy (2: RETRIEVAL/SOCRATIC equivalence), release-blocking retention invariant (3: conflicting-fixture proof, "never reads retentionScore", null-forgettingRisk-never-fabricated). |
| `tests/unit/canonical-learner-model-boundary.test.ts` | NEW | 2 | No live `getLearnerConceptState` import outside its own definition file (Step 11); all 3 consumers import `getDecisionContext`. |
| `tests/unit/learner-twin.test.ts` | MODIFIED | +1 (30 total in file) | Step 12 full-signal projection consistency between `getConceptView` and `getDecisionContext`. |
| `tests/unit/remediation.test.ts` | MODIFIED | 0 net change | Mocks swapped from `@/services/learner-model.service`'s `getLearnerConceptState` to `@/lib/learner-twin`'s `getDecisionContext`; existing `determineRemediationPattern` pure-function tests untouched. |

**16 new tests this remediation** (13 + 2 + 1). Combined with Phase 1C's 23, the Digital Learning Twin now has 39 dedicated tests.

---

## 16. Application Validation

- **TypeScript**: `npx tsc --noEmit` → clean, zero errors.
- **Tests**: `npx vitest run` → **69 test files passed (69), 765 tests passed (765)**.
- **Build**: `npm run build` → succeeded, full route manifest generated, no errors.
- **DB status**: `npm run db:status` → `LEDGER = FOUND`, **2 applied, 0 pending, 0 drifted** — identical to the pre-remediation baseline.

---

## 17. Git Diff

**Modified** (8): `src/services/remediation.service.ts`, `src/services/cognitive-diagnosis.service.ts`, `src/services/tutor-strategy.service.ts`, `src/services/learner-model.service.ts` (deprecation comment only), `tests/unit/remediation.test.ts`, `docs/architecture/digital-learning-twin.md`, `docs/audits/STUDYUS_PHASE_1C_CORE_LEARNER_MODEL_IMPLEMENTATION.md` (addendum only, no rewrite), plus the two page/service files already modified in Phase 1C proper (unchanged further this remediation).

**New** (3): `tests/unit/decision-consumer-migration-regression.test.ts`, `tests/unit/canonical-learner-model-boundary.test.ts`, `docs/audits/STUDYUS_PHASE_1C_R_CANONICAL_CONSUMER_CLOSURE.md` (this report).

No migration file. No telemetry. No change to `mastery.ts`, `knowledge-state.service.ts`, `mastery.service.ts`, or any AI prompt/model wiring. `DecisionContext`/`types.ts` unchanged (§5).

---

## 18. Remaining Risks (max 5)

1. **`getDecisionContext` performs one extra query per call** (a `concepts` lookup for `subject_id`) compared to the old `getLearnerConceptState`, on top of already reading more signals (assessment pressure, planning context) than the three consumers strictly need. Verified functionally safe (§5's FK check) but not load-tested against production concurrency for `generateRootCauseHypotheses`, which now calls `getDecisionContext` once per prerequisite candidate in a loop — the same N-calls-in-a-loop shape it already had with `getLearnerConceptState`, so no new N+1 was introduced, but the per-call cost is now higher.
2. **`getLearnerConceptState` remains in the codebase as `@deprecated`, not removed.** A future contributor could still technically call it (nothing prevents a NEW test file, or a genuinely new consumer, from importing it) — the architecture test (§11) only scans `src/`, not `tests/`, by design (§11's own reasoning), so a hypothetical *test* misuse wouldn't be caught, only a live-code misuse would.
3. **The `toCandidateState` adapter in `remediation.service.ts` is the only place with a named, reusable mapping function**; `cognitive-diagnosis.service.ts` and `tutor-strategy.service.ts` inline the equivalent mapping instead (per Step 10's instruction not to over-extract). This is a minor, deliberate asymmetry — each inline mapping is short (2–4 lines) and independently regression-tested, but it means the retention-inversion logic exists in three slightly different textual forms rather than one shared helper.
4. **No production traffic has exercised the migrated paths yet** — all verification here is against unit fixtures and pure-function equivalence proofs, not a staging/production smoke test, per the explicit no-deploy constraint.
5. **`FRAGMENTED_LIVE_LEARNER_READ_MODELS = 0` depends on the strict definition adopted in §13.** A still-stricter future definition (e.g. one that also flags `getLearningOSSnapshot`/`getStudentProgressOverview` for exposing mastery-adjacent fields at all, regardless of purpose) could reclassify them; this report does not anticipate that redefinition, only applies the one given.

---

## 19. Definition of Done

- [x] remediation uses canonical Learner Twin
- [x] cognitive diagnosis uses canonical Learner Twin
- [x] tutor strategy uses canonical Learner Twin
- [x] no live external caller uses `getLearnerConceptState`
- [x] retention semantics preserved
- [x] no algorithm duplicated
- [x] no schema change
- [x] no telemetry
- [x] no 1E metrics
- [x] tests pass
- [x] build passes

---

## 20. Final Decision

**A. Is the canonical learner-state boundary now closed?** **YES.**

**B. How many live external callers of `getLearnerConceptState` remain?** **0.**

**C. How many decision consumers bypass the Learner Twin?** **0.**

**D. How many fragmented LIVE learner-state entry points remain under the strict architecture definition?** **0** — see §13's per-function reasoning against the definition: *"a live callable API/function directly consumed by application or decision code as an alternative source of learner state rather than through the canonical Learner Twin projections."*

**E. Did remediation, diagnosis, or tutor behavior change?** **NO** — every migrated pure decision function (`determineRemediationPattern`, `learnerGapFactor`, `evidenceConfidenceFactor`, `selectTutorStrategy`) is byte-for-byte unchanged; only their input source changed, proven equivalent by §7–9's regression tests.

**F. Did retention semantics change?** **NO** — the forward-looking `100 - forgettingRisk` value is preserved exactly at every call site, pinned by tests using deliberately conflicting `retentionScore` fixtures (§6, §15).

**G. Did this remediation introduce new schema or telemetry?** **NO** — `db:status` unchanged (2 applied, 0 pending, 0 drifted); no new `learning_evidence`/`decision_events` field written.

**H. Is Phase 1C now fully certifiable?** **YES** — the one external-review finding blocking certification is closed; §18's 5 residual risks are documented, none release-blocking.

**I. Can Phase 1D begin after external review?** Per the explicit instruction governing this remediation: **stop here**. This report does not itself authorize Phase 1D — that decision is reserved for the user after reviewing this closure, same as Phase 1C's own closing constraint.
