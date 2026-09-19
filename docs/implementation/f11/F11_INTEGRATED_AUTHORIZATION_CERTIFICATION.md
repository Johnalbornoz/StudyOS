# F11 — Integrated Authorization Certification

The full matrix from task §4, exercised in ONE integrated run against ONE real Teacher/class/student fixture (plus dedicated fixtures for the cross-class/cross-institution cases), never per-type in isolation.

## Matrix

| Case | Scenario | Result |
|---|---|---|
| Teacher role alone, no assignment | Approved TEACHER membership at the institution, but no `teacher_assignments` row for this class | **DENY** at assignment time (`canAccessClass` fails; `TeacherInterventionAccessDeniedError`) |
| Teacher correct class/assignment | Real, active assignment covering the target class | **ALLOW** — proven by all four intervention types being successfully assigned and started in the integrated flow |
| Teacher wrong class | A Teacher with a real, approved membership and a real assignment to a DIFFERENT class | **DENY** |
| Cross-student | A different Student attempts to start another Student's intervention | **DENY** |
| Parent attempting Student execution | An accepted Parent relationship | **DENY** |
| Teacher attempting Student execution route | The assigning Teacher, via the Student's own start path | **DENY** |
| PARENT + TEACHER multi-role | An actor with a real Teacher role (elsewhere) AND a real, accepted Parent relationship to THIS student | **DENY** — role combination never widens Student ownership |
| Institution role alone | An INSTITUTION_ADMIN (who CAN access the class/institution for assignment purposes) | **DENY** for Student execution — `isOwner` is never satisfied by an institution role |

## The single authorization primitive, proven across all four types

Every DENY above is produced by `isOwner` alone on the Student execution side, and by `canAccessClass`/`canTeacherManageIntervention` alone on the Teacher assignment side — never the generic composed `canAccessLearner`, never conflated. This was independently true within each of F11-A/B/C1/C2/C3/C4's own certifications; this gate additionally proves it holds when all four types are exercised in ONE continuous flow against ONE shared fixture, so no type-specific authorization drift exists between them.

## PAA Full Mock convergence (task §7)

| Actor | Action | Result |
|---|---|---|
| Teacher | Assigns + Student attempts to start a PAA FULL_MOCK intervention | **REJECTED** at start (`StudentInterventionNotStartableError`, reasons include `MANDATORY_DOMAIN_INCOMPLETE`/`COMPONENT_UNSUPPORTED: Reading Section`) |
| Student | Self-service `getSimulationEligibility` for the SAME PAA exam version, FULL_MOCK | **`eligible: false`**, identical structural reasons |

Both paths call the exact same `getSimulationEligibility` → `getFullMockEligibility` → `canFullMockBeOffered` chain — verified directly in this run, not merely asserted by design. Teacher assignment and Student self-service converge on ONE eligibility authority; there are not two independently-maintained "is Full Mock ready" truths anywhere in the system.

## Verdict

**PASS.** No case found cross-student access, Parent-authorized execution, Teacher-authorized execution (assigning, wrong-class, or unassigned), multi-role leakage, or institution-role Student-execution authority, across the full joint matrix.
