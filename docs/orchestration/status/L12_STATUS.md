LANE: L12_UX_ACCESSIBILITY
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T18:07Z
BASE_SHA: 4fb45b0
CURRENT_SHA: the commit after afbf822 on feat/l12-ux-accessibility (git rev-parse --short feat/l12-ux-accessibility). Chain: 4fb45b0 -> 36f3bf8 (harness, accepted) -> afbf822 (html lang fix) -> harness alignment + this status

CURRENT_PHASE: STOP

NOW_DOING: NONE (lane stopped; waiting for L12-R1 authorization)

COMPLETED:
- UX-1 harness @ 36f3bf8, ACCEPTED by the Orchestrator
- CR-L12-01: <html lang> follows the route locale (afbf822)
- Harness aligned with the ruling: operator-captured storage state is the only role sign-in; programmatic Clerk sign-in and @clerk/testing removed; Production sessions refused; axe policy per surface (authenticated: critical + serious; public: critical, serious reported)
- Validation run: public browser harness, certify mode, lang regressions, unit suite, typecheck, build

CURRENT_FINDINGS:
- HTML_LANG_FIX: /es, /es/how-it-works, /de serve and render lang matching the route; /en serves en; at 3 viewports, in the initial HTML and in the DOM
- SIDE EFFECT: the root layout now reads request headers, so /[locale], /[locale]/how-it-works, /role-select and /_not-found changed from prerendered to server-rendered on demand (build route table)
- KF-L12-03 (new, from source, not observed): an authenticated workspace in a non-English interface language still gets <html lang="en">; /dashboard has no route locale
- KF-L12-02 (collapsed authenticated navigation names): OPEN, to be re-tested in L12-R1
- Public serious axe findings unchanged: color-contrast, /es /en /de 23 nodes each, how-it-works 5, sign-in 1, sign-up 2. Not suppressed
- One full unit run reported 3 failures that were not captured and did not recur in the next two runs (521/521)

FILES_READ: as before, plus src/lib/i18n/language.ts, src/lib/i18n/messages.ts (isLocale), src/lib/admin/shell-context.ts, src/lib/seo.ts, next.config.js, node_modules/next/dist/docs (internationalization, root-params, headers, layout)

FILES_MODIFIED:
- src/app/layout.tsx
- src/lib/i18n/document-language.ts (new)
- tests/unit/l12-document-language.test.ts (new)
- package.json, package-lock.json (@clerk/testing removed)
- playwright.config.ts
- tests/e2e/auth.setup.ts (deleted)
- tests/e2e/README.md, public.spec.ts, roles.spec.ts, harness.selftest.spec.ts
- tests/e2e/support/target.ts, audit.ts, session.ts, known-findings.ts
- tests/unit/l12-e2e-harness.test.ts
- docs/orchestration/status/L12_STATUS.md, docs/orchestration/reports/L12_REPORT.md

TESTS:
- npm run test:browser: exit 0; 132 passed (18 of them planted self-test defects rejected), 72 skipped (role suites NOT_RUN), 0 unexpected
- npm run test:browser:certify: exit 0; 132 passed, 72 skipped, 0 failed
- npx vitest run tests/unit/l12-*.test.ts: 2 files, 20 tests passed
- npx vitest run (full, no database): 521 files, 9,310 tests passed on the last two runs; the first run after the change showed 3 failures, not captured, not reproduced
- npx tsc --noEmit -p .: no output
- next build (run by the harness, no database): succeeded
- Role suites: NOT_RUN by instruction

BLOCKERS: NONE. Role certification waits for the Orchestrator to authorize L12-R1.

LOCK_REQUESTS: NONE

CROSS_LANE_DEPENDENCIES:
- L12-R1 needs: converged Stage candidate; four operator-captured Stage storage states
- CR-L12-04: authenticated <html lang> (KF-L12-03) needs the dashboard shell, owned outside L12
- CR-L12-05: decide whether marketing pages must stay prerendered

NEXT: Orchestrator review

PROGRESS:
- harness: ACCEPTED
- html lang fix: DONE for localized routes; authenticated shell open (KF-L12-03)
- public suite: RUN, 7 pages x 3 viewports
- role suites: 0/4 profiles run (PENDING L12-R1)
