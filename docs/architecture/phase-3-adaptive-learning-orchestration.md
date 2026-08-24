# Phase 3 — Adaptive Learning Orchestration (Technical Design & Architecture)

**Status:** Describes actual implemented code, not aspirational design. Covers Phase 3 Pre-flight, Phase 3A (Evidence Mode Engine), Phase 3B (Assessment Verification Engine), and Phase 3C (Adaptive Learning Orchestrator) as they exist in this repository today. Phase 3D (Scheduler + NBA v3 + Session Engine) is **not implemented** — nothing in this document should be read as describing it, and Phase 3C does not replace any production Today/Study Plan surface (see §5.9).

## 0. The critical architectural boundary

Phase 2.2's deterministic Knowledge State projector (`recalculateConceptKnowledgeState` in `knowledge-state.service.ts`) remains the **sole authority** over Knowledge Mastery. Every Phase 3 module described below produces evidence, confidence, or timing signals that eventually flow *into* `updateMastery` (which itself invokes the projector) — none of them ever compute or assign a `MasteryState` directly. This is verified structurally: no Phase 3 file imports `knowledge-state.service.ts` for writing, and the golden architectural tests in `tests/unit/assessment-verification.service.test.ts` assert this explicitly.

## 1. Phase 3 Pre-flight — Data & Signal Integrity

Four independent, additive capabilities, gating Phase 3A/3B:

- **Historical Knowledge State backfill** (`knowledge-state-backfill.service.ts`) — `runKnowledgeStateBackfill()` reprojects stale/missing `concept_knowledge_state` rows by calling the same production projector, batchable/resumable via a cursor persisted in `backfill_runs`, dry-run capable (previews via the projector's own pure classification functions, never triggering Phase 2.2B's Validation Cycle side effects).
- **Exam concept attribution** (`exam-result.service.ts`'s `getConceptAttribution`) — tiers confidence by how precisely a real school exam's score can be attributed to a concept: `CONCEPT_MAPPED` (explicit `assessment_concept_coverage` row, confidence = weight × mapping_confidence) → `TOPICS_LIST` (explicit concept selection, fixed 0.7) → `SUBJECT_WIDE` (no selection at all, fixed 0.4). Replaces the original uniform-1.0-confidence bug.
- **Question evidence semantics** (`quiz-generation.service.ts`) — `GeneratedQuestion` carries optional `questionIntent`/`evidenceDimensions`/`cognitiveLevel`/`expectedReasoningType`/`learningObjectiveId`, stored in `quiz_sessions.questions` (jsonb, no migration) and surfaced into `learning_evidence.metadata.questionSemantics` when present.
- **Learning Scheduling Clock** (`learning-scheduler.service.ts`) — `getDueItems()` aggregates AT_RISK/INTERVENTION_REQUIRED concepts, validation deadlines, retention-due reviews, upcoming exams, and unfinished remediation, entirely by reusing existing Phase 2.2B/Phase 1 sources. Time-ownership only — never decides priority (that is explicitly Phase 3C's future job, not built here). For `REMEDIATION_UNFINISHED` specifically, `DueItem.conceptId` is the **root-cause concept** (`rootCauseConceptId`) — the concept remediation steps actually operate on — never the target concept where the problem originally manifested (`targetConceptId`, preserved separately as provenance/context). Both are additive optional fields on `DueItem`; every other item type leaves them unset.

Migration: `028_phase3_preflight.sql` (`backfill_runs` table, `assessment_concept_coverage.source_granularity` column).

## 2. Phase 3A — Evidence Mode Engine

**Two separate dimensions, never collapsed into one enum:**

- **Activity Type** (`src/lib/activity-taxonomy.ts`) — what the student is doing: `PRACTICE`, `REVIEW`, `SOLO_CHECK`, `DIAGNOSTIC_CHECK`, `REMEDIATION`, `SOLO_VERIFY`, `TRANSFER`, `RETENTION_CHECK`, `CUMULATIVE_ASSESSMENT`, `MOCK_EXAM`.
- **Evidence Mode** (same file) — the conditions the evidence was produced under: `PRACTICE` | `INDEPENDENT` | `ASSESSMENT`. A fixed, total mapping (`evidenceModeForActivity`) — no per-call override, which is what makes Evidence Mode immutable within an attempt.

**Central permission policy** (`src/lib/ai-permission-policy.ts`) — `canUseAI({evidenceMode, feature, attemptState})` is the one server-side authority every AI-assistance touchpoint must call. Three feature classes: student-assistance (HINT/EXPLAIN/ASK_AI/...) gated to `PRACTICE` only; input-assistance (`MATH_TOOLBAR`) always allowed in every mode; internal/system (`INTERNAL_GRADING`/`VARIANT_GENERATION`/`VERIFICATION_GENERATION`/...) always allowed since it never assists the student directly. Wired into `/api/quizzes/hint`.

**Persistence**: `quiz_sessions.activity_type`/`evidence_mode` (migration `029_evidence_mode.sql`), derived once in `storeQuiz` from the mode → Activity Type table and never rewritten. Historical rows (`NULL` columns) derive their mode from the unchanged `quiz_mode` on read.

**Fixed bug**: Solo Check (`quick_check`) was previously internally scored as Cumulative Assessment-adjacent, with hints never actually disabled. It is now genuinely `SOLO_CHECK`/`INDEPENDENT`; the Concept Detail Solo Check CTA links to `mode=quick_check`, never `mode=cumulative_assessment`.

**New modes**: `review` (`REVIEW`/`PRACTICE`, assisted reinforcement) and `retention_check` (`RETENTION_CHECK`/`INDEPENDENT`, unassisted "prove you still remember"), both extending the existing Quiz/Activity Engine (`generate-and-take` route) — no parallel engine.

## 3. Phase 3B — Assessment Verification Engine

**Purpose**: Assessment Mode must produce high-confidence *evidence*, never automatic mastery. This section's modules answer "how trustworthy is this assessment attempt as evidence, and do we have enough unambiguous evidence to use it confidently?" — never "has the student mastered the concept?"

### 3.1 Two separate confidence concepts

- **Knowledge Confidence** — belongs entirely to Phase 2.2's Knowledge State/evidence-sufficiency interpretation. Untouched by Phase 3B.
- **Assessment Confidence** (`src/lib/assessment-confidence.ts`, pre-existing from Phase 3B's earliest work, reused unchanged) — `calculateAssessmentConfidence({gradingConfidences, variantEquivalenceConfidence, verificationResult, behavioralAnomalyScore})` returns a 0-100 trustworthiness score for one specific attempt. Never merged with Knowledge Confidence.

### 3.2 Assessment Profiles (`src/lib/assessment-profiles.ts`)

`CUMULATIVE_ASSESSMENT` (ADAPTIVE verification strictness, no timer, no exam structure, no Exam Readiness comparison — "how solid is accumulated knowledge?") and `MOCK_EXAM` (SELECTIVE strictness, timed, exam structure, Exam Readiness comparison — "how ready is the student to perform under real exam conditions?") are distinct typed configurations, never collapsed. Profiles never define mastery thresholds — those remain exclusively Phase 2.2's `mastery_policies`.

### 3.3 Verification Trigger Engine (`src/lib/verification-triggers.ts`)

Ten deterministic, pure trigger types (`evaluateVerificationTriggers`): `LOW_GRADING_CONFIDENCE`, `CONTRADICTORY_EVIDENCE`, `LARGE_CONFIDENCE_DISAGREEMENT`, `WEAK_CONCEPT_ATTRIBUTION`, `LOW_VARIANT_EQUIVALENCE`, `HIGH_BEHAVIORAL_ANOMALY` (always `LOW` severity — never alone determinative), `REASONING_ANSWER_INCONSISTENCY`, `UNEXPECTED_PERFORMANCE_JUMP`, `CONCEPT_COVERAGE_AMBIGUITY`, `PROFILE_REQUIRES_VERIFICATION`. No LLM call decides whether to trigger — the decision itself is a pure function over already-computed inputs. Verification is evidence disambiguation, never punishment: strong evidence triggers nothing (the common case).

### 3.4 Question Variant Equivalence (`quiz-generation.service.ts`)

`generateQuestionVariant()` reuses `generateQuestionsForConcept` (RAG-grounded, same infra as every other question — no parallel generator) with a variant-specific guidance string, then evaluates the raw AI output against `evaluateVariantEquivalence(source, candidate)` — six independent, per-dimension checks (`concept`, `learningObjective`, `cognitiveLevel`, `reasoningType`, `requiredKnowledge` [proxied by type+difficulty band], `scoringIntent` [answer format + questionIntent/evidenceDimensions]), each returning `{passed, reason}`. A dimension unset on the source has nothing to violate and passes automatically (backward-compatible with the many questions that don't carry Pre-flight's optional semantic tags yet); a dimension that IS set on the source but can't be confirmed on the candidate fails closed rather than being assumed equivalent. `equivalenceConfidence` is the fraction of checks passed. Only once every check passes does the accepted variant inherit the source's own optional semantic tags (a validated variant of a `CHECK_APPLICATION` question is still `CHECK_APPLICATION`) — inheritance happens strictly after the gate, never before it, so the gate is a real check against the AI's actual output, not against data already copied in. Returns `null` — never a silently non-equivalent question — when any check fails or generation errors; callers fall back to the original question, so an assessment is never blocked by AI unavailability.

### 3.5 Structured Reasoning Analysis (`quiz-generation.service.ts`)

`GradingErrorType` extended with `ARITHMETIC`/`UNIT` (additive to the original five). `gradeAnswer` now also returns `reasoningValid: boolean` — a correct final answer reached through unsound reasoning is weaker evidence than one reached soundly, and a wrong final answer from an otherwise-correct method (`ARITHMETIC`/`UNIT`/`CARELESS`) is stronger evidence of understanding than one from flawed reasoning (`CONCEPTUAL`/`MISREADING`). Feeds `reasoningConsistent` into the trigger engine.

### 3.6 Assessment Verification Service (`src/services/assessment-verification.service.ts`)

The orchestration layer, implementing the chain:

```
Assessment attempt
  -> grading/reasoning analysis
  -> Assessment Confidence (calculateAssessmentConfidence, reused unchanged)
  -> verification decision (evaluateAssessmentEvidence -> evaluateVerificationTriggers)
  -> verification question if needed (generateQuestionVariant-style reuse of generateQuestionsForConcept)
  -> graded verification response
  -> recalculated Assessment Confidence (recalculateConfidenceAfterVerification)
  -> qualified Learning Evidence (submitQualifiedAssessmentEvidence)
  -> updateMastery (the SAME pipeline every other feature uses)
  -> Phase 2.2 deterministic projector
  -> Knowledge State
```

`submitQualifiedAssessmentEvidence` scales `confidenceWeight` by Assessment Confidence (0-100 → 0-1) — the same mechanism Phase 3 Pre-flight already uses for exam-attribution granularity — so low-confidence assessment evidence moves mastery less. It never passes a `masteryState`; `updateMastery`'s signature has no such parameter.

`qualifyEvidence(assessmentConfidence, verificationOutcome)` produces a display-only `HIGH`/`MEDIUM`/`LOW`/`CONTRADICTED` label — never a Phase 2.2 `MasteryState` value, and a `CONTRADICTED` verification always wins regardless of the numeric score.

Verification attempt persistence (`verification_attempts`, migration `030_assessment_verification.sql`, **not yet executed against Neon**) links the original answer, the verification question, the deterministic trigger(s), and both the before/after Assessment Confidence. `getPendingVerificationAttempt` is what makes `/api/quizzes/verify` server-authoritative — it never trusts a client-supplied confidence value, only the persisted "before" state and a freshly-server-graded "after" score.

### 3.7 API (`src/app/api/quizzes/verify/route.ts`)

Stateless from the client's perspective: the verification question and its "before" context are looked up server-side by `(quizId, conceptId, studentId)`, never accepted as trusted request parameters. Ownership is checked via the quiz session (never another student's attempt); Evidence Mode must already be `ASSESSMENT` (read from the immutable, persisted attempt, not the request body).

### 3.8 Mock Exam / Exam Readiness calibration

Reuses the pre-existing `exam-readiness.service.ts` (`calculateExamReadiness`) rather than rebuilding readiness prediction. `calculateExamReadinessCalibration(predicted, actual)` is pure calibration information (`calibrationDelta = actual - predicted`) — computed in `generate-and-take`'s submit handler for `MOCK_EXAM` attempts only, surfaced in the response, and never used to mutate Knowledge State.

### 3.9 Learning Evidence integration

`generate-and-take/route.ts`'s submit handler evaluates verification triggers per concept for `CUMULATIVE_ASSESSMENT`/`MOCK_EXAM` buckets only, wrapped in try/catch so a failure (e.g. AI generation unavailable) never blocks the student's real result. Trigger inputs are real, derived values, never fabricated: `conceptCoverageBreadth` comes from `computeConceptCoverageBreadth`, the actual distinct question types asked for that concept in this attempt (undefined with fewer than 2 questions — not enough data to assess breadth, not a default 0); `conceptMappingConfidence` for `MOCK_EXAM` reuses Phase 3 Pre-flight's `getConceptAttribution` against the attempt's real scheduled `assessment_occurrences` row (the same CONCEPT_MAPPED/TOPICS_LIST/SUBJECT_WIDE tiering built for real exams); `CUMULATIVE_ASSESSMENT` has no equivalent real signal and passes `undefined`, which the trigger engine treats as "don't fire," never as a fabricated low value.

When a trigger fires, the verification question targets the *specific* question that caused it: `selectMostAmbiguousQuestion` deterministically picks the bucket's lowest-confidence graded question (tie-broken by lowest question index), never an arbitrary first question, and that question's own grading confidence — not the bucket average — is what gets persisted as provenance.

Every concept in an Assessment-mode result carries an `evidenceQualification` label (`HIGH`/`MEDIUM`/`LOW`/`CONTRADICTED`). `perConceptResults` never displays "Mastered" from Assessment Confidence alone — that label, when shown anywhere in the product, comes exclusively from Phase 2.2's Knowledge State.

**Student-facing flow** (`dashboard/quiz/page.tsx`): when `verificationNeeded` is non-empty, the results screen shows one neutral prompt per concept ("We need one more check to confirm this result"), renders the verification question (single-choice buttons or `MathAnswerEditor` for free text, reusing the same components the main quiz already uses), and submits the answer to `/api/quizzes/verify`. The response's `evidenceQualification`/`outcome` are shown in the same neutral language ("This result was confirmed" / "didn't match your earlier answer, we'll need more evidence" / "still inconclusive") — never "suspicious," "cheating," or any accusatory framing. Mock Exam attempts also surface `examReadinessCalibration` (predicted vs. actual) inline. No component-level UI test exists for this (this repository has no React rendering test infrastructure — jsdom/@testing-library — and none was installed for this change); coverage is the `/api/quizzes/verify` route tests plus TypeScript's own exhaustiveness check on the i18n message table.

## 4. What Phase 3B explicitly does not do

No AI-authorship/"87% AI generated" detector exists anywhere in this codebase. No invasive surveillance (webcam, biometrics, microphone monitoring, persistent keystroke logging) is implemented or planned. Integrity signals (`IntegritySignals` in `assessment-confidence.ts`) are a fixed, non-invasive set (response duration, edit/paste counts, focus-loss counts, etc.) that only ever discount `calculateAssessmentConfidence`'s output — never `Understanding`/`Independence`/`Application`/`Retention`/`Transfer`, never a Knowledge Score, never a `MasteryState`.

## 5. Phase 3C — Adaptive Learning Orchestrator

**Responsibility**: the single deterministic decision authority answering "what is the best pedagogical intervention for this student now, and why?" — nothing upstream of it (Phase 1/2/2.2/3A/3B) makes that call today; nothing downstream of it (Phase 3D) exists yet to consume it in production. Two new files, both read-only, no migration:

- `src/lib/adaptive-learning-policy.ts` — the **pure** policy: signal types, consolidation, intervention (ActivityType) selection, target-dimension selection, fact-building, priority banding, and deterministic ranking. No DB import, no `fetch`, no LLM call — unit-tested directly with hand-built signals (`tests/unit/adaptive-learning-orchestrator.test.ts`).
- `src/services/adaptive-learning-orchestrator.service.ts` — the **IO** layer: loads every existing signal source read-only, shapes each into a `LearningSignal`, and hands the list to the pure policy. Exposes `getLearningDecisions(studentId, preferredLanguage?)` and `getBestLearningDecision(studentId, preferredLanguage?)`, plus re-exports the pure functions (`consolidateSignals`, `buildLearningDecisions`, `rankLearningDecisions`, `selectActivityType`, `selectTargetDimension`, ...) for direct testing. This IO/pure split is what makes the policy testable without a database, and keeps the "what decision" logic in exactly one place.

### 5.1 Input sources (all reused, none re-derived)

| Signal | Source (called directly) |
|---|---|
| `AT_RISK`, `INTERVENTION_REQUIRED`, `VALIDATION_DEADLINE_APPROACHING`/`OVERDUE`, `RETENTION_REVIEW_DUE`, `REMEDIATION_UNFINISHED` | `learning-scheduler.service.ts`'s `getDueItems()` — consumed as-is, never re-derived |
| `REMEDIATION_ACTIVE` | `remediation.service.ts`'s `getActiveRemediationsWithLabels()` (its own "genuinely in-progress" states — `CONFIRMED`/`REPAIRING`/`VERIFYING` — narrower than the Scheduler's broader `REMEDIATION_UNFINISHED` above, which also includes `DETECTED`/`DIAGNOSING`) |
| `PREREQUISITE_GAP`, `DIAGNOSIS_REQUIRED` | `cognitive-diagnosis.service.ts`'s `getActiveDiagnoses()`, `concept-graph.service.ts`'s `getLearningUnlockValue()` for the gap's unlock value |
| `RECURRING_MISCONCEPTION` | `misconception.service.ts`'s `getRecurringMisconceptions()` |
| `CRITICAL_MISCONCEPTION`, `LOW_UNDERSTANDING`, `WAITING_FOR_RETENTION`, `TRANSFER_REQUIRED` | `knowledge-state.service.ts`'s `getSubjectKnowledgeState()` (persisted rows only, never recomputed) + `getActiveMasteryPolicy()` for the low-understanding threshold |
| `LEARNING_DEBT` | `learning-debt.service.ts`'s `getActiveDebts()` |
| `CALIBRATION_CONFLICT` | `external-assessment.service.ts`'s `getCalibrationConflicts()` |
| `EXAM_APPROACHING` | `assessment.service.ts`'s `getUpcomingForStudent()`, called directly (not via the Scheduler's own `EXAM_APPROACHING` `DueItem`, which is subject-scoped with no `conceptId` — Phase 3C fans the same occurrence out to every already-known concept in that subject whose topics include it, mirroring `today-plan.service.ts`'s own `inExamWindow` check) |
| `INDEPENDENCE_GAP` | `learner-model.service.ts`'s `getIndependentMastery()`, compared against `mastery.service.ts`'s `getStudentMastery()` using the same ≥20-point gap convention `remediation.service.ts` and `cognitive-diagnosis.service.ts` already use ad hoc — reused, not reinvented |
| `FORGETTING_RISK` | `lib/algorithms/spaced-repetition.ts`'s `calculateReviewIntervalDays`/`calculateForgettingRisk`, reused verbatim against `getStudentMastery()`'s raw mastery/confidence/last-practiced data |

Two constants (`EXAM_SOON_WINDOW_DAYS`, `FORGETTING_RISK_THRESHOLD`) were changed from private to exported in `today-plan.service.ts` so Phase 3C reuses the exact same values instead of inventing subtly different ones. This is the only change to any existing Phase 1/2/2.2/3A/3B file — zero logic changed, verified by `tests/unit/today-plan.test.ts` and `tests/unit/nba-priority.test.ts` passing unchanged.

`getDueItems()` is consumed, not modified — no new ranking/priority logic was added to `learning-scheduler.service.ts`, which remains time-only.

### 5.2 Multi-signal contract

NBA v2's `TodayItem` carries exactly one `TodayReason`, picked by a first-match `if`/`else if` chain — real simultaneous evidence (exam + debt + forgetting on the same concept) is destroyed the moment the first branch matches. Phase 3C's `LearningSignal[]` never does this: every true signal for a concept is loaded independently and none is dropped before consolidation. A concept with an approaching exam, active debt, high forgetting risk, and a real independence gap keeps all four signals through to the final `LearningDecision.signals` array (`tests/unit/adaptive-learning-orchestrator.test.ts`, "1. Multi-signal consolidation").

### 5.3 Consolidation semantics

`consolidateSignals(signals, knowledgeStateByConceptId)` groups by `LearningSignal.conceptId` — which is always already the *actionable* concept (the root cause where one exists, never the raw symptom) — into one `ConceptDecisionContext` per concept. The same actionable concept arriving from the Scheduler, Knowledge State, and the Cognitive Learning Engine in the same pass still produces exactly one context, never duplicate rows. Each context additionally carries the attached (persisted, never recomputed) `ConceptKnowledgeState` when one exists, and deduplicated provenance arrays (`remediationPathIds`, `diagnosisIds`, `occurrenceIds`, `calibrationConflictIds`).

### 5.4 Root-cause semantics (P0-B contract, preserved)

Exactly the same contract `learning-scheduler.service.ts`'s `REMEDIATION_UNFINISHED` already established: `conceptId` (here, `ConceptDecisionContext.actionConceptId`) is always the concept remediation actually operates on; `targetConceptId` (here, `targetConceptIds[]`) is the concept(s) where the problem manifested, preserved as provenance/context only. When two different target concepts are blocked by the same root cause, both signals collapse into the same context (grouped by the shared `actionConceptId`) — one repair decision, both targets preserved, never duplicate independent recommendations.

### 5.5 Intervention (ActivityType) selection — `selectActivityType`

A deterministic, explicitly ordered rule chain (never a random/implicit choice), using only the existing `ActivityType` taxonomy from `src/lib/activity-taxonomy.ts` (no parallel enum):

1. `REMEDIATION_ACTIVE` present → `REMEDIATION` (continue an in-progress repair before starting anything new).
2. `DIAGNOSIS_REQUIRED` present → `DIAGNOSTIC_CHECK` (never remediate an unestablished root cause).
3. `INTERVENTION_REQUIRED` present (no remediation/diagnosis in play) → `PRACTICE` — the deterministic corrective activity for persistent difficulty; never silently downgraded to a light `REVIEW`.
4. A critical misconception (signal or `knowledgeState.criticalMisconceptionCount > 0`) → `PRACTICE`.
5. `PREREQUISITE_GAP` (confirmed root cause, no remediation path started yet) → `PRACTICE` on the prerequisite itself — the smallest existing activity consistent with Cognitive Learning Engine semantics; `DIAGNOSTIC_CHECK` doesn't apply since the diagnosis is already `CONFIRMED`.
6. Knowledge State's `validationReadiness === 'WAITING_FOR_RETENTION'` (or a `RETENTION_REVIEW_DUE`/`WAITING_FOR_RETENTION` signal) → `RETENTION_CHECK`.
7. `validationReadiness === 'TRANSFER_REQUIRED'` (or a `TRANSFER_REQUIRED` signal) → `TRANSFER`.
8. `INDEPENDENCE_GAP` → `SOLO_CHECK`.
9. An **actionable** `CALIBRATION_CONFLICT` (carries a directional tag beyond the data-quality caveats) → `DIAGNOSTIC_CHECK` (seeking more evidence, per §5.7).
10. Otherwise: `REVIEW` when real Knowledge State evidence exists and the concept is past the earliest `LEARNING` stage (something to refresh), `PRACTICE` when understanding itself is still the gap (nothing to review yet).

`MOCK_EXAM`/`CUMULATIVE_ASSESSMENT` are never selected here — an approaching exam is a **priority modifier** (§5.7), not permission to ignore the student's actual cognitive state; Phase 3D owns subject-level Mock Exam session composition.

`selectTargetDimension` derives the pedagogical objective (`UNDERSTANDING`/`INDEPENDENCE`/`APPLICATION`/`RETENTION`/`TRANSFER`/`MISCONCEPTION`/`PREREQUISITE`/`VALIDATION`/`EXAM_READINESS`) from the same driving reason as the ActivityType — for `REMEDIATION_ACTIVE` specifically, from the underlying `RemediationPattern` (`LOW_RETENTION`→`RETENTION`, `LOW_INDEPENDENCE`→`INDEPENDENCE`, `TRANSFER_WEAKNESS`→`TRANSFER`, `OVERCONFIDENT`→`MISCONCEPTION`, otherwise `UNDERSTANDING`). Never confused with `MasteryState` — it is a separate, smaller, Phase 3C-only type.

**Evidence Mode boundary**: Phase 3C selects an `ActivityType` and stops there. It never calls or reimplements `evidenceModeForActivity` — that mapping stays exclusively Phase 3A's, applied only once an actual quiz session is created from the selected `ActivityType` (a future Phase 3D concern). `tests/unit/adaptive-learning-orchestrator.test.ts` proves the mapping itself is unchanged (`evidenceModeForActivity('RETENTION_CHECK'|'SOLO_CHECK') === 'INDEPENDENT'`) without Phase 3C ever needing to call it.

### 5.6 Knowledge State as context, not another score

The five dimensions (`understandingScore`/`independenceScore`/`applicationScore`/`retentionScore`/`transferScore`) are never averaged or compensated against each other here, exactly as Phase 2.2 itself requires — they're read individually to decide *what kind* of intervention fits (§5.5's rules 6-8), never combined into a second mastery-like number. `LOW_UNDERSTANDING`'s threshold is Phase 2.2's own `mastery_policies.minimum_understanding` (via `getActiveMasteryPolicy()`), not a re-invented NBA v2-style flat constant.

