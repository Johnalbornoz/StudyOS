# STUDYUS LEARNING OS — PHASE 1C: CORE DIGITAL LEARNING TWIN READ ARCHITECTURE — IMPLEMENTATION REPORT

**Date**: 2026-08-31
**Scope**: Implement the canonical `LearnerModelService` read architecture designed in Phase 1B (`src/lib/learner-twin/`), migrate the lowest-risk consumers onto it, remove the one confirmed-dead legacy read model, and document the result.
**Out of scope (confirmed not touched — see §22)**: mastery algorithm, Knowledge State algorithm, verification logic, learning evidence writes, schema, response-time telemetry, Learning Velocity / Help Dependency / Productive Struggle scores, misconception lifecycle, error taxonomy, academic onboarding, confidence sampling policy, Learning Decision Engine / Adaptive Teaching, quiz grading, AI prompts/models.
**Deployment status**: **NOT DEPLOYED.** Nothing in this phase has been committed, pushed, or deployed. Production HEAD remains `afa2e2a1ce5db450d4ee9541890aff94d9a34b96` (Phase 0G). Per explicit instruction, external architecture review happens before any commit, and Phase 1D has not started.

> **AMENDMENT (Phase 1C-R, not a rewrite of the record below)**: External architecture review found §16/§17's classification of `getLearnerConceptState`'s 3 decision-adjacent callers ("domain-specific and justified, since no algorithm is duplicated") too narrow — the real requirement is that decision consumers enter through the canonical `getDecisionContext` boundary, not merely avoid recomputing an algorithm. Phase 1C-R migrated all 3 callers and closed that boundary. §2, §16, §17, and §27(I) below reflect Phase 1C's original findings and are left as originally written; see `docs/audits/STUDYUS_PHASE_1C_R_CANONICAL_CONSUMER_CLOSURE.md` for the corrected, current state.

---

## 1. Executive Summary

**`CANONICAL_LEARNER_MODEL = IMPLEMENTED`**

The core read architecture designed in Phase 1B is implemented, tested, and working end to end: a single module (`src/lib/learner-twin/`, 4 files, 1,120 lines) exposes four canonical projections (`getOverview`, `getSubjectView`, `getConceptView`, `getDecisionContext`) built from a shared set of composable, provably read-only sub-readers. Two real UI consumers (subject detail page, concept detail page) have been migrated onto it with proven before/after output equivalence. One confirmed-dead legacy read model (`getLearnerModelSummary`) has been removed. Three other legacy read models were evaluated for migration and deliberately retained as domain-specific, not fragmentation (§16).

This phase also surfaced and fixed a genuine pre-existing semantic risk: the concept detail page's original migration draft would have silently swapped a forward-looking "forgetting risk" retention estimate for a backward-looking "evidence-gap" retention dimension — two different pedagogical signals that share an English name. This was caught by a regression test before merge, not shipped, and is now permanently documented in both code and a dedicated test (§19, §20).

No schema changed. No write path changed. No AI prompt, model, or decision logic changed. `tsc`, the full test suite (67 files / 749 tests), `next build`, and `db:status` are all clean (§21). Production is unaffected and unchanged (§23).

---

## 2. Pre-Implementation Fragmentation Audit (fresh, this phase)

Re-run at the start of implementation, independent of Phase 1A's numbers, to confirm the baseline before making any change:

| Function | File | Callers found | Notes |
|---|---|---|---|
| `getLearnerModelSummary` | `learner-model.service.ts` | **0** | Confirmed dead a second time. Removed this phase. |
| `getSubjectLearnerModel` | `learner-model.service.ts` | 1 (`subjects/[id]/page.tsx`) | Migration target for the subject page. |
| `getLearnerConceptState` | `learner-model.service.ts` | 4 (`remediation.service.ts`, `cognitive-diagnosis.service.ts` ×2 call sites, `tutor-strategy.service.ts`) + 1 UI page (`concepts/[conceptId]/page.tsx`) | UI caller migrated this phase; the 4 service callers deliberately not touched (§17). |
| `getLearningOSSnapshot` | `learning-os-snapshot.service.ts` | 2 (`dashboard/today/page.tsx`, `dashboard/learning-debt/page.tsx`) | Decision/plan generator, not a learner-state read model. Retained (§16). |
| `getStudentProgressOverview` | `progress-overview.service.ts` | 1 (`dashboard/page.tsx`) | Gamification/achievement aggregation, distinct semantics. Retained (§16). |

