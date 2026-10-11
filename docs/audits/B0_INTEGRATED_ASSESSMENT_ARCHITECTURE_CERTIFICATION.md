# B0 — Integrated Assessment Architecture

Date: 2026-10-10. Mode: read-only discovery. **This file is the only changed file in the repository.**

Evidence tags: **[V]** verified in code or schema, **[I]** inferred, **[U]** unknown. Paths are relative to the repo root. `M/` = `database/migrations/`, `EC/` = `src/lib/exam-core/`, `QB/` = `src/lib/exam-core/question-bank/`, `BASE` = `database/baseline/STUDYUS_BASELINE_2026_08.sql`.

Audit basis and limits:

- Audited line: worktree `studyos-t1-remediation`, branch `remediation/t1-account-profile`, HEAD `cc57dd6`. It is a superset of `integration/exam-platform-v2-e2e` (`2e68756`) plus T1 remediation; curriculum V2, QB V2, QB mock-readiness, QB factory, eligibility, exam entry UX, human-agency hotfix and Track A are ancestors. [V]
- Not in this line: `remediation/t1-final-delta` (`b8f21f4`, migration `20261107_1000`); two commits of `feat/exam-blueprint-bp4a` (the BP-4A hooks are present in code here); one docs commit on `track-b/exam-architecture-v2`. [V]
- Sections A–W were written before any database access; their [U] database figures are superseded by the read-only DEV pass in **section X (B0-C)**. Where A–W and X differ, X is authoritative.
- Flag presence per environment is resolved in X.8; the value of `CANONICAL_ENGINE_V1_ENABLED` on hosted environments is stored encrypted and was not read.
- No tests were run and no browser E2E was performed.
- "Q1" and "T2" have no code anchor in this line. Their definitions are frozen by product decision in X.1.

---

## 0. Executive Certification

```text
ARCHITECTURE_READY          (final, after B0-C; B1 entry: B1_GO_WITH_CONDITIONS)
```

B0-C (section X) closed the factual blockers, incorporated the frozen product decisions and froze target ownership for all eleven gate items. The text below is the original B0 finding (`ARCHITECTURE_READY_WITH_CONDITIONS`), kept for the record.

Why (original B0):

- Every authority in the hypothesised model has an identifiable owner in code, except the Assessment Blueprint Authority, which exists as two separate producers (learning `ActivityContract`, exam DB blueprint) and a shadow engine.
- The current runtime does **not** answer the B0 question unambiguously. It forks on a feature flag, on two exam start paths, on two question stores, on two concept identities, and on two disconnected decision worlds (learning and exam preparation).
- The target map (section C) is determinate and needs no new engine. What it needs is designation decisions, links and data. Those are listed as blockers before B1.
- If the blockers are not decided, the correct classification is `ARCHITECTURE_NOT_READY`.

Conditions (detail under "BLOCKERS BEFORE B1"):

1. Designate one learning decision authority and retire or fence the gate-blind launch paths.
2. Decide the fate of the legacy F9 simulation path, which bypasses the frozen-form mock gate.
3. Separate curriculum authorship from exam vertical configs.
4. Accept that Question ↔ Concept attribution does not exist and is a B1 deliverable.
5. Define Q1 and T2, and merge or drop the T1 final delta before B1 touches `student_exam_profiles`.

---

## A. Current-State Architecture

### A.1 Layers [V]

| Layer | Main tables | Main code |
|---|---|---|
| Catalog / curriculum | `academic_organizations`, `academic_programmes`, `academic_qualifications`, `academic_subjects`, `structure_versions`, `structure_nodes`, `learning_objectives`, `canonical_subjects`, `canonical_concepts`, `skills`, `competencies`, `contexts`, `objective_concept_mappings`, `canonical_concept_prerequisites` (`M/20260922_1000`, `M/20260924_1000`) | `src/lib/curriculum`, `src/lib/catalog`, `src/lib/learning-plan/curriculum.service.ts` |
| Learner content | `subjects`, `topics`, `subtopics`, `concepts`, `concept_relationships`, `concept_catalog_mapping` (BASE; `M/20260922_1000:125-140`) | `concept-extraction.service.ts`, `topic-hierarchy.service.ts`, `concept-graph.service.ts` |
| Learner state | `learning_evidence`, `mastery_records`, `concept_knowledge_state`, `concept_memory_state`, `concept_transfer_state`, `validation_cycles`, `learner_skill_state`, `learner_competency_state` | `mastery.service.ts`, `knowledge-state.service.ts`, projectors, `src/lib/learner-twin` |
| Learning decision | none persisted except `learning_plan` / `learning_plan_item` | `adaptive-learning-orchestrator.service.ts`, `src/lib/adaptive-learning-policy.ts`, `src/lib/pedagogical-engine`, `src/lib/pedagogical-decision` |
| Learning delivery | `quiz_sessions`, `canonical_prepared_activity`, `question_bank_candidates`, `question_bank_deliveries`, `quiz_responses` (`M/20261016_1000`, `M/20261015_1000`) | `activity-delivery.service.ts`, `quiz-generation.service.ts`, `gated-question-generation.service.ts`, `POST /api/quizzes/generate-and-take` |
| Exam core | `exam_definitions`, `exam_versions`, `assessment_components`, `assessment_blueprints`, `blueprint_objective_targets`, `exam_instances`, `simulation_attempts`, `exam_attempts`, `exam_attempt_item_responses`, `exam_attempt_results` (`M/20260925_1000`, `M/20261019_1000`, `M/20261020_1000`) | `EC/**`, `src/lib/simulation`, `src/lib/assessment` |
| Exam question bank | `question_bank_items`, `approved_items`, `question_bank_reviews`, `exam_item_usage`, health/demand tables (`M/20261026_1000`, `M/20261028_1000`) | `QB/**` |
| Student context | `student_academic_profile`, `student_academic_subjects`, `student_exam_profiles`, `readiness_snapshots`, `class_exam_assignments` | `academic-profile-catalogue.service.ts`, `src/lib/student`, `src/lib/exam-journey`, `EC/objectives` |
| Experience | none | `learning-os-snapshot.service.ts`, `src/lib/experience`, `src/lib/lx`, `learning-continuation.service.ts`, `src/app/dashboard/**` |

### A.2 Engines found beyond the brief (section 26)

| Engine | Why it matters | Authority class | Collision |
|---|---|---|---|
| Activity Delivery (`activity-delivery.service.ts`, `canonical_prepared_activity`) | Pre-builds per-learner activities against an `ActivityContract` | Learning-side assembler | It is the nearest existing thing to a "generated assessment" on the learning side |
| Learning Plan (`learning-orchestration.service.ts`, `learning_plan_item`) | 14-day schedule over the same decisions; `CANONICAL_PLAN_AUTHORITY` constant | Consumer of decisions | Its launch path is gate-blind (`learning-plan-revalidation.service.ts:69-97`) |
| F8 teaching / interventions (`src/lib/teaching`, `learner_gap_diagnoses`) | Post-exam diagnosis and teacher interventions | Separate diagnosis authority | Third meaning of "diagnostic" |
| F9 simulation (`src/lib/simulation`, `/api/simulation/attempts`) | Second exam start path | Legacy exam delivery | Bypasses frozen-form gates (section H) |
| QB factory / demand (`QB/factory.service.ts`, `demand.ts`) | Generates and plans bank inventory | Bank supply | Reads learner state for aggregate counts |
| Institution curriculum (`institution_curricula`, `class_plan_concepts`) | Class-scoped "what to learn" | Scoped curriculum overlay | Another source of curriculum |
| School assessments (`assessment_occurrences`, `assessment_schedule_rules`) | Only exam signal the learning ranker reads | Legacy island | Not linked to `student_exam_profiles` |

---

## B. Engine & Block Readiness Matrix

One primary classification each. All rows [V] unless tagged.

| # | Block | Status | Evidence / note |
|---|---|---|---|
| 1 | Curriculum/Catalog | PARTIAL | Schema complete (`M/20260924_1000`); content authored by exam configs |
| 2 | Structure Versions | NEEDS_DATA | Only versioned entity (`M/20260924_1000:70-84`); real curricula have zero nodes |
| 3 | Topic/Node hierarchy | DUPLICATED | `structure_nodes`, learner `topics/subtopics`, `assessment_structure_nodes`, TS catalogue |
| 4 | Learning Objectives | PARTIAL | Exist; minted by `EC/apply-vertical-config.service.ts:180-232`; no cross-version identity |
| 5 | Canonical Concepts | NEEDS_DATA | ~134 DEV_FIXTURE rows (`EC/catalog/dev-learning-catalog.ts:12-67`) |
| 6 | Concept relationships/prerequisites | NEEDS_DATA | Two unconnected graphs; both reported empty [U for DB] |
| 7 | Question Bank | DUPLICATED | Learning per-student store and exam bank share a name, no bridge |
| 8 | Question ↔ Concept mapping | MISSING | Learning: one `conceptId`; exam item: none |
| 9 | Question ↔ Learning Objective mapping | PARTIAL | Exam item: one NOT NULL objective; learning question: unpopulated (`quiz-generation.service.ts:118`) |
| 10 | Curriculum applicability | MISSING | Only `exam_version_id` on items |
| 11 | Provenance/licensing | PARTIAL | Three provenance vocabularies; licence on `assessment_sources`, not evaluated |
| 12 | Q1 readiness | PARTIAL | Per blueprint cell only (`QB/health.ts`, `demand.ts`, `mock-certification.ts`) |
| 13 | Exam Definitions | EXISTS | `M/20260925_1000:18-28` |
| 14 | Exam Versions | EXISTS | One PUBLISHED per definition |
| 15 | Official Blueprints | PARTIAL | Exist; reduced forms; no official scales |
| 16 | PAA | NEEDS_DATA | Structure encoded; fixture-only |
| 17 | PISA | NEEDS_DATA | Practice only by design |
| 18 | IB | NEEDS_DATA | 15 hand-written configs + structure-only |
| 19 | Cambridge | NEEDS_DATA | 0580 Extended only at IGCSE |
| 20 | ICE/AICE | NEEDS_DATA | Six subjects; thresholds table unused |
| 21 | ICFES/Saber | NEEDS_DATA | Math only in V2; highest fidelity |
| 22 | Student academic profile | EXISTS | Catalogue FKs (`M/20261030_1000`) |
| 23 | Student curriculum context | NEEDS_LINK | Learner `subjects` have no catalogue FK; four resolvers |
| 24 | Student preparation/exam target | EXISTS | `student_exam_profiles` |
| 25 | Exam readiness | DUPLICATED | `readiness_snapshots` vs legacy `exam-readiness.service.ts` on `mastery_records` |
| 26 | Learning Evidence | EXISTS | Single writer `mastery.service.ts:361` |
| 27 | Mastery | DUPLICATED | Legacy `mastery_records` still read by 37 files alongside Knowledge State |
| 28 | Knowledge State | EXISTS | `concept_knowledge_state`, sole projector |
| 29 | Digital Learning Twin | EXISTS | Read projection, no table |
| 30 | Adaptive Learning Orchestrator | EXISTS | Always-live concept ranking |
| 31 | Teaching Intent | EXISTS | `src/lib/adaptive-teaching-policy.ts:132` |
| 32 | Learning Orchestration | PARTIAL | Plan is canonical; launch path gate-blind |
| 33 | Retention | EXISTS | `concept_memory_state` + engine RETAIN |
| 34 | Transfer | PARTIAL | State exists; Knowledge State reads raw rows, not the projection |
| 35 | Verification | PARTIAL | Works; result is a dead end |
| 36 | Remediation | EXISTS | `remediation.service.ts`, with continuation |
| 37 | Quiz/question generation | EXISTS | Gated generation with verifier |
| 38 | Question-count authority | DUPLICATED | Engine policy vs route clamp + UI slider |
| 39 | Difficulty authority | DUPLICATED | Engine difficulty policy vs route fallback `?? 3` |
| 40 | Generated Assessment representation | PARTIAL | Exam: frozen `exam_instances.form`. Learning: `quiz_sessions.questions` jsonb |
| 41 | Attempts | EXISTS | Both sides |
| 42 | Scoring | PARTIAL | Works; no official scale, no learning-side marks model |
| 43 | Multi-concept evidence attribution | MISSING | Section L |
| 44 | Learning Continuation | PARTIAL | Concept-scoped only |
| 45 | Unified Activity Contract | PARTIAL | `NextChallengeView` + `ContinuationResolution` cover learning only |
| 46 | Next Action | DUPLICATED | At least nine producers (section N) |
| 47 | Learn/My Path UX | EXISTS | Snapshot-based |
| 48 | Exam Preparation UX | NEEDS_LINK | Separate stack; no shared decision |
| 49 | Official Mock UX | NEEDS_DATA | Routes exist; `COMPONENT_NOT_READY` without content |
| 50 | T1/T2 integration boundary | PARTIAL | T1 identified; T2 undefined |

