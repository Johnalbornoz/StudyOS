# Exam Readiness Separation Audit — Knowledge State vs Exam Readiness

Track B · 2026-10-14 · branch `feat/curriculum-first-learning` · the PAA pilot baseline is FROZEN at `610d3c6` and this audit does not modify it.

**Verdict: EXAM_READINESS_SEPARATION_AUDIT = PASS.** The audit is complete and the dependency graph is mapped.

The *current behaviour* is **not separated**: exam evidence reaches Knowledge State today. The target model below defines the separation. It is executable in `src/lib/exam-bank/readiness/evidence-boundary.ts` and proved in `tests/unit/exam-readiness-separation.test.ts`. Production writers are not rewired while PAA is frozen.

---

## 1. Findings in one paragraph

Learning evidence and exam evidence are both written to the same table, `learning_evidence`, by the same writer, `updateMastery` (`src/services/mastery.service.ts:361`). That writer then updates `mastery_records`, the memory projector, the skill and competency analytics, and `concept_knowledge_state` (via `recalculateConceptKnowledgeState`, `src/services/knowledge-state.service.ts:403`). It applies **no evidence-type filter**.

The labels `LEARNING / INTERNAL_ASSESSMENT / EXAM_ASSESSMENT` exist only as JSON metadata. `evidence-plan.ts:320` writes them to `metadata.assessment.supply.evidenceClass`, and only on the canonical path. No column, enum or CHECK constraint holds them, and nothing reads them.

What does exist is exam *scoping*, G6 (`src/lib/exam-core/evidence-scope.ts`). Exam readiness readers use it, so evidence from one exam target never decides another target. But G6 itself documents that exam evidence "also feeds the Knowledge State" (`evidence-scope.ts:10-14`).

The exam writers need a learner concept the Student owns: a `concepts` row in a non-archived subject. They do **not** need Learning Plan membership. Exam evidence for a canonical concept the Student does not own is dropped (`UNRESOLVED_CONCEPT`), so it reaches neither Knowledge State nor Exam Readiness. That gap is PAA-FOLLOWUP-02.

## 2. Inventory

### 2.1 Learner concept state

| Entity | Defined in | Role |
|---|---|---|
| `concepts` (owned via `subjects.student_id`) | `database/baseline/STUDYUS_BASELINE_2026_08.sql:302`, `:729` | The learner concept. There is no `learner_concepts` table. |
| `concept_catalog_mapping` | `migrations/20260922_1000_f4_learning_architecture_2.sql:125` | Maps a learner concept to a canonical concept. Status is CANONICAL, TRANSITIONAL or UNRESOLVED (`src/lib/catalog/concept-identity.ts:61-75`). |
| `mastery_records` (+ `mastery_events`) | baseline `:454` / `:417` | Mastery score, counts and review dates. |
| `concept_knowledge_state` | baseline `:226` (025) | The Knowledge State: mastery_state; understanding, independence, application, retention and transfer; evidence counts. |
| `concept_memory_state`, `concept_transfer_state` | `20260906_1000`, `20260907_1400` | Memory and transfer projections. |
| `learner_skill_state`, `learner_competency_state`, `learner_transfer_analytics` | `20260923_1000:50/68/87` | F5 analytics. |

### 2.2 Evidence

| Item | Defined in | Note |
|---|---|---|
| `learning_evidence` | baseline `:391`; unique `operation_key` in `20260901_1200:59-63` | The single evidence table. `source_type` has **no CHECK**. |
| `EvidenceSourceType` | `src/lib/algorithms/mastery.ts:10-23` | A TypeScript union. EXAM_SIMULATION has weight 0.8 (`:38-51`). |
| evidence class | `src/lib/assessment-supply/supply-boundary.ts:125` (`evidenceClassOf`) | Metadata only; written at `evidence-plan.ts:320`; **no reader**. |
| exam scope (G6) | `src/lib/exam-core/evidence-scope.ts:65-100` | `metadata.examScope`, `context.examAttemptId`, or source type EXAM_SIMULATION. |

### 2.3 Plan membership

| Item | Defined in |
|---|---|
| `student_plan_entries` (IN_PLAN / ARCHIVED) | `migrations/20261018_1400_track_a_learning_plan_orchestrator.sql:64-75` |
| `student_concept_sources` (8 source types: SELF_SELECTED, CURRICULUM_RECOMMENDATION, INSTITUTION_CURRICULUM, CLASS_PLAN, TEACHER_ASSIGNMENT, EXAM_GAP, PREREQUISITE_RECOMMENDATION, INSTITUTION_ASSIGNMENT) | same file `:78-97`; `20261018_1500:205` |
| Writer `enrollCanonicalConcept` | `src/lib/learning-plan/personal-plan.service.ts:196` |

