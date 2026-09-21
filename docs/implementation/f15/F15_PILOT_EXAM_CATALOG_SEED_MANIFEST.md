# F15-C1 — Pilot Exam Catalog Seed: Manifest, Provenance, and Rollback

Preview only. Never applied to Production. Every value below is a non-sensitive id, table name, or catalog label — no connection string, hostname, credential, or personal data appears anywhere in this document.

## Why this exists

Student A's real, already-deployed self-service Exam Profile flow (`/dashboard/exam-prep`, `CreateExamProfileForm.tsx`) correctly showed "no exams published yet" because Preview genuinely had zero `exam_definitions.status = ACTIVE` rows with a `PUBLISHED` `exam_versions` row. A read-only dry-run (via a temporary diagnostic route) further discovered that `canonical_subjects` was **completely empty** — not just missing a Math entry. The seed's own explicit rule ("never invent a canonical-concept equivalence") correctly aborted at that point rather than proceeding.

## Operator authorization (2026-09-21)

The operator explicitly authorized a narrow, Preview-only exception: if `canonical_subjects` remained completely empty, the seed could create exactly one canonical subject (`Mathematics`) and one canonical concept (`Linear Equations`) under it. This authorization:
- Does **not** apply to Production.
- Does **not** convert this data into an official academic catalog specification.
- Is scoped **only** to a totally empty table — if any canonical subject already existed (even an unrelated one), the seed's original strict abort-and-report behavior still applies.

## Classification labeling

`canonical_subjects`/`canonical_concepts` have no metadata/provenance column (confirmed directly from the real migration DDL, `database/migrations/20260922_1000_f4_learning_architecture_2.sql`). Per the operator's own instruction, the schema was **not** altered to add one. Classification is instead recorded:
1. In `canonical_concepts.description` (a real, pre-existing free-text column) for the one row that supports it.
2. Exhaustively, in this document, for every row this run created (including the ones with no free-text column at all, like `canonical_subjects`).

**Classification tag applied**: `PILOT_FIXTURE / NON_OFFICIAL / PREVIEW_ONLY`

## Read-only verification before any write

```
dbFingerprint: 53d158d5811e7ee0
environment: preview
canonicalSubjectToCreate: {"name":"Mathematics","willCreate":true}
canonicalConceptToCreate: {"name":"Linear Equations","subject":"Mathematics","willCreate":true}
protectedTableCountsBefore: {"students":11,"users":11,"profiles":15,"institutions":0,"institutionMemberships":0}
```

`pilotExamCatalogEntitiesToCreate` (16-step full plan, confirmed complete only after fixing a real dry-run bug — see "Bug found and fixed" below): AcademicOrganization, AcademicProgramme, AcademicSubject, StructureVersion, StructureNode, LearningObjective, CanonicalSubject, CanonicalConcept, ObjectiveConceptMapping, ExamDefinition, ScoringModel, ExamVersion, AssessmentComponent, AssessmentBlueprint, BlueprintComponentAllocation, BlueprintObjectiveTarget.

## Bug found and fixed before any write was attempted

The first live dry-run against Preview reported only 5 of the expected 16 steps (stopping after `ScoringModel`) — a real bug, not the expected empty-catalog report. Root cause: each step's own "would create" branch left its id `undefined` in dry-run mode (a real id was only ever assigned inside the `if (write)` branch), so every downstream step's `if (parentId)` guard silently evaluated false and was skipped — not even logged. Fixed by assigning a cascading placeholder (the nil UUID, `00000000-0000-0000-0000-000000000000`) whenever an entity "would be created" during a dry run, so every downstream natural-key lookup still runs (safely matching zero real rows) and every downstream step still reports what it too would create. Covered by a new regression test reproducing the exact failure. Re-verified live after the fix: the dry-run correctly reported all 16 steps.

## Manifest of entities created (this run, `--write`, 2026-09-21)

