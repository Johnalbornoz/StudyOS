# L9_INSTITUTION — Report

Run date: 2026-10-11 (UTC).

## LANE

| | |
|---|---|
| Lane | `L9_INSTITUTION` |
| Scope | IN-1 (bulk add from an email list) and IN-3 (a Student leaves a class). Nothing else. |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-l9-institution` |
| Branch | `feat/l9-institution-in1-in3` (new, local only, created from `4fb45b0`) |
| Contract | The Orchestrator's launch message, plus `L3R1_REPORT.md` section 3 (rows IN-1, IN-3) and section 7. There is no `tasks/L9_INSTITUTION.md` in the control plane. |

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

## BASE SHA

`4fb45b093ce6ba58a4b3f82d211bea2f978e33d1` — HEAD of `fix/security-p1-remediation`, verified with `git rev-parse` before the worktree was created. The new worktree was clean.

## FINAL SHA

`7e2bc29` is the implementation commit (parent `4fb45b0`). This report and the final status file are one further commit on top of it; `git rev-parse feat/l9-institution-in1-in3` gives that value.

## FILES CHANGED

New application code (9):

- `src/app/api/institutions/[id]/students/bulk/route.ts` — IN-1
- `src/app/api/institutions/[id]/teachers/bulk/route.ts` — IN-1
- `src/app/dashboard/institution/[institutionId]/BulkAddForms.tsx` — IN-1 (paste or upload a list, per-address result)
- `src/lib/institution/email-list.ts` — IN-1 (parse, normalize, limit of 100; shared by browser and server)
- `src/app/api/student/class-enrollments/[id]/leave/route.ts` — IN-3
- `src/app/api/student/class-enrollments/route.ts` — IN-3 (GET: the caller's own ACTIVE enrolments)
- `src/lib/institution/student-class-membership.ts` — IN-3 (list own, leave own)
- `src/app/dashboard/profile/StudentClassMemberships.tsx` — IN-3 (the "leave" control)
- `src/lib/i18n/institution-roster-messages.ts` — strings for both, 5 locales (`messages.ts` not edited)

Modified application code (5):

- `src/lib/institution/institution-operations.service.ts` — adds `bulkAddStudentsToClass` and `bulkInviteTeachers`; the email lookups of `addStudentToClass` and `inviteTeacher` were moved into four private helpers so the bulk pre-check resolves the same account as the single add. Same SQL, no behaviour change.
- `src/app/dashboard/institution/[institutionId]/students/page.tsx` — mounts the bulk form
- `src/app/dashboard/institution/[institutionId]/classes/[classId]/page.tsx` — mounts the bulk form for that class
- `src/app/dashboard/institution/[institutionId]/teachers/page.tsx` — mounts the bulk teacher form
- `src/app/dashboard/profile/InstitutionalContextCard.tsx` — one import and one mount line

New tests (3): `tests/unit/l9-in1-bulk-add.test.ts`, `tests/unit/l9-in3-student-leave-class.test.ts`, `tests/unit/l9-roster-fake-db.ts` (in-memory database helper).

Documentation (2): `docs/orchestration/status/L9_STATUS.md`, `docs/orchestration/reports/L9_REPORT.md`.

Not changed: any migration or schema, `src/lib/institution/route-guard.ts`, `src/lib/authorization/**`, `src/services/institution.service.ts`, `src/app/dashboard/profile/page.tsx`, `src/lib/i18n/messages.ts`, `layout.tsx`, navigation files, `package.json`. No environment, flag, Stage or Production access. Nothing pushed.

Four paths are inside the lane's ownership but not named in the IN-1 / IN-3 rows; the Orchestrator should confirm them:

| Path | Why |
|---|---|
| `teachers/page.tsx`, `teachers/bulk/route.ts` | The IN-1 row says "students and teachers", but its file list names only students and classes. See Finding 6. |
| `api/student/class-enrollments/route.ts` (GET) | The leave route is keyed by enrolment id, and no existing Student route returns that id. |
| `dashboard/profile/StudentClassMemberships.tsx` | A client control has to live in its own file. It sits next to the card that mounts it. L7's uncommitted work adds `ParentAccessCard.tsx` and `parent-access.ts` in the same directory; the names do not collide. |

## LOCKS USED

- None held. `SCHEMA_AND_MIGRATIONS`, `STAGE_RUNTIME`, `PRODUCTION`, `INTEGRATION_MERGE`: not used.
- `SHARED_FOUNDATION` (not activated): nothing in its scope was edited. The lane reads `class_enrollments`, `students`, `users`, `user_roles`, `institution_memberships`, and moves rows only through existing functions: `addStudentToClass`, `inviteTeacher`, `endClassEnrollment`.

## TESTS

| Command | Result |
|---|---|
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run tests/unit/l9-*.test.ts` | 2 files, 30 tests passed |
| Same two files with three guards temporarily removed (bulk skip of DECLINED / ENDED, bulk skip of existing teacher relations, `student_id` ownership in leave) | 7 of 30 failed. Guards restored; 30 passed again |
| `npx tsc --noEmit -p .` | no output |
| `env -u DATABASE_URL ... npx vitest run` (full suite) | 521 files: 516 passed, 5 failed. 9,320 tests: 9,313 passed, 7 failed. All 7 are `Test timed out in 5000ms` in files this lane did not touch (`blueprint-v2-bp3`, `blueprint-v2-bp4a`, `blueprint-v2-slot-contract`, `class-progress-intelligence`, `learner-twin-language`). Other lanes were running on the same machine. |
| Those 5 files re-run alone | 5 files, 93 tests passed |
| `tests/unit/track-a-*.test.ts`, `journey-*.test.ts`, `f2-institution-membership.test.ts`, `ai-request-metrics.test.ts` | 20 files, 467 tests passed (the existing suites around the touched code) |
| `env -u DATABASE_URL ... npx next build` | exit 0; 229/229 static pages; the four new routes are listed |
| Browser check of the three forms and the leave control | NOT_RUN — needs a Clerk sign-in (Human Operator) and a database; the worktree has no `.env` |
| HTTP E2E suites, any DEV / Stage / Production access | NOT_RUN |

Acceptance tests from L3R1 and where they are covered:

| Acceptance | Test |
|---|---|
| IN-1: coordinator submits 30 emails; existing accounts invited or enrolled, unknown reported | `l9-in1-bulk-add` › "30 addresses: existing accounts are invited or enrolled…" (20 invited, 5 enrolled, 5 no account; no student or user row created) |
| IN-1: a coordinator of another institution gets 403 | › "students/bulk: a coordinator of ANOTHER institution gets 403…", › "teachers/bulk: a coordinator of ANOTHER institution gets 403…" |
| IN-1 / L4-18: a declined enrolment is not re-activated in bulk | › "L4-18: a DECLINED enrollment is never re-activated (nor re-invited) by a list…" |
| IN-3: after leaving, `canTeacherAccessLearner` is false on the next request | `l9-in3-student-leave-class` › "ACTIVE -> ENDED through the existing end-enrollment function…" (the real guard, true before and false after) |
| IN-3: a student cannot end another student's enrolment | › "another Student's enrollment: 404, row untouched, no write…" |

Other negative cases: unauthenticated 401 and wrong-role 403 on all four routes; another institution's class under the caller's own institution id is 404; malformed ids 404; empty, oversized (101), non-array and extra-field bodies 400; unknown, pending and already-ended enrolment ids all give the same 404.

Limits of these tests:

- The in-memory database matches each statement by its text. It runs the real services and the real `canAccessInstitution` / `canTeacherAccessLearner`, but it is not a SQL engine. With the `student_id` predicate removed from the leave query, the behavioural "another student" test still passed (the fake no longer recognised the statement and returned nothing); the regression was caught by the source-contract test that pins the predicate. A two-student check against a real database is still worth doing before Stage.
- Nothing was exercised in a browser or against a deployed environment.

## FINDINGS

### 1. IN-1 — implemented

- `POST /api/institutions/[id]/students/bulk { classId, emails[] }` and `POST /api/institutions/[id]/teachers/bulk { emails[] }`. Both use the existing `requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE')`, the same guard and permission as the single-add routes.
- Each address goes through the existing single add (`addStudentToClass`, `inviteTeacher`). The bulk functions issue no enrolment or membership write of their own. Each single add is audited as before, and one summary event per list is added (`STUDENTS_BULK_ADDED`, `TEACHERS_BULK_INVITED`).
- The response is 200 with one outcome per address and a count per outcome. One bad address does not stop the rest. Nothing is created for an unknown address.
- Up to 100 distinct addresses per request. The list is trimmed, lower-cased and de-duplicated on the server.
- UI: a second form under the existing single-add form on Students, on a class page, and on Teachers. It takes a pasted list or a `.csv` / `.txt` file (read in the browser, 200 KB cap) and shows the result per outcome.

### 2. IN-1 is stricter than the single add for closed relations

| Existing state | Single add (unchanged) | Bulk |
|---|---|---|
| Enrolment `DECLINED` in this class | re-invited, or enrolled ACTIVE directly if the student is active elsewhere in the institution (this is L4-18) | reported `PREVIOUSLY_DECLINED`, untouched |
| Enrolment `ENDED` in this class | same as above | reported `PREVIOUSLY_ENDED`, untouched |
| Teacher relation `PENDING` | approved | reported `PENDING_REQUEST`, untouched |
| Teacher relation `REJECTED`, `REVOKED`, `SUSPENDED` | reset to `INVITED` | reported `NEEDS_REVIEW`, untouched |

L3R1 required only the `DECLINED` case. The `ENDED` and teacher rows are this lane's decision, on the same reasoning: a list should not re-open something a person closed. If the Orchestrator wants bulk to match the single add for any of them, it is a one-line change per row.

### 3. IN-3 — implemented

- `POST /api/student/class-enrollments/[id]/leave`. The student id is always the caller's own (`requireStudentId`); nothing in the request can name another student. The service reads the enrolment with `id = $1 AND student_id = $2 AND status = 'ACTIVE'`, then calls the existing `endClassEnrollment`. No new status, no new transition.
- Another student's enrolment, an unknown id, a pending invitation and an already-ended enrolment all return the same `404 NOT_FOUND`.
- The leave is audited in `academic_governance_events` with `actor_scope = 'STUDENT'` (a value the table's CHECK already allows) and action `STUDENT_LEFT_CLASS`.
- This is the "new actor on an existing transition" that L3R1 says L10 must acknowledge in review.

### 4. The leave control is only visible where the institutional card is

`profile/page.tsx:48-58` renders `InstitutionalContextCard` only when `STUDENT_JOURNEY_V2=UX` is on **and** at least one of the student's classes has a subject. Outside that, the route works but the student has no button. The plan fixed the mount point to this card and barred edits to `page.tsx`, so this lane could not change it. See CR-L9-01.

### 5. After IN-3, the single add can undo a student's leave without consent

`enrollActive` (`institution-operations.service.ts`, the `ON CONFLICT … WHERE status IN ('DECLINED','ENDED','PENDING')` clause) sets an `ENDED` row straight to `ACTIVE` when the student is still active in another class of the institution. So a coordinator can put back, one at a time, a student who just left. This is L4-18 extended from `DECLINED` to `ENDED`. Bulk does not do it; the single add was left unchanged because the launch scope is IN-1 and IN-3 only. See CR-L9-02.

### 6. Teachers are included in IN-1

The L3R1 row reads "students and teachers are added one email at a time", so both were built. The launch message says only "bulk add using an email list". If teachers were not intended, the teacher half is separable: `teachers/bulk/route.ts`, `bulkInviteTeachers`, and the mount in `teachers/page.tsx`.

### 7. Nobody is notified when a student leaves

`RoleNotificationType` in `src/lib/notifications/role-notifications.service.ts` has no "student left" type, and that file is outside this lane. The coordinator and teacher see the change in the roster and in the audit trail only. See CR-L9-03.

### 8. Bulk reports which addresses have no account

The single add already answers `NO_STUDENT_ACCOUNT` / `NO_TEACHER_ACCOUNT`; bulk gives the same answer for up to 100 addresses per request. No institution route has a rate limit today. The caller must be an approved coordinator of an active institution, and each list is audited with the actor. Listed so the Orchestrator can decide whether that is enough for the pilot.

### 9. Working-tree note

`node_modules` in the worktree is a copy-on-write clone of the one in `studyos-security-p1-remediation` (git-ignored, left in place so the checks can be re-run).

## BLOCKERS

NONE.

## CHANGE_REQUESTS

| # | Lock | Files | Change needed | Why not done here |
|---|---|---|---|---|
| CR-L9-01 | Hot file, held by L7 in Wave 0 | `src/app/dashboard/profile/page.tsx` (or another Student page the Orchestrator prefers) | Mount `<StudentClassMemberships />` outside the `STUDENT_JOURNEY_V2=UX` branch so every enrolled student can leave a class. It takes no props. | `page.tsx` is assigned to L7 in Wave 0 and L3R1 bars this lane from editing it |
| CR-L9-02 | SHARED_FOUNDATION (product ruling first) | `src/lib/institution/institution-operations.service.ts` (`enrollActive`, `addStudentToClass`) | Decide whether a coordinator may re-activate a `DECLINED` or `ENDED` enrolment directly, or must always go through an invitation. This closes L4-18. | Outside IN-1 / IN-3; changes existing single-add behaviour |
| CR-L9-03 | none assigned (`src/lib/notifications/**` has no lane) | `src/lib/notifications/role-notifications.service.ts` | Add a `CLASS_ENROLLMENT_LEFT` type so `leaveClassAsStudent` can notify the class teacher and the coordinators. Check first whether `notifications.notification_type` has a database constraint. | File outside the lane's ownership |
| CR-L9-04 | SHARED_FOUNDATION (L10 review) | none | Acknowledge the Student as a new actor on `class_enrollments` ACTIVE → ENDED, as L3R1 requires for IN-3. | Review action, not a code change |

## MERGE RECOMMENDATION

Merge `feat/l9-institution-in1-in3` after review. It is two commits on `4fb45b0` and touches no file assigned to L6, L7, L8 or L12. L7 has an uncommitted edit to `profile/page.tsx`; this branch does not touch that file, so the two do not conflict.

Before Stage: one operator pass in a browser (bulk form with a mixed list; a student leaving a class, then the teacher's roster), and a decision on CR-L9-01, because without it the leave control is hidden for most students.

## NEXT SAFE ACTION

Orchestrator reviews `7e2bc29`, and rules on Finding 2 (how strict bulk should be), Finding 6 (teachers in or out) and CR-L9-01.
