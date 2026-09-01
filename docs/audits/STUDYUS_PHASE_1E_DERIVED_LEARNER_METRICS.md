# StudyUs Phase 1E — Derived Learner Metrics

**Date**: 2026-09-01
**Scope**: Implement a deliberately small catalog of derived learner metrics on top of the certified Digital Learning Twin (Phase 1A-1D-R): Help Dependency, Learning Velocity, Aggregate Confidence Calibration, learner-specific Prerequisite Gaps, Transfer Coverage, Study Plan Adherence, Persistence/Recovery. No schema change, no migration, no learning decision logic.
**Deployment status**: **NOT DEPLOYED.** Nothing in this phase has been committed, pushed, or deployed. Production HEAD remains `907f669d5825b4e0307da236d9cde78097d6aabc` (Phase 1D-P). External architecture review happens before any commit; Phase 1F has not started.

---

## Phase 1E-R — Derived Metrics Contract Closure

External architecture review found two contract issues, both closed without redesigning any of the seven metrics' own algorithms — see `docs/audits/STUDYUS_PHASE_1E_R_DERIVED_METRICS_CONTRACT_CLOSURE.md` for the full remediation.

**Finding A (eager query tax)**: this report's own §19 originally measured `getDecisionContext` adding "~11-12 queries" for `helpDependency`/`learningVelocity`/`prerequisiteGaps` **unconditionally** — correct as measured at the time, but flagged by review as an unnecessary cost for every current caller (none of which read those fields), multiplied by `generateRootCauseHypotheses`'s per-candidate loop. `getDecisionContext` now accepts `options.derivedMetrics` and computes none of the three by default (measured: 0 added queries) — a future Decision Engine opts in explicitly. §16 ("DecisionContext Integration") below describes the original `Capability<MetricResult<T>>` field typing; Phase 1E-R replaced it with `MetricProjection<T>` (`{requested: false}` / `{requested: true, result}`) for the reasons given in the closure report.

**Finding B (Study Plan Adherence overclaim)**: §9's original implementation derived session "completion" from *any* same-day evidence, regardless of subject/concept — reported at the time as an honest proxy for dead `completion_status` data, but review correctly identified it as too strong a claim for a metric named "adherence" (a planned Mathematics session could be marked complete by unrelated Physics activity). Re-audit found `study_session_items.concept_id` is populated for every planned item, making concept-level completion matching genuinely provable; the query was corrected accordingly. The metric's name, shape, and the underlying dead-`completion_status` finding are unchanged — only what `completedSessions` counts as a match was corrected.

The sections below (§4-27) are Phase 1E's own, left as originally written; where a section's claim was corrected by 1E-R, that correction is noted above rather than edited into the original text.

---

## 1. Executive Summary

**`DERIVED_LEARNER_METRICS = IMPLEMENTED`**

All seven target metric areas are implemented, each preceded by a source audit of actual current code (not assumed Phase 1B formulas). No arbitrary weight or threshold was invented where no existing StudyUs policy justified one — Help Dependency exposes a transparent component model with `band` always `null`; Prerequisite Gaps reuses the prerequisite's own certified `MasteryState` classification instead of a synthetic severity formula; where a genuinely new minimum was needed (aggregate calibration's qualifying-concept count), it is a documented, disclosed Phase-1E constant, not silently invented policy. Every metric is `MetricResult<T>`-gated: insufficient evidence is an explicit, honest output, never a fabricated number. Learning Velocity is honest about Phase 0E2's temporal-history boundary (2026-08-31) — a milestone reached earlier is reported `historyComplete: false`, never estimated. Response-time telemetry (Phase 1D/1D-R) is deliberately **not** touched by any Phase 1E metric — no FAST/SLOW/GUESS classification exists anywhere in this diff, enforced by a static architecture test. All new fields are wired into the Digital Learning Twin's four projections, including `DecisionContext` (as future-only inputs) — and a static test proves the three existing decision consumers (remediation, cognitive diagnosis, tutor strategy) do not read any of them, so their behavior is unchanged. 52 new tests; full suite 81 files / 864 tests, all passing.

---

## 2. Pre-Implementation Metric Audit

