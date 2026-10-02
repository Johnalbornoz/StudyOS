# Institution Curriculum Management V2 + Hierarchical Academic Governance — DEV Readiness Report

> Scope: **DEV only** (branch `track-a/roles-e2e`). Stage, Production, `main`
> and other tracks are untouched. Manual E2E has **not** been executed and is
> **not** declared PASS.

## 1. Deployment

| Item | Value |
|---|---|
| Commit SHA | `eafac86a17eacb4e5fee709eb51a5fb5b4859b25` (this report was added afterwards in a docs-only commit) |
| Immutable DEV URL | https://study-cpt73vi5p-study-so.vercel.app (deployment `dpl_9EkFMkGqHhc1AoUJZuap6tTUJ9Be`; `/api/version` and `/api/diagnostics/preview-db` verified) |
| Shared alias | **not moved** |
| DB fingerprint | `2a29b99ee14a22b4` (DEV) |
| Migrations | `20261018_1500_track_a_institution_curriculum_v2.sql` (new) — ledger 53 (Track A complete + 7 Track B externals 20261019–20261025_1000), **0 pending**, **0 drift** |
| Data seed (DEV) | `seed-education-authorities.ts`: SEP (MX), MEN (CO), Secretaría de Educación del Distrito (Bogotá) and Secretaría de Educación de Antioquia (territorial, under MEN). Metadata only: `STRUCTURE_NOT_IMPORTED`, no invented objectives. |

## 2. Before / after

| Area | Before (V1) | After (V2) |
|---|---|---|
| Curriculum model | One curriculum = one canonical subject (+ optional base); the page mixed configuration and coverage | Configuration only: subjects grouped by **programme × grade**, with code, level, version, source/authority, status, classes, objectives and concepts |
| Add subjects | One adoption form; manual base selection | Governed wizard: País → Autoridad / Programa → Grado → Asignaturas (multi) → Nivel / Versión → Revisión. Bulk and idempotent; no ids |
| Edit | Not available | Metadata in place. A level / version change shows an **impact preview** (objectives added / retired / kept, classes, students); the old relation is archived with `replaced_by`, decisions are carried over by objective code, classes are re-pointed, history is kept |
| Archive | "Retirar" concept only | Subject archive with impact confirmation; soft (`archived_at`, `archived_by`, `reason`); never a hard delete |
| Content | Concepts only | Topic (structure root) → Objective → mapped Canonical Concept. Include / exclude / restore and REQUIRED / RECOMMENDED / OPTIONAL / SUPPLEMENTAL, in bulk; catalog concepts can be added (source INSTITUTION); institution target dates. The published structure and catalog are never modified |
| Class ↔ curriculum | Heuristic (subject + grade) | Explicit `classes.institution_curriculum_id`, set at class create / edit (preselected when only one subject is compatible); heuristic kept as fallback; V1 adoption associates matching classes |
| Teacher | Curriculum browser | Inherits the class curriculum (programme, level, version); "Obligatorio, aún no programado"; institution-locked rows read-only (🔒); chooses the class plan subset; supplemental concepts allowed |
| Student | — | Receives only assigned concepts (1 student + 1 concept = 1 learner state; no mass enrollment; no reset); sees "Asignación institucional · {class}" |
| Coverage | "Trabajo en clases y estudiantes" for one curriculum | **Cobertura de la institución** per programme + grade (content / in class plans / in student plans / pending, by source), plus subject drill-down; "coverage ≠ mastery" copy; **Cobertura de contenido StudyUS** shown as a separate block |
| Intelligence filters | Programa → Versión → Grado → Asignatura, Periodo, Clase | Same, plus **Origen** (Institución / Profesor) on activity; exam readiness limited to configured subjects; attention by subject → concept → classes / students |
| Authorities | Cambridge / IB / College Board / OECD / ICFES as organizations | Provider model with `source_type` (GOVERNMENT_AUTHORITY / INTERNATIONAL_PROGRAMME / INSTITUTION_DEFINED / STUDYUS_REFERENCE), `authority_level` (NATIONAL / TERRITORIAL / INTERNATIONAL), parent authority, jurisdiction, provenance |
| Governance | Teacher owned everything in the class | Authority > Institution > Teacher > Student. `owner_scope` and `locked_fields`; locked class plan content; institution tasks (TEACHER_SELECTS_RECIPIENTS / DIRECT_ALL_STUDENTS); separate institution date vs. teacher planning date; **server-side** FIELD_LOCKED_BY_INSTITUTION (403); audit of actor / old / new / outcome |

