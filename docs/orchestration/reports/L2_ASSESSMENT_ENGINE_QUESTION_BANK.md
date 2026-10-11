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

---

# L2 — ASSESSMENT ENGINE / QUESTION BANK — EA-1A closure (2026-10-11, second run)

(This file was `reports/L1_ASSESSMENT.md`; the Orchestrator renamed the lane. The section above is the first EA-1A run.)

## LANE
L2 — ASSESSMENT ENGINE / QUESTION BANK — worktree `/Users/jalbornoz/PROYECTOS/studyos-qb-r1a`, branch `feat/ea1a-learning-approach`.

## STATUS
READY_FOR_ORCHESTRATOR_REVIEW

## BASE SHA
c810e70

## FINAL SHA
See the commit that carries this section (`git log -1` on the lane branch).

## FILES CHANGED
-  M docs/exams/assessment-adaptation/EA1A_LEARNING_APPROACH_PROFILES_AND_STEM_PLUS.md
-  M docs/exams/assessment-adaptation/EA1A_learning_approach_poc.json
-  M docs/exams/assessment-adaptation/EA1_math_adaptation_matrix.json
-  M scripts/operations/ea1-adaptation-matrix.ts
-  M src/lib/assessment-adaptation/adapt.ts
-  M src/lib/assessment-adaptation/adaptation-specification.ts
-  M src/lib/assessment-adaptation/assessment-system-profile.ts
-  M src/lib/assessment-adaptation/cell-bridge.ts
-  M src/lib/assessment-adaptation/learning-approach-poc.ts
-  M src/lib/assessment-adaptation/system-profiles.ts
-  M src/lib/exam-core/question-bank/production/generator/generate-candidates.ts
-  M src/lib/learning-approach/institution-configuration.ts
-  M src/lib/learning-approach/learning-approach-profile.ts
-  M tests/unit/ea1-assessment-adaptation.test.ts
-  M tests/unit/ea1a-learning-approach.test.ts
- docs/orchestration/status/L2_STATUS.md (renamed from L1_STATUS.md)
- docs/orchestration/reports/L2_ASSESSMENT_ENGINE_QUESTION_BANK.md (renamed from L1_ASSESSMENT.md)

## LOCKS USED
`ASSESSMENT_ADAPTATION`. One line changed in `production/generator/generate-candidates.ts` (QUESTION_BANK_CORE adaptation contract): the exam-family fit check resolves AICE to the CAMBRIDGE system (D5). No guard weakened. No schema, migration, database, deployment, merge or push.

## TESTS
- `npx tsc --noEmit -p tsconfig.json` — exit 0
- `npx vitest run` — 517 files / 9,298 tests, 0 failures (baseline 517 / 9,290)
- `npx next build` — exit 0
- Ephemeral database certifications (temporary local Postgres): reviewer governance, CURR-PAA, B2-B1, B2-B2, platform chain — all DONE, exit 0
- 82 migration files, none added

## FINDINGS
| Output field | Value |
|---|---|
| EA-1A STATUS | PASS (architecture) |
| LEARNING_APPROACH_PROFILE | PASS |
| STEM_PLUS_PROFILE_CONTRACT | PASS (content PROVISIONAL, uncertified) |
| STEM_PLUS_CATALOGUE_READINESS | PARTIAL (1 of 6 competencies in the catalogue; five recorded as future Curriculum catalogue work) |
| CURRICULUM_SEPARATION | PASS |
| ASSESSMENT_PROFILE_SEPARATION | PASS |
| TASK_FAMILY_INTEGRATION | PASS |
| INSTITUTION_CONFIGURATION | PASS (scoped assignment: institution < programme < class < subject; none = STANDARD; same-scope conflict refused by name) |
| MULTIDIMENSIONAL_EVIDENCE_DESIGN | PASS (types only; no B3 scoring) |
| MEXICO_ARCHITECTURE_POC | PASS (8 of 8 composition checks) |
| MEXICO_EVIDENCE_READINESS | NO |
| COLOMBIA_ARCHITECTURE_POC | PASS (8 of 8) |
| COLOMBIA_EVIDENCE_READINESS | NO |
| PERSISTENCE_DESIGN | PASS as a design (15 tables, 1 view, 8 placeholder migrations; not exercised against a database) |
| DEV_TEST_CONTENT_INGESTION | DEFERRED |
| READY_FOR_ADAPTATION_SCHEMA_IMPLEMENTATION | YES (A1 classified as deferred by the lane; Orchestrator to confirm) |

