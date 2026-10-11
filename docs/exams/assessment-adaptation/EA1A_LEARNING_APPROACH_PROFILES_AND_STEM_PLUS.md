# EA-1A — Learning Approach Profiles & STEM+ overlay

Branch `feat/ea1a-learning-approach`, on EA-1 (`3031e03`). Pure code, tests and this design. No migration, no SQL file, no table, no route, no service, no database access, no network, no AI provider call, no ingestion, no question generated, nothing reviewed or approved. B2 is untouched; B3 scoring is not implemented.

Everything authored here is provisional: the STEM+ approach and the school STEM performance profile are StudyUs policy drafted in-session by the model working on the phase; the task families are `DRAFT` / `UNREVIEWED`; every assessment profile is `PROVISIONAL_ILLUSTRATIVE`. They test an architecture.

## 0. Orchestrator decisions (DECIDED 2026-10-11)

| # | Decision | Enforced in | Resolves |
|---|---|---|---|
| D1 | **Version binding is typed.** A rule / component binds to a versioned authoritative target: `EXAM_VERSION`, `SYLLABUS_VERSION`, `FRAMEWORK_VERSION` or `INSTITUTION_POLICY_VERSION`, preserving target type, identity, version and provenance. No fake exam-version record for Cambridge 9709: it binds to its syllabus version. An OFFICIAL rule still requires an authoritative binding. | `AuthorityVersionBindingSchema`, `officialBindingIssues` (`assessment-system-profile.ts`); `system-profiles.ts` | U2 |
| D2 | **Learning-approach granularity.** Institution default → Programme / Curriculum override → Class override → Subject override; the most specific applicable assignment wins; ONE scoped carrier; no assignment ⇒ STANDARD. | `LearningApproachAssignmentSchema`, `resolveLearningApproach` (`institution-configuration.ts`) | U3 |
| D3 | **A PROVISIONAL approach generates DEV_TEST_CONTENT only.** Evidence-bearing use requires a CERTIFIED approach or the implicit STANDARD. | `adapt.ts` step 2b′ → `LEARNING_APPROACH_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT` | U4 |
| D4 | **Institution-authored approaches: DEFERRED.** StudyUs-managed STANDARD and STEM_PLUS only; institutions select / assign, never author. | `authority: 'STUDYUS_POLICY'` literal, strict schema; no owner structure in the persistence design | U5 |
| D5 | **Assessment system identity is CAMBRIDGE.** AICE is programme / qualification context, not a separate generation profile. | `QUALIFICATION_CONTEXT_OF_EXAM_FAMILY`, `assessmentSystemOfExamFamily`, `systemProfileOfExamFamily`; cell bridge and harness resolve through it | U9 |
| D6 | **Rule precedence.** 1 OFFICIAL assessment rule; 2 CERTIFIED StudyUs / institution assessment-profile rule; 3 learning-approach preference. A provisional rule may not govern evidence-bearing content. Every override is recorded. | `adapt.ts` (`settle`): each unmet preference records the overriding rule's authority **and** its profile's certification status | U1 |
| — | **STEM competency readiness** is a Curriculum / Data gap, separate from the contract. | `catalogueReadinessOf` (pure); §2 "Future canonical catalogue work" | — |
| — | **Mexico / Colombia readiness**: architecture composition and evidence-bearing curriculum readiness are separate. | POC artifact `readiness[]` | — |
| — | **DEV test ingestion** stays DEFERRED until all five guarantees are provable. | §10 | — |

**PRE_CONTROL_PLANE_MERGE_EXCEPTION.** The EA-1 work was merged into the integration line (`3031e03`) by the working session before the Orchestrator's control plane was in force. That merge is kept and not reverted, and is recorded here as an exception. From EA-1A on there are no self-merges: this branch is an unmerged implementation candidate.

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

Rule precedence (D6, decided): **1** an OFFICIAL assessment rule; **2** a CERTIFIED StudyUs or institution assessment-profile rule; **3** a learning-approach preference.

