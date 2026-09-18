# F7 — Assessment Framework Engine — QA Report

Branch: `f7/assessment-framework-engine`
Base: `origin/f6/curriculum-standards-mapping` @ `cd221ccf3ca6a2435f2557dbe3f14a75a2ba6c58`
HEAD at certification: `0b31e6021aa9e1099ea4a66bbc8459a2b10f379e`
Date: 2026-09-18

## 1. Static verification

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS — zero errors |
| `next build` (production, Turbopack) | PASS — compiled successfully, zero errors, zero type errors during build |
| All new routes present in build route list | PASS — `/api/admin/assessment/exam-definitions`, `/api/admin/assessment/exam-versions`, `/api/admin/assessment/exam-versions/transition`, `/api/admin/assessment/full-mock-guard`, `/api/admin/assessment/institution-policies`, `/api/admin/assessment/institution-policies/verify`, `/api/exam-profiles` all listed as dynamic (`ƒ`) routes |

## 2. Automated test suites

| Suite | Files | Tests | Result |
|---|---|---|---|
| Canonical V2 (`canon-*.test.ts`, `audit-canon-v2-*.test.ts`) | 46 | 915 | ALL PASS |
| Named regression F0-S → F7 (`f0s-*`, `f1-*` … `f7-*`) | 42 | 380 | ALL PASS |
| Full repository suite (`npx vitest run`, no filter) | 326 | 5334 | ALL PASS |

The full-suite run is a superset of the two filtered runs above and is the authoritative zero-regression signal: every pre-existing test in the repository, across every prior phase and Canonical V2, passes unmodified on top of F7's changes.

F7-specific new test files (included in the 380/326 counts above):
- `tests/unit/f7-exam-version-lifecycle.test.ts`
- `tests/unit/f7-item-bank-workflow.test.ts`
- `tests/unit/f7-full-mock-guard.test.ts`
- `tests/unit/f7-evidence-bridge.test.ts`
- `tests/unit/f7-api-routes-security.test.ts`
- `tests/unit/f7-canonical-v2-noninterference.test.ts`

## 3. Real-PostgreSQL migration and adversarial certification

Script: `scripts/operations/f7-assessment-framework-migration-cert.sh` (ephemeral, local-only Postgres — never Neon, never Preview, never Production; remote isolation could not be proven from this environment per task §45).

Steps executed and verified:
1. Fresh `initdb` instance, Unix socket only, no network listener.
2. Baseline schema (`database/baseline/STUDYUS_BASELINE_2026_08.sql`) applied cleanly.
3. Full chronological migration history applied cleanly, ending with `20260925_1000_f7_assessment_framework_engine.sql`.
4. **Idempotency**: the F7 migration was re-applied a second time with zero errors.
5. **Schema verification**: all 14 new F7 tables confirmed present (`exam_definitions`, `exam_versions`, `scoring_models`, `assessment_components`, `command_terms`, `assessment_blueprints`, `blueprint_component_allocations`, `blueprint_objective_targets`, `approved_item_families`, `approved_items`, `student_exam_profiles`, `preparation_goals`, `institution_exam_policies`, `exam_attempts`, `exam_attempt_item_responses`); 6 fixture `command_terms` rows confirmed seeded.
6. **Pilot dataset seed** (`scripts/operations/f7-seed-pilot-dataset.ts`): F1 users, F4 canonical fixture, F6 PAA fixture (4 objectives across PUBLISHED/none/DRAFT-only/RETIRED mapping states), F6 Cambridge contrast fixture (shares the same canonical concept as PAA, different exam family), a second F7 exam_definition for Cambridge, the PAA exam_version + 3 components (fully-configured, tool-rules-missing, fully-unsupported) + published blueprint with 4 objective targets, 2 independent institution_exam_policies (1 verified, 1 pending), 1 learner with a real per-student concept `MATCHED` to the canonical concept, 2 exam profiles.
7. **Adversarial matrix** (`scripts/operations/f7-lifecycle-cert-runner.ts`, task §33 A–N): 27 consecutive assertions, **all PASS**, exercised via real service calls against real Postgres, including the real, unmodified F5 `updateMastery()` function. Summary of what each case proved:

| Case | Result |
|---|---|
| A | Verified institution policy → `evaluatePolicyCompliance` returns exact threshold rules (`minimumScore === 320`) |
| B | Unverified policy → `POLICY_PENDING`, never a guessed verdict; profile remains usable |
| C | Two independent policies on the same exam version confirmed independent; unverified policy's `thresholdRules === null` |
| D | Component with unconfigured tool rules → Full Mock guard `ready: false`, reason names "Statistics" explicitly |
| E/F | DRAFT-only and RETIRED-only mapped objectives both resolve to `null` in the activity metadata bridge — never selectable for generation |
| G | Unsupported component → `validateComponentSupported` fails with `UNSUPPORTED_COMPONENT` |
| H | Mismatched candidate item → `validateItemForExamContext` fails with `DIFFICULTY_OUT_OF_RANGE` |
| I | Partial-credit result recorded and read back byte-for-byte (`marksAwarded.algebra === 1`) |
| J | `frozenConfiguration` unchanged after real post-start config/mapping changes; live rows demonstrably did change |
| K | Reordering a curriculum node's `order_index` has zero effect on `getObjectiveTarget(...).targetItemCount` (INV-F6-05/INV-F7-05) |
| L | Real learner exam response → exactly 1 real `learner_skill_state` row via unmodified F5 pipeline |
| M | Zero `learner_competency_state` rows fabricated for a contextually-relevant-only competency |
| N | PAA and Cambridge share the same `canonical_concept_id`; exam families genuinely differ (`ADMISSION_EXAM` vs `SUBJECT_ASSESSMENT`) |

Full log ends with:
```
All F7 adversarial certification assertions passed against real PostgreSQL.
=== F7 migration + adversarial certification: ALL CHECKS PASSED ===
```

## 4. Non-interference verification (Canonical V2 and F0-S–F6)

`tests/unit/f7-canonical-v2-noninterference.test.ts` asserts, at the source level, across every F7 lib and route file:
- No import of `pedagogical-engine`, `pedagogical-decision`, `pedagogical-shadow`, or `pedagogical-migration`.
- No call to `evaluateCanonicalLearningState`, `rebuildConceptCanonicalState`, or `qualifyEvidence`.
- No direct SQL write to any Canonical-V2-owned table.
- No direct `INSERT INTO learning_evidence` — the evidence bridge writes exclusively through the real, unmodified `updateMastery()`.
- No route exposes `PROVE_PASSED`/`PRACTICE_PASSED`/`RETAIN_PASSED`/`TRANSFER_PASSED` vocabulary.
- Blueprint objective targets reference `learning_objectives(id)` only — never `structure_node_id` — at the schema level.
- The timing/tool-rule and institution-policy-threshold CHECK constraints exist at the schema level.

This is corroborated at the behavioral level by the unmodified Canonical V2 suite (46 files / 915 tests, section 2) and the F0-S–F6 named suites (part of the 42/380 count) all passing unchanged.

## 5. Known non-blocking items

- `next.config.js` middleware-convention deprecation warning (`proxy` vs `middleware`) — pre-existing, unrelated to F7, not introduced by this phase.
- No `.eslintrc`/lint step was part of this phase's required gates; `tsc --noEmit` and `next build`'s own type-checking pass were used as the static-correctness gate per the established F1–F6 pattern.

## 6. Overall QA verdict

**PASS.** Zero regressions across 5334 total tests, zero TypeScript errors, a clean production build with all new routes present, and a real-PostgreSQL adversarial certification covering all 14 required matrix cases with zero fixes needed after the first run.
