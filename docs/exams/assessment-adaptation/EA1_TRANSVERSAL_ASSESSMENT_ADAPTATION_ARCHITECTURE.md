# EA-1 — Transversal Assessment Adaptation Architecture

Branch `feat/ea1-assessment-adaptation`, on the integration line after QB-R2C (`e45a858`). A pure domain model, a proof-of-concept data module, tests and this design. No migration, no table, no route, no service that writes, no database access, no network, no AI provider call, no question generated, nothing reviewed or approved. Kognity was not accessed.

Everything authored in this phase is a draft: the ten task families are `DRAFT` / `UNREVIEWED`, the five profiles are `PROVISIONAL_ILLUSTRATIVE`, the mathematics policy is `PROVISIONAL`. They were written in-session by the model working on the phase. They test an architecture; they are not a catalogue to produce from and not a description of how any examination board works.

## 1. The architecture

```
Canonical Knowledge  →  AssessmentTaskFamily  →  AssessmentSystemProfile  →  DisciplineAdaptationPolicy
   →  AdaptationSpecification  →  GenerationRequest / generateCandidates  →  validated QuestionCandidate
   →  B2 selection  →  B3 evidence
```

Four separations the code keeps apart:

| Separation | One side | Other side | How it is enforced |
|---|---|---|---|
| Knowledge vs how it is asked | Canonical concept (Curriculum) | Task family, profile | A family references a certified stable id; the profile schema is strict and has no field for a concept |
| How a system asks vs what that means in a discipline | Profile (generic words) | Discipline policy | The profile holds no discipline rule; the policy names no exam |
| Invariant vs variable | PRIMARY concept, construct, evidence target (hashed) | Twelve compared dimensions, each with provenance | `invariantHash`, `invariantsPreserved`, named refusal `INVARIANT_CHANGE_REQUESTED` |
| Specification vs instance | Immutable generation input | Content with every gate still to pass | A specification holds no stem, option or answer; `NOT_ESTABLISHED_BY_ADAPTATION` |

### Placement and dependency direction

| Directory | Owner | Holds | Imports |
|---|---|---|---|
| `src/lib/exam-core/question-bank/task-families/` | Question Bank | Family contract, specialisation registry, `MATH_PROBLEM`, the ten POC families, demand analysis | `zod` only |
| `src/lib/assessment-adaptation/` | Shared assessment architecture | Profile contract and five profiles, discipline policy, specification, engine, instance lineage and carriers, cell bridge, POC matrix | the task-family contract, the exam-family taxonomy |
| `src/lib/exam-core/question-bank/production/` (two files edited) | Question Bank | Optional adaptation lineage; optional specification input of the harness | the adaptation specification and lineage schemas |

Direction: `production → assessment-adaptation → task-families`. Nothing points back. The engine does not import the Production OS (an existing guard forbids the string `question-bank/production/` anywhere in `src` outside that directory), so the canonical-JSON hash is restated in `canonical-hash.ts` and a test proves it equals the harness's; the cell bridge and the demand analysis read a structural view of a cell. The 865 demand is joined to the cells in `scripts/operations/ea1-paa-evidence-demand.ts`, outside `src`.

No existing guard was weakened and no expected list of an existing test was changed: the production file list (23 + 4), the foundation module list and the B2 lists are as they were.

### Naming: `AssessmentProfile` already exists

`src/lib/assessment-profiles.ts` (Phase 3B) exports `AssessmentProfile`, `ASSESSMENT_PROFILES` and `getAssessmentProfile`: the verification settings of the `CUMULATIVE_ASSESSMENT` and `MOCK_EXAM` activity types (strictness, grading-confidence floor, timer flag). It is imported by `src/services/assessment-verification.service.ts`. It is unrelated to the brief's concept. The new type is therefore `AssessmentSystemProfile`, in its own directory; the old file is not imported, changed or shadowed, and a test asserts all three.

A second near-collision: B1 has `EVIDENCE_DIMENSIONS` (the journey dimension an activity is run for). The dimensions B3 could later carry are named `ADAPTATION_EVIDENCE_FACETS` here.

A third, and the one that matters for B3: the Learning Engine already has a **transfer task family** (Phase 7). `computeTransferTaskFamilyId` (`src/lib/transfer-task-identity.ts`) derives a hash from a learner's transfer task (source concept, distance, modality, novelty dimensions, target concepts, context domain); it is persisted as `transfer_task_instances.task_family_id`, and `transfer-policy` already uses it for one independence rule (ROBUST transfer needs a later success in a *different* task family). That family is derived per generated task and lives in the learner store; an EA-1 task family is authored, versioned and lives in the Question Bank. EA-1 does not import, reuse or change it, and the proposed tables are prefixed `question_bank_` so that no column named `task_family_id` means two things. When B3 defines independence, it has to reconcile the two notions rather than add a third.

