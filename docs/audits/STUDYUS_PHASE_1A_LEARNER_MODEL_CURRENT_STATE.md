# StudyUs Phase 1A — Learner Model Current-State Certification

Date: 2026-08-31. Read-only audit. No Learner Model, Digital Learning Twin, database column/table, mastery, Knowledge State, or onboarding change was made by this phase.

---

## 1. Executive Summary

**`CURRENT_LEARNER_MODEL_STATUS = PARTIAL`**
**`READY_TO_DESIGN_DIGITAL_LEARNING_TWIN = YES_WITH_CONDITIONS`**

- StudyUs already captures real, structured signal across nearly every dimension the target Digital Learning Twin names — academic context, five-dimension Knowledge State, errors, misconceptions, assessment evidence, retention (forgetting-risk + spaced review), transfer, independence, and even a genuine, working **metacognitive calibration** feature (self-reported confidence vs. actual result, `OVERCONFIDENT`/`WELL_CALIBRATED`/`UNDERCONFIDENT`).
- **This is not a thin profile.** The gap is not "we don't have data" — it's that the data is **fragmented across four+ separate read-model functions with no single canonical `getLearnerModel(studentId)`**, and some of the richest signal (confidence calibration, independent mastery) has real live consumers only through one narrow, concept-scoped function (`getLearnerConceptState`), not through any full-learner aggregate.
- **`getLearnerModelSummary(studentId)`** — the function whose name most literally matches "the Learner Model" — **has zero live callers**. It is dead code today.
- Four genuinely different learner-facing/decision-facing read models coexist, each built for one specific page or decision: `getLearningOSSnapshot` (Today/decision-plan view), `getStudentProgressOverview` (Progress V2 dashboard), `getSubjectLearnerModel` (subject detail page), `getLearnerConceptState` (concept detail page + 3 real decision services: remediation, cognitive-diagnosis, tutor-strategy).
- **No timing/behavioral telemetry exists at all**: no response time, no per-question time-on-task, no explicit abandonment flag. `quiz_sessions.status='expired'` is the only abandonment proxy, and it's inferential, not captured directly.
- **Learning velocity is NOT_DERIVABLE_WITH_CURRENT_DATA** in the general case: `learning_evidence.timestamp` gives a per-attempt trail, but there is no persisted "first exposure" marker distinct from "first evidence," and no persisted mastery-state-transition timestamp — only the *current* `concept_knowledge_state.updated_at`, which is overwritten on every recompute, not appended as history.
- **No "learning styles" anti-pattern found anywhere in the codebase** — confirmed by direct search. The existing model is entirely evidence-based (mastery, misconceptions, independence, retention), exactly the target's stated direction.
- **Independence, help dependency, and knowledge-vs-assisted-performance are all genuinely well-modeled today**: `ai_assistance_type`, `learning_mode` (SOLO/COACH/AI_NATIVE), `hints_used`, `independence` as one of the five live Knowledge State dimensions, and a full deterministic Verification Engine that specifically exists to confirm independent mastery.
- **Retention has real, working logic** (`calculateForgettingRisk`, `calculateNextReviewDate`), actively consumed by the orchestrator and today-plan services — this is a live decision input today, not aspirational.
- **Data quality/provenance is inconsistent by design across sources**: deterministic facts (mastery scale, evidence counts) carry no explicit confidence field; AI-derived signals (misconception classification, grading) now carry real provenance via Phase 0E1/0E2's `AIProvenance`/`decision_events`, but that provenance doesn't yet flow back into any learner-facing read model — it lives in the audit trail, not in `LearnerConceptState`.
- **No new database column, table, or migration is needed to describe most of what's captured today** — the "condition" in `YES_WITH_CONDITIONS` is architectural consolidation (one canonical read model) and a small number of genuinely missing signals (timing, explicit misconception resolution status, persisted state-transition history), not a rewrite.
- Production re-verified aligned: `afa2e2a`, matching Phase 0G's certified commit, no drift.
- 727/727 tests passing, `tsc` clean, build clean — re-run this phase, not assumed.

---

## 2. Current Learner Architecture

```
                         CLERK (authenticated account)
                                    |
                                    v
                    Shared UUID (getOrCreateStudentId)
                         |                    |
                         v                    v
                  students.id            profiles.id
              (account identity:     (legacy-space FK target
               name, email,           for mastery_records/
               language, timezone)    learning_evidence/errors/
                                       learning_debt/subjects)
                                    |
        +---------------------------+---------------------------+
        |               |           |           |               |
        v               v           v           v               v
  student_academic  subjects    learning_    concept_        errors /
  _profile          (+IB,       evidence     knowledge_      misconception_
  (country, school,  language)  (canonical   state           signatures /
  curriculum, IB)                evidence)   (5 dimensions)  student_misconceptions
        |               |           |           |               |
        v               v           v           v               v
  student_        study_plans / assessment_  verification_   FRAGMENTED READ MODELS:
  availability    study_sessions occurrences/ attempts        - learner-model.service.ts
  (one daily      (planned,      _results                     - learning-os-snapshot.service.ts
   window)        not tracked                                 - progress-overview.service.ts
                  actual)                                      (no single getLearnerModel())
```

