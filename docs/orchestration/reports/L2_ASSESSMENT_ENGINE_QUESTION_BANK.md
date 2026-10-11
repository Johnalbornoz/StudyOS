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

---

# L2 — QB-R2E FROZEN-VALIDATOR LIVE BATCH (2026-10-11)

## LANE
L2 — ASSESSMENT ENGINE / QUESTION BANK — worktree `/Users/jalbornoz/PROYECTOS/studyos-qb-r1a`, branch `feat/qb-r2e-frozen-validators`.

## STATUS
READY_FOR_ORCHESTRATOR_REVIEW

`QB_R2E_STATUS = FAIL` — run exactly as pre-registered; the frozen evaluator returns GENERATOR_READY_FOR_DEV_SCALE = NO (9 of 14 criteria failed). In addition two genuine validator defects were found after the batch, so under the Orchestrator's rule the batch is INVALIDATED as certification evidence. The NO does not depend on either defect.

## BASE SHA
6ebab9a (QB-R2D)

## FINAL SHA
Freeze commit 9fe68d01d8649548f453873acec633f4a3dead5e; results in the following commit (`git log -1` on the lane branch).

## FILES CHANGED
Freeze commit: generator v2, validators revision 3, adaptation-specification marks and command terms, QB-R2E scripts, pre-registration, freeze manifest, tests (see `git show --stat 9fe68d0`).
Results commit:
- docs/exams/question-bank/pilots/qb-r2e/ (recording, ledger, selection, specifications, batch, validation report, gate evaluation, two proofs, rights record)
- docs/exams/question-bank/QB_R2E_FROZEN_VALIDATORS_AND_PRE_REGISTRATION.md (results appended below the pre-run text)
- tests/unit/qb-r2e-live-replay.test.ts
- docs/orchestration/status/L2_STATUS.md, docs/orchestration/reports/L2_ASSESSMENT_ENGINE_QUESTION_BANK.md

## LOCKS USED
`ASSESSMENT_ADAPTATION` and the Question Bank production contracts. 26 live provider calls from a lane script outside `src/` (application AI gateway bypassed: it writes to a database). No schema, migration, database, ingestion, pool, approval, rights record, deployment, merge or push. No frozen file changed after 9fe68d0 (`git diff --quiet` clean; `--verify-freeze` ok).

## TESTS
- `npx tsc --noEmit -p tsconfig.json` — exit 0
- `npx vitest run` — 521 files / 9,396 tests, 0 failures; includes offline byte-for-byte replays of the QB-R2D and QB-R2E recordings
- `npx next build` — exit 0
- Ephemeral database certifications: reviewer governance, CURR-PAA, B2-B1, B2-B2, platform chain — all exit 0
- 82 migration files, none added; no provider key in any artifact

## FINDINGS
| Field | Value |
|---|---|
| QB_R2E_STATUS | FAIL (batch also INVALIDATED as certification evidence: validator defects V1, V2) |
| VALIDATOR_FREEZE_SHA | 9fe68d01d8649548f453873acec633f4a3dead5e (manifest dc7549e5…3b18c5) |
| LIVE_PROVIDER | PASS — OpenAI `gpt-5.6-luna`, strict JSON schema accepted; 0 malformed answers in 26 calls |
| FRESH_ITEMS | 22 candidates (18 first attempts + 4 regenerations) over 20 new adaptations; 2 adaptations ended with no candidate |
| FIRST_ATTEMPT_STRICT_PASS | 11/20 (required ≥ 16) — FAIL |
| AFTER_ONE_REGEN_STRICT_PASS | 12/20 |
| STRUCTURAL_COMPLIANCE | 18/20 — FAIL |
| PROFILE_COMPLIANCE | 17/20 — FAIL |
| CONSTRUCT_PRESERVATION | pass 13, weak 5, fail 2 — FAIL (fail = 0 and weak ≤ 2 both missed) |
| ANSWER_VALIDATION | failures 2 — FAIL; final items: machine verified 2, deterministic rule 5, human review required 11, no candidate 2 |
| MACHINE_RECOMPUTATION | 10/10 applicable |
| STIMULUS_INTEGRITY | 3/3 — PASS |
| ORIGINALITY | material failures 2 — FAIL (the two no-candidate adaptations; all 18 final candidates pass) |
| LINEAGE_COMPLETENESS | 18/20 — FAIL |
| MULTI_PROFILE_SAME_FAMILY_PROOF | PASS on the letter: 3 clean systems of 5 (Cambridge, ICFES, PISA) |
| STANDARD_VS_STEM_PLUS_PROOF | FAIL (PAA pair: the regenerated baseline fails profile compliance; school and PISA pairs pass) |
| LEARNER_TEXT_SPECIFICATION_LEAKAGE | 0 — PASS |
| ASSUMED_CUMULATIVE_SPEND_USD | 3.005135 of 5.00 (R2D 1.550575 + R2E 1.454560; 26 calls). Assumed high price basis, not an invoice |
| GENERATOR_READY_FOR_DEV_SCALE | NO |
| GENERATOR_READY_FOR_PILOT_CONTENT | NO |
| READY_FOR_BANK_INGESTION | NO |
| QUESTION_BANK_READY | FAIL |