- An OFFICIAL assessment constraint always wins over an approach preference.
- A certified StudyUs-policy or institution-policy profile rule also overrides a preference. An approach never widens what a profile, a family or a request allows.
- **A provisional rule may not govern evidence-bearing content.** A rule has no status of its own: it has its profile's. Evidence-bearing content is refused unless the system profile, the component profile and the approach are all CERTIFIED, so no provisional rule can reach it. For `DEV_TEST_CONTENT` provisional rules still shape the specification, and say so.
- A preference that could not be honoured is **never dropped silently**: the specification records it as unmet, with what was wanted, what was decided, the rule that overrode it, that rule's **authority** and its profile's **certification status** (`overridingRuleCertification`).
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

Participation: individual and collaborative. Status `PROVISIONAL`: the *contract* is implemented and tested; nobody has certified the *content*, so it is not marked certified. By D3 it therefore generates `DEV_TEST_CONTENT` only. By D4 it is StudyUs-managed: an institution assigns it and cannot author another.

Two things are judged separately:

- **STEM_PLUS_PROFILE_CONTRACT** — the approach contract and its integration: sound whatever the catalogue holds.
- **STEM_PLUS_CATALOGUE_READINESS** — data readiness, computed by `catalogueReadinessOf(approach, catalogueCodes)`: today **PARTIAL** (1 of 6 in the catalogue, 5 missing, no inconsistency).

#### Future canonical catalogue work (owner: Curriculum)

Not created here, and no parallel registry exists. To be added to `competencies` by the Curriculum, with the code proposed for each:

| Competency | Proposed code |
|---|---|
| Mathematical modelling | `studyus.transversal.mathematical-modelling` |
| Engineering design | `studyus.transversal.engineering-design` |
| Data and computational reasoning | `studyus.transversal.data-computational-reasoning` |
| Problem solving and transfer | `studyus.transversal.problem-solving-transfer` |
| Scientific communication and argumentation | `studyus.transversal.scientific-communication-argumentation` |

When one is created, the approach reference must move from `NOT_YET_IN_CATALOGUE` to `IN_CATALOGUE` in a new approach version; until then the readiness report lists the disagreement (`DECLARED_MISSING_BUT_PRESENT`) rather than promoting it silently.

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

### Scoped assignment (D2)

One carrier, `LearningApproachAssignment { assignmentId, institutionKey, scope { type, id }, approach { approachId, version | null } }`, and one resolver, `resolveLearningApproach(context, assignments, approaches)`, with `context = { institutionKey, programmeId?, classId?, subjectId? }`.

- Specificity, least to most: **INSTITUTION < PROGRAMME < CLASS < SUBJECT**. The most specific applicable assignment wins; the ones it beat are returned as `overridden`.
- An assignment applies when it is the context's institution and its scope id equals the context's id for that scope. A scope the context does not name cannot match.
- **Class vs subject, both applicable: SUBJECT wins** — the decided order. A subject's approach holds in every class of the institution, including a class with its own assignment.
- A more specific assignment may name `STANDARD`: an explicit opt-out.
- **Ambiguity is refused by name** (`AMBIGUOUS_LEARNING_APPROACH_ASSIGNMENT`): two assignments of one institution for the same scope type and id, even when they agree. Nothing else can tie — the scope types are totally ordered and a context has one id per scope. An ambiguity at a scope that does not apply to the context does not block it.
- No applicable assignment ⇒ `STANDARD` (`DEFAULT_NO_ASSIGNMENT`); no institution ⇒ `STANDARD` (`DEFAULT_NO_INSTITUTION`). An assigned approach that does not exist is an error.
- `resolveEffectiveApproach` (the institution-only form) is now implemented by the scoped resolver with a single INSTITUTION assignment; a test checks they agree.

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

### Two readiness notions (in the artifact, `readiness[]`)