---

## C. Architectural Authority Map

Corrected from the hypothesis in two ways: the Assessment Blueprint layer is drawn as two existing producers, and Exam Core's write into curriculum is shown as the collision it is.

```text
                         Student (students, users)
                               │
        ┌──────────────────────┴───────────────────────┐
        ▼                                              ▼
 Curriculum Context                           Preparation Context
 student_academic_profile                     student_exam_profiles
 student_academic_subjects                    (+ readiness_snapshots)
 learner subjects ·· name match ··┐                    │ objective_key (text, code-resolved)
        │                         ▼                    ▼
        ▼                 CURRICULUM AUTHORITY   OFFICIAL EXAM AUTHORITY
 learner concepts ──0..1──▶ structure_versions    exam_definitions → exam_versions
 (concept_catalog_mapping)  → nodes → objectives   → assessment_components
        │                  ⇄ canonical_concepts    → assessment_blueprints
        │                 (objective_concept_      → blueprint_objective_targets
        │                  mappings, N:M)                  │
        │                         ▲                        │
        │                         └── WRITES (collision) ──┘  apply-vertical-config
        ▼
 LEARNER STATE AUTHORITY                         QUESTION BANK AUTHORITY
 learning_evidence (updateMastery)               approved_items (exam, reviewed)
 → concept_knowledge_state                       question_bank_candidates (learning,
 → memory / transfer / skill state                 per student, AI) — no bridge
        │                                                  │
        ▼                                                  ▼
 ┌────────────── ASSESSMENT CONSTRUCTION (two producers today) ──────────────┐
 │ LEARNING: getLearningDecisions (which concept)                            │
 │           + canonical engine (which activity, ActivityContract) [flag]    │
 │           → activity-delivery / generation                                │
 │ EXAM:     nextStep / journey resolver or student choice                   │
 │           → formInputs + assembleForm (frozen form)                       │
 │           → F9 sourceExamItem (lazy, AI fallback) [legacy]                │
 │ SHADOW:   Blueprint Engine V2 (logs only)                                 │
 └───────────────────────────────────────────────────────────────────────────┘
        │                                                  │
        ▼                                                  ▼
 quiz_sessions                                   exam_instances / simulation_attempts
        │                                                  │
        └──────────── scoring ─▶ updateMastery ◀───────────┘  (exam rows carry examScope)
                               │
                               ▼
                  Knowledge State + canonical stage (exam rows do not move the stage)
                               │
        ┌──────────────────────┴───────────────────────┐
        ▼                                              ▼
 resolveContinuation (concept-scoped)        result page bridges + opt-in
 getLearningOSSnapshot → Today / Path        learning_recommendations
        (no shared next-action authority across the two)
```

---

## D. End-to-End Data Flow

### D.1 The B0 question, current state [V]

| Step | Learning | Exam |
|---|---|---|
| What assessment should occur | Concept: `getLearningDecisions` (`adaptive-learning-orchestrator.service.ts:595`). Activity: `getCanonicalPedagogicalDecision` (`src/lib/pedagogical-decision/canonical-decision.service.ts:80`) if flag on, else `selectActivityType` (`adaptive-learning-policy.ts:542`) | `nextStep` (`EC/objectives/preparation-plan.ts:279`), `resolveStudentExamJourney` (`src/lib/exam-journey/resolver.ts:155`), or student choice |
| Constraints | `ActivityContract` (`src/lib/pedagogical-engine/types.ts:269`, counts `policy.ts:32-68`); legacy: route clamp and UI slider | `blueprint_objective_targets` + slot constraints (`EC/slot-constraints.ts:27`) |
| Eligibility | Per-student pool (`question-bank.service.ts:92-97`); AI verifier | `lifecycleSqlFor` (`QB/lifecycle.ts:192-202`) |
| Selection | `activity-delivery.service` else generation | `formInputs` → `assembleForm` (`EC/exam-instance.service.ts:134`, `EC/form-assembly.ts:134`) |
| Attempt / scoring | `POST /api/quizzes/generate-and-take`, `gradeQuizAnswer` | `scoreResponseSet` (`EC/scoring/scoring-engine.ts:161`) |
| Evidence | `updateMastery` | `updateMastery` via `src/lib/simulation/scoring.service.ts:122-150` |
| Next action | `resolveContinuation` (`learning-continuation.service.ts:107`) | `determineNextAction` (`src/lib/simulation/next-action.service.ts:27`), result page bridges |

### D.2 Data flow matrix [V unless tagged]

| Entity | Source of truth | Writer | Readers | Cardinality | Versioning | Immutable history | Gap |
|---|---|---|---|---|---|---|---|
| Curriculum Version | `structure_versions` | `structure.service.ts`; `apply-vertical-config` | curriculum.service, exam core | N per academic subject, one PUBLISHED | status lifecycle | superseded rows kept | no lineage or clone; not pinned per student |
| Subject | `academic_subjects` (catalog); `subjects` (learner) | catalogue seeds; `/api/subjects/create` | everything | learner subject ↔ catalog: none | none | n/a | name-match bridge only |
| Topic/Node | `structure_nodes` | exam config apply | curriculum.service | N per version, tree | via version | via version | all nodes typed `EXAM_SECTION`; learner `topics` unrelated |
| Learning Objective | `learning_objectives` | exam config apply | blueprint targets, QB items, mappings | one node each | via version | no cross-version id | re-publish orphans mappings |
| Concept | `canonical_concepts`; learner `concepts` | dev catalogue seed; extraction / plan / exam bridge | all learner state (learner id) | learner 1 — 0..1 canonical | none | n/a | two identities, label match |
| Question | `approved_items`; `question_bank_candidates` | QB factory; activity candidate generation | form assembly; activity delivery | item → 1 objective; candidate → 1 concept | item versions | content immutable by trigger | no concept link, no bridge |
| Exam Definition | `exam_definitions` | vertical config apply | exam core, profiles | 1 per `config_key` | via versions | yes | family taxonomy app-enforced |
| Exam Version | `exam_versions` | vertical config apply | all exam flows | N per definition | one PUBLISHED | yes | none |
| Blueprint | `assessment_blueprints` + targets | vertical config apply | form assembly, health | 1:1 with version | via version | yes | V2 shadow only |
| Student Exam Target | `student_exam_profiles` | `createObjectivePreparation` | journey, readiness, plan | N per student, one active per objective | archive chain | yes | no subject FK, session ×3 |
| Generated Assessment | `exam_instances.form`; `quiz_sessions.questions` | `freezeForm`; generate-and-take | attempt runners | 1 per instance / session | n/a | mock form frozen | learning side has no policy/rationale snapshot |
| Attempt | `simulation_attempts` + `exam_attempts`; `quiz_sessions` | attempt services | results, scoring | 1:1 sim ↔ exam attempt | `frozen_configuration` | yes | none |
| Answer | `exam_attempt_item_responses`; `quiz_responses` | runners | scoring | per position / question | `item_snapshot` | yes | none |
| Score | `exam_attempt_results`; `quiz_response_grades` | scoring engine; grader | results, readiness | 1 per attempt | policy hash | yes | no official scale |
| Learning Evidence | `learning_evidence` | `updateMastery` only | all projectors | one row per (operation, concept) | `operation_key` | append-only | type split across three vocabularies |
| Mastery | `mastery_records` (legacy) | `updateMastery` | planning, readiness, debt | 1 per student+concept | none | `mastery_events` | competes with Knowledge State |
| Knowledge State | `concept_knowledge_state` | `recalculateConceptKnowledgeState` | 26 files | 1 per student+concept | full replay | recomputed | reads all evidence unscoped |
| Retention State | `concept_memory_state` | `projectConceptMemoryState` | KS, twin | 1 per pair | replay | recomputed | stale "shadow" header comment |
| Transfer State | `concept_transfer_state` | `projectConceptTransferState` | transfer-read | 1 per pair | replay | recomputed | KS bypasses it |
| Learning Decision | not persisted | `getLearningDecisions`; canonical engine | snapshot, continuation, plan | per request | policy constants | no | two layers, flag fork |
| Next Action | not persisted | nine producers | pages | per request | n/a | no | no single authority |

---

## E. Curriculum Integration

```text
CAPABILITY: Structure Version ↔ Node ↔ Objective ↔ Canonical Concept
STATUS: PARTIAL (schema EXISTS, data and authorship wrong)
AUTHORITATIVE: structure_versions, structure_nodes, learning_objectives,
  objective_concept_mappings, canonical_concepts; src/lib/learning-plan/curriculum.service.ts
CURRENT FLOW: version 1—N node 1—N objective N—M canonical concept
EVIDENCE [V]:
- M/20260924_1000:70-84 (one PUBLISHED per subject), :91-113 (nodes), :130-138 (objectives)
- M/20260924_1000:147-178 objective_concept_mappings, relation_type FULL/PARTIAL/PREREQUISITE/SUPPORTING
- M/20260922_1000:37-47 canonical_concepts FK only to canonical_subject
- curriculum.service.ts:159-170 reads PUBLISHED mappings, FULL/PARTIAL
GAP: rows are written by EC/apply-vertical-config.service.ts:178-234 with node_type EXAM_SECTION;
  no unit/topic tree for any curriculum; no cross-version identity; no crosswalk table
RISK: publishing a new version orphans mappings, institution objectives and blueprint targets
TARGET ROLE: sole owner of "what should be learned and how it is organised per version"
DEPENDENCIES: canonical catalogue content; editorial mapping workflow
MUST NOT OWN: mastery, evidence, item counts (currently clean: src/lib/curriculum, src/lib/catalog)
```

- The brief's principle holds on the catalog side: a canonical concept is not owned by a topic. [V]
- It does not hold on the learner side: `concepts.subject_id NOT NULL`, single `subtopic_id` (BASE:302-308). [V]
- Learner → canonical is `concept_catalog_mapping`, `learner_concept_id UNIQUE`, matched by exact label within a same-named subject (`src/lib/catalog/mapping.service.ts:66`). Unmatched concepts have no curriculum linkage. [V]
- Competing "what to learn" sources: `curriculum.service.ts` (de facto), `curriculum-eligibility-read.service.ts:44-68` (legacy topic order), alphabetical fallback (`curriculum.service.ts:173-181`), `institution_curriculum_*` and `class_plan_concepts`, hardcoded `src/lib/experience/subject-catalog.ts` and `src/lib/academic-options.ts`, `assessment_structure_nodes`. [V]
- Leaks into learner state: concept creation zero-initialises `mastery_records` (`concept-extraction.service.ts:240-254`, `personal-plan.service.ts:165-168`); the exam bridge creates a learner concept without one (`EC/catalog/learning-links.service.ts:174-176`). [V]

---

## F. Question Bank Integration

```text
CAPABILITY: Question Bank Authority
STATUS: DUPLICATED
AUTHORITATIVE: question_bank_items → approved_items (exam); question_bank_candidates (learning)
CURRENT FLOW: factory → validation → PILOT → human review → CALIBRATED/ACTIVE → assembleForm
EVIDENCE [V]:
- M/20261026_1000:126-199, :280-335 (immutability, transition table, pilot-before-active)
- M/20261028_1000:75-96 quality guard requires APPROVED review for generated ACTIVE
- QB/lifecycle.ts:141-149 DEFAULT_ELIGIBILITY; :192-202 lifecycleSqlFor
- question-bank.service.ts:92-97 learning pool filtered by student_id
GAP: no item→concept link; no curriculum/syllabus applicability; marks, command term,
  cognitive demand in free-text JSONB (EC/items.ts:115-176); no estimated time;
  licence not on item and not evaluated; three provenance vocabularies
RISK: NULL usage_eligibility/bank_lifecycle_status treated as ACTIVE; only the audience
  filter keeps fixtures from students
TARGET ROLE: what items exist, what they measure, where they may be used
MUST NOT OWN: per-learner dosage (true today; DemandPolicy holds population constants,
  QB/demand.ts:39-48)
```

