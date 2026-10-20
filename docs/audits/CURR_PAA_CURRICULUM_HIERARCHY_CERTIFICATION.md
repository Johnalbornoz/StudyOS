# CURR-PAA — PAA Curriculum Hierarchy

Materialises the certified PAA hierarchy through the Curriculum Authority and adds the item-version → curriculum-node link (B2-B0 migration 10). Branch `feat/curr-paa-hierarchy`, cut from `47ba817`.

## 1. How the canonical structure holds it

B0 X.11: Domain and Topic are curriculum structure (`structure_nodes` of a `structure_version`), objectives hang from nodes, and nodes of type `EXAM_SECTION` are bootstrap-origin assessment groupings, not hierarchy.

State found on DEV for `v2.paa` (read-only):

| Section | Structure version | Status | Bootstrap node | Objectives |
|---|---|---|---|---|
| Lectura | V2.1 PAA revisada | PUBLISHED | `sec.lectura` | 6 |
| Redacción | V2.1 PAA revisada | PUBLISHED | `sec.redaccion` | 6 |
| Matemáticas | V2.1 PAA revisada | **DRAFT** | `sec.matematicas` | 5 |
| Inglés | V2.1 PAA revisada | PUBLISHED | `sec.ingles` | 3 |

Each section is its own academic subject with one structure version and one `EXAM_SECTION` node carrying all its objectives. The Matemáticas version is a draft because that subject already had a published version from the retired `v2.paa.math` configuration; this phase does not change it. Three other PAA configurations exist (`dev-cert.paa`, retired `v2.paa.math`, the legacy pilot) and are not touched.

## 2. What was built

| Piece | Where |
|---|---|
| Certified hierarchy as data: 4 Sections, 17 Domains, 84 Topics, with authority, source reference and certified concept per Topic | `src/lib/curriculum/paa/paa-hierarchy.ts` (compared row by row with `Q1C1_paa_certified_topics.csv` by a test) |
| Materialisation through `createStructureNode`; idempotent by (structure version, code) | `src/lib/curriculum/paa/paa-hierarchy.service.ts` |
| Governed objective re-parenting (same structure version, id kept) | `reparentLearningObjective` in `src/lib/curriculum/objective.service.ts` |
| Bootstrap finds an objective by code within its structure version | `ensureLearningObjective` in `src/lib/curriculum/bootstrap.service.ts` |
| Migration 10: `question_bank_item_curriculum_nodes` | `database/migrations/20261111_1000_qb_item_curriculum_nodes.sql` |
| Read-only traceability of item versions | `src/lib/curriculum/item-traceability.service.ts` |
| Operator script (dry-run by default; DEV or ephemeral only) | `scripts/operations/curr-paa-hierarchy.ts` |

Nodes: `SECTION` (`paa.sec.<section>`) → `DOMAIN` (`paa.dom.<section>.<domain>`) → `TOPIC` (`paa.topic.<NNN>`, NNN = order in the certified artefact). A Topic node's `source` is its authority (83 `OFFICIAL`, 1 `STUDYUS_POLICY`) and `source_locator` its page reference. No PAA-specific table exists. The bootstrap `EXAM_SECTION` nodes stay as they are.

Topic → Concept: each Topic names its certified concept in the data module (61 concepts, all reached; two English Topics have none certified). There is no node ↔ concept table in the canonical schema, so this relation is not stored in the database; concepts stay reachable through objective mappings and, for new items, through item attribution.

## 3. Objectives: 20 historical, 17 official Domains

Nineteen objectives belong to exactly one Domain; two Domains hold two objectives each (*Análisis, interpretación e inferencias*: `paa.lect.inferencia`, `paa.lect.evidencia`; *Análisis de datos y Probabilidad*: `paa.mat.datos`, `paa.mat.probabilidad`). `paa.red.cohesion` belongs to none.

The governed migration is the one B0 froze: objectives keep their ids and are moved under their Domain node by `reparentLearningObjective`. Items, blueprint targets, mappings and attempts reference the objective id, so nothing they point at changes. It is implemented, and certified on an ephemeral database: 19 moved, ids, codes, mappings, items and targets identical, cohesion left under its section node, seeds re-run without creating a twin.

**It is not applied to DEV in this phase.** Moving the objectives changes one existing reader outside Curriculum: the learning-plan topic list (`buildCurriculumTopics`) switches from objective-titled topics to node-titled ones as soon as an objective hangs from a non-assessment node, and it then drops objectives that still hang from an assessment node. For PAA that means topics become the official Domains and the concept of `paa.red.cohesion` leaves the list. A unit test pins this behaviour. That is a product change for a Student-facing reader and needs a decision, not a side effect of a curriculum rollout.

