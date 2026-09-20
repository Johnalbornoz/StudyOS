# F13 — Teacher Experience

## Built from zero UI onto an already-real, certified backend (task section 17)

Before F13, the Teacher backend (F11-A/B/C1-C4) was fully built and certified with **no consuming UI at all**. F13 builds the first real Teacher workspace:

```
/dashboard/teacher                              -- My Classes (getTeacherAssignedClasses)
/dashboard/teacher/classes/[classId]            -- Roster (getTeacherClassRoster)
/dashboard/teacher/students/[studentId]         -- Overview + Interventions + Assign form
```

Every page calls the real F11-A/B service functions directly (server components, no self-HTTP-call) and independently re-verifies authorization inside those functions — the pages themselves make no authorization decision (INV-F13-01).

## The four intervention types remain visually and structurally distinct (task section 18, AC-F13-10)

`AssignInterventionForm` renders a COMPLETELY different field set per `targetType` (CONCEPT → concept id; SKILL → skill id; COMPETENCY → competency id; EXAM → exam profile id + simulation type +, depending on simulation type, either a learning objective id or an academic subject id) — switching `targetType` never carries a prior selection's value into the new shape (each branch has its own local state). No code path infers one target type from another.

## Exam eligibility is never overridden by the Teacher UI (task section 18, INV-F13-17)

The form lets a Teacher select `FULL_MOCK` as a simulation type — submission goes through the REAL, unmodified `assignTeacherIntervention`/`startExamReinforcementExecution` chain (F11-C4), which independently calls F9's real `getSimulationEligibility` before ever creating an attempt. A PAA Full Mock assignment is accepted (Teacher intent is not gated), but the SUBSEQUENT start attempt is rejected by the same real guard a Student self-service attempt would hit — the UI performs no eligibility check of its own and cannot bypass this (re-verified: F11-C4's and F11 Integrated's own real-Postgres Full Mock NOT_READY certifications re-ran unchanged in this phase).

## A real, load-bearing gap found and fixed

`POST /api/teacher/interventions` never had a schema branch for `EXAM` targets (see `F13_CURRENT_UX_ARCHITECTURE_ASSESSMENT.md`) — fixed this phase, structurally guarded by a new test (`f13-ux-consolidation-source-guard.test.ts`) so it cannot silently regress.

## Wrong-class access remains DENY (task section 47, AC-F13-19)

`getTeacherClassRoster`/`getTeacherStudentOverview`/`listTeacherInterventionsForStudent` all independently re-verify the actor's real, ACTIVE Teacher assignment — a `classId`/`studentId` outside the Teacher's own scope renders `notFound()` (never a distinguishable "exists but forbidden" response, per task section 40). Re-verified by regression (F11-A's own real-Postgres wrong-class/wrong-student adversarial cases).

## What was deliberately not built this phase

A Class-level aggregate view (roster + evidence sufficiency + coverage + readiness in one place, task section 24) and a dedicated Exam Prep sub-view for the Teacher's own students — both real, disclosed scope decisions given the amount of ground already covered building the Teacher workspace from zero. See `F13_NEXT_PHASE_HANDOFF.md`.
