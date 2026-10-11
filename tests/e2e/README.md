# Browser and accessibility harness (L12 / UX-1)

Playwright + axe-core. It certifies what a user gets in a real browser, for the four profiles (Student, Parent, Teacher, Institution) and the public pages, at three viewports.

## What is asserted

On every audited page, at 375 px (mobile), 768 px (tablet) and 1280 px (desktop):

| Check | Rule |
|---|---|
| Accessibility scan | axe, WCAG 2.x A/AA: zero violations at `critical` impact. Everything found is attached to the report. |
| Horizontal overflow | The document does not scroll sideways. |
| Document language | `<html lang>` is the language the page is written in. |
| Navigation names | Every visible link and button in a navigation region has an accessible name; page-wide `link-name` / `button-name`. |

Per role, additionally: the role lands in its own workspace, the navigation matches the viewport (sidebar on desktop; top bar, tab bar and drawer below 1024 px), and every control in the collapsed navigation and in the drawer is named.

`harness.selftest.spec.ts` plants each defect in a synthetic page and requires the checks to reject it.

## Running

```bash
npx playwright install chromium        # once per machine
E2E_ENV_FILE=/path/to/env npm run test:browser
E2E_ENV_FILE=/path/to/env npm run test:browser:certify
```

With no `E2E_BASE_URL`, the harness builds this checkout and serves it on `http://127.0.0.1:3100`. The env file needs the Clerk keys the app needs to render; the public suite needs no database.

| Variable | Meaning |
|---|---|
| `E2E_BASE_URL` | Audit an already running target instead. Production hosts are refused. |
| `E2E_ENV_FILE` | Env file loaded before the run. |
| `E2E_ROLE_AUTH` | Unset: role suites are skipped as `NOT_RUN`. `clerk-ticket`: sign in each role with Clerk's testing helpers (test-instance keys only). `storage-state`: use sessions captured by the operator. |
| `E2E_STORAGE_STATE_DIR` | Directory with `student.json`, `parent.json`, `teacher.json`, `institution.json`. |
| `E2E_<ROLE>_EMAIL` | Account for `clerk-ticket` (default: the Track A fixture identity). |
| `E2E_<ROLE>_PATHS` | Extra comma-separated paths to audit for that role. |
| `E2E_KNOWN_FINDINGS` | `expected` (default) or `strict`. |
| `E2E_AXE_FAIL_ON` | Impacts that fail a page. Default `critical`; `critical,serious` to tighten. |

Signing in as a role and opening its workspace writes to the target (Clerk session, user row backfill). Only run the role suites against a target the Orchestrator has named.

Capturing a session by hand, for a target where sign-in belongs to the Human Operator:

```bash
npx playwright codegen --save-storage=/secure/dir/student.json https://<target>/sign-in
```

## Known findings

`support/known-findings.ts` lists defects already seen on Stage. One confirmed in the code is marked `expectedToFail`: in the default mode its tests are expected failures, and they turn red the day the defect is fixed, which is the cue to clear the flag. `npm run test:browser:certify` excuses nothing.

## Layout

- `support/target.ts`: target, viewports, roles, guards (unit-tested in `tests/unit/l12-e2e-harness.test.ts`)
- `support/audit.ts`: the four checks
- `auth.setup.ts`, `support/session.ts`: role sessions
- `public.spec.ts`, `roles.spec.ts`, `harness.selftest.spec.ts`
- `.auth/`, `.output/`: sessions and run output, git-ignored

`@clerk/testing` is pinned to the release built against the `@clerk/backend` and `@clerk/shared` versions in the lockfile, so installing it changes no runtime dependency. Move it together with `@clerk/nextjs`.
