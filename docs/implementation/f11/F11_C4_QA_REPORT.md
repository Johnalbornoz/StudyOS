# F11-C4 — QA Report

Branch: `f11c4/exam-reinforcement-execution`
Base: `origin/f11c3/competency-reinforcement-execution@24648fb1bb4864de284e8a90fab3552019f1d88f`

## Test Layer Matrix (mandatory separate reporting, task §63)

```
AUTOMATED:
  executed: 5589 (9 net new F11-C4 source-guard tests; zero pre-existing
             tests required modification -- assignTeacherIntervention's
             INSERT gained named columns, not a positional trailing
             parameter, so the recurring storeQuiz-style index-shift
             regression class does not apply here)
  passed:   5589
  failed:   0
  environment: vitest, in-process, no database

REAL_POSTGRES:
  executed: 53 assertions (cases A-AD plus setup/fixture-validity checks)
  passed:   53
  failed:   0
  environment: ephemeral local Postgres (unix socket, never Neon/Preview/Production),
               seeded with F9's own real PAA/Cambridge fixture (f9-seed-pilot-dataset.ts)

AUTHORIZATION_ADVERSARIAL:
  executed: 8 (owner-allow, cross-student, Parent, assigning Teacher,
             unrelated Teacher, multi-role, exam-profile-mismatch,
             unpublished-version)
  passed:   8

ASSESSMENT_EXECUTION:
  executed: 5 (TOPIC_EXAM positive, DOMAIN_EXAM positive, MINI_MOCK
             positive, PAA FULL_MOCK negative, framework isolation
             PAA vs Cambridge)
  passed:   5

CONCURRENCY:
  executed: 2 (sequential retry, real Promise.all attempt-creation race)
             -- see F11_C4_CONCURRENCY_REPORT.md for full START_IDEMPOTENCY/
             ATTEMPT_CREATION_RACE/RESPONSE_DOUBLE_SUBMIT/FINALIZATION_RACE
             breakdown
  passed:   2 (plus 2 response/finalization-level checks)

FAILURE_RECOVERY:
  executed: 3 (mid-chain exam-version-resolution failure + clean retry,
             cancelled-intervention denial, expired-intervention denial)
  passed:   3

EVIDENCE_RECONCILIATION:
  executed: 8 checkpoints (assign, start, real response, double-submit,
             completion, PAA Full Mock rejection, concurrent race,
             mid-chain failure)
  passed:   8

F11_C3_REGRESSION:
  real Postgres: f11c3-competency-execution-migration-cert.sh PASS, unchanged

F11_C2_REGRESSION:
  real Postgres: f11c2-skill-execution-migration-cert.sh PASS, unchanged

F11_C1_REGRESSION:
  real Postgres: f11c1-execution-orchestration-migration-cert.sh PASS, unchanged

F11_B_REGRESSION:
  real Postgres: f11b-teacher-intervention-migration-cert.sh PASS, unchanged

F11_A_REGRESSION:
  real Postgres: f11-a-teacher-authorization-migration-cert.sh PASS, unchanged

F10_REGRESSION:
  real Postgres: f10-parent-experience-migration-cert.sh PASS, unchanged
  multi-role: f10-multi-role-authorization-check.sh PASS, unchanged

F9_REGRESSION:
  real Postgres: f9-exam-readiness-simulation-migration-cert.sh PASS, unchanged
  (Readiness Engine, Topic/Domain/Mini/Full Mock eligibility, simulation
  planning, attempt immutability, timing/tools/navigation, scoring, score
  projection gate, concurrency/idempotency, post-exam diagnosis -- all
  re-certified against the post-F11-C4 schema)

F8_REGRESSION:
  real Postgres: f8-assessment-framework-migration-cert.sh PASS, unchanged

F7_REGRESSION:
  real Postgres: f7-assessment-framework-migration-cert.sh PASS, unchanged

F5_REGRESSION:
  real Postgres: f5-learner-state-migration-cert.sh PASS, unchanged

F6_REGRESSION (curriculum mapping, load-bearing for the shared-canonical-concept proof):
  real Postgres: f6-curriculum-mapping-migration-cert.sh PASS, unchanged

F2_REGRESSION:
  real Postgres: f2-authorization-migration-cert.sh PASS, unchanged

CANONICAL_V2_REGRESSION:
  included in the 347-file/5589-test full suite run below -- PASS, unchanged
  (all canon-*.test.ts files)

FULL_SUITE:
  347 test files / 5589 tests -- PASS
  tsc --noEmit: clean
  next build: clean
```

## Bugs Discovered and Fixed

Zero implementation bugs. Two test-authoring mistakes in this phase's OWN new cert runner were caught and corrected before certification passed:
1. A sequential-idempotency assertion accidentally used a fresh idempotency key instead of reusing the earlier call's key (an authoring slip, not a code defect) -- corrected to reuse the same key, after which the assertion passed as expected.
2. A concurrency-race count query scoped only by `exam_profile_id`/`simulation_type` accidentally also counted an EARLIER, unrelated DOMAIN_EXAM execution against the same profile from a prior positive test case in the same run -- corrected to compare a before/after delta around the specific concurrent calls, isolating exactly the race being measured.

Neither correction weakened any assertion's actual intent; both are now measuring precisely what they were designed to measure.

## Overall QA Verdict

**PASS.** Zero regressions in substance across 5589 named-regression tests, 53 real-Postgres assertions, and 13 independently re-run prior-phase real-Postgres certification scripts (F2, F5, F6, F7, F8, F9, F10 + multi-role, F11-A, F11-B, F11-C1, F11-C2, F11-C3).
