LANE: L12_UX_ACCESSIBILITY
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T17:54Z
BASE_SHA: 4fb45b0
CURRENT_SHA: the single commit on feat/l12-ux-accessibility whose parent is 4fb45b0 (git rev-parse --short feat/l12-ux-accessibility)

CURRENT_PHASE: STOP

NOW_DOING: NONE (lane stopped)

COMPLETED:
- Worktree /Users/jalbornoz/PROYECTOS/studyos-l12-ux-accessibility, branch feat/l12-ux-accessibility from 4fb45b0
- UX-1 harness: Playwright + axe-core, 3 viewports (375 / 768 / 1280), public suite, four role suites, harness self-test, guards unit-tested
- Known Stage findings pinned as assertions (KF-L12-01 html lang, KF-L12-02 navigation accessible names)
- Public suite and self-test executed against a local production build of 4fb45b0
- Report written: docs/orchestration/reports/L12_REPORT.md

CURRENT_FINDINGS:
- KF-L12-01 CONFIRMED at 4fb45b0: /es and /es/how-it-works render <html lang="en"> at all 3 viewports (6 strict-mode failures). Cause: src/app/layout.tsx:47.
- KF-L12-02 NOT reproduced on public pages (9 navigation controls per marketing page, all named, 3 viewports). NOT_RUN in the role workspaces.
- No critical axe violation and no horizontal overflow on the 6 public pages at any viewport.
- Serious (non-failing) colour-contrast violations: /es and /en 23 nodes, how-it-works 5 nodes, Clerk sign-in 1, sign-up 2.
- The four role suites have never run against an authenticated page: no target is named, Track A fixtures live in hosted DEV, nothing listens on local Postgres :54329.

FILES_READ: orchestration docs; L3R1 and L4R1 reports; src/app/layout.tsx; src/app/[locale]/layout.tsx; src/app/dashboard/layout.tsx; src/app/dashboard/LearnerShell.tsx; src/app/dashboard/SidebarNav.tsx; src/app/globals.css; src/proxy.ts; src/lib/auth/protected-routes.ts; src/lib/identity/workspace-entry.ts; scripts/operations/track-a-fixtures.ts (all read-only)

FILES_MODIFIED:
- package.json
- package-lock.json
- playwright.config.ts (new)
- tests/e2e/.gitignore (new)
- tests/e2e/README.md (new)
- tests/e2e/auth.setup.ts (new)
- tests/e2e/public.spec.ts (new)
- tests/e2e/roles.spec.ts (new)
- tests/e2e/harness.selftest.spec.ts (new)
- tests/e2e/support/target.ts (new)
- tests/e2e/support/audit.ts (new)
- tests/e2e/support/session.ts (new)
- tests/e2e/support/known-findings.ts (new)
- tests/unit/l12-e2e-harness.test.ts (new)
- docs/orchestration/status/L12_STATUS.md (new)
- docs/orchestration/reports/L12_REPORT.md (new)

TESTS:
- npm run test:browser (default mode): exit 0; 99 passed (6 of them expected failures for KF-L12-01, 15 planted self-test defects rejected), 77 skipped (72 role tests NOT_RUN + 5 sign-in setup), 0 unexpected
- npm run test:browser:certify (strict): exit 1; 6 failed (KF-L12-01), 93 passed, 77 skipped
- npx vitest run tests/unit/l12-e2e-harness.test.ts: 10 passed
- npx vitest run (full, no database): 520 files, 9,300 tests passed
- npx tsc --noEmit -p .: no output
- next build (through the harness web server, no database): succeeded
- Role suites against any authenticated target: NOT_RUN

BLOCKERS: NONE for the harness. Runtime evidence for the four profiles needs the Orchestrator to name an authenticated target (CR-L12-02).

LOCK_REQUESTS: NONE

CROSS_LANE_DEPENDENCIES:
- CR-L12-01: whoever owns src/app/layout.tsx must set <html lang> from the page locale; then clear expectedToFail on KF-L12-01
- L6-L9 can add their pages to the role suites through E2E_<ROLE>_PATHS without editing L12 files

NEXT: Orchestrator review; name the target for the role suites

PROGRESS:
- baseline verified: DONE
- harness implemented: DONE
- public suite: RUN at 3 viewports, 6 pages
- harness self-test: RUN, 5 planted defects rejected, 3 repaired pages accepted
- role suites: 0/4 profiles run (NOT_RUN, target not named)
- report: DONE