| Metric | Source tables | Source functions (reused) | Granularity | Existing threshold/policy? | New policy required? | Implementable now? |
|---|---|---|---|---|---|---|
| Help Dependency | `learning_evidence`, `verification_attempts`, `mastery_policies` | `getIndependentMastery`, `getActiveMasteryPolicy` | student+concept | `mastery_policies.minimum_evidence_count`/`minimum_independent_evidence_count` (reused for the sample gate); **no** weighting policy | No (component model instead) | Yes |
| Learning Velocity | `learning_evidence`, `decision_events`, `concept_knowledge_state` | none (new, but reuses the real `MasteryState` enum) | student+concept, aggregate | Phase 0E2's decision_events start date (2026-08-31) is the binding constraint, not a formula | No | Yes, with the temporal-history guard |
| Aggregate Confidence Calibration | `learning_evidence.confidence_before_answer` | `computeConfidenceCalibration` (reused verbatim) | student, student+subject | The atomic function's own `CALIBRATION_MIN_SAMPLES` (reused via its `INSUFFICIENT_EVIDENCE` label) | Yes — `AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS=2`, disclosed (§6) | Yes |
| Prerequisite Gaps | `concept_relationships`, `mastery_records`, `concept_knowledge_state` | `getPrerequisites` (concept-graph.service.ts, reused) | student+concept | No existing "prerequisite mastery threshold" found; the prerequisite's own certified `MasteryState` was reused instead | No (rejected an invented formula — §7) | Yes |
| Transfer Coverage | `learning_evidence` (source_type='TRANSFER'), `mastery_records` | none (descriptive only; `getTransferScore`/`computeTransferScore` untouched) | student+subject | No existing coverage-denominator policy; "engaged concepts" (mastery_records) chosen and documented | No | Yes |
| Study Plan Adherence | `study_plans`, `study_sessions`, `learning_evidence` | none | student (learner-wide) | **Finding**: `study_sessions.completion_status` is dead data (written once, never updated anywhere) — disclosed, not silently worked around | No | Yes, via an evidence-presence proxy |
| Persistence/Recovery | `learning_evidence`, chronological | none | student+concept | None needed — purely observational counts | No | Yes |

`Current sample availability` was verified structurally (query shape, not by reading production data — Step 30: production learner records were never queried to construct formulas; all design decisions came from code/schema inspection and deterministic test fixtures).

---

## 3. Common Metric Contract

`src/lib/learner-twin/metrics/types.ts` defines `MetricResult<T>` — a **parallel** type to Phase 1C's `Capability<T>`, not a reuse of it: `Capability` answers "does this computation exist" (build-time); `MetricResult` answers "is there enough data for this learner right now" (per-instance, evidence-driven). Every `available: true` value carries `DerivedMetricQuality`: `sourceType: 'DETERMINISTIC_DERIVATION'`, `sampleSize`, `lastUpdatedAt`, an optional `evidenceCoverage`, and `modelVersion`. Every `available: false` value carries a `reason` (`INSUFFICIENT_EVIDENCE | INSUFFICIENT_TEMPORAL_HISTORY | INSUFFICIENT_POLICY | NOT_APPLICABLE`) and a non-fabricated `detail` string. No metric ever returns `0`/`null` silently meaning "unknown."

---

## 4. Help Dependency