| | Mexico (MCCEMS) | Colombia (MEN) |
|---|---|---|
| **Architecture composition POC** | **PASS** — 8 of 8 checks | **PASS** — 8 of 8 checks |
| **Evidence-bearing curriculum readiness** | **NO** | **NO** |

Architecture checks, computed from the cells: every cell produced a specification; one concept id per family; one invariant hash per family; the approach changes neither concept nor invariants; the approach moves only approach-controlled dimensions; every preference is honoured or recorded unmet; an official constraint overrode a preference and was recorded; STANDARD is recorded by absence.

Evidence-readiness blockers, derived from the data and identical in kind for both: curriculum structure not imported; curriculum entitlement not established (12 of 12 specifications); assessment applicability not established (Mexico 6 of 12, Colombia 10 of 12); task families not reviewed; assessment profiles not certified; STEM_PLUS not certified; STEM+ catalogue readiness PARTIAL. None is an architecture defect; none was worked around; no entitlement was fabricated.

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
| Profiles are version-aware; an OFFICIAL rule needs a typed authoritative binding (D1); a semantic key does not replace it | `AuthorityVersionBindingSchema` on the component (`versionBinding`) and, where a system holds an OFFICIAL rule, on the system; `OFFICIAL_RULE_NEEDS_A_VERSION_BINDING`, `OFFICIAL_RULE_NEEDS_AN_AUTHORITATIVE_BINDING`, `OFFICIAL_SOURCE_IS_NOT_OF_THE_BOUND_VERSION`; the specification carries the binding | "a component profile binds to a concrete exam / component version"; EA-1 suite "LOCKED: a component profile is version-aware" |
| No new stable key on `canonical_concepts` | nothing added; 82 migrations, none new | "no stable key was added to canonical_concepts…" |
| `DEV_TEST_CONTENT` ingestion only if five guarantees hold; otherwise deferred | nothing built; audit §10 → **DEFERRED** | same test (no ingestion call in the new code) |

Not named by the rulings and decided conservatively, flagged `CONSERVATIVE_READING`: `BENCHMARK`, `CALIBRATION` and `PILOT_CERTIFICATION` also refuse dev-test content.

### What changed in EA-1 behaviour and artifacts

- `instancePolicyFor(mock pool, DEV_TEST_CONTENT)` is no longer permitted; the earlier `READING_OF_DECISION` is gone.
- Evidence-bearing content additionally requires certified system and component profiles. With what the repository holds (draft families, provisional profiles) **no evidence-bearing specification can be produced at all**; the EA-1 tests that exercise that path now use explicit test doubles (a reviewed family, certified profiles).
- Component profiles carry a typed `versionBinding` and a `semanticComponentKey`; their version is `0.4.0-illustrative`. The Cambridge system profile, the one system profile with an OFFICIAL rule, gained its syllabus binding and is `0.3.0-illustrative`. The other four system profiles are unchanged (`0.2.0-illustrative`).
- **EA-1 matrix artifact** (`EA1_math_adaptation_matrix.json`): every count, refusal, applicability figure and pairwise result is unchanged; its requests are Practice, so the mock-pool ruling refuses none. Specification ids, against the accepted EA-1 artifact: the **27 system-level ids of PAA, IB, PISA and Icfes are unchanged**; the **9 system-level ids of Cambridge changed** (D1: its system profile gained the syllabus binding its OFFICIAL rule needs); the **51 component-level ids changed** (each embeds its component profile, whose binding was added by the locked ruling and then typed by D1). No approach-related change touched any of them: with no approach or with STANDARD, all 110 EA-1 attempts give byte-identical results (asserted).
- **EA-1A POC artifact** (`EA1A_learning_approach_poc.json`, now v2), against the first EA-1A cut (`c810e70`): **18 of 24 specification ids changed, 6 did not.** The 16 on exam targets (PAA, PISA, Icfes; both approaches) changed because their component profile's binding was typed. On the school profile, which did not change, the 2 STEM_PLUS specifications that have an unmet preference changed because an unmet preference now records `overridingRuleCertification`; the other 2 STEM_PLUS and the 4 STANDARD ones are byte-identical. Counts and outcomes are the same.
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