### 5.7 Priority policy — lexicographic bands, never a naive sum

`dominantSignal(context)` picks the single highest-priority signal driving a context — never a summed/averaged score across all of them, which could let a pile of low-value secondary signals accidentally outrank the deliberate imminent-exam override (`tests/unit/adaptive-learning-orchestrator.test.ts`, "21. Multiple secondary signal modifiers"). Bands, highest first: `IMMINENT_EXAM` (≤2 days) → `ACTIVE_ESCALATION` (`REMEDIATION_ACTIVE`/`INTERVENTION_REQUIRED`/`CRITICAL_MISCONCEPTION`) → `PREREQUISITE_GAP` (modified by Learning Unlock Value) → `EXAM_APPROACHING` (non-critical) → `LEARNING_DEBT` (modified by severity) → `DIAGNOSTIC_EVIDENCE` (`DIAGNOSIS_REQUIRED` or an actionable `CALIBRATION_CONFLICT`) → `MISCONCEPTION` (modified by recurrence count) → `VALIDATION` (`AT_RISK`/validation deadlines/retention-due/transfer-required) → `FORGETTING_RISK` → `INDEPENDENCE_GAP` → `LOW_UNDERSTANDING`. Within-band modifiers are clamped to `[0, 999]` before being combined into `priorityScore = band * 1000 + modifier`, so a modifier can never cross into the next band — the "must not be a naive sum" requirement is structural, not just tested behavior. `LearningDecision.priorityScore` is exposed as a downstream-consumable number, but it is *derived from* this ordering, never an independent second decision mechanism.

