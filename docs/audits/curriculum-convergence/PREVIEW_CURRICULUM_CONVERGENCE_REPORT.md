# Preview curriculum convergence — release-blocker remediation (2026-10-12)

Branch `remediation/preview-curriculum-convergence`, cut from `a8ce32d`. Code SHA deployed: `c1d04f9`.
No AI provider call, no Production access, Stage alias not moved by this work.

## Status

| Blocker | Result |
|---|---|
| B1 Preview code / DB sync | PASS for the new immutable deployment (`c1d04f9`, 86 files + baseline = ledger 87, 0 pending, 0 drift) |
| B2 PAA structure | PASS — `EXAM_SECTION 4` → `SECTION 4 / DOMAIN 17 / TOPIC 84 / EXAM_SECTION 4` |
| B3 IB + Cambridge topics | PARTIAL — Cambridge 9700 / 9702 / 9708 (6 structures, 89 Topic nodes); IB and the other Cambridge syllabi have no governed Topic source |
| B4 Learn provenance | PASS in code, ephemeral and DEV; NOT exercised through the Preview UI (no Student session) |
| B5 "Sin clasificar" | PASS in code, ephemeral and DEV; NOT exercised through the Preview UI |
| B6 Canonical subject mapping | PARTIAL — 56 → 48 unmapped, all 48 classified |
| B7 Real Student UNRESOLVED | FAIL — stays 1; the governed dependency does not exist (below) |
| B8 Dangerous fallback | PASS — removed; negative tests on ephemeral, DEV and Preview (read-only) |

`READY_TO_RESUME_REAL_CONTENT_READINESS = NO` (B7 open; authenticated Preview smoke pending an operator sign-in).

## Phase 0 — what was found

- At the start the Stage alias served `2d3fc68` (`dpl_HQ64wMCMZiJNCU9Ne2BbSZQGo4aE`); it carries 81 migration files.
- Preview DB (`ep-holy-thunder…`, `neondb`, fingerprint `53d158d5811e7ee0`): ledger 86 (baseline + 85).
- The four migrations in the DB and not in `2d3fc68`:

| Migration | First commit | Effect | Reversible |
|---|---|---|---|
| `20261112_1000_qb_review_requires_primary_attribution` | `3c7fef93` | replaces the approval trigger function | YES (previous function body) |
| `20261120_1000_sf7_parent_relationship_lifecycle` | `c2bcae95` | parent relationship lifecycle columns / constraints | YES while unused |
| `20261120_1100_cr_l9_02_enrollment_history` | `79b7f50a` | enrolment history | YES while unused |
| `20261120_1200_sf10_single_persona_constraint` | `79b7f50a` | single-persona index | YES |

- `PREVIEW_DB_COMPATIBLE_SHA = a8ce32d` (`fix/student-e2e-release-blockers`): 86 applied / 0 pending / 0 drift.
  `integration/stage-convergence` `557707f` is NOT compatible as is: it needs `20261121_1000`, which Preview does not hold.
- During this work somebody else moved the Stage alias: it now serves `055a096` (`dpl_4DEWxaF2iurCB3GxRxDEb5Gadz9h`).

## What changed

**Resolution fails closed** (`curriculum-context-resolution.ts`, `curriculum.service.ts`). Authority: requested subject →
exams the Student prepares → Academic Profile selections; each must have a PUBLISHED version with PUBLISHED concept
mappings. Otherwise `CURRICULUM_MAPPING_NOT_READY`. Removed: `inProgramme[0]` (largest sibling of the programme), the
`/IB/` name pick, the `concept_count DESC` ordering, and the Teacher class view's "published version covering most
concepts". A prepared multi-section exam (PAA) now names its sections' academic subjects through its published blueprint.

**Learn provenance** (migration `20261122_1000`, table `learner_concept_curriculum_provenance`): `learner_concept_id`,
`canonical_concept_id`, `academic_subject_id`, `structure_version_id`, `structure_node_id`, `learning_objective_id`.
Verified by a trigger on insert, immutable. Programme / qualification / level are read from the academic subject.
Written by plan enrolment (every source) and by the exam bridge.

**Grouping**: a concept with a recorded lineage is listed under its curriculum (node, or objective when the node is a
paper). The unassigned bucket keeps only concepts with no lineage and no own topic.

**Data** (`scripts/operations/curriculum-convergence.ts`, dry run by default): PAA certified hierarchy (no objective
moved), Cambridge Topic layer, canonical subjects by mapping evidence or identical name, integrity gates.

## Data results

| | Ephemeral | DEV | Preview |
|---|---|---|---|
| Ledger | 86 → 87 | 86 → 87 | 86 → 87 |
| Structure nodes | 263 → 457 | 388 → 477 | 264 → 458 |
| PAA nodes created | 105 | 0 (already there) | 105 |
| Cambridge Topic nodes created | 89 | 89 | 89 |
| Academic subjects mapped | 35 | 3 | 8 |
| Unmapped after | 50 | 53 | 48 |
| Second run | creates nothing | creates nothing | creates nothing |
| Scenarios | 34/34 | 34/34, fixtures removed | 24/24 read-only |

