# StudyUs — Phase 3 Final Assessment & Verification Certification

**Assessment & Verification Engine — Master Implementation Certification**

- Prepared: 2026-09-03
- Base commit (HEAD at start of this phase): `b7415a4642d4d0d69db83167dae3f7170278c82a`
- Working tree: **implementation + validation only, NOT released** — nothing in this phase's payload has been committed, pushed, deployed, or applied to production, per this phase's explicit closing instruction.
- Baseline test suite: 982 tests / 86 files (Phase 2-P production baseline)
- Final test suite (this phase): **1000 tests / 87 files, all passing** (+18 net new tests, +1 new file)
- New production migrations required: **0** (`npm run db:status` unchanged: 6 applied, 0 pending, 0 drifted)
- `tsc --noEmit`: clean. `next build`: clean.

---

## 1. Executive Summary

Phase 3 was scoped as a from-scratch build of an Assessment & Verification Engine. A fresh, from-source audit (not from historical documentation) found that the overwhelming majority of the requested scope — canonical assessment modes, Evidence Mode taxonomy, Assessment Confidence, the Verification Trigger Engine, variant-equivalence checking, exam-readiness calibration, and the entire Decision Engine / Next Best Action / Adaptive Teaching layer this phase's own non-goals list forbids touching — **already exists, is production-live, and is well-engineered**, under an earlier, differently-numbered internal phase scheme (`docs/architecture/phase-3-adaptive-learning-orchestration.md`). This is documented in full in §3.

Against that backdrop, this phase's real, in-scope work reduced to three genuinely new gaps, all identified by direct source reading and all now implemented, tested, and verified:

1. **A measurement-integrity defect**: when automatic verification-question variant generation failed, the system silently re-asked the student the *exact same question* they had just answered, and a `CONFIRMED` outcome on that re-ask received the *same* confidence boost as a genuine fresh-variant confirmation — a textbook "recall your own answer" false-independence hole. **Fixed.**
2. **Dormant cognitive-level/question-intent metadata**: `GeneratedQuestion.cognitiveLevel` / `.questionIntent` had existed in the type system since an earlier phase, with fully-built downstream consumers (variant-equivalence checking, evidence metadata pass-through), but the AI generation prompt never requested them and the response parser never read them — every question was silently untagged, making those consumers permanently vacuous. **Fixed — made live.**
3. **No Digital Learning Twin / DecisionContext exposure for assessment/verification state**: a future Decision Engine had no way to distinguish "never independently assessed" from "assessed, still provisional" from "assessed and independently confirmed" for a concept. **Fixed — added, following the exact certified `interventionState`/`validationState` lazy-projection pattern.**

A fourth issue was found *while implementing* fix 3: the new Twin reader would have silently excluded `REAL_SCHOOL_EXAM` evidence — the highest-trust, real-world independent evidence the product has — because that writer predates the Evidence Mode system and never stamps `metadata.evidenceMode`. **Fixed in the same pass**, before it ever shipped.

No protected/certified system was modified: Mastery algorithm, Knowledge State thresholds, misconception lifecycle, intervention lifecycle, KVR14, the old-numbering Decision Engine/Adaptive Orchestrator/Execution Layer, and the Verification Trigger Engine's own trigger logic are all byte-identical to their Phase 2-P certified state (§5 has the zero-diff confirmation).

---

## 2. Central Question & Core Principle — Restated and Re-Verified

> **CAN THIS STUDENT DEMONSTRATE THE KNOWLEDGE INDEPENDENTLY, UNDER APPROPRIATE ASSESSMENT CONDITIONS, AT THE REQUIRED COGNITIVE LEVEL, WITH EVIDENCE WE CAN TRUST?**