- Eligibility inputs today: lifecycle state, `usage_eligibility`, `exam_alignment`, non-fixture, current PUBLISHED version. Exposure is a soft cost, not an exclusion (`EC/form-assembly.ts:170-178`). [V]
- Bridges between the stores: exam → learning generator fallback only (`EC/item-sourcing.service.ts:101-200`). Learning candidates are never promoted; exam items never feed learning practice. [V]
- Content: every vertical config is `DEV_CERT_FIXTURE` (`EC/verticals/v2/builders.ts:40`); fixtures are excluded for students (`EC/audience.ts:66-75`). [V] Repo docs dated 2026-10-05 report 0 human-approved generated items and 0 certified mocks. [U for DB]

---

## G. Learner State Integration

```text
CAPABILITY: Learner State Authority
STATUS: EXISTS (with DUPLICATED mastery)
AUTHORITATIVE: learning_evidence; updateMastery() src/services/mastery.service.ts:361;
  concept_knowledge_state; projectors
CURRENT FLOW: any scored activity → updateMastery (one transaction) → evidence insert →
  mastery_records → memory/transfer/skill projectors → knowledge state → COMMIT
EVIDENCE [V]:
- only INSERT INTO learning_evidence in src/ is mastery.service.ts:399
- idempotency: M/20260901_1200:59-61 partial unique index on operation_key
- knowledge-state.service.ts:384 full replay; called only from mastery.service.ts:748 and backfill
GAP: state keyed on learner concepts.id; no state at objective, topic or section level;
  skill/competency state fills only from tagged metadata
RISK: legacy mastery_records still drives exam-readiness.service.ts:45, study-plan.service.ts:469,
  learning debt
TARGET ROLE: what the learner knows and what evidence exists
MUST NOT OWN: exam structure (true today)
```

- "What evidence is still needed": `evaluateCanonicalLearningState` requirements (`src/lib/pedagogical-engine/engine.ts:574`, thresholds `policy.ts:17-56`) and, in parallel, Knowledge State `validation_readiness` (`knowledge-state.service.ts:213`). Per-activity count: `deriveEvidenceRequirement` (`src/lib/lx/evidence-sufficiency-contract.ts:188`). [V]
- Evidence type is spread across `source_type` (12 values), `ActivityType`/`EvidenceMode` in metadata, and `EvidencePurpose`. [V]
- Exam evidence: written to the shared ledger with `metadata.examScope`; isolation is a read-side filter (`EC/evidence-scope.ts:35-115`). It moves Knowledge State. It does not move the canonical stage, because the adapter maps exam and diagnostic types to `UNSUPPORTED` (`src/lib/pedagogical-shadow/evidence-adapter.ts:104-116`). [V]
- `POST /api/learning/record-evidence` takes `sourceType` as `z.string().min(1)` and casts it (`route.ts:42,121`), with student and concept ownership checks and a required idempotency key. No caller outside API routes. [V]

---

## H. Exam Architecture

```text
CAPABILITY: Official Exam Authority
STATUS: EXISTS (data NEEDS_DATA)
AUTHORITATIVE: exam_definitions → exam_versions → assessment_components →
  assessment_blueprints → blueprint_objective_targets → approved_items →
  exam_instances → simulation_attempts/exam_attempts → responses → exam_attempt_results
CURRENT FLOW: TS vertical config → applyVerticalConfig (operator) → DB rows → formInputs →
  assembleForm → freezeForm → attempt → scoreResponseSet → result
EVIDENCE [V]:
- EC/vertical-config.ts:1-6 verticals are config only
- M/20261020_1000:128-157 exam_instances, CHECK exam_instances_mock_frozen
- EC/exam-instance.service.ts:244-248 refuses incomplete mock (FORM_INCOMPLETE)
- EC/scoring/scoring-engine.ts:161 policy as data; missing policy → NO_SCORING_POLICY
GAP: no official scale (score_conversion_models empty; cambridge_grade_thresholds unread)
RISK: F9 path below
MUST NOT OWN: curriculum taxonomy (violated), learner state (respected)
```

- **Blueprint Engine V2** is shadow-only. `EXAM_BLUEPRINT_V2` is OFF or SHADOW with no ON value (`EC/blueprint-v2/flag.ts:6-12`); hooks log and return void (`runtime-hook.ts:147`). [V]
- **F9 path.** `POST /api/simulation/attempts` accepts `FULL_MOCK` with `OFFICIAL_SIMULATION_TIMED` after `getFullMockEligibility` only (`src/app/api/simulation/attempts/route.ts:22-86`, `src/lib/simulation/eligibility.service.ts:24-27`). Items come from `sourceExamItem`, which falls back to `generatePracticeQuestions` keyed to the student's own concept (`EC/item-sourcing.service.ts:101-200`). An official-format mock on this path can contain unreviewed AI items and vary with learner state. Called from `StartSimulationPanel.tsx:122`. [V]
- No code was found that alters an instance MOCK by weakness or mastery. [V]

### Vertical status [V for repo; content beyond fixtures U]

| Vertical | 1 Architecture | 2 Official structure | 3 Blueprint | 4 Fidelity | 5 Usable content | 6 Sufficient content | 7 Learner journey |
|---|---|---|---|---|---|---|---|
| PAA | YES | YES (`v2/paa.ts:6-10`) | YES | PARTIAL: "36 of 175", no scale | FIXTURE-ONLY | NO | PARTIAL |
| PISA | YES | PARTIAL | YES | PARTIAL | FIXTURE-ONLY | NO (mocks blocked, `taxonomy.ts:39`) | PARTIAL, practice only |
| IB | YES | YES for hand-written subjects | YES | PARTIAL | FIXTURE-ONLY | NO | PARTIAL |
| Cambridge IGCSE | YES | PARTIAL (0580 Extended) | YES | PARTIAL | FIXTURE-ONLY | NO | PARTIAL |
| Cambridge AS/A + AICE | YES | YES (six subjects) | YES | PARTIAL | FIXTURE-ONLY | NO | PARTIAL |
| ICFES/Saber 11 | YES | PARTIAL (Math) | YES | Highest: 50 slots (`v2/saber11-math.ts`) | FIXTURE-ONLY + 8 PILOT (doc) | NO | PARTIAL |

Journey is PARTIAL because instance creation returns `COMPONENT_NOT_READY` without eligible content (`src/app/api/exams/instances/route.ts:63-66`).

---

## I. Student Preparation Context

| Question | Where it lives | Kind |
|---|---|---|
| Curriculum studied | `student_academic_profile.academic_programme_id`, `academic_qualification_id`, `grade_level` (`M/20261030_1000:32-37`); legacy `curriculum_type`, `ib_programme` | FK + legacy text |
| Subject / level | `student_academic_subjects.academic_subject_id`; learner `subjects.name`, `ib_level` | FK; free text |
| Exam prepared | `student_exam_profiles.exam_definition_id`, `objective_key` (`M/20261025_1000:39-59`) | FK nullable + text key |
| Exam version | `student_exam_profiles.exam_version_id` | FK nullable, else latest PUBLISHED at read |
| Exam date | `exam_date`, `authoritative_exam_date`, `personal_target_date`, `estimated_exam_month` (`M/20261103_1000:41-62`) | typed |
| Session | profile `exam_series`/`exam_year`; target `official_session_key`; final delta `target_exam_series` | three representations |
| Target grade | `preparation_goals` (`M/20260925_1000:213-221`) | table with no caller |
| Preparation state | `readiness_snapshots`; journey state computed, never stored | snapshot + computed |

- Verdict: **do not add a `PreparationProfile`.** `student_exam_profiles` is the per-target record. [V]
- Missing: subject FK and structured level on the target; pinned structure version; FK for `objective_key`; a writer for target grade; one session rule; catalogue FK on learner `subjects`. [V]
- Resolvers: `loadResolvedStudentContext` (`src/lib/student/student-context.server.ts:30-53`), eligibility academic context (`EC/eligibility/academic-context.ts`), `resolveCurriculumContext` (`curriculum.service.ts:111-146`), journey facts (`src/lib/exam-journey/facts.server.ts:212-231`). `student-context.service.ts` only gets and sets the context type. [V]

---

## J. Blueprint Architecture

The three-family model fits what exists, as policy families over shared infrastructure, not three engines.

| Family | Exists today as | Policy owner today | Fit |
|---|---|---|---|
| LEARNING | `ActivityContract` from the canonical engine; `deriveEvidenceRequirement`; `activity-delivery` assembly | `src/lib/pedagogical-engine/policy.ts`, `difficulty-policy.ts` | Concept Practice, Prove, Retention, Transfer exist. Topic Practice, Custom Concept Practice, Mixed Cumulative have no engine policy (cumulative is a legacy quiz mode). Diagnostic is not modelled by the engine |
| EXAM_PREPARATION | Read-only plan (`EC/objectives/preparation-plan.ts`), PRACTICE instances narrowed by `focusObjectiveIds`, difficulty from last exam result | Exam Core | Section practice exists. Weakness-targeted drill exists only as a recommendation. No policy combines exam relevance with learner state to assemble |
| OFFICIAL_EXAM | DB blueprint + frozen form | Vertical config | Fits as is |

- Question count (brief section 8): learning canonical path → engine (`policy.ts:32-68`: practice 2–3, prove 10, retain 10, transfer 3), server re-verified (`generate-and-take/route.ts:454-456, 736-739`). Learning legacy path → route clamp (`route.ts:559-564`) and UI slider (`src/app/dashboard/quiz/page.tsx:1674-1684`). Official → blueprint targets (`EC/exam-instance.service.ts:141-149`). No `concepts × n` formula exists. [V]
- Counts today are fixed per activity type, not derived from multi-concept overlap, available time or available items. [V]

---

## K. Shared Selection / Solver Architecture

What already exists per generic constraint:

| Constraint | Exam side | Learning side |
|---|---|---|
| Eligible objectives | hard filter in `assembleForm` (`form-assembly.ts:150-158`) | single concept per question |
| Exam applicability | `exam_version_id` | n/a |
| Curriculum applicability | none | `AcademicContext` fingerprint (`src/lib/activity-delivery/contract.ts:60-72`) |
| Provenance / licensing | fixture exclusion; licence not checked | n/a |
| Evidence coverage / independence | none | engine requirements |
| Multi-concept coverage | none | none |
| Difficulty mix | range filter + distance cost | engine difficulty policy |
| Command term, type, marks | slot constraints on JSONB tags | contract question shape |
| Duration | per component, derived per item | none |
| No-repeat / exposure | `exam_item_usage`, soft cost | novelty and exact-duplicate checks (`src/lib/lx/exact-duplicate-novelty.ts`, `question-diversity.ts`) |
| Diversity | template fingerprint uniqueness, stimulus continuity | `TEMPLATE_CAP` |
| Official section distribution | blueprint targets | n/a |

- A shared solver is justified: `assembleForm` is already a pure function over positions, candidates and costs, and Blueprint V2 has a compiler and resolver in shadow. [V]
- It cannot be shared yet, because the two sides select from different stores keyed on different things (objective vs learner concept). [V]
- Must remain policy-specific: count and evidence requirements (learning), fidelity and freezing (official), the weakness/relevance trade-off (preparation).
- Coupling to remove first: `QB/health.ts:239-256` calls `assembleForm` to prove readiness; `EC/exam-instance.service.ts:203,216` imports demand-policy constants. [V]

---

## L. Multi-Concept & Evidence Attribution Readiness

```text
CAPABILITY: Question → C1 PRIMARY, C2 SUPPORTING
STATUS: MISSING
EVIDENCE [V]:
- GeneratedQuestion.conceptId: string (quiz-generation.service.ts:175-177)
- submit buckets by question.conceptId, one evidence row per concept
  (generate-and-take/route.ts:1627, 1701)
- exam item: loop breaks on first resolved student concept (simulation/scoring.service.ts:125-129)
- learning_evidence keyed (student_id, concept_id) (BASE:391)
- operation_key = operationType::operationId::conceptId, so several rows per operation
  are already legal
- only fan-out today: real school exam applies one percentage to every attributed concept
  with confidenceWeight from assessment_concept_coverage (exam-result.service.ts:242-268)
GAP: no role, weight or marks share on any question; no attribution policy
WHERE POLICY BELONGS: Learner State Authority at write time (inside the updateMastery
  caller contract), fed by question metadata owned by the Question Bank
HISTORICAL COMPATIBILITY: existing rows are single-concept, full weight; a new attribution
  must treat absence of role as PRIMARY with weight 1 and must not rewrite rows.
  confidenceWeight already exists on the evidence input as the carrying field.
```

---

## M. Unified Experience Architecture

