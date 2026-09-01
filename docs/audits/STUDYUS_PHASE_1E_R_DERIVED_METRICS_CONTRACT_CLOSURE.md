# StudyUs Phase 1E-R — Derived Metrics Contract & Projection Closure

**Date**: 2026-09-01
**Scope**: Narrow remediation of two external-review findings on Phase 1E's derived learner metrics — (A) `getDecisionContext`'s eager, unconditional computation of three metrics no current consumer reads, and (B) Study Plan Adherence's same-day-any-subject completion overclaim. No metric algorithm (Help Dependency, Learning Velocity, Calibration, Prerequisite Gaps, Transfer Coverage, Persistence) was redesigned.
**Deployment status**: **NOT DEPLOYED.** Nothing in this remediation has been committed, pushed, or deployed. Local `HEAD` remains `907f669d5825b4e0307da236d9cde78097d6aabc` (Phase 1D-P). Phase 1F has not started.

---

## 1. Executive Summary

**`DERIVED_METRICS_CONTRACT = CLOSED`**

Finding A is closed by making `getDecisionContext`'s three future-Decision-Engine-only metrics (`helpDependency`, `learningVelocity`, `prerequisiteGaps`) load only on explicit request via a new `ProjectionOptions.derivedMetrics` option — measured, not estimated: the default call now issues **0** additional queries for them (down from an unconditional ~2-4/3/1-4 query range each), proven by a release-blocking test that spies directly on the reader functions. A new `MetricProjection<T>` type (`{requested: false} | {requested: true, result: MetricResult<T>}`) replaces the previous `Capability<MetricResult<T>>` wrapping — a deliberate third state, never abusing `Capability`'s `NOT_AVAILABLE_YET` (the computation exists) or `MetricResult`'s `INSUFFICIENT_EVIDENCE` (no data check happened). All 4 current callers of `getDecisionContext` (remediation, cognitive diagnosis ×2 including the root-cause loop, tutor strategy) already pass no options and reference none of the three fields, so their behavior — and their query cost — is provably unchanged for the base case and strictly reduced for the derived-metric case.

Finding B is closed by re-auditing the study-plan data model and finding `study_session_items.concept_id` is populated for every planned item — `CAN_PLANNED_SESSION_COMPLETION_BE_PROVEN = YES`, at concept granularity. The query now requires `learning_evidence` to match a concept that specific session's own items planned, on that session's own scheduled date — unrelated same-day evidence (e.g. Physics when Mathematics was planned) can no longer complete a session, and two same-day sessions are each judged against their own content. The metric keeps its name (`Study Plan Adherence` remains an honest name once the completion check is content-scoped) and shape.

No schema change, no migration, no algorithm change to any of the seven metrics themselves. 90 test files, 878 tests, all passing.

---

## 2. External Review Findings

**Finding A**: Phase 1E added `helpDependency`/`learningVelocity`/`prerequisiteGaps` to `DecisionContext` as a correct future-Decision-Engine contract, but computed all three unconditionally on every `getDecisionContext` call. Current live consumers (`remediation.service.ts`, `cognitive-diagnosis.service.ts`, `tutor-strategy.service.ts`) never read any of them, yet paid the full query cost — particularly `generateRootCauseHypotheses`, which calls `getDecisionContext` once per prerequisite candidate, multiplying the unnecessary cost by the candidate count. Required architectural rule: **a projection must not eagerly compute expensive data its caller did not request.**

**Finding B**: Phase 1E correctly discovered `study_sessions.completion_status` is dead data, and derived "completed" from any same-day `learning_evidence` as an honest proxy. Review found this too strong a claim for "Study Plan Adherence" specifically — a planned Mathematics session's evidence check could be satisfied by unrelated same-day Physics activity. Required: either prove actual planned-content alignment using existing data, or rename/reframe the metric to claim only what is observable.

---

## 3. Previous `DecisionContext` Query Footprint