`paa.red.cohesion`: not deleted, not retired, not moved. It is still a target of the legacy `v2.paa` blueprint. Its future dependency ends when a PAA variant built on the 17 Domains replaces that blueprint (B2). The canonical concept *Cohesión y conectores* is untouched.

## 4. Migration 10 and eligibility condition 5

`question_bank_item_curriculum_nodes (approved_item_id PK, structure_node_id, linked_by, linked_at)`:

- one row per item version;
- the node is an active `TOPIC` whose parent is an active `DOMAIN`;
- the node is in the structure version of the item's own objective;
- the link is fixed once the version is in use or closed, and never updated in place;
- a traced Topic and the Domain above it cannot be re-typed, re-parented or moved to another version.

So a new PAA item has exactly one certified Topic and, through it, exactly one official Domain — by construction. No link is created for legacy items. Without objective re-parenting the rule "the Topic's Domain is the Domain of the item's objective" is reported (`objectiveUnderSameDomain`) but not enforced.

`PAA_CURRICULUM_TRACEABILITY = PASS`, `PILOT_ELIGIBILITY_CONDITION_5 = REPRESENTABLE`. It is not yet read by B1 eligibility.

## 5. Ephemeral certification

`scripts/operations/curr-paa-hierarchy-cert.sh` (local temporary Postgres 18):

| Check | Result |
|---|---|
| Chain to `20261110_1700` + seeds, then `20261111_1000` on populated data | 81 applied, 0 pending, 0 drift |
| Hierarchy dry run | reports 4 / 17 / 84 and writes nothing |
| Hierarchy write, then write again | 105 nodes created; second run creates 0 |
| Per section | Lectura 5 Domains / 20 Topics; Redacción 5 / 5; Matemáticas 4 / 44; Inglés 3 / 15 |
| Everything outside the hierarchy (objectives and their placement, nodes of every other configuration, structure versions, mappings, concepts, items, blueprint targets) | hash-identical |
| Traceability invariants (`curr-paa/traceability-invariants.sql`) | 21 pass |
| Condition 5 through the application: 17 new items, one per Domain | 7 checks pass |
| Seeds re-run | unchanged |
| Objective re-parenting: dry run, write, write again | 19 moved, then 19 already in place; only placement differs |
| Seeds after re-parenting | unchanged; 0 duplicate objective codes per version |
| Rollback of `20261111_1000`, re-apply | 0 pending |

Also on this branch: tsc clean; 500 files / 8,913 tests, 0 failures; platform chain certification 12 of 12 steps; B2-B1 schema certification unchanged; production build exit 0.

The ephemeral seed differs from DEV: 410 fixtures and no attempts, and its Matemáticas V2.1 version is published where DEV's is a draft.

## 6. DEV rollout (2026-10-10)

DEV only (fingerprint `2a29b99ee14a22b4`). Stage and Production were not touched.

Before the write the DEV ledger held 81 rows, not the 80 this line left: another line had applied `20261110_1800_assessment_snapshot` (a nullable `assessment_snapshot` column on `quiz_sessions` and `exam_instances`). The certification was re-run with that file in the prior chain (`EXTRA_MIGRATIONS`) and passed unchanged before anything was applied.

| Step | Result |
|---|---|
| `npm run db:migrate -- --dry-run` | exactly `20261111_1000` pending |
| `npm run db:migrate` | 1 applied; ledger 82, 0 pending, 0 drift |
| `curr-paa-hierarchy.ts` (dry run) | 4 / 17 / 84 to create; 283 → 388 nodes; 460 objectives unchanged |
| `curr-paa-hierarchy.ts --write` | applied, 0 problems |
| Dry run again | creates nothing |

Read-only verification, by hash before and after: objectives and where each hangs (460), every node outside the new hierarchy (283), structure versions (110), concepts (168) and labels, mappings (373 published, 5 retired), items (496) and versions (509), blueprints and targets, exam instances, exam attempts, simulation attempts, sources — all identical. Blueprint objectives per family unchanged (AICE 126, Cambridge 12, IB 256, ICFES 8, PAA 32, PISA 26).

Hierarchy on DEV: Lectura 5 Domains / 20 Topics, Redacción 5 / 5, Matemáticas 4 / 44 (in the draft structure version), Inglés 3 / 15. Topics: 83 `OFFICIAL`, 1 `STUDYUS_POLICY`. No objective hangs from a new node; no item link exists; `paa.red.cohesion` is active under its section node in both configurations that have it; the concept *Cohesión y conectores* is active.

Not applied: objective re-parenting (section 3).
