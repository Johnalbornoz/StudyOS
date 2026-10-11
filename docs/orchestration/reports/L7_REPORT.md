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

---

# L7_PARENT — Run 3, 2026-10-11 (UTC): L7-R1 final Parent completion (PA-3, PA-4, PA-5)

## LANE

`L7_PARENT`, worktree `/Users/jalbornoz/PROYECTOS/studyos-l7-parent`, branch `feat/l7-parent-pa1` (local only).

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

```
PA_1 = PASS
PA_3 = PASS
PA_4 = PASS            (under D-4 as built by L10: derived from the relationship; no SF-8 carrier exists)
PA_5 = PASS            (route and UI; a real provider checkout is NOT_VERIFIED)
CR_L7_01 = CLOSED_EXTERNAL_L10
CR_L9_01 = CLOSED

PARENT_RELATIONSHIP_SCOPE = PASS
PARENT_RELEASED_RESULTS = PASS
PARENT_RAW_ITEM_PROTECTION = PASS

TESTS = focused Parent set 7 files / 93 tests pass. Full suite 540 files: 9,728 pass, 10 FAIL in 4 files.
        None of the 10 is in L7 code or L7 tests; all 10 fail identically on the merged base before any
        L7-R1 change (Finding 2).
TYPECHECK = PASS (tsc --noEmit, no output)
BUILD = PASS (next build, exit 0)

L7_READY_FOR_FINAL_CONVERGENCE = YES for L7's own work, with the two conditions in MERGE RECOMMENDATION
```

All verdicts rest on unit tests, typecheck and build. Nothing ran against a database, Clerk or a browser.

## BASE SHA

`112c2da` — the canonical tip named in the launch message, verified clean.

## FINAL SHA

Tip of `feat/l7-parent-pa1` (`git rev-parse feat/l7-parent-pa1`). First-parent line after `112c2da`:

| Commit | Content |
|---|---|
| `881ef23` | Local merge of `feat/l10-shared-foundation` @ `79b7f50` (one conflict, Finding 1) |
| `31c6434` | Local merge of `feat/l11-entitlements` @ `fd9dfa6` (clean) |
| tip | PA-3, PA-4, PA-5, CR-L10-05, tests, this report |

No earlier commit was removed or rewritten.

## ACCEPTANCE CRITERIA RECOVERED FROM L3-R1

Quoted from `L3R1_REPORT.md` section 3, table `L7_PARENT`. There is no `tasks/L7_PARENT.md`.

| WP | Expected behavior | Acceptance test | Shared dependencies |
|---|---|---|---|
| PA-3 (P1-5) | "Parent sees the result scope D-1 rules" | "Linked parent sees the ruled result fields for a completed attempt; an unlinked parent gets 403; no question or response text is returned unless D-1 allows it" | D-1 and SF-4 |
| PA-4 (P2-14, Parent UI) | "Parent onboarding screens on the SF-8 carrier" | "New Parent completes onboarding once and lands on the dashboard" | SF-8 |
| PA-5 (P2-16) | "A Parent can start a checkout for a linked child" | "Linked parent starts a checkout for the child; an unlinked parent gets 403; the binding ends when the student unlinks" | EN-3 and SF-7 |

Impacted files named by the plan: PA-3 `src/lib/parent/read-model.service.ts`, `api/parent/learners/[studentId]/exam-prep`, `dashboard/parent/page.tsx`; PA-4 `src/app/dashboard/parent/**`; PA-5 `src/app/dashboard/parent/**`, reuse of `dashboard/billing/SubscribeButton.tsx`.

## FILES CHANGED

By this lane, in the tip commit:

- `src/lib/parent/read-model.service.ts` — `getParentReleasedResults`, `ParentReleasedResult` (PA-3)
- `src/app/api/parent/learners/[studentId]/results/route.ts` (new, PA-3)
- `src/app/dashboard/parent/ParentResultsCard.tsx` (new, PA-3)
- `src/app/dashboard/parent/ParentOnboarding.tsx` (new, PA-4)
- `src/app/dashboard/parent/page.tsx` — loads results; onboarding replaces the empty state; pay-for-child card (PA-3, PA-4, PA-5)
- `src/app/dashboard/billing/SubscribeButton.tsx` — optional `studentId` and `unavailableMessage` props (PA-5)
- `src/lib/i18n/parent-home-messages.ts` (new, 28 keys, five locales)
- `src/app/dashboard/profile/ParentAccessCard.tsx`, `src/lib/i18n/parent-access-messages.ts` — CR-L10-05
- `tests/unit/l7-r1-parent-completion.test.ts` (new, 27 tests)
- `docs/orchestration/reports/L7_REPORT.md`, `docs/orchestration/status/L7_STATUS.md`

Brought in by the two merges: every file of L10 (`c2bcae9`, `e094c5a`, `79b7f50`) and L11 (`fe6ecf7`, `fd9dfa6`), unmodified except the one conflict hunk in Finding 1.