## 3. Data model (migration 1500, additive)

- `academic_organizations` gains country, source_type (CHECK), authority_level, parent_organization_id, jurisdiction and provenance. Backfill: international providers → INTERNATIONAL_PROGRAMME; ICFES → GOVERNMENT_AUTHORITY CO.
- `academic_subjects.canonical_subject_id` is backfilled (exact name, then prefix).
- `institution_curricula` gains academic_programme_id, source_type, owner_scope, provenance, archive fields, replaced_by_curriculum_id and updated_by. The unique index is replaced by `uq_institution_curricula_active_v2` on (institution, base subject or canonical subject, version, grade, year), ACTIVE only, so archiving frees the slot.
- New table `institution_curriculum_objectives` (curriculum × objective, classification, INCLUDED / EXCLUDED), backfilled for curricula that have a base.
- `institution_curriculum_concepts` gains source (AUTHORITY / INSTITUTION / TEACHER_SUPPLEMENTAL) and institution_target_date.
- `classes.institution_curriculum_id`, backfilled by subject + grade.
- `class_plan_concepts` gains owner_scope (INSTITUTION / TEACHER), locked_fields and institution_target_date.
- New tables `institution_assignments` and `institution_assignment_targets`. `teacher_interventions` gains owner_scope and institution_assignment_id.
- `student_concept_sources.source_type` and `concepts.origin` accept INSTITUTION_ASSIGNMENT.
- New table `academic_governance_events` (actor, scope, object, action, fields, old, new, APPLIED / DENIED).
- Certified by `track-a-roles-migration-cert.sh`: idempotence, CHECKs, uniqueness, archive frees the slot, owner_scope rejection, rollback, re-apply — **ALL CHECKS PASSED**.

## 4. Permission matrix

| Action | Platform admin | Coordinator (own institution) | Coordinator (other institution) | Teacher (own class) | Teacher (other class) | Student | Anonymous |
|---|---|---|---|---|---|---|---|
| List / add / edit / archive curriculum subjects | — | ✅ | 404 | 403 | 403 | 403 | 401 |
| Curriculum content (include / exclude / classify / dates) | — | ✅ | 404 | 403 | 403 | 403 | 401 |
| Associate class ↔ curriculum | — | ✅ (own classes and own curricula only) | 404 | 403 | 403 | 403 | 401 |
| Coverage analytics | — | ✅ | 404 | 403 | 403 | 403 | 401 |
| Locked class plan content | — | ✅ | 404 | 403 | 403 | 403 | 401 |
| Create / edit institution task | — | ✅ | 404 | 403 | 403 | 403 | 401 |
| View class institution tasks | — | ✅ (tasks page) | 404 | ✅ | 403 | — | 401 |
| Choose recipients (TEACHER_SELECTS) | — | — | — | ✅ recipients only (strict schema; other fields → 403) | 403 | 403 | 401 |
| Edit institution-owned task / locked plan fields | — | ✅ | 404 | **403 FIELD_LOCKED_BY_INSTITUTION** (audited DENIED) | 403 | 403 | 401 |
| Teacher's own task / own plan rows | — | — | — | ✅ | 403 | 403 | 401 |
| Un-require a REQUIRED curriculum concept | — | ✅ (curriculum) | 404 | **403** | 403 | 403 | 401 |

## 5. Verification

