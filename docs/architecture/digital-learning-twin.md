# StudyUs Digital Learning Twin — Target Architecture

Established Phase 1B, on top of Phase 1A's Learner Model Current-State Certification. **Phase 1C implemented the core read architecture** (`src/lib/learner-twin/`) — this document is now updated to reflect what actually exists in code, not only the target design. See `docs/audits/STUDYUS_PHASE_1B_DIGITAL_LEARNING_TWIN_ARCHITECTURE.md` for the original design rationale and `docs/audits/STUDYUS_PHASE_1C_CORE_LEARNER_MODEL_IMPLEMENTATION.md` for the implementation report.

**Implementation status**: the four projections (`getOverview`, `getSubjectView`, `getConceptView`, `getDecisionContext`), the shared sub-readers, the data-quality contract, and read-time language resolution are **IMPLEMENTED IN 1C**. Response-time/time-on-task telemetry, learning velocity, help dependency, fine-grained persistence, misconception-lifecycle changes, and error-taxonomy changes are **DEFERRED TO 1D/1E** and are represented in the runtime contract only as explicit `Capability<T>` "not available yet" values — never fabricated numbers. Prerequisite gaps are **DEFERRED TO 1E** per Phase 1B's own instruction not to invent production `blockingSeverity` thresholds in 1C.

---

## Core principle

```
DOMAIN SOURCES                          DIGITAL LEARNING TWIN            LEARNING ENGINES
(unchanged, still authoritative)         (aggregates, never replaces)
  academic profile        --\
  subjects / curriculum     \
  learning_evidence          \
  mastery_records              +-->  LearnerModelService  -->  quiz generation
  concept_knowledge_state     /        getOverview()           study planning
  errors                     /         getSubjectView()        remediation
  misconception_signatures  /          getConceptView()        orchestrator
  verification_attempts    /           getDecisionContext()    (future) Decision Engine
  decision_events          /
  student_availability    /
  study_plans          --/
```

The Twin is a **read layer**. It does not own data. Every field it exposes traces back to an existing domain table, an existing algorithm, or a small, explicitly-justified new signal (§ below). Mastery, Knowledge State, Verification, and Learning Evidence remain exactly as certified in Phase 0 — nothing about them changes.

---

## Twin boundary

**Inside the Twin**: account-adjacent learning identity (not full account PII), academic context, curriculum context (by reference, not full definitions), cognitive state (mastery/Knowledge State/errors/misconceptions), learning behavior state, memory/retention state, metacognitive state, planning context, temporal history (via `decision_events`), and a small catalog of derived learner metrics.

**Outside the Twin** (explicitly excluded): raw curriculum definitions (full topic/subtopic text — referenced by id/label only), raw AI prompts/responses (already excluded from the audit trail, Phase 0E1/0E2), full quiz question/option payloads, UI preferences unrelated to learning (theme, notification settings), billing/subscription data, parent/admin relationship data, and any unsupported "learning style" label (none exist today — confirmed Phase 1A — and none should be introduced).

---

## Identity (as actually implemented in 1C)

`StudentId` (`src/lib/learner-twin/types.ts`) is a **logical, opaque** identifier — a plain `string` alias, deliberately NOT described as "the `profiles.id` space" (an earlier draft of this document said that; it was wrong and has been corrected). The Digital Learning Twin's public contract never states or implies which underlying FK family (`students.id` vs `profiles.id`) a given field's query used — that split is an internal implementation detail of individual sub-readers in `readers.ts`, never surfaced in `types.ts`'s exported shapes. No identity-conversion function exists or is needed, since both tables already hold the same UUID for a given student under the Phase 0C compatibility contract.

## Canonical contract (as implemented)