### M.1 Experience consistency matrix [V]

| Journey | Entry | Current context | Assessment authority | Results | State update | Next action | Continuation gap |
|---|---|---|---|---|---|---|---|
| Today | `/dashboard/today` | `getLearningOSSnapshot` | legacy ranking + canonical action | n/a | n/a | `NextChallengeView` | page slices plan to 4 and runs its own SQL (`today/page.tsx:169-222`); exam is a goal chip only |
| My Path | `/dashboard/path` | snapshot, `path-view.ts` | same | n/a | n/a | per-subject view | silent legacy fallback (`path-view.ts:266-285`) |
| Concept Detail | concept mission | `concept-mission-view.service.ts` | canonical, explicit error on failure | n/a | n/a | mission CTA | none found |
| Concept Practice | `/dashboard/quiz?mode=topic_practice` | concept, subject | engine or legacy | `canonicalResults` for v1 attempts | `updateMastery` | `ContinuationPanel` | legacy attempts get score-tier message only |
| Topic Practice | none | — | — | — | — | — | does not exist |
| Prove | `mode=canonical_prove` | concept | engine (exact 10) | milestone | yes | panel | none found |
| Retention | `mode=canonical_retain` | concept | engine | milestone | yes | panel; WAITING renders in place | no cross-concept hand-off |
| Transfer | `mode=canonical_transfer`; legacy `/dashboard/cognitive/transfer` | concept | engine; legacy route | yes | yes | panel | two entry points |
| Verification | quiz resume | attempt | existing attempt | yes | yes | "back to subject" only (`quiz/page.tsx:1528,1540`) | dead end |
| Remediation | `/dashboard/remediation/[pathId]` | path | `remediation.service.ts` | step result | yes | panel | success threshold in route (`route.ts:2339`) |
| Diagnostic check | `mode=diagnostic_check` | diagnosis | legacy policy | yes | yes | panel suppressed (`quiz/page.tsx:1842,2027`) | dead end; no caller creates diagnoses |
| Personalized Exam Preparation | `/dashboard/exam-prep/[examProfileId]` | `student_exam_profiles`, preparation plan | `nextStep` | plan | n/a | exam-side next step | not from learning authority |
| Official Mock | `/dashboard/exam-prep/attempt/[id]` | instance | blueprint | result page | `updateMastery` + result + snapshot | bridges, page-picked `firstGapConcept` (`result/page.tsx:53-55`) | page decides the concept |
| Results | per activity | — | — | — | — | — | no shared results contract across quiz and exam |
| Progress | home dashboard | `progress-overview.service.ts` | canonical with silent fallback | n/a | n/a | n/a | composed outside the snapshot |

### M.2 UI and route decisions that belong to engines [V]

1. Question-count slider on legacy modes (`quiz/page.tsx:1674-1684`) and `MODE_DEFAULT_MAX` (`:205-225`).
2. Exam result page picks `firstGapConcept` (`result/page.tsx:53-55`).
3. Remediation success `score >= 70` (`generate-and-take/route.ts:2339`); explain `>= 60` (`cognitive/explain/submit/route.ts:176`).
4. Message tiers 80/50 and per-concept 70/50 in the route (`route.ts:2566`, `:1924`).
5. Legacy count clamp and difficulty `?? 3` (`route.ts:559-564`, `:806`).
6. Zero-gap gate duplicated in `learning-os-snapshot.service.ts:163-187` and `learning-continuation.service.ts:162-188`.
7. Tutor cutoffs 50/80/85 (`tutor-strategy.service.ts:55-64`).

React pages are otherwise free of numeric cutoffs. [V]

### M.3 Unified contract hypothesis (brief section 11)

Equivalent structures that already exist: `NextChallengeView` (`src/lib/experience/next-challenge.ts:40`), `ContinuationResolution` and `LearningOrigin` (`src/lib/lx/continuation.ts:41-53`), `ActivityContract`, `TeachingIntent`, `CanonicalPedagogicalDecision`, `LearnerJourneyResult`. [V]

| Proposed field | Already available from | Missing |
|---|---|---|
| learnerIntent, explanation | `LearningDecision.facts`, `NextChallengeView.facts` | exam-side equivalent |
| context.subject, concepts | `NextChallengeView`, `LearningOrigin` | curriculum, topic, examTarget |
| activityType | `ActivityType` | exam instance modes are a separate vocabulary |
| estimate.questions | `itemCount` | marks, duration |
| launchTarget | continuation launch target | exam launch |
| completion, nextAction | `ContinuationResolution` | cross-concept and cross-world next action |

Conclusion: a new `LearningActivity` type would duplicate `NextChallengeView` + `ContinuationResolution`. Extend those to carry exam context and a cross-concept next action. [I]

### M.4 Target flow (engines invisible)

```text
Today / My Path / Exam Preparation / Progress
   └─ all read one experience read model (today: getLearningOSSnapshot)
        └─ which renders one activity card (today: NextChallengeView)
             WHY (facts) → WHAT (activity) → START (launch target)
                → ACTIVITY (quiz shell or exam shell)
                → RESULT + WHAT CHANGED (today: canonicalResults / result-milestone)
                → NEXT ACTION (today: resolveContinuation, extended across concepts and exam)
```

---

## N. Learning Continuation & Next Action

Producers of "what next" [V]:

| Producer | Status |
|---|---|
| `getLearningDecisions` | live, concept ranking and reasons |
| `getCanonicalPedagogicalDecision` | live behind flag, per-concept activity |
| `resolveContinuation` | live, post-activity, concept-scoped |
| `getLearningOSSnapshot` + `presentNextChallenge` | composer |
| `rebuildLearningPlan` / `revalidateLearningPlanItem` | live plan; launch is gate-blind |
| `getStudentRecommendations` (`src/lib/learning-plan/recommendations.service.ts:48`) | live, separate enrolment recommender |
| `nextStep`, `resolveStudentExamJourney`, `determineNextAction` | live, exam side |
| `getNextBestActionV3`, `getDailyLearningPlan` | duplicate, no UI caller, ignore the gate |
| `getTodayPlan`, `getBestLearningDecision`, `generateStudyPlan` | dead or legacy |

Gaps:

- Continuation never crosses concepts: CONSOLIDATED / LOCKED / BLOCKED / NOT_READY → `RETURN_TO_MISSION` (`learning-continuation.service.ts:304-309`). [V]
- The reason and the action come from different engines; `factsCompatibleWithAuthority` (`next-challenge.ts:98`) filters disagreements. [V]
- `getLearningDecisions` reads none of `learning_recommendations`, `exam_gap_concept_links`, `exam_attempt_results`, `student_exam_profiles`. Its only exam signal comes from `assessment_schedule_rules`. An exam gap does not change Today. [V]
- Readiness snapshots refresh only on simulation completion or `POST /api/readiness/compute`, not on learning activity. [V]

Target boundary: one next-action authority = concept ranking + per-concept canonical decision + exam-target inputs; `resolveContinuation` becomes its post-activity face. No new engine. [I]

---

## O. Q1 Integration

- Q1 should be a read model over three authorities: curriculum scope (objectives and concepts in a version), bank inventory (eligible items and their coverage keys), and blueprint requirements. It must not call the selector.
- Today it measures only per blueprint cell (`QB/cells.ts:69-73`), with health, demand and the certification ladder. [V]

| Q1 measure | Supportable today | Needs |
|---|---|---|
| Official-exam content readiness | YES (health, certification) | real content |
| Difficulty diversity | PARTIAL (per cell band) | — |
| Question diversity | PARTIAL (template fingerprints) | type-level metric |
| Concept coverage | NO | item → concept key |
| Topic coverage | NO | real curriculum nodes + item → node path |
| Practice / balanced / deep practice readiness | NO | learning policy requirements expressed as data; item → concept key |
| Diagnostic readiness | NO | diagnostic as a distinct profile (today a usage tag under the PRACTICE rule, `QB/lifecycle.ts:133`) |
| Multi-concept dependency | NO | attribution (section L) |

- The learning-side store has no readiness measure. [V]
- Boundary to fix: health calls `assembleForm`. Q1 should consume a feasibility result from the selection layer, not invoke it. [V]

---

## P. T1/T2 & Parallel Track Synchronization

T1 contracts to preserve [V]:

- Unauthenticated redirect to `/sign-in?redirect_url=` (`src/proxy.ts:30-32`).
- `students.student_context_type`, `GET/POST /api/student/context`, `effectiveContextType` order (`src/lib/student/student-context.ts:32-37`).
- `POST /api/academic-profile` `timeContext`, error `TIME_CONTEXT_INVALID` (`route.ts:20-24, 82-84`), shape CHECK (`M/20261106_1000:52-56`).
- Canonical series MAY/NOVEMBER (IB), MARCH/JUNE/NOVEMBER (Cambridge), March fail-closed, `PROGRAMME_SESSIONS_VERSION` (`EC/catalog/programme-sessions.ts:44-168`).
- `loadResolvedStudentContext` never reads class tables.
- `VALID_EXAM_TARGET_PREDICATE` (`src/lib/student/onboarding-gate.ts:62`).
- Tests: `tests/unit/t1-remediation.test.ts`; migration-chain assertion in `tests/unit/exam-platform-v2-integration-matrix.test.ts` (breaks on any new migration).

T1 assumptions: programmes matched to sessions by exact catalogue name string (`src/lib/student/time-context.ts:39`); exam prep reuses the objective-first catalogue; a valid exam target alone means READY. [V]

Final delta `b8f21f4` (not on this branch): migration `20261107_1000`, new `PATCH /api/exam-preparation/[id]` fields, `subject-curriculum-topics.ts` reading the catalog chain. Its report says DEV only and "T1 is not DONE". [V]

T2: not found; only "T2 was not started". [V]

Shared regression boundary: `student_exam_profiles`, `EC/objectives/*`, `programme-sessions.ts`, `onboarding-gate.ts`, `curriculum.service.ts`, `src/app/dashboard/exam-prep/**`, `learn/page.tsx`.

---

## Q. Collision Matrix

"A1" = the architecture work that follows B0.

| Track | Owns (source of truth) | A1 consumes | A1 produces | Allowed direction | Must not duplicate / prohibited | Regression risk | Parallel-safe? |
|---|---|---|---|---|---|---|---|
| Q1 | readiness read models | health, demand, certification | coverage keys Q1 can read | Q1 → A1 contracts | Q1 selecting items; A1 computing readiness | health ↔ assembleForm coupling | Yes for content production and per-cell readiness; wait for concept/topic coverage |
| Learning/LX | evidence, state, canonical engine | decisions, `ActivityContract` | context and attribution inputs | A1 → engine inputs | a second decision engine | flag fork; gate-blind paths | Yes for fixes; wait for count/difficulty or continuation redesign |
| Curriculum | versions, nodes, objectives, concepts, mappings | scope | nothing | all → curriculum | exam configs writing curriculum | re-publish orphans mappings | Yes for content import; wait for identity changes |
| Question Bank | items, lifecycle, eligibility | eligibility, metadata | applicability and attribution requirements | selection → bank | bank deciding dosage | NULL-as-ACTIVE legacy rows | Yes for review and content; wait for item schema changes |
| Exam Core | definitions, versions, instances, attempts, scoring | all | nothing | A1 → exam core | A1 owning exam structure | F9 path | Yes for fixes and scales |
| Official Blueprint | DB blueprint | targets, constraints | adapter only | solver → blueprint | adapting official structure to weakness | V2 cutover | Yes in shadow; wait for cutover |
| Student Exam Journey | computed journey state | target, schedule | shared next action | journey → next-action authority | a second next-step engine | `STUDENT_JOURNEY_V2` | Yes behind flag |
| PAA / IB / Cambridge / ICFES | vertical configs | config | nothing | config → exam core | vertical-specific engines or tables | fixture-only content | Yes for content and fidelity |
| T1/T2 | account, profile, context, sessions | context resolvers | nothing new on those tables | T1 → profile tables | A1 redefining context or session rules | `student_exam_profiles`, migration-chain test | T1 yes; T2 unknown |
| Experience Layer | snapshot, next-challenge, continuation | decisions | exam context in the same view | UI → experience → engines | pedagogy in pages | dead ends, silent fallbacks | Yes for presentation; wait for new decision surfaces |

---

## R. Backward Compatibility