- Evidence readiness is NO for both countries: curriculum structures not imported, entitlement 0 of 12, nothing reviewed or certified, STEM+ catalogue partial. No entitlement was fabricated.
- Specification ids: the version-binding decision changed the 51 component-level EA-1 ids and the 9 Cambridge system-level ids again; 27 system-level ids and all counts are unchanged. 18 of 24 EA-1A POC ids changed.
- With real repository content no evidence-bearing specification can be produced (draft families, provisional profiles and approach). That path is exercised only with test doubles.
- A1 (the one item the lane had to classify): what establishes applicability of a concept for an institution's own assessment (`SCHOOL_STEM_PERFORMANCE`). It shapes none of the 15 tables and is additive later; the brief calls that profile "future". Classified DEFERRED with it.
- PRE_CONTROL_PLANE_MERGE_EXCEPTION: EA-1 local merges 59f518a and 3031e03 into `integration/q1-paa-bank-readiness` are kept by Orchestrator decision. No self-merges since.

## BLOCKERS
NONE. Confirmation requested on A1.

## CHANGE_REQUESTS
NONE

## MERGE RECOMMENDATION
Mergeable by the Orchestrator when the schema phase is authorized. The lane does not merge.

## NEXT SAFE ACTION
Orchestrator review of EA-1A and confirmation of A1; then authorization of the adaptation schema implementation.

---

# L2 — QB-R2D LIVE MULTI-PROFILE GENERATION (2026-10-11)

## LANE
L2 — ASSESSMENT ENGINE / QUESTION BANK — worktree `/Users/jalbornoz/PROYECTOS/studyos-qb-r1a`, branch `feat/qb-r2d-live-generation`.

## STATUS
READY_FOR_ORCHESTRATOR_REVIEW

`QB-R2D STATUS = PARTIAL` — the live pipeline works end to end and no key was wrong, but the generator is not ready for dev scale.

## BASE SHA
7a62edf (EA-1A accepted)

## FINAL SHA
See the commit that carries this section (`git log -1` on the lane branch).

## FILES CHANGED
-  M docs/exams/assessment-adaptation/EA1A_LEARNING_APPROACH_PROFILES_AND_STEM_PLUS.md
-  M tests/unit/ea1-assessment-adaptation.test.ts
-  M tests/unit/qb-production-os.test.ts
- ?? docs/exams/question-bank/QB_R2D_LIVE_MULTI_PROFILE_GENERATION.md
- ?? docs/exams/question-bank/pilots/qb-r2d/
- ?? scripts/operations/qb-r2d/
- ?? src/lib/exam-core/question-bank/production/generator/specification-generation.ts
- ?? src/lib/exam-core/question-bank/production/math-construct-registry.ts
- ?? src/lib/exam-core/question-bank/production/specification-candidate.ts
- ?? src/lib/exam-core/question-bank/production/specification-validators.ts
- ?? tests/unit/qb-r2d-live-replay.test.ts
- ?? tests/unit/qb-r2d-specification-generation.test.ts
- docs/orchestration/status/L2_STATUS.md
- docs/orchestration/reports/L2_ASSESSMENT_ENGINE_QUESTION_BANK.md

## LOCKS USED
`ASSESSMENT_ADAPTATION` and the Question Bank production contracts (additive: specification-driven generation entry point, constructed-response contract, specification validators). No schema, migration, database, ingestion, pool, approval, rights record, deployment, merge or push. Live provider calls: 35, made by a lane script outside `src/`, bypassing the application's AI gateway because the gateway writes to a database.

## TESTS
- `npx tsc --noEmit -p tsconfig.json` — exit 0
- `npx vitest run` — 519 files / 9,339 tests, 0 failures (baseline 517 / 9,298); includes an offline replay of the live recording that reproduces the stored artifacts byte for byte
- `npx next build` — exit 0
- Ephemeral database certifications (temporary local Postgres): reviewer governance, CURR-PAA, B2-B1, B2-B2, platform chain — all exit 0
- 82 migration files, none added; no `.env*` in the tree; no provider key in any lane artifact