---

## 3. Identity Contract (as implemented)

Per the user's explicit identity correction, `StudentId` (`src/lib/learner-twin/types.ts`) is implemented as a **plain, non-branded `string` alias** — a logical/opaque learner identifier, not "the `profiles.id` space" and not a new identifier. It is documented in `types.ts` with an extensive comment stating exactly this. No identity-conversion function was written or is needed: both `students.id` and `profiles.id` already hold the same UUID for a given student under the existing Phase 0C compatibility contract (`getOrCreateStudentId`).

Individual sub-readers in `readers.ts` query whichever FK family is correct for their domain internally (mastery/evidence-adjacent readers → `profiles.id`-linked tables such as `mastery_records`, `learning_evidence`, `errors`; verification/Knowledge-State-adjacent readers → `students.id`-linked tables such as `concept_knowledge_state`, `assessment_occurrences`, `student_availability`). **None of this is exposed in any type exported from `types.ts` or in any field returned by the four public projections.** Verified by a static test in `tests/unit/learner-twin.test.ts` that scans every projection's output for the literal strings `profilesStudentId`/`studentsStudentId`/similar and asserts they never appear.

No identity schema was modified. No new identifier was introduced.

---

## 4. Canonical Types (`src/lib/learner-twin/types.ts`, 324 lines)

Key exports:
- `StudentId = string` — see §3.
- `SignalSourceType` = `'SYSTEM_FACT' | 'DETERMINISTIC_DERIVATION' | 'AI_INFERENCE' | 'STUDENT_SELF_REPORT' | 'SCHOOL_REPORTED' | 'BEHAVIOR_OBSERVATION'`.
- `SignalQuality` — `{ sourceType, lastUpdatedAt, sampleSize?, confidence?, freshness? }`, attached to every domain signal.
- `Capability<T>` discriminated union — `NotYetAvailable | Available<T>`, with `notYetAvailable(plannedPhase?)` / `available(value)` constructors. Used everywhere a Phase 1D/1E metric is referenced but not yet computable, so the runtime never fabricates a plausible-looking `0` or `null` for something that simply hasn't been built (§15).
- Domain signals: `MasterySignal`, `KnowledgeStateSignal`, `RetentionSignal`, `TransferSignal`, `MetacognitionSignal`, `IndependenceSignal`, `MisconceptionSummary`, `EvidenceSummary`, `ErrorPatternSummary`, `StateTransitionEvent`, `LanguageContext`, `AcademicContext`, `SubjectAcademicContext`, `PlanningContext`, `AssessmentPressure`, `PrerequisiteGap`, `DataQualitySummary`.
- Projections: `SubjectSummary`, `LearnerModel`, `ConceptSummary`, `NeedsAttentionItem`, `SubjectView`, `ConceptView`, `DecisionContext`, `ProjectionOptions`.

`SubjectView.cognitiveSummary` was extended beyond the minimum Phase 1B sketch, during implementation, to carry `evidenceCoverage: {totalConcepts, evidencedConcepts, percent} | null` (not a bare percent), `activeLearningDebtCount: number`, and `atRiskCount: number` — required because the subject detail page's existing UI consumes exactly those fields, and dropping them would have been a UI regression, not a simplification.

---

## 5. `LearnerModelService` Architecture

```
LearnerModelService (src/lib/learner-twin/service.ts, 293 lines)
  |
  +-- getOverview(studentId, options?)              -> LearnerModel
  +-- getSubjectView(studentId, subjectId, options?) -> SubjectView
  +-- getConceptView(studentId, conceptId, options?) -> ConceptView | null   (options.includeHistory)
  +-- getDecisionContext(studentId, conceptId, options?) -> DecisionContext

  All four are plain exported async functions (matches codebase convention;
  no classes anywhere else in the services layer).
```

`getConceptView` returns `null` when no `mastery_records` row exists for the (student, concept) pair — this matches the retained `getLearnerConceptState`'s existing contract exactly, so callers that already handle a `null` state need no behavioral change.

---

## 6. Shared Sub-Readers (`src/lib/learner-twin/readers.ts`, 459 lines)