## 2. Domain concepts

### 2.1 AssessmentTaskFamily (`task-families/task-family.ts`)

A reusable way of eliciting evidence; not a question.

| Field | Content |
|---|---|
| `familyId`, `version` | `tf.<…>`, never an exam's name; a change of anything an adaptation reads is a new version |
| `familyType` | String resolved by a registry of specialisations |
| `canonicalSubject`, `primaryConcepts` | Certified stable id + canonical (subject, name); every concept must be of the family's subject |
| `targetSkills`, `targetCompetencies` | Names of the curated learning catalogue |
| `evidenceTarget` | `{ actions[], object, observablePerformance }`; actions from `RECALL, COMPUTE, SOLVE, REPRESENT, FORMULATE, INTERPRET, EVALUATE, JUSTIFY` |
| `supportedContexts` | `ABSTRACT, PERSONAL, OCCUPATIONAL, SOCIETAL, SCIENTIFIC` |
| `difficultyLevers` | `{ lever, kind, description }`, kind in `NUMERIC, STEPS, REPRESENTATION, CONTEXT_LOAD, ABSTRACTION` |
| `commonMisconceptions` | Statements |
| `responseConstraints` | Allowed elicitation formats, stimulus need and kinds |
| `profileSupport` | Per profile id: `SUPPORTED` / `SUPPORTED_WITH_CONSTRAINTS{constraints}` / `UNSUPPORTED{reason}` — assessment-behaviour fit |
| `canonicalKnowledgeAvailability` | Per profile id: `CERTIFIED_FOR_THIS_EXAM_FAMILY` / `CATALOGUE_LINK_RECORDED` / `NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY` — a fact read from the repository |
| `provenance` | `authoredBy: STUDYUS`, authoring kind, date, reference sources, `containsCopiedProtectedExpression: false` |
| `lifecycle`, `reviewStatus` | `DRAFT / IN_REVIEW / CERTIFIED / RETIRED`; `UNREVIEWED / IN_REVIEW / REVIEWED`; `CERTIFIED` requires `REVIEWED` |
| `specialization` | Validated by the registered schema of `familyType` |

Constraints are machine-checkable (`RESPONSE_FORMAT_ONLY`, `CONTEXT_ONLY`, `DIFFICULTY_ONLY`, `CALCULATOR_ONLY`) and may only narrow what the family allows.

**Discipline specialisation.** `createTaskFamilyRegistry([...])` returns a value; `registry.with(spec)` returns a new one. `MATH_PROBLEM` is implemented (`math-problem.ts`): mathematical structure and construct, variables, parameter ranges, relationships, constraints, valid-solution rules, misconception models, numerical difficulty levers, calculator dependency. `SCIENCE_PROBLEM`, `SCIENCE_INVESTIGATION`, `READING_ANALYSIS`, `WRITING_EDITING`, `SOURCE_ANALYSIS`, `CASE_ANALYSIS`, `LANGUAGE_USE` are declared in `KNOWN_FAMILY_TYPES` with their intended fields and have no schema; a family of one is refused (`FAMILY_TYPE_NOT_REGISTERED`). A test registers a throwaway `READING_ANALYSIS` schema, validates a family of it and adapts it with a throwaway policy, without touching the common schema or the engine.

A specialisation exposes four facts to the engine and nothing else: the invariant construct, the tool dependency, the parameterisation, the misconception-model ids.

### 2.2 AssessmentSystemProfile (`assessment-adaptation/assessment-system-profile.ts`)

How an assessment system expects evidence to be elicited. `profileId`, `version`, `examFamilyCode` (taxonomy or null), `status` (`PROVISIONAL_ILLUSTRATIVE` / `CERTIFIED` with a certification), `specification` (basis + the repository records the official rules were read from) and fifteen rules:

`responseFormats`, `timePressure`, `commandTerms`, `markStructure`, `reasoningDepth`, `contextExpectations`, `calculatorPolicy`, `stimulusExpectations`, `responseLength`, `rubricStyle`, `competencyEmphasis`, `competencyElicitation`, `transferExpectations`, `authenticityRequirements`, `blueprintConstraints`.

Every rule is `{ ruleId, value, authority }`. `OFFICIAL` requires at least one `{ sourceKey, locator }`; the schema refuses it otherwise, refuses a source the profile's own records do not declare, and refuses any OFFICIAL rule under `NO_CERTIFIED_SPECIFICATION`. `STUDYUS_POLICY` requires `provisional: true` and an assumption statement. `competencyElicitation` (which actions elicit each of the system's competencies) is always StudyUs policy.

### 2.3 DisciplineAdaptationPolicy (`discipline-policy.ts`)

