# EA-1 — Transversal Assessment Adaptation Architecture

Branch `feat/ea1-assessment-adaptation`, on the integration line after QB-R2C (`e45a858`); first cut committed as `154c75c`, this revision applies the decisions of 2026-10-11. A pure domain model, a proof-of-concept data module, tests and this design. No migration, no table, no route, no service that writes, no database access, no network, no AI provider call, no question generated, nothing reviewed or approved. Kognity was not accessed.

Everything authored in this phase is a draft: the ten task families are `DRAFT` / `UNREVIEWED`, the profiles are `PROVISIONAL_ILLUSTRATIVE` and `MIXED_AUTHORITY`, the mathematics policy is `PROVISIONAL`. They were written in-session by the model working on the phase. They test an architecture; they are not a catalogue to produce from and not a description of how any examination board works.

**Later phase.** EA-1A (`EA1A_LEARNING_APPROACH_PROFILES_AND_STEM_PLUS.md`) adds the learning-approach layer, locks several policy rulings (no dev-test content in protected mock pools; evidence-bearing content needs a certified assessment profile; component profiles bind to an exam / component version) and carries the current persistence design. Where this document and EA-1A differ, EA-1A is current. The persistence sketch written before EA-1A was specified is kept as `DRAFT_AUXILIARY_ADAPTATION_PERSISTENCE_SKETCH.md`: an auxiliary draft, not EA-1A, not certified.

## 0. Decisions (2026-10-11, by the user)