New, purpose-built, provably-pure readers: `readAcademicContext`, `toSubjectAcademicContext`, `readLanguageContext`, `readSubjects`, `readSubjectMasteryRows`, `readMasteryRow`, `toMasterySignal`, `readKnowledgeStateSignal`, `readIndependenceSignal`, `readMetacognitionSignal`, `toRetentionSignal`, `readTransferSignal`, `readMisconceptionSummary`, `readRecentEvidence`, `readConceptErrorPatterns`, `readPlanningContext`, `readAssessmentPressure`, `readStateHistory`.

Re-exported and called directly (reused, not reimplemented — same certified algorithms): `getSubjectLearnerModel`, `getSubjectKnowledgeState`, `getActiveMasteryPolicy`, `getRecurringMisconceptions`, `getEvidenceCoverage`, `tryMasteryScore`, `masteryToPercent`, `averageMasteryScore`, `getConceptIntelligenceBatch`.

All four public projections are built from this same shared set at different depth/granularity — there are no per-projection duplicate implementations.

---

## 7. Source-of-Truth Mapping

| Signal | Table(s) | Reader |
|---|---|---|
| Mastery | `mastery_records` | `readMasteryRow` / `toMasterySignal` |
| Knowledge State | `concept_knowledge_state` (via `getConceptKnowledgeState`) | `readKnowledgeStateSignal` |
| Independence | `mastery_records`, `learning_evidence` (via existing atomic functions) | `readIndependenceSignal` |
| Metacognition / confidence calibration | `learning_evidence.confidence_before_answer` | `readMetacognitionSignal` |
| Retention (forgetting risk) | `mastery_records` (fresh `calculateForgettingRisk`) | `toRetentionSignal` |
| Retention (KS dimension) | `concept_knowledge_state.retention_score` | `readKnowledgeStateSignal` → `toRetentionSignal` |
| Transfer | `learning_evidence` where `source_type = 'TRANSFER'` | `readTransferSignal` |
| Misconceptions | `misconception_signatures`, `student_misconceptions` | `readMisconceptionSummary` / `getRecurringMisconceptions` |
| Evidence history | `learning_evidence` | `readRecentEvidence` |
| Error patterns | `errors` | `readConceptErrorPatterns` |
| Planning / availability | `student_availability` | `readPlanningContext` |
| Assessment pressure | `assessment_occurrences` | `readAssessmentPressure` (own SELECT, see §19) |
| State history | `decision_events` (Phase 0E2) | `readStateHistory` |
| Language | `user_language_preferences`, `students.language`, `subjects` overrides | `readLanguageContext` |

No new table. No new column. Confirmed by `db:status` (§21).

---

## 8. Data Quality Contract (as implemented)

Every domain signal carries a `SignalQuality`: `sourceType`, `lastUpdatedAt`, and — where meaningful — `sampleSize`, `confidence`. Practical rules actually applied in `readers.ts`:
- Direct table reads (mastery, Knowledge State) → `sourceType: 'SYSTEM_FACT'` or `'DETERMINISTIC_DERIVATION'`, no fabricated confidence.
- Confidence-calibration signals → `sourceType: 'STUDENT_SELF_REPORT'`, with the real `sampleSize` from the evidence rows used, never a made-up number.
- Below-threshold sample sizes are tagged `INSUFFICIENT_EVIDENCE` in `DataQualitySummary` rather than silently returned as if trustworthy — verified by test (§20).
- No signal is ever tagged `AI_INFERENCE` in this phase's runtime output, because no signal computed by this module goes through an AI call — confirmed by both code inspection and a test asserting no fabricated AI provenance appears.

---

## 9. Language Resolution (`readLanguageContext`)

Implements the fallback chain: `user_language_preferences` (if present) → `students.language` → hardcoded `'en'`. Subject-level overrides (`subjects.target_language` / `quiz_language_mode`) are only queried when a `subjectId` is passed to a projection — `getOverview` never pays for a per-subject language query it doesn't need. `subjectInstructionLanguage` falls back to the resolved `preferredLearningLanguage` when a subject's `target_language` is `null`. All three fallback tiers plus the subject-override behavior are covered by 7 dedicated tests in `tests/unit/learner-twin-language.test.ts`, including an explicit assertion that the resolver never writes.

---

## 10–13. The Four Projections

**`getOverview(studentId, options?)` → `LearnerModel`**: student-wide academic context, language context, one `SubjectSummary` per subject (aggregate only, not full concept trees), planning context, `derivedMetrics: { evidenceCoveragePercent }`, and `dataQuality`. Bounded by `options.subjectIds`/`conceptIds` so it never silently enumerates a student's entire concept graph.

