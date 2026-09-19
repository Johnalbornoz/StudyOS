# F11-C3 — Authorization Certification

Executed for real against ephemeral Postgres via `f11c3-competency-execution-migration-cert.sh` → `f11c3-competency-execution-cert-runner.ts`. Every case is a real service call, real database rows, never a mock.

## Adversarial matrix (task §22/§23, cases N–Q)

| Case | Scenario | Result |
|---|---|---|
| N | A different Student → another Student's Competency intervention | **DENY** |
| O | Accepted Parent relationship → Student route | **DENY** |
| P (assigning Teacher) | The Teacher who assigned the intervention → Student route | **DENY** |
| P (unrelated Teacher) | A Teacher with no relationship at all → Student route | **DENY** |
| Q | PARENT+TEACHER actor with real relationships to *other* students → an intervention belonging to a student they do not own | **DENY** |
| B (nonexistent competency) | Assign with a nonexistent competency id | **DENY** at assignment (F11-B's existing FK) |
| C (retired competency) | Assign a RETIRED competency (F11-B does not check status), then attempt to start it | Assignable, but **DENY at start** (F11-C3's new status check) |
| M | Competency with zero valid, student-matched concept context | **DENY**, controlled — zero execution rows created |

## Owner/Teacher semantics do not imply each other

Every Competency-execution denial above is via `isOwner` alone — never `canTeacherAccessLearner`/`canTeacherManageIntervention`, never `isActiveParentOf`, never the generic composed `canAccessLearner` (source-guard proven, same discipline as F11-A/F11-B/F11-C1/F11-C2). Competency membership in a shared curriculum/framework (task §23) never widens learner authorization — no authorization code path reads `competencies`/`canonical_concept_competencies` at all.

## Server-side authorization discipline

`startTeacherInterventionExecution` (the dispatcher) performs a lightweight, unlocked `intervention_type` lookup only to route to the correct handler — it performs no authorization decision itself. `startCompetencyReinforcementExecution` independently re-runs the full chain (row lock → `isOwner` → effective status → target validity → idempotency) as its own first action, never trusting the dispatcher or any caller to have checked anything, exactly matching `startConceptReinforcementExecution`/`startSkillReinforcementExecution`.

## Verdict

**PASS.** No case found cross-student access, Parent-authorized execution, Teacher-authorized execution (assigning or unrelated), or multi-role leakage. Both invalid-target cases (nonexistent, retired) and the mismatched-context case are cleanly denied with zero side effects (zero execution rows, zero quiz sessions, zero evidence).