Re-measured fresh via instrumented mock-query counting (`tests/unit/decision-context-query-cost.test.ts`), not approximated:

```
BASE_DECISION_CONTEXT_QUERIES = 12          (measured, constant regardless of derivedMetrics)
HELP_DEPENDENCY_QUERIES       = 2 to 4       (2 when the concept has < policy.minimumEvidenceCount rows and the reader
                                               exits early; 4 when it has enough evidence to run its full computation)
LEARNING_VELOCITY_QUERIES     = 3            (always 3 -- no early-exit path exists in this reader)
PREREQUISITE_GAP_QUERIES      = 1 to 4       (1 when the concept has no prerequisite edges and exits early via
                                               NOT_APPLICABLE; 4 when real edges exist and the full batch runs)
TOTAL_DEFAULT_QUERIES (pre-1E-R)  = 12 + (2-4) + 3 + (1-4) = 18 to 23, unconditionally, every call
```

The ranges are not measurement imprecision — they are the readers' own legitimate early-exit sufficiency/graph-emptiness gates (Help Dependency's evidence-count check, Prerequisite Gaps' `getPrerequisites`-returns-empty check), confirmed by inspecting each reader's source and reproducing both branches in the instrumented test. Either way, before this remediation, **all** of these queries ran on every call regardless of whether the caller used the results.

---

## 4. Live Decision Consumer Audit

Re-ran a fresh `grep` for every `getDecisionContext` call site (not assumed from Phase 1E):

```
src/services/remediation.service.ts:164        -- startRemediation, no options passed
src/services/cognitive-diagnosis.service.ts:179 -- detectCognitiveIssue, no options passed
src/services/cognitive-diagnosis.service.ts:236 -- generateRootCauseHypotheses (the per-candidate loop), no options passed
src/services/tutor-strategy.service.ts:87       -- buildCompactTutorContext, no options passed
```

