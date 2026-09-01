# StudyUs Phase 1B — Digital Learning Twin Target Architecture

Date: 2026-08-31. Design phase only. No migration, table, column, telemetry, service, or existing engine (Mastery/Knowledge State/Verification/Orchestrator) was created, changed, or implemented by this phase.

---

## 1. Executive Architecture Decision

**`TARGET_DIGITAL_LEARNING_TWIN_ARCHITECTURE = APPROVED_WITH_CONDITIONS`**

Approved because every design decision below traces to concrete Phase 1A evidence, requires **zero required schema changes**, and does not touch any certified Phase 0 engine. Conditioned on: (1) Phase 1C builds the canonical read model *before* any new telemetry, so the fragmentation gap closes first; (2) the RECOMMENDED (not required) schema additions in §28 are reviewed and explicitly approved or rejected individually, not bundled; (3) `learning_evidence`/`errors` metadata additions follow the exact same additive, backward-compatible pattern Phase 0E1/0E2 already proved safe.

---

## 2. Design Principles

1. **Aggregate, never replace.** Mastery, Knowledge State, Evidence, and Verification remain sole sources of truth for their domains.
2. **Store facts and events; derive interpretations.** A number computed from other numbers is calculated on read or cached — it is not a second persisted truth.
3. **Reuse before creating.** `learning_evidence.metadata` and `decision_events` already proved (Phase 0E1/0E2) that additive jsonb/flexible-enum columns can absorb real new signal without a migration — the Twin design exhausts that pattern before proposing a new column.
4. **Evidence-based, never trait-based.** No learning-style label, personality type, or unsupported demographic inference enters the model (Phase 1A confirmed none exist today; this design does not introduce any).
5. **Deterministic gates on consequential transitions.** Exactly as mastery is never AI-assigned (F03), no lifecycle transition this design proposes (e.g., misconception resolution) is ever AI-decided alone — AI can classify or suggest; a deterministic rule over evidence commits the transition.
6. **Bounded by default.** No projection enumerates "everything" unless explicitly asked — the mega-object trap Phase 1A found in embryo (four fragmented functions) is not solved by building one giant object instead.

---

## 3. Twin Domain Boundary

| In the Twin | Not in the Twin |
|---|---|
| A. Account Identity *(minimal — id + language, not email/name)* | Full account PII (email, full name) — stays in `students`/`profiles`, read by auth/account code only |
| B. Academic Context | Raw curriculum definitions (full topic/subtopic text) — referenced by id/label |
| C. Curriculum Context *(by reference)* | Full concept graph traversal logic — the Twin reads `concept_relationships`, it doesn't own the graph |
| D. Cognitive State (mastery, KS, errors, misconceptions) | — |
| E. Learning Behavior State | Raw quiz question/option payloads |
| F. Memory / Retention State | — |
| G. Metacognitive State | — |
| H. Planning Context | Full calendar/scheduling product (recurring events, external sync) |
| I. Temporal History *(via `decision_events`)* | Raw AI prompts/responses (already excluded from the audit trail) |
| J. Derived Learner Metrics | UI preferences unrelated to learning (theme, notifications); billing/subscription; parent/admin relationship data |

---

## 4. Canonical Learner Model Contract

See `docs/architecture/digital-learning-twin.md` for the full conceptual TypeScript shapes (`LearnerModel`, `SubjectView`, `ConceptView`, `DecisionContext`) — reproduced there in full rather than duplicated here to keep one canonical copy. Summary of top-level `LearnerModel` fields: `identity`, `academicContext`, `languageContext`, `subjects[]` (summary only), `planningContext`, `derivedMetrics`, `dataQuality`, `generatedAt`.

---

## 5. Granularity Model

| Field / signal | Granularity |
|---|---|
| Country, curriculum type, IB programme/year, account language | STUDENT |
| Subject list, IB subject group/level, target language, quiz language mode | STUDENT + SUBJECT |
| Mastery, all 5 Knowledge State dimensions, errors, misconceptions, retention, transfer | STUDENT + CONCEPT |
| School assessment occurrence, exam readiness, concept coverage/confidence | STUDENT + SUBJECT + ASSESSMENT |
| Availability window, max daily minutes | STUDENT + TIME WINDOW (currently one static window; §22 discusses day-of-week) |
| Study plan / session schedule, completion | STUDENT + TIME WINDOW |
| Confidence calibration | STUDENT + CONCEPT (exists) → STUDENT + SUBJECT (new aggregate) → STUDENT (new aggregate) |
| Help dependency, learning velocity, persistence | STUDENT + CONCEPT (primary) → aggregable to SUBJECT/STUDENT |
| Prerequisite gap | STUDENT + CONCEPT-PAIR (target, prerequisite) |
| State transition history | STUDENT + CONCEPT + TIME (event stream) |

No field is flattened across levels in this design — a subject-level IB level is never merged into the student-level academic profile object, and concept-level mastery is never averaged into `academicContext`.

---

## 6. Source-of-Truth Matrix