**`getSubjectView(studentId, subjectId, options?)` → `SubjectView`**: reuses `getSubjectLearnerModel` directly (not reimplemented) for `cognitiveSummary`, plus subject academic context, bounded `ConceptSummary[]`, and `needsAttention` items.

**`getConceptView(studentId, conceptId, options?)` → `ConceptView | null`**: the deepest projection — mastery, Knowledge State, independence, metacognition, retention (both signals, kept distinct — §19), transfer, misconceptions, bounded recent evidence, error patterns, assessment context, optional `stateHistory` (only with `options.includeHistory`), and `prerequisiteGaps` as `Capability<PrerequisiteGap[]>` (always `notYetAvailable('1E')` in this phase — §15).

**`getDecisionContext(studentId, conceptId, options?)` → `DecisionContext`**: the minimal, decision-optimized slice designed for a future Decision Engine — no error patterns, no transfer, no full evidence list. `learningVelocity`, `helpDependency`, and `prerequisiteGaps` are always `Capability`-wrapped `NotYetAvailable` values, never fabricated.

## 14. History Option

`includeHistory: true` on `getConceptView` triggers `readStateHistory`, a bounded (default limit 20) query against `decision_events` filtered to `MASTERY_UPDATED` and `KNOWLEDGE_STATE_PROJECTED` events — reusing Phase 0E2's audit trail rather than introducing a new history table, per Phase 1B's temporal-model design. Caveat carried over from the architecture doc: history is only populated from Phase 0E2's production activation date (2026-08-31) forward.

---

## 15. Explicitly Deferred to 1D/1E (never fabricated this phase)

| Field | Projection(s) | Status |
|---|---|---|
| `prerequisiteGaps` | `ConceptView`, `DecisionContext` | `Capability`, `NOT_AVAILABLE_YET`, plannedPhase `'1E'` |
| `learningVelocity` | `DecisionContext` | `Capability`, `NOT_AVAILABLE_YET`, plannedPhase `'1E'` |
| `helpDependency` | `DecisionContext` | `Capability`, `NOT_AVAILABLE_YET`, plannedPhase `'1E'` |
| Response-time / time-on-task telemetry | (none) | Not represented; requires new `learning_evidence.metadata` fields, not built this phase |
| Misconception lifecycle status changes | (none) | Read-only reuse of existing signatures only; no lifecycle state machine change |
| Error taxonomy reconciliation | (none) | Confirmed no DB CHECK constraint blocks it (free `varchar(30)`), but no taxonomy change made this phase |

Every one of these is verified, in tests, to resolve to an explicit `{available: false, reason: 'NOT_AVAILABLE_YET', plannedPhase: '1E'}` value rather than `null`, `0`, or an omitted field that could be misread as "measured zero."

---

## 16. Legacy Read Model Migration Table

| Function | Disposition | Reasoning |
|---|---|---|
| `getLearnerModelSummary` | **REMOVED** | 0 live callers confirmed twice (Phase 1A and this phase). Body deleted, replaced with a comment pointing to `getOverview`. Its `LearnerModelSummary` interface removed too. |
| `getSubjectLearnerModel` | **RETAINED, now internal-only** | Called directly from `getSubjectView` (reuse). Its 1 former external caller (subject page) now calls `getSubjectView` instead. |
| `getLearnerConceptState` | **RETAINED, domain-specific, justified** | Computes via the exact same certified atomic functions (`getRetention`, `getIndependentMastery`, etc.) that `readers.ts` also calls — zero actual algorithm duplication to eliminate. Wrapping it would create a circular import (`readers.ts` already imports from `learner-model.service.ts`) and add unnecessary query cost (evidence/errors/assessment/transfer/misconceptions) to 3 performance-sensitive decision-adjacent services for no benefit. See §17. |
| `getLearningOSSnapshot` | **RETAINED, domain-specific, justified** | A decision/plan generator (invokes `getLearningDecisions` and Phase 3D orchestrator functions) — not a learner-state read model at all, despite superficially similar naming. |
| `getStudentProgressOverview` | **RETAINED, domain-specific, justified** | Gamification/achievement aggregation (`validatedMasteryCount`, `retentionDemonstratedCount`, `independentEvidenceCount` gated by live mastery-policy thresholds) — a genuinely distinct concept not present in the Twin's contract. Already N+1-safe via its own bulk-query pattern. |