All 4 call sites pass **zero** arguments beyond `(studentId, conceptId)` and reference none of `learningVelocity`/`helpDependency`/`prerequisiteGaps` on the returned object (re-confirmed by the same static scan Phase 1E's own report used, now extended to also assert none of them contain the literal string `derivedMetrics`). None requires any of the three derived metrics. Matches the expectation exactly — nothing was assumed.

---

## 5. Derived Metric Loading Architecture

`ProjectionOptions.derivedMetrics?: DerivedMetricSelection` (`'all' | DerivedMetricName[]`), defined in `src/lib/learner-twin/types.ts`. `getDecisionContext` resolves it via a small `resolveDerivedMetrics` helper into a `Set<DerivedMetricName>`, then builds each of the three metric promises conditionally:

```ts
const requestedMetrics = resolveDerivedMetrics(options.derivedMetrics);
const learningVelocityPromise = requestedMetrics.has('learningVelocity')
  ? readLearningVelocity(studentId, conceptId).then(metricRequested)
  : Promise.resolve(METRIC_NOT_REQUESTED);
// ...same pattern for helpDependency, prerequisiteGaps
```

When a metric is not requested, its reader function is **never invoked** — not called and its result discarded, literally skipped — proven directly (§7). This is the same single `getDecisionContext` implementation as before (no duplicate projection, no second learner-state entry point) with one new, optional, additive parameter. `getConceptView`/`getSubjectView`/`getOverview` are untouched — Finding A was specific to `DecisionContext`'s per-candidate-loop cost, not a general call to redesign derived-metric loading everywhere.

---

## 6. Projection Contract

New type, `src/lib/learner-twin/metrics/types.ts`:

```ts
export interface MetricNotRequested { requested: false; }
export interface MetricRequested<T> { requested: true; result: MetricResult<T>; }
export type MetricProjection<T> = MetricNotRequested | MetricRequested<T>;
```

This is a deliberate **third** state, distinct from both existing axes (per the task's own Step 4 instruction): `Capability`'s `NOT_AVAILABLE_YET` means "this feature doesn't exist" — false as of Phase 1E, so using it for "not requested" would be a lie. `MetricResult`'s `INSUFFICIENT_EVIDENCE` means "we checked the learner's data and it wasn't enough" — also false when no check ran at all. `{requested: false}` says neither of those things; it says only "not asked for this time." `DecisionContext.learningVelocity`/`helpDependency`/`prerequisiteGaps` changed type from `Capability<MetricResult<T>>` to `MetricProjection<T>` directly — the outer `Capability` wrapper is dropped entirely, since it no longer communicates anything true that `MetricProjection` doesn't already say better.

---

## 7. Query Count Regression

`tests/unit/decision-context-query-cost.test.ts` — release-blocking, 6 tests, all passing:

- **Default (no options)**: spies on `readHelpDependency`/`readLearningVelocity`/`readPrerequisiteGaps` directly — all three `not.toHaveBeenCalled()`. Every field reads `{requested: false}`.
- **Requesting `['helpDependency']`**: only `readHelpDependency` is called (exactly once); the other two are not called at all.
- **Requesting `['learningVelocity', 'prerequisiteGaps']`**: exactly those two run; `readHelpDependency` does not.
- **Requesting `'all'`**: all three run exactly once each.
- **Instrumented query count (real readers, no spy)**: the default call's `db.query` call log contains zero occurrences of any Phase 1E-only query shape (`mastery_policies`, `hints_used`, `verification_attempts`, `first_evidence_at`, the `new_state ->> 'masteryState'` milestone query, `concept_relationships`) — proving Step 1's `DEFAULT_DECISION_CONTEXT_DERIVED_METRIC_QUERIES = 0` directly from the query log, not just from the mocked-reader spy.
- **`'all'` vs default query-count delta**: requesting `'all'` issues strictly more queries than the default, confirming the derived metrics genuinely execute when asked (not silently short-circuited).

---

## 8. Root Cause Flow Verification

`generateRootCauseHypotheses`'s own algorithm was **not** touched (Step 17). Two complementary proofs close this step without duplicating the whole diagnosis pipeline's mock surface:

1. **Structural**: `tests/unit/metrics-architecture-invariants.test.ts` now asserts the exact call-site text `getDecisionContext(studentId, rel.sourceConceptId)` in `cognitive-diagnosis.service.ts` — no second argument, so no `derivedMetrics` option can be present.
2. **Behavioral, composed from §4 + §7**: since (a) the root-cause loop's call site passes no options (§4, freshly re-confirmed), and (b) `getDecisionContext` with no options calls zero derived-metric readers (§7, directly measured), the loop's per-candidate cost for these three metrics is exactly `0 × candidateCount = 0`, for any candidate count.

```
DERIVED_METRIC_QUERIES_FROM_CURRENT_ROOT_CAUSE_FLOW = 0
```

A dedicated static test also confirms no file among `remediation.service.ts`/`cognitive-diagnosis.service.ts`/`tutor-strategy.service.ts`/`verification-triggers.ts` contains the literal string `derivedMetrics` anywhere — guarding against a future edit silently adding `{derivedMetrics: 'all'}` to the loop without anyone noticing the multiplicative cost it would reintroduce.

---

## 9. Study Plan Data Model Re-Audit

Inspected `study_plans` (`id, student_id, period_start, period_end, generated_at, status`), `study_sessions` (`id, plan_id, scheduled_date, estimated_duration_minutes, completion_status`), and `study_session_items` (`id, session_id, concept_id, item_type, reason, sequence, duration_estimate_minutes`) directly, plus `study-plan.service.ts::storeStudyPlan`'s own INSERT statements and `StudySessionItem`'s TypeScript interface. **Finding**: `study_session_items.concept_id` is populated for every planned item — `StudySessionItem.conceptId: string` is a required (non-optional) field, and `storeStudyPlan` always inserts it. A scheduled session's planned content is therefore linkable to specific concepts via `study_session_items.session_id`, and `learning_evidence` already carries its own `concept_id` — the join StudyUs needs already exists in the schema; it was simply not used by Phase 1E's first implementation.

```
CAN_PLANNED_SESSION_COMPLETION_BE_PROVEN = YES
```

At concept granularity — not exact-question identity, which the data model doesn't capture and which the task's own "YES" branch explicitly does not require ("Do not require exact question identity. Use the strongest existing legitimate linkage.").

---

## 10. Final Study Plan Metric Semantics

`readStudyPlanAdherence`'s session query changed from:

```sql
EXISTS (SELECT 1 FROM learning_evidence le WHERE le.student_id = $1 AND le.timestamp::date = ss.scheduled_date)
```

to:

```sql
EXISTS (
  SELECT 1 FROM learning_evidence le
  JOIN study_session_items ssi ON ssi.concept_id = le.concept_id
  WHERE le.student_id = $1
    AND ssi.session_id = ss.id
    AND le.timestamp::date = ss.scheduled_date
)
```

`ssi.session_id = ss.id` scopes the match to *that specific session's own* planned items (so two same-day sessions are never cross-satisfied by one shared evidence stream unless they genuinely planned the same concept); `ssi.concept_id = le.concept_id` requires the evidence to be for a concept that session actually planned. A session with zero recorded items can never match — conservative, not a bug (there is nothing defined to have completed against). The metric's name, output shape (`windowStart`/`windowEnd`/`scheduledSessions`/`completedSessions`/`missedSessions`/`completionRate`/`quality`), and the underlying dead-`completion_status` finding are all unchanged — only the definition of a "match" was corrected, which is exactly what makes the existing name (`Study Plan Adherence`) honest rather than requiring a rename to something like `PlannedDayEngagement`.

---

## 11. Study Plan Tests

`tests/unit/metrics-study-plan-adherence.test.ts` — rewritten, 10 tests, all passing:

- The 5 pre-existing scenarios (no active plan, no due sessions, full completion, partial completion, `windowDays` override) updated to the renamed `has_matching_evidence` mock field, otherwise unchanged in intent.
- **Step 12 (critical)**: scheduled Mathematics/Concept-A session; only same-day evidence is Physics/Concept-B → `completedSessions: 0`, `missedSessions: 1`. Proven via a fixture that faithfully simulates the real SQL's join semantics in JS (not a pre-baked boolean), plus a structural assertion that the actual SQL text sent to `db.query` contains the `JOIN study_session_items ssi ON ssi.concept_id = le.concept_id` and `ssi.session_id = ss.id` clauses that make this behavior true in a real database.
- **Step 13**: scheduled Mathematics/Concept-A session; same-day evidence *for that same concept* → `completedSessions: 1`.
- **Step 14 (critical)**: two sessions the same day (Mathematics/A, Physics/B); evidence matches only Mathematics → exactly 1 of 2 completed, not both (proves one evidence stream cannot auto-complete an unrelated session); a second test with evidence covering both concepts confirms both are correctly completed (no false negative either).
- A dedicated test asserts `StudyPlanAdherenceSummary`'s key set is exactly the 7 observational fields — no motivation/personality field exists (Step 11).

---

## 12. Aggregate Calibration Evidence Gate Review

Reviewed per Step 16, not changed. `AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS = 2` is classified:

```
APPROVED_AS_EVIDENCE_GATE
```

It answers only "is there enough data for a statistically meaningful median" — gating whether `AggregateCalibrationSummary` is computed at all. It does not feed remediation, cognitive diagnosis, tutor strategy, or any pedagogical decision (confirmed: `AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS` has zero references outside `calibration.ts` and its own tests). Documented explicitly in `metrics/types.ts`'s own comment as evidence-quality-only, with an explicit warning against ever repurposing it as a pedagogical threshold. The value (2) was not reconsidered or changed by this review — only classified.

---

## 13. Existing Metric Regression

No algorithm changed for Help Dependency, Learning Velocity, Calibration, Prerequisite Gaps, Transfer Coverage, or Persistence (Step 17) — confirmed via `git diff`: `help-dependency.ts`, `learning-velocity.ts`, `calibration.ts`, `prerequisite-gaps.ts`, `transfer-coverage.ts`, and `persistence.ts` all have **zero diff** this remediation. Only `study-plan-adherence.ts` (Finding B, a mechanical query correction) and the shared `metrics/types.ts` (the new `MetricProjection<T>`/`AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS` doc comment) changed within the metrics module.

---

## 14. Architecture Regression Counts

```
CANONICAL_DERIVED_METRIC_LAYER                    = 1
DEFAULT_DECISION_CONTEXT_DERIVED_METRIC_QUERIES    = 0
CURRENT_DECISION_CONSUMERS_READING_1E_METRICS      = 0
CURRENT_DECISION_ALGORITHM_CHANGES                 = 0
STUDY_PLAN_METRIC_SEMANTIC_OVERCLAIMS              = 0
NEW_DB_TABLES                                      = 0
NEW_DB_COLUMNS                                     = 0
NEW_MIGRATIONS                                     = 0
DERIVED_METRIC_DB_WRITES                           = 0
RESPONSE_TIME_DIRECT_DECISION_RULES                = 0
```

---

## 15. Tests Added / Modified

| File | Status | Tests | Covers |
|---|---|---|---|
| `tests/unit/decision-context-query-cost.test.ts` | NEW | 6 | Release-blocking query-count regression (§7): spy-based reader-invocation proof + real instrumented query-log proof, for default/single-metric/multi-metric/`'all'` requests. |
| `tests/unit/metrics-study-plan-adherence.test.ts` | REWRITTEN | 10 (was 5) | Existing 5 scenarios adapted to the corrected field name; 4 new Step 12-14 semantic fixtures (Math/Physics cross-contamination rejected, same-concept match accepted, two same-day sessions independently judged, both directions); 1 new observational-only field-set test. |
| `tests/unit/metrics-architecture-invariants.test.ts` | MODIFIED | +2 | No consumer ever passes `derivedMetrics`; `generateRootCauseHypotheses`'s exact call-site shape has no second argument. |
| `tests/unit/learner-twin.test.ts` | MODIFIED | 0 net (2 rewritten) | `getDecisionContext`'s default-vs-explicit-request behavior under the new `MetricProjection<T>` contract. |
| `tests/unit/decision-consumer-migration-regression.test.ts` | MODIFIED | 0 net (fixture only) | `DecisionContext` fixture updated to the new `{requested: false}` shape. |

**13 net new tests this remediation.** Full suite: 82 files / 878 tests, all passing.

---

## 16. Application Validation

```
npx tsc --noEmit     -> clean, 0 errors
npx vitest run       -> 82 test files passed (82), 878 tests passed (878)
npm run build        -> succeeded
npm run db:status    -> LEDGER = FOUND; 2 applied, 0 pending, 0 drifted
```

---

## 17. Git Diff

**Modified**: `src/lib/learner-twin/index.ts` (export list), `src/lib/learner-twin/service.ts` (`getDecisionContext` conditional loading + `resolveDerivedMetrics`), `src/lib/learner-twin/types.ts` (`DecisionContext` field types, `ProjectionOptions.derivedMetrics`, `DerivedMetricSelection`), `src/lib/learner-twin/metrics/types.ts` (`MetricProjection<T>`, calibration-constant classification comment), `src/lib/learner-twin/metrics/study-plan-adherence.ts` (concept-scoped query), plus the 5 test files in §15.

**New**: `tests/unit/decision-context-query-cost.test.ts`, `docs/audits/STUDYUS_PHASE_1E_R_DERIVED_METRICS_CONTRACT_CLOSURE.md` (this report).

No migration file. No schema file. No change to any decision-algorithm file (`remediation.service.ts`, `cognitive-diagnosis.service.ts`, `tutor-strategy.service.ts`, `verification-triggers.ts` — all zero diff). No change to `help-dependency.ts`, `learning-velocity.ts`, `calibration.ts`, `prerequisite-gaps.ts`, `transfer-coverage.ts`, `persistence.ts` (all zero diff). No response-time file touched. No UI file touched.

---

## 18. Remaining Risks (max 5)

1. **`MetricProjection<T>`'s query-count ranges (§3) are data-dependent**, not fixed constants — a future consumer requesting `'all'` on a concept with abundant evidence and prerequisite edges pays closer to the upper end of each range (4/3/4 = 11 additional queries) than the lower end (2/3/1 = 6). This is disclosed, not hidden, but worth remembering when reasoning about a future Decision Engine's real-world cost.
2. **The concept-level Study Plan Adherence match still cannot detect a student who studied the right concept but on a different day than a make-up/rescheduled session** implies — the window/date matching remains exact-date, which is a reasonable, disclosed boundary, not a defect.
3. **No production traffic has exercised either fix yet** — verification here is against unit fixtures and instrumented mocks, per the explicit no-deploy constraint.
4. **`MetricProjection<T>` and `Capability<T>` now coexist in the same module** as two different "conditional availability" shapes with a similar `{boolean-ish discriminant, ...}` structure — a future engineer skimming quickly could confuse which one a given field uses; the doc comments in `metrics/types.ts` and `types.ts` address this directly, but it is a real, ongoing cognitive-load risk worth flagging.
5. **The query-cost regression test (§7) mocks the reader functions for its strongest assertions** — this proves the *reader functions* are not invoked, which is the correct and strongest available proof, but does not independently re-verify each reader's own internal query count (that remains covered by each metric's own Phase 1E test file, unchanged this remediation).

---

## 19. Definition of Done

- [x] default DecisionContext does not eagerly compute unused Phase 1E metrics
- [x] future consumer can explicitly request metrics
- [x] no second learner-state entry point
- [x] current decision consumers unchanged
- [x] root-cause flow has zero unused metric query tax
- [x] study-plan metric claims only what data proves
- [x] same-day unrelated evidence cannot falsely complete a planned session
- [x] multiple same-day sessions handled honestly
- [x] calibration minimum explicitly classified as evidence-quality policy
- [x] no schema change
- [x] no derived metric writes
- [x] tests pass
- [x] build passes

---

## 20. Final Decision

**A. Is the Derived Metrics contract now safe and semantically precise?** **YES.**

**B. Does default DecisionContext compute unused 1E metrics?** **NO** — measured 0 additional queries, proven by both reader-function spies and a real query-log inspection.

**C. Can a future Decision Engine explicitly request those metrics?** **YES** — `{derivedMetrics: ['helpDependency', ...]}` or `{derivedMetrics: 'all'}`.

**D. Did any current remediation/diagnosis/tutor behavior change?** **NO** — zero diff on all 4 decision-algorithm files; all 4 `getDecisionContext` call sites are unchanged and untouched.

**E. Can unrelated same-day evidence count as completion of a specific planned session?** **NO** — the corrected query requires the evidence's concept to match one the specific session itself planned.

**F. What is the final name/definition of the study-plan metric?** **Study Plan Adherence** (name unchanged) — `completedSessions` now means "a scheduled session for which the student produced `learning_evidence` on a concept that session's own planned items covered, on that session's scheduled date" (concept-level match, not exact-question identity).

**G. Is the calibration ≥2-concept threshold approved only as an evidence-quality gate?** **YES** — `APPROVED_AS_EVIDENCE_GATE`, explicitly documented against ever becoming a pedagogical threshold.

**H. Did any DB schema change occur?** **NO** — `db:status` unchanged at 2 applied / 0 pending / 0 drifted.

**I. Is Phase 1E now fully certifiable?** **YES** — both external-review findings are closed with measured, tested evidence.

**J. Can production release proceed after external review?** Per the explicit instruction governing this remediation: **not decided here** — this report closes the two contract findings; the decision to commit/push/deploy is reserved for the user.