`enrollCanonicalConcept` is called from the plan API, the class plan, institution governance, the teacher flow, and `acceptExamRecommendation` (EXAM_GAP, `exam-bridge.service.ts:184`). The last one is an explicit Student action, not an automatic one.

A learner concept can exist **without** a plan entry. Two writers create one:

- Exam prep: `addConceptFromPreparation` → `addConceptToStudentLearning` (`src/lib/exam-core/catalog/learning-links.service.ts:138-161`). It writes no plan entry.
- Content extraction (`mapping.service.ts:129`).

### 2.4 Exam evidence writers

| Path | When | Guard | Effect |
|---|---|---|---|
| **Canonical (B3)**: `post-completion.ts:37` → `assessment-exam.service.ts:70` → `completeAssessmentEvidence` → `planEvidence` (`evidence-plan.ts:253`) → `updateMastery` | The attempt has an `assessment_snapshot`, i.e. `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED=true`. This is the case on the PAA Preview. | DIRECT credit only. The concept needs a CANONICAL link in a non-archived subject (`concept-identity.service.ts:40-43`); otherwise the outcome is `UNRESOLVED_CONCEPT` (`evidence-plan.ts:308`). `EXAM_SCOPE_REQUIRED` (`:255`). | Writes `EXAM_SIMULATION` with `independenceEligible:false`, `examScope` and class `EXAM_ASSESSMENT`. It updates **mastery and Knowledge State**. |
| **Legacy**: `item-resolution.service.ts:205` → `recordSimulationItemResponse` (`scoring.service.ts:128-159`) | Attempts without a snapshot. | Takes the first `MATCHED` mapping. TRANSITIONAL links are allowed and archived subjects are not filtered (`student-concept-resolution.service.ts:13-21`). | Writes `EXAM_SIMULATION` with `aiAssistanceType:'NONE'` and no independence flag, so the response is **counted as independent** in Knowledge State. |
| `bridgeExamResponseToEvidence` | No caller found (dead code). | — | Would write UNSCOPED_LEGACY rows. |
| `REAL_SCHOOL_EXAM` (`exam-result.service.ts:244`) | Recorded school results. | Attribution. | Updates mastery and Knowledge State. Out of scope: a real school exam is not Exam Prep. |

### 2.5 Exam Readiness today

| Item | Where | Note |
|---|---|---|
| `readiness_snapshots` | `20260927_1000_f9_exam_readiness_simulation.sql:45-71` | Append-only, per exam profile and version. |
| `computeReadinessSnapshot` | `src/lib/readiness/readiness.service.ts:94` | Writes the snapshots. Its evidence stats read `learning_evidence` filtered by `inExamScopeSql`, which keeps all longitudinal Learning evidence *plus* this target's exam evidence. Its independence rule ignores `independenceEligible`. |
| Blueprint coverage | `blueprint-coverage.service.ts:36-46` | Uses the legacy resolver plus `inExamScopeSql`. |
| `exam_attempt_results` | `results.service.ts:226` | Writes no cognition. |
| Exam gaps | `exam-bridge.service.ts:51-109` | Read responses and results, not mastery. |

None of these is a per-concept exam-readiness store. **Today readiness is derived from the shared Knowledge State plus scoped evidence; it is not held as its own model.**

### 2.6 Readers

| Reader | Filters out exam evidence? |
|---|---|
| Learning: dashboard, today plan, personal plan, learning OS snapshot and continuation, concept mission, path view, concept page, learner model | **No.** They read mastery and Knowledge State as they are. |
| `learning-debt.service.ts:450` | **No.** It explicitly includes EXAM_SIMULATION. |
| `exam-journey/facts.server.ts:129` | Yes. It is the only Learning-side reader that excludes exam evidence. |
| Exam prep, `preparation.service.ts:326-360` | No. It shows the shared `mastery_state` and adds scoped counts. |
| Exam result page, `result-view.service.ts:209` | No. It shows the shared Knowledge State. |
| Readiness, blueprint coverage, evidence gate | Scoped by exam target (G6). |
| Parent, `parent/read-model.service.ts:101,104,157,193` | No. |
| Teacher, `teacher/read-model.service.ts:166,172` and `learner-view.service.ts:155-180` | No. |
| Institution, `institution-intelligence/learning.service.ts:38,85,168` | No. |
| Learner twin, `learner-twin/readers.ts` | No. Only transfer coverage filters by type. |