**Fragmented LIVE learner aggregate implementations remaining after this phase: 0** — see §27(I) for the precise definition this counts against.

---

## 17. Consumer Migration Table

| Consumer | Before | After | Output contract diff |
|---|---|---|---|
| `dashboard/subjects/[id]/page.tsx` | `getSubjectLearnerModel(studentId, id)` | `getSubjectView(studentId, id)` (`.cognitiveSummary` extracted) | None functionally — `avgMastery`→`avgMasteryPercent`, `avgRetention`→`avgRetentionScore` renamed at the field level only, same values. Proven by `tests/unit/learner-twin.test.ts`'s `getSubjectView` fixture assertions. |
| `dashboard/subjects/[id]/concepts/[conceptId]/page.tsx` | `getLearnerConceptState(studentId, conceptId)` | `getConceptView(studentId, conceptId)` (adapted to the old 6-field shape) | **5 of 6 fields identical** (`masteryScore`, `independentMastery`, `evidenceStrength`, `confidence`, `confidenceCalibration`) — proven by `tests/unit/learner-twin-consumer-regression.test.ts`. **`retention` is a deliberate, documented exception**: the page now computes `100 - conceptView.retention.forgettingRisk` to preserve the OLD field's forward-looking spaced-repetition semantics exactly, rather than the superficially similarly-named `conceptView.retention.retentionScore` (a different, backward-looking Knowledge State dimension). See §19 for how this was caught. |
| `remediation.service.ts`, `cognitive-diagnosis.service.ts` (×2), `tutor-strategy.service.ts` | `getLearnerConceptState(...)` | **Unchanged** | Deliberately not migrated — see §16. |
| `dashboard/today/page.tsx`, `dashboard/learning-debt/page.tsx` | `getLearningOSSnapshot(...)` | **Unchanged** | Deliberately not migrated — different domain (§16). |
| `dashboard/page.tsx` | `getStudentProgressOverview(...)` | **Unchanged** | Deliberately not migrated — different domain (§16). |

---

## 18. Query / Performance Review

