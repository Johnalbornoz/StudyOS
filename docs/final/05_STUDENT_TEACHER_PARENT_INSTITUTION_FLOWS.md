# 05 — Student, Teacher, Parent, Institution Flows

Real routes, grounded in `src/app/dashboard/*` and `src/app/api/*` as they exist in this checkout — not a target design.

## Student

| Page | Path | Purpose |
|---|---|---|
| Today | `src/app/dashboard/today/` | Primary daily landing page — next recommended action |
| Subjects / Path | `src/app/dashboard/subjects/`, `src/app/dashboard/path/` | Concept-level learning path navigation |
| Quiz | `src/app/dashboard/quiz/` | AI-generated practice quizzes |
| Exam Prep | `src/app/dashboard/exam-prep/`, `.../[examProfileId]/`, `.../attempt/[attemptId]/` | Formal exam-readiness simulation and item-by-item exam-taking (F15's own new UI) |
| Define target exam | `src/app/dashboard/exam-prep/CreateExamProfileForm.tsx`, `src/app/api/exam-profiles/route.ts` | Student selects a named active exam with a published version; the server revalidates authorization and catalog compatibility before creating the profile |
| Assignments | `src/app/dashboard/assignments/`, `.../practice/` | Teacher-assigned reinforcement work |
| Learning Debt | `src/app/dashboard/learning-debt/` | Concepts flagged as needing review |
| Remediation | `src/app/dashboard/remediation/[pathId]/` | Guided remediation path for a specific gap |
| Tutor | `src/app/dashboard/tutor/` | AI conversational tutor |
| Cognitive (Explain/Transfer) | `src/app/dashboard/cognitive/` | Deep-explanation and transfer-learning exercises |
| Study Plan | `src/app/dashboard/study-plan/` | Personal scheduling |
| Profile / Onboarding | `src/app/dashboard/profile/`, `.../onboarding/` | Account setup |

**Exam-taking flow (F15, the phase's own principal functional deliverable)**: `item-resolution.service.ts` wires `SimulationPlanTarget` (F9) to actual question content, `ItemRunner.tsx` renders it, grading is 100% delegated to F9's own already-certified `recordSimulationItemResponse`/`computeReadinessSnapshot` — never re-implemented. **IMPLEMENTED, TESTED** (11 unit tests). **Not yet LIVE VERIFIED** — pending the authenticated E2E session.

## Teacher

| Page | Path | Purpose |
|---|---|---|
| Teacher home | `src/app/dashboard/teacher/` | Class roster overview |
| Class detail | `.../teacher/classes/[classId]/` | Per-class view |
| Student detail | `.../teacher/students/[studentId]/` | Per-student intervention/assignment view |

**Intervention flow**: Teacher → `TeacherAssignment` (requires `INSTITUTION_ADMIN`-managed membership/assignment/enrollment, see 04) → intervention created via `LEARNER_INTERVENTION_CREATE` → execution tracked through `teacher_intervention_executions` → reconciliation against the student's actual attempt. Reconciliation is **intentionally lazy** (by design, not a bug) — see [06_EXAM_READINESS_AND_INTERVENTIONS.md](06_EXAM_READINESS_AND_INTERVENTIONS.md).

## Parent

| Page | Path | Purpose |
|---|---|---|
| Parent home | `src/app/dashboard/parent/` | Read-model over one or more children via `parent_student_relationships` |

Requires an `accepted` relationship row (see 04's permission matrix) — `pending`/`declined`/`revoked` relationships grant zero access, negative-tested.

## Institution

| Page | Path | Purpose |
|---|---|---|
| Institution home | `src/app/dashboard/institution/[institutionId]/` | Landing |
| Learners | `.../learners/` | Roster |
| Grades / Classes / Teachers | `.../grades/`, `.../classes/`, `.../teachers/` | Structural management |
| Coverage | `.../coverage/` | Curriculum coverage aggregate |
| Readiness | `.../readiness/` | Aggregate exam-readiness, cohort-suppressed (F12/F15 MIN_COHORT_POLICY) |
| Attention / Interventions | `.../attention/`, `.../interventions/` | Aggregate intervention summary |

All aggregate views apply MIN_COHORT_POLICY suppression (minimum cohort size 10, a real versioned product decision — see F15's `ADR-F15-MIN-COHORT-POLICY.md`) so no institution admin can back out an individual student's result from a too-small cohort.

**Known, disclosed UX gap** (`IVG-F14-02`, **DEFERRED**): Coverage/Readiness pages require a raw structure/exam-version ID — no picker UI exists yet. A real institution admin would need operator assistance during onboarding until this is built.

## Multi-role / cross-workspace

A single Clerk-authenticated user may hold multiple `user_roles` (e.g. Teacher + Parent). `active_workspace` on `users` tracks which workspace UI is currently presented; authorization checks are always scoped to the role the specific route requires, never to "any role this user happens to have" (see 04).

## Status of this section

- Route existence and code wiring: **IMPLEMENTED**.
- Domain logic behind each flow: **TESTED** (unit + real-Postgres certification scripts per phase — see [12_TESTING_AND_CERTIFICATION.md](12_TESTING_AND_CERTIFICATION.md)).
- End-to-end live behavior for a real logged-in user in each workspace: **BLOCKED pending operator-assisted login** (in progress — see [13_PILOT_RUNBOOK.md](13_PILOT_RUNBOOK.md)).
