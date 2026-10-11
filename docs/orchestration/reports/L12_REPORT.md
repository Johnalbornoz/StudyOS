# L12_UX_ACCESSIBILITY — Report (UX-1)

Run date: 2026-10-11 (UTC).

## LANE

| | |
|---|---|
| Lane | `L12_UX_ACCESSIBILITY` |
| Scope | UX-1 only: the browser and accessibility test harness for the four profiles |
| Mode | Tests, test configuration and devDependencies. No application code |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-l12-ux-accessibility` |
| Branch | `feat/l12-ux-accessibility` (new, local only) |

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`, with one request open (CR-L12-02).

The harness is built and runs. The public pages were certified at three viewports. **The four role suites are written but have not run against any authenticated page**: no target was named for this lane, and the only fixture identities live in hosted DEV, which this lane may not write to.

## BASE SHA

`4fb45b0` (`fix/security-p1-remediation`), verified with `git rev-parse` in the new worktree, clean tree.

## FINAL SHA

The single commit on `feat/l12-ux-accessibility` whose parent is `4fb45b0`. Run `git rev-parse feat/l12-ux-accessibility`.

## FILES CHANGED

Hot files assigned to L12 by L3R1 section 7:

- `package.json`: three exact-pinned devDependencies, two scripts (`test:browser`, `test:browser:certify`)
- `package-lock.json`: seven packages added, none changed or removed

New:

- `playwright.config.ts`
- `tests/e2e/support/target.ts`, `audit.ts`, `session.ts`, `known-findings.ts`
- `tests/e2e/auth.setup.ts`, `public.spec.ts`, `roles.spec.ts`, `harness.selftest.spec.ts`
- `tests/e2e/README.md`, `tests/e2e/.gitignore`
- `tests/unit/l12-e2e-harness.test.ts`
- `docs/orchestration/status/L12_STATUS.md`, `docs/orchestration/reports/L12_REPORT.md`

Nothing under `src/`, `database/`, `migrations/` or `scripts/` was touched. The root `.gitignore` was not edited; run output and sessions are ignored by `tests/e2e/.gitignore`.

## LOCKS USED

NONE. `SCHEMA_AND_MIGRATIONS`, `STAGE_RUNTIME`, `PRODUCTION`, `INTEGRATION_MERGE`, `SHARED_FOUNDATION`: not used.

## WHAT THE HARNESS DOES

Playwright (Chromium) with axe-core. One project per viewport: mobile 375×812, tablet 768×1024, desktop 1280×800. With no target named it builds the checkout and serves it on `127.0.0.1:3100`.

Every audited page gets four checks at every viewport:

| Check | Rule |
|---|---|
| Accessibility scan | axe, WCAG 2.x A/AA; zero `critical` violations. All violations are attached to the run output. Threshold is configurable (`E2E_AXE_FAIL_ON`) |
| Horizontal overflow | `scrollWidth` does not exceed the viewport; offending elements are listed |
| Document language | `<html lang>` is the language the page is written in |
| Navigation names | Every visible link and button in a navigation region has an accessible name; `link-name` and `button-name` page-wide at any impact |

Suites:

- **Public** (6 pages): `/es`, `/es/how-it-works`, `/en`, `/en/how-it-works`, `/sign-in`, `/sign-up`, plus the unauthenticated redirect to sign-in.
- **Roles** (Student, Parent, Teacher, Institution): lands in its own workspace; the four checks on the workspace home and on any path in `E2E_<ROLE>_PATHS`; navigation matches the viewport, and every control in the collapsed top bar, tab bar and drawer is named.
- **Self-test**: plants each defect in a synthetic page and requires the check to reject it.

Stage findings as explicit assertions:

| Id | Finding | Where asserted | Result at `4fb45b0` |
|---|---|---|---|
| KF-L12-01 | Spanish page renders with `lang="en"` | Public: `/es*` must declare `es`. Roles: `<html lang>` must equal the language the workspace shell resolved | **Confirmed** on `/es` and `/es/how-it-works`, all three viewports |
| KF-L12-02 | Collapsed navigation icon links need accessible names | Every page, every viewport; plus the role test that opens the compact drawer | Not reproduced on public pages. `NOT_RUN` in the role workspaces |
| — | Desktop and mobile coverage | Three viewport projects | Run |

A confirmed finding is marked `expectedToFail`. In the default mode its tests are expected failures, so the suite can gate regressions; they turn red when the defect is fixed. `npm run test:browser:certify` excuses nothing.

Guards, unit-tested: Production hosts are refused; programmatic sign-in refuses non-test Clerk keys; with no auth mode the role suites report `NOT_RUN`, and once a mode is named a missing session is an error, not a skip.

## TESTS