`policyId`, `version`, `discipline`, `familyTypes`, `authority: STUDYUS_POLICY`, `status`; the three invariant dimensions (all mandatory); the variable dimensions; format preference; the meaning of each reasoning depth; what each tool policy does to an instance's numbers; which lever kinds may be pulled and when; what transfer requires; command terms by lead action; the distractor rule. Only `MATHEMATICS` for `MATH_PROBLEM` exists.

### 2.4 AdaptationSpecification (`adaptation-specification.ts`, `adapt.ts`)

`adapt({ family, profile, disciplinePolicy, request })` returns a deep-frozen specification or a named refusal. Content: family, profile and policy identity and version; PRIMARY concept; canonical-knowledge availability; skills and competencies; `invariants` + `invariantHash`; `variable` (context with authenticity and transfer, response format with its production format, reasoning depth, command term, stimulus, system competencies, time budget, mark structure, rubric style, tool policy, numeric profile, distractors, difficulty, levers, language); `parameterization`; purpose with pool and minimum instance class; optional requirement-cell link; `provenance` for all fifteen variable dimensions; `lineage` with the content hashes of the three inputs and the request; `adaptedAt` (passed in, not identity). `specificationId` is the sha256 of the canonical JSON without the id and the timestamp.

Refusals (all tested): `FAMILY_INVALID`, `FAMILY_TYPE_NOT_REGISTERED`, `PROFILE_INVALID`, `DISCIPLINE_POLICY_INVALID`, `REQUEST_INVALID`, `FAMILY_RETIRED`, `DISCIPLINE_POLICY_NOT_FOR_FAMILY_TYPE`, `INVARIANT_CHANGE_REQUESTED`, `PROFILE_SUPPORT_NOT_DECLARED`, `PROFILE_UNSUPPORTED_BY_FAMILY`, `SUPPORT_CONSTRAINT_VIOLATED`, `CANONICAL_KNOWLEDGE_NOT_CERTIFIED_FOR_EXAM_FAMILY`, `RESPONSE_FORMAT_NOT_ALLOWED`, `CONTEXT_NOT_ALLOWED`, `PROFILE_REQUIRES_CONTEXT_FAMILY_CANNOT_PROVIDE`, `PROFILE_REQUIRES_TRANSFER_FAMILY_CANNOT_PROVIDE`, `TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE`, `TOOL_POLICY_NOT_ALLOWED_BY_PROFILE`, `STIMULUS_REQUIRED_BY_FAMILY_NOT_OFFERED_BY_PROFILE`, `COMMAND_TERM_NOT_IN_PROFILE_VOCABULARY`, `PROFILE_COMPETENCY_NOT_ELICITED`.

The family's own declaration decides first, but it is not the only guard: a family that over-claims `SUPPORTED` is still refused by the structural checks.

### 2.5 Instance lineage, instance class and the carriers (`instance-lineage.ts`)

- `AdaptationLineage`: family, profile and policy id + version, specification id, invariant hash, generation run. Optional everywhere; absent on legacy, fixed, official and licensed content.
- `DYNAMIC` vs `CERTIFIED_FROZEN`, and `minimumInstanceClassFor(purpose)`: Practice and low-stakes reinforcement accept dynamic; Reduced Mock, Full Mocks, benchmark, calibration and pilot certification require frozen (brief); Diagnostic and Verification require frozen as a conservative default the brief does not fix.
- `PROMOTION_PATH`: automated validation → originality → rights → human review → attribution → pool assignment. A description of the existing gates and their owners; it adds, removes and relaxes none.
- `InstanceIndependenceCarrier`, `SiblingRelationship`, `ExposureRelationship`, `EvidenceFacetCarrier`: types only.

## 3. Ownership matrix

| Thing | Owner | Reads it | Notes |
|---|---|---|---|
| Canonical concepts, subjects | Curriculum | everyone, by reference | Never created or re-keyed here |
| Task families and their versions | Question Bank | adaptation engine, production | |
| Assessment-system profiles and versions | Shared assessment architecture | adaptation engine | Official facts stay owned by the exam configuration they are read from |
| Discipline adaptation policies | Shared assessment architecture (with discipline specialists) | adaptation engine | StudyUs policy |
| Adaptation specifications | Transversal adaptation engine (produces); Question Bank (stores with the generation run) | generation harness | Immutable |
| Question-instance lineage | Question Bank | B2, B3 (later) | Optional, additive |
| Independence carrier | Shared assessment architecture (contract); Question Bank (facts) | B2, B3 | Types only today |
| Selection | B2 | — | Unchanged; does not import adaptation |
| Evidence | B3 | — | Not implemented; nothing here writes or weighs evidence |

## 4. Persistence design (a design; nothing migrated)

