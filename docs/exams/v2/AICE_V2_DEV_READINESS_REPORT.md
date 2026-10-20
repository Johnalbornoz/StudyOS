# Cambridge AICE / AS & A Level V2 — DEV readiness report

Status: **DEV candidate, ready for the manual E2E. Not certified.** `AICE_E2E` is not declared.

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
| Model | `cie.as-a` placeholder, treated as an exam | AICE Diploma = a **group award** (a programme), not an exam. Hierarchy: CAMBRIDGE → AICE Diploma → Group → Subject → Syllabus code → Level (AS / A Level; no A2) → Version → Route → Component |
| Catalogue | none | 49 subjects, 87 subject-levels, with real syllabus codes and eligible groups (multi-group subjects appear in each group, and the counted group is chosen) |
| Configured syllabi | none | 9709, 9702, 9701, 9700, 9239, 9093 (Group 2) and 9708 (Group 3), AS and A Level each: 14 configurations, versioned by syllabus years |
| Routes | none | AS_ONLY / A_LEVEL_LINEAR / A_LEVEL_STAGED from the syllabus. A mock must match one route option (400 `ROUTE_REQUIRED` otherwise) |
| Diploma rules | none | `aice/policy.ts`, versioned `AICE-DIPLOMA-2026-10`, with sources and confirmed / unconfirmed flags |
| Planner | none | `/dashboard/exams/aice`: plan, credits by group, issues, series, results, points, band |
| Results | none | `cambridge_results`. Recorded only by a coordinator (OFFICIAL_STATEMENT / COORDINATOR_VERIFIED), never by the Student. Grades are validated per level |
| Readiness | 4 states | CATALOG_ONLY / STRUCTURE_READY / PRACTICE_READY / REDUCED_MOCK_READY / FULL_MOCK_READY |

## 2. Diploma rules implemented

**Confirmed by Cambridge's public pages:**
- 7 credits: AS = 1, A Level = 2.
- Global Perspectives & Research (9239) is compulsory.
- ≥ 1 credit in each of Groups 1, 2 and 3; Group 4 ≤ 2 credits.
- Exceptions:
  - A Level GP&R gives one extra Group 4 credit;
  - A Level GP&R + three A Levels (8 credits);
  - A Level Thinking Skills 9694 may exceed the Group 4 limit when combined with A Level GP&R.
- Up to 5 series within 25 months.
- Points: A* 140, A 120, B 100, C 80, D 60, E 40; a 60, b 50, c 40, d 30, e 20.
- Maximum 420. Bands: Pass 140–249, Merit 250–359, Distinction 360–420. A band is shown **only with a valid composition**.
- Series: June and November; March is for India only.

**Not stated publicly** (conservative behaviour, shown as a planning assumption):
- one counted instance per syllabus;
- the best eligible retake counts;
- the score is the sum of the counted results, capped at 420.

**Grade thresholds:** the `cambridge_grade_thresholds` table only accepts `cambridgeinternational.org` sources. It is empty: StudyUS does not convert marks into official grades.

## 3. Coverage (separate metrics)

| Metric | Value |
|---|---|
| AICE_CATALOG_COVERAGE | 100 % (49 subjects / 87 subject-levels) |
| AICE_STRUCTURE_COVERAGE | 16.1 % (14 / 87) |
| AICE_PRACTICE_COVERAGE | 16.1 % |
| AICE_REDUCED_MOCK_COVERAGE | 16.1 % |
| AICE_FULL_MOCK_COVERAGE | 4.6 % (9239 and 9093, AS and A) |
| AICE_LEARNING_BRIDGE_COVERAGE | 16.1 % |
| OFFICIAL_CONTENT_COVERAGE | 0 % |

**What «full» means here:** the StudyUS form covers the official number of items or marks of every component in the route. These are essay- and response-based components with few positions. It is length coverage only: the content is original StudyUS practice, and nothing is official.

The generated matrix is in `AICE_SUBJECT_READINESS_MATRIX.md`.

## 4. Sources

- Cambridge AICE Diploma qualification and curriculum pages: subjects, codes, groups, credits, exceptions, window, points and bands.
- The syllabus PDFs for 9709, 9702, 9701, 9700, 9239, 9093 and 9708: components, marks, timings, routes and versions.

The extracts are in `sources/aice-diploma.json` and `sources/aice-reference-syllabi.json`. The generated code comes from `scripts/catalog/generate-aice-*.py`.

## 5. Automated evidence

- **Unit tests:** 6871/6871, including:
  - `aice-diploma` (28): credits, groups, exceptions, window, points, bands;
  - `aice-pisa-architecture` (51);
  - `aice-pisa-security` (18);
  - `exam-route-combinations` (6).
- **Typecheck:** clean. **Build:** OK.
- **DEV scenarios** (`track-b-aice-pisa-scenarios.ts`): **45/45**. The AICE checks cover:
  - catalogue groups; 9709 components and routes (AS, A linear, A staged); catalogue-only not startable;
  - plan created once; 6 of 7 credits; multi-group choice required; 7 credits complete;
  - rejection of: level not offered, group not eligible, March outside India, duplicate subject;
  - foreign entry denied; grade validation;
  - points and band: 370 DISTINCTION;
  - a result outside the window is kept but not counted;
  - high points with a group missing gives no band;
  - 9709 mock: frozen, reduced, no help, scored by the math engine;
  - component results with no official grade;
  - bridge offers a concept, adds once, records EXAM_GAP provenance once, denies a foreign attempt;
  - another student cannot read the attempt.
- **DEV regressions:** V2 scenarios 90/90 · V1 exam scenarios 203/203 · exam delete 21/21 · exam profile 24/24.

## 6. Migrations

`20261024_1000_track_b_aice_diploma_exam_gaps.sql`, applied to DEV. It adds:
- `aice_diploma_plans` (one ACTIVE per student);
- `aice_plan_entries`;
- `cambridge_results`;
- `cambridge_grade_thresholds`;
- `exam_gap_concept_links`.

The ephemeral PG18 certification passed.

## 7. Open items

| # | Item | Severity |
|---|---|---|
| P1 | 73 of 87 subject-levels are catalogue only: no structure or bank. | P1 (scope) |
| P2 | The three unconfirmed rules need confirmation from Cambridge or the coordinator handbook. | P2 |
| P3 | Banks are small (tens of items per syllabus level), so repeated mocks reuse items. | P2 |
| P4 | Coursework and practical components (e.g. 9239 Research Report, science practicals) are described, not simulated. | P2 |
| P5 | The coordinator results UI is API-only (`POST /api/aice/results`). | P2 |
| P6 | Teacher and institution exam insights are API-only. | P2 |
| P7 | No official grade thresholds are loaded, so no grade estimate is made, by design. | P3 |

No P0 is open.

## 8. Manual packages

Prepared with the URL and SHA:
- `AICE_DIPLOMA_PLANNER_MANUAL_E2E.md`
- `AICE_MATH_9709_MANUAL_E2E.md`
- `AICE_SCIENCE_MANUAL_E2E.md`
- `AICE_GLOBAL_PERSPECTIVES_9239_MANUAL_E2E.md`

STOP: the manual E2E is not executed.
