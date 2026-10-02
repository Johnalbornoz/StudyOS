# PISA complete vertical V2 — DEV readiness report

Status: **DEV candidate, ready for the manual E2E. Not certified.**

Not declared: `PISA_E2E`, `PISA_FULL_SIMULATION`, `PISA_OFFICIAL_SCORE`, `PISA_OFFICIAL_CONTENT`.

| | |
|---|---|
| Candidate SHA | `7b63098ba02280c9b7ad46c3d85049dc58066667` |
| Immutable URL | https://study-7rbslkg86-study-so.vercel.app (`dpl_DLJLaxELxUrprdk42iuuwdqNqVUU`, target dev) |
| DB | DEV, fingerprint `2a29b99ee14a22b4`; 51 migrations, 0 pending, 0 drift |
| Shared DEV alias | not moved (it belongs to Track A) |
| Manual Student | `studyus-tb-exams+clerk_test@example.com` (Ana AICE PISA Manual), clean baseline |

## 1. Before → after

| Area | Before | After |
|---|---|---|
| Definitions | `v2.pisa.math` only (retired) | `v2.pisa.2022`: one PISA 2022 definition with three domain sections |
| Domains | Mathematics configured; Reading and Science «Próximamente» | Mathematics, Reading and Science: practice + reduced StudyUS simulation |
| Cross-domain | none | «Simulacro de los tres dominios» (`pisa.2022.full`): Math → break → Reading → break → Science |
| Items | 16, all selected / closed | 47 in 14 units with a shared stimulus; selected, complex selected, closed constructed (math engine) and open constructed (2/1/0 partial credit, rubric with two assessors) |
| Readiness | 4 states; «Simulacro disponible» | 5 states; «Simulacro reducido disponible» plus an explanation; «Próximamente» replaced by the real state |
| Explorer | card only | domain panel: Sobre esta área · Qué se evalúa · Cómo puedes practicar · Estado del simulacro |
| Bridge | always created the concept | proposal (`Añadir a mi plan`) or «Ya estás trabajando este concepto · Continuar reforzando»; `exam_gap_concept_links` with source EXAM_GAP, unique per student and concept |
| Teacher / institution | none | aggregated exam insights by domain, objective and concept, scoped to the class or institution |
| Labels | «Simulacro» could read as official | «Simulacro StudyUS»; «Simulacro oficial» never appears |

The detailed audit, made before the changes, is in `PISA_V2_AUDIT.md`:
- CURRENT_PISA_ARCHITECTURE;
- 6 structural gaps, 5 content gaps and 4 UX gaps, each with what was done.

## 2. Sources

- OECD, *PISA 2022 Assessment and Analytical Framework* (2023): Mathematics framework, test design (60 minutes per domain; multistage adaptive mathematics, 28–30 items).
- OECD, *PISA 2018 Assessment and Analytical Framework*: Reading framework, reused in 2022.
- OECD, *PISA 2015 Assessment and Analytical Framework*: Science framework, reused in 2022.
- OECD, *PISA 2022 Results, Volume I*: reporting scales. They are cited only to explain why StudyUS does not produce them.

The research extract is in `sources/pisa-2022.json`.

## 3. Architecture

- **Catalogue:** `PISA → pisa.2022 → { pisa.2022.full (FULL_TEST), math, reading, science }`. Each domain has process and competency nodes (SKILL_PRACTICE, bound to objective codes).
- **Units:** an item belongs to a unit with a fixed stimulus (text, table, multiple sources or infographic). The form freezes the stimulus with the items, and it is never regenerated.
- **Scoring:**
  - deterministic for selected and complex selected items;
  - the math engine for numeric answers;
  - a `credit2` rubric (2/1/0) with two assessors for open answers. Low confidence → «pendiente de revisión».
- **Reporting:** per domain, process or competency and objective, with `NO_OFFICIAL_SCALE`. There is no 500 scale and no proficiency level.

## 4. Coverage (separate metrics)

| Metric | Value |
|---|---|
| PISA_CATALOG_COVERAGE | 100 % |
| PISA_STRUCTURE_COVERAGE | 100 % |
| PISA_PRACTICE_COVERAGE | 100 % |
| PISA_REDUCED_SIMULATION_COVERAGE | 100 % |
| PISA_FULL_SIMULATION_COVERAGE | 0 % |
| PISA_LEARNING_BRIDGE_COVERAGE | 100 % |
| PISA_OFFICIAL_CONTENT_COVERAGE | 0 % |

Bank coverage:

| Domain | Positions per form | Bank | Units | Objectives covered | Official length |
|---|---|---|---|---|---|
| Mathematics | 8 | 20 | 6 | 8/8 | 27 % of ≈30 items |
| Reading | 7 | 14 | 4 | 7/7 | n/a: the official count per student is not published |
| Science | 6 | 13 | 4 | 6/6 | n/a: the official count per student is not published |

The generated matrix is in `PISA_DOMAIN_READINESS_MATRIX.md`.

## 5. Automated evidence

- **Unit tests:** 6871/6871 (421 files), including:
  - `aice-pisa-architecture` (51);
  - `aice-pisa-security` (18);
  - `exam-route-combinations` (6);
  - the V2 architecture and completion suites updated to `v2.pisa.2022`.
- **Typecheck:** clean. **Build:** OK.
- **DEV scenarios** (`track-b-aice-pisa-scenarios.ts`): **45/45**. The PISA checks:
  - domains-and-simulation, domain-detail, structure-only-shown-as-such;
  - practice-feedback-on, process-practice-only-focus;
  - simulation-three-domains-fixed, simulation-frozen-no-help, simulation-complete-no-regeneration (breaks = 2), simulation-shared-stimulus-units;
  - results-by-domain-no-pisa-score;
  - bridge-mapped-gap, bridge-then-already-working;
  - aggregation-scoped, aggregation-other-tenant-empty;
  - delete-keeps-result, foreign-delete-denied, new-attempt-fresh-ids;
  - cleanup (0 fixtures left).
- **DEV regressions:** V2 scenarios 90/90 · V1 exam scenarios 203/203 · exam delete 21/21 · exam profile 24/24.

## 6. Migrations

`20261024_1000_track_b_aice_diploma_exam_gaps.sql`, applied to DEV. It adds:
- `exam_gap_concept_links` (unique student + concept, source EXAM_GAP);
- the AICE tables.

The ephemeral PG18 certification (`track-b-aice-diploma-migration-cert.sh`) passed. Stage and Production are untouched.

## 7. Open items

| # | Item | Severity |
|---|---|---|
| P1 | Banks of 13–20 items per domain: a second form repeats items. | P2 |
| P2 | There is no adaptive multistage design. The reduced form is linear by design and is labelled as such. | P3 |
| P3 | Open answers depend on the AI rubric assessors; low confidence goes to «pendiente de revisión». A teacher review queue for PISA is not built. | P2 |
| P4 | The reading fluency task and dynamic (web-like) texts are not reproduced. | P3 |
| P5 | Teacher and institution insights are API-only: there is no UI panel yet. | P2 |

No P0 is open.

## 8. Manual packages

Prepared with the URL and SHA. Each contains the student, baseline, path, expected scoring, gaps, bridge and delete/restart:
- `PISA_MATHEMATICS_MANUAL_E2E.md`
- `PISA_READING_MANUAL_E2E.md`
- `PISA_SCIENCE_MANUAL_E2E.md`
- `PISA_CROSS_DOMAIN_SIMULATION_MANUAL_E2E.md`

STOP: the manual E2E is not executed.
