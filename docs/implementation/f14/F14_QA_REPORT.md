# F14 — QA Report

Branch: `f14/experience-completion-readiness`
Base: `origin/f13/ux-consolidation@39c825da84e061a0ddf72dfdb61ccf6519ad127f`

## Test Layer Matrix (mandatory separate reporting)

```
AUTOMATED_DOMAIN_UNIT:
  executed: 5614 (10 net new F14 source-guard tests + 2 date-drift
             fixes; zero pre-existing test required modification for
             F14's own new features -- only lx2-learner-navigation.test.ts
             needed updating, and only because F14 intentionally added
             two real new primary nav items)
  passed:   5614
  failed:   0
  Full suite improved on F13's own baseline: F13 shipped with 2 known,
  confirmed-unrelated failures (date-drift). F14 root-caused and fixed
  both (see F14_DATE_CLOCK_STABILIZATION.md) rather than re-deferring
  them, since fixing them was explicitly in this phase's own scope
  (Workstream G).

COMPONENT_UI:
  New components (StartSimulationPanel, AttemptControls,
  StartAssignmentButton, PracticeRunner) verified by TypeScript
  compilation + `next build` (statically renders/analyzes every
  route) -- no dedicated component-level render test framework exists
  in this repository (same as F13's own finding, unchanged).

ROUTING:
  11 new page routes + 2 new API routes + 1 modified API route, all
  compile and appear in a clean `next build` route manifest.

AUTHORIZATION:
  Verified by direct code reading (every new route/page delegates to
  an already-independently-certified service function -- see
  F14_SECURITY_AUTHORIZATION_REPORT.md) + full re-run of F2/F9/F11/F12's
  own real-Postgres authorization adversarial matrices (unchanged, all
  PASS).

REAL_POSTGRES_REGRESSION:
  16 scripts re-run (identical set to F13's own): f2, f5, f6, f7, f8,
  f9, f10-parent, f10-multi-role, f11-a, f11b, f11c1, f11c2, f11c3,
  f11c4, f11-integrated, f12 -- ALL PASS, unchanged. See "Regression
  Evidence" below for representative self-reported certification lines.

STUDENT_JOURNEY / PARENT_JOURNEY / TEACHER_JOURNEY / INSTITUTION_JOURNEY:
  Certified at the structural/regression level (every new page's
  authorization/data-flow traced by direct code reading); live
  authenticated walkthroughs DEFERRED (IVG-F13-02/03, extended)

RESPONSIVE:
  Inherited shell verified by code reading (no shell/breakpoint change
  this phase beyond additive nav items/icons); live multi-viewport
  authenticated check DEFERRED (IVG-F13-06 lineage)

ACCESSIBILITY:
  Code-level properties verified (see F14_ACCESSIBILITY_REPORT.md);
  live AT/automated-scoring pass DEFERRED (IVG-F14-04)

CACHE_ISOLATION:
  Architecturally verified, extended to every new surface by identical
  construction (see F14_CACHE_AND_CONTEXT_ISOLATION.md); live
  two-session demonstration DEFERRED (IVG-F13-05)

PERFORMANCE_CHARACTERIZATION:
  Query-shape / bundle-size characterization done (see
  F14_PERFORMANCE_BASELINE.md); live navigation-latency measurement
  DEFERRED (IVG-F14-05)

REMOTE_PREVIEW_SMOKE:
  NOT RUN -- no Vercel CLI/`.vercel` linkage available (identical
  limitation to F12/F13) -- honestly reported as DEFERRED, never PASS
  (IVG-F13-01)

REMOTE_AUTHENTICATED_E2E:
  NOT RUN -- see F14_IVG_DEFERRED_TEST_REGISTER.md (IVG-F8-02/F13-02,
  extended)

VISUAL_ACCEPTANCE:
  NOT PERFORMED this phase -- no dev server was started in this
  worktree at all (see F14_ENVIRONMENT_PROVENANCE_REPORT.md for why
  even F13's own narrow, unauthenticated screenshot was judged not
  worth repeating given the new, concrete evidence of a live
  credential-bearing file in a sibling directory). DEFERRED (IVG-F13-03,
  extended), never claimed as PASS.

IVG_DEFERRED:
  18 items carried/updated (12 from F7-F12, 6 extended-but-still-open
  from F13, plus IVG-F13-07 marked RESOLVED-WITH-EVIDENCE), 6 new
  (F14-01 through 06) -- none silently dropped -- see
  F14_IVG_DEFERRED_TEST_REGISTER.md

FULL_SUITE:
  350 test files / 5614 tests -- 5614 PASS, 0 failures
  tsc --noEmit: clean
  next build: clean
```

