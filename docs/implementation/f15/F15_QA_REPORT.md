# F15 — QA Report

Branch: `f15/pilot-readiness-production-hardening`
Base: `origin/f14/experience-completion-readiness@e3d23a44d0657b6ccf9fedf08aa8e8d454839d41`
Certified HEAD: `642aa0267ef9d15b4da323d8b89d7ff64dedc1fa`

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
7. A real Preview-environment configuration defect (Clerk misconfigured to an unrelated application) — found, NOT fixed (outside this agent's access; escalated as a hard Pilot gate).

## Overall QA Verdict

**PASS (local/structural + real Preview infrastructure), with two newly-identified hard Pilot gates (credential rotation, Preview Clerk misconfiguration) and honestly registered live-verification gaps.** Full automated suite and all real-Postgres regressions pass with zero known regressions; dependency security is clean; the phase's principal functional blocker (exam-taking) is now architecturally resolved and unit-tested; a real Preview deployment exists for the first time in this program's history; live authenticated verification remains blocked by two independent, clearly-diagnosed causes (a Preview config defect and this agent's own credential-handling boundary), never fabricated as passing.
