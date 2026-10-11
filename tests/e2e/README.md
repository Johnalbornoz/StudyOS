# Browser and accessibility harness (L12 / UX-1)

Playwright + axe-core. It certifies what a user gets in a real browser, for the four profiles (Student, Parent, Teacher, Institution) and the public pages, at three viewports.

## What is asserted

On every audited page, at 375 px (mobile), 768 px (tablet) and 1280 px (desktop):

| Check | Rule |
|---|---|
| Accessibility scan | axe, WCAG 2.x A/AA. Authenticated pages: zero `critical` and zero `serious`. Public pages: zero `critical`; `serious` findings are reported on the test, not excused. |
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
| `E2E_STORAGE_STATE_DIR` | Directory with `student.json`, `parent.json`, `teacher.json`, `institution.json`. Unset: role suites are skipped as `NOT_RUN`. |
| `E2E_<ROLE>_PATHS` | Extra comma-separated paths to audit for that role. |
| `E2E_KNOWN_FINDINGS` | `expected` (default) or `strict`. |
| `E2E_AXE_FAIL_ON` | Extra impacts that fail a page. It adds to the policy above and cannot lower it. |

## Role sessions

The harness never signs in: no passwords, no programmatic Clerk sign-in. Each role runs on a Playwright storage state that the Human Operator captures by signing in, in a real browser, as a synthetic Stage-only account:

```bash
npx playwright codegen --save-storage=tests/e2e/.auth/student.json https://<stage-host>/sign-in
```

Then run with `E2E_BASE_URL=https://<stage-host> E2E_STORAGE_STATE_DIR=tests/e2e/.auth`.

- Session files are credentials. `tests/e2e/.auth/` is git-ignored; keep them there or outside the repository, and never commit them.
- Stage sessions only. A file holding a cookie or origin for a Production host is refused, and so is a Production `E2E_BASE_URL`.
- Opening a workspace can write to the target. Run the role suites only when the Orchestrator has authorized it.

## Known findings

`support/known-findings.ts` lists defects already seen on Stage. One confirmed in the code is marked `expectedToFail`: in the default mode its tests are expected failures, and they turn red the day the defect is fixed, which is the cue to clear the flag. `npm run test:browser:certify` excuses nothing.

## Layout

- `support/target.ts`: target, viewports, roles, guards (unit-tested in `tests/unit/l12-e2e-harness.test.ts`)
- `support/audit.ts`: the four checks
- `support/session.ts`: role sessions
- `public.spec.ts`, `roles.spec.ts`, `harness.selftest.spec.ts`
- `.auth/`, `.output/`: sessions and run output, git-ignored