| # | Table | ID | Name | Classification |
|---|---|---|---|---|
| 1 | `academic_organizations` | `8a6af6f4-527d-4d1b-aa73-7ef292aaf18c` | College Board | — |
| 2 | `academic_programmes` | `30012134-f34f-4e63-8ad5-0d798a5391c4` | PAA (Pilot) | — |
| 3 | `academic_subjects` | `48f22020-e089-4ecd-9b20-a256fa6d30da` | Mathematics (Pilot) | — |
| 4 | `structure_versions` | `a2aaf90e-d064-4613-92f1-c6dc29d5702f` | Pilot 2026 v1 | — |
| 5 | `structure_nodes` | `57587c09-a3c2-4070-958e-dc532c8ad547` | Mathematics (Pilot Catalog) | — |
| 6 | `learning_objectives` | `57f139ff-73b9-4e0c-8d8f-5ba3ba2e17ea` | Pilot configuration objective for PAA Mathematics -- non-official, functional placeholder only. | — |
| 7 | `canonical_subjects` | `4b48d40c-087f-4a66-bb36-cb1be00bf008` | Mathematics | **PILOT_FIXTURE / NON_OFFICIAL / PREVIEW_ONLY** |
| 8 | `canonical_concepts` | `cfbd771b-d21b-4939-86d7-7b59574a5d2e` | Linear Equations | **PILOT_FIXTURE / NON_OFFICIAL / PREVIEW_ONLY** |
| 9 | `objective_concept_mappings` | `884ef177-34a1-46b1-874f-5015cf2e34c2` | objective -> Linear Equations | — |
| 10 | `exam_definitions` | `cd8ae288-0914-434e-9ffc-962851f15091` | PAA Mathematics (Pilot) | — |
| 11 | `scoring_models` | `28b01a19-e7fa-40b5-a4ba-6a95f0b6aa8f` | PAA Mathematics Pilot Scoring (no finalized formula yet) | — |
| 12 | `exam_versions` | `56a95947-327e-4171-b328-affe58484c3f` | Pilot 2026 v1 | — |
| 13 | `assessment_components` | `1fc151d4-eb3b-41cc-a23e-dbf911aef424` | Mathematics | — |
| 14 | `assessment_blueprints` | `01979524-a821-4888-8130-7d0099cbc123` | blueprint for Pilot 2026 v1 | — |
| 15 | `blueprint_component_allocations` | `01979524-a821-4888-8130-7d0099cbc123:1fc151d4-eb3b-41cc-a23e-dbf911aef424` | blueprint <-> Mathematics | — |
| 16 | `blueprint_objective_targets` | `af54d708-b6b7-443a-b957-71faa860dcf2` | objective <-> Mathematics | — |

**Deliberately NOT created**: any `users`, `students`, `profiles`, `institutions`, or `institution_memberships` row; any institution policy; any `@test.local` (or other fabricated) email/identity.

**Deliberately left unattached**: the exam version's `scoring_model_id` — the scoring model above exists as a real row but is not wired to the exam version. This is not an oversight; see "Full Mock stays honestly NOT_READY" below.

## Idempotency proof

A second `--write` execution, immediately after the first, reported:
```
plan actions: {EXISTS}   (every one of the 16 steps)
manifestCreated: []      (zero new rows)
examDefinitionId / examVersionId / blueprintId: identical to the first run's ids
```

## Post-write verification (via `/api/diagnostics/preview-db`, unrelated to the now-removed trigger route)

```
dbFingerprint: 53d158d5811e7ee0   (unchanged)
identityCounts: studentsTotal 11, usersTotal 11, profilesTotal 15, ... (all unchanged from before this seed)
institutionsCount: 0              (unchanged)
activeExamDefinitionCount: 1
publishedExamVersionCount: 1
publishedBlueprintCount: 1
activeDefinitionNames: ["PAA Mathematics (Pilot)"]
publishedVersionLabels: ["Pilot 2026 v1"]
```

Exactly one of each required entity exists, discoverable by name — confirming `listAvailableExamOptions()` will return this exam to the self-service UI.

## Full Mock stays honestly NOT_READY

The exam version's `scoring_model_id` is deliberately left unset. `canFullMockBeOffered()` (F7, unmodified) reports `ready: false` with reason `NO_SCORING_MODEL_CONFIGURED` whenever a scoring model isn't attached — a real, honest fact (no finalized PAA scoring formula exists for this pilot), not a fabricated blocker. `TOPIC_EXAM`/`DOMAIN_EXAM`/`MINI_MOCK` never depend on a scoring model and remain genuinely eligible once the Mathematics component's timing/tool-rules/support are all configured (which this seed did configure). This will be re-confirmed live during the authenticated E2E session.

