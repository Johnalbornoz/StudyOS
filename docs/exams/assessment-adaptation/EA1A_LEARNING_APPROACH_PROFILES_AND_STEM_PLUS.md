# EA-1A — Learning Approach Profiles & STEM+ overlay

Branch `feat/ea1a-learning-approach`, on EA-1 (`3031e03`). Pure code, tests and this design. No migration, no SQL file, no table, no route, no service, no database access, no network, no AI provider call, no ingestion, no question generated, nothing reviewed or approved. B2 is untouched; B3 scoring is not implemented.

Everything authored here is provisional: the STEM+ approach and the school STEM performance profile are StudyUs policy drafted in-session by the model working on the phase; the task families are `DRAFT` / `UNREVIEWED`; every assessment profile is `PROVISIONAL_ILLUSTRATIVE`. They test an architecture.

## 1. Three independent layers

| Layer | Question it answers | Owner | In code |
|---|---|---|---|
| **Curriculum profile** | What is the learner expected to learn? | Curriculum | `CurriculumProfile` — a *reference* to a programme the repository records (SEP / MCCEMS, MEN). No content |
| **Learning approach profile** | How does the institution want the learner to work with and demonstrate knowledge during learning? | Learning architecture / institution configuration | `LearningApproachProfile` — `STANDARD`, `STEM_PLUS` |
| **Assessment profile** | How does an assessment require evidence to be demonstrated? | Shared assessment architecture | `AssessmentSystemProfile` → `AssessmentComponentProfile` — PAA, PISA, ICFES, IB, Cambridge, `SCHOOL_STEM_PERFORMANCE` |

They compose freely: Mexico = MCCEMS × {STANDARD, STEM_PLUS} × {PAA, PISA, the school's own assessment, …}; Colombia = MEN × {STANDARD, STEM_PLUS} × {ICFES, PISA, the school's own assessment, …}. **There is no STEM curriculum**: an approach names no concept, topic or objective, and its schema has no field that could hold one.

### Flow

```
Canonical Knowledge → EvidenceTarget → LearningApproachProfile → AssessmentTaskFamily → DisciplineAdaptationPolicy
   → AssessmentSystemProfile / ComponentProfile → AdaptationSpecification → generation
```

### Precedence and the conflict rule

1. **Curriculum** controls knowledge entitlement.
2. **Learning approach** controls pedagogical / evidence emphasis.
3. **Assessment profile** controls exam / system constraints.
4. **Task family** controls task structure.
5. **Adaptation specification** resolves the combination.

In the engine: profile, family and request fix the *feasible set* of each dimension exactly as in EA-1; the approach's preference only chooses inside it.