These specific values are Phase 3C's own policy, not a port of NBA v2's numeric constants (`nbaPriority` in `today-plan.service.ts`, untouched) — only the **ordering invariants** were required to match, and are directly tested: an imminent exam outranks active remediation, active remediation outranks a non-critical exam, a confirmed prerequisite gap outranks the low-mastery symptom it causes (scaled by Learning Unlock Value), diagnosis-required ranks above forgetting-risk/independence-gap but below learning debt, recurring misconceptions scale with occurrence count, and lower understanding stays more urgent within otherwise-equivalent plain low-understanding contexts.

**Tie-breaking**: never implicit DB/array row order. `rankLearningDecisions` orders by `priorityScore` desc, then soonest `dueAt`, then `subjectId`, then `actionConceptId` — a total, deterministic order proven independent of input array order.

### 5.8 Temporal urgency ≠ pedagogical priority

Kept as two entirely separate fields on `LearningDecision`: `temporalUrgency` (`DueUrgency`, reused verbatim from whichever Scheduling Clock signal(s) carry it — `LOW`/`MEDIUM`/`HIGH`/`CRITICAL`, the highest among a context's signals, `null` when nothing carries a deadline) answers "when is this due?"; `pedagogicalPriority` (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`, derived from the priority band) answers "what should happen first, given all evidence?" A `CRITICAL` deadline does not by itself force `CRITICAL` pedagogical priority, and a `CRITICAL` pedagogical priority (e.g. an active escalation) can exist with no deadline at all.

### 5.9 Calibration conflicts (Phase 2.2C boundary, preserved)

A `CalibrationConflict`'s `possibleInterpretations` is checked against `{LOW_MAPPING_CONFIDENCE, COVERAGE_MISMATCH}` — the data-quality caveat tags. A conflict is treated as `actionable` only when it carries at least one *directional* tag beyond those two; a data-quality-only conflict still survives into `ConceptDecisionContext.signals` (never dropped, so it stays visible for explainability) but never drives `dominantSignal`/priority and never selects `DIAGNOSTIC_CHECK` — it must never be promoted into a strong knowledge-gap claim. A real, high-quality (directional) conflict is treated as more evidence being needed, landing in the `DIAGNOSTIC_EVIDENCE` band alongside `DIAGNOSIS_REQUIRED` and selecting `DIAGNOSTIC_CHECK`.

### 5.10 Explainability

`LearningDecision.facts` is built by `buildFacts(context)` — one structured `LearningFact` per real signal (`{kind, ...realNumbers}`, e.g. `{kind: 'learningDebt', severity: 3}`), composed purely from already-loaded data. No LLM call anywhere in `adaptive-learning-policy.ts` or `adaptive-learning-orchestrator.service.ts` (verified by both a source-grep test and the absence of any AI-client import). UI/localization compose the actual prose later, exactly mirroring `today-plan.service.ts`'s existing `WhyThisFact`/`factsForItem` pattern rather than inventing a second one.

### 5.11 Knowledge State boundary (read-only, verified)

Phase 3C never assigns `MasteryState` and never writes `concept_knowledge_state` — `evaluateValidationLifecycle` (Phase 2.2B) remains the only place that ever happens. Verified three ways: (1) `adaptive-learning-orchestrator.service.ts` only ever calls `getSubjectKnowledgeState`/`getConceptKnowledgeState` (pure reads of already-persisted rows) and never imports `recalculateConceptKnowledgeState`; (2) a source-grep test asserts no `INSERT INTO`/`UPDATE concept_knowledge_state` string appears in either new file; (3) `adaptive-learning-policy.ts` has no DB import at all — it cannot write anything by construction, being a pure function module.

### 5.12 Relationship to NBA v2 and the Phase 3D boundary

- **NBA v2** (`today-plan.service.ts`'s `getTodayPlan`/`nbaPriority`, `priority-engine.service.ts`'s `calculateConceptPriority`) remains **legacy production decision behavior**, completely untouched by this phase (zero lines changed beyond the two additive `export` keywords in §5.1) and still serving `dashboard/today` and `dashboard/learning-debt` today. `priority-engine.service.ts` in particular gains no new intelligence and is not synchronized with Phase 3C's new signals — Phase 3D must eventually stop treating it as an independent decision authority, but that migration is explicitly out of scope here.
- **Phase 3C** (this section) is the new orchestration/decision/priority/intervention **authority** — computed fresh on every call, not yet wired into any product surface.
- **Phase 3D** (not implemented) is the future **execution** layer: session/scheduling composition, NBA v3 UI, and the Session Engine, expected to *consume* `getLearningDecisions`/`getBestLearningDecision` rather than recreate any priority logic of its own. Deliberately **not** built here: exact study-session composition, daily calendar allocation, notification timing, multi-session scheduling, any UI, and no replacement of Today/Study Plan's production behavior.

### 5.13 No persistence

Every `LearningDecision` is computed fresh from current state on every call — no `learning_decisions`/`priority`/`orchestrator_state` table, no migration. Nothing here needed one: Phase 2.2's `concept_knowledge_state`, the Scheduling Clock, and every other source already persist what they need to; Phase 3C only reads and ranks.

### 5.14 Known limitations, carried forward rather than fixed here

- `learning-debt.service.ts`'s `getActiveDebts` (reused for `LEARNING_DEBT`) lazily re-resolves debts on read as a pre-existing side effect (can flip `learning_debt.status` to `'resolved'`) — not introduced by Phase 3C, out of scope to fix here (see "do not redesign Phase 1/2/2.2").
- `assessment.service.ts`'s `getUpcomingForStudent` (reused for `EXAM_APPROACHING`) can perform swallowed recurring-occurrence-sync writes as a side effect of a "read" — same pre-existing pattern, same scope decision.
- `EXAM_APPROACHING` signals are only generated for concepts that already have a `concept_knowledge_state` row (i.e., some prior evidence exists) — a concept covered by an upcoming exam that the student has never been evaluated on at all is out of scope for Phase 3C today; Phase 3D may widen this if a concrete need arises.
- Two independent, non-unified priority mechanisms now exist in the codebase (NBA v2's `nbaPriority` banding and `priority-engine.service.ts`'s separate additive `scorePriority`, alongside Phase 3C's own lexicographic bands) — reconciling them is explicitly Phase 3D's job, not this phase's.