### 2.7 Internal assessment

Internal intents run as `family: 'LEARNING'` (`assessment-foundation/families.ts:11`). Each maps to a source type:

| Intent | Source type |
|---|---|
| DIAGNOSTIC | `DIAGNOSTIC` |
| MASTERY_CHECK, AD_HOC_CONCEPT_EXAM | `SOLO_VERIFICATION` |
| MIXED_CUMULATIVE | `CUMULATIVE_ASSESSMENT` |

These update mastery and Knowledge State under the Learning rules and may count as independent (`evidence-plan.ts:292`). This is **correct and is preserved**: an internal mastery check is how Learning validates mastery.

Internal-assessment evidence never feeds exam readiness *as exam evidence*. It does reach readiness snapshots as longitudinal Learning evidence, which is the G6 design.

## 3. Dependency graph (current)

```
                     exam attempt (PAA practice / diagnostic / mock)
                                     |
             +-----------------------+------------------------+
             | snapshot (canonical)                           | no snapshot (legacy)
   planEvidence: DIRECT + CANONICAL link             recordSimulationItemResponse:
   in a non-archived subject                         first MATCHED mapping (TRANSITIONAL ok)
             |   no owned concept -> UNRESOLVED (dropped)      |
             +-----------------------+------------------------+
                                     v
                    updateMastery (src/services/mastery.service.ts)
                                     |
          learning_evidence  <-- the SAME table Learning writes (LEARNING, INTERNAL)
                                     |
       +-------------+---------------+---------------+------------------+
       v             v               v               v                  v
 mastery_records  concept_memory   F5 analytics   concept_knowledge_state (no type filter)
       |                                              |
       +----------------------+-----------------------+
                              v
    Learning readers: dashboard, today, plan, missions, path, learner model, learning debt,
    Parent, Teacher, Institution, learner twin   (none filter exam evidence)
                              |
    Exam readers: readiness_snapshots / blueprint coverage / evidence gate
    (scoped per exam target by G6, but built ON the shared Knowledge State)

  Plan: student_plan_entries <- enrollCanonicalConcept (plan API, class, institution, teacher,
        acceptExamRecommendation[EXAM_GAP, explicit Student action]).  NOT written by evidence.
```

**Where `EXAM_ASSESSMENT` updates Learning mastery.** Both paths are live:

1. Canonical, and the path the PAA Preview uses: `evidence-plan.ts:398-421` → `updateMastery`.
2. Legacy: `scoring.service.ts:151-159` → `updateMastery`. These rows are counted as **independent**.

**Where absence from Learning blocks exam evidence.** `evidence-plan.ts:308` (`NO_CANONICALLY_LINKED_LEARNER_CONCEPT`) and `scoring.service.ts:139` (no MATCHED mapping). In both, the block is about concept ownership, **not** about plan membership.

## 4. Target model

```
                    CANONICAL KNOWLEDGE / CURRICULUM
                                  |
                      +-----------+-----------+
                   LEARNING                EXAM PREP
                      |                        |
       LEARNING + INTERNAL_ASSESSMENT     EXAM_ASSESSMENT evidence
       evidence (learner concept owned)   (exam target required; NO learner concept, NO plan)
                      |                        |
               KNOWLEDGE STATE           EXAM READINESS (own store)
                      \                        /
                       --- governed transfer rule (explicit, versioned, approved; registry EMPTY) ---
```

| Rule | Statement |
|---|---|
| R1 | Each evidence type changes only its own projections: LEARNING changes Knowledge State; INTERNAL_ASSESSMENT changes Knowledge State and the internal result stream; EXAM_ASSESSMENT changes Exam Readiness. |
| R2 | EXAM_ASSESSMENT requires an exam **target**: Student, exam preparation, attempt, system / version / profile, component / paper and bucket. It never requires a learner concept or Learning Plan membership. |
| R3 | EXAM_ASSESSMENT never creates learner concepts, plan entries, routes or recommendations, and never mutates Knowledge State. |
| R4 / R5 | Learning and internal assessment keep their existing rules and their existing precondition, an owned learner concept. |
| R6 | A cross-type effect, such as "a mock result informs Knowledge State", exists only as an explicit, versioned and approved **transfer rule**. The rule registry ships empty. Today's implicit transfer can become at most one such rule, and product decides whether it does. |