- The two adaptations with no candidate (IB Paper 1 rate comparison; PISA optimum) fail every per-item criterion by the pre-registered definition and account for the whole shortfall in structural, lineage, answer, construct-fail and originality. Among the 18 final candidates the validators found no structural failure, no contradicted key, no construct contradiction and no lineage gap.
- V1, validator false positive (revision 2): two opposite true/false options were read as "the same number" because the only numeral was a label; it failed a sound first attempt. Without it first-attempt strict pass would be 12/20.
- V2, validator false negative (revision 2): an equation not written as "… = 0" was not parsed, and a WRONG key (first attempt of the Cambridge factorising item) was classed deterministic-rule-verified. The item failed on another gate and was regenerated, so no final item carries the error.
- Lane defect: the fixed-instruction trap was removed from the constructed-response template only; the numeric-entry template still has it and caused both refusals of the PISA optimum adaptation.
- Provider contract failure: the IB Paper 1 item twice returned two answers with the same part label.
- Reading findings not caught by validators: meta-stems phrased differently from the pattern; a stimulus text that hands over the model; near-duplicate scenarios in the school pair; reused numbers across one family; IB and Cambridge items still elementary; some implausible contexts.
- Pre-registered readings chosen by the lane before the run: strict pass may carry answer HUMAN_REVIEW_REQUIRED (reported separately); "WEAK/HUMAN_REVIEW ≤ 2/20" read as the construct gate; no transport retries; a heuristic flag or construct WEAK blocks a strict pass.
- B5_CANONICAL_RUNTIME_DEPENDENCY = RESOLVED_EXTERNALLY_BY_L13 (Orchestrator ruling). The lane did not touch Stage in this phase.
- Details: `docs/exams/question-bank/QB_R2E_FROZEN_VALIDATORS_AND_PRE_REGISTRATION.md` (sections R1–R9).

## BLOCKERS
- A further fresh batch (required by the invalidation rule) does not fit the remaining assumed-price budget on a worst-case basis: 1.99 left under the 5.00 cap, 3.39 worst case for 40 calls (the last batch actually used 1.45). Orchestrator decision needed on the cap.

## CHANGE_REQUESTS
NONE

## MERGE RECOMMENDATION
Keep on the lane branch. The lane does not merge.

## NEXT SAFE ACTION
Orchestrator rules on budget and on whether to run QB-R2F: fix V1, V2, the numeric-entry trap and duplicate part labels; widen the meta-stem heuristic; new freeze SHA; completely fresh batch. No provider call until then.

---

# L2 — CR-L8-01 ASSESSMENT SIDE + QB-R2F OFFLINE REMEDIATION (2026-10-11)

## LANE
L2 — ASSESSMENT ENGINE / QUESTION BANK — worktree `/Users/jalbornoz/PROYECTOS/studyos-qb-r1a`. Two branches: `feat/l2-cr-l8-01-subject-aggregates` (release dependency, base `4fb45b0`) and `feat/qb-r2f-offline-remediation` (generator track, base `4b24816`).

## STATUS
READY_FOR_ORCHESTRATOR_REVIEW

| Field | Value |
|---|---|
| CR_L8_01_ASSESSMENT_SIDE | PASS |
| SUBJECT_AWARE_AGGREGATES | PASS |
| L2_RELEASE_DEPENDENCY | CLOSED |
| GENERATOR_REMEDIATION_OFFLINE | PASS |
| R2F_READY_FOR_LIVE_RUN | YES — offline; the run cannot start under the current cap |
| MINIMUM_REQUIRED_CAP | USD 7.25 cumulative (assumed-high-price basis) |
| CURRENT_ASSUMED_CUMULATIVE_SPEND_USD | 3.005135 (no call made in this phase) |

## BASE SHA
4fb45b0 (CR-L8-01) and 4b24816 (QB-R2F).