Do not migrate before the open decisions of §11 are taken: two of them change table shape.

| Entity | Durable? | Why | Owner | Shape (sketch) | Immutability / versioning |
|---|---|---|---|---|---|
| AssessmentTaskFamily | Yes | Identity must outlive code releases; instances reference it | Question Bank | `question_bank_task_families(id uuid pk, family_key text unique, family_type text, canonical_subject_id → canonical_subjects, lifecycle, created_by, created_at)` | Row is the stable identity; content lives in versions |
| Family version | Yes | An instance must point at the exact content it was generated from | Question Bank | `question_bank_task_family_versions(id, family_id →, version text, content jsonb, content_hash char(64), review_status, reviewed_by, reviewed_at, unique(family_id, version))`; `question_bank_task_family_concepts(family_version_id →, canonical_concept_id → canonical_concepts, role = 'PRIMARY')` | Content immutable once any instance references it (trigger); lifecycle moves forward only; `CERTIFIED` requires a review row |
| AssessmentSystemProfile | Yes, once certified | Rules need review history; illustrative ones can stay in code | Shared architecture | `assessment_system_profiles(id, profile_key unique, exam_family text null)` | |
| Profile version | Yes | Same reason as family versions | Shared architecture | `assessment_system_profile_versions(id, profile_id →, version, status, rules jsonb, content_hash, certified_by, certified_at)`; `assessment_system_profile_rule_sources(profile_version_id →, rule_id, source_key → assessment_sources.source_key, locator)` | Immutable; an OFFICIAL rule without a source row is rejected by constraint |
| DisciplineAdaptationPolicy | Yes, versions only | Small; needs audit | Shared architecture | `assessment_discipline_policies(id, policy_key, version, discipline, family_types text[], status, content jsonb, content_hash, unique(policy_key, version))` | Immutable |
| AdaptationSpecification | Yes, when an instance was generated from it | Reproducibility: the specification is part of the prompt hash | Question Bank (generation) | `question_bank_adaptation_specifications(specification_id char(64) pk, family_version_id →, profile_version_id →, policy_id →, invariant_hash char(64), content jsonb, created_at)` | Content-addressed and insert-only; the id is the hash, so a duplicate insert is a no-op |
| QuestionInstance lineage | Yes | B2/B3 need it; cannot be recomputed | Question Bank | `question_bank_item_adaptation(approved_item_id → approved_items pk, specification_id →, family_version_id →, parameterization_hash char(64) null, variant_family_key text null, instance_class text)` | Insert-only; one row per item version |

**Legacy items.** The lineage is a separate table keyed by item version, so every existing item simply has no row: the `task_family_id IS NULL` equivalent with no column added to `approved_items` or `question_bank_items` and no backfill. Nothing may add `NOT NULL` or a check that requires a family.

**Why a separate table and not `question_bank_items.generation_metadata`.** The schema forbids generation lineage on `STUDYUS_AUTHORED` items. A person may write an instance of a family by hand; a separate lineage table lets that be recorded without touching the rule that authored content has no generation lineage. Whether authored instances may carry a family is an open decision (§11).

**References to existing tables.** `canonical_concepts`, `canonical_subjects`, `assessment_sources`, `approved_items`, `question_bank_items`, `exam_definitions` (exam family). None is altered.

