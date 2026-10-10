# B0-U — Universal Curriculum & Assessment Architecture Delta

Date: 2026-10-10 · Worktree: `studyos-b0-universal` · Branch: `architecture/b0-universal-curriculum-delta`
Amends: `B0_INTEGRATED_ASSESSMENT_ARCHITECTURE_CERTIFICATION.md` (original certification kept intact; addendum appended there).

Evidence tags: **[V]** verified in this pass against the file cited · **[B0]** established by the original B0 / B0-C pass and not re-queried.

## A. Executive Summary

```text
B0_UNIVERSAL_CURRICULUM_DELTA_PASS
NO_SCHEMA_CHANGE
```

The existing model is already a universal curriculum model. Node types are open text, the hierarchy is
self-referencing at any depth, learning expectations map many-to-many to concepts, skills and competencies,
the knowledge graph has no curriculum column, student state has no curriculum in its identity, and the
institution layer exists. Mexico (SEP) and Colombia (MEN) are already registered as authorities next to IB
and Cambridge. Nothing had to be redesigned.

The delta is therefore small:

| Kind | What |
|---|---|
| SEMANTIC CLARIFICATION | The universal vocabulary is frozen as a reading of existing tables (section F). Official vs teaching implementation is decided by ownership (`academic_organizations.source_type`), not by shape. |
| CODE DELTA (pure, additive) | `src/lib/curriculum/curriculum-framework.ts` (framework profile semantics) and `src/lib/curriculum/cross-curriculum.ts` (multi-curriculum reads, derived node state). No IO, no consumer yet. |
| TEST DELTA | Five framework fixtures, two teaching implementations, 34 certification tests. |
| DOCUMENTATION DELTA | This report; addenda in the B0 and B1 reports. |
| SCHEMA | None. One additive relation is identified and deliberately deferred to its owner (section W). |

| Result | Status |
|---|---|
| B1 | `B1_STILL_VALID` |
| B2 | `B2_GO_REMAINS_VALID` |

## B. Git / Repository State

| Item | Brief said | Verified |
|---|---|---|
| B0 anchor | `73c303a` | [V] ancestor of `cbb6b39` |
| B1-E semantic commit | `908a9c8` | [V] ancestor of `cbb6b39` |
| B1 final HEAD | `cbb6b39` on `foundation/assessment-b1` | [V] |
| Migrations `20261108_1000`, `20261109_1000` | present, not applied | [V] present; chain = 71 files. Applied state [B0]: DEV ledger ended at `20261107_1000`; not re-queried |
| Later state not in the brief | — | [V] `integration/q1-paa-assessment-b1` = `58daefa` (Q1 PAA catalogue data merged onto `cbb6b39`); `remediation/t1-micro-delta` = `41e9676` |
| B2 | "do not start" | [V] B2 already exists as UNCOMMITTED work on `feat/assessment-b2-blueprint-core` in worktree `studyos-assessment-b1` (delivered under the earlier B2 brief, `BLUEPRINT_CORE_PASS`). It was not touched here |

Base chosen: `cbb6b39` — the one commit that unambiguously contains both B0 and the full B1. The Q1 line and
the uncommitted B2 tree are siblings of this delta off the same commit; the delta touches none of their
files except documentation. Nothing pushed, nothing deployed, no database queried, no migration applied.

## C. Existing Domain Model (current-state map)

