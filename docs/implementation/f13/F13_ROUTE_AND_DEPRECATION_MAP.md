# F13 — Route and Deprecation Map

Task section 28/51. No route was removed or redirected this phase — F13 was purely additive at the routing level (new routes only).

## New routes (this phase)

| Route | Auth | Notes |
|---|---|---|
| `GET /dashboard/teacher` | Server-resolved actor, re-checked in `getTeacherAssignedClasses` | Zero-length result is valid |
| `GET /dashboard/teacher/classes/[classId]` | Re-checked in `getTeacherClassRoster` | `notFound()` on denial |
| `GET /dashboard/teacher/students/[studentId]` | Re-checked in `getTeacherStudentOverview`/`listTeacherInterventionsForStudent` | `notFound()` on denial |
| `GET /dashboard/institution` | Server-resolved actor, `getAdministeredInstitutions` | Redirects to the single institution if exactly one |
| `GET /dashboard/institution/[institutionId]` | Re-checked in `getInstitutionOverview` | `notFound()` on denial |
| `GET /dashboard/institution/[institutionId]/learners` | Re-checked in `getInstitutionLearnerSummary` | Handles `NoActiveAnalyticsPolicyError` distinctly |
| `GET /dashboard/institution/[institutionId]/interventions` | Re-checked in `getInstitutionInterventionSummary` | |
| `GET /dashboard/institution/[institutionId]/attention` | Re-checked in `getInstitutionAttentionAreas` | |
| `GET /api/institutions/mine` | `verifyAuth` | New roster read, task-necessitated (see `F13_INSTITUTION_EXPERIENCE.md`) |

## Modified routes (schema fix, not a new route)

| Route | Change |
|---|---|
| `POST /api/teacher/interventions` | Added the missing `EXAM` target Zod branch (a real gap found and fixed, see `F13_CURRENT_UX_ARCHITECTURE_ASSESSMENT.md`) — behavior for existing CONCEPT/SKILL/COMPETENCY/LEARNING_OBJECTIVE callers is byte-identical |

## Legacy routes retained (task section 51)

| Route | Current consumer | Replacement | Status | Deprecation path |
|---|---|---|---|---|
| `GET /api/exam-readiness/score` | `assessment-verification.service.ts` (indirectly), no UI | F9's `readiness_snapshots`/`computeReadinessSnapshot` (already the certified replacement, just not yet wired to whatever this route's own callers need) | `RETAIN_TEMPORARILY` | F14: re-verify `assessment-verification.service.ts`'s real dependency, then migrate or retire |
| `dashboard/parent/page.tsx`'s `examReadiness` display | Parent UI (live) | A future F9-aware Parent readiness summary (does not exist yet) | `REQUIRES_F14_MIGRATION` | See `F13_LEGACY_UX_CONTAINMENT.md` |

## No obsolete duplicate routes found to eliminate

Confirmed by inspection: no duplicate Student dashboard route, no duplicate progress/readiness route exists in this codebase (see `F13_CURRENT_UX_ARCHITECTURE_ASSESSMENT.md`) — there was nothing obsolete-and-safe-to-remove to act on this phase.