Not changed by this lane: any migration or schema, `src/lib/authorization/**`, `src/services/parent.service.ts`, `src/services/payment.service.ts`, `src/lib/entitlements/**`, `api/payments/checkout`, any guard, `messages.ts`, the leave-class mount and its component.

## LOCKS USED

NONE held. L10 and L11 code was read and called, not edited. See Finding 1 for the one hunk resolved inside a file neither L7 nor this run owns.

## TESTS

| Command (all with no database env) | Result |
|---|---|
| `npx vitest run tests/unit/l7-r1-parent-completion.test.ts` | 27 passed |
| Focused Parent set: the above plus `l7-pa1-student-parent-access`, `l7-cr-l9-01-profile-leave-class`, `f10-parent-multi-role-isolation`, `f10-parent-identity-fix`, `l10-cr-l7-01-parent-invitation`, `l10-r1-learner-data-rulings` | 7 files, 93 passed |
| `npx vitest run` on the merged base (`31c6434`), before any L7-R1 change | 539 files; 9,701 passed, **10 failed** |
| `npx vitest run` at the tip | 540 files; 9,728 passed, **the same 10 failed** |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` | exit 0; `/api/parent/learners/[studentId]/results` is in the route table |
| Browser, database, Clerk, payment provider | NOT_RUN (not required for this run) |

Required PA-3 regressions, all in `l7-r1-parent-completion.test.ts`:

| Required | Test |
|---|---|
| accepted Parent + Student-visible result => visible | "accepted Parent + Student-visible result => visible, as a summary" |
| accepted Parent + removed/hidden result => not visible | "…result the Student removed from history => not visible (hidden attempt, and deleted exam instance)" |
| pending/revoked Parent relationship => refused | "pending / declined / revoked Parent relationship => refused (403), nothing read" |
| unrelated Parent => refused | "unrelated Parent => refused; a linked Parent => refused for another Student; no session => 401" |
| invalidated but Student-visible result => summary visible with status | "invalidated but Student-visible result => summary visible, with its status…" |
| no raw item responses exposed | "no raw item responses, rubric internals, provenance, hashes or invalidation reason are exposed" |

Also covered: draft, paused, abandoned and not-yet-scored attempts are never listed; a Parent whose PARENT role is no longer ACTIVE is refused; only the linked child's attempts are considered.

How the tests are built: real routes, real Parent read model and real Shared Foundation functions against an in-memory database that answers by statement text. The exam core's result-view assembly is stubbed and returns a full owner view **with** item review, rubric quote, provenance and hashes, so the leak test asserts on real output. This is not a substitute for a run against Postgres.

## FINDINGS

### 1. L10 and L11 had to be merged into the lane branch; one conflict resolved

PA-3 must call L10's contracts and PA-5 depends on L11's EN-3. Neither branch was in this branch's ancestry, and neither is merged anywhere else. I merged both locally.

- **L11:** clean.
- **L10:** one conflict, in `src/lib/institution/institution-operations.service.ts` (`addStudentToClass`). L9 had refactored three lines to call its `enrollmentOf` helper; L10 replaced the same lines with the CR-L9-02 lifecycle (`getClassEnrollmentState`). I took **L10's hunk unchanged**. L7 owns nothing in that file.

L9's worktree has an uncommitted patch to that same file (the "final enrollmentOf patch"). So at convergence this file will conflict again between final L9 and this branch. Resolve it by taking the converged L9/L10 version; nothing of L7's is in it.

### 2. Ten tests fail on the merged base, none of them L7's

They fail before any L7-R1 change and are unchanged by it.

| Tests | File | What it is |
|---|---|---|
| 1 | `l10-cr-l9-02-enrollment-lifecycle` › "application code never reads 'the' enrolment…" | L10's repository-wide guard flags L9's `enrollmentOf`. This is what L9's pending final patch addresses |
| 1 | `l11-open-attempt-continuation` › "simulation/attempts/[id]/result…" | Source assertion expects `canAccessLearner(actor.id, …)` in a route L10 rewrote to `resolveLearnerReadScope` |
| 2 | `l11-payment-webhook` › payer binding | L11's in-memory database predates the role clause L10 added to `isOwner` / `isActiveParentOf` |
| 6 | `l11-unlicensed-policy` | 403 `FORBIDDEN` where L11 expects `ENTITLEMENT_REQUIRED` / 200 on routes L10 also changed |

The first two are read directly from the assertion. For the other eight the cause is my reading of the failure output, NOT_VERIFIED: they could be stale fixtures or a real ordering change between L10's guard and L11's gate on `teacher-interventions/[id]/start` and `transfer/submit`. That needs L10 or L11 to look. PA-5's own criterion ("binding ends when the student unlinks") is covered by my test against the real `isLiveBillingActor` and passes.

### 3. PA-3 — how release is decided

`getParentReleasedResults(actor, studentId)`:

1. `requireAccess` → L10's `isActiveParentOf` (accepted relationship, ACTIVE account, ACTIVE PARENT role).
2. Lists the child's most recent 12 attempts with no filter at all. No publication rule is written in the read model; a source test fails if `hidden_at`, `DELETED`, `COMPLETED`, `SCORED` or `INVALIDATED` appears in that function.
3. For each, L10's `resolveResultViewContext` (which calls `isAttemptResultVisibleToStudent`) and then `shapeAttemptResultViewForScope`. A null from either means not released.
4. Projects an explicit allow-list: exam name and version, type, status (`SCORED` / `INVALIDATED`), scoring status, date, raw and final score, completion counts, minutes, and counts of objectives by classification.

Points to confirm:

- **Scope is Parent-only.** The scope passed is the `PARENT` row of `LEARNER_READ_SCOPE`, not `resolveLearnerReadScope`'s union, so a Parent who is also the child's Teacher gets the Parent summary here. This keeps the existing F10 multi-role isolation rule.
- **Not returned:** per-objective descriptions, section scores, `invalidationReason`, strict readiness. Gaps are within a Parent's scope under D-1, so objective names could be added; I kept to counts. Say if you want more.
- **New route, not `exam-prep`.** The plan names `exam-prep`, but that route returns `data: null` when the child has no active exam profile, which would hide results from past profiles. Results are at `GET /api/parent/learners/[studentId]/results`.
- **Limit of 12 candidates** is my choice, not a ruling.
- **Cost:** up to 12 full result-view assemblies per page load. Fine for a pilot; a lighter summary read in the exam core would be better (fits CR-L10-08).

### 4. PA-4 — onboarding without a carrier

L3-R1 says "on the SF-8 carrier". L10 removed that carrier under D-4 ("no free-form JSON; onboarding from typed identity and relationships… Parent: account + relationship flow"; no completion marker). So PA-4 is built on that model, with no schema:

- A Parent who follows nobody sees a three-step panel (account ready → connect with your child → follow progress) in place of the old empty box. Step 2 reflects a waiting invitation or a request just sent.
- Accepting an invitation reloads the list and the page shows the dashboard.

"Once" is therefore derived: the panel is gone while at least one relationship is accepted, and comes back if every relationship ends. If a stored "seen once" marker is wanted, that is a schema decision for L10 (CR-L7-02 below, optional).

### 5. PA-5 — parent pays for a linked child

- The Parent page has a "Subscription for {child}" card using the existing `SubscribeButton`, which now takes an optional `studentId`. The Student's own billing page is unchanged.
- `POST /api/payments/checkout` was not edited. It already refuses anything but an accepted relationship (403) and, with L11, binds the payer only on a confirmed payment and only while the relationship is live.
- The card is always shown for a linked child. A Parent who is not yet the payer cannot read the child's subscription (`GET /api/billing/subscription` is payer-or-owner only), so the page cannot know in advance whether the child already has access. If the checkout is refused as not purchasable (409) the button says so. Showing the child's licence state to a linked Parent would be an entitlement-semantics change (CR-L7-03 below, optional).
- With `MERCADOPAGO_ACCESS_TOKEN` unset the button shows the existing "payments not configured" message. A real checkout is NOT_VERIFIED.

### 6. CR-L10-05 done

`ParentAccessCard` now shows a specific message for `409 OWN_EMAIL` and `409 ALREADY_LINKED` (two strings, five locales). CR-L7-01 itself was not reimplemented; L10's service and route are untouched.

### 7. CR-L9-01 unchanged

The leave-class mount in `profile/page.tsx` and its test are as accepted in run 2.

## BLOCKERS

NONE for L7.

## CHANGE_REQUESTS

| # | To | Status | Detail |
|---|---|---|---|
| CR-L7-01 | L10 | CLOSED_EXTERNAL_L10 | Not reimplemented here |
| CR-L9-01 | L7 | CLOSED | Run 2 |
| CR-L10-05 | L7 | DONE in this run | Finding 6 |
| CR-L7-02 | L10 / product (optional) | OPEN | Only if "onboarding shown exactly once ever" is required: a stored marker needs schema. Not needed under D-4 as ruled |
| CR-L7-03 | L11 (optional) | OPEN | `src/lib/entitlements/**`, `api/billing/subscription`: let a linked, not-yet-paying Parent read whether the child is licensed, so the pay card can be hidden when it is not needed |
| CR-L7-04 | Orchestrator → L10 / L11 / L9 | OPEN | The ten failing tests in Finding 2 |

## MERGE RECOMMENDATION

Converge in the order already stated: final L9, then L10 and L11, then this branch. Two conditions:

1. `src/lib/institution/institution-operations.service.ts`: take the converged L9/L10 version over this branch's copy.
2. Route CR-L7-04 before treating the converged suite as green.

## NEXT SAFE ACTION

Orchestrator reviews the tip commit and rules on the three points in Finding 3 and on Finding 4's reading of "once".
