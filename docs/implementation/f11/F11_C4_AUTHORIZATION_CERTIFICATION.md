# F11-C4 — Authorization Certification

Executed for real against ephemeral Postgres via `f11c4-exam-execution-migration-cert.sh` → `f11c4-exam-execution-cert-runner.ts`. Every case is a real service call, real database rows, never a mock.

## Adversarial matrix (task §26-29, cases H-L)

| Case | Scenario | Result |
|---|---|---|
| H | The actual Student owner | **ALLOW** |
| I | A different Student → another Student's Exam intervention | **DENY** |
| J | Accepted Parent relationship → Student route | **DENY** |
| K (assigning Teacher) | The Teacher who assigned it → Student route | **DENY** |
| K (unrelated Teacher) | A Teacher with no relationship at all → Student route | **DENY** |
| L | PARENT+TEACHER actor with real relationships to *other* students → an intervention belonging to a student they do not own | **DENY** |
| C | Exam profile belonging to a DIFFERENT student → assignment | **DENY** (`TeacherInterventionExamProfileMismatchError`, at assignment time) |
| B | An exam version that is DRAFT (never PUBLISHED) → start | **DENY** (`StudentInterventionNotStartableError`, at start time) |

## Owner/Teacher semantics do not imply each other

Every Exam-execution denial above is via `isOwner` alone — never `canTeacherAccessLearner`/`canTeacherManageIntervention`, never `isActiveParentOf`, never the generic composed `canAccessLearner` (source-guard proven, same discipline as every prior F11 sub-phase). Shared exam definitions (task §27, "shared curriculum/framework must never widen learner authorization") never widen Teacher learner scope — no authorization code path reads `exam_definitions`/`student_exam_profiles` for the purpose of deciding WHO may act, only WHAT is being acted on.

## Exam profile ownership — defense in depth (task §7)

Validated twice, independently: once in `assignTeacherIntervention` (F11-B) at assignment time, and again in `startExamReinforcementExecution` at start time. Neither layer trusts the other.

## Server-side authorization discipline

`startTeacherInterventionExecution` (the dispatcher) performs a lightweight, unlocked `intervention_type` lookup only to route to the correct handler — it performs no authorization decision itself. `startExamReinforcementExecution` independently re-runs the full chain (row lock → `isOwner` → effective status → target validity → idempotency → exam-context validity → eligibility) as its own first action, exactly matching `startConceptReinforcementExecution`/`startSkillReinforcementExecution`/`startCompetencyReinforcementExecution`.

## Verdict

**PASS.** No case found cross-student access, Parent-authorized execution, Teacher-authorized execution (assigning or unrelated), or multi-role leakage. Both invalid-target cases (mismatched profile, unpublished version) are cleanly denied with zero side effects.