Audited fields confirmed present: `learning_evidence.ai_assistance_type`, `.hints_used`; `getIndependentMastery` (existing, own `<2`-rows sufficiency gate); `verification_attempts.outcome`. A **transparent component model** — `assistedEvidenceShare`, `independentEvidenceShare`, `hintUsageShare`, `independentMastery`, `verificationConsistency` — with `band: null` always: no existing approved weighting between hints/AI-assistance/independence was found anywhere in the codebase, so none was invented (Step 3's own instruction followed to the letter). Sample gate (Step 4) reuses `getActiveMasteryPolicy().minimumEvidenceCount` — below it, `INSUFFICIENT_EVIDENCE`, never a fabricated `HIGH_DEPENDENCY` from one assisted attempt (proven by test).

---

## 5. Learning Velocity

Milestones are the real `MasteryState` values (`PROVISIONAL_MASTERY`, `VALIDATED_MASTERY`), kept distinct, sourced from the earliest `KNOWLEDGE_STATE_PROJECTED` `decision_events` row carrying each state. `MilestoneTiming` disambiguates `reached: false` (genuinely not yet reached) from `reached: true, historyComplete: false` (reached before Phase 0E2's audit trail began 2026-08-31 — date unknown, **never estimated or backfilled**, per Step 6, proven by a dedicated "already mastered before temporal history" test). `activeStudyDaysToX` counts distinct calendar dates with qualifying evidence (Step 7: UTC calendar days — documented simplification, not architected further, per the explicit "do not introduce timezone architecture" instruction). Aggregation (Step 8) uses the **median** across concepts with `historyComplete` timings, never a naive mean (proven: one 400-day outlier concept does not distort a 3/5-day cohort's median), reporting `qualifyingConceptCount`/`totalConceptCount`.

---

## 6. Aggregate Confidence Calibration

Reuses `computeConfidenceCalibration` (learner-model.service.ts) **verbatim**, per concept, from one batched query (grouped in memory — never one query per concept). Its own `label === 'INSUFFICIENT_EVIDENCE'` (below its internal `CALIBRATION_MIN_SAMPLES=3`) is reused directly as the per-concept qualification gate — no constant duplicated. Direction is **not** collapsed into one fabricated aggregate label: `medianCalibrationScore` (magnitude only, direction-agnostic by construction — the atomic score is computed from absolute differences) plus `labelDistribution` (how many qualifying concepts landed in each of the atomic function's own OVERCONFIDENT/WELL_CALIBRATED/UNDERCONFIDENT labels), proven by a "conflicting calibration" test (one overconfident concept, one underconfident, both visible, no forced single direction). `AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS = 2` is a **disclosed, Phase-1E-introduced minimum** — no existing StudyUs policy defines an aggregate-calibration threshold, and a median of 1 concept is not a real aggregate; this is documented transparently rather than silently invented (per the task's own "or document the decision required" escape hatch).

---

## 7. Prerequisite Gaps

Learner-specific gaps derived from `concept_relationships` (via the existing `getPrerequisites`, reused, not duplicated — **no new table**) plus the learner's own `mastery_records`/`concept_knowledge_state`. **Rejected formula**, explicitly: `relationshipConfidence * (100 - mastery)` or any similar synthetic weighting — no existing StudyUs policy defines a "prerequisite mastery threshold" (confirmed by source audit: `mastery_policies`' own thresholds are per-Knowledge-State-dimension, not prerequisite-specific; no such constant exists in `concept-graph.service.ts`, `remediation.service.ts`, or `cognitive-diagnosis.service.ts`). Instead, `gap: boolean` reuses the prerequisite's own **already-certified** `MasteryState` classification (below `PROVISIONAL_MASTERY`, or no Knowledge State row at all) — a real policy decision already made by the certified Knowledge State projector, not reinvented here. Raw `prerequisiteMasteryScore`/`prerequisiteMasteryState`/`relationshipConfidence` are always exposed alongside `gap`, so no information is hidden behind the boolean. `NOT_APPLICABLE` (not `INSUFFICIENT_EVIDENCE`) when a concept has zero prerequisite edges — that's a graph fact, not a data-insufficiency.

---

## 8. Transfer Coverage

Purely descriptive — `transfer.service.ts::computeTransferScore`/`getTransferScore` are untouched. Denominator (Step 13, explicitly documented): `eligibleConceptCount` = concepts in the subject where the student has a `mastery_records` row (engaged), **not** the full subject curriculum — a concept never touched can't fairly be "transfer-eligible" yet. `INSUFFICIENT_EVIDENCE` only when zero concepts are engaged; zero transfer coverage among engaged concepts is itself a valid, honest `0%` (proven by a dedicated "no transfer evidence" test distinguishing it from unavailability). Step 14: one successful sample is never reported as general ability — no `GENERAL_TRANSFER_ABILITY` label exists anywhere in this module.

---

## 9. Study Plan Adherence

**Source-audit finding, disclosed rather than worked around silently**: `study_sessions.completion_status` is written `'pending'` at creation (`study-plan.service.ts::storeStudyPlan`) and is **never updated anywhere in the codebase** — confirmed by a full-repo grep finding zero other references to that column. Using it would always report 0% adherence regardless of real behavior. Instead, "completed" is derived from an observable fact: whether `learning_evidence` exists on a session's `scheduled_date` — execution, not motivation (Step 15). Window is an explicit parameter (Step 16, never hard-coded), defaulting to the student's own active plan's `[period_start, min(period_end, today)]` — an existing StudyUs planning period — with an optional `windowDays` trailing-window override.

---

## 10. Persistence / Recovery

