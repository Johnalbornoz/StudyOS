# Track A — Teacher E2E Readiness

- **Branch:** `track-a/roles-e2e` (local; not merged, final push not done).
- **Scope:** everything a Teacher needs for the end-to-end journey: the class model, enrollment, the assignment lifecycle, learner visibility, intervention, tenant security, deterministic data, evidence queries and the manual package.
- **Status:** READY for the manual gate. **Not certified.** `TEACHER_E2E` is not declared PASS; that requires the operator's manual run.
- **Unchanged:** Student cognition and the Learning Engine. Main, develop, Stage/Preview, Production and Track B are untouched.

## 1. Teacher functional contract (frozen)

| Rule | Where enforced |
|---|---|
| One account → one persona. Teresa chooses **Teacher** once. A Teacher cannot add Student or Parent (409 `PERSONA_EXISTS`, 0 rows written). | `assignSelfServiceRole`, `/api/identity/roles/select` (PA-01) |
| Institution administration and StudyUS administration are capabilities, not personas. | shell context, admin guards |
| A Teacher reaches institution data only through an **APPROVED** membership plus an **ACTIVE** scope (class or grade) in the **same** institution. | `isTeacherOfClass`, `canTeacherAccessLearner` |
| A Teacher can never: create canonical subjects; create classes or link subjects; assign themselves to a class; approve themselves; change ownership; see other classes or institutions; edit phases, mastery, evidence, retention or transfer. | route guards (403/404) plus source guards |

## 2. Hierarchy

`Institution → Grade → Class (→ one canonical Subject) → Teacher scope → ACTIVE enrollments → Assignments`

- **New:** `classes.canonical_subject_id`. The Institution Admin links each class to one ACTIVE catalog subject, either at creation or later (`PATCH /api/institutions/[id]/classes/[classId]`).
- **What the subject scopes:**
  - the topics a Teacher can assign (the ACTIVE concepts of that subject);
  - the topic check on every publish;
  - the Teacher learner view.
- **Without a subject:** the class offers no topics, and publishing returns 422 `CLASS_SUBJECT_REQUIRED`.

## 3. Audit result: what existed vs. what was built

| Requirement | Existed (Track A, pre-readiness) | Built now |
|---|---|---|
| Admin creates grade/class, assigns teacher; teacher sees class | yes | Class ↔ subject link (create + change). Teacher home shows *Class · Subject*, institution, grade and counts. Teacher and staff names shown as *Nombre · email*. |
| Enrollment | admin-only invite, consent-based | **The Teacher invites to their own class** (`/api/teacher/classes/[classId]/enrollments`). The Teacher can withdraw or remove (`…/[enrollmentId]/end`). A shared invite helper is used. An acceptance notifies the inviting Teacher in the **Teacher** inbox. |
| Assignment lifecycle | topic + instructions + due; whole class only | **Title** and **start date**. Recipients: **whole class or selected learners** (every selected learner must be ACTIVE here, otherwise 422 and 0 writes). Topic must be in the **class subject**; due date must be after the start date. Student list shows the title and *Disponible desde*. Start is refused before `starts_at`. |
| Statuses | ASSIGNED / IN_PROGRESS / COMPLETED / effective EXPIRED | Unchanged storage. Presented as **Asignada / En curso / Completada / Vencida** (ASSIGNED / STARTED / COMPLETED / OVERDUE), with per-assignment counts. |
| Learner visibility | F11 overview (counts only) | **Teacher learner view** (`/dashboard/teacher/classes/[classId]/students/[studentId]`, API `…/students/[studentId]`). See §4. |
| Who needs help | — | Class page **"Quién necesita ayuda"** (`/api/teacher/classes/[classId]/attention`): who → on what → why → what the Teacher can do. |
| Intervention | per-learner concept picker | From the learner page: *Asignar o reasignar práctica* (composer preset to that learner and the topic needing attention), cancel. No phase/mastery/evidence edit exists. |
| Legacy URL | `/dashboard/teacher/students/[id]` | Redirects to the class-scoped learner view. Otherwise not-found. |

## 4. Teacher learner view (read-only projection)

Every learning fact comes from an existing, audited **read** function. None of them performs a hidden write.

| Shown | Source |
|---|---|
| Context: learner, class, grade, subject, institution | class + enrollment |
| Phase (LEARN → PRACTICE → PROVE → RETAIN → TRANSFER), next step, waiting date, REINFORCE | `getCanonicalPedagogicalDecision` (the one canonical authority) |
| Valid practice *n of m*; last successful demonstration | `decision.practiceProgress`, `decision.lastQualifyingProveAt` |
| Memory status, review due, next review | `getTwinMemorySignal` |
| Transfer depth | `getConceptTransferDepth` |
| Evidence summary and the 5 latest results | `getConceptEvidenceSummary` / `getConceptEvidenceHistory` |
| Misconceptions (count and descriptions), slips vs real errors (30 days), prerequisite gaps | `getMisconceptionCountsForConcept` and active signatures; `quiz_response_grades.learner_signal`; `getActiveDiagnoses` |
| The learner's assignments in this class (status, dates, graded result) | `listClassAssignments` |

**Gates.** The actor must **teach this class**, the learner must be **ACTIVE in it**, and `canTeacherAccessLearner` must pass. Anything else returns 403/404 with no data.