## FINDINGS
| Gate | Value |
|---|---|
| LIVE_PROVIDER | PASS — OpenAI `gpt-5.6-luna`, the model the repository routes question generation to |
| SPEND_USD | 1.55 on the lane's assumed high price basis (USD 5 / 30 per million tokens); 0.06 on the repository's configured price table. Neither is an invoice. Cap 20. 35 calls: 20 first, 4 retries, 11 regenerations |
| GENERATED_ITEMS | 26 (16 first attempts + 10 regenerations) covering all 20 selected adaptations |
| STRUCTURAL_VALIDATION | 17/26 |
| PROFILE_COMPLIANCE | 25/26 |
| CONSTRUCT_PRESERVATION | 25/26 not contradicted (19 pass, 6 weak, 1 fail) |
| ANSWER_VALIDATION | 26/26 not failed — MACHINE_VERIFIED 6, DETERMINISTIC_RULE_VERIFIED 13, HUMAN_REVIEW_REQUIRED 7, FAILED 0 |
| MACHINE_RECOMPUTATION | 14/14 applicable |
| STIMULUS_INTEGRITY | 4/4 applicable |
| ORIGINALITY | 24/26 (two items share one parameter set) |
| LINEAGE_COMPLETENESS | 26/26 |
| MULTI_PROFILE_SAME_FAMILY_PROOF | FAIL on the criterion fixed before the run (the Cambridge item breaks the response contract; its one regeneration was refused). Substance holds: six items on five systems, one invariant hash, keyed equations parse to the declared rate and start |
| STANDARD_VS_STEM_PLUS_PROOF | PASS, two caveats (the passing school STEM_PLUS item is a regeneration; one PAA STEM_PLUS item reuses another item's numbers) |
| GENERATOR_READY_FOR_DEV_SCALE | NO |
| GENERATOR_READY_FOR_PILOT_CONTENT | NO |
| READY_FOR_BANK_INGESTION | NO |
| QUESTION_BANK_READY | FAIL |

- First-attempt reliability: 16 of 20 first answers well formed; 8 of 20 passed every automated check. After one regeneration per failure: 8 pass, 7 pass with human review required, 5 fail.
- No wrong key in 30 well-formed responses.
- Defects found only by reading: selected-response items that ask "which option formulates correctly" with a give-away key; IB and Cambridge items below paper level with one command term bent onto every part; construct drift in the optimum family (factors handed over) and one probability item; specification vocabulary leaking into learner text; unrealistic magnitudes.
- VALIDATOR REVISION DISCLOSURE: the validators were revised once after the first replay. Revision 1 on the 16 first-attempt items: structural 16/16, profile 11/16, construct 11/16, answers 10/16 with 6 FAILED, recomputation 4/7. Most of those failures were validator false positives (fractions read as decimals, verdict-keyed items, contract defects reported as wrong answers); revision 2 corrected them and ADDED checks. No threshold was lowered. The validators were tuned on the items they score, so the revision-2 numbers do not predict the next batch.
- Specification findings (EA-1 / EA-1A, not the provider): the school STANDARD specification pairs selected response with multi-mark parts, which no closed item can realise; one command term per specification is too coarse for multi-part items; a specification fixes no mark total.
- Harness finding: the constructed-response template shows the provider the fixed instruction and then refuses its use (4 of 5 harness refusals); JSON-object mode was used instead of the strict JSON-schema mode the repository's runner uses.
- Rights: provider, model, date and run recorded; no terms or licence evidence exists in the repository; every candidate is RIGHTS_NOT_ESTABLISHED.
- Governance: the application's AI governance ledger has no record of these 35 calls; the lane ledger is `docs/exams/question-bank/pilots/qb-r2d/spend-ledger.json`.
- Details: `docs/exams/question-bank/QB_R2D_LIVE_MULTI_PROFILE_GENERATION.md`.

## BLOCKERS
NONE for this certification. For dev scale: template fix for the fixed instruction, strict schema mode, per-part command terms, a mark total on the specification, selected-response stem patterns, and validators re-measured on a batch they were not tuned on.

## CHANGE_REQUESTS
NONE

## MERGE RECOMMENDATION
Keep on the lane branch. The lane does not merge.

## NEXT SAFE ACTION
Orchestrator review. Suggested next: QB-R2E — fix the five generator/specification findings, then re-run a fresh 20-item live batch with frozen validators (well inside the remaining budget).