| Capability | Classification | Evidence |
|---|---|---|
| Curriculum (authority → programme → qualification → subject → version → node → expectation) | EXISTS_AND_SUFFICIENT | [V] `20260924_1000_f6_curriculum_standards_mapping.sql`; `20261018_1500` adds `country`, `source_type`, `authority_level`, `parent_organization_id`, `jurisdiction` |
| Curriculum node (hierarchical, extensible) | EXISTS_AND_SUFFICIENT | [V] `structure_nodes.parent_id` self-FK; `node_type text NOT NULL` with no CHECK |
| Learning expectations | EXISTS_AND_SUFFICIENT (semantics clarified) | [V] `learning_objectives` (one host node). No `type` column: what a framework calls it is read from its placement (section F) |
| Knowledge graph | EXISTS_AND_SUFFICIENT | [V] `canonical_concepts`, `canonical_concept_prerequisites`, `skills`, `competencies`, `contexts`, `canonical_concept_skills`, `canonical_concept_competencies`, `skill_competencies`; none references a curriculum table |
| Cross-curriculum mappings | EXISTS_AND_SUFFICIENT | [V] `objective_concept_mappings` / `objective_skill_mappings` / `objective_competency_mappings`: N:M, relation type, workflow status, versioned. No curriculum-to-curriculum table exists, by design |
| Institution layer | EXISTS_NEEDS_EXTENSION (deferred) | [V] `institution_curricula` (`base_structure_version_id`, `source_type`), `institution_curriculum_objectives`, `institution_curriculum_concepts` (`period`, `order_index`, `source`), `class_plan_concepts`. A unit / session tree is representable as an INSTITUTION_DEFINED structure version; the FK tying it to an `institution_curricula` row is missing (section W) |
| Assessment objectives | EXISTS_AND_SUFFICIENT | [V] `ComponentDefinition.assessmentObjectives` (per component), item tag `assessmentObjective`, slot dimension `ASSESSMENT_OBJECTIVE` (`slot-constraints.ts:27`). Explicitly not a learning objective |
| Command terms | EXISTS_AND_SUFFICIENT | [V] `command_terms`, `command_term_interpretations` (per programme), `blueprint_objective_targets.command_term_id` |
| Questions | EXISTS_NEEDS_EXTENSION (known) | [V] `question_bank_items` (one expectation, exam version, component) + item tags; concepts reached through the expectation. Item-level concept / skill attribution is not produced by any source — already recorded by B1 and B2 |
| Blueprints | EXISTS_AND_SUFFICIENT | [V] `assessment_blueprints`, `blueprint_objective_targets` (expectation, component, command term, skill, difficulty, question type, `constraints` jsonb), `blueprint_component_allocations`; `assessment_components` carries marks, weighting, `calculator_policy`, duration |
| Evidence | EXISTS_AND_SUFFICIENT | [V] `learning_evidence` keyed on Student + concept; B1 `EvidenceAttribution` contract |
| Student state | EXISTS_AND_SUFFICIENT | [V] `concept_knowledge_state`, `concept_memory_state`, `concept_transfer_state`, `learner_skill_state`, `learner_competency_state`; none has a curriculum column |
| Curriculum-level mastery store | Not present (correct) | [V] no table matches node / topic / unit / curriculum mastery. `subject_mastery_snapshots` is a dated average written from concept state (`mastery.service.ts:977`) |
| DUPLICATED | Learner-side legacy tree (`subjects` → `topics` → `subtopics` → `concepts`), `mastery_records` | [B0] already classified as legacy / competing; unchanged here |
| CONFLICTING | None found | — |

## D. Existing Schema Reuse

| Universal concept (brief) | Existing entity | New table? |
|---|---|---|
| CurriculumAuthority | `academic_organizations` | no |
| CurriculumFramework | `academic_programmes` (`programme_type`, `stage`, `grade_min/max`) | no |
| Programme / Qualification | `academic_programmes` / `academic_qualifications` | no |
| Subject | `academic_subjects` → `canonical_subjects` | no |
| CurriculumVersion | `structure_versions` | no |
| EducationLevel / Grade / GradeBand | programme `grade_min/max`; a grade-typed node whose `code` is `8` or `8-9` | no |
| CurriculumNode | `structure_nodes` | no |
| LearningExpectation | `learning_objectives` | no (not renamed) |
| Expectation "type" (PDA, DBA, syllabus statement …) | derived from node placement via a framework profile | no |
| Institution curriculum | `institution_curricula` + objectives / concepts; teaching tree as an INSTITUTION_DEFINED structure version | no |
| AssessmentObjective | component definition + item tag + slot dimension | no |

## E. Universal Architecture Principles (frozen)

1. Curriculum is not knowledge. A canonical concept has no curriculum, grade or node column.
2. A curriculum states what should be learned; a teaching implementation states how it is taught. Both use the same structure; **ownership** distinguishes them.
3. Curricula never map to each other. Each maps to the knowledge graph; alignment between curricula is derived through shared concepts.
4. Assessment creates evidence; evidence is about concepts, skills and competencies; it updates student state.
5. Student state is longitudinal and has no curriculum in its identity. Changing curriculum does not reset it.
6. Mastery of a node, topic, unit, subject or curriculum is derived on read from concept state. It is never stored.
7. A question is placed in a curriculum (its expectation) and measures knowledge (its concepts). These are two facts.
8. A blueprint composes an assessment. It owns no knowledge.
9. A framework's vocabulary is configuration. The core contains no country's or board's terminology (enforced by test).
10. `Student State + Curriculum + Goal → Adaptive Learning Path`: the engine reasons on concepts, prerequisites and evidence; curriculum is how the Student navigates and what scopes the goal.