| Twin field | Canonical source | Classification |
|---|---|---|
| identity | `students`/`profiles` (id only) | DIRECT_SOURCE |
| academicContext | `student_academic_profile` | DIRECT_SOURCE |
| subject academic context | `subjects` (ib_*, target_language, quiz_language_mode) | DIRECT_SOURCE |
| languageContext | `user_language_preferences` + `students.language` (fallback) + `subjects.*` | DERIVED_ON_READ (resolution rule, §16) |
| mastery | `mastery_records` | DIRECT_SOURCE |
| knowledgeState (5 dims) | `concept_knowledge_state` | DIRECT_SOURCE |
| errors / patterns | `errors` (+ `error-intelligence.service.ts` thresholding) | DIRECT_SOURCE / DERIVED_ON_READ |
| misconceptions | `misconception_signatures` + `student_misconceptions` | DIRECT_SOURCE |
| misconception lifecycle status | evidence + `decision_events` | DERIVED_ON_READ (§14) |
| verification | `verification_attempts` | DIRECT_SOURCE |
| retention / forgettingRisk | `mastery_records.next_review_date`/`last_practiced` + `spaced-repetition.ts` | DERIVED_ON_READ |
| transfer | `transfer.service.ts` + `learning_evidence` | DERIVED_ON_READ |
| confidence calibration (concept) | `learner-model.service.ts::computeConfidenceCalibration` | DERIVED_ON_READ |
| confidence calibration (subject/student) | same, aggregated | DERIVED_ON_READ (new aggregation, no new source) |
| state transition history | `decision_events` | DIRECT_SOURCE (existing table, new read pattern) |
| learning velocity | `decision_events` + `learning_evidence` | DERIVED_ON_READ |
| help dependency | `learning_evidence` (hints/assistance/mode) + independence dimension | DERIVED_ON_READ |
| persistence (coarse) | `learning_evidence` result sequence | DERIVED_ON_READ |
| response time / time-on-task | *(does not exist)* | NEW_TELEMETRY_REQUIRED |
| prerequisite gaps | `concept_relationships` + learner Knowledge State | DERIVED_ON_READ |
| planning context | `student_availability` + `study_plans`/`study_sessions` | DIRECT_SOURCE |
| assessment pressure | `assessment_occurrences` + `assessment_concept_coverage` | DIRECT_SOURCE |
| AI provenance surfaced to Twin | `decision_events.ai_execution_id` → `ai_execution_events` | DIRECT_SOURCE (new read path, no new write) |

---

## 7. Data Quality / Provenance Contract

```ts
interface SignalQuality {
  sourceType: 'SYSTEM_FACT' | 'DETERMINISTIC_DERIVATION' | 'AI_INFERENCE'
            | 'STUDENT_SELF_REPORT' | 'SCHOOL_REPORTED' | 'BEHAVIOR_OBSERVATION';
  lastUpdatedAt: string;
  sampleSize?: number;     // required for any statistically-derived signal (calibration, help dependency, velocity)
  confidence?: number;     // 0-1, required for AI_INFERENCE and any thresholded derivation
  freshness?: 'CURRENT' | 'AGING' | 'STALE';  // computed per §29 rules, only for DYNAMIC fields
  provenance?: { aiExecutionId?: string; algorithmVersion?: string };
}
```

**Rules**: every field carries `sourceType` + `lastUpdatedAt` at minimum. `sampleSize`/`confidence` are required only when the signal is a statistical derivation below a meaningful-sample threshold (mirrors the existing `INSUFFICIENT_EVIDENCE` pattern already used by calibration). `freshness` applies only to DYNAMIC_COGNITIVE_STATE/DYNAMIC_BEHAVIOR_STATE/TEMPORAL_MEMORY_STATE fields (§24) — a STATIC_PROFILE field like country-of-study has no freshness concept. `provenance.aiExecutionId` is populated only when Phase 0E1/0E2's audit trail already links one — never fabricated.

---

## 8. Temporal Architecture

Required event history: first evidence per concept, mastery-state transitions (first `PROVISIONAL_MASTERY`, first `VALIDATED_MASTERY`, any regression), misconception detected/resolved timestamps, independence-dimension trend.

**All of this is answerable from `decision_events`**, already deployed (Phase 0E2): `MASTERY_UPDATED` rows carry `previous_state`/`new_state` mastery scores per evidence write; `KNOWLEDGE_STATE_PROJECTED` rows carry the full previous/new dimension+state snapshot on every projection. Filtering `decision_events WHERE decision_type='KNOWLEDGE_STATE_PROJECTED' AND concept_id=X AND (new_state->>'masteryState') != COALESCE(previous_state->>'masteryState','')` yields exactly the transition history, with no new table.

