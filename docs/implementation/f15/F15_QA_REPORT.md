# F15 — QA Report

Branch: `f15/pilot-readiness-production-hardening`
Base: `origin/f14/experience-completion-readiness@e3d23a44d0657b6ccf9fedf08aa8e8d454839d41`
Certified HEAD: `642aa0267ef9d15b4da323d8b89d7ff64dedc1fa`

## F15-C1 addendum (branch `f15-c1/pilot-gate-closure`, HEAD `31b31e1`, 2026-09-20 -- 2026-09-21)

Both hard Pilot gates F15 left open have changed status — one closed, one unchanged:

- **Preview Clerk misconfiguration (bug #7 below): now FIXED and independently re-verified.** The operator corrected the Preview-scope keys; this agent confirmed live that `/sign-in` renders "Sign in to StudyOS_App" with Development mode.
- **Preview database migration state: now VERIFIED (was previously unknown, see F15_DATABASE_AND_MIGRATION_READINESS.md).** 32/32 migrations applied, identity backfill run twice with zero-change idempotency confirmed on the second run, all integrity checks at 0 anomalies.
- **Credential rotation: unchanged, still OPERATOR_ACTION_REQUIRED.**

A ninth real bug (2026-09-21): the real Preview exam catalog was completely empty (`activeExamDefinitionCount: 0`), correctly blocking Student A's live self-service Exam Profile flow. Diagnosed live, closed with an operator-authorized, idempotent Pilot-only seed reusing already-certified F4/F6/F7 services — see `F15_PILOT_EXAM_CATALOG_SEED_MANIFEST.md`. A tenth bug was found and fixed **during that same work, before any write was attempted**: the seed's own dry-run mode silently truncated its reported plan when a parent entity didn't exist yet (an `undefined` id skipped every downstream step without logging it) — fixed with a cascading placeholder id, covered by a dedicated regression test.

Test suite grew alongside the C1 closure work. Current verified total: **357 files / 5668 tests / 5668 passed / 0 failed** (peaked at 358/5676 while the temporary seed-trigger route and its 8 tests existed; both were removed once the seed was verified, per that route's own stated temporary lifecycle). This includes the diagnostic route (now also reporting exam-catalog counts), `/api/health`, the Student Exam Profile self-service authorization/catalog contract, and the Pilot exam-catalog seed service. `tsc --noEmit` is clean; the webpack production build compiles and generates all routes successfully. Turbopack's internal worker cannot bind a port in the current execution environment, so that environmental failure is not represented as an application build failure.

## Full Technical Validation

```
TYPECHECK:      npx tsc --noEmit -p tsconfig.json  -> clean (0 errors)
BUILD:          npm run build                       -> clean, exit 0
LINT:           NO LINT SCRIPT / NO ESLINT CONFIG EXISTS IN THIS REPOSITORY
                (confirmed by inspection this phase -- not a regression, a
                 pre-existing repository characteristic; nothing to run)
DEPENDENCY AUDIT: npm audit -> 0 vulnerabilities (was 1 critical + 1 high
                 at this phase's start -- next 16.3.1 -> 16.3.5, see
                 F15_SECURITY_HARDENING_REPORT.md)

FULL SUITE:     npx vitest run
  files:   352 (up from F14's 350 -- 2 new test files this phase:
           f15-min-cohort-policy.test.ts, f15-simulation-item-resolution.test.ts)
  tests:   5632 (up from F14's 5614 -- 18 new: 7 MIN_COHORT_POLICY + 11
           item-resolution)
  passed:  5632
  failed:  0
  skipped: 0

REAL-POSTGRES REGRESSION: 16 scripts (identical set to F12/F13/F14):
  f2-authorization-migration-cert.sh                    PASS
  f5-learner-state-migration-cert.sh                    PASS
  f6-curriculum-mapping-migration-cert.sh                PASS
  f7-assessment-framework-migration-cert.sh              PASS
  f8-assessment-framework-migration-cert.sh              PASS
  f9-exam-readiness-simulation-migration-cert.sh         PASS
  f10-parent-experience-migration-cert.sh                PASS
  f10-multi-role-authorization-check.sh                  PASS
  f11-a-teacher-authorization-migration-cert.sh          PASS
  f11b-teacher-intervention-migration-cert.sh            PASS
  f11c1-execution-orchestration-migration-cert.sh        PASS
  f11c2-skill-execution-migration-cert.sh                PASS
  f11c3-competency-execution-migration-cert.sh           PASS
  f11c4-exam-execution-migration-cert.sh                 PASS
  f11-integrated-migration-cert.sh                       PASS
  f12-institution-intelligence-migration-cert.sh         PASS (see note below)

STRUCTURAL ARCHITECTURE TESTS: covered within the full suite above
  (f12-institution-intelligence-source-guard.test.ts and every other
  *-source-guard.test.ts, unchanged, all passing)

SECURITY CHECKS: npm audit (above); IDOR unit tests
  (f15-simulation-item-resolution.test.ts); manual spot-check of
  error-message leakage (F15_SECURITY_HARDENING_REPORT.md)
```

## Note on the F12 cert script

This phase's own MIN_COHORT_POLICY migration initially broke `f12-institution-intelligence-migration-cert.sh` (it asserted the policy table had zero rows — an assumption F15 correctly invalidated by design). Root-caused and fixed properly (not weakened): the shell script's own assertion was updated to reflect the new, real, resolved policy state, and three test-fixture assumptions inside the TypeScript cert runner (which had assumed an unsuppressed cohort for Diagnostics/Interventions that no longer held once real suppression was correctly applied) were corrected — two by growing the fixture's own cohort to a realistic size (3 distinct students, matching the TEST POLICY), one by handling both the suppressed and unsuppressed branches explicitly rather than assuming one. Re-run after each fix: PASS, with real, specific assertions exercised (not degraded into "always trivially passes").

## Bugs discovered and fixed this phase

1. Critical + High dependency vulnerabilities (`next`, transitively `sharp`) — fixed via a patch-level version bump.
2. A real architectural gap in F9's own simulation system: `SimulationPlanTarget` had no wiring to actual question content anywhere — fixed via a new orchestration layer.
3. Two real gaps in F12's own Institution Intelligence: `getInstitutionDiagnosticSummary`/`getInstitutionInterventionSummary` shipped without the cohort suppression their sibling metrics already had — fixed.
4. Three bugs in the F12 real-Postgres cert script itself, introduced by this phase's own MIN_COHORT_POLICY change, found and fixed (see note above).
5. A real, previously-narrow rate-limiting gap (only 1 of many high-cost routes was protected) — extended to 3 more.
6. A real accessibility gap in the new `ItemRunner` (no `aria-live` on question transitions) — found and fixed.
7. A real Preview-environment configuration defect (Clerk misconfigured to an unrelated application) — found, NOT fixed (outside this agent's access; escalated as a hard Pilot gate). **[F15-C1 update: fixed by the operator and independently re-verified live — see addendum above.]**
8. **[F15-C1]** A real Preview database migration gap (runtime database stuck 17 migrations behind, missing `users`/`user_roles`/`institutions` entirely) — found via live diagnostic route, classified as a genuine non-corrupt partial history, repaired by the operator via the same governed `npm run db:migrate` runner, independently re-verified.
9. **[F15-C1, 2026-09-21]** A real empty exam-catalog data gap (`activeExamDefinitionCount: 0`) blocking Student A's live self-service Exam Profile flow — found via live UI load and confirmed via diagnostic route, root-caused to `canonical_subjects` being completely empty, closed via an operator-authorized, idempotent Pilot-only catalog seed. See `F15_PILOT_EXAM_CATALOG_SEED_MANIFEST.md`.
10. **[F15-C1, 2026-09-21]** A real bug in the seed built for #9, found before any write was attempted: its own dry-run mode silently truncated the reported plan (stopped after 5 of 16 expected steps) whenever a parent entity didn't exist yet, because an `undefined` id caused every downstream step's guard to skip without logging. Fixed with a cascading placeholder id (the nil UUID); a dedicated regression test reproduces the exact failure.

## Overall QA Verdict

**PASS (local/structural + real Preview infrastructure)** — original F15 verdict. **[F15-C1 update, 2026-09-20]: one of the two hard Pilot gates (Preview Clerk misconfiguration) is now RESOLVED and independently re-verified; the Preview database migration gap discovered during this closure work is also RESOLVED and independently re-verified. Only ONE hard Pilot gate remains: credential rotation (`OPERATOR_ACTION_REQUIRED`).** Full automated suite and all real-Postgres regressions pass with zero known regressions; dependency security is clean; the phase's principal functional blocker (exam-taking) is architecturally resolved and unit-tested; a real Preview deployment exists, is correctly authenticated, and is now running on a fully-migrated, integrity-verified database. Full authenticated E2E is unblocked pending an operator-assisted login session — never fabricated as passing.