No box in this diagram is invented — every table/service named exists live, re-confirmed this phase. The one missing box the target vision implies but StudyUs does not have: a unifying **Digital Learning Twin** aggregate sitting above all of these. Today, each consumer (a UI page, a decision service) queries the specific tables/functions it needs directly.

---

## 3. Identity

Reconfirmed unchanged since Phase 0C/0F/0G: Clerk authenticates the account; `getOrCreateStudentId` mints one shared UUID, written into both `students.id` and `profiles.id` (no FK between them, application-convention-only sync, 12/12-table split, 0 orphans — all previously certified, unchanged).

**Account identity** (who is logging in): `students.email`, `students.name`, `students.clerk_id`.

**Learning identity** (context for the Learner Model, conceptually distinct from account identity even though currently colocated in the same `students` row): `students.language` (a legacy, single interface-language field), `students.timezone`.

These two are **not cleanly separated today** — `students` mixes both account fields (email, name) and one learning-context field (language) in one table, and a *second*, richer language model exists entirely separately (`user_language_preferences`: `interface_language`/`preferred_learning_language`/`source_language`, three distinct dimensions) alongside a *third*, subject-scoped language field (`subjects.target_language`/`quiz_language_mode`). Three different places assert "what language" for a student, at three different granularities, with no single source of truth. This is a concrete fragmentation example, documented here, not fixed.

---

## 4. Academic Context

`student_academic_profile` (`academic-profile.service.ts`), one row per student:

| Field | Status | Level |
|---|---|---|
| Country of study | **EXISTS** (`country_of_study`, enum: CO/MX/US/DE/OTHER) | Student |
| School name | **EXISTS** (`school_name`, free text, nullable) | Student |
| School year / grade | **EXISTS** (`school_year`, free text, nullable) | Student |
| Academic year | **EXISTS** (`academic_year`, free text, nullable) | Student |
| Curriculum type | **EXISTS** (`curriculum_type`, enum: national/ib/other/not_sure) | Student |
| National curriculum specifics (which national curriculum, syllabus version) | **MISSING** — `curriculum_type='national'` is a flag with no further detail | Student |
| IB status | **EXISTS** (implied by `curriculum_type='ib'` + `ib_programme` non-null) | Student |
| IB programme | **EXISTS** (`ib_programme`: MYP/DP) | Student |
| IB year | **EXISTS** (`ib_year`, free text) | Student |
| Subjects | **EXISTS** (`subjects` table, per-student rows) | Subject |
| Subject group (IB) | **EXISTS** (`subjects.ib_subject_group`) | Subject |
| Subject level (IB) | **EXISTS** (`subjects.ib_level`: SL/HL) | Subject |
| Target language | **EXISTS** (`subjects.target_language` + `quiz_language_mode`) | Subject |
| School assessment schedule | **PARTIAL** — `assessment_occurrences` captures date/subject/topics/status, but no assessment *type* (quiz/midterm/final) and no source-of-truth distinction between school-provided and self-reported schedule | Subject |
| `profile_completed` flag | **EXISTS** | Student |

Every field above is a genuine, distinct column — not inferred from a JSON blob. No academic-context field found this phase was fabricated or aspirational.

---

## 5. Curriculum Context

`LEARNER_CURRICULUM_CONTEXT = PARTIAL`

StudyUs can answer, for a given learner:
- **Which curriculum?** Yes (`student_academic_profile.curriculum_type`/`ib_programme`).
- **Which subjects?** Yes (`subjects`, one-student-one-subject-row ownership model, certified Phase 0C).
- **Which topics/subtopics?** Yes — `topics`/`subtopics` exist, organized per subject (Phase 2 topic hierarchy), purely for navigation.
- **Which concepts are expected?** **PARTIAL** — concepts exist per subject (`concepts.subject_id`), created either from uploaded material (`extractConceptsFromChunk`) or manually (`createConceptManually`). There is no separate "curriculum-expected concept list" distinct from "concepts that happen to exist because material was uploaded or a student typed one in" — the concept graph *is* the curriculum, built bottom-up from student activity, not top-down from an authoritative IB/national syllabus.
- **Which concepts have already been activated** (attempted at least once)? Yes — directly derivable from `learning_evidence`/`mastery_records` existence (`getEvidenceCoverage` already computes exactly this).
- **Which concepts are prerequisites?** **PARTIAL** — `concept_relationships` (`PREREQUISITE_OF`/`DEPENDS_ON`/`RELATED_TO`/`COMMONLY_CONFUSED_WITH`) exists and is AI-inferred with confidence/source/status (Phase 2 Cognitive Knowledge Graph, certified in Phase 0F's concept-identity check), but is explicitly documented as "proposals, not truth," and is a **global**, subject-wide graph, not evaluated per learner (it doesn't currently say "concept X is a prerequisite gap *for this specific student*," only "X is generally prerequisite to Y").
- **Which concepts are currently relevant to school assessments?** Yes — `assessment_concept_coverage` maps assessment occurrences to concepts with weight/confidence.
- **Which concepts come next?** Yes, at the decision-engine level (`learning-scheduler.service.ts`, `today-plan.service.ts`, `adaptive-learning-orchestrator.service.ts` all exist and consume retention/mastery/debt signals) — but this is a *decision output*, not a stored "curriculum sequence" a learner model itself asserts.