## FINAL SHA
CR-L8-01: f54cc14 on `feat/l2-cr-l8-01-subject-aggregates`. QB-R2F: the freeze commit that carries this section on `feat/qb-r2f-offline-remediation` (`git log -1`).

## FILES CHANGED
CR-L8-01 (f54cc14): `src/lib/exam-core/exam-gaps.service.ts`, `tests/unit/l2-cr-l8-01-subject-aware-gaps.test.ts`, `scripts/operations/l2-cr-l8-01-subject-gaps-cert.sh`, `scripts/operations/l2-cr-l8-01/subject-gaps-cert.ts`, `docs/orchestration/reports/L2_CR_L8_01_ASSESSMENT_SIDE.md` (the contract for L8 / L10 is in that report).
QB-R2F: new `src/lib/assessment-adaptation/item-demand-policy.ts`, `production/specification-validators-r4.ts`, `production/generator/specification-generation-v3.ts`, `scripts/operations/qb-r2f/`, `tests/fixtures/qb-r2f/known-defects.json`, `tests/unit/qb-r2f-offline-remediation.test.ts`, `docs/exams/question-bank/pilots/qb-r2f/validator-freeze.json`, `docs/exams/question-bank/QB_R2F_OFFLINE_REMEDIATION.md`; three file-list guard tests updated; this report and the status file.

## LOCKS USED
Exam core and `ASSESSMENT_ADAPTATION` (L2's own). No `SHARED_FOUNDATION`, no `SCHEMA_AND_MIGRATIONS`, no Stage, no shared database, no provider call, no ingestion, no merge, no push.

## TESTS
- CR-L8-01 branch: 7 unit tests; ephemeral-database certification of the real query, 18 checks PASS; tsc exit 0; 520 files / 9,297 tests; build exit 0.
- QB-R2F branch: tsc exit 0; 522 files / 9,445 tests (49 new); build exit 0; five ephemeral DB certifications exit 0; QB-R2D and QB-R2E replays byte-identical; the QB-R2E frozen files are identical to 9fe68d0.

## FINDINGS
- CR-L8-01: `examGapsFor(studentIds, { families?, includePerStudent, canonicalSubjectIds? })`. Absent = unscoped as before; given = every aggregate built only from gap objectives with a published concept of those canonical subjects; objective with no mapping omitted; empty / malformed / unknown scope returns nothing. No authorization change. Callers (L10 `getTeacherClassExamGaps`, L8) still have to pass the option.
- QB-R2F: the nine findings are fixed in new versioned files (validators revision 4, generator version 3, a StudyUs item-demand policy); nothing frozen for QB-R2E was edited. Every known QB-R2D / QB-R2E defect has a deterministic fixture built from the actual recorded response and a passing test, or is listed as not deterministically catchable (context plausibility, paper-level difficulty, register, whether a worded verdict is the right choice, give-away stems and near-duplicate scenarios in general).
- Validator change log r3 → r4: one relaxation (the demonstrated option-numeral false positive); the equation defect is a tightening; added stricter checks (stated-equation, model-in-stimulus, item demand, batch diversity, wider item-writing flags). A test asserts no gate improves except through that fix or named evidence.
- Diagnostic over the stored QB-R2D and QB-R2E candidates (not certification evidence, not a rescore): 17 of 48 outcomes change; the wrong key of QB-R2E 13 a1 is now FAILED; the sound item 18 a1 now passes; three items newly fail on the item-demand policy, which is new strictness.
- New freeze prepared and committed with the cap still at 5.00: manifest hash fe76a301…3fdffa. The cap constant is part of the frozen run parameters, so raising the cap requires a re-freeze commit (validators unchanged) before the run.
- Cost: worst case for 20 first calls + 20 regenerations is 4.23 → cumulative 7.24; expected from QB-R2E usage about 1.2–2.3. The plan-level guard refuses to start.

## BLOCKERS
Orchestrator authorization of the cap (MINIMUM_REQUIRED_CAP = 7.25) before any QB-R2F live call.

## CHANGE_REQUESTS
To L10: pass `canonicalSubjectIds` from `getTeacherClassExamGaps` (see `L2_CR_L8_01_ASSESSMENT_SIDE.md` on the CR branch).

## MERGE RECOMMENDATION
CR-L8-01 (f54cc14): merge into the convergence line. QB-R2F: keep on the lane branch.

## NEXT SAFE ACTION
Orchestrator rules on the cap. With authorization: set the cap, re-write and re-commit the freeze, verify, run the fresh batch.