Conservative and purely observational, per Step 17: `failureEpisodeCount` (maximal consecutive-`incorrect` runs), `returnAfterFailureCount`, `recoveryAfterFailureCount`, `unresolvedFailureCount`, `currentConsecutiveFailureStreak` — computed from a single chronological `learning_evidence` walk. No `PRODUCTIVE_STRUGGLE`, `GUESSING`, or `FLUENCY` classification exists (confirmed by a static architecture test scanning for those literal terms). No personality/motivation label is ever produced (proven: the summary's own key set is exactly the 5 count fields + `quality`, nothing else).

---

## 11. Response-Time Role

Deliberate, disclosed non-integration (Step 18): **no Phase 1E metric reads response-time data.** Persistence was the one place it could plausibly have enriched analysis, and the task explicitly made that optional ("may... only when sufficient VALID samples exist") — with little production timing history yet (Phase 1D-P confirmed 0 rows in production at deploy time) and the real risk of exactly the premature interpretation Phase 1D-R just closed, it was left out entirely rather than attempted early. A static test (`metrics-architecture-invariants.test.ts`) scans every file in `src/lib/learner-twin/metrics/` for `responseTimeMs`/`timingQuality`/`validSampleCount`/any reference to the response-timing module — zero matches, so a future accidental wiring-in would fail this suite immediately, not silently ship. `RESPONSE_TIME_DIRECT_DECISION_RULES = 0` — no `responseTimeMs < X → GUESS` or `> Y → STRUGGLE` rule exists anywhere.

---

## 12. Evidence Counting Semantics

Explicitly defined per metric, per Step 20:
- **Help Dependency / Persistence**: count `learning_evidence` **rows** (one row can represent an aggregated multi-question quiz-concept-bucket — see Phase 1C's own finding on this; each row is one "evidence event," not one question).
- **Learning Velocity**: counts **distinct calendar dates** with evidence, not evidence rows — a day with 5 quiz questions on one concept is 1 active-study day, not 5.
- **Aggregate Calibration**: counts **confidence-tagged evidence rows** as `totalConfidenceSamples` (one row = one self-reported confidence judgment, matching `computeConfidenceCalibration`'s own existing unit).
- **Transfer Coverage**: counts **TRANSFER-source evidence rows** as `transferEvidenceCount`, and **distinct concepts** as `coveredConceptCount`/`eligibleConceptCount` — never conflated.
- **Study Plan Adherence**: counts **scheduled sessions** (one `study_sessions` row = one day's planned session), not evidence rows.
- **Prerequisite Gaps**: counts **prerequisite relationships** (`concept_relationships` edges), one per graph edge, independent of how much evidence each prerequisite concept has.

No metric silently treats one evidence row as one question, one attempt, or one session interchangeably with another metric's unit.

---

## 13. Metric Quality / Availability

Every `available: true` metric value carries `sourceType: 'DETERMINISTIC_DERIVATION'`, `sampleSize`, `lastUpdatedAt` (where meaningful), and `modelVersion`. No metric ever appears authoritative from one observation — Help Dependency requires the policy's real evidence-count minimum; Aggregate Calibration requires ≥2 qualifying concepts; Prerequisite Gaps/Transfer Coverage/Study Plan Adherence/Persistence each have their own explicit `INSUFFICIENT_EVIDENCE`/`NOT_APPLICABLE` gate, all proven by tests.

---

## 14. Versioning

Every metric family exports a `*_MODEL_VERSION = 'v1'` constant (`HELP_DEPENDENCY_MODEL_VERSION`, `LEARNING_VELOCITY_MODEL_VERSION`, `CALIBRATION_AGGREGATE_MODEL_VERSION`, `PREREQUISITE_GAP_MODEL_VERSION`, `TRANSFER_COVERAGE_MODEL_VERSION`, `STUDY_PLAN_ADHERENCE_MODEL_VERSION`, `PERSISTENCE_MODEL_VERSION`), carried in every value's `quality.modelVersion`. Audited existing versioning conventions first (`mastery_policies.version`, `mastery_policy_version`/`projection_version` on `concept_knowledge_state`) — those are genuine, already-existing StudyUs policy-version infrastructure for a different concern (mastery/Knowledge-State thresholds); reusing them for derived-metric algorithm identity would conflate two unrelated version axes, so a lightweight, separate, Phase-1E-scoped constant was used instead — plain code constants, not a configuration platform.

---

## 15. Digital Twin Integration

`ConceptView` gained `helpDependency`, `learningVelocity`, `persistence`, and a genuinely-implemented `prerequisiteGaps` (replacing Phase 1C's permanent `NOT_AVAILABLE_YET` stub — the old `PrerequisiteGap` interface was retired, replaced by `PrerequisiteGapsSummary`/`PrerequisiteGapDetail`). `SubjectView` gained `aggregateCalibration`, `aggregateVelocity`, `transferCoverage`. `LearnerModel` (Overview) gained `calibration`, `velocitySummary`, `studyPlanAdherence`. All wired through `src/lib/learner-twin/service.ts`'s existing four projections — no new top-level service, no fifth projection.

---

## 16. DecisionContext Integration

`learningVelocity`, `helpDependency`, `prerequisiteGaps` changed from `Capability<unknown>`/`Capability<PrerequisiteGap[]>` (permanently `NOT_AVAILABLE_YET`) to `Capability<MetricResult<T>>` — the outer `Capability` is now always `available: true` (the computation genuinely exists as of Phase 1E); the inner `MetricResult` may still be per-instance `available: false`. Populated using the same per-concept reader functions `ConceptView` uses (no duplicate logic). No other field was added to `DecisionContext` — Aggregate Calibration/Transfer Coverage/Study Plan Adherence are NOT exposed there, since no current or planned decision consumer needs subject/learner-level aggregates at the single-concept `DecisionContext` granularity (Step 23's "populate only metrics intended as future decision-engine inputs" followed narrowly, not maximally).

---

## 17. Existing Decision Consumer Invariant

`tests/unit/metrics-architecture-invariants.test.ts` statically scans `remediation.service.ts`, `cognitive-diagnosis.service.ts`, `tutor-strategy.service.ts`, and `verification-triggers.ts` (comments stripped) for `learningVelocity`/`helpDependency`/`prerequisiteGaps` — **zero matches**. Their pure decision functions (`determineRemediationPattern`, `learnerGapFactor`, `selectTutorStrategy`, etc.) are byte-for-byte unchanged this phase (confirmed via `git diff --stat`: zero diff on all four files). `CURRENT_DECISION_ALGORITHM_CHANGES = 0`.

---

## 18. Read-Only Verification

`tests/unit/metrics-architecture-invariants.test.ts` also scans every file in `src/lib/learner-twin/metrics/` for `INSERT`/`UPDATE`/`DELETE` — none found. `DERIVED_METRIC_DB_WRITES = 0`. No caching was introduced (Step 22/28) — every metric is computed on read, every time, per the explicit "no premature cache" instruction. No `recordDecisionEvent` call exists anywhere in the metrics module (Step 27) — confirmed by the same test file; metric calculation is not itself a decision, and nothing floods `decision_events`.

---

## 19. Query / Performance Review

Every metric batches its reads — **never** one query per concept inside a loop (Step 28), verified by direct code inspection of each `read*` function:

- **Help Dependency**: 3 queries (policy, evidence, verification) + `getIndependentMastery`'s own 1 query = 4.
- **Learning Velocity**: exactly 3 fixed-shape batched queries regardless of concept-list size (evidence aggregation, milestone events via `DISTINCT ON`, current states) — proven by the same query count whether called for 1 concept or many.
- **Aggregate Calibration**: 1 query, grouped in memory.
- **Prerequisite Gaps**: `getPrerequisites` (1) + labels/mastery/state (3 batched) = 4.
- **Transfer Coverage**: 2 queries (eligible concepts, transfer evidence).
- **Study Plan Adherence**: 2 queries (plan lookup, sessions with a correlated `EXISTS` sub-query — one round trip, not N+1).
- **Persistence**: 1 query.

Resulting projection footprint: `getConceptView`/`getDecisionContext` each add ~11-12 bounded queries (Persistence only on ConceptView); `getSubjectView` adds ~6 (calibration 1, velocity 3, transfer 2); `getOverview` adds ~7 (evidenced-concepts 1, calibration 1, velocity 3, adherence 2). All bounded by real evidenced-concept/prerequisite counts, never full curriculum scans.

---

## 20. Tests Added / Modified

| File | Status | Tests | Covers |
|---|---|---|---|
| `tests/unit/metrics-help-dependency.test.ts` | NEW | 8 | Independent-only, assisted-only, mixed, band always null, verification consistency, insufficient-evidence gate. |
| `tests/unit/metrics-learning-velocity.test.ts` | NEW | 9 | Reaches provisional, reaches validated, never reaches, already-mastered-before-history, large gap, median aggregation, coverage reporting, empty input. |
| `tests/unit/metrics-calibration.test.ts` | NEW | 5 | Qualifying concepts, thin coverage, sub-threshold concept exclusion, conflicting calibration, zero rows. |
| `tests/unit/metrics-prerequisite-gaps.test.ts` | NEW | 6 | No relationships (NOT_APPLICABLE), healthy, missing evidence, weak, low relationship confidence (no severity formula), multiple prerequisites. |
| `tests/unit/metrics-transfer-coverage.test.ts` | NEW | 5 | No evidence, one sample, multiple successful contexts, zero-eligible gate, engaged-only denominator. |
| `tests/unit/metrics-study-plan-adherence.test.ts` | NEW | 5 | No active plan, no due sessions, full completion, partial completion, windowDays override. |
| `tests/unit/metrics-persistence.test.ts` | NEW | 7 | Failure→return→success, failure→no return, repeated failure, no failures, delayed recovery, no personality label. |
| `tests/unit/metrics-architecture-invariants.test.ts` | NEW | 7 | Response-timing non-integration (Step 19), existing decision consumers unchanged (Step 24), canonical single module + read-only (Step 21/22), no decision_events emitted (Step 27), no personality labels. |
| `tests/unit/learner-twin.test.ts`, `learner-twin-consumer-regression.test.ts`, `learner-twin-response-timing.test.ts` | MODIFIED | 0 net new | New mock branches for Phase 1E's queries; 2 tests updated to reflect `prerequisiteGaps`/`DecisionContext` fields now being genuinely computed instead of permanently deferred. |

**52 new tests this phase.** Full suite: 81 files / 864 tests, all passing.

---

## 21. Architecture Regression Counts

```
CANONICAL_DERIVED_METRIC_LAYER        = 1
NEW_DB_TABLES                         = 0
NEW_DB_COLUMNS                        = 0
NEW_MIGRATIONS                        = 0
DERIVED_METRIC_DB_WRITES              = 0
CURRENT_DECISION_ALGORITHM_CHANGES    = 0
MASTERY_BEHAVIOR_CHANGES              = 0
KNOWLEDGE_STATE_BEHAVIOR_CHANGES      = 0
RESPONSE_TIME_DIRECT_DECISION_RULES   = 0
NEW_PERSONALITY_OR_LEARNING_STYLE_LABELS = 0
```

---

## 22. Application Validation

```
npx tsc --noEmit     -> clean, 0 errors
npx vitest run       -> 81 test files passed (81), 864 tests passed (864)
npm run build        -> succeeded
npm run db:status    -> LEDGER = FOUND; 2 applied, 0 pending, 0 drifted
```

---

## 23. Production Baseline

Verified before implementation and again at completion: local `HEAD` = `907f669d5825b4e0307da236d9cde78097d6aabc` ("feat: capture behavioral response time evidence", Phase 1D-P), matching the last-verified production commit exactly. Nothing has been committed or pushed this phase. Per explicit instruction, Phase 1E is **not deployed** — external architecture review happens first.

---

## 24. Git Diff

**New** (17): `src/lib/learner-twin/metrics/{types,help-dependency,learning-velocity,calibration,prerequisite-gaps,transfer-coverage,study-plan-adherence,persistence,index}.ts` (9 files), 8 new test files (§20).

**Modified** (7): `src/lib/learner-twin/{index,service,types}.ts`, `docs/architecture/digital-learning-twin.md`, `tests/unit/{learner-twin,learner-twin-consumer-regression,learner-twin-response-timing}.test.ts`.

No migration file. No change to `mastery.ts`, `knowledge-state.service.ts`, `remediation.service.ts`, `cognitive-diagnosis.service.ts`, `tutor-strategy.service.ts`, `verification-triggers.ts`, or any AI prompt/model wiring (all confirmed zero diff). No Decision Engine, no Adaptive Teaching. No UI file touched.

(Three untracked local files predate this phase and are out of its scope: `docs/audits/STUDYUS_PHASE_0G_PRODUCTION_ALIGNMENT.md`, `STUDYUS_PHASE_1C_P_PRODUCTION_RELEASE.md`, `STUDYUS_PHASE_1D_P_PRODUCTION_RELEASE.md` — prior release reports, unrelated to Phase 1E.)

---

## 25. Remaining Risks (max 5)

1. **`AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS = 2` is a Phase-1E-introduced constant, not derived from existing policy** — disclosed transparently (§6), but worth explicit confirmation during external review that 2 is the right minimum rather than a higher bar.
2. **UTC calendar-day bucketing for Learning Velocity's active-study-day counts** (Step 7's documented simplification) can misclassify a study session crossing local midnight for a learner far from UTC — accepted per the explicit "do not introduce timezone architecture" instruction, but a real accuracy limitation for those learners.
3. **Study Plan Adherence's "completed" proxy (any evidence on the scheduled date) cannot distinguish "the student followed the specific planned session" from "the student happened to study something else that day"** — an honest, disclosed limitation of deriving adherence from `learning_evidence` presence rather than the (dead) `completion_status` column, not a bug, but a real semantic looseness.
4. **No production traffic has exercised any of these read paths yet** — all verification is against unit fixtures, per the explicit no-deploy constraint; query-cost estimates (§19) are structural, not measured against real evidenced-concept-count distributions.
5. **`DecisionContext`'s three new fields have zero current consumers by design** — correct for this phase, but means their real-world shape has not yet been validated against an actual future Decision Engine's needs; a first real consumer may reveal a field is missing or shaped inconveniently.

---

## 26. Definition of Done

- [x] metric source audit complete
- [x] common quality contract exists
- [x] help dependency implemented or explicitly deferred with reason
- [x] learning velocity implemented with temporal-history guard
- [x] aggregate calibration implemented
- [x] prerequisite gaps implemented without arbitrary weighting
- [x] transfer coverage implemented
- [x] study-plan adherence implemented
- [x] conservative persistence summary implemented
- [x] response timing not directly interpreted
- [x] insufficient evidence explicit
- [x] no metric writes
- [x] DecisionContext exposes only justified metrics
- [x] current decision consumers unchanged
- [x] no schema change
- [x] tests pass
- [x] build passes

---

## 27. Final Decision

**A. Are the target derived learner metrics implemented?** **YES** — all 7 areas, each with a genuine implementation (no area was silently skipped or stubbed as always-unavailable).

**B. Did Phase 1E introduce any learning decision logic?** **NO** — no reteach/advance/backtrack/challenge/verify/space/transfer logic anywhere; every metric is a measurement, consumed by nothing today.

**C. Did any metric require arbitrary unsupported weights?** **NO** — Help Dependency's `band` stayed `null` rather than invent one; Prerequisite Gaps reused the certified `MasteryState` classification instead of a synthetic formula; the one genuinely new constant (Aggregate Calibration's minimum qualifying-concept count) is disclosed, not silently invented.

**D. Are insufficient-evidence states explicit?** **YES** — every metric returns a typed `MetricResult` with an explicit `reason`/`detail`, proven by dedicated tests for each metric family.

**E. Is Learning Velocity honest about pre-2026-08-31 temporal-history limitations?** **YES** — `historyComplete: false` is a distinct, tested state, never collapsed with "not reached" or backfilled from current state.

**F. Are prerequisite gaps learner-specific without duplicating the concept graph?** **YES** — reuses `getPrerequisites` directly; no new table, no parallel graph.

**G. Does response time directly classify guessing/fluency/struggle?** **NO** — zero Phase 1E metric reads response-time data at all, enforced by a static architecture test.

**H. Do existing remediation/diagnosis/tutor algorithms behave exactly as before?** **YES** — zero diff on all three service files, confirmed by `git diff --stat` and a static reference-scan test.

**I. Did any DB schema change occur?** **NO** — `db:status` unchanged at 2 applied / 0 pending / 0 drifted.

**J. Is Phase 1E ready to certify?** **YES_WITH_CONDITIONS** — functionally complete and fully tested; conditioned on external architecture review before commit/deploy, and on the 5 documented, non-blocking risks in §25.

**K. Maximum five issues remaining before Phase 1F Learner Model Certification.** See §25 (5 listed): the disclosed aggregate-calibration minimum, UTC calendar-day bucketing, the adherence "completed" proxy's semantic looseness, no production-traffic verification yet, and `DecisionContext`'s new fields having no real consumer to validate their shape against yet.