## 11. Persistence design (second revision; a design, nothing migrated)

No schema, no migration, no SQL file, no database. This revision applies D1–D6 and **minimises the table count** where one scoped or typed carrier can replace duplicated structures. It supersedes both the rejected draft (`DRAFT_AUXILIARY_ADAPTATION_PERSISTENCE_SKETCH.md`, 15 tables) and the first EA-1A revision (20 tables). Existing table and column names were read from `database/migrations/`.

### Table list: 15 tables, 1 view

| # | Table | Holds | Key constraints |
|---|---|---|---|
| 1 | `assessment_profiles` | ONE table for system and component profiles: `level` (`SYSTEM` / `COMPONENT`), `parent_profile_id` (component → its system), `profile_key` (unique; for a component this is the stable semantic key), `exam_family` (NULL for an institution's assessment), `owner_institution_id → institutions` (only for basis `INSTITUTION_POLICY`), `local_subject` | `level = 'SYSTEM'` ⇔ `parent_profile_id IS NULL`; a parent is a `SYSTEM` row (guard); no `AICE` profile — AICE is a qualification context (D5) |
| 2 | `assessment_profile_versions` | ONE version table: `profile_id`, `version`, `parent_version_id` (component version → the system version it overrides), `status`, `basis`, `component_dependent_dimensions`, the **typed authority binding** as columns (below), `content_hash`, `published_at`, certification | Immutable from `published_at`; publish checks (complete system rules, override ⊂ parent's dependent dimensions, no OFFICIAL fallback on a dependent dimension); an OFFICIAL rule ⇒ authoritative binding present (D1) |
| 3 | `assessment_profile_rules` | One row per rule of a version: `profile_version_id` (a single FK now), `dimension`, `value`, `authority` (`OFFICIAL` / `STUDYUS_POLICY` / `INSTITUTION_POLICY`), `assumption`, `institution_id → institutions` | Unique `(profile_version_id, dimension)`; `institution_id` set ⇔ `INSTITUTION_POLICY`; that authority only under an `INSTITUTION_POLICY` basis |
| 4 | `assessment_profile_rule_sources` | `(rule_id, source_key → assessment_sources.source_key, locator)` | Only on OFFICIAL rules; each OFFICIAL rule has ≥ 1 |
| 5 | `assessment_discipline_policies` | Versioned policy content | Insert-only |
| 6 | `learning_approach_versions` | ONE table for approaches: `approach_key`, `version`, `status` (`PROVISIONAL` / `CERTIFIED`), `content`, `content_hash`, certification; unique `(approach_key, version)` | StudyUs-managed only (D4): no owner, no authority column. `STANDARD` has **no row**: it is the absence of an approach |
| 7 | `learning_approach_assignments` | ONE scoped carrier (D2): `institution_id → institutions` (always), `scope_type`, and the scope as typed nullable FKs — `academic_programme_id → academic_programmes`, `class_id → classes`, `canonical_subject_id → canonical_subjects` — plus `approach_key`, `pinned_version_id → learning_approach_versions` (NULL = current), `set_by`, `set_at`, `retired_at` | CHECK: exactly the column of `scope_type` is set (none for `INSTITUTION`); **unique active row per (institution, scope type, scope id)** — the database cannot hold an ambiguous assignment; append-only (retire, never rewrite). No row ⇒ STANDARD; no backfill |
| 8 | `question_bank_task_families` | Stable identity, `family_type`, `canonical_subject_id` | unchanged |
| 9 | `question_bank_task_family_versions` | Content (incl. `approachSupport`), hashes, lifecycle, review | Content immutable; forward-only lifecycle |
| 10 | `question_bank_task_family_concepts` | `(family_version_id, canonical_concept_id → canonical_concepts)` | Same canonical subject as the family. **No stable key added to `canonical_concepts`** |
| 11 | `assessment_competency_references` | ONE shared reference table into `competencies`: `task_family_version_id` **or** `learning_approach_version_id` (exactly one), `competency_id → competencies` (NOT NULL) | A persisted reference always points at an existing competency; a competency not in the catalogue is not referenced — it is catalogue readiness (§2), and an approach version with any unresolved competency cannot be `CERTIFIED` |
| 12 | `assessment_applicability` | concept × profile (system or component) × basis | One active per scope; append-only |
| 13 | `assessment_applicability_evidence` | FK to `structure_nodes` or `objective_concept_mappings`, review state | Evidence is of the same concept; basis cannot exceed evidence |
| 14 | `question_bank_adaptation_specifications` | Content-addressed; `family_version_id`, `system_profile_version_id`, `component_profile_version_id`, `discipline_policy_id`, `learning_approach_version_id` (NULL = STANDARD), `academic_programme_id` (curriculum reference, NULL), `applicability_id`, `content` | Insert-only. Only `EVIDENCE_BEARING` specifications are persisted (ingestion of dev-test content is deferred). Insert guard: family version CERTIFIED and reviewed; both profile versions CERTIFIED; approach version CERTIFIED or NULL (D3); applicability established; entitlement derivable when a curriculum is named |
| 15 | `question_bank_item_task_family_lineage` | One optional row per `approved_items` version: `family_version_id`, `lineage_kind` (`GENERATED` / `AUTHORED`), `specification_id`, `learning_approach_version_id`, `parameterization_hash`, `variant_family_key` | Kind agrees with provenance; authored rows carry no generation field; individual participation only; legacy items have no row |
| view | `assessment_profile_rules_in_force` | Component version → inherited system rule or its own override, with origin | — |

**The typed authority binding (D1)** is columns of `assessment_profile_versions`, not a table: `binding_target_type` (`EXAM_VERSION` / `SYLLABUS_VERSION` / `FRAMEWORK_VERSION` / `INSTITUTION_POLICY_VERSION`), `binding_target_identity`, `binding_version`, `binding_component_key`, `binding_recorded_in`, and two optional precise references — `binding_exam_version_id → exam_versions`, `binding_structure_version_id → structure_versions` — plus `binding_institution_id → institutions` for an institution's policy version. The typed text triple is authoritative and always present for a bound version; a foreign key is added where the row exists (an exam version for PAA / IB / Icfes; the syllabus's structure version for Cambridge 9709). Nothing forces an `exam_versions` row to exist for a syllabus. Source provenance of the binding is the rule-source rows of the version's OFFICIAL rules (table 4).

**Not a table: curriculum entitlement** — derived from published `objective_concept_mappings` under the curriculum's structure version and from `institution_curriculum_concepts`. **Not a table: the applicability threshold policy** — a versioned StudyUs constant; a specification's content records the policy id and version it was resolved under.

### Merges made and rejected

| Structure | Decision | Reason |
|---|---|---|
| System profiles + component profiles → `assessment_profiles` | **Merged** (2 → 1) | Same columns but the parent. Lost as declarative constraints, kept by guard: "a component's parent is a system row". Gained: a single FK target for applicability, specifications and rules |
| System versions + component versions → `assessment_profile_versions` | **Merged** (2 → 1) | Same lifecycle, same immutability, same publish checks. Rules then need one FK instead of two nullable ones with an exclusive-or check |
| Per-kind binding columns / a separate bindings table → typed binding columns on the version | **Merged into the version** (no table) | The binding is 1 : 1 with a profile version and immutable with it; a separate table would add a join and a way for them to drift |
| `learning_approach_profiles` + `…_versions` + `learning_approach_competencies` → `learning_approach_versions` + shared references | **Merged** (3 → 1) | Two StudyUs-managed approaches, no institution authoring (D4): an identity table would hold two rows. `STANDARD` needs no row. Lost: an identity row to hang assignments on — assignments name `approach_key` and may pin a version |
| Family competencies + approach competencies → `assessment_competency_references` | **Merged** (2 → 1) | One meaning ("this version references this competency"), one FK target. Two typed nullable owner FKs with an exactly-one check keep full FK precision |
| `institution_learning_approaches` → `learning_approach_assignments` | **Replaced** (1 → 1, four scopes) | D2. One row shape for institution, programme, class and subject; a partial unique index makes ambiguity unrepresentable |
| `assessment_applicability_threshold_policies` | **Removed** (1 → 0) | A StudyUs constant with one row; recorded by id and version inside each specification |
| Scope as one polymorphic `scope_id` | **Rejected** | It would lose the foreign keys to `academic_programmes`, `classes` and `canonical_subjects`; typed nullable columns in the same single table keep them |
| Rules as `jsonb` on the version | **Rejected** | Loses "one rule per dimension" as an index, the per-rule authority check and the FK from rule sources |
| Rule sources as a `text[]` on the rule | **Rejected** | Loses the FK to `assessment_sources`: an OFFICIAL rule could cite a source that does not exist |
| Family identity + family versions | **Rejected** | Many families; the identity carries the subject FK once, retirement, and the stable key items trace to across versions |
| Family concepts into the shared reference table | **Rejected** | Different FK target (`canonical_concepts`) and a subject-consistency guard that competencies do not have |
| Applicability evidence as `jsonb` | **Rejected** | The FKs to `structure_nodes` / `objective_concept_mappings` are the point: evidence must be a real mapping row |
| Specifications into lineage | **Rejected** | One specification serves many items; it is content-addressed and insert-only on its own |
| Institution-authoring structures; an AICE profile | **Not created** | D4, D5 |

### Counts and delta

| | Rejected draft | First EA-1A revision | This revision |
|---|---|---|---|
| Tables | 15 | 20 | **15** |
| Views | 1 | 1 | **1** |
| Placeholder migrations | 7 | 9 | **8** |

Against the 20-table version (delta −5 tables, 0 views, −1 placeholder migration):

- −2: system and component profiles and their versions, 4 tables → 2;
- −2: approach identity, approach versions and approach competencies, 3 tables → 1 (`learning_approach_versions`); the approach's competency references move into the shared reference table, which takes the place of the family-competency table (1 → 1);
- −1: the applicability threshold-policy table is removed;
- 0: `institution_learning_approaches` is replaced one for one by `learning_approach_assignments`.

20 − 2 − 2 − 1 = 15. It is the same count as the rejected draft with a larger scope (learning approaches, scoped assignments, institution authority, typed bindings). One placeholder fewer because the approach tables and the assignment carrier ship together.

### Placeholder migrations (none created)

| # | Placeholder | Contents |
|---|---|---|
| 1 | `<date>_1000_assessment_profiles.sql` | tables 1–4 and the view |
| 2 | `<date>_1100_assessment_discipline_policies.sql` | table 5 |
| 3 | `<date>_1200_learning_approaches.sql` | tables 6–7 |
| 4 | `<date>_1300_qb_task_families.sql` | tables 8–11 (the shared references need 3 and this) |
| 5 | `<date>_1400_assessment_applicability.sql` | tables 12–13 |
| 6 | `<date>_1500_qb_adaptation_specifications.sql` | table 14 and its evidence-bearing guard |
| 7 | `<date>_1600_qb_item_task_family_lineage.sql` | table 15 and its guard |
| 8 | `<date>_1700_qb_primary_attribution_matches_task_family.sql` | one `CREATE OR REPLACE` of `question_bank_item_concept_guard()` |

All additive; 1–7 create tables nothing reads; 8 touches one existing function and only for versions with a lineage row. No content is seeded by a migration. No guard is added for dev-test content: its ingestion is deferred.

## 12. Limitations

1. Nothing is reviewed or certified. STEM+ content, the school profile and the families are in-session drafts.
2. STEM+ catalogue readiness is PARTIAL: five of six competencies are not in the catalogue.
3. Evidence-bearing curriculum readiness is NO for Mexico and Colombia: structures are not in the repository.
4. Mathematics only. No science family, no science discipline policy.
5. With draft families, provisional profiles and a provisional approach, no evidence-bearing specification can be produced from anything the repository holds; that path is exercised with test doubles only.
6. No question was generated.
7. The competency count (eight) is from the repository's catalogue file, not from a database.
8. Specification ids of the artifacts changed again with the typed binding (§9).
9. The persistence design was not exercised against a database.

## 13. Open questions, classified

### U1–U10 of the first cut, re-dispositioned

| # | Was | Disposition |
|---|---|---|
| U1 | Conflict rule for non-official rules was this phase's policy | **RESOLVED by D6.** Certified StudyUs / institution rules override a preference; provisional rules govern dev-test content only; every override records authority and certification status |
| U2 | Version-binding target for syllabus-record systems | **RESOLVED by D1.** Typed binding; Cambridge 9709 binds to `SYLLABUS_VERSION 9709 / 2026-2027`; PISA to `FRAMEWORK_VERSION pisa-math / 2022` |
| U3 | Granularity of the institution's approach | **RESOLVED by D2.** One scoped assignment carrier, four scopes, most specific wins, ambiguity refused |
| U4 | PROVISIONAL approach and evidence-bearing content | **RESOLVED by D3.** Refused by name |
| U5 | Institution-authored approaches | **DEFERRED BY DECISION (D4).** Not in the contract, not in the persistence design |
| U6 | Individual component of a collaborative task | **DEFERRED BY DECISION** (B3 is not implemented in this phase). Collaborative activity is never evidence-bearing and never ingested |
| U7 | "An exam system is sat individually" is engine policy | **IMPLEMENTATION DETAIL.** A StudyUs policy constant in the engine; no table depends on it |
| U8 | Benchmark / calibration / pilot certification refuse dev-test content | **IMPLEMENTATION DETAIL.** A conservative policy constant, flagged `CONSERVATIVE_READING`; no table depends on it |
| U9 | AICE vs Cambridge | **RESOLVED by D5.** AICE resolves to the CAMBRIDGE system as qualification context |
| U10 | Applicability of a concept to an institution's own assessment | See A1 below |

### Everything still open

| # | Question | Class | Why |
|---|---|---|---|
| A1 | What establishes applicability of a concept for an **institution's own assessment** (`SCHOOL_STEM_PERFORMANCE`)? Today: nothing, so it is `NONE` | **ARCHITECTURE DECISION — but outside the first schema** (see note) | A third applicability basis (the institution's own curriculum selection) would be a new value and one nullable FK on tables 12–13 |
| I1 | PROGRAMME scope target: `academic_programmes` (proposed) or `institution_curricula` | IMPLEMENTATION DETAIL | The pure carrier holds an opaque scope id; either FK fits table 7 |
| I2 | SUBJECT scope target: `canonical_subjects` (proposed, as `institution_curricula` uses) or `academic_subjects` | IMPLEMENTATION DETAIL | Same |
| I3 | Which bindings also carry a precise FK (`exam_versions`, `structure_versions`) | IMPLEMENTATION DETAIL | The typed text triple is authoritative; the FK is optional by design |
| I4 | `version: null` in an assignment — "current" means latest certified, or latest | IMPLEMENTATION DETAIL | Resolver rule |
| I5 | Threshold for catalogue-link evidence once mapping reviewers are persisted | IMPLEMENTATION DETAIL | A policy constant |
| I6 | Which qualification certifies a task family | IMPLEMENTATION DETAIL (a guard rule; to be set before the first family is certified, not before the schema) | Table 9 already holds reviewer and review columns |
| I7 | U7, U8 above | IMPLEMENTATION DETAIL | Policy constants |
| I8 | Services and routes that write these tables | IMPLEMENTATION DETAIL | Not designed here |
| R1 | Five STEM+ competencies missing from the catalogue | DATA / CATALOGUE READINESS | Curriculum work (§2) |
| R2 | MCCEMS and MEN structures and concept mappings | DATA / CATALOGUE READINESS | Curriculum import |
| R3 | How the certified PAA Topic → concept relation is materialised as rows | DATA / CATALOGUE READINESS | Needed by official-structure evidence, not by table shape |
| R4 | No reviewed family, no certified profile, no certified approach | DATA / CATALOGUE READINESS | Review work |
| X1 | Institution-authored approaches | DEFERRED BY DECISION | D4 |
| X2 | DEV_TEST_CONTENT ingestion | DEFERRED BY DECISION | §10 |
| X3 | Independence, the individual component of group work, relating AssessmentTaskFamily and TransferTaskFamily | DEFERRED BY DECISION | B3 |