Preview, unchanged by hash before and after: students, subjects, concepts, concept mappings, selected academic subjects,
exam profiles; objectives 427, concept mappings 313, canonical concepts 135.

Preview subjects mapped (8): PAA Inglés → English, PAA Lectura → Lectura crítica, PAA Matemáticas → Matemáticas,
PAA Redacción → Redacción, PISA Ciencias → Ciencias, PISA Lectura → Lectura crítica, PISA Matemáticas → Matemáticas
(mapping evidence); Saber 11.° Matemáticas → Matemáticas (identical name).

Preview residual 48, all IB DP: 43 need a human decision (the catalogue has no canonical subject for them), 2 not
applicable (Extended essay, Theory of knowledge), 3 outgoing courses (History 2020 HL/SL, World religions SL).
Queue: `canonical_subject_review_queue_preview.csv`.

Published versions with nodes and no concept mapping, Preview: 52 before and after. 5 are valid without mappings
(2 non-academic components, 3 outgoing). 47 fail closed: 43 have no canonical concept catalogue to map to; 4 have one
and only lack reviewed mappings. List: `structure_version_classification_preview.csv`.

Topics, Preview: IB 0 → 0. Cambridge 0 → 89 (Biology, Physics, Economics × AS / A Level). Not ready, by source:
9709 and 9701 list topics inside compound strings; 9093 and 9239 are paper / skills level; IGCSE 0580 and every IB
subject have no Topic layer in the governed sources. Matrix: `ib_cambridge_topic_matrix_preview.csv`
(its `topics_before` column was written by the idempotent re-run and equals `topics_after`; the real before is 0).

## B7 — the real Preview Student

Student `5860002b…`, subject "Matemáticas", concept "Exponenciación" (typed by the Student), mapping `UNRESOLVED`.
Reason: `ensureCatalogMapping` links only on an identical label inside the same-named canonical subject, and canonical
subject "Matemáticas" on Preview has no concept named "Exponenciación". Nothing was patched.

