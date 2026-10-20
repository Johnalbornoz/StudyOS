# Cambridge pilot: school delta (FINAL PRODUCT-DECISION DELTA, Cambridge workstream)

- **Date:** 2026-10-17
- **Branch:** `fd/cambridge`, based on `e99450e2`
- **Previous inventory:** `docs/audits/CAMBRIDGE_WHOLE_SCHOOL_PHASE0_INVENTORY.md`

Nothing in this workstream was deployed. It made no DB writes and wrote no migration. No content was generated, and no provider was called.

## Decisions applied (§12–20)

| § | Decision | Where it is applied |
|---|---|---|
| 12 | The pilot covers Cambridge Primary, Lower Secondary, Checkpoint preparation and IGCSE school subjects. | `cambridge/school-subject-map.ts` defines the programmes `PRIMARY_CHECKPOINT`, `LOWER_SECONDARY_CHECKPOINT` and `IGCSE`. |
| 13 | English is ESL. IGCSE ESL is 0510 on the Speaking Endorsement route, and is never 0511. | The map entry is `0510`, route `SPEAKING_ENDORSEMENT`, `neverCodes: ['0511']`. `assertFreezeInvariants` throws on 0511 or on a missing route. The new catalogue node is `cie.igcse.0510.speaking-endorsement`. For Checkpoint, `JOSE_MAX_LEON_CHECKPOINT_ROUTE.englishFramework = 'ESL'`, which resolves the **ENGLISH_FRAMEWORK** blocker. The flow offers ESL only: 0057 for Primary, 0876 for Lower Secondary. |
| 14 | 0580 is offered at both Core and Extended. The tier is chosen per preparation. | Both tiers are in the map, with version `v3` (2025–2027) read from the catalogue. Both are added to `PILOT_CAMBRIDGE_VISIBLE_NODE_KEYS`. |
| 15 | 0610 is offered at both Core and Extended. | New catalogue nodes `cie.igcse.0610.core` and `cie.igcse.0610.extended`. They are catalogue-only: no papers, no binding, no version. |
| 16 | The creation flow runs programme → subject → tier → exam year → exam series → create, and offers only valid series. | `cambridge/creation-flow.ts` (`describeFlow`, `validateCreation`), the API `GET/POST /api/exam-preparation/cambridge`, and the UI `/dashboard/exam-prep/cambridge`. The generic picker sends Cambridge school subjects to the flow (`CAMBRIDGE_CREATION_FLOW_REQUIRED`). |
| 17 | StudyUs resolves the syllabus code and version itself. If more than one candidate remains, it asks; if none is governed, it blocks. | `resolveSyllabus` returns one of three results: `RESOLVED`, `CHOICE_REQUIRED` (the UI shows a radio choice) or `BLOCKED: VERSION_NOT_GOVERNED`. |
| 16 | The preparation freezes qualification, subject, tier, examYear, examSeries, syllabusCode, syllabusVersion and preparationStartDate. | The freeze is stored in **existing columns**: `student_exam_profiles.objective_context.cambridgeFreeze` (jsonb), plus `target_exam_series` and `target_exam_year`. An existing freeze is never overwritten (the write is guarded). |
| 18 | Changing the series preserves progress and evidence, updates the target and recomputes the calendar. It is never silent. | `planSeriesChange` and `changeCambridgeSeries` are reached through `POST /api/exam-preparation/[id]/series` and require `confirm: true`. The change keeps the same preparation row. Only the target is written, with an optimistic guard. An audit record is appended to `seriesChanges[]` and an analytics event is emitted. The generic PATCH refuses to change a frozen series (`SERIES_CHANGE_FLOW_REQUIRED`), and the UI then asks the student to confirm. |
| 19 | School subjects come from governed mappings. Gaps are stated explicitly. | `CAMBRIDGE_SCHOOL_SUBJECT_MAP`. See the matrix and the gaps below. |
| 20 | Checkpoint keeps format fidelity: Global Perspectives is a project or report, never an MCQ mock. | `allowedActivityKinds` returns PROJECT_PREPARATION or REPORT_PREPARATION only. `validateCheckpointPreparationSpec` is unchanged. |

### Where series and versions come from

**Series:**
- **IGCSE** uses `availableSeries` from `programme-sessions.ts` (REM-03):
  - June and November are offered.
  - March is offered only where a governed region rule *and* a governed syllabus availability both allow it. No syllabus has a March entry, so March is never offered.
- **Checkpoint** uses `CHECKPOINT_SUBJECT_OPTIONS[].series` (March, May, October). Global Perspectives is May and October only.
- Sittings that have already finished are never offered.

**Versions:**
- 0580 is governed: `v3`, 2025–2027, source `cie-0580-syllabus-2025-2027`.
- No other code has a governed version in StudyUs, either in the catalogue or in the DB `academic_*` tables. Both DEV `2a29b99e` and candidate `4baac799` hold only `Cambridge IGCSE / Mathematics (0580) / Extended`.

## Scope matrix (programme × subject)

