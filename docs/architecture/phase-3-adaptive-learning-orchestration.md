# Phase 3 — Adaptive Learning Orchestration (Technical Design & Architecture)

**Status:** Describes actual implemented code, not aspirational design. Covers Phase 3 Pre-flight, Phase 3A (Evidence Mode Engine), and Phase 3B (Assessment Verification Engine) as they exist in this repository today. Phase 3C (Adaptive Learning Orchestrator) and Phase 3D (Scheduler + NBA v3 + Session Engine) are **not implemented** — nothing in this document should be read as describing them.

## 0. The critical architectural boundary

Phase 2.2's deterministic Knowledge State projector (`recalculateConceptKnowledgeState` in `knowledge-state.service.ts`) remains the **sole authority** over Knowledge Mastery. Every Phase 3 module described below produces evidence, confidence, or timing signals that eventually flow *into* `updateMastery` (which itself invokes the projector) — none of them ever compute or assign a `MasteryState` directly. This is verified structurally: no Phase 3 file imports `knowledge-state.service.ts` for writing, and the golden architectural tests in `tests/unit/assessment-verification.service.test.ts` assert this explicitly.

## 1. Phase 3 Pre-flight — Data & Signal Integrity

Four independent, additive capabilities, gating Phase 3A/3B:

- **Historical Knowledge State backfill** (`knowledge-state-backfill.service.ts`) — `runKnowledgeStateBackfill()` reprojects stale/missing `concept_knowledge_state` rows by calling the same production projector, batchable/resumable via a cursor persisted in `backfill_runs`, dry-run capable (previews via the projector's own pure classification functions, never triggering Phase 2.2B's Validation Cycle side effects).
- **Exam concept attribution** (`exam-result.service.ts`'s `getConceptAttribution`) — tiers confidence by how precisely a real school exam's score can be attributed to a concept: `CONCEPT_MAPPED` (explicit `assessment_concept_coverage` row, confidence = weight × mapping_confidence) → `TOPICS_LIST` (explicit concept selection, fixed 0.7) → `SUBJECT_WIDE` (no selection at all, fixed 0.4). Replaces the original uniform-1.0-confidence bug.
- **Question evidence semantics** (`quiz-generation.service.ts`) — `GeneratedQuestion` carries optional `questionIntent`/`evidenceDimensions`/`cognitiveLevel`/`expectedReasoningType`/`learningObjectiveId`, stored in `quiz_sessions.questions` (jsonb, no migration) and surfaced into `learning_evidence.metadata.questionSemantics` when present.
- **Learning Scheduling Clock** (`learning-scheduler.service.ts`) — `getDueItems()` aggregates AT_RISK/INTERVENTION_REQUIRED concepts, validation deadlines, retention-due reviews, upcoming exams, and unfinished remediation, entirely by reusing existing Phase 2.2B/Phase 1 sources. Time-ownership only — never decides priority (that is explicitly Phase 3C's future job, not built here).

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