## Temporary trigger route lifecycle

| Step | Deployment | `target` |
|---|---|---|
| Route added, strong auth added | `dpl_3BMLSCsvJKi3Sg4jbYZEYmDoMmzh` (`study-6yo9n2kse-study-so.vercel.app`) | `preview` |
| Dry-run + `--write` + idempotency check executed against this deployment | same | `preview` |
| Route + its `SEED_TRIGGER_TOKEN` env var removed from the codebase and from Vercel | — | — |
| Clean redeploy without the route | `dpl_5URUSRGrDDucNV2EWUeFMX7V4JdN` (`study-5ys7e82mg-study-so.vercel.app`) | `preview` |
| Deleted route re-checked | same | Confirmed **404** |

The route required a strong, single-purpose bearer token (`x-seed-trigger-token`, constant-time compared against a random, Preview-only `SEED_TRIGGER_TOKEN` Vercel secret minted solely for this operation — confirmed absent from Production both before and after). It accepted exactly one client field (`write: boolean`); no arbitrary id or other value from a caller ever reached a query.

## Production

Not modified at any point. `SEED_TRIGGER_TOKEN` was confirmed absent from Production's own environment variable list both before creation and after removal. No Production deployment was made.

## Rollback procedure (a recovery guarantee — **not executed**, not the expected outcome)

If this Pilot fixture ever needs to be removed, delete **exactly** the 16 rows in the manifest above, and **only** while none of them have been referenced by anything a real user created (e.g., no real `student_exam_profiles` row points at `exam_definitions.id = cd8ae288-0914-434e-9ffc-962851f15091`, and no real attempt/evidence references the exam version or its blueprint). Delete in **reverse dependency order** (children before parents), each guarded by a `NOT EXISTS` check against any real, non-fixture reference:

1. `blueprint_objective_targets` (id `af54d708-b6b7-443a-b957-71faa860dcf2`)
2. `blueprint_component_allocations` (blueprint `01979524-a821-4888-8130-7d0099cbc123` / component `1fc151d4-eb3b-41cc-a23e-dbf911aef424`)
3. `assessment_blueprints` (id `01979524-a821-4888-8130-7d0099cbc123`) — only if no `simulation_plans`/`exam_attempts` reference it
4. `assessment_components` (id `1fc151d4-eb3b-41cc-a23e-dbf911aef424`) — only if no attempt/response references it
5. `exam_versions` (id `56a95947-327e-4171-b328-affe58484c3f`) — only if no `student_exam_profiles`/`exam_attempts` reference it
6. `scoring_models` (id `28b01a19-e7fa-40b5-a4ba-6a95f0b6aa8f`)
7. `exam_definitions` (id `cd8ae288-0914-434e-9ffc-962851f15091`) — only if no `student_exam_profiles` reference it
8. `objective_concept_mappings` (id `884ef177-34a1-46b1-874f-5015cf2e34c2`)
9. `canonical_concepts` (id `cfbd771b-d21b-4939-86d7-7b59574a5d2e`) — only if no other mapping references it
10. `canonical_subjects` (id `4b48d40c-087f-4a66-bb36-cb1be00bf008`) — only if no other canonical concept references it
11. `learning_objectives` (id `57f139ff-73b9-4e0c-8d8f-5ba3ba2e17ea`)
12. `structure_nodes` (id `57587c09-a3c2-4070-958e-dc532c8ad547`)
13. `structure_versions` (id `a2aaf90e-d064-4613-92f1-c6dc29d5702f`)
14. `academic_subjects` (id `48f22020-e089-4ecd-9b20-a256fa6d30da`)
15. `academic_programmes` (id `30012134-f34f-4e63-8ad5-0d798a5391c4`)
16. `academic_organizations` (id `8a6af6f4-527d-4d1b-aa73-7ef292aaf18c`) — only if no other programme references it

**This procedure exists as a recovery guarantee and was never run.** The expected, actual outcome of this closure is that these 16 rows remain in place and in active use by the pilot.