**Not persisted.** Refusals; the support matrix as such (it is part of a family version's content); the independence relationship between two instances (derivable from two lineage rows).

## 5. Boundaries with B2 and B3

**B2 (selection).** Unchanged and not imported. What it could consume later, as facts on a candidate: family identity and version, invariant hash, parameterisation identity, variant-family identity, instance class, the profile the instance was adapted for. With those a blueprint could say "at most n instances of one family per form" or "frozen instances only" — as B2 policy, written in B2. A test asserts that no file under `src/lib/assessment-blueprint/` mentions the new modules and that they do not mention it.

**B3 (evidence).** Not implemented. `ADAPTATION_EVIDENCE_FACETS` names the dimensions it could later carry — knowledge, skill, competency, context, transfer, assessment profile, independence, retention — and `EvidenceFacetCarrier` gives each a shape. Retention is always null: it is a fact about when evidence was produced, which no specification knows. No function computes independence, a weight or a contribution.

## 6. Production OS integration

```
RequirementCell → EvidenceTarget → TaskFamilySelection → AssessmentSystemProfile → AdaptationSpecification
   → GenerationRequest → QuestionCandidate → Validation → HumanReviewPackage
```

- `cell-bridge.ts`: `evidenceTargetOfCell`, `selectTaskFamilies` (same stable id **and** same canonical subject; excludes retired families and those whose stimulus or format does not fit the cell), `adaptForCell` (the cell's exam family resolves one profile or is refused; the request asks explicitly for everything the cell fixes; knowledge requirement defaults to `CERTIFIED`).
- `generateCandidates` / `renderGenerationPrompt` accept an optional `adaptationSpecifications` map by slot key. A specification must be intact and must agree with the slot's exam family, PRIMARY concept and subject, format, band, pool, language and cell, or it is refused (`ADAPTATION_SPECIFICATION_INVALID`, `ADAPTATION_SPECIFICATION_NOT_FOR_THE_SLOT`). Its generation-relevant content goes into the prompt, hence into the prompt hash, and its identity onto `lineage.adaptation`.
- Additive changes only: one optional member on the MODEL lineage, one optional member on the prompt, one optional input, two error codes. `adaptation` is not one of the repeatable lineage fields, so its absence is never a gap.

Byte identity, asserted by tests: the 789 resolved cells are unchanged (key set, count, total 865, canonical JSON before and after adapting); without a specification the pilot unit renders the recorded prompt hash and the stored pilot candidate; the QB-R2C pilot replay still reproduces its three files (existing test, unmodified); an empty map equals no map.

Limit: the harness has templates for multiple choice and student-produced numbers only. A specification whose format is `SHORT_RESPONSE`, `EXTENDED_RESPONSE`, `MATH_EXPRESSION` or `MULTI_SELECT` has `productionFormat: null` and cannot be generated today.

## 7. Reference Intelligence, Assessment Specification, Content Provenance

| Class | What it is | Where it lives | May it reach an item's wording? |
|---|---|---|---|
| `PEDAGOGICAL_REFERENCE` | What was consulted to understand a concept (Reference Intelligence Pack, concept profile) | `production/reference-pack.ts`, `concept-profile.ts` | No: `copyReferenceExpression: false` |
| `ASSESSMENT_SPECIFICATION` | How a system asks: profile rules, with authority and source lineage | `assessment-adaptation/` | It shapes form, never content; a profile holds no knowledge |
| `CONTENT_PROVENANCE` | Who wrote the instance (`STUDYUS_AUTHORED` / `STUDYUS_GENERATED`), and from which family and specification | candidate `provenance`, `lineage`, `lineage.adaptation` | It is the record of the wording's origin |

None implies another, and none is a reuse right: a source cited by an OFFICIAL rule is a specification source, not a content source. Kognity: **DEFERRED** — not accessed, not referenced by any family, profile or policy.

## 8. Exam families in the repository, and what is official in the profiles

Taxonomy: `PAA, PISA, IB, CAMBRIDGE, AICE, ICFES`. SEP does not exist (no family, no source). PISA **does** exist, contrary to the brief's expectation: `v2.pisa.math` and `v2.pisa.2022` record component definitions with OECD sources, and the taxonomy classes it `COMPETENCY_BENCHMARK`.

A rule is OFFICIAL only when the repository records the fact as data of a sourced component definition. A test re-reads every one.

| Profile | OFFICIAL (recorded in, sources) | STUDYUS_POLICY |
|---|---|---|
| PAA | Formats selected + numeric; 60 min / 55 items; calculator NONE — `v2.paa` Matemáticas (`cb-paa-guia-2021`, `cb-paa-preguntas-respuestas-2017`, `cb-paa-practice-test-2018`) | The other 12 rules |
| IB | Formats expression / short / extended; 120 min / 110 marks; six command terms; calculator NONE and GDC — `v2.ib.math-aa-hl` Papers 1 and 2 (`ibo-math-aa-guide-2021`, `ibo-math-aa-brief-2021`, `ibo-math-dp-page`) | The other 11 |
| CAMBRIDGE | 110 min / 75 marks; scientific calculator required; AO1 / AO2 — `AICE_SYLLABI` 9709 component 1 (`cie-9709-syllabus-2026-2027`) | The other 12, including response formats and command terms (recorded for IGCSE 0580 only) |
| PISA | Four formats; 60 min; four context categories; calculator allowed; four processes at 25% — `v2.pisa.math` (`oecd-pisa-2022-framework`, `oecd-pisa-2022-math-site`, `nces-pisa-2022-technical-notes`) | The other 10, including transfer and authenticity |
| ICFES | Selected response; 50 items (no published time); calculator NONE; three competencias 34 / 43 / 23 — `v2.saber11.math` (`icfes-marco-matematicas-saber11`, `icfes-guia-saber11-2026`, `icfes-resolucion-268-2020`) | The other 11, including contexts (a code comment, not data) |

Scope limit: the official rules were read from the mathematics component of each family. A profile claims to be the system's; today its official rules speak for that component.

## 9. Mathematics proof of concept

Artifact `EA1_math_adaptation_matrix.json`; `npx tsx scripts/operations/ea1-adaptation-matrix.ts [--matrix | --demand | --write]`.

### Families

| # | Family | Concept (canonical subject) | Evidence target | Construct |
|---|---|---|---|---|
| 1 | `tf.math.proportion.missing-value` | `math.num.ratio-proportion` (Matemáticas) | SOLVE | `DIRECT_PROPORTION_MISSING_VALUE` |
| 2 | `tf.math.proportion.rate-comparison-model` | same | FORMULATE, SOLVE, INTERPRET | `UNIT_RATE_COMPARISON_OF_TWO_OPTIONS` |
| 3 | `tf.math.linear.line-through-two-points` | `math.fun.linear-functions-lines` (Matemáticas) | COMPUTE, REPRESENT | `LINE_THROUGH_TWO_POINTS` |
| 4 | `tf.math.linear.constant-rate-model` | same | FORMULATE, INTERPRET | `LINEAR_MODEL_FIXED_START_CONSTANT_RATE` |
| 5 | `tf.math.quadratic.solve-by-factorising` | `math.alg.quadratics` (Mathematics) | SOLVE | `QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING` |
| 6 | `tf.math.quadratic.optimum-of-a-model` | same | FORMULATE, SOLVE, INTERPRET | `QUADRATIC_MODEL_VERTEX_OPTIMUM` |
| 7 | `tf.math.probability.single-event-equally-likely` | `math.prob.probability` (Matemáticas) | COMPUTE | `CLASSICAL_PROBABILITY_SINGLE_DRAW` |
| 8 | `tf.math.probability.compare-chances-to-decide` | same | FORMULATE, COMPUTE, EVALUATE | `COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES` |
| 9 | `tf.math.data.rate-of-change-from-realistic-dataset` | `math.stat.data-representation` (Matemáticas) | INTERPRET, COMPUTE | `RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES` |
| 10 | `tf.math.data.judge-claim-against-display` | same | INTERPRET, EVALUATE | `CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY` |

### Support and adaptation matrix

S = specification, C = specification under the family's constraints, U = refused `PROFILE_UNSUPPORTED_BY_FAMILY`. One request per cell: Practice, Standard band, nothing else fixed.

| # | PAA | IB | CAMBRIDGE | PISA | ICFES |
|---|---|---|---|---|---|
| 1 | S | C (Standard / Challenge only) | C (same) | U no transfer | S |
| 2 | S | S | S | S | S |
| 3 | S | S | S | U no transfer | S |
| 4 | S | S | S | S | S |
| 5 | C (numeric only) | S | S | U no transfer | U no produced response |
| 6 | C (numeric only) | S | S | S | U no produced response |
| 7 | S | C (Standard / Challenge only) | C (same) | U no transfer | S |
| 8 | S | S | S | S | S |
| 9 | U needs a calculator | C (GDC component only) | S | S | U needs a calculator |
| 10 | S | S | S | S | S |

50 attempts: 35 SUPPORTED, 7 SUPPORTED_WITH_CONSTRAINTS, 8 UNSUPPORTED → **42 specifications, 8 named refusals**. By profile: PAA 9, IB 10, Cambridge 10, PISA 6, Icfes 7. All ten families reach at least two systems.

All eight POC refusals are the family's own declaration. The other refusal codes are exercised by tests on variants (a family that over-claims support, a request outside a constraint, a tampered profile).

### Fidelity

Invariant hash identical within every family across all its specifications; ten distinct hashes across families. Compared dimensions (12): context, response format, reasoning depth, command term, stimulus, competencies, time budget, mark structure, rubric style, tool policy, numeric profile, distractors. Difficulty, language and levers are not counted (request-driven or derived).

Threshold **N = 3**, the measured minimum. 70 pairs: 8 differ in 3, 3 in 4, 6 in 5, 4 in 6, 9 in 7, 5 in 8, 9 in 9, 10 in 10, 15 in 11, 1 in 12. The pairs at 3 are PAA–Icfes (context requirements, competencies, time budget) and IB–Cambridge (competencies, time budget, tool policy). PAA–Icfes sits at 3 for all seven families they share.

Worked comparison, family 4 (`LINEAR_MODEL_FIXED_START_CONSTANT_RATE`, FORMULATE + INTERPRET, `math.fun.linear-functions-lines`, identical invariant hash in all five):

| | PAA | IB | CAMBRIDGE | PISA | ICFES |
|---|---|---|---|---|---|
| Response format | Selected | Short response | Short response | Selected | Selected |
| Context | Personal | Scientific | Scientific | Personal, authentic required, transfer required | Personal, plausible preferred |
| Reasoning depth | Answer only | Method shown | Method shown | Answer only | Answer only |
| Command term | — | find | work out | — | — |
| Stimulus | None | None | None | Own (table / graph) | None |
| Calculator → numbers | None → exact by hand | None → exact by hand | Scientific → realistic | Allowed → realistic | None → exact by hand |
| Marks / rubric | 1 per item / key | Multi-mark parts / method and accuracy | same | Coded credit | 1 per item / key |
| System competencies | (none modelled) | (none recorded) | AO2 | Formulate, Interpret-evaluate | Interpretación-representación, Formulación-ejecución |
| Pace | 65.45 s / item | 65.45 s / mark | 88 s / mark | not published per item | not published |
| Generable today | yes | no template | no template | yes | yes |

**Answer to the POC question.** At specification level, yes: the same PRIMARY concept, construct and evidence target are carried, hash-identical, into specifications that differ in 3 to 12 of 12 dimensions. Two limits on that answer. The differences are only as real as the profiles, most of whose rules are StudyUs assumptions; "exam-native" is not established. And no instance was generated, so whether a generated question actually preserves the construct is untested.

### The canonical-subject tension

Of the 42 specifications, 9 are for a system where the concept is certified (all PAA), 6 where a reviewed catalogue link names it (quadratics for IB and Cambridge; proportion and probability for PISA), and **27 where the repository certifies nothing**. Under production's knowledge requirement, 15 survive with `CATALOGUE_LINK_OR_CERTIFIED` and 9 with `CERTIFIED`.

`math.alg.quadratics` is the only POC concept in canonical subject `Mathematics`, and the only one linked for IB and Cambridge. The other four live in `Matemáticas`, which no IB or Cambridge objective references. A linear-function family fits IB behaviour and produces an IB specification; whether "Rectas y funciones lineales" (Matemáticas) may be assessed as IB content is not decided by this code. It reports `NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY` and nothing bridges the two subjects. This is a decision for the user (§11, D1).

## 10. The 865 planned items as required evidence instances

`evidenceDemandByConcept(cells, assumption)`; artifact `EA1_paa_evidence_demand.json`. A **planning estimate**, not a commitment. The demand and the cells are unchanged: 865 instances, 61 concepts, pools 183 / 122 / 122 / 88 / 175 / 175, of which 438 (the three mock pools) must be frozen certified instances.

Assumption parameters (STUDYUS_POLICY, provisional — no independence rule exists): how many instances of one family one pool may hold, and whether a family may supply several pools (with different instances).

| Max per family per pool | Family serves several pools | Families, all Sections | Families, Matemáticas (35 concepts, 383 instances) |
|---|---|---|---|
| 2 | yes | **145** | **70** |
| 1 | yes | 241 | 106 |
| 2 | no | 508 | 237 |
| 1 | no | 865 | 383 |

By Section under the first row: Lectura 34 (12 concepts, 197 instances), Redacción 14 (5, 97), Matemáticas 70 (35, 383), Inglés 27 (9, 188). The five POC concepts need 61 instances and two families each under the first row, which is what the POC drafted. Three PAA concepts (28 instances) sit in canonical subject `Mathematics`.

The estimate ignores that a family may not fit every cell's format or stimulus (the two quadratic families fit no multiple-choice cell), so real family counts would be higher.

## 11. Known limitations and open decisions

Limitations:

1. Nothing is reviewed. Ten families, five profiles and one policy written in one session by a model.
2. Profiles are illustrative: 19 of 75 rules are OFFICIAL; the rest are assumptions.
3. Official rules were read from one mathematics component per family; the Cambridge profile mixes 9709 facts with command terms recorded for 0580 (marked policy).
4. An OFFICIAL rule's `locator` is a string. The tests re-read each fact by hand-written code, not by resolving the locator.
5. Support declarations are judgements; all POC refusals come from them.
6. No instance was generated: invariant preservation is proven for specifications, not for questions.
7. The constructed-response formats have no generation template.
8. The mathematics policy's command-term mapping is a heuristic.
9. `familyContentHash` detects an unversioned edit only against a stored specification; nothing enforces version bumps yet.
10. Database certifications and the persistence design were not exercised against a database in this phase.

Open decisions:

- **D1 — Canonical subject.** May a `Matemáticas` concept be assessed under a `Mathematics` curriculum (IB, Cambridge), and by what act? Until decided, production must use `knowledgeRequirement: CERTIFIED` or `CATALOGUE_LINK_OR_CERTIFIED`. Related: does a reviewed catalogue link count as certification?
- **D2 — Profile granularity.** One profile per exam family, or per component / paper (calculator and time differ by paper)? Changes the profile tables.
- **D3 — PISA.** The brief asked for `NO_CERTIFIED_SPECIFICATION`; the repository holds sourced definitions, so the profile cites them. Confirm or downgrade (a one-object change: set the basis and make every rule policy; a test shows that form is valid).
- **D4 — Instance class of Diagnostic and Verification.** Frozen by conservative default.
- **D5 — May a DRAFT family feed frozen pools?** The engine records the lifecycle and does not refuse.
- **D6 — May a human-authored item carry a family?** Affects the lineage table and the authored-content rule.
- **D7 — Independence parameters** (B3): the two demand parameters and what a variant family is.
- **D8 — AICE.** A family of the taxonomy with no profile; not resolved to Cambridge.
- **D9 — Two "task family" notions.** The transfer engine's derived family hash and the authored family of this phase: how B3 relates them (§1, Naming).

## 12. Recommended sequence

1. Decide D1–D3.
2. Human review of the contract by an assessment specialist and of two or three families by a mathematician; revise.
3. Certify one profile properly (PAA is closest: certified hierarchy, guide page references) for all its components.
4. Persistence migration for families, versions and item lineage (additive, nullable); profiles after D2.
5. One live-provider pilot from specifications for the two generable formats, with an instance-level invariant check (parameter ranges, construct) as a new independent validator.
6. Templates for constructed responses.
7. B2 policy on families per form; then B3 independence.
8. A second discipline (reading) to test the registry and the engine outside mathematics.

## 13. Gates

Verdicts by the coordinating session, against the gate names of the EA-1 brief.

| Gate | Verdict | Evidence |
|---|---|---|
| EA1-01 Canonical knowledge separation | PARTIAL | No per-exam concept id anywhere; subjects never merged. But 27 of 42 specifications target a system where the concept is not certified (D1) |
| EA1-02 Task Family abstraction | PASS | `task-family.ts`; all listed fields; ten families validate; a family holds no stem |
| EA1-03 Discipline specialization | PASS | Registry; `MATH_PROBLEM` implemented; seven other types declared |
| EA1-04 Assessment Profile abstraction | PASS | Fifteen rule dimensions, authority on every rule, OFFICIAL refused without source; the five profiles themselves are `PROVISIONAL_ILLUSTRATIVE` (19 of 75 rules official) |
| EA1-05 Adaptation Policy | PASS | Mathematics policy, versioned, names no exam; provisional and unreviewed |
| EA1-06 Adaptation Specification | PASS | Deep-frozen, deterministic, content-hashed, per-dimension provenance, 21 named refusals |
| EA1-07 Math invariants | PASS | Invariant hash identical within each family across profiles; proven for specifications, not for generated questions |
| EA1-08 Supported-profile matrix | PASS | 35 supported, 7 with constraints, 8 unsupported; unsupported is refused, never forced |
| EA1-09 Question lineage | PASS | Optional adaptation lineage on candidates; carrier only, not persisted |
| EA1-10 Dynamic vs certified instances | PASS | Pool to minimum instance class; promotion path describes existing gates; Diagnostic / Verification default open (D4) |
| EA1-11 PAA 865 reinterpretation | PASS | 865 instances / 61 concepts unchanged; family estimates under stated provisional parameters |
| EA1-12 B2 boundary | PASS | B2 does not import adaptation or task families, and they do not import B2 |
| EA1-13 B3 boundary | PASS | Evidence facets and independence carrier are types only; no rule, weight or writer |
| EA1-14 Production OS integration | PASS | Additive; cells and pilot v2 byte-identical without a specification; constructed-response formats have no generation template yet |
| EA1-15 Legacy compatibility | PASS | Candidates without adaptation lineage pass every gate; design uses a separate lineage table, no backfill |
| EA1-16 Rights/provenance preservation | PASS | Rights verdict of an adapted instance unchanged: not establishable |
| EA1-17 Multi-discipline extensibility | PASS | A throwaway type is registered and adapted in a test without touching the common schema; no second discipline built |
| EA1-18 Math proof-of-concept | PASS | Ten families on five certified concepts, all DRAFT / UNREVIEWED |
| EA1-19 Multi-profile adaptation | PARTIAL | 42 specifications, pairwise at least 3 of 12 dimensions differ; "exam-native" rests on illustrative profiles, no instance generated, and D1 |
| EA1-20 No competing architecture | PASS | Extends B1 / Question Bank / Production OS; note the transfer engine's separate derived "task family" (D9) |

Status:

- `EA-1 STATUS = PARTIAL` (18 PASS, 2 PARTIAL, 0 FAIL)
- `READY_FOR_ADAPTATION_SCHEMA_IMPLEMENTATION = NO` — blocked by D1 (what an instance may be attributed to), D2 (profile table shape) and the absence of any reviewed family.

## 14. Verification

See the phase report for the TypeScript, unit-suite and build results. New suite: `tests/unit/ea1-assessment-adaptation.test.ts`.
