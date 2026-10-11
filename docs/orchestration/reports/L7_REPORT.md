# L7_PARENT — Report

Run date: 2026-10-11 (UTC). Scope: work package PA-1 only.

## LANE

| | |
|---|---|
| Lane | `L7_PARENT` |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-l7-parent` |
| Branch | `feat/l7-parent-pa1` (new, local only) |
| Contract | The Orchestrator's launch message and the `L7_PARENT` rows of `L3R1_REPORT.md` (sections 2, 3 and 7). There is no `tasks/L7_PARENT.md` in the control plane. |

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

## BASE SHA

`4fb45b093ce6ba58a4b3f82d211bea2f978e33d1` — HEAD of `fix/security-p1-remediation`, verified with `git rev-parse` (clean tree) before the worktree was created.

## FINAL SHA

The single commit on `feat/l7-parent-pa1` whose parent is `4fb45b0`. Run `git rev-parse feat/l7-parent-pa1` for the value.

## FILES CHANGED

New:

- `src/app/dashboard/profile/ParentAccessCard.tsx` — the client card
- `src/app/dashboard/profile/parent-access.ts` — route constants, types and three pure helpers
- `src/lib/i18n/parent-access-messages.ts` — L7's own strings, 25 keys in es, en, de, fr, pt
- `tests/unit/l7-pa1-student-parent-access.test.ts`
- `docs/orchestration/status/L7_STATUS.md`, `docs/orchestration/reports/L7_REPORT.md`

Modified:

- `src/app/dashboard/profile/page.tsx` — two imports and two mount lines (hot file; L7 is its Wave 0 writer)

Not touched: `src/services/parent.service.ts`, `src/app/role-select/**`, `InstitutionalContextCard.tsx`, `messages.ts`, `roles-messages.ts`, `globals.css`, every route, every guard, every migration.

## LOCKS USED

NONE. No file in `SHARED_FOUNDATION`, `SCHEMA_AND_MIGRATIONS` or any other lock scope was changed.

## TESTS

| Command | Result |
|---|---|
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run tests/unit/l7-pa1-student-parent-access.test.ts` | 1 file, 16 tests passed |
| Same env, `npx vitest run` (full suite) | 520 files, 9,306 tests passed (base: 519 / 9,290) |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` (no database configured) | exit 0 |
| Browser run of the card with a signed-in Student | NOT_RUN — needs a Clerk session and a database; the worktree has no environment file and the lane may not write to DEV |
| DEV, Stage, Production | NOT_RUN, not touched |

`node_modules` is a copy-on-write clone of the L4-R1 worktree's (git-ignored), as L4-R1 did.

What the new test file covers. It runs the real route handlers, the real `parent.service` and the real `isActiveParentOf` guard against an in-memory database; only Clerk, `requireStudentId` and `getOrCreateCanonicalUser` are stubbed.

| PA-1 acceptance step | Test |
|---|---|
| Invite a parent email, see it pending | "records a pending invitation for the session's student, ignoring any studentId in the body" |
| Revoke an accepted parent; parent API returns 403 on the next request | "after the student revokes, the parent read API returns 403 on the next request" (`GET /api/parent/learners/{id}/overview`) |
| Negative: another student's relationship | "a student cannot revoke a relationship that belongs to another student" (404, row unchanged) |
| Negative: another student's invitation | "a student can cancel their own pending invitation, never another student's" (404) |
| Negative: no session / not a Student | 401 and 403 asserted on all three routes |
| Open profile from the Student nav | NOT_VERIFIED in a browser. Statically: the nav entry exists (`src/lib/lx/learner-navigation.ts:134`) and a source guard asserts the page mounts the card |

The in-memory database is not a substitute for a run against real Postgres.

## FINDINGS

### 1. PA-1 is implemented with no backend change

The Student profile page now shows a card, "Family with access to your progress", with:

- **Who can see me** — the accepted relationships from `GET /api/student/parents`, with the date access began.
- **Remove access** — `POST /api/parent/relationships/revoke`, behind an inline two-step confirmation.
- **Invite a family member** — `POST /api/student/parent-invitations`.
- **Invitations sent** — pending and declined ones from `GET /api/student/parent-invitations`; a pending one can be cancelled with the existing `DELETE` on the same route.

The card sends no student id; the routes resolve the student from the session. If the routes answer 401 or 403 (an account that is not a Student), the card renders nothing.

Cancelling a pending invitation was not named in the launch message. It uses a route PA-1 already lists and is the only way for a student to undo a mistyped email, so I included it. Say if it should come out.

### 2. Two mount lines, not one

`L3R1` planned "one mount line". `profile/page.tsx` has three return paths; the card is mounted in the two that render a profile (the institution-defined layout and the default layout). It is deliberately absent from the first-time `EntryChoice` screen, which exists to ask one question only. A brand-new student with no profile and no exam target therefore reaches the card after making that first choice.

### 3. Strings are a standalone catalogue

The existing per-area i18n files are merged into `roles-messages.ts` and `messages.ts`, neither of which L7 may edit. `parent-access-messages.ts` is read directly through `getParentAccessMessages(locale)` and passed to the card as a prop. The `account.family.*` strings used by `/role-select` were left alone, so the two surfaces now have similar copy in two places.

### 4. The invitation still notifies nobody (known, SF-7)

`inviteParentByEmail` only inserts a row (`src/services/parent.service.ts:325`). The card says this in plain words under the email field: no email is sent, and the family member sees the invitation when they sign in with that address. When SF-7 lands, `pa.invite.hint` and `pa.invite.sent` need rewording.

### 5. Two input gaps in the existing invite route (not changed)

`POST /api/student/parent-invitations` accepts the student's own email, and an email whose owner already has accepted access. Neither creates access by itself, since acceptance still goes through the parent-side route. Both belong in `parent.service.ts` (L10). See CR-L7-01.

### 6. `/role-select` still carries the same three actions

Not edited, as instructed. It remains unlinked for a student who already has a role.

## BLOCKERS

NONE for PA-1.

Remaining L7 packages are not launchable and were not started: PA-3 (waits on D-1 and SF-4), PA-4 (SF-8), PA-5 (EN-3 and SF-7).

## CHANGE_REQUESTS

| # | Lock | Files | Change needed | What L7 did instead |
|---|---|---|---|---|
| CR-L7-01 | `SHARED_FOUNDATION` | `src/services/parent.service.ts` (`inviteParentByEmail`), `src/app/api/student/parent-invitations/route.ts` | Refuse an invitation to the student's own email and to an email that already has accepted access, with distinct error codes the card can show. Fits inside SF-7 | Nothing in the locked files. The card shows the generic error for any non-404 failure, so new codes will need two more strings |

## MERGE RECOMMENDATION

Merge `feat/l7-parent-pa1` after review and after the operator check below. It is one commit on `4fb45b0`. Its only edit to an existing file is four added lines in `src/app/dashboard/profile/page.tsx`; L9 (IN-3) works in `InstitutionalContextCard.tsx` and should not conflict.

## NEXT SAFE ACTION

Human Operator, on an environment where a Student and a linked Parent can sign in:

1. As the Student, open Profile from the navigation. The card appears below the academic profile.
2. Invite an email. It appears under "Invitations sent" as Pending. Cancel it, then invite again.
3. As the Parent (that email), accept. As the Student, reload: the parent is listed under "Who can see your progress".
4. Remove access and confirm. As the Parent, reload the parent dashboard: the learner is gone and its API returns 403.
5. Check the card at 375 px width and with the keyboard only.

---

# L7_PARENT — Run 2, 2026-10-11 (UTC): CR-L9-01

Scope: the Orchestrator's change request CR-L9-01 only. PA-1 (run 1, above) is unchanged.

## LANE

`L7_PARENT`, worktree `/Users/jalbornoz/PROYECTOS/studyos-l7-parent`, branch `feat/l7-parent-pa1` (local only).

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

## BASE SHA

`aa95a60` — the PA-1 commit, HEAD of this branch when the change request arrived (clean tree).

## FINAL SHA

The tip of `feat/l7-parent-pa1`: `git rev-parse feat/l7-parent-pa1`. The branch is now three commits past `4fb45b0` on its first-parent line:

| Commit | Content |
|---|---|
| `aa95a60` | PA-1 (unchanged; still mergeable alone) |
| `5307390` | Local merge of `feat/l9-institution-in1-in3` @ `ebe5d2f` into this lane branch |
| tip | CR-L9-01 mount, test, this report |

## FILES CHANGED

By this lane, in the tip commit:

- `src/app/dashboard/profile/page.tsx` — one import, two mount lines (`<StudentClassMemberships />`)
- `tests/unit/l7-cr-l9-01-profile-leave-class.test.ts` (new)
- `tests/unit/l9-in3-student-leave-class.test.ts` — one assertion (see Finding 3)
- `docs/orchestration/reports/L7_REPORT.md`, `docs/orchestration/status/L7_STATUS.md`

Brought in by the merge, unmodified: the 19 files of L9's `7e2bc29` and `ebe5d2f`.

Not touched: `StudentClassMemberships.tsx`, `InstitutionalContextCard.tsx`, the two `class-enrollments` routes, `student-class-membership.ts`, any lifecycle function, any migration.

## LOCKS USED

NONE. `INTEGRATION_MERGE` covers `integration/*`, `release/*`, `preview/*`, `develop` and `main`; the merge here is into the lane's own feature branch (Finding 1).

## TESTS

| Command | Result |
|---|---|
| `npx vitest run tests/unit/l7-cr-l9-01-profile-leave-class.test.ts tests/unit/l9-in3-student-leave-class.test.ts tests/unit/l7-pa1-student-parent-access.test.ts` (no database env) | 3 files, 34 tests passed |
| `npx vitest run` (full suite, no database env) | 523 files, 9,342 tests passed |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` (no database env) | exit 0 |
| Browser check | NOT_RUN — same reason as run 1 |
| DEV, Stage, Production | NOT_RUN, not touched |

The new test is a source contract, as requested ("source/unit regression"). It does not render the page: the page is a server component behind Clerk and the database, and the control loads its data in the browser.

## FINDINGS

### 1. The lane branch now contains L9

`StudentClassMemberships.tsx` exists only on `feat/l9-institution-in1-in3`, which is not merged into any other branch (`git branch -a --contains 7e2bc29`). Reusing it without copying it meant this branch had to contain it, so I merged L9's accepted tip `ebe5d2f` into `feat/l7-parent-pa1` (clean, no conflicts). Consequences for the Orchestrator:

- Merging the tip of this branch brings L9 with it. Merging L9 first and then this branch gives the same result.
- PA-1 alone is still `aa95a60`.
- If you would rather have CR-L9-01 as a separate branch stacked on L9, the tip commit cherry-picks cleanly onto any line that has both `aa95a60` and `ebe5d2f`.

### 2. Where the control is mounted

`profile/page.tsx` has three layouts:

| Layout | When | Leave control |
|---|---|---|
| Institution-defined | `STUDENT_JOURNEY_V2=UX` and a class with a subject | Already there, inside `InstitutionalContextCard` (L9). Not mounted again |
| First-time entry choice | `STUDENT_JOURNEY_V2=UX`, no profile, no exam target | **New mount**, below the choice |
| Canonical | everything else, including flag off | **New mount**, above the family-access card |

The entry-choice mount goes one step past "canonical profile surface". Without it, an enrolled student with the flag on, a class that has no subject and no profile yet would still have no button. Say if it should come out; it is one line.

The control renders nothing until it has loaded at least one ACTIVE enrolment of the caller's own (`StudentClassMemberships.tsx`: `if (enrollments.length === 0 && !msg) return null`; the list query filters `ce.status = 'ACTIVE'` on the session's student). Every ACTIVE enrolment is leavable under L9's rule, so "active" and "allowed to leave" are the same set today.

### 3. One L9 assertion had to change

`tests/unit/l9-in3-student-leave-class.test.ts` asserted that `profile/page.tsx` does not mention `StudentClassMemberships`. CR-L9-01 makes that false by design. I narrowed the assertion to "the page never calls the `class-enrollments` routes itself" and renamed the test. This is the only edit to a file L9 authored.

### 4. Visual placement is NOT_VERIFIED

On the canonical layout the control sits directly in the page column, not inside a card (it was styled for the inside of `InstitutionalContextCard`). Wrapping it in a card from the page would leave an empty card for students with no class, because only the component knows whether it has anything to show. If it looks bare in the browser, the fix belongs in the component (L9).

## BLOCKERS

NONE.

## CHANGE_REQUESTS

| # | Status | Detail |
|---|---|---|
| CR-L9-01 | **Implemented in this run** | Raised by L9 (`L9_REPORT.md`), assigned to L7 by the Orchestrator. `<StudentClassMemberships />` mounted in `profile/page.tsx` outside the `STUDENT_JOURNEY_V2=UX` branch. No component or route duplicated; no lifecycle change |
| CR-L7-01 | Open (run 1) | Unchanged |

## MERGE RECOMMENDATION

Merge L9 (`feat/l9-institution-in1-in3`), then the tip of `feat/l7-parent-pa1`. Do not merge the tip of this branch before deciding to accept L9's code, since it carries it.

## NEXT SAFE ACTION

Human Operator, in addition to the run 1 steps: as a Student enrolled in a class, with `STUDENT_JOURNEY_V2` unset, open Profile; "leave class" is listed; leave and confirm; the teacher's roster no longer shows the student. Then as a Student with no class: nothing extra is shown.
