# ADR-F15: MIN_COHORT_POLICY

Status: **RESOLVED** (was `IVG-F12-04: OPEN_DECISION`, carried through F13/F14)

## Problem

F12 built `institution_analytics_policy_versions` (a real, versioned, `RETIRED`/`ACTIVE` table with a partial unique index enforcing at most one `ACTIVE` row) but deliberately seeded it with **zero rows**, so that `getActiveAnalyticsPolicy()` throws `NoActiveAnalyticsPolicyError` and every cohort-dependent aggregate fails closed rather than silently using an invented privacy threshold. This was the correct move for F12 (a phase explicitly told not to invent a production policy), but it left every Institution cohort-aggregate page (Learners, Readiness, and — as this ADR's own investigation found — two more that should have been suppressed and weren't) permanently unusable in any real institution, since no `ACTIVE` policy has ever existed.

## Scope: every metric affected by cohort-size sufficiency (found by inspection, not assumed)

| Metric | Function | File | Aggregates over | Suppression before F15 | Decision |
|---|---|---|---|---|---|
| Individual learner drill-down | `getLearnerDrillDown` | `learning.service.ts` | ONE already-individually-authorized learner | N/A | **NOT_APPLICABLE** — not a cohort aggregate |
| Institution/Class learning-state distribution | `getInstitutionLearnerSummary`, `getClassLearningSummary` | `learning.service.ts` | Concept/Skill/Competency state per active learner | Applied | **Unchanged** — correct |
| Institution/Class readiness distribution | `getInstitutionReadiness` | `readiness.service.ts` | F9 readiness snapshot per active learner | Applied | **Unchanged** — correct |
| Diagnostic gap-type distribution | `getInstitutionDiagnosticSummary` | `diagnostics.service.ts` | Latest F8 diagnosis per active learner | **NOT applied** | **FIXED this phase** — same re-identification risk class as Learning/Readiness |
| Intervention status/type distribution | `getInstitutionInterventionSummary` | `interventions.service.ts` | `teacher_interventions` rows, by distinct `student_id` | **NOT applied** | **FIXED this phase** — a small class's intervention status breakdown can reveal one student's specific outcome |
| Teacher operational counts | `getTeacherOperationalSummary` | `interventions.service.ts` | ONE already-individually-authorized teacher's own counts | N/A | **NOT_APPLICABLE** — not a learner-outcome cohort aggregate |
| Institution overview counts | `getInstitutionOverview` | `roster.service.ts` | Structural totals (teacher/class/enrollment counts) | N/A | **NOT_APPLICABLE** — a population *count* reveals nothing about any individual's academic state, unlike a *distribution* |
| Grades/Classes/Teachers roster | `getInstitutionGrades/Classes/Teachers` | `roster.service.ts` | Structural roster facts + operational counts (`activeEnrollmentCount` etc.) | N/A | **NOT_APPLICABLE** — same reasoning as Overview |
| Curriculum coverage | `getInstitutionCoverage` | `coverage.service.ts` | A curriculum structure version (F6) — never touches per-student data | N/A | **NOT_APPLICABLE** — genuinely institution-independent, not a learner cohort at all |
| Attention Areas | `getInstitutionAttentionAreas` | `attention.service.ts` | Cites the above metrics' own numbers | Already deferred to `learning`'s suppression; **did not** defer to diagnostics/interventions | **FIXED this phase** — now also skips a check whose underlying metric is suppressed |

## Decision

Seed `institution_analytics_policy_versions` with a real, ACTIVE, versioned policy:

```json
{ "minimumCohortSize": 10 }
```

via `database/migrations/20261010_1000_f15_min_cohort_policy.sql`, the exact same seeding pattern every other `*_policy_versions` table in this codebase already uses (`readiness_policy_versions`, `diagnostic_policy_versions`, `coverage_policy_versions`, `intervention_policy_versions`, `aggregation_policy_versions`).

## Threshold rationale

**10** is not arbitrary:
- **Privacy/statistical rationale**: small-group/cell suppression at n<10 is a widely-used, defensible convention in education-data reporting (the pattern many U.S. state education agencies and FERPA-aligned aggregate-reporting guidance use for subgroup disclosure) — a distribution over fewer than 10 individuals risks letting a viewer infer one specific student's outcome (e.g., "1 of 3 students is WEAK" identifies that student to anyone who also knows the roster).
- **Practical rationale for a pilot**: a typical single class (15–30 students) or grade level clears this threshold and still shows real, useful aggregate data; only a genuinely tiny group (a brand-new class, a small elective, a partially-enrolled pilot cohort) is suppressed — which is exactly the case where suppression matters most.

## Which metrics use it

Exactly the four listed "Applied"/"FIXED this phase" rows above: Learning, Readiness, Diagnostics, Interventions. Never Overview, roster listings, Coverage, individual drill-downs, or Teacher operational counts — those either aren't cohort-outcome aggregates or are already individually-authorized single-record views.

## Is the threshold configurable?

Yes, by design — it is a versioned row (`institution_analytics_policy_versions`), not a hard-coded constant. A future, higher-confidence value can be introduced as version 2 (retiring version 1) without any code change, exactly like every other `*_policy_versions` table in this codebase already supports.

## UI semantics (unchanged from F12's own existing design, now actually reachable)

`SuppressibleAggregate<T> = {suppressed: false, ..., value: T} | {suppressed: true, ..., reason: 'SMALL_COHORT'}` — never `0`, `null`, or `false` overloaded to mean "suppressed." The existing `EmptyState` rendering (`institution.learners.suppressedSmallCohort` / `empty.smallCohortSuppressed`) is unchanged; it was simply unreachable in its "not suppressed" branch before this ADR, since no ACTIVE policy ever existed to evaluate against.

## API semantics

Unchanged: `getActiveAnalyticsPolicy()` still throws `NoActiveAnalyticsPolicyError` if the ACTIVE row is ever removed (defense in depth — every consuming page still handles this explicitly), and `applyCohortSuppression()` is still the single disclosure-control choke point every metric goes through.

## Fallback behavior

If the migration has not yet been applied to a given database (e.g. an out-of-date Preview), every cohort-dependent page continues to fail closed exactly as before (`NoActiveAnalyticsPolicyError` → the existing OPEN_DECISION empty state) — never a silent, unprotected disclosure.

## Tests

`tests/unit/f15-min-cohort-policy.test.ts` (7 tests): boundary behavior of `applyCohortSuppression` itself (below/at/zero), and both real gaps this ADR fixed (`getInstitutionDiagnosticSummary`, `getInstitutionInterventionSummary`) suppressing/not-suppressing correctly at the policy boundary, fully deterministic (mocked `db`/policy, no real Postgres required). The real-Postgres `f12-institution-intelligence-cert-runner.ts` script was updated to install its own explicit, smaller TEST POLICY (retiring the real migrated one for the duration of that script's ephemeral database) so its own fixture cohort sizes remain meaningful regardless of the real product threshold.

## Future scalability

The frontend never independently determines cohort sufficiency — every suppression decision is made once, server-side, in `applyCohortSuppression`, and rendered verbatim. If a future phase needs per-metric-type thresholds (e.g. a stricter threshold for Readiness than for Interventions), `rules` is a `jsonb` blob and can grow additional keys in a new policy version without a schema migration.