```ts
interface LearnerModel {
  studentId: StudentId;                   // logical/opaque -- see Identity above
  generatedAt: string;

  academicContext: AcademicContext;       // STUDENT level
  languageContext: LanguageContext;       // STUDENT, with SUBJECT overrides
  subjects: SubjectSummary[];             // one row per subject, aggregate only -- not full concept trees
  planningContext: PlanningContext;       // STUDENT + TIME WINDOW
  derivedMetrics: { evidenceCoveragePercent: number | null };  // STUDENT-level; only what's truthfully computable in 1C
  dataQuality: DataQualitySummary;        // meta: how much of the above to trust
}

interface SubjectView {
  studentId: string; subjectId: string; generatedAt: string;
  academicContext: SubjectAcademicContext;   // SL/HL, target language, etc.
  cognitiveSummary: { avgMastery, avgRetention, avgIndependentMastery, avgCalibration, evidenceCoverage };
  concepts: ConceptSummary[];                // bounded/paginated, never all concepts by default
  needsAttention: NeedsAttentionItem[];
  dataQuality: DataQualitySummary;
}

interface ConceptView {
  studentId: StudentId; conceptId: string; subjectId: string; conceptLabel: string; generatedAt: string;
  mastery: MasterySignal;                       // { score, confidenceScore, attemptCount, correctCount, incorrectCount, quality }
  knowledgeState: KnowledgeStateSignal;          // { masteryState, dimensions, validationReadiness, stateReason, quality }
  independence: IndependenceSignal;              // { independentMastery, evidenceStrength, quality }
  metacognition: MetacognitionSignal;            // { confidence, confidenceCalibration, quality }
  retention: RetentionSignal;                    // { retentionScore [KS dimension], forgettingRisk [spaced-repetition], lastRetrievalAt, nextReviewAt, quality }
  transfer: TransferSignal;                      // { transferScore, quality }
  misconceptions: MisconceptionSummary;          // { activeCount, criticalCount, recurringCount, quality }
  recentEvidence: EvidenceSummary[];             // bounded, default last 5
  errorPatterns: ErrorPatternSummary[];
  assessmentContext: AssessmentPressure;
  stateHistory?: StateTransitionEvent[];         // only when options.includeHistory=true, sourced from decision_events, bounded (default 20)
  prerequisiteGaps: Capability<PrerequisiteGap[]>;  // ALWAYS { available: false, reason: 'NOT_AVAILABLE_YET', plannedPhase: '1E' } in 1C
  dataQuality: DataQualitySummary;
}

interface DecisionContext {
  // The minimal, decision-optimized slice -- deliberately smaller than
  // ConceptView (no errorPatterns, no transfer, no full evidence list).
  studentId: StudentId; conceptId: string; subjectId: string; generatedAt: string;
  mastery: { score: number; confidence: number };
  knowledgeState: Pick<KnowledgeStateSignal, 'masteryState' | 'dimensions' | 'validationReadiness'>;
  metacognition: { confidenceCalibration: ConfidenceCalibration };
  independence: { independentMastery: number | null; evidenceStrength: EvidenceStrength | null };
  retention: { retentionScore: number | null; forgettingRisk: number | null; nextReviewAt: string | null };
  misconceptions: { activeCount: number; criticalCount: number; recurringCount: number };
  recentEvidence: EvidenceSummary[];
  assessmentPressure: AssessmentPressure;
  availability: { dailyMinutes: number };
  learningVelocity: Capability<unknown>;      // NOT_AVAILABLE_YET, plannedPhase '1E'
  helpDependency: Capability<unknown>;        // NOT_AVAILABLE_YET, plannedPhase '1E'
  prerequisiteGaps: Capability<PrerequisiteGap[]>;  // NOT_AVAILABLE_YET, plannedPhase '1E'
  dataQuality: DataQualitySummary;
}
```

**A real semantic distinction Phase 1C found and preserved, not merged**: `retention.retentionScore` (the Knowledge State "retention" *dimension* -- a backward-looking "has the student proven they still know this after a real time gap" evidence classification) and `retention.forgettingRisk` (a forward-looking spaced-repetition estimate) are two genuinely different pedagogical signals that happen to share the English word "retention" in casual conversation. The pre-existing `learner-model.service.ts::getRetention()` function (still used by 4 decision-adjacent services, unchanged) computes the *second* one (`100 - forgettingRisk`), not the Knowledge State dimension. `ConceptView`/`DecisionContext` expose both, separately and correctly labeled — see `tests/unit/learner-twin-consumer-regression.test.ts` for the proof this distinction is real, not a mock artifact.

## Read architecture

```
LearnerModelService
  |
  +-- getOverview(studentId, options?)              -> LearnerModel
  +-- getSubjectView(studentId, subjectId)           -> SubjectView
  +-- getConceptView(studentId, conceptId, options?) -> ConceptView   (options.includeHistory)
  +-- getDecisionContext(studentId, conceptId)       -> DecisionContext

  Internal composable sub-readers (src/lib/learner-twin/readers.ts, shared by all four):
  readAcademicContext · toSubjectAcademicContext · readLanguageContext
  readSubjects · readSubjectMasteryRows
  readMasteryRow · toMasterySignal
  readKnowledgeStateSignal (wraps getConceptKnowledgeState)
  readIndependenceSignal · readMetacognitionSignal
  toRetentionSignal · readTransferSignal
  readMisconceptionSummary · readRecentEvidence · readConceptErrorPatterns
  readPlanningContext · readAssessmentPressure
  readStateHistory (decision_events, only when includeHistory)

  Re-exported, not reimplemented (called directly, same algorithms):
  getSubjectLearnerModel, getSubjectKnowledgeState, getActiveMasteryPolicy,
  getRecurringMisconceptions, getEvidenceCoverage, getConceptIntelligenceBatch
```

All four public methods are built from the same sub-readers at different granularity/depth — never four independent implementations. `options` (`includeHistory?`, plus per-projection bounds) keep queries scoped so `getOverview` never silently enumerates every concept a student has.