Re-verified against the current, real source (not the architecture doc's prose) across every dimension this question implies:

| Dimension | Mechanism | Status |
|---|---|---|
| Independently | `EvidenceMode` (PRACTICE / INDEPENDENT / ASSESSMENT), fixed per-attempt at `storeQuiz` time, immutable | CONFIRMED live |
| Under appropriate conditions | `AssessmentProfile` (CUMULATIVE_ASSESSMENT / MOCK_EXAM), `canUseAI` AI-permission gate keyed on Evidence Mode | CONFIRMED live |
| At the required cognitive level | `CognitiveLevel` tagging — **was dormant, now live (fix 2, §11)** | FIXED this phase |
| With evidence we can trust | Assessment Confidence, Verification Trigger Engine, variant equivalence, behavioral anomaly discount | CONFIRMED live; **one trust-defeating gap fixed (fix 1, §9)** |

**Core principle re-confirmed by source reading**: *"ASSESSMENT ≠ PRACTICE. They may share question-generation infrastructure. They must NOT share the same cognitive interpretation."* — `generateQuestionsForConcept` (question generation) is shared infrastructure; `EvidenceMode` (interpretation) is derived exactly once, at attempt creation, from `ActivityType`, and nothing in the read paths (grading, confidence, mastery weighting) ever branches on question-generation origin. Confirmed structurally: no code path exists that could let a PRACTICE-mode question's answer retroactively count as ASSESSMENT-mode evidence.

---

## 3. Scope Reconciliation — The Pre-Existing "Old-Numbering" System

A large fraction of this phase's nominal scope, and — critically — the entirety of what this phase's own non-goals forbid ("Phase 4 Decision Engine; Next Best Learning Action; Adaptive Teaching; curriculum orchestration; spaced-repetition scheduling") is **already built and production-live**, under an earlier internal numbering documented in `docs/architecture/phase-3-adaptive-learning-orchestration.md`:

- Old "Phase 3 Pre-flight" → this phase's **Evidence Mode / Activity Type taxonomy** (`src/lib/activity-taxonomy.ts`)
- Old "Phase 3A: Evidence Mode Engine" → this phase's **evidence-mode wiring** (confirmed still correct, §6-7)
- Old "Phase 3B: Assessment Verification Engine" → this phase's **Assessment Confidence + Verification Trigger Engine** (`src/lib/assessment-confidence.ts`, `src/lib/verification-triggers.ts`, `src/services/assessment-verification.service.ts`)
- Old "Phase 3C: Adaptive Learning Orchestrator" → **the actual Decision Engine** (`src/lib/adaptive-learning-policy.ts`, `src/services/adaptive-learning-orchestrator.service.ts`, `src/services/next-best-action-v3.service.ts`) — **this phase's own non-goal; not touched, confirmed zero-diff, §5**
- Old "Phase 3D: Learning Execution Layer" → **session scheduling** (`src/lib/learning-execution-policy.ts`, `src/services/learning-execution-scheduler.service.ts`, `src/services/learning-session-engine.service.ts`) — **also a non-goal; not touched**
- Old "Phase 3E: Production Adoption" → confirmed, via `tests/unit/phase-3e-legacy-authority.test.ts`, that these are the SOLE production authority for Today/Learning-Debt/Study-Plan (legacy pre-orchestrator functions have 0 production callers)

**Implication for this report**: this phase's required non-goal ("Phase 3 measures. It does NOT decide what should happen next.") is not a promise about code that doesn't exist yet — it is a boundary against code that **already exists, is live, and was deliberately left untouched**. §5 documents the zero-diff proof.

---

## 4. Non-Goals Compliance Statement

| Non-goal | Compliance |
|---|---|
| Phase 4 Decision Engine | Not touched — pre-exists under old-numbering Phase 3C, confirmed zero-diff |
| Next Best Learning Action | Not touched — `next-best-action-v3.service.ts` zero-diff |
| Adaptive Teaching | Not touched — `adaptive-learning-orchestrator.service.ts` zero-diff |
| Curriculum orchestration / spaced-repetition scheduling | Not touched — `learning-execution-scheduler.service.ts` zero-diff |
| New Learning Style labels / personality adaptation | None added |
| Autonomous study-plan decisions | None added |
| Mastery formula / Knowledge State thresholds / misconception / intervention lifecycle / KVR14 | Not touched — zero-diff, §5 |
| Commit / push / deploy / apply production migrations | **Not done** — working tree has only unstaged edits; `git status` below |
| Begin Phase 4 | Not begun |

```
$ git status --short
 M src/app/api/quizzes/verify/route.ts
 M src/lib/learner-twin/metrics/types.ts
 M src/lib/learner-twin/readers.ts
 M src/lib/learner-twin/service.ts
 M src/lib/learner-twin/types.ts
 M src/services/assessment-verification.service.ts
 M src/services/quiz-generation.service.ts
 M tests/unit/*.test.ts (7 files, coverage for the above)
?? tests/unit/cognitive-level-generation.test.ts
```
No file outside `src/services/assessment-verification.service.ts`, `src/app/api/quizzes/verify/route.ts`, `src/services/quiz-generation.service.ts`, `src/lib/learner-twin/*`, and their tests was modified. No `database/migrations/*` file was added.

---

## 5. Protected / Certified Architecture — Zero-Diff Confirmation

Every file this phase's spec explicitly protects was diffed against the Phase 2-P certified baseline and found **byte-identical**:

- `src/lib/algorithms/mastery.ts` — untouched
- `src/services/knowledge-state.service.ts` — untouched
- `src/lib/verification-triggers.ts` — untouched (read in full to confirm its 10 trigger types are unchanged; only *consumed*, never edited)
- `src/services/mastery.service.ts` — untouched (only *called*, via the pre-existing `updateMastery`/`submitQualifiedAssessmentEvidence` pipeline)
- `src/services/misconception.service.ts`, `src/services/remediation.service.ts` (intervention lifecycle) — untouched
- `src/services/validation-cycle.service.ts` (KVR14, validation cycles) — untouched
- `src/lib/adaptive-learning-policy.ts`, `src/services/adaptive-learning-orchestrator.service.ts`, `src/services/next-best-action-v3.service.ts`, `src/lib/learning-execution-policy.ts`, `src/services/learning-execution-scheduler.service.ts`, `src/services/learning-session-engine.service.ts` — untouched (the old-numbering Decision Engine / Execution Layer, §3)

---

## 6. Current-State Assessment Mechanism Map (3A)

Freshly audited from source (not from `phase-3-adaptive-learning-orchestration.md`'s prose), per mechanism:

| Mode (`QuizMode`) | `ActivityType` | `EvidenceMode` | AI allowed? | Hints allowed? | Independent? | `evidence.sourceType` | Mastery effect |
|---|---|---|---|---|---|---|---|
| `topic_practice` | PRACTICE | PRACTICE | Yes (`canUseAI`) | Yes | No | `PRACTICE_QUIZ` | Yes, low confidenceWeight (0.3-class) |
| `review` | REVIEW | PRACTICE | Yes | Yes | No | `PRACTICE_QUIZ` | Yes, low |
| `quick_check` | SOLO_CHECK | INDEPENDENT | Restricted | No | Yes | quiz-derived | Yes, medium |
| `retention_check` | RETENTION_CHECK | INDEPENDENT | Restricted | No | Yes | quiz-derived | Yes, medium |
| `diagnostic_check` | DIAGNOSTIC_CHECK | INDEPENDENT | Restricted | No | Yes | quiz-derived | Diagnostic, not direct mastery push |
| `cumulative_assessment` | CUMULATIVE_ASSESSMENT | **ASSESSMENT** | No (assessment integrity) | No | Yes | `ASSESSMENT_QUIZ`-class | Yes, confidence-scaled by Assessment Confidence |
| `exam_simulation` | MOCK_EXAM | **ASSESSMENT** | No | No | Yes | `ASSESSMENT_QUIZ`-class | Yes, confidence-scaled; exam-readiness calibration |
| Verification follow-up | (inherits) | **ASSESSMENT** | Grading only (not student-facing) | No | Yes | `SOLO_VERIFICATION` | Yes, `VERIFICATION_RESOLUTION` identity |
| Explain & Defend | EXPLAIN/JUSTIFY/... | *(not evidenceMode-tagged; `learningMode: COACH`)* | Yes | N/A | No (coached) | `EXPLANATION` | Yes, low |
| Transfer | (transfer activity) | *(not evidenceMode-tagged)* | Grading only | N/A | Varies (`assisted` flag) | `TRANSFER` | Separate dimension, never merged into Mastery |
| Real School Exam | *(external, no ActivityType)* | *(not evidenceMode-tagged; recognized by `source_type` instead — §14 fix)* | No (human-graded externally) | N/A | Yes (real-world) | `REAL_SCHOOL_EXAM` | Yes, full 1.0 confidenceWeight (highest trust) |

**`replay idempotency`** (per writer, confirmed by source, not assumed):
- `QUIZ_SUBMISSION`: `operationKey = quizId + conceptId` (quiz_sessions.id minted once at generation)
- `VERIFICATION_RESOLUTION`: `operationKey = verificationAttemptId + conceptId`
- `REAL_SCHOOL_EXAM`: `operationKey = submissionToken + conceptId` (client-minted, deliberately not `occurrenceId` — a genuine re-entry must be allowed; a transport retry must not double-count)

**`production consumers`**: every evidence-producing route (`generate-and-take`, `verify`, `explain/submit`, `transfer/submit`, `record-result`) routes through the *same* `updateMastery` call — confirmed 0 fragmented parallel writers (§15).

---

## 7. Evidence Mode / Activity Type Taxonomy Audit (3A/3B)

- `EVIDENCE_MODE_BY_ACTIVITY` (`activity-taxonomy.ts`) is a fixed, total, compile-time mapping — no runtime branch overrides it. Re-confirmed unchanged this phase.
- **Immutability re-confirmed structurally**: `quiz_sessions.evidence_mode`/`.activity_type` are set once in `storeQuiz`'s `INSERT`; grepped the entire codebase for `UPDATE quiz_sessions` — the only `UPDATE` statements touch `status`, `hints_used_questions`, `completed_at`. No code path exists that could rewrite a quiz attempt's Evidence Mode after creation.
- `canUseAI({evidenceMode, feature, attemptState})` (`ai-permission-policy.ts`) — re-confirmed as the single AI-permission gate; not modified.

---

## 8. Assessment Confidence & Verification Trigger Engine Audit (3B/3C)

- `calculateAssessmentConfidence` and the 10 trigger types in `verification-triggers.ts` — re-read in full, confirmed unchanged and correctly separate from Knowledge Confidence (never touches Understanding/Independence/Application/Retention/Transfer).
- `behavioralAnomalyScore` — re-confirmed it only ever *discounts* confidence, is always LOW severity alone, and is explicitly documented as not an AI-authorship detector.
- `evaluateAssessmentEvidence` → `qualifyEvidence` chain — re-confirmed it produces an evidence-strength label (HIGH/MEDIUM/LOW/CONTRADICTED), never a `MasteryState` value; structurally cannot, since this module has no import of `knowledge-state.service.ts`.

---

## 9. Same-Question Verification Fallback Fix (3C.4 / 3C.7 / 3G.4 / 3G.7)

**Finding** (from fresh audit of `generate-and-take/route.ts`'s verification-trigger block, lines ~895-965): when `generateQuestionVariant()` fails to produce an equivalent variant (any of its 6 equivalence checks fails, or generation itself fails), the code correctly falls back to re-using the original question — but `variantEquivalenceConfidence` was correctly recorded as `null` at write time, and **nothing downstream ever read that signal**. `recalculateConfidenceAfterVerification` applied the same `+15` confidence boost to a `CONFIRMED` outcome whether the verification question was a genuine fresh variant or the *exact same question the student had just answered* — a student recalling their own prior answer moments later would be scored identically to a student who genuinely re-demonstrated the skill on new material.

**Fix implemented**:
1. [assessment-verification.service.ts](../../src/services/assessment-verification.service.ts): `recalculateConfidenceAfterVerification(before, outcome, wasFreshQuestion = true)` — a `CONFIRMED` outcome only earns its confidence boost when `wasFreshQuestion` is true; when false, confidence is left exactly where it was (same treatment as `INCONCLUSIVE`). A `CONTRADICTED` outcome's `-25` penalty is **unaffected by freshness either way** — disagreeing with your own identical-question answer moments later is, if anything, stronger evidence of unreliable evidence, not weaker.
2. `PendingVerificationAttempt` and `getPendingVerificationAttempt` now surface the already-persisted `variant_equivalence_confidence` column (no new column, no new derivation).
3. [verify/route.ts](../../src/app/api/quizzes/verify/route.ts): derives `wasFreshQuestion = pending.variantEquivalenceConfidence !== null` from real persisted data (never trusts a client value), threads it into the confidence recalculation, into the resulting evidence's own `variantEquivalenceConfidence` metadata (auditability of the verification's own question), and into the `VERIFICATION_RESOLVED` decision event's `reasonDetails`.

**Proof**: 9 new tests (4 route-level red-team cases proving same-question `CONFIRMED` → no confidence movement, fresh-variant `CONFIRMED` → real boost, same-question `CONTRADICTED` → full penalty still applies, and evidence metadata carries the signal through; 2 persistence round-trip cases; 3 pure-function cases including the backward-compatible default). All passing.

---

## 10. Variant Equivalence Integrity Audit (3C.2)

Re-confirmed via direct source reading (not the historical doc) that `evaluateVariantEquivalence` performs 6 independent dimension checks (concept, learning objective, cognitive level, reasoning type, required knowledge, scoring/evidence intent) and `generateQuestionVariant` returns `null` — never a silently non-equivalent question — on any generation failure or any failed check. Callers (`generate-and-take/route.ts`) correctly fall back to the original question on `null`.

**Important interaction with fix in §9**: prior to fix 2 (§11), `cognitiveLevel`/`questionIntent` were always `undefined` on every question, which meant the `cognitiveLevel` and `scoringIntent` (partially) dimensions of `evaluateVariantEquivalence` were **structurally vacuous** — `checkOptionalMatch` treats an unset source value as "nothing to violate," so these checks always passed trivially. Making `cognitiveLevel`/`questionIntent` live (§11) makes these two checks **genuinely load-bearing for the first time** — a variant that drifts to a different cognitive level or intent will now actually fail equivalence and force a fallback, exactly as originally designed but never actually exercised in production.

---

## 11. Cognitive-Level & Question-Intent Liveness Fix (3D)

**Finding**: `GeneratedQuestion.cognitiveLevel: CognitiveLevel` and `.questionIntent: QuestionIntent` had existed in the type system, with fully-built consumers (variant-equivalence checking §10, `questionSemantics` metadata pass-through in `generate-and-take/route.ts`), but `buildQuestionGenerationPrompt`/`jsonShapeExample` never requested them in the AI's JSON output shape, and the response-parsing loop never read them even when present — every question generated in production has always had both fields `undefined`.

**Fix implemented** ([quiz-generation.service.ts](../../src/services/quiz-generation.service.ts)):
1. Added REQUIREMENTS item 8 to the generation prompt, with real per-level/per-intent definitions (Bloom's-taxonomy-grounded), explicitly instructing the model to tag every question honestly rather than defaulting to one value.
2. Added `cognitiveLevel`/`questionIntent` to every question type's JSON shape example.
3. Added `KNOWN_COGNITIVE_LEVELS`/`KNOWN_QUESTION_INTENTS` validation sets — the parsing loop now reads these two fields **only when they match a known enum value**; a typo, an out-of-set value, or an omitted field degrades to `undefined`, never a fabricated guess.
4. **Deliberately excluded `VERIFICATION` from the AI's own choice set** — it's not a property of a question's content, but of the calling context (a question re-asked specifically to check independence after a trigger fires); `generateQuestionVariant` already inherits the *source* question's `questionIntent` onto its variant rather than letting generation invent `'VERIFICATION'` itself.
5. **Deliberately left `evidenceDimensions`, `expectedReasoningType`, `learningObjectiveId` unpopulated** — documented in the type's doc comment as a conscious scope decision, not an oversight: no reliable signal exists for them yet (`evidenceDimensions` overlaps Evidence Mode's own already-authoritative independence dimension; the other two would need either an ungrounded second AI judgment call or curriculum-mapping input this codebase doesn't have).

**Proof**: 3 new tests in a new file, `tests/unit/cognitive-level-generation.test.ts` — a mocked end-to-end AI response (i) with valid enum values passes them through; (ii) with an invalid/reserved value (`'MASTERY'`, `'VERIFICATION'`) degrades to `undefined`; (iii) with the fields omitted entirely also degrades to `undefined`. All passing. `evaluateVariantEquivalence`'s cognitive-level/scoring-intent checks are now genuinely exercised (§10).

---

## 12. Competency Evidence Audit (Explain & Defend, Transfer, Real Exam Attribution)

- **Explain & Defend** (`explain-defend.service.ts`, 162 lines, read in full): fixed 0-4 rubric across 3 dimensions, the AI is never allowed to declare a free-form "understood/not understood" verdict. Correctly stamped `learningMode: 'COACH'` (not independent) via `explain/submit/route.ts` — confirmed this evidence is correctly excluded from "independent assessment" by construction (it never stamps `evidenceMode`, and `getAssessmentStateForConcept`, §14, only recognizes `evidenceMode === 'ASSESSMENT'` or `REAL_SCHOOL_EXAM`).
- **Transfer** (`transfer.service.ts`, 172 lines, read in full): grading fails closed to `'incorrect'` on any invalid/unexpected AI output (never silently `'correct'`). `computeTransferScore` is a deterministic, distance-weighted, assistance-discounted, null-safe average — kept as its own dimension, never merged into Mastery, confirmed structurally (no `knowledge-state.service` import).
- **Real School Exam attribution** (`exam-result.service.ts`, 325 lines, read in full): `getConceptAttribution`'s three-tier granularity (`CONCEPT_MAPPED` > `TOPICS_LIST` > `SUBJECT_WIDE`) re-confirmed correct and honestly documented — question/section-level granularity is explicitly *not* fabricated ("that's honest, not a shortcut," per the source's own comment). `confidenceWeight = coverageWeight × mappingConfidence`, clamped [0,1], correctly discounts a coarse SUBJECT_WIDE attribution (0.4) versus an explicit CONCEPT_MAPPED one. Idempotency via client-minted `submissionToken` (not `occurrenceId`, which must remain legitimately re-enterable) is correctly scoped.
- **Genuine finding in this file** (fixed as part of §14, not a defect *in* this file): `recordExamResult`'s `updateMastery` call never stamps `metadata.evidenceMode` — an intentional gap in this module's own design (it predates the Evidence Mode system), but one that would have silently made this evidence invisible to the new Twin exposure had it not been specifically accounted for.
- **External Assessment / Calibration Conflict** (`external-assessment.service.ts`, 212 lines, read in full): read-only against internal state, never writes to `concept_knowledge_state`/`mastery_records`; correctly defers "what to do about a conflict" to a future phase, consistent with this phase's own non-goal boundary.
- **Assessment Calendar** (`assessment.service.ts`, 309 lines, read in full): pure scheduling metadata (`assessment_occurrences`/`assessment_schedule_rules`); no measurement/evidence semantics live here, confirming this is correctly scoped as `AssessmentPressure` input only.
- **Quiz Persistence** (`quiz-persistence.service.ts`, 317 lines, read in full): confirms Activity Type/Evidence Mode immutability at the storage layer (§7); `quick_check` correctly maps to `SOLO_CHECK`, not `CUMULATIVE_ASSESSMENT` (a documented earlier fix, re-verified still in place).

---

## 13. Assessment Integrity & Measurement Quality Audit (3E)

- **Insufficient-evidence honesty**: `generateQuestionsForConcept` returns `[]` on total generation failure (never a fabricated question); confirmed `storeQuiz` is never called with an empty question set from any live route path in a way that would fabricate a "completed" assessment with no real content.
- **AI as source of truth**: re-confirmed `AI_AS_ASSESSMENT_SOURCE_OF_TRUTH = NO` — every AI call in the assessment path (`gradeAnswer`, `gradeStructuredAnswer`, verification grading) produces a *component* (a score, a confidence, a rubric dimension) fed into deterministic downstream code (`updateMastery`, `calculateAssessmentConfidence`, `qualifyEvidence`); no AI call ever writes `mastery_records`/`concept_knowledge_state` directly (§15, `AI_DIRECT_ASSESSMENT_STATE_WRITES = 0`).
- **Hints/AI-assistance boundary**: `canUseAI` gate + `hints_used_questions` tracking correctly excludes ASSESSMENT-mode attempts from hint access (`hint/route.ts` checks `evidenceMode` before granting).

---

## 14. Digital Learning Twin / DecisionContext Assessment-State Exposure (3F)

**Finding**: `src/lib/learner-twin/types.ts` had zero assessment/verification-specific fields beyond the pre-existing `AssessmentPressure` (exam-*scheduling* pressure only — unrelated to independence/verification/cognitive-demand evidence). A future Decision Engine had no way to read "has this concept ever been independently assessed," "is there a pending verification," or "what was the last verification outcome" for a concept.

**Fix implemented**, following the exact certified `interventionState`/`validationState` pattern from Phase 2D/2E (bounded reader in the domain service → thin `SignalQuality`-wrapped reader in `readers.ts` → eager on `ConceptView`, lazy `MetricProjection`-gated on `DecisionContext`):

- New `AssessmentStateSummary` / `getAssessmentStateForConcept(studentId, conceptId, client)` in [assessment-verification.service.ts](../../src/services/assessment-verification.service.ts) — **3 bounded, indexed queries, no unbounded history**:
  1. Most recent evidence where `metadata.evidenceMode = 'ASSESSMENT'` **OR** `source_type = 'REAL_SCHOOL_EXAM'` (the second clause is the mid-implementation fix described below) — `LIMIT 1`.
  2. Most recent *resolved* `verification_attempts` row (`outcome IS NOT NULL`) — `LIMIT 1`.
  3. `COUNT(*)` of unresolved (`outcome IS NULL`) `verification_attempts` rows.
- New `AssessmentState` type (extends the summary with `SignalQuality`) in `types.ts`; new `readAssessmentState` in `readers.ts`; wired eager into `getConceptView` and lazy (`options.derivedMetrics`-gated, default `{requested: false}`, zero extra queries) into `getDecisionContext` — mirroring `interventionState`/`validationState` exactly, including adding `'assessmentState'` to `DerivedMetricName`/`ALL_DERIVED_METRIC_NAMES`.

**Mid-implementation fix (found while building this)**: the initial version only recognized `metadata.evidenceMode = 'ASSESSMENT'`, which would have **silently excluded `REAL_SCHOOL_EXAM` evidence** — the highest-trust, real-world independent evidence in the entire product (full `1.0` `confidenceWeight`, versus `0.3`-class for a practice quiz) — because `exam-result.service.ts`'s writer predates the Evidence Mode system and never stamps that metadata field. Fixed by widening the query to `OR source_type = 'REAL_SCHOOL_EXAM'` and adding `sourceType` to the returned shape so a consumer can always tell which kind of independent evidence it's looking at.

**Proof**:
- Query-cost regression (`decision-context-query-cost.test.ts`, extended): default `getDecisionContext` call issues **zero** `assessmentState`-related queries (proven both by reader-function-not-called AND by SQL-pattern-absent-from-call-log); `{derivedMetrics: 'all'}` and `{derivedMetrics: ['assessmentState']}` both correctly trigger exactly the 3 queries above, without touching `interventionState`/`validationState`'s queries.
- Unit tests (`assessment-verification.service.test.ts`, extended): no-evidence case → all nulls/false (never fabricated); ASSESSMENT-mode evidence recognized via `evidenceMode`; `REAL_SCHOOL_EXAM` evidence recognized via `source_type` even with no `evidenceMode` stamp; resolved verification and pending verification reported independently.
- Four other fixture files (`learner-twin.test.ts`, `learner-twin-consumer-regression.test.ts`, `learner-twin-response-timing.test.ts`) updated with the new bounded query shapes and re-verified passing — these are eager-on-`ConceptView` queries, always exercised, so their "fails loudly on any unmocked query" fixtures needed the 3 new shapes added.

---

## 15. Architecture Regression Counts

| Metric | Count | Basis |
|---|---:|---|
| `CANONICAL_ASSESSMENT_MODES` | 3 | `EvidenceMode`: PRACTICE / INDEPENDENT / ASSESSMENT — the trust-dimension. `ActivityType` (10 values) is a separate, orthogonal "what is the student doing" dimension, not a second set of competing modes. |
| `CANONICAL_ASSESSMENT_APPLICATION_BOUNDARY` | 1 | `evidenceModeForActivity()`, fixed once at `storeQuiz` time, immutable — the sole point in the codebase that decides an attempt's Evidence Mode. |
| `FRAGMENTED_ASSESSMENT_WRITERS` | 0 | Every Assessment-mode evidence writer (`generate-and-take`, `verify`, `exam-result.service.ts`) routes through the same `updateMastery` pipeline. |
| `ASSESSMENT_EVIDENCE_IDEMPOTENCY_BYPASSES` | 0 | `QUIZ_SUBMISSION` (quizId+conceptId), `VERIFICATION_RESOLUTION` (verificationAttemptId+conceptId), `REAL_SCHOOL_EXAM` (submissionToken+conceptId) — every writer keys an `identity`/`operation_key`. |
| `PRACTICE_EVIDENCE_MASQUERADING_AS_INDEPENDENT` | 0 | Evidence Mode immutable at creation (§7); Twin reader (§14) only recognizes `evidenceMode='ASSESSMENT'`/`REAL_SCHOOL_EXAM`, correctly excluding COACH-mode Explain & Defend evidence. |
| `ASSISTED_EVIDENCE_COUNTED_INDEPENDENT` | 0 | `canUseAI` gate + `hints_used_questions`; ASSESSMENT-mode attempts have hints/AI disabled by permission policy, confirmed in `hint/route.ts`. |
| `RAW_SCORE_ONLY_COMPETENCY_CLAIMS` | 0 | Assessment Confidence always scales `confidenceWeight`; `qualifyEvidence` always attaches a strength label, never a bare score. |
| `VERIFICATION_VARIANT_BYPASSES` | **1 found → 0 remaining** | The same-question fallback confidence-boost gap (§9) — fixed this phase. |
| `NON_EQUIVALENT_VERIFICATION_ACCEPTANCE_PATHS` | 0 | `generateQuestionVariant` returns `null` (never a silent non-equivalent question) on any of 6 failed equivalence checks; every caller falls back correctly. |
| `ASSESSMENT_HISTORY_COUNTED_AS_CURRENT_FAILURE` | 0 | `getAssessmentStateForConcept` always reads the single most-recent row (`LIMIT 1`) for both assessment and verification state — never aggregates historical failures as current. |
| `AI_DIRECT_ASSESSMENT_STATE_WRITES` | 0 | No AI call anywhere in the assessment path writes `mastery_records`/`concept_knowledge_state`/`quiz_sessions` directly; every AI output is a component consumed by deterministic code. |
| `UNBOUNDED_ASSESSMENT_HISTORY_READS_IN_DECISION_CONTEXT` | 0 | `getAssessmentStateForConcept`: 2× `LIMIT 1` + 1× `COUNT(*)`, proven zero-extra-query-by-default via the query-cost regression test (§14). |

---

## 16. Red-Team Audit — False-Positive Independence Claims

Adversarial scenarios evaluated against the *current* (post-fix) codebase:

1. **Same exact memorized question re-asked as "verification"** → **BLOCKED** (§9 fix): `CONFIRMED` on a same-question fallback produces zero confidence movement.
2. **AI hint/solution exposure during an Assessment-mode attempt** → **BLOCKED**: `canUseAI` gate keyed on `evidenceMode`.
3. **Practice-mode score silently counted as independent** → **BLOCKED**: immutable Evidence Mode (§7); Twin reader filters explicitly (§14).
4. **Assisted Explanation (COACH mode) counted as independent evidence** → **BLOCKED**: `learningMode: 'COACH'` stamped, never `evidenceMode: 'ASSESSMENT'`; excluded from `lastIndependentAssessment` by construction.
5. **Non-equivalent variant silently accepted (different concept/difficulty/type)** → **BLOCKED**: `evaluateVariantEquivalence`'s 6-dimension check, `null`-on-failure contract (§10).
6. **Wrong-concept variant** → **BLOCKED**: the `concept` equivalence dimension is a hard, non-optional check (`candidate.conceptId === source.conceptId`), never soft-passed.
7. **Invalid/expired verification session accepted** → **BLOCKED**: `getPendingVerificationAttempt` scopes to `quiz_session_id + concept_id + student_id + outcome IS NULL`; a resolved or foreign session never matches.
8. **Replay of an already-resolved verification** → **BLOCKED**: `resolveVerificationAttempt`'s atomic `WHERE outcome IS NULL` claim (pre-existing Phase 2B pattern, re-confirmed unchanged) + `submitQualifiedAssessmentEvidence`'s independent `VERIFICATION_RESOLUTION` idempotency key — a losing racer gets the real already-applied mastery state, never a second evidence event.
9. **Low-cognitive-demand item (pure recall) silently claimed as high-level competency** → **PARTIALLY ADDRESSED**: `cognitiveLevel` tagging is now live (§11) and load-bearing in variant equivalence (§10), but no consumer yet *aggregates* per-concept cognitive-level coverage for a "lucky guess protection" claim — correctly scoped out of this phase (§20, non-blocking risk).

---

## 17. Red-Team Audit — False-Negative Failure Modes

1. **Genuinely independent evidence wrongly excluded from Twin exposure** → **FOUND AND FIXED mid-phase**: `REAL_SCHOOL_EXAM` evidence would have been silently excluded (§14); now included via `source_type`.
2. **A resolved verification never surfacing in Twin state** → **NOT FOUND**: `getAssessmentStateForConcept`'s second query has no filter beyond `outcome IS NOT NULL`, covers every resolved outcome (`CONFIRMED`/`CONTRADICTED`/`INCONCLUSIVE`).
3. **A pending verification silently not blocking a "confirmed independent" claim** → **NOT FOUND**: `hasPendingVerification` is reported as an independent boolean alongside `lastIndependentAssessment`/`lastVerification` — a consumer reading only the final field without checking `hasPendingVerification` is a *future Decision Engine's* responsibility, not a data-availability gap; the honest signal exists.
4. **A concept with evidence exists but the reader throws/returns fabricated defaults** → **NOT FOUND**: all three queries return well-defined empty results (`rows: []` → `null`/`false`), never a thrown error surfacing as a false "no evidence" from a downstream perspective. `getAssessmentStateForConcept` has no `try/catch`-swallow-to-fabricated-default pattern; a real DB error propagates, consistent with the sibling `getInterventionStateForConcept`/`getConceptValidationState` readers it mirrors.
5. **A quiz row predating Evidence Mode wiring (`evidence_mode` NULL) silently treated as ASSESSMENT** → **NOT FOUND**: `getQuizSession`'s backward-compatibility derivation (`row.evidence_mode || evidenceModeForActivity(activityType)`) only ever derives PRACTICE/INDEPENDENT/ASSESSMENT from the *original* `quiz_mode`, never defaults toward ASSESSMENT; and evidence rows themselves carry their own `metadata.evidenceMode` stamped at write time regardless of session backward-compatibility.

---

## 18. AI Governance & Auditability

- `AI_AS_ASSESSMENT_SOURCE_OF_TRUTH = NO` — reaffirmed (§13).
- Every AI-graded evidence event carries `aiExecution`/`aiExecutionId` provenance through to the `decision_events` audit trail (`recordDecisionEvent`'s `aiExecutionId` parameter, wired in `verify/route.ts`, unchanged this phase).
- New auditability added this phase: the `VERIFICATION_RESOLVED` decision event now carries `reasonDetails: { wasFreshQuestion }` (§9) — a reader of the audit trail can now see *why* a `CONFIRMED` outcome did or didn't move confidence, not just that it did or didn't.
- `variantEquivalenceConfidence` is now carried through to the `SOLO_VERIFICATION` evidence's own metadata (§9), separate from whatever variant confidence the *original* assessment question's evidence carries — auditable per-evidence-event, not just per-attempt.

---

## 19. Testing Summary

| | Baseline (Phase 2-P) | This phase |
|---|---:|---:|
| Test files | 86 | 87 (+1: `cognitive-level-generation.test.ts`) |
| Tests | 982 | 1000 (+18) |
| Pass rate | 100% | 100% |

New tests by area:
- Same-question verification fallback (§9): 9 tests
- Cognitive-level/question-intent liveness (§11): 3 tests
- Twin assessment-state exposure incl. `REAL_SCHOOL_EXAM` fix (§14): 6 tests (2 in the query-cost regression file, 4 in the service unit test file)

`tsc --noEmit`: clean. `next build`: clean, all routes compile. `npm run db:status`: unchanged — `6 applied, 0 pending, 0 drifted`.

---

## 20. Remaining Risks

**BLOCKING**: none.

**NON-BLOCKING** (2, both explicitly out of this phase's scope by design):

1. **Cognitive-level coverage is not yet aggregated for "lucky guess protection."** `cognitiveLevel` tagging is now live and correctly feeds variant equivalence, but no function yet computes "does this student have qualifying evidence across multiple cognitive levels for this concept, or only ever RECALL-level correct answers." This is a genuine future enhancement, not a defect — the raw signal now exists (§11) for a future consumer to build this on top of; building the aggregation itself was outside this phase's non-goal boundary against inventing new decision logic.
2. **`REAL_SCHOOL_EXAM` and Explain & Defend/Transfer evidence never stamp `evidenceMode`.** The Twin reader (§14) now correctly special-cases `REAL_SCHOOL_EXAM` by `source_type`, but this is a targeted fix, not a systemic one — any *future* independent evidence writer that similarly predates the Evidence Mode system would need the same explicit accounting. Documented here so a future phase doesn't have to rediscover it.

---

## 21. Final Decision

| Field | Status |
|---|---|
| ASSESSMENT_VERIFICATION_ENGINE | CERTIFIED |
| ASSESSMENT_MODE_SEPARATION | CERTIFIED |
| ASSESSMENT_EVIDENCE_INTEGRITY | CERTIFIED |
| INDEPENDENCE_MEASUREMENT | CERTIFIED (same-question fallback gap closed, §9) |
| VERIFICATION_ENGINE | CERTIFIED |
| VARIANT_EQUIVALENCE_INTEGRITY | CERTIFIED (now genuinely load-bearing on cognitive level/intent, §10-11) |
| COGNITIVE_LEVEL_ASSESSMENT | ADEQUATE (tagging live and validated; aggregation for lucky-guess protection deferred, §20.1) |
| COMPETENCY_EVIDENCE | CERTIFIED |
| ASSESSMENT_INTEGRITY | CERTIFIED |
| MEASUREMENT_QUALITY | CERTIFIED |
| DIGITAL_TWIN_ASSESSMENT_READINESS | CERTIFIED |
| ASSESSMENT_CONTEXT_READY_FOR_DECISION_ENGINE | ADEQUATE (assessmentState exposed via the certified lazy-projection pattern; a Decision Engine to consume it does not yet exist, by design) |
| PHASE_3_COMPLETE | YES |
| READY_FOR_PHASE_3_PRODUCTION_RELEASE | YES (pending external certification, per this phase's own closing instruction) |
| READY_FOR_PHASE_4 | YES (assessment context is exposed and trustworthy; the pre-existing old-numbering Decision Engine remains the certified production authority and was not touched) |

**This phase implemented three genuine gaps (§9, §11, §14, with a fourth found-and-fixed mid-implementation in §14), left everything else — including the entire pre-existing Decision Engine this phase's non-goals protect — untouched and zero-diff, and adds 18 new tests (1000/1000 passing) with zero new production migrations.**

Per this phase's explicit closing instruction: **not committed, not pushed, not deployed, no production migration applied, Phase 4 not begun.**