| # | Decision | Where it is enforced |
|---|---|---|
| D1 | A canonical concept is exam-independent and never duplicated per exam. **Concept certification** (Curriculum) and **assessment applicability** (may this concept be assessed by this system / subject / component) are two notions. Applicability may rest on official exam structure or a reviewed catalogue link; it never re-certifies or re-keys the concept. The canonical subject label need not match the exam's local subject label. | `assessment-applicability.ts`, `adapt.ts` step 6 |
| D2 | Profiles are a hierarchy: `AssessmentSystemProfile → AssessmentComponentProfile`. Rules inherit downward; an override keeps its own authority and source; a specification targets the concrete component whenever component-specific behaviour affects generation. | `assessment-system-profile.ts` (`resolveProfile`), `adapt.ts` step 5b |
| D3 | PISA is mixed authority, like every profile: OFFICIAL only where the exact source is recorded, STUDYUS_POLICY otherwise, never an inference promoted. | `specification.basis: MIXED_AUTHORITY`; `COMPONENT_DEPENDENT_FALLBACK_IS_NOT_OFFICIAL` |
| D4 | Instance policy. Practice: dynamic or frozen. Diagnostic, Verification: evidence-bearing use requires frozen certified; dynamic only as `DEV_TEST_CONTENT`. Reduced and Full Mocks: frozen certified only for real assessment use. | `instance-lineage.ts` (`instancePolicyFor`) |
| D5 | Task-family maturity. A DRAFT / UNREVIEWED family version generates `DEV_TEST_CONTENT` only and never feeds certified frozen pools; a REVIEWED / CERTIFIED version may, subject to every Question Bank gate. | `familyMayFeedEvidenceBearingContent`, refusal `FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT` |
| D6 | A human-authored item may carry task-family lineage. Authorship and family lineage are separate dimensions. No legacy backfill. | `AuthoredFamilyLineageSchema`, `lineage.familyLineage` on the HUMAN lineage |
| D9 | `AssessmentTaskFamily` (generation / assessment structure) and `TransferTaskFamily` (the transfer engine's evidence concept) are two concepts, not merged, not renamed. Reconciliation is deferred to B3. | naming, comments, an import-separation test |

Still open: **D7** (independence parameters — B3) and **D8** (AICE has no profile of its own and is not resolved to Cambridge).

**Resolution of the QB-R2C PAA-Math finding.** QB-R2C reported that three certified PAA concepts (`math.alg.quadratics`, `math.fun.exponential`, `math.trig.ratios`) sit in canonical subject `Mathematics` while the PAA section is "Matemáticas", and listed three options. D1 settles it: the concepts stay canonical `Mathematics` concepts — no new concept, no move. They are assessed under PAA because applicability exists (official PAA Topics carry them). Reviewer qualification follows the item's actual PRIMARY concept subject × exam family, so `Mathematics × PAA` is the valid qualification for those 28 planned items; the database already works that way (`question_bank_review_authority_guard`, migration `20261112_1000`, takes the subject from the PRIMARY concept). This grants nothing by itself: a qualification is still a human grant.

## 1. The architecture

```
Canonical Knowledge ──(assessment applicability: a recorded fact)──┐
   →  AssessmentTaskFamily  →  AssessmentSystemProfile → AssessmentComponentProfile  →  DisciplineAdaptationPolicy
   →  AdaptationSpecification  →  GenerationRequest / generateCandidates  →  validated QuestionCandidate
   →  B2 selection  →  B3 evidence
```

| Separation | One side | Other side | How it is enforced |
|---|---|---|---|
| Knowledge vs how it is asked | Canonical concept (Curriculum) | Task family, profiles | A family references a certified stable id; profile schemas are strict and have no field for a concept |
| Concept certification vs assessment applicability | Curriculum, exam-independent | A record about a concept and a scope | The record references the concept (id + its own subject) and restates nothing; basis cannot exceed evidence |
| How a system asks vs what that means in a discipline | Profile (generic words) | Discipline policy | The profile holds no discipline rule; the policy names no exam |
| System rule vs component rule | Common rules | Paper / section overrides | A component overrides only what the system declares component-dependent; provenance says SYSTEM or COMPONENT |
| Invariant vs variable | PRIMARY concept, construct, evidence target (hashed) | Twelve compared dimensions, each with provenance | `invariantHash`, `invariantsPreserved`, `INVARIANT_CHANGE_REQUESTED` |
| Dev-test content vs evidence-bearing content | Non-certifying UX content | Content whose responses may be evidence | `contentUseClass` on request, specification and lineage; maturity and applicability refusals |
| Specification vs instance | Immutable generation input | Content with every gate still to pass | A specification holds no stem, option or answer; `NOT_ESTABLISHED_BY_ADAPTATION` |

### Placement and dependency direction

| Directory | Owner | Holds | Imports |
|---|---|---|---|
| `src/lib/exam-core/question-bank/task-families/` | Question Bank | Family contract, specialisation registry, `MATH_PROBLEM`, the ten POC families, demand analysis | `zod` only |
| `src/lib/assessment-adaptation/` | Shared assessment architecture | Applicability contract and POC register, system / component profile contract and data, discipline policy, specification, engine, instance lineage and carriers, cell bridge, POC matrix | the task-family contract, the exam-family taxonomy |
| `src/lib/exam-core/question-bank/production/` (three files edited) | Question Bank | Optional adaptation lineage (generated and authored); optional specification input of the harness; two error codes | the specification and lineage schemas |

Direction: `production → assessment-adaptation → task-families`. Nothing points back. No existing guard was weakened and no expected list of an existing test was changed.

### Naming

- **`AssessmentProfile` already exists.** `src/lib/assessment-profiles.ts` (Phase 3B) holds the verification settings of two activity types, imported by `assessment-verification.service.ts`. The new types are `AssessmentSystemProfile` and `AssessmentComponentProfile`; the old file is not imported, changed or shadowed.
- **`EVIDENCE_DIMENSIONS` already exists in B1** (the journey dimension an activity is run for). The dimensions B3 could later carry are `ADAPTATION_EVIDENCE_FACETS`.
- **`AssessmentTaskFamily` vs `TransferTaskFamily`.** `AssessmentTaskFamily` (alias of the contract's `TaskFamily`) is an authored, versioned generation / assessment structure owned by the Question Bank. The transfer engine's family (`computeTransferTaskFamilyId`, `transfer_task_instances.task_family_id`) is a hash derived from one learner's transfer task, and `transfer-policy` already uses it for an independence rule. They are two concepts. No transfer code was touched; a test asserts neither imports the other. B3 reconciles them.

## 2. Domain concepts

### 2.1 AssessmentTaskFamily (`task-families/task-family.ts`)

A reusable way of eliciting evidence; not a question. Fields: `familyId`, `version`, `familyType`, `canonicalSubject`, `primaryConcepts` (certified stable id + canonical subject and name; all of the family's subject), `targetSkills`, `targetCompetencies`, `evidenceTarget {actions, object, observablePerformance}`, `supportedContexts`, `difficultyLevers`, `commonMisconceptions`, `responseConstraints` (formats, stimulus need and kinds), `profileSupport` per **system** profile id (`SUPPORTED` / `SUPPORTED_WITH_CONSTRAINTS{constraints}` / `UNSUPPORTED{reason}`), `provenance`, `lifecycle`, `reviewStatus`, `specialization`.

A family no longer says anything about applicability: `canonicalKnowledgeAvailability` was removed. Behaviour fit is the family's; applicability is not.

Constraints are machine-checkable (`RESPONSE_FORMAT_ONLY`, `CONTEXT_ONLY`, `DIFFICULTY_ONLY`, `CALCULATOR_ONLY`) and may only narrow. Maturity: `familyMayFeedEvidenceBearingContent` is true only for `REVIEWED` + `CERTIFIED`.

**Discipline specialisation.** A registry value (`createTaskFamilyRegistry`, `.with(spec)`). `MATH_PROBLEM` is implemented; `SCIENCE_PROBLEM`, `SCIENCE_INVESTIGATION`, `READING_ANALYSIS`, `WRITING_EDITING`, `SOURCE_ANALYSIS`, `CASE_ANALYSIS`, `LANGUAGE_USE` are declared with intended fields and refused until registered. A test registers a throwaway type and adapts it without touching the common schema or the engine.

### 2.2 Assessment applicability (`assessment-applicability.ts`)

A record: `concept {stableId, canonicalSubject}` (a reference), `scope {systemProfileId, subject (the exam's local label, or null), componentId (or null)}`, `basis`, `evidence[]`.

| Basis | Evidence kind | In the POC |
|---|---|---|
| `OFFICIAL_EXAM_STRUCTURE` | An official node of a certified exam structure that carries the concept, with its source reference | `PAA_TOPICS`: OFFICIAL Topics of the Matemáticas section whose `certifiedConceptId` is the concept (`cb-paa-guia-2021 p.35 / p.36`) — review state `CERTIFIED` |
| `REVIEWED_CATALOGUE_LINK` | A reviewed objective → concept link naming the concept's exact (canonical subject, name) | `allLearningLinks()` — the modules declare their links reviewed and record no reviewer: `DECLARED_REVIEWED` |
| `NONE` | — | No record exists |

A **threshold policy** (StudyUs policy, versioned; `EA1_APPLICABILITY_THRESHOLD` v1) says which basis at which evidence review state establishes applicability: official structure at `CERTIFIED`, catalogue link at `DECLARED_REVIEWED` or better. `resolveApplicability(register, concept, target, policy)` matches the concept by id **and** canonical subject; a component is answered by its own record or the system's, never by another component's; no record is `NONE` / `NOT_ESTABLISHED`. Nothing is inferred and nothing bridges `Matemáticas` and `Mathematics` by name.

The POC register (`math-poc-applicability.ts`, 9 records) is rebuilt by a test from `PAA_TOPICS` and `allLearningLinks()`; a record that the repository does not support, or one it supports and the register omits, fails the test.

### 2.3 AssessmentSystemProfile and AssessmentComponentProfile (`assessment-system-profile.ts`)

Fifteen rule dimensions: `responseFormats`, `timePressure`, `commandTerms`, `markStructure`, `reasoningDepth`, `contextExpectations`, `calculatorPolicy`, `stimulusExpectations`, `responseLength`, `rubricStyle`, `competencyEmphasis`, `competencyElicitation`, `transferExpectations`, `authenticityRequirements`, `blueprintConstraints`. Every rule is `{ruleId, value, authority}`; `OFFICIAL` requires `{sourceKey, locator}` sources declared by the object's own specification records; `STUDYUS_POLICY` requires `provisional: true` and an assumption.

- **System profile**: `profileId`, `version`, `examFamilyCode`, `status`, `certification`, `specification {basis: MIXED_AUTHORITY | STUDYUS_POLICY_ONLY, records, note}`, `componentDependentDimensions`, `rules` (all fifteen).
- **Component profile**: `componentId` (`<SYSTEM>.<…>`), `version`, `systemProfileId`, `localSubject` (a label, never compared with a canonical subject), `status`, `certification`, `specification`, `overrides` (any subset of the fifteen, each a whole rule).
- **Inheritance**: `resolveProfile(system, component?)` returns the rules in force and `ruleOrigin` per dimension (`SYSTEM` / `COMPONENT`). An override replaces value **and** authority. A component may override only dimensions the system declares component-dependent. The system-level rule of a component-dependent dimension is a fallback for generic practice and may not be OFFICIAL (what components have in common is an inference). Resolved rules are checked for consistency again.

**When a component is required** (`COMPONENT_REQUIRED`). The system has component-dependent dimensions, no component is targeted, and any of: (a) the purpose is not Practice / low-stakes reinforcement; (b) the content is evidence-bearing; (c) the request fixes a component-dependent dimension; (d) the family's support is constrained on one; (e) the family requires a tool and the tool policy is component-dependent; (f) the system-level fallback of a component-dependent dimension offers nothing the family can use. Otherwise generic dev-test practice uses the system's rules and the specification's component is null.

### 2.4 DisciplineAdaptationPolicy (`discipline-policy.ts`)

Unchanged: `MATHEMATICS` for `MATH_PROBLEM`, STUDYUS_POLICY, provisional; invariants, variable dimensions, format preference, meaning of each reasoning depth, tool interaction, lever kinds, transfer, command terms by lead action, distractor rule.

### 2.5 AdaptationSpecification (`adaptation-specification.ts`, `adapt.ts`)

`adapt({family, profile, component?, applicability?, applicabilityPolicy?, disciplinePolicy, request})` → deep-frozen specification or named refusal. The request states `purpose`, `contentUseClass` (never defaulted), band, language, and optionally format, context, calculator, command term, cell key, `applicabilityRequirement`.

Content: family identity with lifecycle and review status; `systemProfile`; `componentProfile` (nullable); policy; PRIMARY concept; `assessmentApplicability` (status, basis, scope, evidence, threshold policy); `contentUseClass`; skills and competencies; `invariants` + `invariantHash`; `variable` (15 dimensions); `parameterization`; `purpose` with pool, allowed and minimum instance class; cell link; `provenance` per dimension with origin `REQUEST` / `SYSTEM_PROFILE_RULE` / `COMPONENT_PROFILE_RULE` / `POLICY_RULE` / `FAMILY`; `lineage` with content hashes of family, system profile, component profile, policy and request. `specificationId` = sha256 of canonical JSON without id and timestamp.

Refusals (26, all tested): `FAMILY_INVALID`, `FAMILY_TYPE_NOT_REGISTERED`, `PROFILE_INVALID`, `COMPONENT_PROFILE_INVALID`, `COMPONENT_NOT_OF_THE_SYSTEM`, `DISCIPLINE_POLICY_INVALID`, `REQUEST_INVALID`, `APPLICABILITY_REGISTER_INVALID`, `FAMILY_RETIRED`, `FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT`, `DISCIPLINE_POLICY_NOT_FOR_FAMILY_TYPE`, `INVARIANT_CHANGE_REQUESTED`, `PROFILE_SUPPORT_NOT_DECLARED`, `PROFILE_UNSUPPORTED_BY_FAMILY`, `SUPPORT_CONSTRAINT_VIOLATED`, `COMPONENT_REQUIRED`, `ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED`, `RESPONSE_FORMAT_NOT_ALLOWED`, `CONTEXT_NOT_ALLOWED`, `PROFILE_REQUIRES_CONTEXT_FAMILY_CANNOT_PROVIDE`, `PROFILE_REQUIRES_TRANSFER_FAMILY_CANNOT_PROVIDE`, `TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE`, `TOOL_POLICY_NOT_ALLOWED_BY_PROFILE`, `STIMULUS_REQUIRED_BY_FAMILY_NOT_OFFERED_BY_PROFILE`, `COMMAND_TERM_NOT_IN_PROFILE_VOCABULARY`, `PROFILE_COMPETENCY_NOT_ELICITED`.

Evidence-bearing content requires: a REVIEWED + CERTIFIED family, a concrete component (where the system has component-dependent dimensions), and applicability ESTABLISHED. Dev-test content records whatever applicability exists and proceeds.

### 2.6 Use class, instance class, lineage and carriers (`instance-lineage.ts`)

- `CONTENT_USE_CLASSES`: `DEV_TEST_CONTENT` (non-certifying UX content; never evidence) and `EVIDENCE_BEARING`. Two uses, not two qualities.
- `instancePolicyFor(purpose, useClass)`:

| Purpose | Evidence-bearing | Dev-test content | Basis |
|---|---|---|---|
| PRACTICE | dynamic or frozen | dynamic or frozen | user decision |
| DIAGNOSTIC, VERIFICATION | frozen certified only | dynamic allowed | user decision |
| REDUCED_MOCK, FULL_MOCK_1, FULL_MOCK_2 | frozen certified only | **not accepted** | user decision (EA-1A locked ruling; it overrules the earlier reading that allowed dynamic dev-test content here) |
| LOW_STAKES_REINFORCEMENT | dynamic or frozen | dynamic or frozen | brief |
| BENCHMARK, CALIBRATION, PILOT_CERTIFICATION | frozen certified only | **not accepted** | brief; dev-test: conservative reading of the EA-1A ruling, flagged |

- `AdaptationLineage` (generated): family, system profile, component profile (nullable), policy, specification id, invariant hash, use class, run.
- `AuthoredFamilyLineage` (human-authored): family, invariant hash, use class, and — when a specification was followed — its id and profiles. No generation field.
- `PROMOTION_PATH`: automated validation → originality → rights → human review → attribution → pool assignment. A description; it adds, removes and relaxes nothing.
- `InstanceIndependenceCarrier`, `SiblingRelationship`, `ExposureRelationship`, `EvidenceFacetCarrier`: types only.

## 3. Ownership matrix

| Thing | Owner | Reads it | Notes |
|---|---|---|---|
| Canonical concepts, subjects, concept certification | Curriculum | everyone, by reference | Exam-independent; never created, re-keyed or moved here |
| Exam structures, objective → concept mappings | Curriculum (authority and review of the mapping) | applicability | The evidence applicability rests on |
| **Assessment applicability** (records, threshold policy) | **Shared assessment architecture**, reading the Curriculum's mappings | adaptation engine, production bridge | See below |
| Task families and versions | Question Bank | adaptation engine, production | |
| System profiles and versions | Shared assessment architecture | adaptation engine | Official facts stay owned by the exam configuration they are read from |
| **Component profiles and versions / overrides** | Shared assessment architecture | adaptation engine | One per recorded paper / section; refers to, never replaces, the exam's component definition |
| Discipline adaptation policies | Shared assessment architecture (with discipline specialists) | adaptation engine | StudyUs policy |
| Adaptation specifications | Adaptation engine (produces); Question Bank (stores with the item) | generation harness | Immutable |
| Question-instance lineage (generated and authored) | Question Bank | B2, B3 (later) | Optional, additive |
| Content use class, instance policy | Shared assessment architecture (contract); Question Bank (enforcement at its gates) | generation, pool assignment | |
| Independence carrier | Shared assessment architecture (contract); Question Bank (facts) | B2, B3 | Types only today |
| Reviewer qualification | Question Bank review authority | — | Follows PRIMARY concept subject × exam family; a human grant |
| Selection | B2 | — | Unchanged; does not import adaptation |
| Evidence, TransferTaskFamily | B3 / Learning Engine | — | Not implemented here; not touched |

**Why applicability is owned by the shared assessment architecture and not by the Curriculum or the Question Bank.** The Curriculum owns the two things applicability is derived from — the concept and the mapping of an exam structure or objective to it — and must stay exam-independent about the concept itself. Applicability is a *decision rule over those mappings for an assessment scope* (system, local subject, component) under a threshold policy; the scope vocabulary (profiles, components) and the threshold belong to the assessment architecture. The Question Bank is a consumer: it must not be able to declare its own content applicable. So: the Curriculum authors and reviews mappings; the assessment architecture derives applicability from them and never writes a mapping; the Question Bank reads the result at generation and at its gates.

## 4. Persistence design (summary at the time of EA-1; superseded by the persistence section of EA-1A)

Nothing is migrated. The table below is the EA-1 summary; `DRAFT_AUXILIARY_ADAPTATION_PERSISTENCE_SKETCH.md` holds the auxiliary DDL sketch it was drawn from, and the EA-1A document revises both.

| Entity | Table (proposed) | Key points |
|---|---|---|
| Task family | `question_bank_task_families` | Stable identity; `canonical_subject_id → canonical_subjects` |
| Family version | `question_bank_task_family_versions`, `question_bank_task_family_concepts` | Content + hash; PRIMARY concepts as FKs to `canonical_concepts`; immutable once referenced; review columns |
| System profile, version | `assessment_system_profiles`, `assessment_system_profile_versions` | `exam_family` text (as `exam_definitions.exam_family`); `component_dependent_dimensions text[]` |
| Component profile, version | `assessment_component_profiles`, `assessment_component_profile_versions` | Child of a system profile; optional link to `assessment_components`; overrides only |
| Rules and sources | `assessment_profile_rules`, `assessment_profile_rule_sources` | One row per rule of a system or component version; OFFICIAL needs ≥ 1 source row → `assessment_sources.source_key` |
| Discipline policy | `assessment_discipline_policies` | Versioned content |
| Applicability | `assessment_applicability`, `assessment_applicability_evidence`, `assessment_applicability_threshold_policies` | References `canonical_concepts` (never copies); evidence references `structure_nodes` or `objective_concept_mappings`; basis, review state, scope |
| Specification | `question_bank_adaptation_specifications` | Content-addressed, insert-only |
| Item lineage | `question_bank_item_task_family_lineage` | One optional row per `approved_items` version; generated **or** authored; no backfill |

Legacy items have no lineage row. Nothing adds `NOT NULL` or a check that requires a family.

## 5. Boundaries with B2 and B3

**B2 (selection).** Unchanged and not imported. Facts it could consume later on a candidate: family identity and version, invariant hash, parameterisation identity, variant-family identity, instance class, use class, the system and component the instance was adapted for.

**B3 (evidence).** Not implemented. `ADAPTATION_EVIDENCE_FACETS` names knowledge, skill, competency, context, transfer, assessment profile, independence, retention; `EvidenceFacetCarrier` gives each a shape; retention is always null. No function computes independence, a weight or a contribution. `mayBearEvidence('DEV_TEST_CONTENT')` is false: whatever B3 becomes, dev-test content is outside it. The transfer engine's `TransferTaskFamily` is left as it is.

## 6. Production OS integration

```
RequirementCell → EvidenceTarget → TaskFamilySelection → AssessmentSystemProfile (+ component) → AdaptationSpecification
   → GenerationRequest → QuestionCandidate → Validation → HumanReviewPackage
```

- `cell-bridge.ts`: `evidenceTargetOfCell`; `selectTaskFamilies` (same stable id **and** same canonical subject; excludes retired families and those whose stimulus or format does not fit); `adaptForCell` — the caller names the component of the cell and the content use class; applicability requirement defaults to `ESTABLISHED` even for dev-test content.
- `generateCandidates` / `renderGenerationPrompt` accept an optional `adaptationSpecifications` map by slot key. A specification must be intact and agree with the slot's exam family (of its system profile), PRIMARY concept and subject, format, band, pool, language and cell. Its generation-relevant content — including system, component and use class — goes into the prompt and the prompt hash; its identity goes onto `lineage.adaptation`.
- Additive changes only: optional `adaptation` on the MODEL lineage, optional `familyLineage` on the HUMAN lineage, optional prompt member, optional input, two error codes.

Byte identity, asserted by tests: the 789 resolved cells are unchanged; without a specification the pilot unit renders the recorded prompt hash and the stored candidate; the QB-R2C replay test passes unmodified; an empty map equals no map; no stored pilot candidate carries either lineage member.

Limit: the harness has templates for multiple choice and student-produced numbers only; constructed-response specifications have `productionFormat: null`.

## 7. Reference Intelligence, Assessment Specification, Content Provenance

| Class | What it is | Where it lives | May it reach an item's wording? |
|---|---|---|---|
| `PEDAGOGICAL_REFERENCE` | What was consulted to understand a concept | `production/reference-pack.ts`, `concept-profile.ts` | No: `copyReferenceExpression: false` |
| `ASSESSMENT_SPECIFICATION` | How a system and its components ask: profile rules with authority and source lineage; and applicability evidence | `assessment-adaptation/` | It shapes form, never content |
| `CONTENT_PROVENANCE` | Who wrote the instance, and — separately — which family and specification it is an instance of | candidate `provenance`, `lineage`, `lineage.adaptation` / `lineage.familyLineage` | It is the record of the wording's origin |

None implies another, and none is a reuse right. Kognity: **DEFERRED**.

## 8. Exam families, profiles and what is official

Taxonomy: `PAA, PISA, IB, CAMBRIDGE, AICE, ICFES`. SEP does not exist. PISA exists (`v2.pisa.math`, `v2.pisa.2022`, OECD sources).

100 rule objects (75 system rules + 25 overrides); **23 OFFICIAL**: 22 component overrides and one system rule. A test re-reads every OFFICIAL value from the cited place.

| System (basis MIXED_AUTHORITY) | Component-dependent dimensions | System-level OFFICIAL | Component | OFFICIAL overrides (recorded in, sources) |
|---|---|---|---|---|
| PAA | formats, time, calculator | — | `PAA.MATEMATICAS` | formats selected + numeric; 60 min / 55 items; calculator NONE — `v2.paa` Matemáticas (`cb-paa-guia-2021`, `cb-paa-preguntas-respuestas-2017`, `cb-paa-practice-test-2018`) |
| IB | formats, time, command terms, calculator | — | `IB.MATH_AA_HL.P1` / `.P2` | formats; 120 min / 110 marks; six command terms; calculator NONE (P1) / GDC (P2) — `v2.ib.math-aa-hl` (`ibo-math-aa-guide-2021`, `ibo-math-aa-brief-2021`, `ibo-math-dp-page`) |
| CAMBRIDGE | time, calculator | AO1 / AO2 (syllabus 9709) | `CAMBRIDGE.9709.P1` | 110 min / 75 marks; scientific calculator required — `AICE_SYLLABI` 9709 component 1 (`cie-9709-syllabus-2026-2027`) |
| PISA | formats, time, contexts, calculator, competencies, elicitation | — | `PISA.MATHEMATICS` | four formats; 60 min; four context categories; calculator allowed; four processes at 25% — `v2.pisa.math` (`oecd-pisa-2022-framework`, `oecd-pisa-2022-math-site`, `nces-pisa-2022-technical-notes`) |
| ICFES | formats, time, calculator, competencies, elicitation, blueprint | — | `ICFES.SABER11_MATEMATICAS` | selected response; 50 items; calculator NONE; three competencias 34 / 43 / 23 — `v2.saber11.math` (`icfes-marco-matematicas-saber11`, `icfes-guia-saber11-2026`, `icfes-resolucion-268-2020`) |

Only recorded components are modelled, and only those the mathematics POC needs. Recorded and not modelled: PAA's three other sections, IB Paper 3, 9709 components 2–6, PISA reading and science. Cambridge response formats and command terms are policy (recorded for IGCSE 0580 only); Icfes contexts are policy (a code comment, not data).

## 9. Mathematics proof of concept

Artifact `EA1_math_adaptation_matrix.json` (v2); `npx tsx scripts/operations/ea1-adaptation-matrix.ts [--matrix | --demand | --write]`. One request per cell: Practice, Standard band, `DEV_TEST_CONTENT`, nothing else fixed.

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

### Component-level matrix

S / C = specification (C under the family's constraints); the bracket is the applicability basis: **O** official exam structure, **L** reviewed catalogue link, **–** none. U = `PROFILE_UNSUPPORTED_BY_FAMILY`; T = `TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE`.

| # | PAA.MATEMATICAS | IB P1 | IB P2 | CAMBRIDGE 9709 P1 | PISA.MATHEMATICS | ICFES Saber 11 |
|---|---|---|---|---|---|---|
| 1 | S [O] | C [–] | C [–] | C [–] | U | S [–] |
| 2 | S [O] | S [–] | S [–] | S [–] | S [L] | S [–] |
| 3 | S [O] | S [–] | S [–] | S [–] | U | S [–] |
| 4 | S [O] | S [–] | S [–] | S [–] | S [–] | S [–] |
| 5 | C [O] | S [L] | S [–] | S [L] | U | U |
| 6 | C [O] | S [L] | S [–] | S [L] | S [–] | U |
| 7 | S [O] | C [–] | C [–] | C [–] | U | S [–] |
| 8 | S [O] | S [–] | S [–] | S [–] | S [L] | S [–] |
| 9 | U | **T** | C [–] | S [–] | S [–] | U |
| 10 | S [O] | S [–] | S [–] | S [–] | S [–] | S [–] |

- **60 attempts → 51 specifications, 9 refusals** (`PROFILE_UNSUPPORTED_BY_FAMILY` 8, `TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE` 1). By component: PAA 9, IB P1 9, IB P2 10, Cambridge P1 10, PISA 6, Icfes 7. The one engine-found refusal is the hierarchy at work: family 9 needs a calculator, the IB system fits it under a calculator constraint, and Paper 1 allows none.
- **Applicability of the 51**: 9 by official exam structure (all PAA), 6 by reviewed catalogue link (quadratics on IB P1 and Cambridge P1; proportion and probability on PISA), **36 not established**. Quadratics on IB Paper 2 is not established: the recorded link is of a Paper 1 objective.
- **Evidence-bearing**: the same 60 attempts asked for `EVIDENCE_BEARING` content give 0 specifications — all refused `FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT`. With a reviewed family the remaining gates would be the component (met here) and applicability (15 of 51 established).

### System-level matrix (generic practice, no component)

**50 attempts → 36 specifications, 14 refusals**: `PROFILE_UNSUPPORTED_BY_FAMILY` 8, `COMPONENT_REQUIRED` 6 (families 5 and 6 on PAA — format constraint; family 6 on PISA — the fallback format does not fit; family 9 on IB, Cambridge and PISA — it requires a tool). By system: PAA 7, IB 9, Cambridge 9, PISA 4, Icfes 7.

### Fidelity

Invariant hash identical within every family across all targets (component and system level); ten distinct hashes. Twelve compared dimensions.

- **Different systems: N = 3**, the measured minimum (100 pairs: 11 at 3, 9 at 4, 6 at 5, 4 at 6, 9 at 7, 6 at 8, 14 at 9, 17 at 10, 23 at 11, 1 at 12). The pairs at 3: PAA–Icfes (context requirements, competencies, time budget) and IB P2–Cambridge P1 (competencies, time budget, tool policy).
- **Components of one system: N = 2** (9 pairs, all IB P1–P2: tool policy and numeric profile — exactly what the component owns).

Worked comparison, family 4 (same invariant hash in all six):

| | PAA.MATEMATICAS | IB P1 | IB P2 | CAMBRIDGE P1 | PISA.MATHEMATICS | ICFES |
|---|---|---|---|---|---|---|
| Response format | Selected | Short response | Short response | Short response | Selected | Selected |
| Context | Personal | Scientific | Scientific | Scientific | Personal, authentic and transfer required | Personal |
| Reasoning depth | Answer only | Method shown | Method shown | Method shown | Answer only | Answer only |
| Command term | — | find | find | work out | — | — |
| Stimulus | None | None | None | None | Own (table / graph) | None |
| Calculator → numbers | None → exact | None → exact | GDC → realistic | Scientific → realistic | Allowed → realistic | None → exact |
| Marks / rubric | 1 per item / key | Multi-mark / method and accuracy | same | same | Coded credit | 1 per item / key |
| System competencies | — | — | — | AO2 | Formulate, Interpret-evaluate | two competencias |
| Pace | 65.45 s / item | 65.45 s / mark | 65.45 s / mark | 88 s / mark | — | — |
| Applicability | established (official) | not established | not established | not established | not established | not established |
| Generable today | yes | no template | no template | no template | yes | yes |

**Answer to the POC question.** At specification level, yes. Two limits: the differences are only as real as the profiles (23 of 100 rules official), and no instance was generated, so whether a generated question preserves the construct is untested.

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

1. Nothing is reviewed: ten families, five system and six component profiles and one policy written in one session by a model.
2. Profiles are illustrative: 23 of 100 rule objects are OFFICIAL.
3. Only one mathematics component per system is modelled (two for IB).
4. An OFFICIAL rule's `locator` is a string; tests re-read each fact by hand-written code, not by resolving the locator.
5. Catalogue-link evidence is `DECLARED_REVIEWED`: the modules say "reviewed links" and name no reviewer. The threshold policy accepts that today; persisted, the review state should come from `objective_concept_mappings.status / reviewed_by` (EA-1A).
6. Applicability is read from a hand-kept register that a test rebuilds from the repository; it is not yet derived at run time.
7. Dynamic dev-test content in mock, benchmark, calibration and pilot-certification purposes is this phase's reading of D4, not the user's words.
8. Whether a `PROVISIONAL_ILLUSTRATIVE` profile may feed evidence-bearing content is not decided; the engine records the status and does not refuse.
9. No instance was generated; the constructed-response formats have no generation template.
10. The persistence design was not exercised against a database.

Decided: D1, D2, D3, D4, D5, D6, D9 (§0). Open:

- **D7 — Independence parameters** (B3): the two demand parameters, what a variant family is, and how `AssessmentTaskFamily` relates to `TransferTaskFamily`.
- **D8 — AICE.** A family of the taxonomy with no profile; not resolved to Cambridge. The 9709 record sits under the AICE catalogue while the POC's system profile carries `examFamilyCode: CAMBRIDGE`.
- Items 5, 7 and 8 above need a word from the user but block nothing in code.

## 12. Recommended sequence

1. EA-1A (learning approach profiles, locked rulings, revised persistence design); settle its open questions.
2. Human review of the contracts by an assessment specialist and of two or three families by a mathematician; revise.
3. Certify one system with all its components (PAA is closest).
4. Migrations, in the order the EA-1A persistence section proposes, DEV then Preview / Stage.
5. One live-provider pilot from specifications for the two generable formats, with an instance-level invariant check as a new independent validator.
6. Templates for constructed responses.
7. B2 policy on families per form; then B3 (independence, the two family notions).
8. A second discipline (reading).

## 13. Gates

Re-evaluated after the decisions of 2026-10-11, against the gate names of the EA-1 brief.

| Gate | Verdict | Evidence |
|---|---|---|
| EA1-01 Canonical knowledge separation | PASS | No per-exam concept id; subjects never merged or bridged by name; applicability is a separate contract that references the concept and cannot re-key it; evidence-bearing content is refused where applicability is not established |
| EA1-02 Task Family abstraction | PASS | `task-family.ts`; ten families validate; a family holds no stem and no applicability |
| EA1-03 Discipline specialization | PASS | Registry; `MATH_PROBLEM` implemented; seven other types declared |
| EA1-04 Assessment Profile abstraction | PASS | System → component hierarchy, inheritance with per-dimension origin, authority on every rule, OFFICIAL refused without source; profiles `PROVISIONAL_ILLUSTRATIVE`, 23 of 100 rules official |
| EA1-05 Adaptation Policy | PASS | Mathematics policy, versioned, names no exam; provisional and unreviewed |
| EA1-06 Adaptation Specification | PASS | Deep-frozen, deterministic, content-hashed; targets system + component; provenance says system or component; 26 named refusals |
| EA1-07 Math invariants | PASS | Invariant hash identical within each family across all targets; proven for specifications, not for generated questions |
| EA1-08 Supported-profile matrix | PASS | Support declared per system and honoured per component; unsupported is refused, never forced; the engine also refuses what a declaration over-claims |
| EA1-09 Question lineage | PASS | Optional lineage on generated and on human-authored candidates; carrier only, not persisted |
| EA1-10 Dynamic vs certified instances | PASS | `instancePolicyFor(purpose, useClass)` per the decision; `DEV_TEST_CONTENT` modelled as a use; one cell family (dev-test in mock pools) is a flagged reading |
| EA1-11 PAA 865 reinterpretation | PASS | 865 instances / 61 concepts unchanged; family estimates under stated provisional parameters |
| EA1-12 B2 boundary | PASS | B2 does not import adaptation or task families, and they do not import B2 |
| EA1-13 B3 boundary | PASS | Facets and independence carrier are types only; transfer code untouched and not imported |
| EA1-14 Production OS integration | PASS | Additive; cells and pilot v2 byte-identical without a specification; constructed-response formats have no generation template yet |
| EA1-15 Legacy compatibility | PASS | Candidates without any lineage pass every gate; no backfill; design uses a separate optional lineage table |
| EA1-16 Rights/provenance preservation | PASS | Rights verdict of an adapted instance unchanged: not establishable; authorship and family lineage are separate |
| EA1-17 Multi-discipline extensibility | PASS | A throwaway type is registered and adapted in a test; no second discipline built |
| EA1-18 Math proof-of-concept | PASS | Ten families on five certified concepts, all DRAFT / UNREVIEWED; six components of five systems |
| EA1-19 Multi-profile adaptation | PASS (specification level, as the brief scopes it) | 51 component-level specifications with hash-equal invariants, ≥ 3 of 12 dimensions apart across systems; unsupported combinations refused. Carried forward, not architecture: every specification is dev-test content (no reviewed family), 36 of 51 have no established applicability, profiles are illustrative, no instance was generated |
| EA1-20 No competing architecture | PASS | Extends B1 / Question Bank / Production OS; the transfer engine's family is named apart and left alone |

Proposed status:

- `EA-1 STATUS = PASS` (20 PASS at architecture / specification level; verdicts by the coordinating session). The brief states that specification generation is enough at this phase; the content-maturity limits on EA1-19 are carried into EA-1A and the live pilot and do not license any evidence-bearing use.
- `READY_FOR_ADAPTATION_SCHEMA_IMPLEMENTATION = YES, AFTER EA-1A REVIEW` — D1 and D2 no longer block the table shapes; EA-1A is design-ready with its open questions listed; by the user's instruction no migration is written yet.
- `KOGNITY_ACCESS_VALIDATION = DEFERRED`; `PROFILES = PROVISIONAL_ILLUSTRATIVE / MIXED_AUTHORITY`; `TASK_FAMILIES = DRAFT_UNREVIEWED (DEV_TEST_CONTENT only)`.

## 14. Verification

See the phase report for the TypeScript, unit-suite and build results. Suite: `tests/unit/ea1-assessment-adaptation.test.ts`.