**Read-only invariant, verified.** Every reader above is a plain `SELECT`; the module contains zero `INSERT`/`UPDATE`/`DELETE` (enforced by a static source-scan test in `tests/unit/learner-twin.test.ts`). Two existing "read" functions elsewhere in the codebase were deliberately **not** reused because they carry hidden write side effects: `mastery.service.ts::getStudentMastery(..., ensureLabels=true)` fire-and-forget writes concept localizations via `ensureConceptLocalizations`, and `assessment.service.ts::getUpcomingForStudent` can `INSERT` a new `assessment_occurrences` row via `ensureRecurringOccurrence`. `readAssessmentPressure` runs its own direct `SELECT` on `assessment_occurrences` instead of calling `getUpcomingForStudent`.

## 1C-R Canonical Consumer Closure

External architecture review of Phase 1C found the original fragmentation definition too narrow: it asked only "does this function duplicate an algorithm?" and retained `getLearnerConceptState`'s three decision-adjacent callers (`remediation.service.ts`, `cognitive-diagnosis.service.ts`, `tutor-strategy.service.ts`) as "justified" on that basis. The tightened requirement, closed in Phase 1C-R: **important learner-state decision consumers must enter through the canonical Learner Model boundary** (`getDecisionContext`), not just avoid duplicating algorithms.

```
LearnerModelService
  |
  v
getDecisionContext(studentId, conceptId)
  |
  +--> remediation.service.ts::startRemediation (via toCandidateState adapter)
  +--> cognitive-diagnosis.service.ts::detectCognitiveIssue / generateRootCauseHypotheses
  +--> tutor-strategy.service.ts::buildCompactTutorContext
  +--> (future) Decision Engine
```

All three now call `getDecisionContext` directly; `getLearnerConceptState` is `@deprecated`, has zero live callers anywhere in `src/`, and is retained only because two test files use it as a permanent before/after equivalence proof. A static architecture test (`tests/unit/canonical-learner-model-boundary.test.ts`) enforces this going forward. The forward-looking retention semantic (`100 - forgettingRisk`) that Phase 1C discovered was preserved exactly at each of the three call sites — see `tests/unit/decision-consumer-migration-regression.test.ts`. Full detail: `docs/audits/STUDYUS_PHASE_1C_R_CANONICAL_CONSUMER_CLOSURE.md`.

## Data quality contract

Every signal the Twin exposes at or above concept granularity should be able to answer, when relevant: `sourceType` (`SYSTEM_FACT | DETERMINISTIC_DERIVATION | AI_INFERENCE | STUDENT_SELF_REPORT | SCHOOL_REPORTED | BEHAVIOR_OBSERVATION`), `lastUpdatedAt`, and — for derived/AI signals only — `sampleSize`, `confidence`, `freshness`. Not every field needs every property (a raw fact needs no confidence; a stable slow-changing field needs no freshness alarm). Full rules in the Phase 1B report §7.

## Temporal model

State-transition history is **not** a new table. Phase 0E2's `decision_events` already records `KNOWLEDGE_STATE_PROJECTED` (previous/new full state, every projection) and `MASTERY_UPDATED` (previous/new mastery, every evidence write) — this is exactly the history the Twin needs. The Twin's `includeHistory` option queries `decision_events` directly. **Caveat**: history is only available from Phase 0E2's production deployment date forward (2026-08-31) — there is no retroactive backfill, so velocity/transition metrics will be data-thin until enough history accumulates.

## What requires new telemetry vs. what doesn't

**No new telemetry required** for: help dependency, evidence coverage, transfer coverage, prerequisite gap severity, study-plan adherence, subject/learner-level confidence-calibration aggregates, error-taxonomy reconciliation (the DB column already accepts the wider set of values — no CHECK constraint exists), misconception lifecycle status (derivable from existing evidence + `decision_events`).

**New telemetry genuinely required** for: response time / time-on-task (would live additively in `learning_evidence.metadata`, no new column), fine-grained productive-struggle-vs-guessing distinction (needs the above), and true question-level retry analytics (deliberately **not recommended** — see the Phase 1B report §13, a product-design question, not a data gap).

## Minimum schema changes

**REQUIRED: none.** Every projection and metric this document defines can be built from existing tables, existing `learning_evidence.metadata`/`decision_events.metadata` jsonb columns, and read-time computation. See the Phase 1B report §28 for the full REQUIRED/RECOMMENDED/OPTIONAL classification.

## What the Twin explicitly does not do

- It does not compute mastery, Knowledge State, or verification outcomes itself — it reads what those engines already produced.
- It does not become a second source of truth for anything with an existing owner.
- It does not force a confidence question after every answer, and does not introduce learning-style labels, personality typing, or unsupported demographic profiling.
- It does not implement a Learning Decision Engine or Adaptive Teaching — `DecisionContext` is an *input contract* for a future engine, not the engine itself.
