# F12 — Institution Authorization Model

## The chain (task section 6)

```
authenticated actor (verifyAuth + getOrCreateCanonicalUser -- never a client-supplied user id)
        v
institution (server-resolved institutionId from the URL path, never trusted merely because it appears in the request)
        v
active APPROVED membership (F2's own institution_memberships, membership_role = 'INSTITUTION_ADMIN')
        v
requested scope (INSTITUTION / GRADE / CLASS / learner drill-down)
        v
authorized read
```

`requireInstitutionAccess` is the ONLY institution-wide gate, and it is nothing more than F2's own `canAccessInstitution` (unchanged) called with a new, purely-labeling permission value (`INSTITUTION_INTELLIGENCE_VIEW`, added to `InstitutionPermission` for call-site clarity only — `canAccessInstitution`'s actual check never branches on it, exactly like `TeacherInterventionPermission`'s own three values before it). No new authorization primitive exists (INV-F12-22).

## Institution role alone grants nothing (INV-F12-01, AC-F12-03)

Holding an `INSTITUTION_ADMIN` role string means nothing by itself. `canAccessInstitution` requires a real row in `institution_memberships` with `status = 'APPROVED'` for THIS exact institution id — a `PENDING`, `REJECTED`, or `REVOKED` membership fails identically to having none at all (Cases B/C, real-Postgres proven).

## Scope narrowing, never widening (task section 8/28)

- **Grade/Class scope**: `requireClassInInstitution` first re-verifies institution access, THEN checks the class's own `institution_id` column matches — a class in a different institution is denied even if its id is syntactically valid and the actor is a real, approved admin of some other institution (Case F). Filters (`classId`, `gradeId`, `interventionType`, `sinceDays`) only ever narrow the WHERE clause of an already-authorized query — none of them can substitute for or bypass the institution check.
- **Learner drill-down**: `requireLearnerInInstitution` re-verifies institution access, then requires an ACTUAL `ACTIVE` `class_enrollments` row placing that learner in a class of THIS institution — never inferred from the learner id alone (Case H).

## Cross-role matrix (task section 41, all real-Postgres proven)

| Actor | Target | Result |
|---|---|---|
| Institution A admin | Institution A | ALLOW |
| Institution A admin | Institution B | DENY |
| Institution A admin | Class in Institution B | DENY |
| Institution A admin | Learner enrolled only in Institution B | DENY |
| Revoked institution membership | Own (formerly authorized) institution | DENY |
| Teacher (real, approved membership + active class assignment) | Their own institution's intelligence | DENY -- a Teacher's role never satisfies `canAccessInstitution` (which requires `membership_role = 'INSTITUTION_ADMIN'`) |
| Parent (real, accepted relationship to a real enrolled learner) | That learner's institution | DENY |
| Student | Any institution intelligence | DENY (no code path grants it) |
| PARENT + TEACHER multi-role (real Teacher role + real accepted Parent relationship to a real learner in the institution) | That institution | DENY -- neither role, nor their combination, satisfies the `INSTITUTION_ADMIN` membership check |
| INSTITUTION_ADMIN + another role | Institutions they are NOT an approved admin of | DENY, scoped only to institutions where the APPROVED membership actually exists |

## Why this is safe by construction, not by convention

`canAccessInstitution`/`canAccessClass` are F2's own, already-independently-certified functions (F2/F10/F11's own regression suites re-verify them unchanged in this phase too). F12 adds zero new SQL for the authorization DECISION itself — only for the analytics computation that happens strictly AFTER a `requireInstitutionAccess`/`requireClassInInstitution`/`requireLearnerInInstitution` call has already thrown or returned.