## F. Curriculum Framework Model

A framework is described by a `FrameworkProfile` (`curriculum-framework.ts`) — pure configuration:

| Field | Meaning |
|---|---|
| `hierarchy` | which node types a parent may contain (`ROOT` for top level) |
| `expectationHosts` | node types that may host learning expectations |
| `expectationKinds` | what the framework calls an expectation, by a node type (and optionally code) on its path |
| `gradeNodeTypes` | node types whose `code` is a grade or a grade band |
| `facetNodeTypes` | node types whose `code` qualifies everything below (tier, referent, semester, phase, period) |

Functions: `validateScopeAgainstProfile`, `expectationSemantics` (kind, grade span, facets, placement),
`gradeSpanOfNode`, `parseGradeSpan`, `pathToRoot`, `subtreeOf`, `isOfficialCurriculum`. All read a B1
`CurriculumScope`; none stores anything. An unreadable grade code is null, never a guess.

Profiles are not persisted and no runtime loads one today: they live with whoever configures a framework
(in this delta, in the test fixtures). Conformance of stored nodes to a profile is validated in code, not
by a database constraint.

## G. Institution Curriculum Model

| Need | How the existing model represents it |
|---|---|
| The school adopts an official reference | `institution_curricula.base_structure_version_id`, `source_type` |
| Which official expectations it includes | `institution_curriculum_objectives` (classification, INCLUDED / EXCLUDED) |
| Which concepts, in what order and period | `institution_curriculum_concepts` (`period`, `order_index`, `source` AUTHORITY / INSTITUTION / TEACHER_SUPPLEMENTAL), `class_plan_concepts` |
| Its own course → period → unit → section → session | a structure version owned by an organization with `source_type = 'INSTITUTION_DEFINED'`, with its own expectations mapped to the same concepts and skills |
| Session ↔ official expectation | derived through shared concepts (`expectationsMetByNode`), with the official side's relation kept |

"Programa Analítico", "PEI" and "plan de estudios" are instances of this, not entities.

## H. Knowledge Graph Model

Concept, skill, competency, context, prerequisite, concept↔skill, concept↔competency, skill↔competency —
all existing, all curriculum-free. An expectation of one discipline may map to a concept of another
(a physics expectation with a PREREQUISITE mapping to a mathematics concept): linked, not duplicated.

## I. Assessment / Evidence Model

| Responsibility | Owner | Where |
|---|---|---|
| Curriculum placement of a question | Curriculum | `question_bank_items.learning_objective_id` → node → version |
| What it measures | Knowledge graph | concepts via `objective_concept_mappings` (B1 `QuestionCoverage`) |
| Assessment objective, command term, marks, difficulty | Assessment framework | component definition, item tags, slot dimensions, blueprint target columns |
| Paper / component, exam version | Exam definition | `assessment_components`, `exam_versions` |
| Eligibility for a blueprint | B1 `QuestionEligibility` + slot constraints | unchanged |
| Evidence | Learner State Authority | `planEvidenceAttribution` → `updateMastery` (sole writer) |

Attempt semantics are unchanged and re-asserted by test: PRACTICE → EXAM_PRACTICE, CHALLENGE →
EXAM_CHALLENGE, MOCK + FULL → FULL_MOCK, MOCK + REDUCED → REDUCED_MOCK, unknown fidelity → no start,
TECHNICAL_DEMO never FULL_MOCK.

## J. Student State Model

| State | Key | Curriculum in identity |
|---|---|---|
| Knowledge, retention, transfer | (student, learner concept) → canonical concept through `concept_catalog_mapping` | none |
| Skill | (student, skill) | none |
| Competency | (student, competency) | none |
| Node / topic / unit / subject | not stored; `deriveNodeState(scope, node, stateByConcept)` | n/a |

Skill state is derived only from evidence explicitly tagged with the skill (`skill-state.service.ts`), never
inferred from the concept graph. Curriculum coverage is computed on read and never combined with mastery
(`coverage.service.ts`).

