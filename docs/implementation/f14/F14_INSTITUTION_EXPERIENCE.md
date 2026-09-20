# F14 — Institution Experience Completion (Workstream D)

## Backend verification before implementation

Direct inspection of `src/lib/institution-intelligence/` found all five requested surfaces already fully implemented and certified (F12), contrary to the task's own framing that Coverage/Readiness "need a real backend gap filled first":

| Surface | Function | File |
|---|---|---|
| Grades | `getInstitutionGrades(actorUserId, institutionId)` | `roster.service.ts` |
| Classes | `getInstitutionClasses(actorUserId, institutionId, {gradeId?}, pagination?)` | `roster.service.ts` |
| Teachers | `getInstitutionTeachers(actorUserId, institutionId, pagination?)` | `roster.service.ts` |
| Coverage | `getInstitutionCoverage(actorUserId, institutionId, {structureVersionId})` | `coverage.service.ts` |
| Readiness | `getInstitutionReadiness(actorUserId, institutionId, {examVersionId, classId?})` | `readiness.service.ts` |

All five were already exported from the module's own barrel (`src/lib/institution-intelligence/index.ts`) — no backend or barrel change was needed. This phase's actual work was five new UI pages plus extending `InstitutionSubNav` from 4 to 9 tabs.

## What was built

- `/dashboard/institution/[id]/grades` — list with each grade's real class count, linking into Classes filtered by grade.
- `/dashboard/institution/[id]/classes` — paginated (`clampPagination`/`DEFAULT_PAGE_SIZE`, the same bounding F12 already enforces server-side), optional `?gradeId=` filter, Prev/Next via plain links (no client JS).
- `/dashboard/institution/[id]/teachers` — paginated roster with `activeAssignmentCount`/`activeLearnerCount` only — **no score, no ranking** (the backend function's own docstring: "No score, no ranking (task section 23) — purely a roster with operational counts"). Displays the teacher's raw canonical `userId` (the backend has no display-name join) — a disclosed, real limitation, not fabricated.
- `/dashboard/institution/[id]/coverage` — a plain `<form method="GET">` (zero client JS) collecting a `structureVersionId`, then rendering `mappingCoverage`/`contentCoverage` via `MetricCard` with each metric's own `population.description`/`limitations`.
- `/dashboard/institution/[id]/readiness` — same GET-form pattern for `examVersionId` (+ optional `classId`), rendering the cohort's `overallStatusDistribution` and `dimensionStatusDistribution` via `StatusBadge`. Handles `NoActiveAnalyticsPolicyError` (MIN_COHORT_POLICY: OPEN_DECISION) and a suppressed cohort exactly like the existing Learners page — never a fabricated threshold.

## Why a raw-ID GET form for Coverage/Readiness, not a dropdown picker

No backend function exists anywhere in this codebase to *list* an institution's curriculum structure versions or exam versions for a picker to populate — a real, disclosed backend gap (registered as `IVG-F14-02`), distinct from the coverage/readiness *computation* itself, which is fully real. This mirrors the exact precedent F13's own Teacher `AssignInterventionForm` already established for `TOPIC_EXAM`/`DOMAIN_EXAM` (`learningObjectiveId`/`academicSubjectId` as raw text inputs) — consistency was chosen over inventing a one-off picker UI backed by nothing.

## Coverage vs. Readiness vs. Mastery — never conflated

`getInstitutionCoverage`'s own code comment states its numbers describe "StudyUS's platform/content completeness for a curriculum structure... the SAME regardless of which institution is asking" (F6, curriculum/content coverage) — deliberately distinct from per-student blueprint evidence coverage (F9, inside a `ReadinessSnapshot`) and from learner Mastery (F5). This phase's two pages render these on **separate pages** with **separate labels**, never summed or cross-referenced into one number, matching the invariant verbatim.

## Verification

`tsc --noEmit` clean; `next build` clean; `tests/unit/f14-experience-completion-source-guard.test.ts` confirms none of the five new pages perform a direct SQL write or call a Mastery/Readiness/Coverage computation function themselves.