| Suite | Local | Hosted DEV |
|---|---|---|
| Unit (vitest) | **6,791 / 6,791** (includes 29 new V2 / governance tests) | — |
| Typecheck | clean | — |
| Build | OK | OK (Vercel) |
| Migration cert | ALL CHECKS PASSED | — |
| Roles HTTP E2E | 171 / 171 | 165 / 174 — the 9 failures all come from `GENERATION_FAILED`: hosted DEV AI daily cap reached (596 calls, `RATE_LIMIT`, resets 00:00 UTC). Environmental; unrelated to V2 |
| Teacher HTTP E2E | 119 / 119 | 111 / 119 — same AI-cap root cause (student starts an AI activity → dependent result checks) |
| Institution HTTP E2E | 100 / 100 | 100 / 100 |
| Learning Plan HTTP E2E | 96 / 96 | 96 / 96 |
| Class Progress HTTP E2E | 35 / 35 | 35 / 35 |
| UX notifications + intelligence E2E | 53 / 53 | 53 / 53 |
| **Curriculum V2 + governance E2E (new)** | **138 / 138** | **138 / 138** |

The curriculum V2 HTTP E2E (`scripts/operations/track-a-curriculum-v2-e2e-http.ts`) covers scenarios 54–63 and 103–109 against real Clerk DEV identities, cross-checking the DB read-only:

- AICE 9709 / 9700 / 9702 / 9701 on one grade, with an idempotent replay.
- Level change from A to AS: preview shows added 3 / retired 6 / kept 11; history and decisions are kept.
- Archive Physics.
- Bulk content changes; catalog and structure untouched.
- Class "V2 Matemáticas 3A" created with its curriculum; archived and foreign curricula refused.
- Teacher inheritance; REQUIRED cannot be un-required.
- Class plan with Differentiation and Integration; 2 selected learners; replay creates no duplicate and resets nothing.
- Coverage numbers equal the DB (19 / 2 / 1 / 17); drill-down shows 1 class / 2 students.
- StudyUS block kept separate; security checks.
- SEP adopted with provenance; Bogotá and Antioquia with no duplicate concepts.
- Locked plan row: remove / priority / period / later date denied, earlier date allowed, DB unchanged.
- Institution task: due 20 Oct (stored as `2026-10-21T04:59Z`); teacher PATCH to 21 Oct → 403 and the DB keeps 20 Oct. The recipients-only endpoint rejects extra fields. Publishing with the institution group id is denied. The institution moves the date to 22 Oct and the change propagates and is audited.
- Direct delivery reaches 21/21 learners; the student page shows "Asignación institucional".
- Teacher's own task and plan rows stay editable.
- Audit trail: INSTITUTION CREATED / UPDATED, TEACHER RECIPIENTS_ASSIGNED, UPDATE_ATTEMPT DENIED ×6, REMOVE_ATTEMPT DENIED.

## 6. Verdicts