The global Curriculum/Concept Graph (subject → topic → subtopic → concept, and the AI-inferred relationship graph) is correctly kept separate from learner-specific state (mastery/evidence per student+concept) — no fragmentation found between the two; they're two different, appropriately-separated layers.

---

## 6. Knowledge State

Per (student, concept), StudyUs stores/derives:

| Dimension | Stored/Derived | Source | Range | Update event | Quality indicator |
|---|---|---|---|---|---|
| Mastery | Stored | `mastery_records.mastery_score` | 0-100 | Every `updateMastery` call (evidence write) | `confidence_score` (separate column) |
| Understanding | Derived | `knowledge-state.service.ts::classifyUnderstanding` from `learning_evidence` | 0-100 or null | Every `recalculateConceptKnowledgeState` | Evidence count implicit |
| Independence | Derived | `classifyIndependence`, filtered to `ai_assistance_type='NONE'` rows only | 0-100 or null | Same | Sample size implicit |
| Application | Derived | `classifyApplication` | 0-100 or null | Same | — |
| Retention | Derived | `classifyRetention`, min-gap-days policy | 0-100 or null | Same | — |
| Transfer | Derived | `transfer.service.ts::computeTransferScore`, distance-weighted | 0-100 or null | Every Transfer evidence write | — |
| Confidence (self-reported) | Stored | `learning_evidence.confidence_before_answer` | NOT_SURE/SOMEWHAT_SURE/VERY_SURE | Per evidence write, optional | — |
| Confidence calibration | Derived | `computeConfidenceCalibration` | OVERCONFIDENT/WELL_CALIBRATED/UNDERCONFIDENT + 0-100 score | On read (not persisted) | `samples` count, `INSUFFICIENT_EVIDENCE` below `CALIBRATION_MIN_SAMPLES` |
| Attempt/correct/incorrect count | Stored | `mastery_records` | integer | Every evidence write | — |
| Last evidence timestamp | Stored | `learning_evidence.timestamp` (per row); `concept_knowledge_state.last_evidence_at` (aggregate) | timestamp | Every write | — |
| Next review date | Stored | `mastery_records.next_review_date` | date | Every `updateMastery` | — |
| Mastery state label | Derived/Stored | `concept_knowledge_state.mastery_state` (UNKNOWN/LEARNING/DEVELOPING/PROVISIONAL_MASTERY/VALIDATED_MASTERY/AT_RISK/INTERVENTION_REQUIRED) | enum | Every projection | `state_reason` jsonb explains why |
| Validation readiness | Stored | `concept_knowledge_state.validation_readiness` | enum | Every projection | — |

**Example conceptual snapshot, using only implemented fields** (not invented):
```
student=abc, concept=xyz:
  masteryScore: 62 (mastery_records)
  masteryState: PROVISIONAL_MASTERY (concept_knowledge_state)
  dimensions: { understanding: 70, independence: 55, application: null, retention: 80, transfer: null }
  confidence: "SOMEWHAT_SURE" (last self-report)
  confidenceCalibration: { score: 78, label: "WELL_CALIBRATED", samples: 6 }
  attemptCount: 9, correctCount: 6, incorrectCount: 3
  nextReviewDate: 2026-09-05
  lastEvidenceAt: 2026-08-30T14:22:00Z
```
`application`/`transfer` are frequently `null` in practice — they require evidence types (application-style questions, Transfer activities) a given student may simply not have encountered yet. This is a real, honest gap in coverage, not a missing field.

Used by: `mastery.service.ts`, `knowledge-state.service.ts`, `learner-model.service.ts` (concept-detail page + remediation/cognitive-diagnosis/tutor-strategy), `progress-overview.service.ts` (dashboard), `today-plan.service.ts`/`adaptive-learning-orchestrator.service.ts` (scheduling).

---

## 7. Learning Evidence & History

`learning_evidence` remains the canonical write target (re-certified Phase 0F, unchanged). Every field: `student_id`, `concept_id`, `subject_id`, `source_type`, `result`, `difficulty`, `timestamp`, `activity_type`, `learning_mode`, `hints_used`, `ai_assistance_type`, `confidence_before_answer`, `score_percent`, `metadata` (now additionally carrying AI provenance on 3 paths since Phase 0E2). `mastery_events` is the parallel score-delta history (old/new/delta_reason/timestamp) — a full, append-only trail of every mastery change, not overwritten.

---

## 8. Errors

