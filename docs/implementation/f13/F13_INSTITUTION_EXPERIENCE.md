# F13 — Institution Experience

## Built from zero UI onto an already-real, certified backend (task section 19)

Before F13, F12's entire read model (`src/lib/institution-intelligence/*`) had 11 real, certified API routes and **zero consuming UI**. F13 builds:

```
/dashboard/institution                                    -- picker (getAdministeredInstitutions, NEW) or redirect if exactly one
/dashboard/institution/[institutionId]                     -- Overview (getInstitutionOverview)
/dashboard/institution/[institutionId]/learners            -- Learning intelligence + evidence sufficiency (getInstitutionLearnerSummary)
/dashboard/institution/[institutionId]/interventions       -- Status/type distribution (getInstitutionInterventionSummary)
/dashboard/institution/[institutionId]/attention           -- Attention areas (getInstitutionAttentionAreas)
```

Every page calls F12's real service functions directly and independently re-verifies authorization inside them (`requireInstitutionAccess` etc.) — the pages perform no authorization decision themselves.

## A real, necessary read F12 never provided

F12's own read model has no "which institutions am I an admin of" roster lookup (it assumes an authorized `institutionId` is already known) — F13 added `getAdministeredInstitutions(userId)` (`src/services/institution.service.ts`) and `GET /api/institutions/mine`, a pure roster read scoped to the caller's own id, mirroring `getTeacherAssignedClasses`'s own exact precedent. It grants nothing itself; every institution it lists is still independently re-authorized by every subsequent page/call.

## No Teacher ranking/quality score (task section 19, structurally guarded)

Confirmed: no institution page renders anything resembling a Teacher performance comparison — `getInstitutionTeachers`/`getTeacherOperationalSummary` exist and are certified but are not yet wired into a page this phase (see below); when they are, they must render ONLY the same operational counts F12 already exposes, never a ranking (structurally guarded by `f13-ux-consolidation-source-guard.test.ts`'s Teacher-quality regex, which also covers any future Institution-side Teacher-list page).

## Metric context, not bare numbers (task section 20)

`MetricCard` renders `population.description`/`limitations` alongside every value — e.g. the Overview's "Classes" card visibly states "classes has no status column in the current schema" (F12's own documented limitation, rendered verbatim, never hidden).

## Small-cohort UX (task section 21, INV honored)

The Learners page explicitly branches on F12's own `cohort.suppressed`/`NoActiveAnalyticsPolicyError` outcomes: a suppressed cohort renders `institution.learners.suppressedSmallCohort` (never a fabricated aggregate); a completely absent policy (fresh/Production database) renders a distinct "MIN_COHORT_POLICY: OPEN_DECISION" empty state — the TEST POLICY value F12's own certification uses is never promoted into this UI as if it were a real product default (it exists only inside the ephemeral certification database).

## What was deliberately not built this phase (documented, not silently dropped)

Grades/Classes/Teachers roster pages, Coverage, Readiness — see `F13_INFORMATION_ARCHITECTURE.md` for the exact reasons (time and, for Coverage/Readiness, a genuine missing "pick a context" selector dependency, not a difficulty in the metric itself). All four underlying F12 functions are real, certified, and ready to wire into a page using the identical pattern already established here.

## Cross-institution isolation (task section 48, AC-F13-08/20)

Re-verified by regression: F12's own real-Postgres cross-institution adversarial matrix (Institution A admin → Institution B DENY, revoked membership DENY, Teacher-alone DENY, Parent DENY, multi-role DENY) re-ran unchanged in this phase.
