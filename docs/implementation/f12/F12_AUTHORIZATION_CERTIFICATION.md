# F12 — Authorization Certification

Executed for real against ephemeral Postgres via `f12-institution-intelligence-migration-cert.sh` → `f12-institution-intelligence-cert-runner.ts`. Every case is a real service call, real database rows, never a mock.

## Matrix (task section 40/41)

| Case | Scenario | Result |
|---|---|---|
| A | Active APPROVED INSTITUTION_ADMIN membership | **ALLOW** |
| B | No institution membership at all | **DENY** |
| C | REVOKED institution membership | **DENY** |
| D | Institution A admin → Institution B | **DENY** |
| E | Class in the SAME institution | **ALLOW** |
| F | Class in a DIFFERENT institution | **DENY** |
| G | Learner with an ACTIVE enrollment in the authorized institution | **ALLOW** (minimized summary) |
| H | Learner with no enrollment in the authorized institution | **DENY** |
| U | Accepted Parent relationship to a real enrolled learner | **DENY** |
| V | TEACHER role alone (real approved membership + real active class assignment) | **DENY** |
| W | PARENT + TEACHER multi-role (real Teacher role elsewhere + real accepted Parent relationship to a real learner in the institution) | **DENY** |

Student role: no code path in the module grants Student-originated access at all (no `isOwner`/`isActiveParentOf`/`canTeacherAccessLearner` composition exists anywhere in `institution-intelligence/`) — DENY by construction, not by a specific negative test.

## Institution role alone grants nothing (INV-F12-01, AC-F12-03/04)

Case B/C jointly prove this: possessing the string `INSTITUTION_ADMIN` conceptually (e.g., having once had a membership) is insufficient — only a currently `APPROVED` row satisfies `canAccessInstitution`.

## Cross-institution isolation (INV-F12-03, AC-F12-05)

Case D/F: an admin's real, valid, approved membership to Institution A produces zero access to Institution B's overview or any of Institution B's classes — the SAME `canAccessInstitution`/`canAccessClass` calls that ALLOW for A correctly DENY for B, because the underlying membership/institution_id rows genuinely differ.

## Learner drill-down never inferred from the id alone (task section 25, AC-F12-08)

Case G/H: `requireLearnerInInstitution` performs a real `class_enrollments`/`classes` join requiring an ACTIVE row — a syntactically valid, real `studentId` belonging to a DIFFERENT institution is denied exactly as if it did not exist.

## Verdict

**PASS.** No case found cross-institution access, institution-role-alone access, Parent-authorized access, Teacher-authorized access, or multi-role widening.