| Command | Result |
|---|---|
| `E2E_ENV_FILE=<clerk test keys, no database> npm run test:browser` | exit 0. 99 passed, 77 skipped, 0 unexpected. The 99 include 6 expected failures (KF-L12-01) and 15 planted self-test defects correctly rejected |
| `… npm run test:browser:certify` | exit 1. **6 failed** (KF-L12-01: `/es` and `/es/how-it-works` × 3 viewports), 93 passed, 77 skipped |
| `npx vitest run tests/unit/l12-e2e-harness.test.ts` | 10 passed |
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run` | 520 files, 9,300 tests passed (L4R1 baseline 519 / 9,290, plus this lane's file) |
| `npx tsc --noEmit -p .` | no output |
| `next build`, run by the harness web server, no database | succeeded |
| Role suites (72 tests) and sign-in setup (5) | **NOT_RUN** — no authenticated target named |
| Any DEV, Stage or Production access | NOT_RUN |

How the local run was configured: an env file outside the repository holding only the two Clerk DEV test keys copied from `studyos-dev/.env.local`, and a `DATABASE_URL` pointing at a closed local port. The app never had a database. The sign-in and sign-up pages loaded Clerk's widget from the Clerk DEV instance as an anonymous visitor; no session was created.

## FINDINGS

### 1. KF-L12-01 is real in this code

`src/app/layout.tsx:47` renders `<html lang="en">` for every route. The marketing layout and `LearnerShell` set the real locale only on an inner `<div lang>`. A screen reader therefore starts every Spanish page with English pronunciation rules, and axe's `html-lang` family cannot see it because a valid `lang` is present. The role assertion is expected to fail the same way for any user whose interface language is not English; that is inferred from the source, not observed.

### 2. KF-L12-02 could not be reproduced where the harness could run

On the four marketing pages, 9 navigation controls per page were checked at each viewport and all are named. In `LearnerShell` at `4fb45b0`, the menu button, close button, notifications link and logo link carry `aria-label`, and tab-bar links contain a text label. So this code may already be correct, or the Stage defect is in a workspace page the harness has not reached, or Stage runs a different line (B5). Only a role run settles it.

### 3. No critical violation, no overflow on public pages

Zero critical axe violations and no horizontal overflow on the 6 public pages at 375, 768 and 1280 px.

### 4. Serious colour-contrast violations (not failing under the UX-1 threshold)

| Page | Nodes | First target |
|---|---|---|
| `/es`, `/en` | 23 each | `.lp-concepts > .done` |
| `/es/how-it-works`, `/en/how-it-works` | 5 each | `span` |
| `/sign-in` | 1 | Clerk widget (`.cl-internal-*`) |
| `/sign-up` | 2 | Clerk widget |

Identical at all three viewports. UX-1's acceptance is "zero critical", so these are recorded, not failed. `E2E_AXE_FAIL_ON=critical,serious` turns them into failures when product wants that bar.

### 5. Limits of this run

- **Role suites are unverified at runtime.** Their selectors (`.lx-shell`, `.lx-sidebar`, `.lx-topbar`, `.lx-tabbar`, `button[aria-controls="lx-drawer"]`) come from reading `LearnerShell.tsx` and `globals.css`. Expect to adjust them on first contact with a real workspace.
- **`clerk-ticket` sign-in is untested.** It uses `@clerk/testing`'s documented helper; it has not been exercised here.
- **Chromium only.** The mobile and tablet projects are Chromium at that viewport with touch enabled, not Safari or a device profile.
- **One smoke path per role** (the workspace home), as UX-1 specifies. Other pages are added per run with `E2E_<ROLE>_PATHS`.
- **No CI wiring.** There is no CI configuration in this lane's ownership.

### 6. Dependency note

The current `@clerk/testing` (2.2.45) raises `@clerk/backend` and `@clerk/shared` in the lockfile, which are runtime dependencies of the app. It is pinned to 2.2.28, the release built against the versions already locked (`@clerk/backend` 3.16.10, `@clerk/shared` 4.29.3). `git diff 4fb45b0 -- package-lock.json` shows additions only. Whoever next upgrades `@clerk/nextjs` should move `@clerk/testing` with it.

Playwright's Chromium (about 99 MB) was downloaded to the user cache `~/Library/Caches/ms-playwright`, outside the repository.

## BLOCKERS

NONE for building the harness.

Certifying the four profiles is blocked on a target (CR-L12-02). Observed: `studyos-dev/.env.local` points `DATABASE_URL` at a hosted Neon database, the Track A identities exist only there and in the Clerk DEV instance, and nothing is listening on local Postgres `:54329`. Signing in as a role and opening its workspace writes (Clerk session, `users` row backfill in the dashboard layout). L3R1 UX-1 says the lane may not write to DEV and that the Orchestrator must name the target, so the lane did not run them.

## CHANGE_REQUESTS

| # | Lock / owner | Files | Change needed | What this lane did instead |
|---|---|---|---|---|
| CR-L12-01 | No lock lists it; `src/` is outside L12 | `src/app/layout.tsx` (and how `[locale]/layout.tsx` and `LearnerShell.tsx` pass the locale up) | `<html lang>` must carry the page language. Then set `expectedToFail: false` for KF-L12-01 in `tests/e2e/support/known-findings.ts` | Pinned it as an assertion; fails in certify mode |
| CR-L12-02 | Orchestrator decision; `STAGE_RUNTIME` if the target is Stage | none | Name an authenticated target for the role suites, and the auth mode: (a) a local database with the Track A fixtures and `E2E_ROLE_AUTH=clerk-ticket`; (b) hosted DEV with the same mode, accepting its writes; or (c) Stage, read through sessions the Human Operator captures (`E2E_ROLE_AUTH=storage-state`), run by or with `L2_STAGE_B5` | Left the suites reporting `NOT_RUN` |
| CR-L12-03 | Product | none | Decide whether `serious` axe violations (colour contrast today) block certification | Recorded them; threshold stays at `critical` per UX-1 |

## MERGE RECOMMENDATION

Safe to merge into the integration line after review: one commit on `4fb45b0`, no file under `src/`, lockfile additions only, full unit suite and typecheck pass. It conflicts with another lane only if that lane also edited `package.json` or `package-lock.json`, which L3R1 reserves for L12 in Wave 0.

Merging does not certify the four profiles. That needs CR-L12-02 and one role run.

## NEXT SAFE ACTION

Orchestrator rules on CR-L12-02. With a target named, the first role run is one command (`tests/e2e/README.md`), and its result decides KF-L12-02.