## K. IB Fixture — PASS

International Baccalaureate → Diploma Programme → Physics HL → "First assessment 2025" → THEME → TOPIC →
expectations (`IB_UNDERSTANDING`). A SESSION node placed in this structure is rejected by the IB profile.
The provider's course is a separate structure (section Q).

## L. Cambridge Fixture — PASS

Cambridge International → IGCSE → Physics (0625) → syllabus version → TOPIC → SUBTOPIC → TIER (CORE /
SUPPLEMENT) → syllabus statements. The tier is a facet read from placement. AO1–AO3 and papers are on the
assessment side (section I) and appear nowhere among expectations, concepts or skills.

## M. SEP Secondary Fixture — PASS

SEP → Plan de Estudio 2022 → PHASE 6 → GRADE 8 → FIELD → DISCIPLINE → CONTENT → PDA. The PDA is a learning
expectation (kind `SEP_PDA`, grade 8, facet PHASE 6) mapped to a concept, a skill and a competency.

## N. SEP EMS Fixture — PASS

SEP → MCCEMS → Bachillerato general → SEMESTER → UAC → progressions (kind `SEP_EMS_PROGRESSION`, ordered by
code), on the same concepts and competencies; grade range 10–12 on the programme.

## O. Colombia MEN Fixture — PASS

MEN → Educación Básica Secundaria → Ciencias Naturales → one version with two REFERENT roots: EBC →
GRADE_BAND `8-9` → STRAND → expectation, and DBA → GRADE `8` → expectation. Both map to the same concept;
the concept appears once.

## P. Cross-Curriculum Mapping Test — PASS

One canonical concept ("Force and acceleration") is the target of expectations in all five frameworks
(IB 3, Cambridge 2, SEP Secundaria 1, SEP EMS 2, MEN 2). It is one row with one id in every scope.
`alignExpectations(SEP, IB)` returns the pairs with each side's own relation. No crosswalk table exists.

## Q. Institution Mapping Test — PASS

A Colombian school plan (PERIOD → UNIT → SESSION) and a provider's IB course (UNIT → SECTION → SESSION) are
separate versions under INSTITUTION_DEFINED owners. Neither contains a node or expectation of the official
structure; each validates on its own. Their sessions map to the same concepts, and
`expectationsMetByNode` relates a session to the official DBA / EBC (or IB) expectations. The same school
plan can be read against SEP without being rewritten. The school's explicit adoption uses the existing
`institution_curricula` / `institution_curriculum_objectives` rows.

## R. Longitudinal Student Test — PASS

Evidence under curriculum A (SEP) on concept X leaves a knowledge-state row keyed on the Student's concept
instance. Under curriculum B (IB) the same canonical concept resolves to the same instance; the state is
byte-identical; a concept new in B has no state. Guards: `concept_knowledge_state` has no curriculum column
and is unique on (student, concept); the resolver is Student-wide; both creation paths look up the existing
instance first.

Limit: continuity holds for learner concepts with a CANONICAL link. A learner concept that is unresolved
or only label-matched has no cross-curriculum identity ([B0]: 34 of 101 on DEV).

## S. Blueprint Impact

No change. A blueprint target already carries expectation, component, command term, skill, difficulty band,
question type and structured dimensions (competence, content category, assessment objective, process,
context, marks); the component carries marks, weighting, calculator policy and duration; fidelity is B1's.
The B2 solver (uncommitted, sibling branch) targets CONCEPT and OBJECTIVE keys only and names no framework.

Not yet expressible as a blueprint target: a curriculum node or a competency as a first-class target kind.
Both are reachable today by expanding to the expectations / concepts under them (`conceptsUnderNode`), so
this is an extension for B3+, not a conflict.

## T. B0 Impact

| Original B0 decision | Status |
|---|---|
| Curriculum Authority owns versions, hierarchy, expectations, mappings, canonical concepts | VALID; extended: it also owns framework semantics (profiles) |
| Canonical concept identity; learner concepts linked explicitly | VALID; this is what makes state longitudinal across curricula |
| "A canonical concept is not owned by a topic" | VALID; generalised to any node of any framework |
| Model B question stores behind coverage / eligibility | VALID |
| `updateMastery` sole evidence writer | VALID |
| Official exam authority and mock semantics | VALID |
| Three blueprint families, one solver | VALID |
| GAP "no unit/topic tree for any curriculum; rows written with EXAM_SECTION" | Still true of the DATA. The schema needs nothing to hold real trees (proven by the fixtures) |
| GAP "no cross-version identity; no crosswalk table" | CLARIFIED: no crosswalk is wanted. The concept is the cross-version and cross-curriculum identity. Version-bound references (blueprint targets, institution objectives) still need re-pointing when a version is superseded |