**Caveat, stated plainly**: this history exists only from 2026-08-31 forward (Phase 0E2's production deployment date, Phase 0G). There is no retroactive backfill of pre-existing students' state history — a student who reached `VALIDATED_MASTERY` on a concept in July has no recorded transition event; the Twin can only report their *current* state for that concept, not when they got there. This is disclosed, not worked around.

---

## 9. State Transition History — Mechanism Decision

Evaluated per the task's own five options:

- **A. New `concept_state_events` table** — rejected. Would duplicate exactly what `decision_events.KNOWLEDGE_STATE_PROJECTED` already records.
- **B. Snapshots** — rejected. `concept_knowledge_state` already *is* the current snapshot; a second snapshot table adds staleness risk with no new information.
- **C. Reconstruct purely from `decision_events`** — **selected**. Every projection (not just changes) is already recorded; filtering for actual transitions is a query-time concern, not a storage concern.
- **D. Extend `decision_events`** — not needed structurally (option C already works), but the Twin's `includeHistory` read path is the "extension" in spirit: a new *query pattern* against the existing table, not a new column.
- **E. Hybrid** — not needed; C is sufficient today.

**Decision: reuse `decision_events`.** No dedicated concept-state history system is created. If read-time filtering ever proves too slow at scale (unverified, no evidence of this today), an OPTIONAL future materialized view or a `decision_events` index on `(concept_id, decision_type, created_at)` would address it — not a new table, and not required now.

---

## 10. Learning Velocity Definition

`LEARNING_VELOCITY_DEFINITION`:

- **Starting event**: the earliest `learning_evidence.timestamp` for (student, concept) — equivalently, the earliest `MASTERY_UPDATED` `decision_events` row referencing that concept.
- **Ending event(s)**: the earliest `KNOWLEDGE_STATE_PROJECTED` `decision_events` row where `new_state.masteryState` first equals `PROVISIONAL_MASTERY` (weaker milestone) and, separately, the earliest where it first equals `VALIDATED_MASTERY` (target milestone) — two distinct outputs, not one blended number.
- **Minimum evidence quality**: only compute a milestone-velocity value when the underlying projection's `evidenceSufficiency` (already part of `state_reason`) meets the policy's own `requiredEvidenceCount` — a milestone reached on thin evidence is excluded, not silently included.
- **Treatment of gaps/inactivity**: report **both** raw calendar-day duration (first exposure to milestone) **and** active-study-day count (distinct calendar days with any evidence in between) — this lets a consumer distinguish "learned fast because focused" from "elapsed time looks fast but included a long gap." A gap exceeding a configurable threshold (e.g., 14 days with zero evidence) is flagged, not silently absorbed into the duration.
- **Concept-level output**: `{ conceptId, firstExposureAt, provisionalMasteryAt: string|null, validatedMasteryAt: string|null, calendarDaysToProvisional, activeDaysToProvisional, calendarDaysToValidated, activeDaysToValidated, longestGapDays }`.
- **Subject-level aggregation**: median (not mean — robust to concepts that never reach mastery) across concepts in the subject that have reached the milestone.
- **Learner-level aggregation**: median across all subjects' medians.
- **Explicit caveat**: only computable for concepts whose evidence trail began after Phase 0E2's deployment, or whose milestone transition happened after it (§8) — data will be thin initially.

No formula was implemented; this is the complete contract Phase 1C would build against.

---

## 11. Help Dependency Model

`HELP_DEPENDENCY_SCORE` (conceptual):

- **Required signals**: fraction of evidence with `ai_assistance_type != 'NONE'`, fraction with `learning_mode='COACH'`/`'AI_NATIVE'` vs `'SOLO'`, the concept's `independence` Knowledge State dimension, and (when available) whether independent Verification evidence confirms or contradicts assisted-looking prior evidence.
- **Minimum samples**: mirrors the existing `requiredIndependentEvidenceCount` policy threshold already used for the independence dimension — below it, report `INSUFFICIENT_EVIDENCE`, never a fabricated band.
- **Directionality**: higher assisted-evidence fraction + lower independence score + verification frequently contradicting → higher dependency.
- **Bands** (conceptual, not mandatory naming): `INDEPENDENT`, `LIGHT_SUPPORT`, `GUIDED`, `HIGH_DEPENDENCY`.
- **Granularity**: primary at STUDENT+CONCEPT, aggregable to SUBJECT/STUDENT via median band or weighted-average score — same pattern as calibration.

No arbitrary production weights are specified here — that's a Phase 1C/pedagogical-review decision, not an architecture decision.

---

## 12. Persistence / Productive Struggle Model

**Currently derivable** (no new telemetry): coarse attempts-before-success and recovery-after-failure, both from the ordered `learning_evidence.result` sequence per (student, concept) — e.g., an incorrect→incorrect→correct sequence over several *sessions* is visible today.

**Genuinely requires new telemetry** to distinguish healthy productive struggle from random repeated guessing: time-on-task (§13) — a fast wrong→wrong→right sequence looks identical to a slow, reasoned one without it — and true retry linkage (§14), which this design deliberately does not recommend building (see §14's reasoning). Until/unless response-time telemetry exists, `PERSISTENCE_MODEL` should be exposed as `DERIVABLE` (coarse) with an explicit `dataQuality` note that it cannot yet distinguish struggle from guessing.

---

## 13. Behavioral Telemetry (Response Time / Time-on-Task)

Minimum viable design, deliberately non-invasive (no background/foreground tracking, no keystroke-level events):

- `questionStartedAt` — client timestamp captured when a question is first rendered, sent up as part of the existing answer-submission payload (not a separate event).
- `questionAnsweredAt` — client timestamp at submission (or server `NOW()` at grading time — either is acceptable; client timestamp is more accurate but requires trusting client clocks for a non-consequential metric, which is an acceptable tradeoff here since this never gates mastery/correctness).
- `responseTimeMs` — computed once (`answered - started`), stored **additively inside `learning_evidence.metadata`** (`{ responseTimeMs }`), exactly the same pattern Phase 0E1/0E2 already used for AI provenance. **No new column.**
- **Quiz active duration**: derivable today, no new telemetry, from existing `quiz_sessions.created_at`/`completed_at` (coarse — includes idle time, disclosed as approximate).
- **Study-session actual duration**: `study_sessions` currently has `completed_at` but no `started_at` — RECOMMENDED (not required) additive column if genuine session-duration measurement is wanted; until then, only `scheduled_date` vs `completion_status` is available (adherence, not duration).
- **Paused/backgrounded time**: explicitly **out of scope** — deliberately not designed, per the instruction to avoid invasive tracking. `responseTimeMs` should be documented and consumed as *approximate*, noisy with distraction/backgrounding, never as an exact measurement.

---

## 14. Question Retries

**Precise definition of RETRY, to prevent conflation**: a second answer submission for the **same question instance**, within the same quiz session, after an incorrect first attempt, with no new question generated. **This mechanism does not exist in StudyUs today** — each generated question is graded exactly once. "Trying again" today means either (a) a new quiz session on the same concept (new questions generated), or (b) a Verification question (a deliberately AI-generated variant, triggered by the deterministic Verification Engine — **must never be conflated with a retry**, it is a different question testing the same concept from a different angle, with its own `variant_equivalence_confidence`).

**Recommendation: do not build true same-question retry.** Allowing a second attempt at the identical question is a **product/pedagogy decision** (does StudyUs want partial-credit-on-retry, or does single-shot grading remain the intended design?), not a data-architecture gap. This is explicitly flagged as out of scope for this design phase, not silently declined.

**If a future product decision does introduce it**, the identifiers required would be: `questionInstanceId` (already implicitly exists — each generated question already gets a synthetic id) and a new `questionFamilyId`/`variantParentId` linking a question to any variant/retry generated from it (does not exist today; Verification's `generateQuestionVariant` currently links a variant to its source only ephemerally within one request, never persisted as a durable family id). Not designed further here since it is gated on the product decision above.

**Redefined, currently-answerable notion of persistence**: a session-level retry (a new quiz session on the same concept within N days of a weak prior result) is fully derivable today from `quiz_sessions.concept_id`/`created_at` — no new telemetry required for this coarser, product-appropriate signal.

---

## 15. Misconception Lifecycle

Proposed states: **DETECTED → ACTIVE → REINFORCED → RESOLVED → RECURRED** (RECURRED reopens the same signature's ACTIVE state, never creates a duplicate).

- **DETECTED**: first `classifyMisconception` result creates the `student_misconceptions` row (`occurrence_count=1`).
- **ACTIVE**: any row with `occurrence_count >= 1` and no resolution recorded.
- **REINFORCED**: `occurrence_count` increments on a repeat classification while still active (existing behavior, unchanged).
- **RESOLVED**: proposed rule — **N (e.g., 2) independent, correct evidence events on the same concept, occurring after the misconception's `last_seen`, with zero further occurrences of that specific misconception in between.** "Independent" reuses the exact same definition already used for the Independence dimension (`ai_assistance_type = 'NONE'`, or Verification-sourced). This is a **deterministic rule over evidence** — never an AI judgment. AI may *flag a candidate* for resolution review, but the transition itself is computed the same way mastery is: from evidence, deterministically.
- **RECURRED**: a new `classifyMisconception` match against an already-RESOLVED signature reopens it to ACTIVE (not a new row) and increments `occurrence_count`.
- **Confidence**: RECOMMENDED to persist, reusing the existing `student_misconceptions.evidence` jsonb array (already append-only) rather than a new column — each occurrence's AI classification confidence/execution id can be appended there additively.
- **History preservation**: the `evidence` jsonb array already accumulates every occurrence; `decision_events.MISCONCEPTION_RECORDED` already exists for detection events. A future `MISCONCEPTION_RESOLVED` decision type is a **code-level addition** (new string value for the existing, unconstrained `decision_type` text column) — not a schema change.
- **Storage decision**: `status` (ACTIVE/RESOLVED) is proposed as **CALCULATE_ON_READ initially** (derived from evidence + `decision_events`, no new column) — a persisted `status` column is OPTIONAL, only worth adding if read-time computation proves too expensive at scale (unverified today).

---

## 16. Error Taxonomy

**Finding that changes the shape of this decision**: `errors.error_type` has **no CHECK constraint at the database level** — it is a free `varchar(30)`. The five-value `ErrorType` union in `error-intelligence.service.ts` is an **application-level** constraint only. This means `ARITHMETIC`/`UNIT` (already produced by `quiz-generation.service.ts`'s `GradingErrorType` and already passed as `errorClassification` into `updateMastery`) can already be written into `errors.error_type` today **with zero schema change** — the actual gap is that `error-intelligence.service.ts`'s own TypeScript type and its `ERROR_TYPE_MEANING` guidance map don't yet know about them.

**Design: category + subtype, not a flat merge.** `ARITHMETIC`/`UNIT` are genuinely subtypes of `PROCEDURAL` (a calculation slip within an otherwise-correct method), not co-equal top-level categories:

```ts
type ErrorCategory = 'CONCEPTUAL' | 'PROCEDURAL' | 'CARELESS' | 'INCOMPLETE' | 'MISREADING';
type ProceduralSubtype = 'ARITHMETIC' | 'UNIT' | null;  // only meaningful when category = PROCEDURAL
```

**Historical compatibility**: existing `errors.error_type` rows remain valid as-is (the 5-category set is the stored value, unchanged). No data migration. The reconciliation is: (1) widen `error-intelligence.service.ts`'s `ErrorType` union and `ERROR_TYPE_MEANING` to include the two subtypes as recognized (not necessarily top-level-equal) values, (2) optionally, RECOMMENDED not REQUIRED, add an `errors.metadata jsonb` column (the table currently has none, unlike `learning_evidence`) if richer per-error context beyond category/subtype is ever wanted.

---

## 17. Language Context Model

Five-layer hierarchy, most specific wins, each falling back to the next broader layer when unset:

```
1. Interface Language        user_language_preferences.interface_language  (fallback: students.language)
2. Preferred Learning Language  user_language_preferences.preferred_learning_language
3. Source Content Language      user_language_preferences.source_language
4. Subject Instruction Language subjects.target_language                    (overrides 2, subject-scoped)
5. Assessment/Quiz Language      subjects.quiz_language_mode                 (most specific; match_interface | fixed_english)
```

**Source of truth**: `user_language_preferences` is authoritative going forward for layers 1-3; `students.language` is read only as a fallback when no `user_language_preferences` row exists (a compatibility read, not a data migration — same spirit as the students/profiles identity compatibility contract). **Override rule**: resolve top-down — layer 5 wins for quiz text if set, else layer 4 for subject-general content, else layer 2 for tutoring/explanation, else layer 1. This is a **read-time resolution function**, not a schema change — no field is removed or migrated.

---

## 18. Confidence / Metacognition Model

Target hierarchy: **concept calibration** (exists, `computeConfidenceCalibration`) → **subject calibration** (NEW: aggregate concept-level calibration scores across a subject's concepts with sufficient samples — median, `INSUFFICIENT_EVIDENCE` if too few qualifying concepts) → **global learner calibration** (NEW: same aggregation across all subjects). Both new levels are `DERIVED_ON_READ` — no new storage.

**Sampling strategy**: do not force a confidence question after every answer (existing `shouldAskConfidence` gating already avoids this). Recommendation: make the *existing* gate **adaptive** — bias sampling toward concepts/subjects whose current calibration is `INSUFFICIENT_EVIDENCE`, rather than a flat/random frequency, so calibration coverage improves where it's thinnest without increasing total interruption frequency. This is a policy recommendation for Phase 1C to implement inside the existing `shouldAskConfidence` function — no new UI flow, no new table.

---

## 19. Retention Twin Contract

| Field | Status |
|---|---|
| `retentionScore` | CURRENTLY_AVAILABLE (Knowledge State dimension) |
| `forgettingRisk` | CURRENTLY_AVAILABLE (computable via `calculateForgettingRisk`, not currently cached in any one contract) |
| `lastRetrievalAt` | CURRENTLY_AVAILABLE (≈ `mastery_records.last_practiced`) |
| `nextReviewAt` | CURRENTLY_AVAILABLE (`mastery_records.next_review_date`) |
| `retrievalCount` | DERIVABLE (count of `learning_evidence` rows for the concept) |
| `successfulRetrievalCount` | DERIVABLE (same, filtered `result='correct'`) |
| `memoryStrength` (an explicit SM-2/FSRS-style decay parameter) | **FUTURE_ENHANCEMENT** — not supported by the current algorithm, which computes the next interval directly from mastery+confidence rather than tracking a persisted strength state. Not invented here.

---

## 20. Transfer Twin Contract

| Field | Status |
|---|---|
| `transferScore` | CURRENTLY_AVAILABLE (`computeTransferScore`) |
| `coverage` (fraction of concepts with ≥1 transfer evidence row) | DERIVABLE (mirrors the existing `getEvidenceCoverage` pattern) |
| `nearestSuccessfulDistance` / `farthestSuccessfulDistance` | DERIVABLE (MIN/MAX `TransferDistance` among correct transfer evidence) |
| `assistanceLevel` | CURRENTLY_AVAILABLE (`metadata.assisted` per evidence row) |
| `lastTransferAt` | DERIVABLE (MAX timestamp of TRANSFER-sourced evidence) |

**Quality rule, explicit**: one Transfer activity is never reported as proof of general transfer capability. `transferScore` should carry the same `sampleSize`-gated `INSUFFICIENT_EVIDENCE` treatment already used for calibration before being presented with confidence.

---

## 21. Learner-Specific Prerequisite Gaps

Derived, not persisted, unless performance requires otherwise (none found today):

```ts
interface PrerequisiteGap {
  targetConceptId: string;
  prerequisiteConceptId: string;
  relationshipConfidence: number;      // from concept_relationships (AI-inferred, "proposals not truth")
  prerequisiteMasteryScore: number | null;
  prerequisiteMasteryState: MasteryState | null;
  blockingSeverity: number;             // f(relationshipConfidence, prerequisite mastery gap)
}
```

**Source**: join `concept_relationships WHERE target_concept_id=X AND relationship_type='PREREQUISITE_OF'` against the learner's own `mastery_records`/`concept_knowledge_state` for each prerequisite. `blockingSeverity` combines relationship confidence with how far the prerequisite's mastery is below a "safe" threshold — a read-time computation, not a stored value. `DERIVED_AND_CACHED` is a legitimate future option if this is queried on every quiz-generation call and proves expensive — flagged as an implementation-time decision, not required now.

---

## 22. Academic Context Model

Extends, does not replace, `student_academic_profile`:

- Existing fields (country, curriculum type, IB programme/year, school name/year, academic year) kept as-is.
- `nationalCurriculumDetail` — **RECOMMENDED**, optional (nullable text or small structured object) escape hatch for genuine national-syllabus specifics (e.g., "Colombian ICFES," "Mexican SEP"), rather than a custom schema per country. Not required until a real consumer needs it.
- `assessmentType` on assessment occurrences (quiz/midterm/final/mock) — **RECOMMENDED**, optional.
- Subject-level IB configuration (`ibSubjectGroup`, `ibLevel`, `targetLanguage`, `quizLanguageMode`) is kept explicitly separate from student-level IB context (`ibProgramme`, `ibYear`) — the two-tier design Phase 1A already found correct is preserved, not flattened, in the Twin contract.

**Design principle**: a small set of controlled enums plus one optional structured escape hatch, not a combinatorial per-country schema explosion.

---

## 23. Availability / Planning Context

Current: one daily window + `max_daily_minutes`, student-level, no day-of-week granularity.

Target additions, all **RECOMMENDED, not required**: `weeklyAvailability: { dayOfWeek, startTime, endTime }[]` (day-of-week granularity), blackout-date exceptions. **Exam windows require no new field** — already derivable via `assessment_occurrences.scheduled_date`, a read-time join, not new storage. **Explicitly rejected**: a full calendar product (recurring-event rules, external calendar sync) — out of scope; only the signals the Learning OS needs (when, how much, what's coming up) are in bounds.

---

## 24. Canonical Read Model

See `docs/architecture/digital-learning-twin.md` for the full ASCII architecture and sub-reader composition. Summary: `LearnerModelService.getOverview/getSubjectView/getConceptView/getDecisionContext`, all built from shared, composable sub-readers, never four independent implementations (correcting exactly what Phase 1A found fragmented).

---

## 25. Learner Model Projections

| Projection | Granularity | Bounded by | Primary consumers |
|---|---|---|---|
| Overview | Student, cross-subject aggregates | Never enumerates all concepts; `subjectIds`/`conceptIds` options | Dashboard/Progress-style UI |
| Subject | Student + Subject | `concepts[]` paginated/bounded, not exhaustive by default | Subject detail page |
| Concept | Student + Concept | Full detail for one concept; `includeHistory` opt-in | Concept detail page, remediation, cognitive-diagnosis, tutor-strategy |
| Decision Context | Student + Concept, decision-optimized | Minimal fields only, no raw text | Quiz generation, orchestrator, (future) Decision Engine |

---

## 26. Decision Context Contract

Full shape in `docs/architecture/digital-learning-twin.md`. Design intent: the smallest slice a frequently-called decision path needs — scores/bands/counts, never raw evidence text or full misconception descriptions, `recentEvidence` bounded (e.g., last 5), `prerequisiteGaps` bounded to the immediate prerequisite set, not the full transitive graph.

---

## 27. Derived Metric Catalog

| Metric | Exists? | Source | Persistence Strategy | Future Decision Use |
|---|---|---|---|---|
| mastery | EXISTS | `mastery_records` | STORE (unchanged) | Quiz gen, planning, debt |
| independence | EXISTS | KS dimension | STORE (unchanged) | Verification triggers, tutor strategy |
| retentionRisk | DERIVABLE_NOW | `spaced-repetition.ts` | CALCULATE_ON_READ | Retrieval scheduling |
| confidenceCalibration (concept) | EXISTS | `learner-model.service.ts` | CALCULATE_ON_READ | Remediation, tutor strategy |
| confidenceCalibration (subject/learner) | DERIVABLE_NOW | same, aggregated | CALCULATE_ON_READ | Future Decision Engine |
| helpDependency | DERIVABLE_NOW | evidence + independence dim | CALCULATE_ON_READ | Adaptive support level |
| learningVelocity | DERIVABLE_NOW *(data-thin until history accrues)* | `decision_events` | CALCULATE_ON_READ | Pacing decisions |
| persistence (coarse) | DERIVABLE_NOW | evidence sequence | CALCULATE_ON_READ | Struggle detection (partial) |
| persistence (fine, struggle-vs-guessing) | REQUIRES_NEW_TELEMETRY | response time | CALCULATE_ON_READ once captured | Struggle detection (full) |
| evidenceCoverage | EXISTS | `getEvidenceCoverage` | CALCULATE_ON_READ | Coverage gaps |
| transferStrength | EXISTS (score) / DERIVABLE_NOW (coverage) | `transfer.service.ts` | CALCULATE_ON_READ | Transfer-readiness gating |
| assessmentReadiness | EXISTS | `assessment_occurrences.exam_readiness` | STORE (unchanged, existing) | Exam-prep prioritization |
| prerequisiteGapSeverity | DERIVABLE_NOW | `concept_relationships` + KS | CALCULATE_ON_READ (candidate for CACHE) | Remediation sequencing |
| studyPlanAdherence | DERIVABLE_NOW | `study_sessions` | CALCULATE_ON_READ | Planning quality feedback |

Every metric above has a stated future decision consumer — no vanity metric included.

---

## 28. Minimum Required Schema Changes

| Change | Required? | Reason |
|---|---|---|
| *(none)* | — | Every projection/metric in this design is buildable from existing tables + existing jsonb columns + read-time computation |
| `errors.metadata jsonb` | RECOMMENDED | Optional richer per-error context; not required since subtype already fits in the existing unconstrained `error_type` column |
| `student_misconceptions.status` column | RECOMMENDED | Optimization only — status is CALCULATE_ON_READ by default; only worth adding if read cost proves too high (unverified) |
| `study_sessions.started_at` | RECOMMENDED | Enables genuine session-duration measurement; without it only scheduled-vs-completed adherence is available |
| `weeklyAvailability` structure on `student_availability` | RECOMMENDED | Day-of-week granularity; current single-window model remains functional without it |
| `nationalCurriculumDetail` on `student_academic_profile` | OPTIONAL | No current consumer needs it |
| `assessmentType` on `assessment_occurrences` | OPTIONAL | No current consumer needs it |
| `learning_evidence.metadata.responseTimeMs` | RECOMMENDED (additive, no migration) | Already-flexible jsonb column; genuinely new capability (§13) |

**REQUIRED changes for Phase 1C to build the canonical read model itself: NONE.**

---

## 29. Event / Telemetry Contract

Only two genuinely new client-observable events are proposed, both minimal and non-invasive:

- **`QUESTION_PRESENTED`** — client records `questionStartedAt` when a question renders. Not persisted as a standalone event; carried forward and attached to the eventual `QUESTION_ANSWERED` payload.
- **`QUESTION_ANSWERED`** (already exists as the answer-submission API call) — extended, additively, to also carry `questionStartedAt`/`responseTimeMs`, landing in `learning_evidence.metadata`.

**Explicitly not proposed**: generic analytics-style events for every UI interaction, session pause/resume tracking, or scroll/focus telemetry — none of these have a stated decision consumer, violating this design's own "every metric needs a future decision use" principle.

---

## 30. Freshness / Cache Strategy

| Category | Expected change rate | Freshness rule |
|---|---|---|
| STATIC_PROFILE (name, email) | Rare | Always CURRENT — no staleness concept |
| SLOW_CHANGING_CONTEXT (school, grade, curriculum, availability) | Weeks-months | CURRENT for 24h, AGING after, never blocks a decision — always usable, just flagged |
| DYNAMIC_COGNITIVE_STATE (mastery, KS dimensions) | Every evidence write | CURRENT immediately after write (no cache layer proposed for these — they're cheap single-row reads today) |
| DYNAMIC_BEHAVIOR_STATE (hints, assistance) | Every evidence write | Same as above |
| TEMPORAL_MEMORY_STATE (next review, retention) | Daily-ish | CURRENT for the calendar day it was computed |
| DERIVED_METRIC (calibration, velocity, help dependency) | On-demand aggregation | Computed fresh per read by default; a persisted cache is only introduced if read volume demands it (unverified today — no premature caching) |

**Rule for the future Decision Engine**: it must never consume a DYNAMIC_COGNITIVE_STATE or DYNAMIC_BEHAVIOR_STATE field marked STALE — but since this design proposes no caching layer for those categories (they're read live from source tables), staleness in that sense cannot currently occur; the rule matters once/if a cache is introduced later.

---

## 31. Privacy / Minimization

Explicitly reviewed and rejected from this design, per instruction: psychological personality labels, unsupported learning-style labels (none exist today, confirmed Phase 1A — none proposed here), unnecessary demographic profiling beyond what academic context already legitimately requires (country/school/curriculum, all directly tied to content localization and IB command-term phrasing — a real, stated product use), raw AI prompts/responses (excluded, consistent with Phase 0E1/0E2), and any field without a stated learning/product purpose. Every field in this design traces to an existing product need (§27's "future decision use" column) or an existing, already-shipped feature.

No obvious unnecessary duplication was introduced by this design — the language-context resolution (§17) is a read-time function over *existing* fields, not a new duplicated store.

---

## 32. Digital Twin Maturity Model

| Level | Name | StudyUs today | After Phase 1 (this design, once 1C-1F ship) |
|---|---|---|---|
| 0 | Profile | — (StudyUs already exceeds this) | — |
| 1 | Academic Context | Achieved | Achieved (unchanged) |
| 2 | Cognitive State | **Achieved** (mastery + 5-dim KS + errors + misconceptions) | Achieved, now surfaced through one canonical read model |
| 3 | Behavioral State | **Partial** (assistance/mode/hints captured; timing missing) | Achieved, once §13's response-time telemetry ships (1D) |
| 4 | Temporal / Predictive Learner Twin | **Early** (decision_events exists but unconsumed by any learner-facing model; no velocity/history surfaced) | Achieved, once §8-10's temporal contract ships (1C/1E) |
| 5 | Self-Regulating Learner Model | Not attempted | Not in scope for Phase 1 — this is the future Learning Decision Engine's job, consuming `DecisionContext` as its input |

StudyUs today sits between Level 2 and Level 3 — more mature than "Level 1 Academic Context" alone would suggest, held back specifically by fragmentation (§ Phase 1A) and the timing/history gaps this document designs against.

---

## 33. Phase 1 Implementation Roadmap

**1C — Core Learner Model Read Architecture**
*Objective*: build `LearnerModelService` and its four projections, consolidating the four fragmented functions, with zero new telemetry.
*Main components*: sub-readers (§ architecture doc), `getOverview`/`getSubjectView`/`getConceptView`/`getDecisionContext`, the `SignalQuality`/`DataQualitySummary` contract, migration of the 4 existing UI/service callers onto the new service (retiring the dead `getLearnerModelSummary` and consolidating the other three).
*Schema impact*: **none required**.
*Risk*: touching 4 existing call sites (concept detail page, remediation, cognitive-diagnosis, tutor-strategy, subject detail page, dashboard, today page, learning-debt page) without changing their observable behavior — regression risk is real but fully covered by existing tests plus new contract tests.
*Definition of Done*: all four projections implemented and tested; all existing callers migrated; `getLearnerModelSummary` either removed or explicitly retired; zero schema change; full test suite still green.

**1D — Behavioral & Temporal Telemetry**
*Objective*: ship the response-time/time-on-task additive metadata capture (§13) and the `decision_events`-based `includeHistory` read path (§8/§9).
*Main components*: client-side `questionStartedAt` capture, extended answer-submission payload, `learning_evidence.metadata.responseTimeMs`, `getConceptView(..., {includeHistory: true})`.
*Schema impact*: **none required** (additive jsonb only); `study_sessions.started_at` RECOMMENDED column is a candidate here if approved separately.
*Risk*: client-clock trust for a non-consequential metric (documented, low severity); ensuring the new payload field doesn't silently break existing answer-submission validation.
*Definition of Done*: response time captured and readable via the Twin; state-transition history readable via `includeHistory`; no behavior/threshold changed.

**1E — Derived Learner Metrics**
*Objective*: implement the derived-metric catalog (§27) — help dependency, learning velocity, persistence (coarse), subject/learner-level calibration aggregates, prerequisite gaps, transfer coverage.
*Main components*: pure calculation functions consuming 1C's read model + 1D's telemetry, all `CALCULATE_ON_READ`, no new storage.
*Schema impact*: **none required**.
*Risk*: velocity/persistence metrics will be data-thin initially (§10's caveat) — must be surfaced with honest `INSUFFICIENT_EVIDENCE` states, not silently omitted or fabricated.
*Definition of Done*: every §27 metric implemented with its documented `sourceType`/`sampleSize` gating; no metric ships without its "future decision use" actually being wired to a real (even if still manual/UI-only) consumer.

**1F — Learner Model Integration & Certification**
*Objective*: certify the full Digital Learning Twin against Phase 1A's original 10 gaps, confirm no regression, prepare the `DecisionContext` contract for the future Learning Decision Engine.
*Main components*: end-to-end tests proving `DecisionContext` is populated correctly for real evidence trails; a Phase 1F certification report mirroring this session's established pattern (Phase 0F-style).
*Schema impact*: none (certification only).
*Risk*: scope creep into building the Decision Engine itself — must be explicitly resisted, matching every prior phase's discipline in this arc.
*Definition of Done*: all 10 Phase 1A gaps re-evaluated as RESOLVED/ACCEPTED/DEFERRED with evidence; `FOUNDATION_READY_FOR_DECISION_ENGINE`-style certification issued.

---

## 34. Architecture Risks

1. **Velocity/history metrics will look thin or empty for months** post-Phase-0E2, since there's no backfill — if surfaced without the `INSUFFICIENT_EVIDENCE` framing, this could read as "broken" rather than "young data."
2. **Migrating 8 existing call sites onto the new canonical service (1C)** carries real regression risk purely from touch-surface, even with zero intended behavior change.
3. **Response-time telemetry's client-clock trust** could be gamed or simply inaccurate (clock skew, tab-switching) — must never be allowed to influence mastery/grading, only behavioral/persistence metrics (this design already scopes it that way, but future misuse is a risk to guard against).
4. **The RECOMMENDED schema additions (§28), if approved piecemeal over time, could re-introduce fragmentation** if a future phase adds one without revisiting the canonical contract — the contract, not individual columns, must remain the reviewed artifact.
5. **Prerequisite-gap derivation cost at read time** is unverified at scale — if it proves expensive under real production load, the DERIVED_AND_CACHED escape hatch (§21) needs a real decision, not an assumption that read-time computation stays cheap forever.

---

## 35. Phase 1B Definition of Done

- [x] Canonical learner contract designed — §4.
- [x] Student/subject/concept granularity defined — §5.
- [x] Existing sources mapped — §6.
- [x] Missing telemetry defined — §13.
- [x] Temporal model defined — §8/§9.
- [x] Learning velocity defined — §10.
- [x] Help dependency defined — §11.
- [x] Persistence model defined — §12.
- [x] Misconception lifecycle defined — §15.
- [x] Error taxonomy designed — §16.
- [x] Language context designed — §17.
- [x] Metacognition hierarchy designed — §18.
- [x] Retention contract designed — §19.
- [x] Transfer contract designed — §20.
- [x] Prerequisite-gap derivation designed — §21.
- [x] Canonical read architecture designed — §24, full detail in `docs/architecture/digital-learning-twin.md`.
- [x] Decision Context designed — §26.
- [x] Store-vs-derive decisions made — §27.
- [x] Minimum schema changes identified — §28.
- [x] Implementation roadmap defined — §33.
- [x] No implementation performed — confirmed, zero source/schema files touched this phase (verified below).

---

## 36. Final Decision

**A. Is the Digital Learning Twin target architecture now sufficiently defined to implement?**
**YES_WITH_CONDITIONS** — see §1.

**B. Does the design require replacing existing Mastery / Knowledge State / Evidence architecture?**
**NO.** Every one of those remains exactly as certified in Phase 0; the Twin only adds a read layer on top.

**C. What should remain source-of-truth rather than move into the Twin?**
`mastery_records`, `concept_knowledge_state`, `learning_evidence`, `verification_attempts`, `misconception_signatures`/`student_misconceptions`, `errors`, `decision_events`, `student_academic_profile`, `subjects`, `concept_relationships`, `student_availability`, `study_plans`/`study_sessions`, `assessment_occurrences`/`assessment_results` — all unchanged, all still owned by their existing services.

**D. What are the minimum REQUIRED schema changes?**
**NONE.** (Full RECOMMENDED/OPTIONAL list in §28.)

**E. Which metrics can be implemented without new telemetry?**
Help dependency, evidence coverage, transfer coverage, prerequisite gap severity, study-plan adherence, subject/learner-level confidence calibration, misconception lifecycle status, error-taxonomy reconciliation, coarse persistence, learning velocity (data-thin but mechanically complete).

**F. Which metrics require new telemetry?**
Response time / time-on-task, and the fine-grained (struggle-vs-guessing) form of persistence that depends on it. (True question-level retry is deliberately not recommended — a product decision, not a telemetry gap.)

**G. What should Phase 1C implement first?**
The canonical `LearnerModelService` read architecture (§24, roadmap §33's "1C") — consolidating the four fragmented functions **before** any new telemetry ships, so new signals land in one coherent model from day one rather than becoming a fifth fragmented source.

**H. Maximum five architecture risks entering Phase 1C** — see §34 in full; summarized: (1) thin/empty velocity data early on, (2) regression risk from migrating 8 existing call sites, (3) client-clock trust for response time, (4) piecemeal schema approval re-fragmenting the contract, (5) unverified prerequisite-gap read cost at scale.

---

*End of report. No migration, table, column, telemetry, service, or existing engine was implemented by this phase. Both required documents (`digital-learning-twin.md` and this report) are delivered together.*