| Asset | Constraint for any target change |
|---|---|
| Exam Question Bank, historical items | `approved_items` content is immutable by trigger; add metadata as new nullable fields or side tables; never rewrite versions |
| Learning question store | per-student and single-concept; treat missing role as PRIMARY weight 1 |
| Quiz sessions | `quiz_sessions.questions` jsonb and v1 stamping must keep validating; legacy sessions have no contract marker |
| Exam attempts | `frozen_configuration`, `item_snapshot`, policy hash are the record; never recompute |
| Official blueprints, Exam Core, verticals | DB blueprint stays runtime authority until V2 has an explicit cutover; vertical configs stay config only |
| Learning Evidence | append-only; `operation_key` format fixed; rows with NULL key exist; `metadata.examScope` and `activity_type` NULL/'EXAM_SIMULATION' drive G6 classification |
| Mastery / Knowledge State | Knowledge State is a full replay, so attribution changes alter recomputed state for history; any change needs a replay comparison first |
| Twin, Retention, Transfer | projections; safe if evidence semantics hold |
| Verification, Learn, Today | depend on snapshot and continuation shapes; `CONTINUATION_CONTRACT_VERSION = 1` |
| Q1 | cell key is a derived string, not an FK; changing cell derivation invalidates snapshots |
| T1/T2 | contracts in section P; migration-chain test |

---

## S. Validation & Test Architecture

Existing: 481 unit test files under `tests/unit` (vitest). No E2E suite in `tests/`; HTTP E2E and cert runners live in `scripts/`. `db:migration-test` and `db:repro-test` scripts exist. [V] None were run in B0.

| Area | Existing suites (examples) |
|---|---|
| Curriculum | `f4-*`, `f6-*` |
| Question Bank | `qb-*`, `question-*` |
| Mastery / Knowledge State / learner model | `learner-*`, `canonical-learner-model-boundary`, `lx3r-canonical-state-boundary`, `f5-*` |
| Learning decisions / canonical engine | `canon-*` (37), `adaptive-*`, `learning-*` (23) |
| Retention / transfer | `memory-*`, `transfer-*` (14) |
| Exam Core / blueprints / attempts / scoring | `exam-*`, `f7-*`, `blueprint-*` (9), `track-*` |
| Authority boundaries | `audit-canon-v2-feature-gate-and-ui-authority`, `audit-canon-v2-ui-authority-closure`, `cv2-08-continuation-authority`, `lx7r1-subject-action-authority`, `activity-delivery-architecture` |
| Journey | `journey-*` |
| T1 | `t1-remediation`, `student-onboarding-gate`, `exam-platform-v2-integration-matrix` |

Missing classes for B1+:

- Architecture tests: no exam-core write into curriculum tables; no readiness import of the selector; no page-level thresholds.
- Contract tests for each section T contract.
- Domain tests for attribution and count derivation.
- Integration tests: exam gap → next action; learning evidence → readiness.
- Backward-compatibility tests: Knowledge State replay equality before and after attribution.
- Migration tests for any new link columns.
- Deterministic blueprint scenario tests per family.
- E2E journey tests (none exist in `tests/`).
- Content-readiness tests at concept and topic level.
- Official-fidelity tests per vertical against source structure.

---

## T. Target Contracts

Design only. "Reuse" names what already carries the meaning.

| Contract | Needed? | Reuse | Add |
|---|---|---|---|
| 17.1 CurriculumScope | Yes | `resolveCurriculumContext` result; `getBaseCurriculum` | pinned structure version; node path; stable objective identity |
| 17.2 StudentAssessmentContext | Yes | `ResolvedStudentContext`, journey facts, `LearnerStateSnapshot` (`activity-delivery/contract.ts:109`) | one read model over the four resolvers, with preparation target and requested intent |
| 17.3 QuestionEligibility | Yes | `isEligible` / `lifecycleSqlFor` | curriculum applicability, concept/objective coverage, licence |
| 17.4 BlueprintRequirement | Yes | `ActivityContract`; blueprint targets + slot constraints; BP V2 schema | one requirement shape both can compile to |
| 17.5 BlueprintResult | Yes | `assembleForm` output; `FORM_INCOMPLETE` | unmet constraints and rationale as data; estimated duration |
| 17.6 GeneratedAssessmentSnapshot | Yes for learning; exists for exam | `exam_instances.form` + `frozen_configuration` | learning side: policy version, intended coverage, rationale alongside `quiz_sessions` |
| 17.7 Activity / Continuation | Extend, do not add | `NextChallengeView`, `ContinuationResolution`, `LearningOrigin` | exam context; cross-concept next action; shared results shape |

---

## U. Data / Migration Impact

Potential needs only. No migration is proposed in B0.

- Item → concept attribution for both stores (role, weight, marks share).
- Learner `subjects` → catalogue subject link.
- `student_exam_profiles` → subject link, structured level, pinned structure version.
- One session representation; `20261107_1000` from the T1 delta must be reconciled first.
- Cross-version identity for nodes and objectives.
- Item-level estimated time and licence, or an enforced link to `assessment_sources`.
- Backfill of NULL `usage_eligibility` / `bank_lifecycle_status`.
- Real curriculum content and canonical concepts; prerequisite data.
- Each of these trips the migration-chain test in `exam-platform-v2-integration-matrix.test.ts`.

---

## V. Implementation Plan B1–B5

The proposed sequence holds, with one adjustment: the designation decisions (blockers) come before B1, and attribution moves from B3 to B1 as a contract with B3 implementing it.

| Block | Prerequisites | Capabilities | Expected migrations | Code areas | Tests | May continue in parallel | Must wait | Gate |
|---|---|---|---|---|---|---|---|---|
| B1 Canonical Assessment Foundation | blockers decided | contracts 17.1–17.3; subject and target links; item attribution model; curriculum authorship split | link columns; attribution table or fields | `src/lib/curriculum`, `src/lib/student`, `QB`, `EC/apply-vertical-config` | contract, architecture, migration | content, T1, vertical fidelity | solver work | every student resolves to a structure version deterministically |
| B2 Blueprint & Selection Core | B1 | 17.4–17.5; eligibility; shared solver; three policies; official adapter | none or small | `EC/form-assembly`, `EC/blueprint-v2`, `activity-delivery` | deterministic scenarios, official-fidelity | Q1 per-cell, experience presentation | BP V2 cutover outside B2 | same inputs give same form; official forms unchanged |
| B3 Execution + Evidence Loop | B2 | 17.6 for learning; attribution at write; exam result into next action | snapshot fields | `mastery.service`, `simulation/scoring`, `generate-and-take` | replay equality, integration | UX polish | experience redesign | Knowledge State replay within agreed tolerance |
| B4 Unified Student Experience | B3 | 17.7; one read model; dead ends closed; exam prep on the same card | none | `learning-os-snapshot`, `src/lib/experience`, `src/app/dashboard/**` | E2E journeys, UI-authority | content | — | no result state without a canonical next action |
| B5 Readiness + Certification | B1–B4 | Q1 at concept/topic level; fidelity; T1/T2 regression | none | `QB/health`, `QB/demand` | content-readiness, full E2E | — | — | full E2E on real content |

---

## W. Open Decisions

Status after B0-C: decisions 1, 2 and 5 are frozen (X.1); decision 6 is frozen as Model B (X.9). Decisions 3 and 4 remain open and do not block B1.

1. May personalised exam preparation deviate from official section distribution, or must it stay a subset of blueprint positions?
2. Should exam-attempt evidence advance the canonical stage (PROVE/RETAIN), or only Knowledge State as today?
3. Is the learner allowed to choose question count or depth (QUICK/BALANCED/DEEP) on any activity, or is count always engine-decided?
4. Should target grade influence preparation policy? It has a table and no writer.
5. Should an exam gap enter Today's ranking automatically, or stay opt-in by student acceptance?
6. Is the learning-side AI question store meant to converge with the reviewed bank, or stay a per-student cache?

---

## X. B0-C — Final Architecture Freeze

Added 2026-10-10. Read-only. No product code, schema, flag or branch was changed; nothing was merged or cherry-picked. Where this section and A–W differ, this section is authoritative.

Sources added in B0-C:

- **DEV database**, Neon endpoint `ep-withered-pine-aycmasw2` (`neondb`), every query inside `BEGIN TRANSACTION READ ONLY … ROLLBACK`. Ledger: 70 rows in `schema_migrations`, latest `20261107_1000`. Figures below are tagged **[DB]**.
- Read-only git inspection of `b8f21f4` and `b79372a` / `377a408`.
- Vercel environment variable **names** per environment (`vercel env ls`); values are encrypted and were not read.

### X.1 Frozen decisions and definitions

| # | Decision | Frozen as |
|---|---|---|
| D1 | Personalized Exam Preparation | May change emphasis and distribution (exam relevance + gaps + objective + time). Every selected item must still satisfy exam and curriculum applicability |
| D1 | Official Mock / Simulation | Official blueprint mandatory. No adaptation of distribution or emphasis to learner weakness |
| D2 | Exam evidence | May enter Learning Evidence and Knowledge State when valid. Never sets the Learning Stage directly; the stage changes only through the Canonical Learning Decision |
| D3 | Exam gaps | Exist as learning signals without student acceptance. Exam Preparation never places activities into Today; the Learning Decision Authority prioritises, Experience renders |
| Q1 | Question Bank & Exam Content Readiness | Read model of usable-content readiness. Never selects questions |
| T2 | Canonical & Curriculum Resolution | E2E consumer and test surface of the Curriculum domain. Not a second Curriculum Authority |

### X.2 Exam evidence: current code against D2

Current behaviour [V]:

- `Exam Attempt → Scoring → updateMastery → learning_evidence → mastery_records / concept_knowledge_state` exists (`src/lib/simulation/scoring.service.ts:122-150`).
- No code sets a stage from an exam result. The canonical evidence adapter maps `MOCK_EXAM`, `CUMULATIVE_ASSESSMENT`, `DIAGNOSTIC_CHECK` and quiz modes `exam_simulation`, `cumulative_assessment`, `diagnostic_check` to `UNSUPPORTED` (`src/lib/pedagogical-shadow/evidence-adapter.ts:104-116`). The prohibited flow does not exist.
- Consequence: the canonical engine replays the evidence ledger, not Knowledge State, so exam evidence currently reaches Knowledge State but is invisible to the Canonical Learning Decision. The required flow stops one step short.
- Attribution: an exam response credits only the first resolved student concept; an objective with no mapped concept, or a concept the student does not own, writes nothing (`scoring.service.ts:123-131`).
- DEV [DB]: 85 evidence rows, 1 of source `EXAM_SIMULATION`, **0 rows carrying `metadata.examScope`**. The single exam row is therefore `UNSCOPED_LEGACY` under `EC/evidence-scope.ts`. 25 rows have a NULL `operation_key`.

Work required:

| Block | Work |
|---|---|
| B1 | `EvidenceAttribution` contract: for each response, which canonical concepts receive evidence, with role and weight, and an explicit **validity-for-purpose** rule (which exam evidence may count toward which canonical requirement). Define what happens when the student has no instance of the concept |
| B3 | Apply attribution at the `updateMastery` call in `scoring.service.ts`. Replace the blanket `UNSUPPORTED` with the validity rule so qualifying exam evidence is seen by `qualifyEvidence`; stage still changes only inside `evaluateCanonicalLearningState`. Guarantee `examScope` on every exam evidence row and report the legacy unscoped ones |
| B3 | Replay comparison of Knowledge State and canonical stage before and after, per student |

### X.3 Exam gaps and Today: current flow against D3

Current [V]:

```text
finalizeExamCompletion → refreshExamGapRecommendations (EXAM_GAP_THRESHOLD 0.5)
  → learning_recommendations row, status OPEN        (src/lib/learning-plan/exam-bridge.service.ts:27, 111-133)
  → student accepts, or clicks Reinforce
  → reinforceFromExamGap enrols the concept, writes exam_gap_concept_links,
    notifies the orchestrator                         (EC/learning-bridge.service.ts:177-204)
  → only now can the concept appear in getLearningDecisions
```

- The gap **row** already exists without acceptance. It is not a learning **signal**: `getLearningDecisions` and its inputs read none of `learning_recommendations`, `exam_gap_concept_links`, `exam_attempt_results`, `student_exam_profiles`.
- DEV [DB]: 4 `EXAM_GAP` recommendations (2 ACCEPTED, 1 OPEN, 1 DISMISSED), 4 `exam_gap_concept_links`.
- Exam Preparation does not place anything in Today today, which matches D3.

Differences from target:

1. Publication is coupled to a recommendation the student must act on. Target: a published candidate need the decision authority reads as an input signal.
2. A DISMISSED recommendation hides the gap. Target: dismissal is an agency fact the authority weighs, not deletion of the signal.
3. The ranker has no exam urgency input from `student_exam_profiles` (it reads `assessment_schedule_rules` only).
4. A gap on a concept the student does not yet own has no path other than enrolment-by-acceptance. Target: the authority may propose it; enrolment into an optional plan remains the student's choice.

### X.4 T1 final delta reconciliation (`b8f21f4`, read-only)

- **What it changes on `student_exam_profiles`:** migration `20261107_1000` adds four nullable columns, `target_exam_series`, `target_exam_year`, `interest_area`, `interest_area_detail`, with CHECK constraints (series ∈ MAY/NOVEMBER/MARCH/JUNE, series and year both-or-neither, year 2000–2100, interest-area format, detail only with `OTHER`). No drop, rename or backfill. `official_session_key` is explicitly not reused. [V]
- **Code:** `PATCH /api/exam-preparation/[id]` gains `examSession`, `interestArea`, `interestAreaDetail`; `objective-session.ts`; `subject-curriculum-topics.ts` (a new reader of academic_subjects → published structure version → nodes → objectives → mappings); display-label changes in `learning-os-snapshot.service.ts`; Today shows learning and preparation contexts separately. 39 files. [V]
- **DEV already has it:** `20261107_1000` is in the DEV ledger (applied 2026-10-10 16:02 UTC); 1 profile has `target_exam_series`. This branch's code does not know the columns. [DB]
- **Do the B0 Preparation Context conclusions hold?** Yes. `student_exam_profiles` remains the per-target record and no new entity is needed. The delta fills one listed gap (a governed intended session on the target). Still missing: subject FK, structured level, pinned structure version, target-grade writer.
- **Must B1 assume the delta is merged first?** Yes. DEV schema already includes it, and it edits files B1 and B4 will touch (`preparation.service.ts`, `objective-catalog.ts`, `learning-os-snapshot.service.ts`, `today/page.tsx`, `learn/page.tsx`) plus the migration-chain test.
- **Conflicts with B1 contracts:** none. Two bindings follow: `PreparationContext` uses `target_exam_series` + `target_exam_year` as the intended session and never reads `official_session_key` for that purpose; `subject-curriculum-topics.ts` becomes a consumer of `CurriculumScope` rather than a fifth curriculum reader.

### X.5 BP-4A reconciliation (read-only)

- The two non-ancestor commits are `b79372a` (wire Blueprint V2 runtime shadow) and merge `377a408`. [V]
- BP-4A runtime behaviour is **present** in this line. Of the 12 files in `b79372a`, 4 are byte-identical here and the other 8 carry later additions (slot `constraints` passed through hooks and parity; the eligibility comment updated to "never PILOT"). The same content reached the integration line through `d4de854`. [V]
- Adopting those commits changes nothing: `EXAM_BLUEPRINT_V2` is `OFF | SHADOW` with no cutover value (`EC/blueprint-v2/flag.ts`), in both. Blueprint V2 stays shadow-only. [V]
- B1 should neither depend on `feat/exam-blueprint-bp4a` nor merge it; this line supersedes it. B2 reuses the V2 schema, compiler and resolver as the starting point for `BlueprintRequirement`.

### X.6 DEV database verification [DB]

**Curriculum**

| Entity | Rows | Note |
|---|---|---|
| `academic_organizations` / `programmes` / `qualifications` / `subjects` | 12 / 18 / 12 / 108 | programmes: 12 CURRICULUM, 5 ADMISSION_EXAM, 1 ASSESSMENT_FRAMEWORK |
| `structure_versions` | 110 | 108 PUBLISHED (101 with nodes, 7 empty), 2 DRAFT |
| `structure_nodes` | 283 | **282 `EXAM_SECTION`, 1 `TOPIC`** |
| `learning_objectives` | 460 | 253 have a PUBLISHED concept mapping; 207 have none |
| `objective_concept_mappings` | 324 | all PUBLISHED; 323 PARTIAL, 1 FULL |
| `canonical_subjects` / `canonical_concepts` | 13 / 135 | all ACTIVE |
| `canonical_concept_prerequisites` / `concept_relationships` | 0 / 0 | both prerequisite graphs are empty (confirmed) |
| `assessment_structure_nodes` | 613 | parallel exam hierarchy |
| learner `subjects` / `topics` / `concepts` | 37 / 6 / 100 | 37 students |
| `concept_catalog_mapping` | 90 | 66 MATCHED, 24 UNRESOLVED; 10 learner concepts have no mapping row |

Canonical linkage coverage: 66 of 100 learner concepts are linked. 39 of 85 evidence rows sit on linked concepts; the other 46 have no canonical identity.

**Question stores**

| Measure | Reviewed exam bank | Learning store |
|---|---|---|
| Table | `question_bank_items` → `approved_items` | `question_bank_candidates` |
| Volume | 496 identities, 509 versions | 12,664 candidates (10,287 VALIDATED, 2,377 RETIRED) |
| Scope | 91 published exam versions | at most 5 students, at most 14 concepts per activity type |
| Provenance | 477 FIXTURE, 19 STUDYUS_GENERATED; 0 OFFICIAL, 0 LICENSED | AI-generated, per student |
| Lifecycle | 477 PUBLISHED/ACTIVE (all fixture), 11 PILOT, 13 SUPERSEDED, 7 REJECTED, 1 REPAIR_REQUIRED | n/a |
| Human review | **`question_bank_reviews`: 0 rows** | none by design |
| Student-eligible (app predicate) | **0** for practice, **0** for full mock | per-student pool |
| Licensing | 122 `assessment_sources`, all PUBLIC; **0 of 509 items have `source_ids`** | none |
| Objective mapping | 509 / 509 | not populated |
| Concept mapping | none on item; 401 / 509 reach a concept through their objective | one learner concept each |
| Metadata | marks 509, difficulty 509, cognitive demand 351, command term 218, **estimated time 0** | — |
| Delivery | `exam_item_usage`: 26 REDUCED_MOCK, 17 PRACTICE | `canonical_prepared_activity`: 1,262 (all but 2 `source = BANK`); 2,045 quiz sessions, 2,011 with a canonical contract |

**Item-level bridge: none.** No column in either store references the other (checked `information_schema.columns` for `approved_item`/`bank_item` on the learning tables and `candidate`/`quiz_session` on the bank tables: zero matches).

Note: 51 PUBLISHED/ACTIVE versions have a NULL `content_origin`; they are fixtures only because their bank identity has `provenance = 'FIXTURE'`.

**Exam readiness for students, using actual eligible content**

| Vertical | Published versions | Blueprint targets | Student-eligible items | Practice set | Section drill | Partial mock | Complete blueprint-valid mock |
|---|---|---|---|---|---|---|---|
| PAA | 4 | 59 | 0 | NO | NO | NO | NO |
| PISA | 3 | 37 | 0 | NO | NO | NO | NO |
| IB | 64 | 270 | 0 | NO | NO | NO | NO |
| Cambridge IGCSE | 2 | 12 | 0 | NO | NO | NO | NO |
| AICE (Cambridge AS/A) | 16 | 128 | 0 | NO | NO | NO | NO |
| ICFES / Saber | 2 | 60 | 0 | NO | NO | NO | NO |

Non-student capability, for context only (objective match, an upper bound that ignores type, difficulty and slot constraints): fixtures cover AICE 128/128 targets, Cambridge 12/12, ICFES 60/60, PISA 37/37, PAA 58/59, IB 103/270. PILOT items awaiting human review: ICFES 8 items touching 50 targets, PAA 3 items touching 4.

**Exam models**

| Entity | Rows |
|---|---|
| `exam_definitions` | 91 (AICE 16, Cambridge 2, IB 14 ACTIVE + 50 DRAFT, ICFES 2, PAA 3 + 1 retired, PISA 2 + 1 retired) |
| `exam_versions` | 92 (91 PUBLISHED) |
| `assessment_components` | 285 |
| `assessment_blueprints` | 92 |
| `blueprint_objective_targets` | 578 (50 with slot constraints, the Saber 11 Math blueprint) |
| `scoring_models` | 92 |
| `score_conversion_models` | **0** |
| `cambridge_grade_thresholds` | **0** |
| `exam_instances` | 6 (2 MOCK, 4 PRACTICE of which 1 DIAGNOSTIC) |
| `simulation_attempts` | 12: 5 FULL_MOCK, all linked to an instance; 7 MINI_MOCK / DOMAIN_EXAM with no instance |
| `exam_attempt_results` / `readiness_snapshots` | 9 / 9 |
| `question_bank_health_snapshots` | 297 |

No `FULL_MOCK` attempt on DEV was created through the legacy path without an instance.

**Student preparation context** (29 `student_exam_profiles`, 15 ACTIVE)

| Can it represent | Evidence on DEV | Verdict |
|---|---|---|
| Qualification | `target_qualification` free text (2 rows); `objective_context.programme` (16) | PARTIAL, no FK |
| Subject | `objective_context.subject` (16); `subject_focus` (11); via definition → `academic_subject_id` for 11 of 29 | PARTIAL, no direct FK |
| Level | `objective_context.level` (16) | PARTIAL, JSON only |
| Exam version | `exam_version_id` on 23 of 29 | YES |
| Component / paper | no column | NO |
| Target date | `exam_date` 9; `authoritative_exam_date`, `personal_target_date`, `estimated_exam_month` 0; `target_exam_series` 1 | YES in schema, sparsely used |
| Target result / grade | `preparation_goals`: 0 rows | NO in practice |

Related: 12 academic profiles, only 1 with `academic_programme_id` and 0 with a qualification; 5 `student_academic_subjects` rows for 1 student; learner `subjects` has no catalogue column; `class_exam_assignments` 0 rows; `student_context_type` set for 15 of 37 students.

### X.7 Corrections to A–W from the DEV pass

- Section E said no structure tree is seeded and national structures have zero nodes. DEV: 101 of 108 published versions have nodes, but 282 of 283 nodes are `EXAM_SECTION`. The conclusion stands: there is no real unit/topic hierarchy.
- Section F quoted repo docs for "0 human-approved items". DEV confirms: 0 review rows, 0 student-eligible items.
- Section H: `cambridge_grade_thresholds` is not only unread, it is empty.
- Section 9 / H: the legacy `FULL_MOCK` bypass is real in code but has no instance-less `FULL_MOCK` rows on DEV.
- Section P: the T1 delta migration is already applied on DEV.

### X.8 Environment flags

| Flag | Environment | Value | Source | Confidence | Runtime consequence |
|---|---|---|---|---|---|
| `CANONICAL_ENGINE_V1_ENABLED` | Hosted DEV (Vercel `dev`) | UNKNOWN (variable present, encrypted) | `vercel env ls dev` | High that it is set; value not read | If exactly `'true'`: canonical engine decides activity, count, difficulty. Otherwise legacy |
| | Preview / Stage | UNKNOWN (present, encrypted) | `vercel env ls preview` | same | same |
| | Production | UNKNOWN (present, encrypted) | `vercel env ls production` | same | same |
| | Local DEV sandbox | `true` | `studyos-dev/.env.local` | High | canonical path |
| `STUDENT_JOURNEY_V2` | DEV / Preview / Production | NOT SET at project level | `vercel env ls` for each | High for project-level variables | Code reads unset as OFF: no journey UX, diagnostic endpoint returns 404 |
| `EXAM_BLUEPRINT_V2` | DEV / Preview / Production | NOT SET at project level | same | same | Code reads unset as OFF: shadow hooks do not run |

Limits: deployments in this project are sometimes created with per-deployment `--env` overrides, which this listing does not show; a specific immutable deployment could carry a different value. Supporting evidence for the canonical path on DEV: 2,011 of 2,045 `quiz_sessions` carry `canonical_activity_contract` [DB], which shows canonical launches wrote to the DEV database but does not identify which runtime wrote them.

### X.9 Question store boundary — FROZEN: Model B

**Two physical stores behind one canonical Question Coverage / Eligibility abstraction.**

Why not one physical bank (Model A):

- The exam bank is immutable-by-trigger, versioned, lifecycle-governed and human-review-gated. The learning store is a per-student, unreviewed, high-churn cache (12,664 rows for at most 5 students, 2,377 already retired).
- They key on different identities (learning objective vs learner concept).
- Merging would either weaken the review regime or impose it on a cache that cannot meet it.

Target:

| Aspect | Reviewed Exam Question Bank | Learning Activity Item Cache |
|---|---|---|
| Physical tables | `question_bank_items`, `approved_items` (unchanged) | `question_bank_candidates`, `canonical_prepared_activity` (unchanged) |
| Canonical name | Question Bank | Learning item cache. It is no longer called a "question bank" in contracts |
| Content class | reviewed: OFFICIAL / LICENSED / STUDYUS_GENERATED+approved / FIXTURE | `GENERATED_UNREVIEWED` |
| May serve | all families, subject to eligibility | LEARNING family only. Never OFFICIAL_EXAM. EXAM_PREPARATION only if a frozen policy explicitly allows unreviewed content |
| Coverage key | objective → canonical concepts, plus item-level attribution | learner concept → canonical concept through the explicit link (X.10) |
| Q1 | measured | reported separately as cache depth, never counted as bank readiness |
| Blueprint selection | through `QuestionEligibility` | through `QuestionEligibility` with its own class |

Supports: provenance (one vocabulary at the abstraction, mapping the three existing ones), licensing (source link required for anything not STUDYUS_GENERATED or FIXTURE), curriculum applicability (objective → node → version), exam applicability (`exam_version_id`), objective coverage, concept coverage, reviewed vs generated, Q1, blueprint selection.

B1 implements: the `QuestionCoverage` and `QuestionEligibility` contracts as read abstractions over both stores; item-level concept attribution for the exam bank; a single provenance/licence vocabulary at the abstraction.
Unchanged: both sets of tables, lifecycle triggers, `DEFAULT_ELIGIBILITY`, activity delivery, generation gates. No item-level bridge is introduced; promotion of a cached item into the bank, if ever wanted, is a factory intake path with full review, not a link.

### X.10 Concept identity boundary — FROZEN

| Use | Identity |
|---|---|
| Curriculum | `canonical_concepts.id` |
| Question Coverage | `canonical_concepts.id` (reached from `learning_objectives.id` for exam items) |
| Q1 | `canonical_concepts.id` and `learning_objectives.id` |
| Blueprint requirements | `learning_objectives.id` for OFFICIAL_EXAM; `canonical_concepts.id` for LEARNING and EXAM_PREPARATION targets |
| Learner state and Learning Evidence | learner `concepts.id` (unchanged) |

Relationship between student-owned and canonical concepts:

- A learner concept is the student's **instance**. It carries state and evidence.
- The link to a canonical concept is an explicit, stored fact in `concept_catalog_mapping` (0..1, at most one MATCHED per student per canonical concept, as the existing trigger already enforces).
- **Label matching is not the canonical bridge.** A link is canonical only when it is (a) set at creation because the concept was created from a canonical concept (plan enrolment, exam bridge, institution or class plan), or (b) confirmed through the mapping's review states. Label or name similarity may only create a PROPOSED row.
- A learner concept with no confirmed link is **personal**: it keeps state and evidence, and is outside curriculum coverage, Q1 and blueprint requirements.
- The two creation paths (`CANON_…` and `catalog:…` keys) must converge on one rule in B1.

Historical compatibility:

- `learning_evidence` rows are not rewritten and stay keyed on the learner concept.
- Canonical identity is resolved at read time through the link, so linking a concept later makes its history visible without migration.
- Existing MATCHED rows produced by label matching (66 on DEV) are to be classified in B1 as confirmed-at-creation or needing confirmation; until then they remain usable.
- 46 of 85 DEV evidence rows are on unlinked concepts and stay personal.

### X.11 Curriculum Authority — FROZEN

| Layer | Owns | Does not own |
|---|---|---|
| **Curriculum Authority** (`src/lib/curriculum`, `src/lib/catalog`) | `structure_versions`, `structure_nodes`, `learning_objectives`, `objective_concept_mappings`, canonical concepts, skills, competencies; publication and versioning | exam structure, mastery, item counts |
| **Exam configuration** (vertical configs) | declares exam definitions, versions, components, blueprint targets, scoring policy; **references** objectives by stable code | the meaning, hierarchy or mapping of objectives |
| **Seed / bootstrap / materialisation** (`applyVerticalConfig`, dev catalogue seeds) | an operator procedure that requests creation of missing curriculum rows **through the Curriculum Authority's services**, marked with bootstrap provenance | any semantic decision; it is not an authority |
| **Assessment-specific structure** (`assessment_components`, `assessment_structure_nodes`, blueprint rows) | papers, sections, exam-side grouping | curriculum hierarchy |

Transition strategy (no implementation here):

1. B1: existing rows keep their ids. QB items, blueprint targets and mappings all FK to `learning_objectives.id`, so nothing is renumbered.
2. B1: nodes typed `EXAM_SECTION` (282 of 283 on DEV) are recognised as bootstrap-origin assessment groupings living in the curriculum tables, not as curriculum hierarchy. Real hierarchy is added by the Curriculum Authority as content, and objectives are re-parented by a governed curriculum operation.
3. B1: `applyVerticalConfig` stops writing curriculum tables directly and calls curriculum services; an architecture test forbids `EC/**` from inserting into the four owned tables.
4. B1: objectives gain an identity stable across structure versions (owned by Curriculum).
5. T2 validates the chain Organization → Programme → Qualification → Structure Version → Subject → Nodes → Objectives → canonical mappings → exam mappings, and reports unmapped objectives (207 of 460 on DEV).

### X.12 Official mock path — FROZEN

- **Canonical official path:** `exam_instances` with mode `MOCK` or `CHALLENGE`, created through `/api/exams/instances`, form frozen by `freezeForm` before start, items only from `DEFAULT_ELIGIBILITY`, official timing and policies from the version, attempt-frozen scoring policy. Only this path may be named "mock", "official simulation" or "full mock" to a student.
- **Legacy `/api/simulation/attempts`:** reclassified as **Preparation Simulation** in the EXAM_PREPARATION family. `TOPIC_EXAM`, `DOMAIN_EXAM`, `MINI_MOCK` remain as preparation practice.
- Its `FULL_MOCK` type and `OFFICIAL_SIMULATION_TIMED` mode, when started without a frozen instance, are **not official** and must not be presented as such. Target: `FULL_MOCK` is reachable only through an instance; the direct route rejects it. (Implementation in B2/B3.)
- Under D1 the lazy, learner-dependent sourcing of the legacy path is legitimate for preparation. Its AI fallback serves `GENERATED_UNREVIEWED` content, which is allowed there only if the Exam Preparation policy says so, and must be labelled.
- Evidence written from either path keeps `examScope`; the path semantics (official vs preparation) is part of `GeneratedAssessmentSnapshot`.

### X.13 Count and evidence-sufficiency ownership — FROZEN

The Question Bank never decides how many questions a learner needs.

| Family | Ownership chain | Reuse |
|---|---|---|
| LEARNING | Learner State + evidence requirements (`evaluateCanonicalLearningState`) → Learning policy (`pedagogical-engine/policy.ts`, `difficulty-policy.ts`) → `BlueprintRequirement` → shared solver → count | `ActivityContract` is reused as the single-concept case of `BlueprintRequirement`. `deriveEvidenceRequirement` / `resolveQuestionCount` (`src/lib/lx/evidence-sufficiency-contract.ts`) reused for requirement derivation. Generators and activity delivery reused as content sources behind eligibility |
| OFFICIAL_EXAM | Official blueprint → slots, marks, timing → structure | `blueprint_objective_targets`, `formInputs`, `assembleForm` reused unchanged |
| EXAM_PREPARATION | exam applicability + published gaps + preparation objective + time → `BlueprintRequirement` → shared solver | policy is new; it reuses the preparation plan classification (`preparation-plan.ts`) as its gap input |

Removed as owners in the target: the route clamp, `QUIZ_MODE_CONFIG`, the UI slider, `MODE_DEFAULT_MAX`. Whether a learner may express a depth preference is an input to policy, not a count.
What is missing for multi-concept requests: today's contract is per concept with fixed counts per activity; overlap, available time and available items are not inputs.

### X.14 Experience contracts — FROZEN reuse strategy

No new parallel contract. `LearningActivity` is **NOT_NEEDED**.

| Need | Structure | Action |
|---|---|---|
| The activity card | `NextChallengeView` (`src/lib/experience/next-challenge.ts:40`) | **EXTENDED** |
| Exam context on the card | `NextChallengeView` | EXTENDED with optional exam target and preparation context |
| Assessment estimate | `NextChallengeView.itemCount` | EXTENDED to an estimate (items, marks, duration) |
| Why | `LearningDecision.facts` | **REUSED** |
| Per-concept decision | `CanonicalPedagogicalDecision`, `ActivityContract` | REUSED |
| Teaching hand-off | `TeachingIntent` | REUSED |
| Result → what changed | `canonicalResults`, `resolveResultMilestone` | REUSED for learning; **ADAPTED** from `exam_attempt_results` for exam results |
| Result → continuation | `ContinuationResolution`, `LearningOrigin` (`src/lib/lx/continuation.ts`) | EXTENDED with a cross-concept next action and an exam origin |
| Cross-concept next action | `resolveContinuation` + `getLearningDecisions` | EXTENDED: continuation asks the decision authority for the next concept instead of returning `RETURN_TO_MISSION` |
| Exam Prep → Today / My Path | `getLearningOSSnapshot` | EXTENDED to read published gaps and exam urgency through the decision authority |
| Exam-side next step | `nextStep`, `resolveStudentExamJourney`, `determineNextAction` | ADAPTED into inputs and views of the same contract; they stop being independent next-action producers |
| Session shell | `quiz_sessions`, exam attempt runner | REUSED; one results shape ADAPTED over both |

### X.15 Final B1 contract set (design only)

| Contract | Class | Owner | Input | Output | Must not |
|---|---|---|---|---|---|
| CurriculumScope | EXTEND_EXISTING (`resolveCurriculumContext`, `getBaseCurriculum`) | Curriculum Authority | student or subject, programme, qualification | pinned structure version, nodes, objectives, canonical concepts | read learner state; decide counts |
| StudentAssessmentContext | NEW_REQUIRED (a read model over the four resolvers) | Student Context | student, requested intent | CurriculumScope, learner-state snapshot, PreparationContext | invent curriculum or state; write |
| PreparationContext | EXTEND_EXISTING (`student_exam_profiles`) | Student Preparation Context | exam target id | exam version, subject, level, intended session, dates, goal | become a new entity; define exam structure |
| QuestionCoverage | NEW_REQUIRED | Question Bank Authority | item (either store) | objectives and canonical concepts with role and weight; curriculum and exam applicability | decide selection or dosage |
| QuestionEligibility | EXTEND_EXISTING (`isEligible`, `lifecycleSqlFor`) | Question Bank Authority | item, family, audience, context | eligible or not, with reason; content class; licence | rank or select |
| BlueprintRequirement | EXTEND_EXISTING (`ActivityContract`, blueprint targets, BP V2 schema) | Blueprint policy of each family | StudentAssessmentContext or official blueprint | targets, coverage and evidence requirements, difficulty, diversity, time, official constraints | own curriculum, learner state, bank or official structure |
| BlueprintResult | EXTEND_EXISTING (`assembleForm` output) | Shared solver | BlueprintRequirement, eligible items | selected items, coverage achieved, unmet constraints, estimate, rationale, policy version | invent policy |
| EvidenceAttribution | NEW_REQUIRED | Learner State Authority | scored response, QuestionCoverage | evidence per canonical → learner concept with weight and validity-for-purpose | set a stage; rewrite history |
| GeneratedAssessmentSnapshot | REUSE_EXISTING for exam (`exam_instances.form`, `frozen_configuration`); EXTEND_EXISTING for learning (`quiz_sessions.canonical_activity_contract`) | Assessment execution | BlueprintResult | immutable record: scope, policy version, item ids, intended coverage, path semantics, rationale | be recomputed |
| NextAction / Continuation | EXTEND_EXISTING (`NextChallengeView`, `ContinuationResolution`) | Learning Decision Authority decides; Experience renders | learner state, published gaps, exam urgency, goals | one next action with reason and launch target | be produced by pages or by Exam Preparation |
| LearningActivity (new) | NOT_NEEDED | — | — | — | — |
| PreparationProfile (new entity) | NOT_NEEDED | — | — | — | — |

### X.16 B1 entry gate

