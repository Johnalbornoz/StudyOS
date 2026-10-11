# L12_UX_ACCESSIBILITY — Report (UX-1 harness + CR-L12-01 remediation)

Run date: 2026-10-11 (UTC). This revision replaces the report committed at `36f3bf8` and covers the work authorized by the Orchestrator ruling "L12 harness accepted / narrow remediation authorized".

## LANE

| | |
|---|---|
| Lane | `L12_UX_ACCESSIBILITY` |
| Scope | UX-1 harness (accepted at `36f3bf8`); CR-L12-01 `<html lang>` fix; harness aligned with the ruling |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-l12-ux-accessibility` |
| Branch | `feat/l12-ux-accessibility` (local only) |

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

| Gate | Result |
|---|---|
| HARNESS | **PASS** |
| HTML_LANG_FIX | **PASS** for localized routes (`/es`, `/en`, every supported locale). One side effect to review: finding 2 |
| PUBLIC_CRITICAL_A11Y | **PASS** (0 critical, 7 pages × 3 viewports) |
| PUBLIC_SERIOUS_A11Y | **PARTIAL** (colour contrast, finding 4; not suppressed) |
| ROLE_BROWSER_CERTIFICATION | **PENDING** (L12-R1) |
| ROLE_MOBILE_CERTIFICATION | **PENDING** (L12-R1) |
| AUTHENTICATED_NAV_A11Y | **PENDING** (KF-L12-02 open; L12-R1) |

## BASE SHA

`4fb45b0` (`fix/security-p1-remediation`).

## FINAL SHA

Three commits on `feat/l12-ux-accessibility`:

1. `36f3bf8` — UX-1 harness (accepted).
2. `afbf822` — CR-L12-01, the `<html lang>` fix and its unit regression. Nothing else.
3. The commit after it — harness alignment with the ruling, browser regressions for the fix, this report and the status. Run `git rev-parse feat/l12-ux-accessibility`.

## FILES CHANGED SINCE `36f3bf8`

Commit `afbf822` (the remediation):

- `src/app/layout.tsx` — `lang` derived from the request path instead of `"en"`
- `src/lib/i18n/document-language.ts` (new) — `resolveDocumentLanguage`
- `tests/unit/l12-document-language.test.ts` (new)

Following commit (harness and documents):

- `package.json`, `package-lock.json` — `@clerk/testing` removed
- `playwright.config.ts` — sign-in setup project removed
- `tests/e2e/auth.setup.ts` — deleted
- `tests/e2e/support/session.ts`, `target.ts`, `audit.ts`, `known-findings.ts`
- `tests/e2e/public.spec.ts`, `roles.spec.ts`, `harness.selftest.spec.ts`, `README.md`
- `tests/unit/l12-e2e-harness.test.ts`
- `docs/orchestration/status/L12_STATUS.md`, `docs/orchestration/reports/L12_REPORT.md`

The only application files touched are the two under `src/` above, both inside the ruling's authorization. No schema, migration, script, environment or flag changed.

## LOCKS USED

NONE. `src/app/layout.tsx` was edited under the ruling's explicit authorization for CR-L12-01.

## TESTS

| Command | Result |
|---|---|
| `npm run test:browser` (public harness, local production build, Clerk test keys, no database) | exit 0. 132 passed, 72 skipped, 0 unexpected. 18 of the 132 are planted self-test defects correctly rejected |
| `npm run test:browser:certify` | exit 0. **0 failed**, 132 passed, 72 skipped. Before the fix this mode failed 6 tests |
| Focused lang regressions, unit: `npx vitest run tests/unit/l12-document-language.test.ts` | 6 passed |
| Focused lang regressions, browser (inside the runs above) | `/es`, `/es/how-it-works`, `/en`, `/en/how-it-works`, `/de`: `<html lang>` equals the route locale in the DOM and in the initial HTML, at 3 viewports (30 tests) |
| `npx vitest run tests/unit/l12-e2e-harness.test.ts` | 14 passed |
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run` | 521 files, 9,310 tests passed. See the note below |
| `npx tsc --noEmit -p .` | no output |
| `next build` (run by the harness, no database) | succeeded; 228 pages generated |
| Role suites (72 tests) | **NOT_RUN**, by instruction |
| DEV, Stage, Production | not touched |

**Unit-suite note.** The first full run after the change reported 3 failed tests in 3 files. I did not capture which, and that run took 69 s against the usual 29–34 s, right after two browser runs. Two further full runs passed (the last one 521 / 9,310, logged). I believe it was load-related timing, but I cannot show that. If the Orchestrator sees an intermittent unit failure on this branch, treat it as unexplained.

## FINDINGS

### 1. `<html lang>` now follows the route locale

`resolveDocumentLanguage` takes the first path segment and returns it when it is one of the supported locales (the existing `isLocale` over `LOCALES`); otherwise it returns the previous value, `en`. The root layout reads the path from the `x-studyos-pathname` request header that `src/proxy.ts` already sets for every page request and overwrites if a client sends it. No new locale mechanism was added, and Spanish is not hard-coded anywhere.

Observed: `/es` → `es`, `/en` → `en`, `/de` → `de`; `/sign-in` and `/sign-up` stay `en`.

### 2. Side effect: the marketing pages are no longer prerendered