- Subject-level aggregation reuses `getSubjectLearnerModel` and `getConceptIntelligenceBatch`, both already N+1-safe bulk queries — not reimplemented.
- `readSubjectMasteryRows` is a purpose-built bulk query (one round trip for all of a subject's concepts), avoiding a per-concept N+1 inside `getSubjectView`.
- Every projection accepts `options` (`subjectIds?`, `conceptIds?`, `includeHistory?`) to bound query scope; `getOverview` does not eagerly enumerate a student's full concept graph.
- `readStateHistory` and `readRecentEvidence` are both bounded with default `LIMIT`s (20 and 10/5 respectively), never unbounded scans.

---

## 19. Read-Only Verification

**Static invariant test**: `tests/unit/learner-twin.test.ts` source-scans every file in `src/lib/learner-twin/*.ts` for `INSERT`/`UPDATE`/`DELETE` tokens and asserts none exist. Passing.

**Hidden-write findings, disclosed per Step 19's explicit instruction** — two existing "read" functions elsewhere in the codebase were evaluated for reuse and rejected because they carry side effects:
1. `mastery.service.ts::getStudentMastery(..., ensureLabels=true)` — fire-and-forget writes concept localizations via `ensureConceptLocalizations`.
2. `assessment.service.ts::getUpcomingForStudent` — can `INSERT` a new `assessment_occurrences` row via `ensureRecurringOccurrence`.

Neither is called anywhere in `src/lib/learner-twin/`. `readAssessmentPressure` performs its own direct, side-effect-free `SELECT` against `assessment_occurrences` instead of calling `getUpcomingForStudent`. This is documented in `readers.ts`'s header comment and now in `docs/architecture/digital-learning-twin.md`'s "Read architecture" section.

**Critical bug caught by testing, not shipped**: while writing the concept-page migration's before/after comparison test, the first draft mapped the new page's `retention` field to `conceptView.retention.retentionScore` (the Knowledge State dimension). The regression test failed with `expected null to be 64` against the real fixture — not a mock artifact, a genuine semantic mismatch, because the *old* field (`getLearnerConceptState.retention`) is actually `learner-model.service.ts::getRetention()`, algebraically `100 - forgettingRisk`, a completely different computation from the Knowledge State `retention_score` dimension. The adapter was corrected to `100 - conceptView.retention.forgettingRisk`, extensive comments were added at both the page and the report level, and the regression test was rewritten to explicitly assert and preserve this distinction rather than silently pick one value. Per Phase 1B's own instruction ("if two existing functions produce intentionally different values because their semantics differ: preserve the semantic distinction, document it") this is the correct outcome, and it is now impossible to accidentally regress without failing `tests/unit/learner-twin-consumer-regression.test.ts`.

---

## 20. Tests Added

23 new tests across 3 new files (plus 1 test removed from an existing file):

| File | Tests | Covers |
|---|---|---|
| `tests/unit/learner-twin.test.ts` | 14 | Read-only invariant (source scan), identity contract (no `profilesStudentId`/`studentsStudentId` leakage), all 4 projections against one coherent fixture, projection consistency (same mastery score across views), data quality (`SYSTEM_FACT` tagging, `STUDENT_SELF_REPORT` sample sizes, `INSUFFICIENT_EVIDENCE` below threshold, no fabricated AI provenance). |
| `tests/unit/learner-twin-language.test.ts` | 7 | Full 3-tier language fallback chain, subject-override-only-when-requested behavior, `subjectInstructionLanguage` fallback, no-write verification. |
| `tests/unit/learner-twin-consumer-regression.test.ts` | 2 | Before/after output-contract equivalence for the concept-page migration; explicit, documented proof of the retention semantic distinction (§19). |
| `tests/unit/learner-model.test.ts` | −1 | `getLearnerModelSummary` describe block removed (function deleted), replaced with a pointer comment to the new coverage. |

---

## 21. Application Validation (exact results, this phase)

- `npx tsc --noEmit` → **clean, zero errors.**
- `npx vitest run` → **67 test files passed (67), 749 tests passed (749).**
- `npm run build` → **succeeded**, full route manifest generated, no build errors.
- `npm run db:status` → **`LEDGER = FOUND`, 2 applied, 0 pending, 0 drifted** — identical to the pre-Phase-1C baseline, confirming zero schema impact.

---

## 22. Architecture Regression Scan

- `CANONICAL_LEARNER_MODEL_SERVICE` = 1 module, 4 files (`types.ts`, `readers.ts`, `service.ts`, `index.ts`), 1,120 lines.
- `LEARNER_MODEL_DB_WRITES` = 0 (verified §19).
- `NEW_SCHEMA_CHANGES` = 0 (verified §21).
- Zero diff on `mastery.ts`, `knowledge-state.service.ts`, `mastery.service.ts` — the certified mastery/Knowledge-State algorithms are byte-for-byte unchanged.
- Zero new files under any decision-engine or adaptive-teaching path — none exist, none were created.
- No AI prompt, model, or provider call added or modified anywhere in this diff.

---

## 23. Production Baseline

`PRODUCTION_APPLICATION_VERSION = VERIFIED_BASELINE`. `git log -1` → HEAD is still `afa2e2a1ce5db450d4ee9541890aff94d9a34b96` ("feat: establish learning os foundation — identity, db governance, ai gateway, audit trail"), the Phase 0G commit. Nothing from Phase 1A, 1B, or 1C has been committed. Production is unaffected by this phase's work.

---

## 24. Git Diff Summary (current working tree, uncommitted)

**Modified** (4): `src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx`, `src/app/dashboard/subjects/[id]/page.tsx`, `src/services/learner-model.service.ts`, `tests/unit/learner-model.test.ts`.

**New** (4 files/dirs, all untracked): `src/lib/learner-twin/` (4 files), `tests/unit/learner-twin.test.ts`, `tests/unit/learner-twin-language.test.ts`, `tests/unit/learner-twin-consumer-regression.test.ts`.

(`docs/architecture/digital-learning-twin.md` and the Phase 1A/1B/0G audit reports also show untracked in `git status` — they predate this phase's code changes and are documentation only, not part of the code-diff scope this phase's non-goals govern.)

This matches the phase's allowed scope exactly: canonical types/service, shared read utilities, existing-caller migrations, and tests — no migration, no telemetry, no UI redesign beyond field-source swaps, no new learning algorithm.

---

## 25. Remaining Risks (max 5)

1. **`getLearnerConceptState`'s 4 remaining service callers still compute retention as `100 - forgettingRisk` under a field literally named `retention`.** No code risk today (unchanged, working), but the naming collision this phase uncovered is a standing trap for the *next* engineer who touches those 4 files without reading this report. Recommend a doc comment at the `getRetention()` definition site itself in a future phase (not done here — out of scope, no algorithm change permitted).
2. **`stateHistory` (via `decision_events`) is data-thin until more history accumulates**, since Phase 0E2 only started recording on 2026-08-31. Any 1D/1E feature that leans on `includeHistory` early will see mostly-empty history for existing students.
3. **`SubjectView.cognitiveSummary`'s expanded shape (`evidenceCoverage`/`activeLearningDebtCount`/`atRiskCount`) was added mid-implementation to match the real page's needs**, not pre-specified in Phase 1B's original sketch — a reasonable, disclosed adaptation, but worth a conscious look during external architecture review rather than being waved through as "as designed."
4. **Two hidden-write functions were found and avoided this phase (`getStudentMastery` ensureLabels, `getUpcomingForStudent`), but the audit that found them was scoped to functions this module actually touches** — a broader hidden-write audit of the full services layer was not performed and is not claimed.
5. **No load/perf testing was run** against the new bulk queries (`readSubjectMasteryRows`, `readStateHistory`) under realistic production data volumes — correctness is verified, throughput at scale is not.

---

## 26. Definition of Done Checklist

- [x] Canonical `LearnerModelService` implemented with 4 projections.
- [x] Shared, composable sub-readers — no per-projection duplicate logic.
- [x] `StudentId` implemented as logical/opaque per the identity correction — no schema change, no new identifier.
- [x] Read-only invariant enforced and tested; hidden-write functions found and disclosed, not reused.
- [x] `Capability<T>` used for every genuinely-not-yet-available metric — nothing fabricated.
- [x] At least 2 real consumers migrated with before/after contract comparison.
- [x] One confirmed-dead legacy read model removed.
- [x] Other legacy read models evaluated and dispositioned with reasoning (not silently left alone).
- [x] 23 new tests added, all passing; 1 obsolete test block removed.
- [x] `tsc`, `vitest`, `build`, `db:status` all clean.
- [x] Architecture doc (`digital-learning-twin.md`) updated to reflect actual implementation, distinguishing IMPLEMENTED IN 1C / DEFERRED TO 1D / DEFERRED TO 1E.
- [x] Production baseline confirmed unaffected; nothing committed or deployed.
- [x] This report written with all required sections.

---

## 27. Final Decision

**A. Is the canonical Digital Learning Twin read architecture implemented?** Yes — `IMPLEMENTED`, not partial. All 4 projections work against real fixtures and 2 real UI consumers.

**B. Does it introduce a new identifier or modify identity schema?** No. `StudentId` is a plain `string` alias; both underlying tables already share the same UUID.

**C. Does it perform any writes?** No — verified by static source scan plus explicit avoidance of 2 known hidden-write functions elsewhere in the codebase.

**D. Does it fabricate any not-yet-available metric?** No — every deferred metric resolves to an explicit `Capability` `NotYetAvailable` value, tested.

**E. Were any existing certified algorithms (mastery, Knowledge State, verification) modified?** No — zero diff on those files.

**F. Was any schema changed?** No — `db:status` unchanged (2 applied, 0 pending, 0 drifted).

**G. Were any consumers migrated, and is the before/after output proven equivalent?** Yes, 2 consumers (subject page, concept page); proven via dedicated regression tests, including one deliberate, documented, non-bug exception (retention).

**H. Was any critical bug found and fixed before shipping?** Yes — the retention-field semantic mismatch (§19), caught by test-writing, fixed, and permanently guarded by a regression test.

**I. How many fragmented LIVE learner aggregate implementations remain?** **0.** Definition used: a "fragmented live aggregate" is a function that independently recomputes the same learner-state algorithm another live function already computes, for the same purpose, with no algorithmic reuse between them. Under that definition: `getLearnerModelSummary` (the one true duplicate) is removed; the remaining 4 retained functions (`getLearnerConceptState`, `getLearningOSSnapshot`, `getStudentProgressOverview`, and `getSubjectLearnerModel` as an internal dependency) either call the same underlying atomic algorithms as the new Twin (no duplication) or serve a genuinely distinct purpose (decision-planning, gamification) that the Twin does not and should not replace.

**J. Was anything deployed, committed, or pushed?** No. HEAD is unchanged at `afa2e2a`. Nothing from this phase is in git.

**K. Is Phase 1D authorized to start?** No — per explicit instruction, this phase stops here pending external architecture review. Awaiting further direction.
