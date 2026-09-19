# F12 — Target Institution Architecture

## Core principle, realized

```
Certified Domain Truths (F2 institutions/F5 learner state/F6 coverage/F8 diagnosis/F9 readiness/F11 interventions)
        v
Authorized Scope Resolution (src/lib/institution-intelligence/authorization.ts -- reuses F2's canAccessInstitution/canAccessClass unchanged)
        v
Institution Read/Analytics Services (src/lib/institution-intelligence/*.service.ts -- one central module, task section 9)
        v
Explainable Aggregate Metrics (MetricEnvelope -- metric_id/scope/time window/population/numerator/denominator/exclusions/data source/policy version/calculated_at/limitations, task section 10)
        v
Institution Experience (a small set of thin API routes under /api/institutions/[id]/intelligence/*, task section 37 -- "minimal enough to certify", not final UX)
```

No arbitrary UI-composed joins exist anywhere: every route calls exactly one function from `src/lib/institution-intelligence/index.ts`.

## Computed-on-read, no snapshot persistence (task section 31/32)

Every metric in this implementation is computed on read from already-materialized F5/F6/F8/F9/F11 tables. No F12-owned snapshot table exists. This was a deliberate choice, not an oversight: the certified local performance baseline (`F12_PERFORMANCE_BASELINE.md`) shows sub-2ms roster/learning aggregates at a 50-learner synthetic scale, well within "prefer computed-on-read for initial truth if performance allows" (task section 31). If a future phase's real-scale performance characterization shows this no longer holds, a snapshot table should carry `scope`/`metric policy version`/`source versions`/`time window`/`calculated_at` and remain explicitly derived data, never a new academic-truth store (documented as a residual, not built speculatively now).

## The one schema addition, and why it's the only one

`institution_analytics_policy_versions` (task section 27/38) — versioned governance for cohort-suppression thresholds, mirroring F5/F8/F9's own `aggregation_policy_versions`/`diagnostic_policy_versions`/`readiness_policy_versions` idiom exactly. Seeded with zero rows (no invented production threshold). No other schema was added: learner state, readiness, coverage, diagnosis, and interventions are read directly from their existing, certified tables (task section 38's own explicit prohibition on duplicating them).

## Module layout

```
src/lib/institution-intelligence/
  authorization.ts      -- requireInstitutionAccess / requireClassInInstitution / requireLearnerInInstitution
  policy.service.ts     -- getActiveAnalyticsPolicy / applyCohortSuppression (small-cohort governance)
  types.ts               -- MetricEnvelope, AnalyticsScope, TimeWindow, pagination helpers
  roster.service.ts      -- getInstitutionOverview / getInstitutionGrades / getInstitutionClasses / getInstitutionTeachers
  learning.service.ts    -- getInstitutionLearnerSummary / getClassLearningSummary / getLearnerDrillDown
  coverage.service.ts    -- getInstitutionCoverage (F6)
  readiness.service.ts   -- getInstitutionReadiness (F9)
  diagnostics.service.ts -- getInstitutionDiagnosticSummary (F8)
  interventions.service.ts -- getInstitutionInterventionSummary / getTeacherOperationalSummary (F11)
  attention.service.ts   -- getInstitutionAttentionAreas (deterministic, cites its own source metrics)
  index.ts                -- the single barrel every route/consumer imports from
```

## API surface (minimal, task section 37)

```
GET /api/institutions/[id]/intelligence/overview
GET /api/institutions/[id]/intelligence/grades
GET /api/institutions/[id]/intelligence/classes[?gradeId=&limit=&offset=]
GET /api/institutions/[id]/intelligence/classes/[classId]/summary
GET /api/institutions/[id]/intelligence/teachers[?limit=&offset=]
GET /api/institutions/[id]/intelligence/learners[?classId=]
GET /api/institutions/[id]/intelligence/learners/[studentId]
GET /api/institutions/[id]/intelligence/coverage?structureVersionId=
GET /api/institutions/[id]/intelligence/readiness?examVersionId=[&classId=]
GET /api/institutions/[id]/intelligence/interventions[?classId=&interventionType=&sinceDays=]
GET /api/institutions/[id]/intelligence/attention-areas[?classId=]
```

Every route resolves the actor server-side (`verifyAuth` + `getOrCreateCanonicalUser`) and delegates authorization entirely to the service layer — no route contains its own authorization logic. No dashboard UI page was built in this phase (task section 37: "Functional truth > visual polish" — the read model and its real-Postgres certification are the actual deliverable; a UI page would be F13/F14 work).

## Zero new authority (INV-F12-22)

No new Teacher, Parent, Curriculum, Assessment, or Learner-State authority exists anywhere in this module — every non-roster fact is read from F5/F6/F8/F9/F11's own tables/services, never recomputed or reinterpreted.
