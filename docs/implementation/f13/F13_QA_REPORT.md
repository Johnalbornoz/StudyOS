# F13 — QA Report

Branch: `f13/ux-consolidation`
Base: `origin/f12/institution-intelligence@b316eb74914ff51d8f62e0f2fc377aeca9bb310c`
Certified HEAD: `6872249254462e562a96b59d382213b1d02543e6`

## Test Layer Matrix (mandatory separate reporting, task §62)

```
AUTOMATED_DOMAIN_UNIT:
  executed: 5604 (7 net new F13 source-guard tests; zero pre-existing
             test required modification for F13's own changes)
  passed:   5602
  failed:   2 (pre-existing, unrelated: tests/unit/validation-cycle.test.ts
             and tests/unit/decision-context-query-cost.test.ts both hard-
             code `NOW = new Date('2026-09-10...')` without mocking the
             system clock to it -- as real time has advanced to within one
             day of a hard-coded '2026-09-20' deadline used in the same
             fixture, the "OPEN, not yet overdue" assertion now reads
             "OVERDUE". CONFIRMED unrelated to F13: neither test file, nor
             anything they import, appears in this phase's diff (`git
             status --short` shows only layout.tsx/LearnerShell.tsx/
             messages.ts/globals.css/institution.service.ts/the teacher
             interventions route as MODIFIED tracked files -- none of
             which these two tests exercise). Not fixed in this phase
             (out of scope: Phase 2D/2E validation-cycle domain logic,
             unrelated to UX consolidation) -- flagged for whoever owns
             that domain next.

COMPONENT_UI:
  New components (StatusBadge, EmptyState, MetricCard, PageHeader,
  WorkspaceSwitcher, AssignInterventionForm, InstitutionSubNav) verified
  by TypeScript compilation + `next build` (which type-checks and
  statically renders/analyzes every route) -- no dedicated component-
  level render test (e.g. React Testing Library) was added this phase;
  this repository has no existing component-test harness to extend.

ROUTING:
  11 new/modified routes (see F13_ROUTE_AND_DEPRECATION_MAP.md) all
  compile and are included in a clean `next build` route manifest.

AUTHORIZATION:
  Verified by direct code reading (every new page delegates to an
  already-independently-certified service function) + full re-run of
  F2/F11-A/F11-B/F12's own real-Postgres authorization adversarial
  matrices (unchanged, all PASS).

REAL_POSTGRES_REGRESSION:
  16 scripts re-run: f2, f5, f6, f7, f8, f9, f10 (+ multi-role), f11-a,
  f11b, f11c1, f11c2, f11c3, f11c4, f11-integrated, f12 -- ALL PASS,
  unchanged.

STUDENT_JOURNEY / PARENT_JOURNEY / TEACHER_JOURNEY / INSTITUTION_JOURNEY / MULTI_ROLE:
  see F13_JOURNEY_CERTIFICATION.md -- certified at the structural/
  regression level; live authenticated walkthroughs DEFERRED (IVG-F13-02/03)

RESPONSIVE:
  Inherited shell verified by code reading (existing, already-responsive
  LearnerShell extended, not replaced); live multi-viewport authenticated
  check DEFERRED (see F13_RESPONSIVE_MODEL.md)

ACCESSIBILITY:
  Code-level properties verified (see F13_ACCESSIBILITY_REPORT.md); live
  AT/automated-scoring pass DEFERRED (IVG-F13-04)

CACHE_ISOLATION:
  Architecturally verified (no client cache of authorization-sensitive
  data exists anywhere new; router.refresh() forces full re-resolution
  on workspace switch) -- see F13_CACHE_ISOLATION_REPORT.md; live two-
  session demonstration DEFERRED (IVG-F13-05)

PERFORMANCE_CHARACTERIZATION:
  Query-shape / bundle-size characterization done (see
  F13_PERFORMANCE_CHARACTERIZATION.md); live navigation-latency
  measurement DEFERRED (IVG-F13-06)

REMOTE_PREVIEW_SMOKE:
  NOT RUN -- no Vercel CLI/.vercel linkage available (see
  F13_PREVIEW_CERTIFICATION.md) -- honestly reported as DEFERRED, never PASS

REMOTE_AUTHENTICATED_E2E:
  NOT RUN -- see F13_IVG_DEFERRED_TEST_REGISTER.md (IVG-F13-02)

VISUAL_ACCEPTANCE:
  One safe, unauthenticated, read-only local browser check performed
  (public marketing page renders correctly) -- authenticated visual
  acceptance DEFERRED (IVG-F13-03), see F13_PREVIEW_CERTIFICATION.md
  for why a live authenticated check was judged unsafe in this
  environment

IVG_DEFERRED:
  12 items carried forward (F7-F12), 7 new (F13-01 through 07), none
  silently dropped -- see F13_IVG_DEFERRED_TEST_REGISTER.md

FULL_SUITE:
  349 test files / 5604 tests -- 5602 PASS, 2 pre-existing unrelated failures
  tsc --noEmit: clean
  next build: clean
```

## Bugs Discovered and Fixed

1. **A real, load-bearing gap**: `POST /api/teacher/interventions`'s Zod schema never had an `EXAM` target branch, despite F11-C4 having fully certified Exam Reinforcement at the service layer weeks earlier in this same platform's history — meaning no real Teacher UI could ever have assigned an Exam Reinforcement intervention via HTTP before this phase. Fixed (see `F13_TEACHER_EXPERIENCE.md`), structurally guarded against silent regression.
2. Two pre-existing, unrelated, date-sensitive test failures were found and diagnosed (root cause identified precisely: a missing `vi.setSystemTime`/fake-timers call against a hard-coded `NOW`), confirmed unrelated to this phase's own changes, and left for their actual domain owner rather than patched speculatively outside this phase's scope.
3. An initial broad-exploration research pass (used to accelerate inspection) returned several confidently-stated but FALSE claims about the codebase (no authorization module, no API routes for Teacher/Institution, no workspace concept) — every one of its claims was independently re-verified against real files before being relied upon, and the corrected, verified facts are what `F13_CURRENT_UX_ARCHITECTURE_ASSESSMENT.md` actually documents. Recorded here as a genuine finding about this session's own process, not swept aside.

## Overall QA Verdict

**PASS (local/structural), with honestly registered remote/live gaps.** Zero domain regressions across 16 independently re-run real-Postgres certifications; two pre-existing, confirmed-unrelated test failures; one real UI-adjacent backend gap found and fixed; remote Preview and live authenticated/visual/accessibility verification explicitly deferred, never fabricated.
