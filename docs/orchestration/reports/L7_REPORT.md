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
