# L1_ASSESSMENT — EA-1A (2026-10-11)

## LANE
L1_ASSESSMENT — worktree `/Users/jalbornoz/PROYECTOS/studyos-qb-r1a`, branch `feat/ea1a-learning-approach`.

## STATUS
READY_FOR_ORCHESTRATOR_REVIEW

Lane's own assessment of the phase: `EA-1A STATUS = PARTIAL`, `READY_FOR_ADAPTATION_SCHEMA_IMPLEMENTATION = NO` (unresolved architecture issues U2, U3, U4, U5, U9 change table shapes or gates).

## BASE SHA
3031e03 (EA-1 accepted as PASS: 154c75c, af0d763)

## FINAL SHA
See the commit that carries this report (`git log -1` on the lane branch).

## FILES CHANGED
- RM docs/exams/assessment-adaptation/EA1A_ADAPTATION_PERSISTENCE_DESIGN.md -> docs/exams/assessment-adaptation/DRAFT_AUXILIARY_ADAPTATION_PERSISTENCE_SKETCH.md
-  M docs/exams/assessment-adaptation/EA1_TRANSVERSAL_ASSESSMENT_ADAPTATION_ARCHITECTURE.md
-  M docs/exams/assessment-adaptation/EA1_math_adaptation_matrix.json
-  M scripts/operations/ea1-adaptation-matrix.ts
-  M src/lib/assessment-adaptation/adapt.ts
-  M src/lib/assessment-adaptation/adaptation-specification.ts
-  M src/lib/assessment-adaptation/assessment-system-profile.ts
-  M src/lib/assessment-adaptation/index.ts
-  M src/lib/assessment-adaptation/instance-lineage.ts
-  M src/lib/assessment-adaptation/system-profiles.ts
-  M src/lib/exam-core/question-bank/production/generator/generate-candidates.ts
-  M src/lib/exam-core/question-bank/task-families/index.ts
-  M src/lib/exam-core/question-bank/task-families/task-family.ts
-  M tests/unit/ea1-assessment-adaptation.test.ts
- ?? docs/exams/assessment-adaptation/EA1A_LEARNING_APPROACH_PROFILES_AND_STEM_PLUS.md
- ?? docs/exams/assessment-adaptation/EA1A_learning_approach_poc.json
- ?? src/lib/assessment-adaptation/learning-approach-poc.ts
- ?? src/lib/assessment-adaptation/school-stem-performance.ts
- ?? src/lib/exam-core/question-bank/task-families/math-poc-families-ea1a.ts
- ?? src/lib/learning-approach/
- ?? tests/unit/ea1a-learning-approach.test.ts
- docs/orchestration/status/L1_STATUS.md
- docs/orchestration/reports/L1_ASSESSMENT.md

## LOCKS USED
`ASSESSMENT_ADAPTATION` — `src/lib/assessment-adaptation/`, `src/lib/learning-approach/` (new, same lane scope), `docs/exams/assessment-adaptation/`, the task-family contracts. Additive, optional lineage/prompt fields in `production/generator/generate-candidates.ts` (QUESTION_BANK_CORE adaptation contract). No schema, no migration, no Stage, no DEV write.

## TESTS
- `npx tsc --noEmit -p tsconfig.json` — exit 0
- `npx vitest run` — 517 files / 9,290 tests, 0 failures (baseline 516 / 9,250)
- `npx next build` — exit 0
- Ephemeral database certifications (temporary local Postgres, no shared database): reviewer governance, CURR-PAA, B2-B1, B2-B2, platform chain — all DONE, exit 0
- 82 migration files, none added

## FINDINGS
| Output field | Value |
|---|---|
| EA-1A STATUS | PARTIAL |
| LEARNING_APPROACH_PROFILE | PASS — contract in `src/lib/learning-approach/`, imports only zod; no exam rule, no curriculum content |
| STEM_PLUS_PROFILE | PARTIAL — contract implemented; content PROVISIONAL; 5 of 6 transversal competencies are not in the competency catalogue (proposed codes, to be created by Curriculum) |
| CURRICULUM_SEPARATION | PASS — no STEM curriculum, no per-approach concept id; one concept id and one invariant hash across MX, CO, both approaches, four targets |
| ASSESSMENT_PROFILE_SEPARATION | PASS — profile carries no approach; an OFFICIAL constraint always wins; 12 official overrides recorded on the specifications |
| TASK_FAMILY_INTEGRATION | PASS — 13 declared family types (SCIENCE_INVESTIGATION aliased to SCIENTIFIC_INVESTIGATION); only MATH_PROBLEM implemented; science declared-only |
| INSTITUTION_CONFIGURATION | PASS — pure resolution, default STANDARD; granularity open (U3) |
| MULTIDIMENSIONAL_EVIDENCE_DESIGN | PASS — types only; B3 scoring not implemented; AssessmentTaskFamily kept apart from TransferTaskFamily |
| MEXICO_POC | PARTIAL — 12 DEV_TEST specifications; curriculum entitlement NOT_ESTABLISHED (MCCEMS exists only as seed metadata, structure not imported); mathematics only |
| COLOMBIA_POC | PARTIAL — same (MEN) |
| PERSISTENCE_DESIGN | PARTIAL — revised to 20 tables + 1 view, 9 placeholder migrations, none created; blocked by U2–U5, U9 |
| READY_FOR_ADAPTATION_SCHEMA_IMPLEMENTATION | NO |

- STANDARD is recorded by absence: all 110 EA-1 attempts are byte-identical with no approach and with STANDARD.
- Locked rulings enforced with named refusals: protected mock pools refuse DEV_TEST_CONTENT; PROVISIONAL / ILLUSTRATIVE assessment profiles produce DEV_TEST_CONTENT only; an OFFICIAL component rule needs a version binding; no stable key on canonical_concepts.
- Side effect of the version-binding ruling: the 51 component-level EA-1 specification ids changed (profile content hash); the 36 system-level ids and every count in the EA-1 matrix are unchanged.
- DEV_TEST_CONTENT ingestion audit: DEFERRED — none of the five guarantees (environment isolation, never pilot-eligible, never approved, never in a mock pool, never released to Production) is provable in the existing architecture.
- The rejected inferred document is now `DRAFT_AUXILIARY_ADAPTATION_PERSISTENCE_SKETCH.md` with a "not EA-1A, not certified, do not implement" banner.
- Details: `docs/exams/assessment-adaptation/EA1A_LEARNING_APPROACH_PROFILES_AND_STEM_PLUS.md` (§13 lists U1–U10).

## BLOCKERS
Decisions only the Orchestrator / Human Operator can take:
- U2 — version-binding target for syllabus-record systems (Cambridge 9709 has no exam-version row).
- U3 — granularity of an institution's learning approach (institution-wide, per curriculum, per class or subject).
- U4 — whether a PROVISIONAL learning approach may feed evidence-bearing content.
- U5 — whether institutions may author their own approaches in the first schema.
- U9 — AICE vs Cambridge profile identity.
- U1 (confirmation, not blocking) — a non-official profile rule also overrides an approach preference.

## CHANGE_REQUESTS
NONE

## MERGE RECOMMENDATION
Do not merge yet. Keep on the lane branch until U2–U5 and U9 are decided; then merge together with the schema phase. Note for the Orchestrator: EA-1 was merged locally into `integration/q1-paa-bank-readiness` (59f518a, 3031e03) before this session knew the control plane; nothing pushed. EA-1A was not merged.

## NEXT SAFE ACTION
Orchestrator rules on U2, U3, U4, U5, U9 (and confirms U1); the lane then updates the persistence design in place.