**Note on A1, stated plainly.** It is the one question that is architectural rather than a detail, and no decision covers it. It does **not** shape any of the 15 tables: applicability for exam systems is complete without it, the school profile is an uncertified design that can produce dev-test content only, and adding a basis later is additive (one enum value, one nullable FK). So it cannot honestly be called a blocker of the first schema — but it also cannot be settled as an implementation detail, because it decides *what counts as evidence that an institution may assess a concept*. The proposed readiness value below assumes the Orchestrator classifies A1 as deferred with the institution-assessment profile; if instead it must be in the first schema, readiness is NO until it is decided.

## 14. Proposed output fields

| Field | Proposed value | Basis |
|---|---|---|
| `EA-1A STATUS` | **PASS** (architecture), subject to the A1 classification | D1–D6 applied and tested; no blocking architecture decision remains for the first schema |
| `LEARNING_APPROACH_PROFILE` | PASS | Contract, STANDARD by absence, engine integration, certification gate (D3), StudyUs-managed (D4) |
| `STEM_PLUS_PROFILE_CONTRACT` | PASS | Written against the contract; valid; composes with every assessment target. Content `PROVISIONAL`, uncertified |
| `STEM_PLUS_CATALOGUE_READINESS` | **PARTIAL** | 1 of 6 competencies in the catalogue; 5 are future Curriculum work |
| `CURRICULUM_SEPARATION` | PASS | No STEM curriculum; approach and profile hold no knowledge; one concept id across curricula |
| `ASSESSMENT_PROFILE_SEPARATION` | PASS | Profiles hold no approach; precedence D6; every override recorded with authority and certification |
| `TASK_FAMILY_INTEGRATION` | PASS | Seven STEM types declared; `approachSupport` additive; EA-1 families unchanged |
| `INSTITUTION_CONFIGURATION` | PASS | Scoped assignment carrier and resolver (D2), STANDARD fallback, ambiguity refused |
| `MULTIDIMENSIONAL_EVIDENCE_DESIGN` | PASS | Types and names only; no B3 scoring |
| `MEXICO_ARCHITECTURE_POC` | PASS | 8 of 8 composition checks |
| `MEXICO_EVIDENCE_READINESS` | **NO** | Structure not imported; entitlement 0 of 12; nothing reviewed or certified |
| `COLOMBIA_ARCHITECTURE_POC` | PASS | 8 of 8 composition checks |
| `COLOMBIA_EVIDENCE_READINESS` | **NO** | Same |
| `PERSISTENCE_DESIGN` | PASS as a design | 15 tables, 1 view, 8 placeholder migrations; merges justified. Not exercised against a database, by instruction |
| `DEV_TEST_CONTENT_INGESTION` | **DEFERRED** | None of the five guarantees is provable today (§10) |
| `READY_FOR_ADAPTATION_SCHEMA_IMPLEMENTATION` | **YES, if A1 is classified as deferred; otherwise NO** | A1 is the only architecture question left; it touches none of the 15 tables |

## 15. Verification

See the phase report for the TypeScript, unit-suite and build results. Suites: `tests/unit/ea1a-learning-approach.test.ts` and `tests/unit/ea1-assessment-adaptation.test.ts`.