Missing governed dependencies:
1. the canonical concept. The certified PAA concept `math.num.powers-scientific-notation` ("Potencias, exponentes
   enteros y notación científica") is not in the Preview catalogue (Preview holds 14 pilot Matemáticas concepts);
2. a reviewed link (`MANUAL_REVIEW`) from the Student's concept to it — a label similarity is not an identity.

Also: the academic subject the Student selected, MCCEMS "Pensamiento Matemático", has a published version with no
nodes (`STRUCTURE_NOT_IMPORTED`). Their PAA preparation now resolves "Matemáticas" to PAA · Matemáticas (EXAM_PROFILE).

## Validation

Full unit suite 563 files / 10196 tests PASS · `npx tsc --noEmit` clean · `npm run build` OK · `git diff --check` clean ·
ephemeral certification (`curriculum-convergence-cert.sh`) PASS incl. rollback and re-apply · provider calls 0.

## Preview deployment

`https://study-hvhhswhob-study-so.vercel.app` · `dpl_HQbhUAS6BsevwcKWjj69NcRxerTv` · `/api/version` = `c1d04f9` ·
DB `53d158d5811e7ee0`, 87 applied. `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED=true` on this deployment only, mirroring the
alias deployment it was cut to replace. Unauthenticated checks: `/api/version` 200, `/sign-in` 200,
`/dashboard/learn` 307 to sign-in, Student APIs 401, no console errors on the sign-in page.

Backup before the Preview write: `studyos-dev-data/preview-curriculum-convergence-backup-20261012T233121Z.sql`
(structure_nodes, structure_versions, academic_subjects, schema_migrations); restore point 2026-10-12T23:31:33Z.

## Not done / open

- Authenticated Preview smoke (Learn, Catalog, Add to Learn, grouping, PAA / Cambridge views): no Student session on
  the new host; signing in is an operator step.
- PAA objective re-parenting under the Domain nodes stays a product decision (it changes Learn topic titles and drops
  the `paa.red.cohesion` row from the list).
- Cambridge Topic nodes carry no objective or concept link: the governed source has none.
- Learn subjects without a catalogue key (Lectura crítica, Redacción, Ciencias, English Language, Global Perspectives)
  show no curriculum section in Learn; their concepts still get a lineage and are grouped.
- `preparation.service.ts` still picks, inside the Student's chosen exam objective, the exam version with the most
  practice-ready sections. It never crosses subjects; it was left as is and should be reviewed.
- Neon project / branch names were not readable from this session (endpoint and fingerprint are recorded).

---

# Addendum — B7 closed, new immutable Preview (2026-10-12, second block)

Code SHA `8739353`. Deployment `https://study-cyg8iahbk-study-so.vercel.app` (`dpl_A4y3CN8RFAwZKrqo59HQcFHHWGoJ`),
`/api/version` = `8739353`, DB ledger 88 = 87 files + baseline, 0 pending, 0 drift.
The earlier candidate `c1d04f9` (`study-hvhhswhob`) is superseded: closing B7 needed code (alias table, resolver),
so the SHA changed. Stage alias not touched by this work (it still serves `055a096`, moved externally).

## 1. Certified PAA concept catalogue

Source: the Q1-C.1 catalogue already in the repository (`dev-learning-catalog.ts`, `objective-learning-links.ts`,
`canonical-concept-labels.ts`); stable ids from `PAA_F_DATA_FOUNDATION.md`, now also data in
`src/lib/curriculum/paa/paa-certified-concepts.ts` (61 rows, compared with the record by a test).
`canonical_concepts` has no stable-id column (F-ARCH): a certified concept is found by canonical subject + name.

| | Preview before | Preview after | DEV (F-DATA record, 2026-10-10) |
|---|---|---|---|
| Certified concepts present | 28 / 61 | 61 / 61 | 61 / 61 |
| Canonical concepts | 135 | 168 (+33) | 135 → 168 (+33) |
| Labels written | — | 80 (66 new + 14 updated) | 66 inserted, 14 updated |
| PAA objective → concept links published | — | +36 | +36 pairs |
| Replaced links retired | — | 5 | 5 |
| Published mappings | 313 | 344 | — |

Same writers, same values as the DEV steps, restricted to `paa.*` objective codes. Throwaway: the catalogue was
unloaded (41 concepts, 40 mappings) and reloaded by the runner; concepts, PAA links and aliases identical to the
seeded state; second run creates nothing. DEV: loader is a no-op (61 / 61 already).

## 2. Reviewed alias

No alias mechanism existed. Added migration `20261122_1100`: table `canonical_concept_aliases` (concept, canonical
subject, language, label, stable id, rationale, review reference, reviewed at, version, status; one ACTIVE alias per
subject + label; immutable except retirement), `mapping_method` value `REVIEWED_ALIAS`, and
`concept_catalog_mapping.resolved_alias_id`.

Alias created: `Exponenciación` (es, Matemáticas) → `math.num.powers-scientific-notation`
(Matemáticas / "Potencias, exponentes enteros y notación científica"), version 1, review reference: John Albornoz,
product decision 2026-10-12. Governed list: `src/lib/catalog/reviewed-concept-aliases.ts`.

## 3. Resolution policy

`catalog-resolution.ts`: inside the canonical subject with the Student subject's name — canonical name (A), else one
reviewed alias (B), else UNRESOLVED; several candidates are AMBIGUOUS. Equality only. The integrity gate now reports
`BROKEN_RESOLUTION` (the catalogue resolves the label and the row is still UNRESOLVED) apart from `PERSONAL_UNMAPPED`.

Proven with the real services (throwaway and DEV, 43/43): "Exponenciación" in Matemáticas → the certified concept by
`REVIEWED_ALIAS`; an unrelated label, a similar label ("Exponenciacion y potencias") and the same label in another
subject (Física) do not resolve.

## 4. Real Preview Student

`scripts/operations/curriculum-reresolve-student-concepts.ts`, dry run then `--write`:
`UNRESOLVED 1 → 0`. Concept `87f1210f…` is `MATCHED` by `REVIEWED_ALIAS` to "Potencias, exponentes enteros y notación
científica", with lineage PAA · Matemáticas · V2.1 PAA revisada · node "Matemáticas" (EXAM_SECTION) · objective
`paa.mat.aritmetica`. The step verified that students, subjects, concepts, labels, mastery, plan entries and selected
subjects were unchanged. A second run changes nothing.

A second `students` row (`4e3271b8…`) appeared on Preview during this block; it was not created by this work.

## 5. Invariants re-run on Preview

Integrity gates: 0 broken. Read-only scenarios 24/24 (11 subjects without mappings never replaced by a richer one;
the Student resolves only to a subject they explicitly have). PAA nodes SECTION 4 / DOMAIN 17 / TOPIC 84 /
EXAM_SECTION 4; Cambridge TOPIC 89; IB 0 (`CURRICULUM_DATA_NOT_READY`). Unmapped academic subjects 48, all classified.

## Validation

563 test files / 10210 tests PASS · typecheck clean · build OK · `git diff --check` clean · ephemeral certification
PASS (incl. rollback and re-apply of both migrations) · provider calls 0.

Backup before this block's Preview write:
`studyos-dev-data/preview-curriculum-convergence-b7-backup-20261013T003534Z.sql`; restore point 2026-10-13T00:35:47Z.

## Still open

Authenticated Preview smoke on `study-cyg8iahbk`: no Student session in the browser; sign-in is an operator step.
