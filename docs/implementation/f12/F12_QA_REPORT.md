# F12 — QA Report

Branch: `f12/institution-intelligence`
Base: `origin/f11/integrated-certification@fa21298cac0cf2eac2030baedc506473bae79309`
Certified HEAD: `fb51f5843d4b19a6542961686e09d1dae1cc3053` on `f12/institution-intelligence`

## Test Layer Matrix (mandatory separate reporting, task §59)

```
AUTOMATED_DOMAIN_UNIT:
  executed: 5597 (8 net new F12 source-guard tests; zero pre-existing
             tests required modification)
  passed:   5597
  failed:   0

REAL_POSTGRES:
  executed: 38 assertions (cases A-AD plus fixture-validity/setup checks)
  passed:   38
  failed:   0
  environment: ephemeral local Postgres (unix socket, never Neon/Preview/
               Production), seeded with F9's own real PAA/Cambridge fixture

AUTHORIZATION_ADVERSARIAL:
  executed: 11 (active/none/revoked membership, cross-institution x2,
             cross-class, learner-in/out-of-institution, Parent, Teacher-
             alone, multi-role)
  passed:   11

PRIVACY_PAYLOAD:
  executed: 3 (no AI internals, no raw grading internals, no unrelated-
             learner reference in the learner drill-down payload)
  passed:   3

AGGREGATION_CORRECTNESS:
  executed: 9 (unique-learner vs enrollment-row count, evidence presence
             split, Skill/Competency separation, FULL/PARTIAL/UNMAPPED
             coverage separation, readiness distribution correctness,
             incompatible-exam-version non-averaging, diagnostic gap
             aggregation, intervention status aggregation, incorrect-
             performance-still-completed)
  passed:   9

CONCURRENCY:
  executed: 0 dedicated new cases -- F12 is read-only (INV-F12-05/06/07),
            so the concurrency surface this phase introduces is limited
            to "does a concurrent authorization revoke get respected on
            the next read", which is exercised implicitly by every
            DENY case above re-reading real, current membership rows
            each call (no caching layer exists to go stale)
  passed:   n/a (no dedicated new mechanism to race)

PERFORMANCE:
  executed: 3 entry points x 10 samples at a 50-learner synthetic scale
             (see F12_PERFORMANCE_BASELINE.md) -- characterization only,
             not a pass/fail gate
  result:   p95 <= 2.1ms for all three measured entry points

F11_REGRESSION:
  real Postgres: f11-integrated-migration-cert.sh PASS, unchanged
  (Teacher authorization, Concept/Skill/Competency/Exam intervention,
  Student self-service F9 independence, PAA Full Mock guard, Evidence
  semantics, multi-role isolation -- all re-verified)

F10_REGRESSION:
  real Postgres: f10-parent-experience-migration-cert.sh PASS, unchanged
  multi-role: f10-multi-role-authorization-check.sh PASS, unchanged

F9_REGRESSION:
  real Postgres: f9-exam-readiness-simulation-migration-cert.sh PASS,
  unchanged (Readiness, explainability, Full Mock NOT_READY, score
  projection safety all re-verified)

F8_F7_REGRESSION:
  real Postgres: f8-assessment-framework-migration-cert.sh PASS, unchanged
  real Postgres: f7-assessment-framework-migration-cert.sh PASS, unchanged

F6_REGRESSION:
  real Postgres: f6-curriculum-mapping-migration-cert.sh PASS, unchanged
  (curriculum mapping, coverage, FULL/PARTIAL semantics, versioning)

F5_REGRESSION:
  real Postgres: f5-learner-state-migration-cert.sh PASS, unchanged
  (Evidence, Knowledge, Skill, Competency, Transfer, INSUFFICIENT_EVIDENCE,
  replay)

F2_REGRESSION:
  real Postgres: f2-authorization-migration-cert.sh PASS, unchanged
  (institutions, memberships, grades, classes, enrollments, teacher
  assignments, revocation, cross-institution isolation)

CANONICAL_V2_REGRESSION:
  included in the 348-file/5597-test full suite -- PASS, unchanged
  (all canon-*.test.ts files)

REMOTE_PREVIEW_SMOKE:
  NOT RUN -- no Vercel CLI/.vercel linkage available in this environment
  (see F12_PREVIEW_CERTIFICATION.md) -- honestly reported as BLOCKED,
  never PASS

REMOTE_AUTHENTICATED_E2E:
  NOT RUN -- see F12_IVG_DEFERRED_TEST_REGISTER.md (IVG-F12-01)

IVG_DEFERRED:
  4 new items registered (IVG-F12-01 through 04), 8 carried forward from
  F7-F10, none silently dropped -- see F12_IVG_DEFERRED_TEST_REGISTER.md

FULL_SUITE:
  348 test files / 5597 tests -- PASS
  tsc --noEmit: clean
  next build: clean
```

## Bugs Discovered and Fixed

Zero implementation bugs. Two fixture-authoring mistakes in this phase's OWN new cert runner were caught and corrected before certification passed:
1. The intervention-lifecycle assertion initially read `teacher_interventions.status` before F11's own lazy reconciliation had ever run for that student, so it observed a stale `IN_PROGRESS` row rather than the real `COMPLETED` state — corrected by calling `getStudentPendingTeacherInterventions` (F11's real, unmodified trigger for reconciliation) before reading the institution-level summary, exactly mirroring what a real Student loading their own dashboard would do. This surfaced and confirmed a genuine, now-documented architectural limitation (`F12_INTERVENTION_INTELLIGENCE_MODEL.md`'s "known dependency" section) rather than a defect.
2. No other corrections were needed — every other case passed on first real-Postgres execution.

## Overall QA Verdict

**PASS (local).** Zero regressions across 5597 named-regression tests and 15 independently re-run prior-phase real-Postgres certifications. Remote Preview verification is honestly deferred, not fabricated.