| Programme | School subject | Code (provenance) | Version | Tier / route | Declared supply | Creatable now | Gap |
|---|---|---|---|---|---|---|---|
| Primary (Checkpoint) | ESL | 0057 (Checkpoint contract) | not governed | — | NONE | No | VERSION_NOT_GOVERNED; NOT_IN_CATALOGUE; SCHOOL_CONFIRMATION_REQUIRED (grade, subjects taken, codes); NO_SUPPLY |
| Primary (Checkpoint) | Mathematics | 0096 (Checkpoint contract) | not governed | — | NONE | No | same as ESL |
| Primary (Checkpoint) | Science | 0097 (Checkpoint contract) | not governed | — | NONE | No | same as ESL |
| Primary (Checkpoint) | Global Perspectives | 0838 (Checkpoint contract) | not governed | team project, never a mock | NONE | No | same as ESL |
| Lower Secondary (Checkpoint) | ESL | 0876 (Checkpoint contract) | not governed | — | NONE | No | same as ESL |
| Lower Secondary (Checkpoint) | Mathematics | 0862 (Checkpoint contract) | not governed | — | NONE | No | same as ESL |
| Lower Secondary (Checkpoint) | Science | 0893 (Checkpoint contract) | not governed | — | NONE | No | same as ESL |
| Lower Secondary (Checkpoint) | Global Perspectives | 1129 (Checkpoint contract) | not governed | individual report, never a mock | NONE | No | same as ESL |
| IGCSE | ESL | 0510 (operator-named) | not governed | Speaking Endorsement; never 0511 | NONE | No | VERSION_NOT_GOVERNED; NO_SUPPLY |
| IGCSE | Mathematics | 0580 (catalogue) | v3 (2025–2027) | Core | CATALOGUE_ONLY | **Yes**: 2026–2027, June/November | NO_SUPPLY (see note 1); 2028+ is VERSION_NOT_GOVERNED |
| IGCSE | Mathematics | 0580 (catalogue) | v3 (2025–2027) | Extended | STRUCTURE_ONLY | **Yes**: 2026–2027, June/November | NO_SUPPLY (see note 2); 2028+ is VERSION_NOT_GOVERNED |
| IGCSE | Biology | 0610 (operator-named) | not governed | Core | NONE | No | VERSION_NOT_GOVERNED; NO_SUPPLY (no papers, blueprint or bank) |
| IGCSE | Biology | 0610 (operator-named) | not governed | Extended | NONE | No | same as Core |
| IGCSE | Global Perspectives | — | — | — | — | No | **MAPPING_GAP: NO_GOVERNED_CODE** |
| IGCSE | Lengua Castellana / Spanish | — | — | — | — | No | **MAPPING_GAP: NO_GOVERNED_CODE** |
| IGCSE | Computer Science | — | — | — | — | No | **MAPPING_GAP: NO_GOVERNED_CODE** |
| IGCSE | Entrepreneurship | — | — | — | — | No | **MAPPING_GAP: NO_GOVERNED_CODE** |

Notes:
1. 0580 Core has no vertical and no Exam Bank supply.
2. 0580 Extended has DEV fixtures only, the Readiness Engine reports NOT_READY for P2 and P4, and there are 0 concept mappings.

**What is visible works.** A 0580 preparation is created as a Learning / preparation target. The flow says truthfully that question supply is not ready (`supply.notReady`). The preparation's capabilities stay server-computed from the persisted catalogue, so no practice or mock action appears until readiness allows it. Blocked subjects and years are shown disabled, with their reason, and never lead to a route.

## Gaps (what is missing, and who fixes it)

1. **VERSION_NOT_GOVERNED for 0510, 0610 and all eight Checkpoint frameworks.** Each needs a registered syllabus source in `catalog/sources.ts`, plus a version window added to the map or catalogue as a reviewed data change. The cycles listed in the Phase 0 inventory are research notes, not governed data, so they were not used.
2. **NO_GOVERNED_CODE for IGCSE Global Perspectives, Lengua Castellana / Spanish, Computer Science and Entrepreneurship.** The operator or the school must name the codes. The candidate codes listed in the inventory are unresolved and were not used.
3. **SCHOOL_CONFIRMATION_REQUIRED for Checkpoint.** The school still has to confirm three things: the grade or stage, the subjects taken, and the framework codes. ESL is now decided.
4. **NO_SUPPLY everywhere except 0580 Extended structure.** Standardized supply is frozen, so this workstream generated nothing.
5. **Persisted catalogue.** The new nodes for 0510 and 0610 exist in the code catalogue only. Applying them to `assessment_structure_nodes` needs `applyAssessmentStructure({ write: true })`, which is an operator step and was not run. Until then, their capabilities read as catalogue-only, and they are not creatable anyway.
6. **Checkpoint OCTOBER series in the target column.** The `target_exam_series` CHECK (migration 20261107_1000) does not accept `OCTOBER`. The freeze jsonb is authoritative, and the column is left NULL for such a series. When Checkpoint is unblocked, a governed migration will need to widen the CHECK. That is not needed today, because Checkpoint is blocked.

## Tests

- `tests/unit/cambridge-pilot-creation-flow.test.ts` (pure) covers:
  - step order;
  - valid-series filtering;
  - auto-resolution with a single, multiple or no candidate;
  - the freeze;
  - a series change that preserves the target and recomputes the calendar;
  - 0510 never becoming 0511;
  - Global Perspectives never becoming an MCQ mock.
- `tests/unit/cambridge-pilot-creation-service.test.ts` (with a mocked DB) covers:
  - the flow-only creation guard;
  - the freeze write;
  - a series change that writes only the target on the same row and adds an audit record;
  - the PATCH refusal.
- Updated tests: `student-exposure*.test.ts` (0580 is now in the pilot scope), `checkpoint-preparation-governance.test.ts` (ESL decided), and `exam-objective-first.test.ts` (+3 IGCSE objectives).