| Gate item | Target owner frozen | Where |
|---|---|---|
| Curriculum Authority | YES | X.11 |
| Canonical Concept Identity | YES | X.10 |
| Question Store Boundary | YES, Model B | X.9 |
| Question Coverage representation | YES | X.9, X.15 |
| Official Mock Path | YES | X.12 |
| Question Count / Evidence Sufficiency | YES | X.13 |
| Learning vs Exam Prep orchestration | YES | X.1 D3, X.3 |
| Blueprint family responsibilities | YES | X.1 D1, section J, X.13 |
| Generated Assessment auditability | YES | X.15 |
| Evidence attribution contract | YES | X.2, X.15 |
| Continuation / Next Action authority | YES | X.14, X.15 |

All eleven have a frozen target owner. Implementation is missing for most; that is expected.

Items X.9–X.12 were frozen here by recommendation, as instructed, and are subject to human review of this document.

---

# Final Summary

## VERIFIED CANONICAL AUTHORITIES

- Evidence write: `updateMastery()` (`src/services/mastery.service.ts:361`).
- Learner knowledge: `concept_knowledge_state` via `recalculateConceptKnowledgeState`.
- Per-concept activity, count and difficulty (flag on): `evaluateCanonicalLearningState` → `ActivityContract`.
- Curriculum relationship: `objective_concept_mappings` over `structure_versions → structure_nodes → learning_objectives`.
- Official exam structure: `exam_definitions → exam_versions → assessment_blueprints → blueprint_objective_targets`.
- Exam item eligibility: `DEFAULT_ELIGIBILITY` / `lifecycleSqlFor`.
- Official form selection: `formInputs` → `assembleForm`, frozen.
- Exam scoring: `scoreResponseSet` with policy as data.
- Preparation target: `student_exam_profiles`.
- Post-activity continuation (learning): `resolveContinuation`.
- Learning plan: `learning_plan` / `learning_plan_item`.

## DUPLICATED OR COMPETING AUTHORITIES

- Activity decision: canonical engine vs legacy `selectActivityType`, forked by flag.
- Question count and difficulty: engine vs route clamp and UI slider.
- Mastery: `mastery_records` vs Knowledge State.
- "What evidence is needed": engine requirements vs `validation_readiness`.
- Next action: nine producers across learning and exam.
- Exam start: frozen-form instances vs F9 `/api/simulation/attempts`.
- "Question bank": per-student learning store vs reviewed exam bank.
- Hierarchy: `structure_nodes` vs learner `topics` vs `assessment_structure_nodes` vs TS catalogue.
- Curriculum authorship: curriculum services vs `applyVerticalConfig`.
- Exam readiness: `readiness_snapshots` vs legacy `exam-readiness.service.ts`.
- Student context: four resolvers.
- Exam session: three representations.
- "Diagnostic": gap classifier, learning diagnostic check, exam diagnostic instance.

## MISSING LINKS

- Learner subject → catalogue subject → structure version.
- Exam target → subject, level, structure version.
- Exam item → concept; learning question → objective.
- Exam gap or result → learning ranking (Today).
- Learning activity → readiness snapshot refresh.
- Exam evidence → canonical stage.
- Learning question store ↔ exam bank.
- School assessments (`assessment_occurrences`) ↔ exam targets.
- Knowledge State → `concept_transfer_state`.

## MISSING CAPABILITIES

- Multi-concept evidence attribution.
- An assessment-construction contract shared by learning and exam.
- Exam-preparation assembly that combines exam relevance with learner state.
- Topic practice and custom multi-concept practice policies.
- Cross-concept continuation.
- Curriculum version migration and cross-version identity.
- Official score scales.
- Concept- and topic-level readiness.
- A caller that creates learning diagnoses.
- A defined Q1 and T2 in this repo line.

## DATA READINESS RISKS

- Curriculum: no real unit/topic tree for any curriculum; national structures have zero nodes; canonical concepts are ~134 dev fixtures; prerequisite graphs reported empty.
- Question Bank: fixture-only content in the repo; docs report 0 human-approved items and 0 certified mocks; legacy NULL rows treated as ACTIVE.
- Mapping: learner concepts link to canonical by label match; unmatched concepts produce no exam evidence and no curriculum linkage.
- DEV figures are now verified in X.6: 282 of 283 structure nodes are `EXAM_SECTION`; 207 of 460 objectives have no concept mapping; 0 student-eligible exam items; 0 human reviews; both prerequisite graphs empty.

## EXPERIENCE FRAGMENTATION RISKS

- Dead ends: verification result, diagnostic check result, subject-level cumulative quiz, consolidated concept.
- Exam Preparation and Today/Path are composed by separate stacks with separate next-step logic.
- Reason and action can come from different engines.
- Silent legacy fallback in Path and Progress versus explicit error in Concept Mission.
- Count slider and thresholds in the quiz page and routes.
- Two transfer entry points; exam result page picks its own concept.

## BLOCKERS BEFORE B1

Status after B0-C:

| Original blocker | Status |
|---|---|
| 1. Single learning decision authority | Target frozen (X.14, X.15). Hosted flag value still unread (X.8) |
| 2. Legacy F9 simulation path | Frozen (X.12) |
| 3. Curriculum authorship | Frozen (X.11) |
| 4. T1 final delta | Reconciled (X.4). Must be merged into the B1 base |
| 5. Q1 and T2 definitions | Frozen (X.1) |
| 6. Product decisions | Frozen (X.1) |
| 7. DEV database pass | Done (X.6) |

Remaining, concrete:

1. Merge `remediation/t1-final-delta` (`b8f21f4`) into the line B1 will branch from. DEV schema already contains its migration.
2. Operator confirms the value of `CANONICAL_ENGINE_V1_ENABLED` in hosted DEV, Preview and Production.
3. Human review accepts or amends the four recommendations frozen in X.9–X.12.

## SAFE TO DEVELOP IN PARALLEL

| Track | Classification | Scope that is safe |
|---|---|---|
| Q1 | SAFE | content production, human review, per-cell health, demand and certification. Not concept or topic coverage |
| T1 | SAFE | finishing remediation and manual retest within its contracts; merging the final delta |
| T2 | SAFE as validation | building the E2E chain checks against existing tables; reporting unmapped objectives. No curriculum schema changes |
| T7 | UNKNOWN | not defined in this repo line. Safe only if it touches none of the MUST WAIT items |
| Learning/LX | SAFE with limits | defect fixes inside existing engines; presentation of existing decisions |
| Exam Core | SAFE with limits | blueprint fidelity, official scales, thresholds data; Blueprint V2 in shadow |
| Vertical-content work | SAFE | authoring, review and import of items and real curriculum content into existing schema |
| T9 | UNKNOWN | not defined in this repo line. Same rule as T7 |

## MUST WAIT

- Any new next-action, recommendation or Today-placement producer.
- Any question-count or difficulty logic outside the canonical engine.
- Blueprint V2 cutover; any shared solver.
- Item schema changes for concept mapping, applicability or licence.
- Concept- and topic-level Q1 measures.
- New context or preparation entities.
- New exam start paths; any new use of `FULL_MOCK` outside frozen instances.
- Changes to evidence attribution, to `UNSUPPORTED` mappings in the evidence adapter, or to Knowledge State inputs.
- Direct writes from `EC/**` to curriculum tables beyond what exists.
- Any change to how learner concepts are linked to canonical concepts.

## B0 CERTIFICATION

```text
ARCHITECTURE_READY
```

---

# B0-C Final Return

## FINAL B0 STATUS

```text
ARCHITECTURE_READY
```

## B1 ENTRY

```text
B1_GO_WITH_CONDITIONS
```

## CONDITIONS

1. `b8f21f4` (T1 final delta, migration `20261107_1000`) is merged into the B1 base line before B1 starts.
2. The operator confirms the hosted value of `CANONICAL_ENGINE_V1_ENABLED` for DEV, Preview and Production. If it is not `true` everywhere B1 will be validated, B1 treats the legacy activity path as live and in scope for compatibility.
3. Human review accepts or amends the frozen recommendations: question stores Model B (X.9), concept identity (X.10), curriculum authority transition (X.11), official mock path naming (X.12).

Not conditions for B1, but known facts B1 must plan around: 0 student-eligible exam items and 0 human reviews on DEV; 207 of 460 objectives have no concept mapping; 34 of 100 learner concepts have no canonical link; both prerequisite graphs are empty; no score conversion or threshold data.

## TARGET AUTHORITIES FROZEN

1. **Curriculum Authority**: structure versions, hierarchy, learning objectives, objective ↔ concept mappings, canonical concepts.
2. **Canonical Concept Identity**: `canonical_concepts.id`; learner concepts are instances linked explicitly, never by label matching.
3. **Question Bank Authority**: reviewed exam bank, with the learning item cache as a separate class, both behind one coverage and eligibility abstraction.
4. **Learner State Authority**: `updateMastery` → `learning_evidence` → Knowledge State; owner of evidence attribution.
5. **Official Exam Authority**: definitions, versions, components, official blueprint, scoring policy; official mocks only through frozen `exam_instances`.
6. **Student Preparation Context**: `student_exam_profiles`.
7. **Blueprint policy families**: LEARNING (evidence-driven), EXAM_PREPARATION (adaptive emphasis), OFFICIAL_EXAM (fidelity), over one shared solver.
8. **Learning Decision Authority**: concept ranking plus canonical per-concept decision; sole owner of Learning Stage and next action; consumes published exam gaps.
9. **Experience Orchestration**: snapshot, `NextChallengeView`, continuation; renders decisions, decides nothing.
10. **Q1**: readiness read model; never selects.
11. **T1 and T2**: consumer and test surfaces; not authorities.

## B1 CONTRACTS FROZEN

| Contract | Class |
|---|---|
| CurriculumScope | EXTEND_EXISTING |
| StudentAssessmentContext | NEW_REQUIRED |
| PreparationContext | EXTEND_EXISTING |
| QuestionCoverage | NEW_REQUIRED |
| QuestionEligibility | EXTEND_EXISTING |
| BlueprintRequirement | EXTEND_EXISTING |
| BlueprintResult | EXTEND_EXISTING |
| EvidenceAttribution | NEW_REQUIRED |
| GeneratedAssessmentSnapshot | REUSE_EXISTING (exam) / EXTEND_EXISTING (learning) |
| NextAction / Continuation | EXTEND_EXISTING |
| LearningActivity, PreparationProfile | NOT_NEEDED |

## SAFE PARALLEL TRACKS

- **Q1**: SAFE for content, review and per-cell readiness.
- **T1**: SAFE; merge the final delta.
- **T2**: SAFE as validation only.
- **T7**: UNKNOWN scope; safe only outside the MUST WAIT list.
- **Learning/LX**: SAFE for fixes and presentation.
- **Exam Core**: SAFE for fidelity, scales and shadow work.
- **Vertical-content work**: SAFE.
- **T9**: UNKNOWN scope; safe only outside the MUST WAIT list.

## MUST WAIT

As listed under "MUST WAIT" above.

STOP. B1 has not been started.

---

# B0-U Addendum — Universal Curriculum & Assessment Delta (2026-10-10)

Everything above is the original B0 / B0-C certification and is kept unchanged as historical evidence.
This addendum extends it; it removes nothing.

```text
ORIGINAL CERTIFICATION (B0 + B0-C, anchor 73c303a)
+ ARCHITECTURAL DELTA (B0-U, base cbb6b39)
= CURRENT CERTIFIED ARCHITECTURE
```

Full report: `docs/audits/B0_UNIVERSAL_CURRICULUM_ASSESSMENT_DELTA.md`.

| Topic | B0 said | B0-U adds |
|---|---|---|
| Curriculum Authority | owns versions, hierarchy, objectives, mappings, canonical concepts | the same model serves any framework (IB, Cambridge, SEP Secundaria, SEP EMS, MEN proven on fixtures); framework vocabulary is configuration (`FrameworkProfile`), never a core type |
| Official vs teaching structure | not addressed | both use the same structure; ownership (`academic_organizations.source_type`) says which is official |
| Section E gap "no crosswalk table" | listed as a gap | clarified: no curriculum-to-curriculum mapping is wanted; curricula align through shared canonical concepts |
| Mastery | owned by the Learner State Authority | restated as a rule: mastery of a node, topic, unit, subject or curriculum is derived on read, never stored |
| Student state | longitudinal | proven invariant to a change of curriculum for canonically linked concepts |
| Assessment objective | not named | an assessment-framework dimension (component definition, item tag, slot dimension); not an expectation, concept or skill |

No original decision is contradicted. Schema: no change. B1: `B1_STILL_VALID`. B2: `B2_GO_REMAINS_VALID`.

```text
B0_UNIVERSAL_CURRICULUM_DELTA_PASS
NO_SCHEMA_CHANGE
```