### 4.1 Exam Readiness as a queryable model (proposal)

**Table `exam_readiness_evidence`.** Append-only, one row per scored exam response × attributed concept or construct. Columns:

- Identity: `student_id`; `exam_target_id` (FK to `student_exam_profiles`).
- Exam context: `assessment_system`, `assessment_version`, `profile`, `component`, `paper`.
- Concept: `canonical_concept_id` (FK to the canonical catalogue, **not** to a learner concept); `construct_id`.
- Blueprint: `blueprint_id`, `blueprint_version`, `bucket_id`.
- Source: `exam_attempt_id`; `response_id` (FK to `exam_attempt_item_responses`, which closes the lineage gap "evidence has no FK to the response"); `approved_item_id`; `content_hash`.
- Outcome: `correct`, `fraction`, `assisted`, `independent`, `review_status`.
- Item and timing: `response_format`, `difficulty_index`, `difficulty_source`, `response_time_ms`.
- `mode`: SECTION_PRACTICE, DIAGNOSTIC, MOCK or CHALLENGE.
- `occurred_at`; `operation_key` UNIQUE.

**View or materialised projection `exam_readiness_state`.** Keyed by `(student, exam_target, system, version, profile, component, paper, concept, bucket)`. It holds the aggregates that `ExamReadinessCell` holds in the reference model:

- attempt and correct counts;
- independent and assisted correctness;
- recency (first and last);
- mean fraction, timing and difficulty;
- formats and attempts.

`readiness_score` stays NULL until a product rule defines it. Coverage confidence comes from the Readiness Engine over the blueprint (`EXAM_BANK_READINESS_ENGINE.md`), not from this table.

### 4.2 Off-plan exam evidence (target for PAA-FOLLOWUP-02)

The exam writer stops resolving a learner concept. Instead it writes `exam_readiness_evidence` keyed by the **canonical** concept and the exam target. As a result:

- Off-plan concepts get readiness.
- Nothing is added to `concepts`, `student_plan_entries` or `student_concept_sources`.
- `updateMastery` is not called.

This needs **no** new `student_concept_sources` type. An earlier note expected one; this design avoids it, because exam evidence never creates learner concepts.

## 5. Migration and remediation proposal (NOT executed while PAA is frozen)

| Step | Change | PAA impact |
|---|---|---|
| S1 | Migration: add `exam_readiness_evidence` and `exam_readiness_state`. Additive and empty. | None until a writer uses them. |
| S2 | Dual-write: exam writers also append to `exam_readiness_evidence`, keyed by canonical concept, including off-plan concepts. | **Changes PAA evidence behaviour; needs the freeze lifted.** |
| S3 | Readers: the readiness snapshot, blueprint coverage, exam prep and the result page read Exam Readiness instead of the shared Knowledge State. | Changes the PAA readiness UI; needs the freeze lifted. |
| S4 | Stop exam evidence from calling `updateMastery` on both paths, behind a flag. Product decides whether a governed transfer rule replaces it. | This is the **Math remediation**, the second half of PAA-FOLLOWUP-02. Needs the freeze lifted and a product decision. |
| S5 | Historical rows are kept. Existing `EXAM_SIMULATION` rows are classified with the `evidence-scope.ts` classifier and excluded from the Knowledge State recompute **only** under an approved rule. History is never deleted. | Student history is preserved. |
| S6 | Make `evidenceClass` a real column with a CHECK constraint, backfilled from the source type plus the G6 classifier. | Additive. |

If S4 is done without S3, exam prep loses the signal it reads today. **S3 must come before S4.**

## 6. Proof (reference model)

`tests/unit/exam-readiness-separation.test.ts` proves the following:

- A Student has Exam Readiness without plan membership or a learner concept.
- Exam evidence creates no learner concept, plan entry, route or recommendation, and leaves Knowledge State byte-identical.
- Learning evidence still mutates Knowledge State and never Exam Readiness.
- Internal assessment keeps its own stream and its Knowledge State effect, and never reaches Exam Readiness.
- Identity is captured at write time, not inferred.
- Assisted responses are kept separate from independent ones.
- Readiness is scoped to the exam target.
- A cross-type effect happens only through an approved transfer rule.