**Never read here:** Tutor conversations, parent data, billing, subjects other than the class's subject, or other learners. This is source-guarded.

**"Needs help"** (`deriveTeacherAttention`, pure) is read straight off the engine's outputs, in this priority order:
1. overdue assignment;
2. active misconception;
3. REINFORCE;
4. prerequisite gap;
5. retention due;
6. not started.

Each reason maps to one suggested Teacher action. No new score thresholds are introduced.

## 5. Architecture decisions

1. **The subject lives on the class** (one nullable column). There is no new subject table, and the Teacher never creates catalog content.
2. **An assignment is still N per-learner interventions** sharing one `assignment_group_id`. Each row goes through the certified `assignTeacherIntervention` chain. `title` and `starts_at` are additive columns. Selected recipients narrow N; nothing else changes.
3. **Start-date gating** sits in the single execution dispatcher, checked after the owner check. A future assignment is visible but not startable.
4. **Learner view = projection, not a second authority.** The stage and next action come only from `getCanonicalPedagogicalDecision`. Read paths with hidden writes (`getActiveDebts`, `getLearningDecisions`, the Learning OS snapshot, `getSubjectHierarchy`, teaching intents) are banned by the source guard.
5. **One invitation path** (`inviteToClassAndNotify`) serves both Institution Admin and Teacher. Each route authorizes its own actor first.
6. **The Teacher's routes resolve the institution from the class.** A client-supplied institution id is never used.

## 6. Migration (DEV only)

`database/migrations/20261018_1100_track_a_teacher_e2e.sql` is additive and idempotent. It adds:
- `classes.canonical_subject_id` (FK, partial index);
- `teacher_interventions.title` (CHECK 1–200);
- `teacher_interventions.starts_at`.

Rollback is in the header.

**Certification.** `scripts/operations/track-a-roles-migration-cert.sh` runs on an ephemeral PG18 and passes: idempotent, FK rejects an unknown subject, title check, rollback, re-apply.

**DEV ledger:** 43 applied, 0 pending, 0 drift.

## 7. Deterministic data

`track-a-fixtures.ts provision` + `teacher-reset`, DEV only, enforced by the DB fingerprint and the Clerk instance:

| Identity | Role in the journey |
|---|---|
| **Ana Coordinadora A** (`inst-a`) | Institution Admin of *TA Institución A* (empty: no grade, class or teacher) |
| **Teresa Docente A** (`teacher-a`) | **No persona.** Chooses Teacher in step 1. |
| **Sofía Estudiante A** (`student-a`) | Student, first-run complete, outside every class. 30-day fixture licence (`grantAdminLicense`, audited, actor = fixture admin capability holder, reason `TRACK_A_TEACHER_E2E_DEV_FIXTURE`). Own subject *Matemáticas* with *Ecuaciones lineales*, MATCHED to catalog *Linear Equations* (subject *Mathematics*). |
| **Tomás Docente B / Samuel Estudiante B** | *TA Institución B*, class *Matemáticas 9B* (Mathematics). Targets for the negative cases. |

**Sofía's learning history, through the governed path only** (`track-a-teacher-e2e-http.ts --learner-data-only`):
- The canonical decision picks each activity.
- The real Student API generates and grades it.
- `updateMastery` records the evidence.
- No SQL touches cognitive tables.

Typical result: learn check 5/5, then practice 2/3 and practice 1/3, giving canonical phase PRACTICE (1 of 2 valid practices). A misconception was **not** produced: multiple-choice grading does not create misconception signatures, and none was fabricated.

## 8. Evidence queries (read-only)

`scripts/operations/track-a-teacher-evidence.ts <1..15|integrity|all>` runs inside `BEGIN READ ONLY` and refuses non-DEV databases.

It covers, step by step: persona rows, membership + audit, scopes, notifications, structure (grade → class → subject), enrollment (inviter, timestamps), Sofía's evidence and activities, assignment rows, executions, graded result and mastery.

Integrity checks:
- accounts with more than one persona = 0;
- duplicate enrollments = 0;
- cross-tenant interventions = 0;
- interventions for never-enrolled learners = 0;
- Student B evidence unchanged;
- the migration ledger.

## 9. Automated verification

| Suite | Result |
|---|---|
| Unit (full) | see the release message for the exact count at the candidate SHA |
| New unit files | `track-a-teacher-e2e-services.test.ts` (17), `track-a-teacher-e2e-routes.test.ts` (16), source guards extended (+4) |
| Roles E2E (`track-a-e2e-http.ts`) | 170/170 locally on this code |
| Teacher E2E (`track-a-teacher-e2e-http.ts`, 18 steps + learner data) | 104/104 locally; hosted run in the release message |
| Migration cert | ALL CHECKS PASSED |

## 10. Open items

| Item | Class |
|---|---|
| A controlled misconception cannot be produced through the governed path with multiple-choice activities. The learner view shows the misconception section correctly empty. | P3 |
| F12 institution intelligence sub-pages still show engineering-English text (not on the Teacher journey screens). | P2 (pre-existing, unchanged) |
| No DRAFT state for assignments; publish is one step. | P3 (Foundation §16) |
| Exam assignment target in the class composer | Deferred (cross-track) |
| `scripts/e2e-cognitive-loop.ts` drift | P3 (pre-existing) |