Reading request headers in the root layout makes every route under it render per request. The build route table changed:

| Route | At `36f3bf8` | Now |
|---|---|---|
| `/[locale]` (5 locales) | prerendered (SSG) | server-rendered on demand |
| `/[locale]/how-it-works` (5 locales) | prerendered (SSG) | server-rendered on demand |
| `/role-select`, `/_not-found` | static | server-rendered on demand |
| everything else | already dynamic | unchanged |

These pages use no database, so the cost is a server render per visit instead of a cached file: slower first byte and no CDN caching for the public site. I did not measure it.

Why I accepted it: a root layout placed above `[locale]` cannot see the locale any other way. The approach in the bundled Next 16 guide is to make `app/[locale]/layout.tsx` the root layout, which means moving `dashboard`, `sign-in`, `sign-up`, `account`, `invite`, `role-select` and the root page into a route group with a second root layout. That is a mass rename under `src/app/dashboard/**` while L6–L9 are editing it, and it is not a narrow fix. It keeps prerendering and is the better end state once the role lanes have converged (CR-L12-05).

### 3. The authenticated shell still declares `en` for non-English users (KF-L12-03, new)

`/dashboard/**` has no locale in the path. The user's interface language is resolved from the database inside `src/app/dashboard/layout.tsx` and set by `LearnerShell` on an inner element, below `<html>`. So a Spanish-interface user still gets `<html lang="en">` there. This is read from the source, not observed. The role suite asserts it (`<html lang>` must equal the shell language) and will report it in L12-R1; it is marked as an expected failure until fixed. Fixing it needs the dashboard layout or shell, which are outside this lane and outside the ruling's authorization (CR-L12-04).

### 4. Public serious accessibility findings, unchanged and not suppressed

| Page | Rule | Nodes |
|---|---|---|
| `/es`, `/en`, `/de` | `color-contrast` | 23 each |
| `/es/how-it-works`, `/en/how-it-works` | `color-contrast` | 5 each |
| `/sign-in` | `color-contrast` (Clerk widget) | 1 |
| `/sign-up` | `color-contrast` (Clerk widget) | 2 |

Identical at all three viewports. Each is now annotated on its test (`axe-serious`) as well as attached in full. `PUBLIC_ACCESSIBILITY = PARTIAL`.

### 5. Harness changes made to match the ruling

- **Role sign-in is operator-captured storage state only.** The programmatic Clerk sign-in mode, `auth.setup.ts` and the `@clerk/testing` dependency are removed. The harness has no code path that signs in.
- **Production sessions are refused.** A storage-state file with a cookie domain or origin on a Production host throws before any test runs, as does a Production `E2E_BASE_URL` (now including subdomains).
- **Session files stay out of git.** `tests/e2e/.auth/` is ignored; the README tells the operator to capture there or outside the repository.
- **Accessibility policy per surface.** Authenticated pages fail on `critical` and `serious`. Public pages fail on `critical`. `E2E_AXE_FAIL_ON` can add impacts and cannot remove any. The self-test plants a serious violation and requires the authenticated policy to reject it.
- **Known findings.** KF-L12-01 is no longer excused (fixed). KF-L12-02 stays open and strict. KF-L12-03 added.

The lockfile, against `4fb45b0`, still shows additions only: `@playwright/test`, `playwright`, `playwright-core`, `@axe-core/playwright`, `axe-core`.

### 6. Still unverified

The role suites have never run against an authenticated page. Their selectors come from reading `LearnerShell.tsx` and `globals.css`; expect adjustments on first contact in L12-R1. Coverage is Chromium only.

## BLOCKERS

NONE for this remediation. Role certification waits for the L12-R1 authorization.

## CHANGE_REQUESTS

| # | Owner | Files | Request |
|---|---|---|---|
| CR-L12-01 | — | `src/app/layout.tsx` | **Closed** by `afbf822` for localized routes |
| CR-L12-02 | Orchestrator | — | **Ruled**: converged Stage / Preview, operator-captured storage state. Open inputs for L12-R1: the Stage host, and four session files for synthetic Stage-only accounts |
| CR-L12-03 | Orchestrator | — | **Ruled**: policy encoded in the harness |
| CR-L12-04 | Lane owning the dashboard shell (`src/app/dashboard/layout.tsx` is a hot file) | `src/app/dashboard/layout.tsx` or `LearnerShell.tsx`, `src/app/layout.tsx` | Make `<html lang>` carry the signed-in user's interface language (KF-L12-03). Then clear `expectedToFail` on KF-L12-03 |
| CR-L12-05 | Orchestrator | `src/app/**` structure | Decide whether the marketing pages must be prerendered. If yes, schedule the `[locale]` root-layout restructure after the role lanes converge; `resolveDocumentLanguage` then stays only for the non-localized branch |

## MERGE RECOMMENDATION

Not merged, not pushed. When the Orchestrator merges: `afbf822` can be taken on its own; it touches one hot-adjacent file (`src/app/layout.tsx`, the root layout, not the dashboard layout). Decide CR-L12-05 first if prerendered marketing pages matter for the pilot, because finding 2 ships with that commit.

## NEXT SAFE ACTION

Orchestrator reviews `afbf822` and finding 2, then authorizes L12-R1 once the converged Stage candidate and the four storage-state files exist.