- **An OFFICIAL assessment constraint always wins** over an approach preference (the brief's rule).
- **StudyUs policy, flagged for confirmation:** a profile rule of *any* authority (official, StudyUs policy, institution policy) constrains in the same way. An approach never widens what a profile, a family or a request allows.
- A preference that could not be honoured is **never dropped silently**: the specification records it as unmet, with what was wanted, what was decided and the rule that overrode it (and that rule's authority).
- It is a **refusal** only when the approach marks the preference `REQUIRED_OUTSIDE_EXAMS` and the target is not an exam system (`examFamilyCode === null`). Against an exam system even a required preference yields and is recorded.

### Where things live

| Directory | Owner | Holds | Imports |
|---|---|---|---|
| `src/lib/learning-approach/` (new) | Learning architecture / institution configuration | Approach contract, `STANDARD`, `STEM_PLUS`, curriculum-profile reference, entitlement resolution, institution configuration and its resolution | `zod` only |
| `src/lib/assessment-adaptation/` | Shared assessment architecture | Engine and specification (now approach-aware), `INSTITUTION_POLICY` authority, version-bound components, `SCHOOL_STEM_PERFORMANCE`, the Mexico / Colombia POC | task-family contract, taxonomy, the approach contract |
| `src/lib/exam-core/question-bank/task-families/` | Question Bank | New declared family types, optional `approachSupport`, the EA-1A versions of three families | `zod` only |

Direction: `production → assessment-adaptation → {learning-approach, task-families}`. The approach directory imports nothing of the assessment layer, so it cannot contain an exam rule; profiles import no approach.

## 2. LearningApproachProfile contract (`learning-approach-profile.ts`)

| Field | Content |
|---|---|
| `approachId`, `version`, `displayName`, `statement` | Identity |
| `authority` | Always `STUDYUS_POLICY`: an approach is never official curriculum and never an exam rule |
| `status`, `certification` | `PROVISIONAL` / `CERTIFIED` (certification required for the latter) |
| `transversalCompetencies[]` | `{ key, reference, description }` — the reference is `IN_CATALOGUE { code }` or `NOT_YET_IN_CATALOGUE { proposedCode, toBeCreatedBy: 'CURRICULUM' }` |
| `preferences[]` | `{ preferenceId, dimension, prefer[], strength, rationale }`; one per dimension; dimension in `context`, `responseFormat`, `reasoningDepth`, `stimulus`, `toolPolicy`; strength `PREFERRED` or `REQUIRED_OUTSIDE_EXAMS` |
| `participationModes[]` | `INDIVIDUAL` (always) and optionally `COLLABORATIVE` |

The schema is strict. It has no concept, topic, objective, curriculum, exam family or rule field.

### STANDARD

The default; **emphasis-neutral**: no competency, no preference, individual work. It is **recorded by absence**: an adaptation under STANDARD, or under no approach, produces the very same specification — same content, same id — as before approaches existed.

Why this choice. EA-1 is accepted and its specifications must not change. Had STANDARD been written onto a specification, every EA-1 specification id would have changed for a default that says nothing. So the default has exactly one representation — no `learningApproach` member — and the schema refuses a specification that carries `STANDARD` (`STANDARD_IS_RECORDED_BY_ABSENCE`). The cost is that "STANDARD was explicitly configured" and "nothing was configured" are indistinguishable on a specification; the institution configuration still tells them apart (`source`).

### STEM_PLUS (v`0.1.0-provisional`)

| Competency | Catalogue reference |
|---|---|
| `SCIENTIFIC_INQUIRY` | **IN_CATALOGUE** `dev.comp.scientific-inquiry` |
| `MATHEMATICAL_MODELLING` | NOT_YET_IN_CATALOGUE — proposed `studyus.transversal.mathematical-modelling` |
| `ENGINEERING_DESIGN` | NOT_YET_IN_CATALOGUE — proposed `studyus.transversal.engineering-design` |
| `DATA_AND_COMPUTATIONAL_REASONING` | NOT_YET_IN_CATALOGUE — proposed `studyus.transversal.data-computational-reasoning` |
| `PROBLEM_SOLVING_AND_TRANSFER` | NOT_YET_IN_CATALOGUE — proposed `studyus.transversal.problem-solving-transfer` |
| `SCIENTIFIC_COMMUNICATION_AND_ARGUMENTATION` | NOT_YET_IN_CATALOGUE — proposed `studyus.transversal.scientific-communication-argumentation` |

| Preference | Dimension | Prefers | Strength |
|---|---|---|---|
| `stem-plus.context.situated` | context | scientific, societal, occupational, personal | REQUIRED_OUTSIDE_EXAMS |
| `stem-plus.response.constructed` | response format | extended, short response | PREFERRED |
| `stem-plus.reasoning.justified` | reasoning depth | justified argument, method shown | PREFERRED |
| `stem-plus.stimulus.data` | stimulus | own, shared | PREFERRED |
| `stem-plus.tools.available` | tool policy | allowed, scientific, GDC | PREFERRED |

Participation: individual and collaborative. Status `PROVISIONAL`: the brief asks for "the first certified LearningApproachProfile contract"; the *contract* is implemented and tested, and nobody has certified the *content*, so it is not marked certified.

### Competencies: reuse, not a second system

The repository's competency architecture is one table, `competencies(code UNIQUE, name)`, with `canonical_concept_competencies` and `objective_competency_mappings` pointing at it. In the repository's own catalogue (`DEV_COMPETENCIES`, `dev-learning-catalog.ts`) there are **eight** codes: `dev.comp.math-reasoning`, `dev.comp.reading`, `dev.comp.writing`, `dev.comp.english`, `dev.comp.scientific-inquiry`, and the three Saber 11 ones `icfes.saber11.mat.interpretacion / formulacion / argumentacion`. (The brief mentions 18 competencies; this session has no database access and can confirm only the eight the repository's catalogue file holds.)

An approach references a competency by its catalogue code. One of STEM+'s six exists. The other five are referenced by **proposed** codes, marked `NOT_YET_IN_CATALOGUE`, to be created by the Curriculum; nothing here creates a competency, and no registry of competencies exists in the new code (a test asserts both). A family declares the competencies it can evidence by the same codes; the specification says, per competency, whether the family serves it.

## 3. Individual evidence vs collaborative activity

- `PARTICIPATION_MODES`: `INDIVIDUAL`, `COLLABORATIVE`. `evidenceYieldOf`: individual → `INDIVIDUAL_EVIDENCE`; collaborative → `GROUP_ARTEFACT_ONLY`.
- A collaborative activity needs an approach that uses it, a family that declares it (`approachSupport.participationModes`), and a target that is not an exam system; otherwise `PARTICIPATION_MODE_NOT_ALLOWED`.
- A collaborative activity is **never evidence-bearing content**: `COLLABORATIVE_ACTIVITY_IS_NOT_INDIVIDUAL_EVIDENCE`, even from a reviewed family under a certified profile.
- How an *individual component* of a group task (an individual defence, an individual follow-up) becomes individual evidence is not modelled: that is B3.

"An exam system is sat individually" is StudyUs policy in the engine: the profile contract has no participation dimension.

## 4. Task-family integration

- **Declared types** (`KNOWN_FAMILY_TYPES`, no schema, refused until registered): `SCIENCE_PROBLEM`, `SCIENTIFIC_INVESTIGATION`, `ENGINEERING_DESIGN`, `MATHEMATICAL_MODELLING`, `DATA_ANALYSIS`, `COMPUTATIONAL_PROBLEM`, `INTERDISCIPLINARY_CHALLENGE` (plus EA-1's reading, writing, source, case, language types). Only `MATH_PROBLEM` is implemented.
- **`SCIENCE_INVESTIGATION` → `SCIENTIFIC_INVESTIGATION`.** EA-1 declared the former as a name only: no schema, no family, no data. It is now an alias (`FAMILY_TYPE_ALIASES`, `canonicalFamilyType`) of the canonical name. Nothing written under EA-1 used it.
- **`MATHEMATICAL_MODELLING` and `DATA_ANALYSIS`** are declared as types of their own only for tasks whose construct is the modelling or data-analysis *cycle itself*, typically across disciplines (discipline `TRANSVERSAL_STEM`). A task of one mathematical construct that requires formulating a model or reading data stays a `MATH_PROBLEM`; there, modelling and data analysis are *behaviours*, declared through the evidence target and `approachSupport`. The EA-1 modelling and data families keep their type, version and content.
- **`approachSupport`** (optional, additive): `{ transversalCompetencies[], participationModes[] }`. Absent on every EA-1 family, which stay valid and byte-identical; absent means "declares nothing" (no competency, individual only). It holds no approach id.
- **EA-1A versions** (`math-poc-families-ea1a.ts`, v`0.2.0-draft`) of three families add `approachSupport` and support for `SCHOOL_STEM_PERFORMANCE`. Same family id, concept, construct and evidence target — same invariant hash as the EA-1 version (asserted).
- **Science is declared-only.** No science family and no science discipline policy were written; both proofs of concept use mathematics.

## 5. Institution configuration

`Institution → CurriculumProfile → LearningApproachProfile` (`institution-configuration.ts`): `{ institutionKey, curriculumId, learningApproach: { approachId, version | null } | null }`.

`resolveEffectiveApproach(configuration, approaches)`:

| Situation | Effective approach | `source` |
|---|---|---|
| No institution (an individual learner) | STANDARD | `DEFAULT_NO_INSTITUTION` |
| Institution that configured none | STANDARD | `DEFAULT_NO_APPROACH_CONFIGURED` |
| Institution that configured one | that approach | `INSTITUTION_CONFIGURATION` |
| Configured approach does not exist | **error** `UNKNOWN_LEARNING_APPROACH` / `LEARNING_APPROACH_VERSION_NOT_FOUND` | never a silent STANDARD |

Backward compatible by construction: the approach is optional everywhere and its absence changes nothing. The four example compositions (MCCEMS + STANDARD, MCCEMS + STEM_PLUS, MEN + STANDARD, MEN + STEM_PLUS) resolve as expected.

### What the repository records (facts)

| Thing | What exists | Where |
|---|---|---|
| SEP (Mexico) | An education-authority organisation, country MX; three programmes: Primaria (Plan 2022), Secundaria (Plan 2022), **"Educación Media Superior — Marco Curricular Común (MCCEMS)"** with one subject "Pensamiento Matemático" → canonical subject `Matemáticas`, version "MCCEMS 2023" | `scripts/operations/seed-education-authorities.ts` (DEV seed; reference metadata) |
| MEN (Colombia) | An organisation, country CO; programme **"Estándares Básicos de Competencias y DBA"** with one subject "Matemáticas" → `Matemáticas`, version "EBC 2006 · DBA v2 2016"; two territorial Secretarías with their own programmes | same |
| Their structures | **Not imported**: every version is recorded with `source_locator = 'STRUCTURE_NOT_IMPORTED'`. No unit, no learning objective, no objective → concept mapping | same file's header |
| Grade ranges | MCCEMS 10–12; MEN EBC/DBA 1–11 | `20261030_1000_student_academic_profile_catalogue.sql` |
| As exam families | None. The taxonomy is `PAA, PISA, IB, CAMBRIDGE, AICE, ICFES`; SEP, MEN, MCCEMS are not in it | `exam-core/taxonomy.ts` |
| Institutions | `institutions`; `institution_curricula(institution_id, canonical_subject_id, base_academic_subject_id, base_structure_version_id, grade_id, programme_label, …)`; `institution_curriculum_concepts(curriculum_id, canonical_concept_id, classification, status)` | `20260920_1000…`, `20261018_1400_track_a_learning_plan_orchestrator.sql` |
| Learner profile | `student_academic_profile(country_of_study, curriculum_type, …)` | baseline |
| Learning approach | Nothing: no table, column, type or constant before this phase | — |

Consequence: a curriculum profile here is a reference with `structureStatus: STRUCTURE_NOT_IMPORTED`, and no concept can be shown to be *entitled* under MCCEMS or MEN.

### Curriculum entitlement

`resolveEntitlement(register, concept, curriculum)` — a recorded fact, like assessment applicability: basis `CURRICULUM_STRUCTURE_MAPPING`, `INSTITUTION_CURRICULUM_SELECTION` or `NONE`. The concept is matched by stable id and canonical subject; a structure mapping claimed for a structure that was never imported is not believed. The POC register is **empty**. Evidence-bearing content named for a curriculum requires entitlement (`CURRICULUM_ENTITLEMENT_NOT_ESTABLISHED`).

## 6. Multidimensional evidence (types only)

`ADAPTATION_EVIDENCE_FACETS`: `KNOWLEDGE, SKILL, COMPETENCY, CONTEXT, INDEPENDENCE, TRANSFER, LEARNING_APPROACH, ASSESSMENT_PROFILE` (and `RETENTION`, kept from EA-1, always null). `EvidenceFacetCarrier.LEARNING_APPROACH` = `{ approachId, version, transversalCompetencyCodes, participationMode, evidenceYield } | null`.

Names and shapes for a future B3 contract. No function scores, weighs, attributes or writes evidence. `AssessmentTaskFamily` and the transfer engine's `TransferTaskFamily` remain separate and unimported into each other.

## 7. SCHOOL_STEM_PERFORMANCE (design, illustrative)

A school's own STEM-style assessment that **pretends to be nothing else**.

- New rule authority **`INSTITUTION_POLICY`** `{ institutionKey, statement }`: names the institution that set the rule; has no `sources`; allowed only in a profile whose basis is `INSTITUTION_POLICY`; never in the profile of an exam system; never `OFFICIAL`.
- New basis **`INSTITUTION_POLICY`**: no OFFICIAL rule, no cited record, `examFamilyCode` must be null.
- The profile: `examFamilyCode: null`, `PROVISIONAL_ILLUSTRATIVE`, no components. Thirteen rules are StudyUs template policy; two (`stimulusExpectations`, `rubricStyle`) are `INSTITUTION_POLICY` attributed to an illustrative placeholder key, not a school. Formats include extended and short response; constructed responses are justified arguments; contexts are situated first; calculator allowed; its competency model is empty — the transversal competencies come from the approach it is composed with.
- Applicability of a concept to it is `NONE` today: an institution's assessment draws on the institution's curriculum, which the repository does not record for any example.

## 8. Proofs of concept

Artifact `EA1A_learning_approach_poc.json`; `npx tsx scripts/operations/ea1-adaptation-matrix.ts [--approach-poc | --write]`. Request: Practice, Standard band, `DEV_TEST_CONTENT`, Spanish. Families: `tf.math.proportion.rate-comparison-model` (concept `math.num.ratio-proportion`) and `tf.math.data.judge-claim-against-display` (`math.stat.data-representation`), both canonical subject `Matemáticas`. The approach comes from the institution configuration.

24 cells → **24 specifications, 0 refusals**.

### Mexico — MCCEMS

| Target | Family | STEM_PLUS changed (vs STANDARD) | Honoured | Overridden by (authority) |
|---|---|---|---|---|
| PAA.MATEMATICAS | rate model | context | context | format ← `paa.matematicas.response-formats` (**OFFICIAL**); tools ← `paa.matematicas.calculator` (**OFFICIAL**); stimulus ← family; depth ← `paa.reasoning` (StudyUs policy) |
| PAA.MATEMATICAS | claim vs display | context | context, stimulus | format (**OFFICIAL**); tools (**OFFICIAL**); depth (StudyUs policy) |
| PISA.MATHEMATICS | rate model | context | context, tools | format ← `pisa.mathematics.response-formats` (**OFFICIAL**); stimulus ← family; depth (StudyUs policy) |
| PISA.MATHEMATICS | claim vs display | context | context, tools, stimulus | format (**OFFICIAL**); depth (StudyUs policy) |
| SCHOOL_STEM_PERFORMANCE | rate model | format, depth, distractors | format, context, tools, depth | stimulus ← family |
| SCHOOL_STEM_PERFORMANCE | claim vs display | format, depth, distractors | all five | — |

### Colombia — MEN

| Target | Family | STEM_PLUS changed | Honoured | Overridden by (authority) |
|---|---|---|---|---|
| ICFES.SABER11_MATEMATICAS | rate model | context | context | format ← `icfes.saber11-matematicas.response-formats` (**OFFICIAL**); tools ← `…calculator` (**OFFICIAL**); stimulus ← family; depth (StudyUs policy) |
| ICFES.SABER11_MATEMATICAS | claim vs display | context | context, stimulus | format (**OFFICIAL**); tools (**OFFICIAL**); depth (StudyUs policy) |
| PISA.MATHEMATICS | both | as Mexico | as Mexico | as Mexico |
| SCHOOL_STEM_PERFORMANCE | both | as Mexico | as Mexico | as Mexico |

Unmet preferences across the 12 STEM_PLUS cells: **12 overridden by an OFFICIAL rule**, 8 by a StudyUs-policy profile rule, 6 by the family. Every preference of every cell is either honoured or unmet with its overrider.

### Side by side: the concept is not duplicated

| | Mexico | Colombia |
|---|---|---|
| Curriculum | `MX.SEP.MCCEMS` | `CO.MEN.EBC_DBA` |
| Concept (rate model) | `math.num.ratio-proportion` (Matemáticas) | **the same id and subject** |
| Concept (claim) | `math.stat.data-representation` (Matemáticas) | **the same** |
| Invariant hash per family | one | **the same one**, equal to the EA-1 version's |
| PISA.MATHEMATICS, same family and approach | specification A | specification B — identical variable dimensions, approach resolution, applicability and invariants; different id only because the curriculum context differs |
| Exam target | PAA: selected response, no calculator | Icfes: selected response, no calculator |
| School's own assessment | extended response, justified argument | the same |

One stable id and one invariant hash per family across two countries, two curricula, two approaches and four assessment targets. Nothing is keyed per approach, per curriculum or per exam.

### What the approach changed vs what the profile forced

- Against an exam (PAA, PISA, Icfes) the official rules leave STEM+ only the **context** to choose; format and (for PAA, Icfes) calculator are forced by OFFICIAL rules and recorded as such.
- In the school's own assessment STEM+ also obtains the **produced response** and the **justified argument** it prefers.
- The system competencies, marks, rubric, time budget and command term are the profile's under both approaches.

### Special cases (in the artifact)

| Case | Outcome |
|---|---|
| Collaborative activity, STEM_PLUS, school assessment, a family that declares it | Specification; `evidenceYield: GROUP_ARTEFACT_ONLY` |
| Collaborative under STANDARD / against PISA / with an individual-only family | `PARTICIPATION_MODE_NOT_ALLOWED` (three cases) |
| STEM_PLUS requires a situation outside exams; a family with none; school assessment | `LEARNING_APPROACH_REQUIREMENT_UNMET` |
| The same against PAA Matemáticas | Specification; the required preference recorded as unmet |
| Evidence-bearing content from these draft families | `FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT` |
| Dev-test content for FULL_MOCK_1 | `DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE` |

### Entitlement and applicability, honestly

- **Curriculum entitlement: NOT_ESTABLISHED in all 24 cells** (basis `NONE`, structure not imported). Nothing was invented; that is why every specification is `DEV_TEST_CONTENT`.
- **Assessment applicability:** 4 established by official exam structure (PAA), 4 by reviewed catalogue link (proportion on PISA), 16 not established (Icfes, the school's assessment, data-representation on PISA).

## 9. Locked rulings and where each is enforced

| Ruling | Enforced in | Test (`ea1a-…` unless noted) |
|---|---|---|
| Protected mock pools refuse `DEV_TEST_CONTENT`; frozen certified content only | `instance-lineage.ts` (`DEV_TEST_RULES`, `PROTECTED_MOCK_POOLS`); `adapt.ts` step 2c → `DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE` | "protected mock pools refuse DEV_TEST_CONTENT…"; EA-1 suite "LOCKED: a protected mock pool refuses…" |
| Diagnostic / Verification: dynamic dev-test only in non-evidence test execution | `instancePolicyFor`; `mayBearEvidence('DEV_TEST_CONTENT') === false` | same; EA-1 suite "instance policy per purpose x use class" |
| Provisional / illustrative assessment profiles → `DEV_TEST_CONTENT` only; evidence-bearing needs CERTIFIED | `profileMayFeedEvidenceBearingContent`; `adapt.ts` step 2b → `ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT` (system **and** component) | "a PROVISIONAL / ILLUSTRATIVE assessment profile…"; EA-1 suite "LOCKED: a PROVISIONAL…" |
| Component profiles are version-aware; an OFFICIAL rule needs the binding; a semantic key does not replace it | `AssessmentComponentProfileSchema.versionBinding` / `semanticComponentKey`; `OFFICIAL_RULE_NEEDS_A_VERSION_BINDING`; the specification carries the binding | "a component profile binds to a concrete exam / component version"; EA-1 suite "LOCKED: a component profile is version-aware" |
| No new stable key on `canonical_concepts` | nothing added; 82 migrations, none new | "no stable key was added to canonical_concepts…" |
| `DEV_TEST_CONTENT` ingestion only if five guarantees hold; otherwise deferred | nothing built; audit §10 → **DEFERRED** | same test (no ingestion call in the new code) |

Not named by the rulings and decided conservatively, flagged `CONSERVATIVE_READING`: `BENCHMARK`, `CALIBRATION` and `PILOT_CERTIFICATION` also refuse dev-test content.

### What changed in EA-1 behaviour and artifacts

- `instancePolicyFor(mock pool, DEV_TEST_CONTENT)` is no longer permitted; the earlier `READING_OF_DECISION` is gone.
- Evidence-bearing content additionally requires certified system and component profiles. With what the repository holds (draft families, provisional profiles) **no evidence-bearing specification can be produced at all**; the EA-1 tests that exercise that path now use explicit test doubles (a reviewed family, certified profiles).
- Component profiles carry `versionBinding` and `semanticComponentKey`; their version is `0.3.0-illustrative`. System profiles are unchanged (`0.2.0-illustrative`).
- **EA-1 matrix artifact** (`EA1_math_adaptation_matrix.json`): every count, refusal, applicability figure and pairwise result is unchanged; its requests are Practice, so the mock-pool ruling refuses none. The **36 system-level specification ids are unchanged**. The **51 component-level specification ids changed**, for one reason: each embeds the content hash of its component profile, and the version-binding ruling changed that content. No approach-related change touched them: with no approach or with STANDARD, all 110 EA-1 attempts give byte-identical results (asserted).
- `KNOWN_FAMILY_TYPES` gained six names and lost `SCIENCE_INVESTIGATION` (now an alias). `ADAPTATION_EVIDENCE_FACETS` gained `LEARNING_APPROACH`.
- The harness puts the approach (id, version, competencies, participation) into the prompt and the lineage only when a specification has one; without one the prompt is what it was. Cells and pilot v2 artifacts are untouched.

## 10. DEV_TEST_CONTENT ingestion audit

Question: can the existing architecture *guarantee* each condition for dev-test content if it were ingested into the Question Bank? Evidence is what the code and migrations contain today; nothing was built to change the answer.

| Guarantee | Verdict | Evidence |
|---|---|---|
| DEV / Stage isolation | **NOT PROVABLE** | Neither `question_bank_items` nor `approved_items` has an environment column. `environment` exists only on the factory **run log** (`20261026_1000_track_b_question_bank_factory.sql:39-44`; written at `factory.service.ts:118`). Database-fingerprint guards exist only in DEV scripts (`exam-core/dev-fixture-reset.ts:19,35,42`; `seed-education-authorities.ts`). Isolation today is "a different database", an operational fact, not a property of the content |
| Never `PILOT_ELIGIBLE` | **NOT PROVABLE** | `pilot-eligibility.ts:78` — `ELIGIBLE_PROVENANCE` includes `STUDYUS_GENERATED` and `STUDYUS_AUTHORED`; `:89` excludes only other provenances. Provenance has no dev-test value (`20261110_1000_qb_provenance_rights_content_sources.sql:33-34`). A generated item cannot be `FIXTURE` (`20261026_1000…:146`, `generated_is_studyus`) and provenance is immutable (`20261110_1000…:38-48`) |
| Never certified / approved | **NOT PROVABLE** | The approval guard checks reviewer, authorship, PRIMARY attribution, exam family and qualification (`20261112_1000_qb_review_requires_primary_attribution.sql`); it knows no use class. Once an APPROVED review exists, `question_bank_quality_guard` lets a generated version become `ACTIVE` (`20261110_1500…:199-204`) |
| Never in a protected mock pool | **NOT PROVABLE** | `question_bank_pool_membership_guard` enforces append-only and stimulus inheritance only (`20261110_1400_qb_pool_memberships.sql:37-56`); nothing distinguishes dev-test content |
| Never accidental Production release | **NOT PROVABLE** | Student delivery is decided by lifecycle and provenance (`question-bank/lifecycle.ts:180-187`). An approved dev-test item would be deliverable; only `FIXTURE` is excluded for Students (`:182`), and generated dev-test content is not `FIXTURE` |

What does exist: `FIXTURE` provenance is excluded from Student delivery and from pilot eligibility — but that is the mechanism for hand-made technical fixtures, and the schema forbids it for generated content.

**`DEV_TEST_CONTENT_INGESTION = DEFERRED`.** Dev-test content stays outside the Question Bank: specifications and, later, dynamic instances shown in DEV only. Making any guarantee provable needs a persisted use class and guard changes — a decision and a migration, not part of this phase.

## 11. Persistence design (revised; a design, nothing migrated)

This **supersedes** `DRAFT_AUXILIARY_ADAPTATION_PERSISTENCE_SKETCH.md` (the rejected draft: 15 tables and a view). Every table of the draft was revisited. Table and column names of existing objects were read from `database/migrations/`.

### Revised table list (20 tables, 1 view)

| # | Table | vs the draft | Why |
|---|---|---|---|
| 1 | `question_bank_task_families` | unchanged | |
| 2 | `question_bank_task_family_versions` | **changed**: content now includes `approachSupport` | Optional; a version without it is valid |
| 3 | `question_bank_task_family_concepts` | unchanged | FK → `canonical_concepts`; **no stable key is added to `canonical_concepts`** |
| 4 | `question_bank_task_family_competencies` | **new** | `(family_version_id, competency_id → competencies)`: the competencies a family can evidence are references into the existing competency table, never text |
| 5 | `assessment_system_profiles` | **changed**: `owner_institution_id uuid NULL → institutions(id)` | An `INSTITUTION_POLICY` profile belongs to an institution; CHECK: owner set ⇔ basis `INSTITUTION_POLICY` ⇒ `exam_family IS NULL` |
| 6 | `assessment_system_profile_versions` | **changed**: basis adds `INSTITUTION_POLICY`; `status` now **gates** evidence-bearing content | Locked ruling |
| 7 | `assessment_component_profiles` | **changed**: `component_key` is the *stable semantic key* only; the draft's direct `assessment_component_id` is removed from the identity | A stable key gives continuity and binds nothing |
| 8 | `assessment_component_profile_versions` | **changed**: version binding — `exam_version_id uuid NULL → exam_versions(id)`, `assessment_component_id uuid NULL → assessment_components(id)`, plus `binding_source`, `binding_config_key`, `binding_version_label`, `binding_component_key` as recorded; CHECK: any OFFICIAL rule ⇒ a binding is present; a bound `assessment_component_id` must belong to the bound `exam_version_id` | Locked ruling: official rules belong to a concrete exam / component version |
| 9 | `assessment_profile_rules` | **changed**: authority adds `INSTITUTION_POLICY`; `institution_id uuid NULL → institutions(id)`, required for that authority and forbidden otherwise | Provenance of an institution's rule is the institution; never confusable with OFFICIAL |
| 10 | `assessment_profile_rule_sources` | **changed**: a source row is refused on any non-OFFICIAL rule (StudyUs or institution policy) | |
| 11 | `assessment_discipline_policies` | unchanged | |
| 12 | `assessment_applicability_threshold_policies` | unchanged | |
| 13 | `assessment_applicability` | unchanged | |
| 14 | `assessment_applicability_evidence` | unchanged | Review state derives from `objective_concept_mappings.status / reviewed_by` |
| 15 | `learning_approach_profiles` | **new** | `(id, approach_key UNIQUE, display_name)`; a row for `STANDARD` is optional — absence of configuration already means STANDARD |
| 16 | `learning_approach_profile_versions` | **new** | `(approach_profile_id, version, status PROVISIONAL / CERTIFIED, content jsonb, content_hash, certified_by, certified_at)`; immutable once published |
| 17 | `learning_approach_competencies` | **new** | `(approach_version_id, competency_key, competency_id uuid NULL → competencies(id), proposed_code text NULL)`, exactly one of the two set. A version with any `proposed_code` cannot be `CERTIFIED`: the Curriculum creates the competency first |
| 18 | `institution_learning_approaches` | **new** | Sits **beside** `institution_curricula`, which is not altered: `(institution_id → institutions, institution_curriculum_id uuid NULL → institution_curricula, approach_version_id → learning_approach_profile_versions, set_by, set_at, retired_at)`; one active row per (institution, curriculum-or-null). **No row = STANDARD. No backfill** |
| 19 | `question_bank_adaptation_specifications` | **changed**: `learning_approach_version_id uuid NULL`; `academic_programme_id uuid NULL → academic_programmes` (curriculum reference); `component_profile_version_id` carries the binding; `content_use_class` restricted to `EVIDENCE_BEARING` | Dev-test ingestion is deferred, so no dev-test specification is persisted |
| 20 | `question_bank_item_task_family_lineage` | **changed**: `learning_approach_version_id uuid NULL`, `participation_mode`; `content_use_class` restricted to `EVIDENCE_BEARING`; CHECK `participation_mode = 'INDIVIDUAL'` | A collaborative activity is not individual evidence; dev-test content is not ingested |
| view | `assessment_component_rules_in_force` | unchanged | Inheritance for reads |

**Not a table: curriculum entitlement.** It is derived from rows that already exist — published `objective_concept_mappings` under the curriculum's structure version, and `institution_curriculum_concepts` (`status = 'ACTIVE'`) for an institution's own selection. A new table would duplicate them.

**Removed from the draft:** its migration 7's two dev-test branches (`question_bank_quality_guard`, `question_bank_pool_membership_guard`). With ingestion deferred there is no dev-test row for them to refuse. The attribution branch of `question_bank_item_concept_guard` (PRIMARY concept must be one of the family's) stays.

**Gating evidence-bearing content** (insert of a specification, by guard): family version `CERTIFIED` + reviewed; system and component profile versions `CERTIFIED`; applicability established; entitlement derivable when a curriculum is named; approach version (if any) — see open question 3.

**Evidence facets (learning approach)** are a B3 concern: the lineage row carries the approach version so that B3 can read it later; nothing is scored or stored for evidence now.

### Proposed migration split (placeholders; none created)

| # | Placeholder | Contents |
|---|---|---|
| 1 | `<date>_1000_assessment_system_component_profiles.sql` | tables 5–10 and the view; publish checks; version binding; institution authority |
| 2 | `<date>_1100_assessment_discipline_policies.sql` | table 11 |
| 3 | `<date>_1200_learning_approach_profiles.sql` | tables 15–17 |
| 4 | `<date>_1300_qb_task_families.sql` | tables 1–4 |
| 5 | `<date>_1400_assessment_applicability.sql` | tables 12–14 |
| 6 | `<date>_1500_institution_learning_approaches.sql` | table 18 |
| 7 | `<date>_1600_qb_adaptation_specifications.sql` | table 19 and its evidence-bearing guard |
| 8 | `<date>_1700_qb_item_task_family_lineage.sql` | table 20 and its guard |
| 9 | `<date>_1800_qb_primary_attribution_matches_task_family.sql` | one `CREATE OR REPLACE` of `question_bank_item_concept_guard()` |

All additive; 1–8 create tables nothing reads; 9 alone touches an existing function and affects only versions that have a lineage row. No content is seeded by a migration.

### Persistence open questions

1. **Version binding for syllabus records.** Cambridge 9709 is recorded as a generated syllabus record, not as an `exam_versions` row. Is the binding always an `exam_versions` / `assessment_components` FK (which requires such rows to exist first), or may it be the recorded text keys? The design allows both; one should be chosen.
2. **Granularity of the institution's approach.** Institution-wide with an optional per-curriculum override (the design), or also per class / grade / subject?
3. **May a PROVISIONAL learning approach feed evidence-bearing content?** The rulings gate assessment profiles; the approach is not gated in code.
4. **Institution-authored approaches.** The contract fixes `authority: STUDYUS_POLICY`; an institution's own approach would need an owner and its own authority value.
5. **Competency creation.** Five STEM+ competencies must be created by the Curriculum before any approach version can be certified; whether transversal competencies also attach to concepts (`canonical_concept_competencies`) is the Curriculum's call.
6. **Applicability of a concept to an institution's own assessment**: from `institution_curriculum_concepts`? Not modelled.
7. Carried from the draft: the link-evidence threshold; how the certified PAA Topic → concept relation is materialised; who reviews a task family; services and routes.

## 12. Limitations

1. Nothing is reviewed or certified. STEM+ content, the school profile and the families are in-session drafts.
2. Five of six STEM+ competencies do not exist in the catalogue.
3. Curriculum entitlement cannot be established for MCCEMS or MEN: their structures are not in the repository. Both POCs are dev-test only.
4. Mathematics only. No science family, no science discipline policy.
5. With draft families and provisional profiles, no evidence-bearing specification can be produced from anything the repository holds.
6. No question was generated; whether a generated instance honours an approach's emphasis is untested.
7. The competency count (eight) is from the repository's catalogue file, not from a database.
8. The component-level specification ids of the EA-1 matrix artifact changed (version binding).
9. The persistence design was not exercised against a database.

## 13. Unresolved architecture issues

Strictly: the target `EA-1A = PASS` and `READY_FOR_ADAPTATION_SCHEMA_IMPLEMENTATION = YES` holds only if none remains. These remain.

| # | Issue | Why it is architectural | Blocks schema? |
|---|---|---|---|
| U1 | The conflict rule for non-official profile rules (StudyUs / institution policy vs an approach preference) is this phase's policy, not the user's decision | It decides what STEM+ can change against every exam profile | No (code only), but needs confirmation |
| U2 | Version binding target for systems recorded as syllabus records (9709) | Shape of table 8 | **Yes** |
| U3 | Granularity of the institution's approach | Shape of table 18 | **Yes** |
| U4 | Whether a PROVISIONAL approach may feed evidence-bearing content | Gate on table 19 | **Yes** |
| U5 | Institution-authored approaches (authority, ownership) | Contract and tables 15–16 | Yes, if wanted in the first schema |
| U6 | How an individual component of a collaborative task becomes individual evidence | B3; the lineage CHECK assumes "collaborative is never ingested" | No, while B3 is not started |
| U7 | "An exam system is sat individually" is engine policy; profiles have no participation dimension | Where the rule should live | No |
| U8 | `BENCHMARK` / `CALIBRATION` / `PILOT_CERTIFICATION` refusing dev-test content is a conservative reading | Instance policy | No |
| U9 | AICE has no profile; 9709 sits under the AICE catalogue with a `CAMBRIDGE` profile (from EA-1) | Exam-family identity of a profile | Yes, for Cambridge / AICE profiles |
| U10 | Applicability of a concept to an institution's own assessment | No source is defined | No, for exam systems |

## 14. Proposed output fields

| Field | Proposed value | Basis |
|---|---|---|
| `LEARNING_APPROACH_PROFILE` | PASS | Contract, STANDARD by absence, engine integration, tests |
| `STEM_PLUS_PROFILE` | PARTIAL | Contract implemented; content PROVISIONAL and uncertified; 5 of 6 competencies not in the catalogue |
| `CURRICULUM_SEPARATION` | PASS | No STEM curriculum; approach and profile hold no knowledge; one concept id across curricula |
| `ASSESSMENT_PROFILE_SEPARATION` | PASS | Profiles hold no approach; official constraints win; preferences recorded |
| `TASK_FAMILY_INTEGRATION` | PASS | Seven STEM types declared; `approachSupport` additive; EA-1 families unchanged. Science not implemented, by instruction |
| `INSTITUTION_CONFIGURATION` | PASS (code) — granularity open (U3) | Pure contract and resolution, STANDARD default |
| `MULTIDIMENSIONAL_EVIDENCE_DESIGN` | PASS | Types and names only; no B3 scoring |
| `MEXICO_POC` | PARTIAL | Architecture demonstrated; entitlement NOT_ESTABLISHED; mathematics only |
| `COLOMBIA_POC` | PARTIAL | Same |
| `PERSISTENCE_DESIGN` | PARTIAL | Revised, 20 tables; U2–U5 open; not exercised |
| `EA-1A STATUS` | **PARTIAL** | Unresolved architecture issues remain (§13) |
| `READY_FOR_ADAPTATION_SCHEMA_IMPLEMENTATION` | **NO** | U2, U3, U4 (and U5, U9 where applicable) change table shapes or gates |

## 15. Verification

See the phase report for the TypeScript, unit-suite and build results. Suites: `tests/unit/ea1a-learning-approach.test.ts` (new) and `tests/unit/ea1-assessment-adaptation.test.ts` (updated only where a locked ruling changed behaviour).
