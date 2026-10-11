# L6_STUDENT — Wave 0 report (ST-3, ST-4)

Run date: 2026-10-11 (UTC).

## LANE

| | |
|---|---|
| Lane | `L6_STUDENT` |
| Scope | ST-3 and ST-4 from `L3R1_REPORT.md`, as assigned by the operator. There is no L6 contract under `tasks/` |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-l6-student-wave0` (new) |
| Branch | `feat/l6-student-wave0` (new, local only, not pushed) |

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

**Read this first: there are two L6 runs.** Another session ran the same two work packages in `/Users/jalbornoz/PROYECTOS/studyos-l6-student` on branch `fix/l6-student-st3-st4` (`04a9676`, `78ee5aa`), based on `3031e03`. This run is based on `4fb45b0`, the base named in the launch instruction. The two branches change the same files and must not both be merged. The differences are in FINDINGS section 3.

## BASE SHA

`4fb45b0` (`4fb45b093ce6ba58a4b3f82d211bea2f978e33d1`) — HEAD of `fix/security-p1-remediation`, verified with `git rev-parse`; that worktree was clean.

## FINAL SHA

The single commit on `feat/l6-student-wave0` whose parent is `4fb45b0`. Run `git rev-parse feat/l6-student-wave0`.

## FILES CHANGED

ST-3

- `src/app/api/learning/record-evidence/route.ts` — retired
- `src/app/api/learning-debt/check-and-resolve/route.ts` — retired
- `tests/unit/l6-st3-retired-self-asserted-routes.test.ts` — new
- `tests/unit/e2e-object-authorization.test.ts` — three assertions updated to the retired behaviour

ST-4

- `src/lib/lx/learner-navigation.ts` — `studyPlan` entry removed (hot file; L6 is its Wave 0 writer)
- `src/app/dashboard/plan/SchedulePanel.tsx` — the former `study-plan/page.tsx`, moved with `git mv`; component renamed, `h1` became `h2`, otherwise unchanged
- `src/app/dashboard/plan/page.tsx` — new `schedule` tab
- `src/app/dashboard/study-plan/page.tsx` — now a server redirect to `/dashboard/plan?tab=schedule`
- `src/app/dashboard/today/page.tsx` — one `href` retargeted to the tab
- `tests/unit/l6-st4-single-plan-surface.test.ts` — new
- `tests/unit/lx2-learner-navigation.test.ts`, `tests/unit/phase-3e-legacy-authority.test.ts` — updated to the new nav shape and file path

Documentation: `docs/orchestration/status/L6_STATUS.md`, `docs/orchestration/reports/L6_REPORT.md`.

Not touched: any migration or schema, `src/lib/auth.ts` or any other guard, `src/lib/entitlements/**`, `src/lib/i18n/messages.ts`, `dashboard/layout.tsx`, `workspace-navigation.ts`, `dashboard/notifications/page.tsx`, `dashboard/quiz/**`, `dashboard/exam-prep/**`, `dashboard/subjects/[id]/**`, `dashboard/assignments/practice/**`, `scripts/**`, `package.json`.

## LOCKS USED

NONE. No file in the scope of any lock in `LOCKS.md` was edited.

## TESTS

| Command | Result |
|---|---|
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run tests/unit/l6-*.test.ts` | 2 files, 18 tests passed |
| Same, plus the three updated existing files | 5 files, 57 tests passed |
| `env -u DATABASE_URL ... npx vitest run` (full suite) | 521 files: 519 passed, 2 failed. 9,308 tests: 9,306 passed, 2 failed. Both failures are `Test timed out in 5000ms` in `blueprint-v2-slot-contract.test.ts` and `blueprint-v2-bp4a.test.ts`, which this lane did not touch |
| `npx vitest run` on those two files alone | 2 files, 31 tests passed. The timeouts did not reproduce; other sessions were running suites on the same machine at the time. Cause otherwise NOT_VERIFIED |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` (no database configured) | exit 0; 228/228 static pages; `/dashboard/study-plan` still listed as a route |
| Browser check of the nav, the new tab and the redirect | NOT_RUN — needs a signed-in Student session (Human Operator) |
| HTTP E2E suites `scripts/operations/track-a-*-e2e-http.ts` | NOT_RUN — they write to a database |
| Any DEV, Stage or Production access | NOT_RUN |

`node_modules` is a copy-on-write clone of the `studyos-security-p1-remediation` worktree's (git-ignored).

Negative authorization cases, as the Wave 0 conditions require:

| Route | Case | Test |
|---|---|---|
| `record-evidence` | no session 401; another Student 403; teacher / parent / admin session role 403; owner 404 with no writer call and no SQL write | `l6-st3-retired-self-asserted-routes` |
| `check-and-resolve` | the same four | same file |
| both | no client code calls them; neither imports a service or the database | same file, "source guards" |

No route was added by this lane.

## FINDINGS

### 1. ST-3 — the two routes are retired, not deleted

Both let the owner change their own learner state by asserting the inputs: `record-evidence` took `result`, `difficulty`, a free-string `sourceType` and `confidenceWeight` from the body and called `updateMastery`; `check-and-resolve` took `currentMastery`, `daysSinceLastSuccess` and `forgettingRisk` from the body and called `checkAndResolveDebt`. Neither has a caller under `src/` (a test now enforces that for `src/app` and `src/components`).

"Restrict to server-derived inputs" was not available for `record-evidence`: the result itself is the client's claim and there is nothing on the server to derive it from. So both are closed:

- unauthenticated: 401, as before;
- authenticated but not the Student: 403, as before, through the unchanged `verifyStudentAccess`;
- the owning Student: `404 { error: 'ENDPOINT_RETIRED' }`.

Neither file imports `@/services/*` or `@/lib/db` any more. `checkAndResolveDebt` now has no caller in `src/`; it lives in `src/services/learning-debt.service.ts`, which I left alone. Server-side debt resolution in `src/services/debt-resolution.service.ts` is untouched.

Why the files stay: `scripts/operations/track-a-e2e-http.ts:353-358` and `track-a-teacher-e2e-http.ts:367` assert that a teacher, a parent and another student get exactly 403 from `record-evidence`. Keeping the guard in front of the 404 leaves those four probes valid without editing scripts that the Teacher lane may also touch. If the Orchestrator prefers deletion, it is two `git rm` plus those four expectations.

Behaviour changes to expect:

- `record-evidence` used to answer 400 for an invalid `conceptId`, `result` and so on. It now validates only `studentId`.
- Neither route is wrapped in `withAiRequestMetrics` any more. They make no AI call.
- Stale comments remain in files outside this lane: `src/lib/auth.ts:86-89` and `src/services/mastery.service.ts:592` still describe `record-evidence` as an evidence writer, and the `RECORD_EVIDENCE` operation type still exists in the mastery identity types.

Not done, and outside ST-3: the other L4-19 items (`transfer/submit`, `transfer/generate`, `errors/record` not binding `conceptId`).

### 2. ST-4 — one plan entry; the schedule moved rather than disappeared

`/dashboard/plan` ("Mi plan") is the surviving entry. The plan said "the other redirects" and named `study-plan/page.tsx`. A bare redirect would have removed the only UI for six Student actions that page owns: prepare or refresh the 14-day plan, start an item, reschedule, skip, add extra practice, set daily minutes. So:

- the page body moved unchanged to `src/app/dashboard/plan/SchedulePanel.tsx`;
- `/dashboard/plan` gained a second tab, `schedule`, after `plan`. Its label reuses the existing key `nav.studyPlan` ("Plan de estudio"), so no string was added and no i18n file was created;
- `/dashboard/study-plan` redirects to `/dashboard/plan?tab=schedule`;
- the "view full" link on Today points at the tab directly;
- the nav item `myPlan` lists `/dashboard/study-plan` under `activePrefixes`.

Things the Orchestrator should know:

- **The default tab is still `plan`.** A Student who used the "Plan de estudio" nav entry now needs one more click (Mi plan, then the tab). Making `schedule` the default is a one-word change, but the Track A HTTP suite asserts on the default tab's content (`track-a-learning-plan-e2e-http.ts:275`), so I left it.
- **The two surfaces still sit on different services** (`personal-plan.service` and the Phase 8 `learning_plan`). ST-4 asked for one navigation surface, not one data model, and this lane did not merge them.
- **Not seen in a browser.** The tab strip now has five entries; how it wraps at 375 px is NOT_VERIFIED.
- The schedule panel is a client component rendered inside a server page. `next build` accepts it; runtime behaviour is NOT_VERIFIED beyond that.

### 3. Duplicate L6 run

| | This run | The other run |
|---|---|---|
| Worktree | `studyos-l6-student-wave0` | `studyos-l6-student` |
| Branch | `feat/l6-student-wave0` | `fix/l6-student-st3-st4` |
| Base | `4fb45b0` (contains L4-R1) | `3031e03` (does not) |
| ST-3 | routes kept as closed stubs; 401/403 preserved, owner 404 | routes deleted |
| Scripts | none edited | `track-a-e2e-http.ts`, `track-a-teacher-e2e-http.ts` edited (403 to 404) |
| ST-4 | schedule as a tab of `/dashboard/plan`, redirect, Today link | the same design (`ScheduleTab.tsx`) |

I read the other branch with `git log` and `git diff --stat` only; I did not modify, test or review it. Its worktree was created at 17:32Z, about 45 seconds before I tried to create mine at the same path. The stray name collision is why this worktree is called `-wave0`.

## BLOCKERS

NONE.

## CHANGE_REQUESTS

NONE. Two notes that are not lock requests:

- `src/lib/auth.ts:86-89` (SHARED_FOUNDATION scope) has a comment that names `record-evidence` as a writing route. It is harmless; L10 can correct it when it next edits the file.
- `checkAndResolveDebt` in `src/services/learning-debt.service.ts` is now dead code. Removing it belongs to whoever next owns that service.

## MERGE RECOMMENDATION

Merge one L6 branch, not both. This one is already on `4fb45b0`, so it applies on top of L4-R1 with no rebase. The file set does not overlap the other four Wave 0 lanes as listed in `L3R1_REPORT.md` section 7; I did not inspect their branches.

Before merging, a Human Operator should open `/dashboard/plan` as a Student and check the five-tab strip on a phone width, the schedule tab's actions, and that `/dashboard/study-plan` lands on the tab.

## NEXT SAFE ACTION

Orchestrator picks which L6 branch is canonical and marks the other `SUPERSEDED`.