| Verdict | Result |
|---|---|
| INSTITUTION_CURRICULUM_MANAGEMENT | READY FOR MANUAL E2E |
| INSTITUTION_MULTI_SUBJECT_CURRICULUM | READY FOR MANUAL E2E |
| INSTITUTION_CURRICULUM_ADD_SUBJECT | READY FOR MANUAL E2E |
| INSTITUTION_CURRICULUM_EDIT_SUBJECT | READY FOR MANUAL E2E |
| INSTITUTION_CURRICULUM_ARCHIVE_SUBJECT | READY FOR MANUAL E2E |
| INSTITUTION_CURRICULUM_CONTENT_MANAGEMENT | READY FOR MANUAL E2E |
| INSTITUTION_CURRICULUM_STATUS_MODEL | READY FOR MANUAL E2E |
| CLASS_CURRICULUM_ASSOCIATION | READY FOR MANUAL E2E |
| TEACHER_CURRICULUM_INHERITANCE | READY FOR MANUAL E2E |
| CLASS_PLAN_FROM_INSTITUTION_CURRICULUM | READY FOR MANUAL E2E |
| STUDENT_PLAN_FROM_TEACHER_ASSIGNMENT | READY FOR MANUAL E2E |
| INSTITUTION_CURRICULUM_COVERAGE_ANALYTICS | READY FOR MANUAL E2E |
| STUDYUS_CONTENT_COVERAGE_SEPARATION | READY FOR MANUAL E2E |
| INSTITUTION_CURRICULUM_SECURITY | PASS (automated) |
| INSTITUTION_CURRICULUM_DATA_INTEGRITY | PASS (automated) |
| HOSTED_DEV_READY_FOR_INSTITUTION_CURRICULUM_MANUAL_E2E | READY (all V2 / governance checks pass on hosted; AI-cap failures in roles / teacher are environmental and pre-existing) |
| OFFICIAL_CURRICULUM_AUTHORITY_MODEL | READY FOR MANUAL E2E |
| MEXICO_SEP_CURRICULUM_SUPPORT | READY FOR MANUAL E2E (metadata + provenance; official structure not imported) |
| COLOMBIA_EDUCATION_AUTHORITY_SUPPORT | READY FOR MANUAL E2E (MEN + 2 territorial Secretarías; structure not imported) |
| CURRICULUM_PROVENANCE | PASS (automated) |
| ACADEMIC_AUTHORITY_HIERARCHY | READY FOR MANUAL E2E |
| INSTITUTION_TASK_GOVERNANCE | READY FOR MANUAL E2E |
| INSTITUTION_DATE_LOCKING | PASS (automated) |
| INSTITUTION_FIELD_LEVEL_LOCKING | PASS (automated) |
| TEACHER_RECIPIENT_ONLY_ASSIGNMENT | PASS (automated) |
| TEACHER_SUPPLEMENTAL_AUTONOMY | PASS (automated) |
| INSTITUTION_ASSIGNMENT_SECURITY | PASS (automated) |
| INSTITUTION_ASSIGNMENT_AUDIT | PASS (automated) |

What these verdicts do **not** claim (section 67):

- A single subject does not mean the institution's curriculum is fully configured.
- StudyUS mapping coverage is not presented as curriculum coverage.
- Curriculum coverage is never presented as student mastery.

## 7. Findings and open items

| P | Item |
|---|---|
| P1 | **ALBO class not associated:** ALBO's class "Math" uses canonical subject *Matemáticas*, while its AICE curriculum uses *Mathematics*. The subject + grade backfill therefore did not associate them; this was also true under the V1 heuristic. ALBO's configuration remains visible and ACTIVE with 17 objectives. ALBO was not modified. Fixing it is the coordinator's decision: associate the class in "Clases y currículo", which re-points the class subject and is refused with CLASS_SUBJECT_IN_USE if the class already has an active plan. |
| P2 | SEP and Colombian structures are **not imported** (metadata + provenance only). Content for those subjects comes from catalog concepts until official structures are loaded through the governed catalog pipeline. |
| P2 | The coverage "objectives with concept" figure depends on published objective → concept mappings. AICE now has mappings (9709: 17 concepts); subjects without mappings show 0 plannable objectives by design. |
| P3 | Dead code: `getCurriculumWorkCoverage` (replaced by `getInstitutionCurriculumCoverage`) and `teacherMayAssign` are unused. |
| P3 | "Periodo actual" is still the documented 90-day rule; there are no dated academic periods yet. |

Fixed during this work:

- Bulk content updates that touched the same objective twice used a stale "before" row; later items now see earlier results.
- No-op concept updates are no longer re-written or audited.
- DATE columns are formatted from local date parts (no `toISOString` day shift east of UTC).

## 8. Manual E2E

See [INSTITUTION_CURRICULUM_MANAGEMENT_MANUAL_E2E.md](INSTITUTION_CURRICULUM_MANAGEMENT_MANUAL_E2E.md): 15 steps (V2), addendum steps 1–18, and negative checks N1–N6. **Not executed.**
