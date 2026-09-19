# F12 — Institution Read Model

The central, and only, read surface for institution-level intelligence (task section 9). Conceptual contracts and their real implementations:

| Conceptual contract | Real function | File |
|---|---|---|
| `getInstitutionOverview(actor, institutionId)` | `getInstitutionOverview` | `roster.service.ts` |
| `getInstitutionGrades(actor, institutionId)` | `getInstitutionGrades` | `roster.service.ts` |
| `getInstitutionClasses(actor, institutionId)` | `getInstitutionClasses` (paginated, filterable by `gradeId`) | `roster.service.ts` |
| `getInstitutionTeachers(actor, institutionId)` | `getInstitutionTeachers` (paginated) | `roster.service.ts` |
| `getInstitutionLearnerSummary(actor, institutionId, filters)` | `getInstitutionLearnerSummary` (filterable by `classId`) | `learning.service.ts` |
| `getClassLearningSummary(actor, classId)` | `getClassLearningSummary(actor, institutionId, classId)` | `learning.service.ts` |
| `getInstitutionCoverage(actor, institutionId, academicContext)` | `getInstitutionCoverage(actor, institutionId, { structureVersionId })` | `coverage.service.ts` |
| `getInstitutionReadiness(actor, institutionId, examContext)` | `getInstitutionReadiness(actor, institutionId, { examVersionId, classId? })` | `readiness.service.ts` |
| `getInstitutionInterventionSummary(actor, institutionId, filters)` | `getInstitutionInterventionSummary` (filterable by `classId`/`interventionType`/`sinceDays`) | `interventions.service.ts` |
| `getInstitutionAttentionAreas(actor, institutionId, filters)` | `getInstitutionAttentionAreas` (filterable by `classId`) | `attention.service.ts` |

Plus two entry points the task's own worked examples require but did not name explicitly: `getLearnerDrillDown(actor, institutionId, studentId)` (`learning.service.ts`) and `getTeacherOperationalSummary(actor, institutionId, membershipId)` (`interventions.service.ts`).

## Every entry point resolves authorization server-side, first

Every function above calls `requireInstitutionAccess`/`requireClassInInstitution`/`requireLearnerInInstitution` as its OWN first action — never trusting a caller (including the thin API route wrappers) to have checked anything, matching the exact defense-in-depth discipline F11's `start*ReinforcementExecution` functions established.

## No arbitrary UI-composed joins

The 11 API routes under `/api/institutions/[id]/intelligence/*` each call exactly one function from `src/lib/institution-intelligence/index.ts` and return its result verbatim (wrapped by a shared `respondFromService` helper that only translates known denial/not-found errors to HTTP status codes) — no route contains its own SQL.