`errors` table: `student_id`, `concept_id`, `subject_id`, `error_type` (CONCEPTUAL/PROCEDURAL/CARELESS/INCOMPLETE/MISREADING — narrower than `quiz-generation.service.ts`'s own `GradingErrorType`, which additionally has ARITHMETIC/UNIT for math/science reasoning; these two never got reconciled into one taxonomy), `source_type`, `created_at`. No severity field.

**Can StudyUs distinguish a one-time mistake from a recurring error pattern? YES** — `error-intelligence.service.ts::getErrorPatterns` explicitly requires `MIN_OCCURRENCES=2` within a `RECENCY_WINDOW_DAYS=30` window before surfacing a "pattern"; this is a derived threshold applied at read time, not a stored flag, but it does the job and is live (feeds `getErrorPatternGuidance`'s AI-generated formative feedback).

---

## 9. Misconceptions

`MISCONCEPTION_MODEL = PARTIAL`

`misconception_signatures` (`concept_id`, `misconception_code`, `description`, `canonical_explanation`, `is_critical`) + `student_misconceptions` (`student_id`, `misconception_signature_id`, `occurrence_count`, `last_seen`, `evidence` jsonb).

| Required field | Present? |
|---|---|
| Specific misconception | YES (`misconception_code`/`description`) |
| Concept | YES (via signature) |
| Student | YES |
| Occurrence count | YES |
| Recency | YES (`last_seen`) |
| Critical status | YES (`is_critical`) |
| **Resolved status** | **MISSING** — no column; every recorded misconception is permanently "active" by the table's own construction (confirmed in-code: `misconception.service.ts`'s own comment states "student_misconceptions has no resolution/expiry concept yet") |
| **Confidence** | **MISSING** — no numeric confidence column on either table |
| AI provenance | **PARTIAL** — not stored on `student_misconceptions` itself, but now cross-referenceable via `decision_events.MISCONCEPTION_RECORDED` → `ai_execution_id` (Phase 0E2), a real but indirect link |

---

## 10. Assessments

Distinguishing school reality from StudyUs's own evidence:

**School reality** — `assessment_occurrences` (scheduled_date, subject_id, topics[], status: expected/..., exam_readiness) + `assessment_results` (score, max_score, generated `percentage`, `analysis_result` jsonb, `analyzed_at`) for real recorded exam outcomes. `assessment_concept_coverage` maps an occurrence to concepts with `weight`/`mapping_confidence`/`source_granularity`.

**StudyUs's own evidence** — `quiz_sessions` (in-app quiz attempts, `evidence_mode`: PRACTICE/SOLO/ASSESSMENT, `activity_type`) + `verification_attempts` (the deterministic-trigger-driven follow-up verification, fully certified Phase 0F: trigger ids, variant equivalence, grading confidence, outcome).

| Question | Answer |
|---|---|
| Upcoming evaluation exists? | YES (`assessment_occurrences.scheduled_date`) |
| Subject? | YES |
| Scope/concepts? | YES (`topics[]` + `assessment_concept_coverage`) |
| Expected type (quiz/midterm/final)? | **MISSING** — no type field |
| Result/score? | YES (`assessment_results`) |
| Concept attribution? | YES, with confidence (`assessment_concept_coverage.mapping_confidence`) |
| Verification result? | YES (`verification_attempts.outcome`) |

---

## 11. Retention

- **Can StudyUs currently estimate what the learner may be forgetting? YES** — `calculateForgettingRisk(daysSincePractice, reviewIntervalDays)` (`src/lib/algorithms/spaced-repetition.ts`) is a real, deterministic function, actively called by `adaptive-learning-orchestrator.service.ts`, `today-plan.service.ts`, and `learner-model.service.ts` — confirmed live consumers this phase, not just defined-and-unused.
- **Can it decide when a specific concept should be retrieved again? YES** — `calculateNextReviewDate` writes `mastery_records.next_review_date` on every `updateMastery` call; `learning-scheduler.service.ts` reads it to drive actual scheduling.

This is a mature, working retention model at the algorithmic level — the main honest limitation is that it operates on the mastery/confidence pair, not on a richer memory-strength model (no per-review-interval history table; only the *next* date is stored, not the full review-interval sequence that produced it).

---

## 12. Transfer

`TRANSFER_MODEL = PARTIAL`

- **Generated**: `generateTransferActivity` (AI, one application question at a NEAR/MID/FAR distance from the original learning context).
- **Evaluated**: `evaluateTransferResponse` (AI-graded correct/partial/incorrect).
- **Persisted evidence**: yes, via the standard `learning_evidence` pipeline (`sourceType: 'TRANSFER'`, `metadata.transferDistance`/`assisted`).
- **Per concept**: yes.
- **Score calculation**: `computeTransferScore` — deterministic, distance-weighted (NEAR 0.7/MID 1.0/FAR 1.3), assistance-discounted, last-10-attempts window.
- **Context distance represented**: yes (`TransferDistance`: NEAR/MID/FAR is a first-class, persisted field).

Marked PARTIAL rather than PASS only because transfer evidence is comparatively rare in practice (it requires deliberately triggering the Transfer activity type, not a default quiz path) — the mechanism is real and correctly designed, but coverage across a typical learner's concept set is thin, matching §6's note that `transferScore` is frequently `null`.

---

## 13. Learning Behavior

| Signal | Classification |
|---|---|
| Hints used | CAPTURED_AND_USED (`hints_used`, `hints_used_questions[]`, feeds `ai_assistance_type` derivation and Independence dimension) |
| AI assistance type | CAPTURED_AND_USED (`ai_assistance_type`, filters Independence dimension) |
| Learning mode (SOLO/COACH/AI_NATIVE) | CAPTURED_AND_USED |
| Response time (per question) | **MISSING** — no column anywhere in the schema |
| Attempt count (lifetime, per concept) | CAPTURED_AND_USED (`mastery_records.attempt_count`) |
| Retries (same question, same sitting) | **MISSING** — no same-question-retry mechanism exists; each generated question is answered once per session |
| Abandonment | DERIVABLE ONLY (proxy: `quiz_sessions.status='expired'` vs `'completed'`; no explicit abandonment flag or reason) |
| Study-session completion | CAPTURED_AND_USED (`study_sessions.completion_status`) |
| Session duration (actual) | **MISSING** — `study_sessions.estimated_duration_minutes` is a *plan*, not a measured actual; `quiz_sessions.created_at`/`completed_at` could derive a coarse total session duration, but nothing does today (DERIVABLE, not captured) |
| Confidence before answer | CAPTURED_AND_USED |
| Confidence after answer | **MISSING** — no "how confident are you now" post-answer capture |
| Independent vs. assisted | CAPTURED_AND_USED |
| Practice vs. assessment | CAPTURED_AND_USED (`evidence_mode`/`activity_type`) |
| Availability | CAPTURED_AND_USED (`student_availability`, feeds study-plan generation) |
| Study-plan adherence | DERIVABLE (comparing `study_sessions.completion_status`/`completed_at` against `scheduled_date`) — not currently computed into a summary metric anywhere found |

---

## 14. Independence

`INDEPENDENCE_MODEL = PASS`

StudyUs can distinguish "student can do this" from "student can do this only with help" through multiple converging, real signals: the `independence` Knowledge State dimension (computed only from `ai_assistance_type='NONE'` evidence), `getIndependentMastery` (a distinct concept-level metric in `learner-model.service.ts`), `learning_mode` (SOLO vs. COACH vs. AI_NATIVE), and the entire Verification Engine (Phase 3B), whose explicit purpose is confirming a result holds up under an independent, unassisted follow-up question. This is one of the most mature dimensions of the current model.

---

## 15. Confidence / Metacognition

`METACOGNITIVE_ACCURACY = EXISTS`

Not merely derivable — **already implemented and live**: `computeConfidenceCalibration` compares self-reported `confidence_before_answer` against actual `result` across a student's recent evidence, producing a labeled (`OVERCONFIDENT`/`WELL_CALIBRATED`/`UNDERCONFIDENT`) score with a minimum-sample gate (`INSUFFICIENT_EVIDENCE` below threshold). It's computed on read (not persisted as a stored row), and reaches real consumers via `getLearnerConceptState` (concept detail page, remediation, cognitive-diagnosis, tutor-strategy services). The gap is not "does the data exist" — it's that no learner-*level* (as opposed to concept-level) aggregate calibration exists, and the underlying `confidence_before_answer` capture is optional/inconsistent (`shouldAskConfidence` gates when it's even asked).