No contradiction found. ORIGINAL CERTIFICATION + this delta = CURRENT CERTIFIED ARCHITECTURE.

## U. B1 Impact

```text
B1_STILL_VALID
```

| B1 contract | Finding |
|---|---|
| `CurriculumScope` | Already universal: open `nodeType`, any depth, N:M objective ↔ concept, per version. Unchanged; the new modules only read it |
| Concept identity (CANONICAL / TRANSITIONAL / UNRESOLVED) | Unchanged; it is the longitudinal rule |
| `QuestionCoverage`, `QuestionEligibility` | Unchanged; exercised by the assessment test |
| `BlueprintRequirement` / `BlueprintResult` | Unchanged |
| `EvidenceAttribution` | Unchanged; targets are concepts only |
| Attempt semantics, fidelity classifier, migrations `20261108` / `20261109` | Unchanged |

No B1 source file was modified. One observation, not a defect: `CurriculumScope` reads concept mappings
only; skill and competency mappings are read by the new `knowledgeOfExpectation` from rows supplied by the
caller, and no loader for them exists yet.

## V. B2 Recommendation

```text
B2_GO_REMAINS_VALID
```

B2's core is framework-neutral and consumes only B1 contracts. Its open conditions are its own (commit the
working tree; migrations before any writer; snapshot persistence in B3).

## W. Schema / Migration Impact

`NO_SCHEMA_CHANGE`. Migrations created: none. Migrations applied: none.

One additive relation is identified and **not** created:

| Item | Detail |
|---|---|
| What | A nullable FK from `institution_curricula` to the institution's own teaching structure version |
| Why it is missing | Today the link between an institution curriculum row and an INSTITUTION_DEFINED structure version can only be inferred |
| Why deferred | No feature authors unit / session trees yet; the table belongs to the institution-curriculum track; adding a column with no consumer from an architecture pass would be speculative |
| When | With the first feature that authors or imports a teaching structure. Additive, nullable, no backfill |

## X. Backward Compatibility

Two new pure modules with no importer in `src`; no existing file changed except documentation. Runtime
behaviour, flags, data and migrations are identical to `cbb6b39`.

## Y. Tests

| Check | Result |
|---|---|
| `tests/unit/b0u-universal-curriculum.test.ts` | 34 / 34 |
| Full suite | 495 files / 8,785 tests, 0 failed (baseline 494 / 8,751) |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx next build` | exit 0 |

Fixtures (`tests/fixtures/universal-curriculum.ts`) are illustrative paraphrases written for these tests.
They are not official syllabus text and must not be used as seed data.

Open risks:

1. No official structure is imported for SEP or MEN (`STRUCTURE_NOT_IMPORTED` seeds) and existing versions hold exam-bootstrap `EXAM_SECTION` nodes [B0]. The architecture is proven on fixtures, not on loaded curricula.
2. Framework profiles are unpersisted configuration; nothing stops a non-conforming node being inserted.
3. Item-level concept / skill attribution does not exist; evidence credit from exam items stays UNDETERMINED.
4. Learner-side legacy (`concepts.subject_id`, `subtopic_id`, `topics`, `mastery_records`, `concept_knowledge_state.subject_id`) is still subject-scoped; unlinked learner concepts do not carry across curricula.
5. One PUBLISHED version per subject: superseding a version requires re-pointing blueprint targets and institution objectives.
6. `assessment_structure_nodes.node_type` is a closed CHECK list; a new assessment-side node type needs an additive constraint change.
7. Three sibling lines off `cbb6b39` (this delta, uncommitted B2, Q1 integration `58daefa`) must be integrated; no file overlap except documentation.

## Z. Final Certification

```text
B0_UNIVERSAL_CURRICULUM_DELTA_PASS
NO_SCHEMA_CHANGE
```

```text
B1 IMPACT:
B1_STILL_VALID
```

```text
B2:
B2_GO_REMAINS_VALID
```
