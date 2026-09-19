# F11-C2 — Authorization Certification

Executed for real against ephemeral Postgres via `f11c2-skill-execution-migration-cert.sh` → `f11c2-skill-execution-cert-runner.ts`. Every case is a real service call, real database rows, never a mock.

## Adversarial matrix (task §24, cases J–M)

| Case | Scenario | Result |
|---|---|---|
| J | A different Student → another Student's Skill intervention | **DENY** |
| K | Accepted Parent relationship → Student route | **DENY** |
| L (assigning Teacher) | The Teacher who assigned the intervention → Student route | **DENY** |
| L (unrelated Teacher) | A Teacher with no relationship at all → Student route | **DENY** |
| M | PARENT+TEACHER actor with real relationships to *other* students → an intervention belonging to a student they do not own | **DENY** |
| B (nonexistent skill) | Assign with a nonexistent skill id | **DENY** at assignment (F11-B's existing FK) |
| B (retired skill) | Assign a RETIRED skill (F11-B does not check status), then attempt to start it | Assignable, but **DENY at start** (F11-C2's new status check) |
| I | Skill with zero valid, student-matched concept context | **DENY**, controlled — zero execution rows created |

## Owner/Teacher semantics do not imply each other

- Case 11 (carried from F11-C1, re-verified in this run's shared fixture logic): the Student's own Owner identity does not satisfy Teacher authorization — cannot assign, cancel, or view via the Teacher surface.
- Every Skill-execution denial above is via `isOwner` alone — never `canTeacherAccessLearner`/`canTeacherManageIntervention`, never `isActiveParentOf`, never the generic composed `canAccessLearner` (source-guard proven).

## Server-side authorization discipline

`startTeacherInterventionExecution` (the dispatcher) performs a lightweight, unlocked type lookup only to route to the correct handler — it performs no authorization decision itself. Both `startConceptReinforcementExecution` and `startSkillReinforcementExecution` independently re-run the full chain (row lock → `isOwner` → effective status → target validity → idempotency) as their own first action, never trusting a caller (including the dispatcher) to have checked anything.

## Verdict

**PASS.** No case found cross-student access, Parent-authorized execution, Teacher-authorized execution (assigning or unrelated), or multi-role leakage. Both invalid-target cases (nonexistent, retired) and the mismatched-context case are cleanly denied with zero side effects (zero execution rows, zero quiz sessions, zero evidence).