---

## 16. Learning Velocity

`LEARNING_VELOCITY = NOT_DERIVABLE_WITH_CURRENT_DATA` (in the general case)

Required conceptually: first-exposure timestamp, mastery-transition timestamp, verification timestamp. What exists: `learning_evidence.timestamp` gives a full per-attempt trail (so "first evidence timestamp" for a concept IS derivable — the earliest row), and `mastery_events` gives every mastery-score delta with a timestamp. **What's missing**: `concept_knowledge_state` is upserted in place (`ON CONFLICT ... DO UPDATE`) — there is no persisted history of *when* a concept's `mastery_state` label itself transitioned (e.g., when it first became `VALIDATED_MASTERY`), only the current state and `updated_at` of the latest recompute. Velocity from "first exposure" to "first evidence" is derivable; velocity to "first reaching a specific mastery *state*" is not, without re-deriving it from the full `mastery_events` history (theoretically possible by replaying deltas against known thresholds, but nothing does this today, and it wasn't designed for that purpose).

---

## 17. Help Dependency

`HELP_DEPENDENCY = DERIVABLE`

Real inputs exist and are individually captured (`hints_used`, `ai_assistance_type`, `learning_mode`, the Independence dimension, verification outcomes) — but no single "help dependency" score or metric is computed anywhere today. This is a straightforward aggregation of already-captured fields, not a data-collection gap.

---

## 18. Persistence

`PERSISTENCE_MODEL = PARTIAL`

- **Attempts before success**: derivable only at the coarse concept level (`mastery_records.attempt_count` + trend), not at the fine-grained "kept retrying this exact question" level — because there is no same-question-retry mechanism (§13).
- **Retry behavior**: MISSING at the question level; a "retry" today means a new quiz session generating new/variant questions on the same concept, not a literal retry.
- **Abandonment**: DERIVABLE ONLY (proxy via `quiz_sessions.status`).
- **Time on task**: MISSING (§13).
- **Recovery after failure**: DERIVABLE (comparing consecutive `learning_evidence.result` values over time per concept), not computed anywhere today.

---

## 19. Availability & Planning

`PLANNING_CONTEXT = PARTIAL`

- When the learner can study: YES (`student_availability.study_start_time`/`study_end_time`, one daily window, not per-day-of-week).
- How much time: YES (`max_daily_minutes`).
- Preferred days/times: **MISSING** — the schema has no day-of-week granularity, only one fixed daily window applied uniformly.
- Scheduled study: YES (`study_sessions.scheduled_date`, `study_session_items`).
- Completed study: YES (`study_sessions.completion_status`/`completed_at`).
- Missed study: DERIVABLE (`scheduled_date` passed with `completion_status != 'completed'`), not surfaced as a named metric anywhere found.

---

## 20. Learner Read Models

`LEARNER_READ_MODEL = FRAGMENTED`

Four distinct aggregate/summary functions exist, each built for one specific consumer, with real, verified (not assumed) caller counts this phase:

| Function | Purpose | Live callers |
|---|---|---|
| `getLearnerModelSummary` (learner-model.service.ts) | Cross-subject averages (retention, independent mastery, calibration, evidence coverage) | **0 — dead code** |
| `getSubjectLearnerModel` | Same shape, subject-scoped | 1 (subject detail page) |
| `getLearnerConceptState` | Per-concept mastery/retention/independence/confidence/calibration | 4 (concept detail page + remediation.service.ts + cognitive-diagnosis.service.ts + tutor-strategy.service.ts) — **the most decision-relevant of the four** |
| `getLearningOSSnapshot` | Decision/plan snapshot (today's recommended actions), not a learner-attribute model | 2 (Today page, Learning Debt page) |
| `getStudentProgressOverview` | Achievements-oriented Progress V2 dashboard shape | 1 (main dashboard) |

No function returns "everything StudyUs knows about this learner" in one call. A future Digital Learning Twin consumer would today need to call at least three or four of these separately and reconcile their differing shapes itself.

---

## 21. Current Decision Usage

| Learner Signal | Captured? | Used? | Current Consumer | Decision Impact |
|---|---|---|---|---|
| Mastery score | YES | YES | Quiz generation (question count/difficulty context), study planning, debt creation, orchestrator | High |
| Knowledge State (5 dims) | YES | YES | Progress display, remediation, cognitive-diagnosis, verification qualification | High |
| Independence / assisted evidence | YES | YES | Independence dimension, Verification triggers, tutor strategy | High |
| Confidence calibration | YES | PARTIAL | `getLearnerConceptState` consumers (remediation, cognitive-diagnosis, tutor-strategy) | Medium — informs strategy, not a hard gate |
| Retention / forgetting risk | YES | YES | Orchestrator, today-plan, learning-scheduler | High |
| Transfer score | YES | PARTIAL | Knowledge State's `transfer` dimension only; not independently consumed elsewhere | Low-Medium |
| Errors / patterns | YES | YES | Error-intelligence guidance, learning debt severity | Medium |
| Misconceptions | YES | YES | Knowledge State misconception counts, validation readiness, remediation | High |
| Verification outcomes | YES | YES | Assessment Confidence recalculation, evidence qualification | High |
| Academic context (IB, country, curriculum) | YES | PARTIAL | Question-generation IB command-term phrasing; not consumed by any scheduling/decision engine | Low-Medium |
| Availability | YES | YES | Study plan generation | High |
| Hints/AI assistance | YES | YES | Independence dimension, evidence telemetry | Medium |
| Response time | NOT CAPTURED | NO | — | None (data doesn't exist) |
| Learning velocity | NOT DERIVABLE | NO | — | None |
| Help dependency (as a metric) | DERIVABLE, not computed | NO | — | None today |
| Persistence/retry behavior | Mostly not captured | NO | — | None |

This is the clearest evidence for the report's core finding: StudyUs has **substantially more raw data than it currently turns into decisions** — several rich signals (confidence calibration, academic/IB context) reach only a narrow slice of consumers, and a few real gaps (timing, velocity, persistence) simply don't exist to be used yet.

---

## 22. Digital Learning Twin Gap Analysis

| Dimension | Current Maturity | Evidence | Main Gap |
|---|---|---|---|
| A. Academic Context | PARTIAL | §4 — rich fields exist (country, IB, curriculum, subjects) | No national-curriculum detail beyond a flag; assessment type missing |
| B. Knowledge State | MATURE | §6 — 5 live dimensions, versioned policy, audited (Phase 0E2) | `application`/`transfer` frequently null due to thin coverage, not a design flaw |
| C. Cognitive / Error State | PARTIAL | §8/§9 — errors + misconceptions both real and structured | No resolved-status on misconceptions; two divergent error-type taxonomies never reconciled |
| D. Learning Behavior | EARLY | §13 — assistance/mode/hints captured; timing entirely absent | No response time, no time-on-task, no per-question retry telemetry |
| E. Memory / Retention | MATURE | §11 — real, live-consumed algorithm | Only next-date is stored, not full review-interval history |
| F. Metacognition / Independence | MATURE | §14/§15 — independence and calibration both real and working | Calibration is concept-level only; no learner-level aggregate; capture is optional/inconsistent |

---

## 23. Data Quality & Provenance

| Category | Examples | Timestamped? | Confidence field? | Provenance |
|---|---|---|---|---|
| FACT | `learning_evidence.result`, `mastery_records.attempt_count` | Yes | No (facts don't need one) | System-recorded |
| DERIVED STATE | Knowledge State dimensions, `mastery_state`, calibration label | Yes (`updated_at`) | Partial — `state_reason` explains the derivation, but not a numeric confidence on the state itself | Deterministic algorithm, versioned (`mastery_policy_version`, `projection_version`) |
| AI INFERENCE | Misconception classification, transfer/explanation grading, free-text grading | Yes (via `learning_evidence.timestamp` and, since Phase 0E2, `ai_execution_events.created_at`) | Yes, at the execution level (`AIExecutionMetadata.validationStatus`, grading `confidence` field) | **Now real** since Phase 0E1/0E2 — `AIProvenance`/`ai_execution_id` — but this provenance does not flow into any learner-facing read model (§20/§21) |
| SELF-REPORTED | `confidence_before_answer`, academic profile fields | Yes | No explicit reliability score | Student-entered, unvalidated against any external source |
| SYSTEM OBSERVATION | `student_availability`, `quiz_sessions.status` | Yes (`updated_at`/`created_at`) | No | Directly observed, not inferred |

**Stale-data risk**: `student_academic_profile` and `student_availability` have no expiry/staleness signal — a school-year value entered a year ago looks identical to one entered yesterday. **Duplicated sources**: the three-way language fragmentation (§3) is the clearest duplication risk found.

---

## 24. Static vs. Dynamic Learner Data

| Classification | Examples |
|---|---|
| STATIC_PROFILE | `students.name`/`email`, `clerk_id` |
| SLOW_CHANGING_CONTEXT | `student_academic_profile` (country/school/curriculum/IB), `subjects`, `student_availability` |
| DYNAMIC_COGNITIVE_STATE | `mastery_records`, `concept_knowledge_state` (all 5 dimensions), `student_misconceptions.occurrence_count` |
| DYNAMIC_BEHAVIOR_STATE | `hints_used`, `ai_assistance_type`, `learning_mode`, `confidence_before_answer` |
| TEMPORAL_MEMORY_STATE | `next_review_date`, `last_practiced`, retention/forgetting-risk inputs |
| DERIVED_METRIC | Confidence calibration, evidence coverage, independent mastery, transfer score, error patterns |

---

## 25. Anti-Pattern Review

**None found.** Direct search for "visual learner"/"auditory learner"/"kinesthetic"/"learning style" across the entire `src/` tree returned zero matches. The current model is already entirely evidence-based (mastery, misconceptions, independence, retention, context), matching the target vision's explicit direction — there is nothing to report or remove.

---

## 26. Production Alignment

**`PRODUCTION_APPLICATION_VERSION = VERIFIED`** — re-checked this phase, not assumed. `git log -1` still shows `afa2e2a` (no new commit since Phase 0G), and the live production deployment's own build log still reads `Cloning github.com/Johnalbornoz/StudyOS (Branch: main, Commit: afa2e2a)`. No change since Phase 0G; nothing to reconcile.

---

## 27. Tests & Application Health

```
TypeScript: npx tsc --noEmit   -> clean, exit 0
Tests:       npx vitest run     -> 64 test files, 727 tests, all passed
Build:        npm run build      -> exit 0
```

Learner-Model-relevant test groups re-run in isolation: `learner-model.test.ts`, `knowledge-state.test.ts`, `learning-debt.test.ts`, `transfer.test.ts`, `tutor-strategy.test.ts`, `cognitive-diagnosis.test.ts`, `remediation.test.ts`, `study-plan-candidates.test.ts`, `today-plan.test.ts`, `progress-overview.test.ts` — **144/144 passing**.

No production data was mutated at any point in this phase.

---

## 28. Current Learner Capability Matrix

| Capability | Status | Source | Used Today? | Main Gap |
|---|---|---|---|---|
| Identity | EXISTS | `students`/`profiles` | Yes | Account/learning identity mixed in one table |
| Academic context | EXISTS | `student_academic_profile` | Partial | No national-curriculum detail |
| Curriculum/concept context | PARTIAL | `subjects`/`concepts`/`concept_relationships` | Yes | Prerequisites are global, not per-learner |
| Mastery | MATURE | `mastery_records` | Yes | — |
| Knowledge State (5 dims) | MATURE | `concept_knowledge_state` | Yes | Coverage thin for application/transfer |
| Evidence history | MATURE | `learning_evidence`/`mastery_events` | Yes | — |
| Errors | PARTIAL | `errors` | Yes | No severity, two taxonomies |
| Misconceptions | PARTIAL | `misconception_signatures`/`student_misconceptions` | Yes | No resolved-status, no confidence |
| Assessments (school) | PARTIAL | `assessment_occurrences`/`assessment_results` | Yes | No assessment type |
| Verification | MATURE | `verification_attempts` | Yes | — |
| Retention | MATURE | `next_review_date` + algorithm | Yes | Only next-date stored, no interval history |
| Transfer | PARTIAL | `transfer.service.ts` | Partial | Thin coverage |
| Independence | MATURE | Multiple converging signals | Yes | — |
| Confidence/metacognition | MATURE (concept-level) | `computeConfidenceCalibration` | Partial | No learner-level aggregate |
| Learning velocity | MISSING | — | No | No state-transition history |
| Help dependency (as a metric) | DERIVABLE | Existing fields, uncomputed | No | Just needs aggregation |
| Persistence/retry | EARLY | Coarse proxies only | No | No question-level retry/time-on-task |
| Availability/planning | PARTIAL | `student_availability`/`study_plans` | Yes | No per-day-of-week granularity |
| Canonical read model | **MISSING** | — | — | 4 fragmented functions, one dead |

---

## 29. Critical Gaps

| Gap | Classification |
|---|---|
| No single canonical `getLearnerModel(studentId)` read model | **BLOCKER_FOR_DIGITAL_TWIN** |
| No response time / time-on-task telemetry anywhere | **HIGH_VALUE_GAP** |
| No persisted mastery-state-transition history (only current state) | **HIGH_VALUE_GAP** |
| No question-level retry/persistence telemetry | **HIGH_VALUE_GAP** |
| Misconceptions have no resolved-status or confidence field | **MEDIUM_VALUE_GAP** |
| Three-way fragmented language model (students/user_language_preferences/subjects) | **MEDIUM_VALUE_GAP** |
| Two divergent, never-reconciled error-type taxonomies | **MEDIUM_VALUE_GAP** |
| No learner-level (only concept-level) confidence calibration aggregate | **MEDIUM_VALUE_GAP** |
| Concept prerequisites are global, not evaluated per learner | **MEDIUM_VALUE_GAP** |
| No assessment-type field on `assessment_occurrences` | **LOW_PRIORITY** |
| No per-day-of-week availability granularity | **LOW_PRIORITY** |
| AI provenance (Phase 0E1/0E2) doesn't yet flow into any learner-facing read model | **MEDIUM_VALUE_GAP** |

No gap listed above was fixed, implemented, or worked around by this phase.

---

## 30. Phase 1A Definition of Done

- [x] Current identity understood — §3.
- [x] Academic context mapped — §4.
- [x] Curriculum context mapped — §5.
- [x] Knowledge state mapped — §6.
- [x] Errors mapped — §8.
- [x] Misconceptions mapped — §9.
- [x] Assessment state mapped — §10.
- [x] Retention state mapped — §11.
- [x] Transfer state mapped — §12.
- [x] Learning behavior mapped — §13.
- [x] Independence mapped — §14.
- [x] Confidence/metacognition mapped — §15.
- [x] Planning context mapped — §19.
- [x] Learner read model assessed — §20.
- [x] Current decision usage mapped — §21.
- [x] Digital Twin gaps identified — §22/§29.
- [x] Data quality classified — §23.
- [x] No implementation performed — confirmed, zero source/schema files touched this phase.
- [x] Tests pass — §27, 727/727.
- [x] Build passes — §27.

---

## 31. Final Decision

**A. `CURRENT_LEARNER_MODEL_STATUS`?**
**PARTIAL.**

**B. Does StudyUs currently have a true Digital Learning Twin?**
**NO.** It has the majority of the raw signal a Twin would need, but no unifying model, no timing/behavioral telemetry, and no state-transition history.

**C. Does StudyUs currently have enough raw data to build one without major architectural rewrite?**
**YES_WITH_CONDITIONS** — the conditions are: consolidate the fragmented read models into one canonical aggregate, and add the handful of genuinely missing signals (§29) additively, not as a rewrite of anything existing.

**D. Is there one canonical Learner Model read service?**
**NO** (PARTIAL at best) — 4 fragmented functions, one of which (the most aptly-named one) is dead code.

**E. Can StudyUs distinguish knowledge from assisted performance?**
**YES** — §14, one of the most mature parts of the current model.

**F. Can StudyUs estimate learning velocity today?**
**NO** (`NOT_DERIVABLE_WITH_CURRENT_DATA` for state-transition velocity specifically; first-exposure-to-first-evidence is derivable, but that's a narrower claim).

**G. Can StudyUs estimate help dependency today?**
**DERIVABLE** — all inputs exist, no metric computed yet.

**H. Can StudyUs estimate metacognitive accuracy today?**
**YES** — already implemented and live at the concept level (§15).

**I. Can StudyUs estimate retention risk today?**
**YES** — §11, a genuinely mature, live-consumed capability.

**J. Maximum ten gaps required to create the target Digital Learning Twin** (see §29 for full detail):
1. One canonical learner-model read service (consolidate 4 fragmented functions).
2. Response time / time-on-task telemetry.
3. Persisted mastery-state-transition history.
4. Question-level retry/persistence telemetry.
5. Misconception resolved-status + confidence field.
6. Unified language model (collapse the 3-way fragmentation).
7. Reconciled error-type taxonomy.
8. Learner-level confidence-calibration aggregate.
9. Per-learner (not just global) prerequisite gap evaluation.
10. AI provenance surfaced into learner-facing read models, not just the audit trail.

**K. Is Phase 1A ready to certify?**
**YES.**

---

*End of report. No Learner Model, Digital Learning Twin, database schema, mastery, or Knowledge State change was made. Phase 1B will design the target model against this audit.*