## Regression Evidence (representative excerpts, not the full logs)

```
=== F12 CERTIFICATION: ALL ASSERTIONS PASSED ===
=== F12 migration + certification: ALL CHECKS PASSED ===

=== F11 INTEGRATED CERTIFICATION: ALL ASSERTIONS PASSED ===
=== F11 integrated migration + certification: ALL CHECKS PASSED ===
```

All 16 scripts produced an analogous "ALL CHECKS PASSED" (or equivalent) terminal line; the full wrapper run recorded:

```
PASS: f2-authorization-migration-cert.sh
PASS: f5-learner-state-migration-cert.sh
PASS: f6-curriculum-mapping-migration-cert.sh
PASS: f7-assessment-framework-migration-cert.sh
PASS: f8-assessment-framework-migration-cert.sh
PASS: f9-exam-readiness-simulation-migration-cert.sh
PASS: f10-parent-experience-migration-cert.sh
PASS: f10-multi-role-authorization-check.sh
PASS: f11-a-teacher-authorization-migration-cert.sh
PASS: f11b-teacher-intervention-migration-cert.sh
PASS: f11c1-execution-orchestration-migration-cert.sh
PASS: f11c2-skill-execution-migration-cert.sh
PASS: f11c3-competency-execution-migration-cert.sh
PASS: f11c4-exam-execution-migration-cert.sh
PASS: f11-integrated-migration-cert.sh
PASS: f12-institution-intelligence-migration-cert.sh
```

Every script tears down its own ephemeral, local-only Postgres instance on exit (`trap cleanup EXIT`) — confirmed no stray `postgres`/`initdb` process remained running after the full run completed (`ps aux` checked directly).

## Bugs Discovered and Fixed

1. Two pre-existing, date-drift-sensitive test failures (root-caused precisely, fixed with pinned fake timers, no domain code changed) — see F14_DATE_CLOCK_STABILIZATION.md.
2. `TeacherInterventionExamProfileMismatchError` fell through to a raw, unhandled 500 in `POST /api/teacher/interventions` — fixed with a proper `400 EXAM_PROFILE_MISMATCH` mapping — see F14_TEACHER_EXAM_INTERVENTION_SEMANTICS.md.
3. The Teacher `AssignInterventionForm` discarded every real server error and always showed one generic message — fixed with a real code-to-guidance mapping — see F14_TEACHER_EXAM_INTERVENTION_SEMANTICS.md.
4. A real, credential-bearing `.env.local` was found sitting unattended in a sibling scratchpad worktree — investigated safely, no secret printed, no destructive action, escalated to the human operator — see F14_ENVIRONMENT_PROVENANCE_REPORT.md.
5. `abandonSimulationAttempt` (F9) had no API route exposing it — added — see F14_STUDENT_EXAM_PREP_EXPERIENCE.md.

## Overall QA Verdict

**PASS (local/structural), with honestly registered remote/live gaps and one genuine, disclosed feature-scope limitation (full item-by-item exam-taking UI, `IVG-F14-01`).** Zero domain regressions across 16 independently re-run real-Postgres certifications; full unit/integration suite now passes 100% (350/350 files, 5614/5614 tests) after root-causing and fixing F13's own carried-forward date-drift failures; two real bugs found and fixed (one a genuine information-disclosure hardening); remote Preview and live authenticated/visual/accessibility/performance verification explicitly deferred, never fabricated.
