# F14 — Navigation and Route Map (Workstream I)

## Navigation changes

`src/lib/lx/learner-navigation.ts::buildLearnerNav` (PRIMARY group) gained two new items, appended after the existing Today/My Path/Progress:

```
{ key: 'examPrep', href: '/dashboard/exam-prep', labelKey: 'nav.examPrep', iconKey: 'ClipboardCheck' }
{ key: 'assignments', href: '/dashboard/assignments', labelKey: 'nav.assignments', iconKey: 'ClipboardList', badge: assignmentCount }
```

`LearnerShell.tsx`'s `ICONS` map gained the two new lucide icons (`ClipboardCheck`, `ClipboardList`); `FOCUS_MODE_PREFIXES` gained `/dashboard/assignments/practice` and `/dashboard/exam-prep/attempt` (both are active-learning-activity surfaces, exactly matching the existing rationale for `/dashboard/quiz`/`/dashboard/remediation`). No other nav config changed — Parent/Teacher/Institution nav groups (`buildParentNav`/`buildTeacherNav`/`buildInstitutionNav`, F13) are untouched.

The pre-existing `tests/unit/lx2-learner-navigation.test.ts` asserted the primary group was *exactly* 3 items; updated to assert the new 5-item list (a genuine, intentional product change, not a weakened assertion — the test still asserts an exact, ordered list).

## New/modified routes (11 new page routes, 2 new API routes, 1 modified API route)

| Route | Kind | Notes |
|---|---|---|
| `/dashboard/exam-prep` | Page | Student, new |
| `/dashboard/exam-prep/[examProfileId]` | Page | Student, new |
| `/dashboard/exam-prep/attempt/[attemptId]` | Page | Student, new |
| `/dashboard/assignments` | Page | Student, new |
| `/dashboard/assignments/practice` | Page | Student, new |
| `/dashboard/institution/[id]/grades` | Page | Institution, new |
| `/dashboard/institution/[id]/classes` | Page | Institution, new |
| `/dashboard/institution/[id]/teachers` | Page | Institution, new |
| `/dashboard/institution/[id]/coverage` | Page | Institution, new |
| `/dashboard/institution/[id]/readiness` | Page | Institution, new |
| `GET /api/quizzes/session/[quizId]` | API | New, owner-only |
| `POST /api/simulation/attempts/[id]/abandon` | API | New, owner-only, mirrors pause/resume |
| `POST /api/teacher/interventions` | API | Modified — added `EXAM_PROFILE_MISMATCH` mapping |

All 11 new page routes and 2 new API routes appear in a clean `next build` route manifest (verified — `next build` exit 0, all routes listed with the correct dynamic/static marker).

## Deep-link authorization (UI hiding is not security — verified per route)

Every new page independently re-derives the authenticated actor's own identity server-side (`auth()` → `getOrCreateStudentId`/`getOrCreateCanonicalUser`) and re-verifies ownership/access before rendering any data:

- `/dashboard/exam-prep/[examProfileId]`: `getStudentExamProfile(id)` is fetched, then explicitly checked `profile.studentId !== studentId` → `notFound()`. A Student cannot view another student's exam profile by guessing its id.
- `/dashboard/exam-prep/attempt/[attemptId]`: same pattern, `attempt.studentId !== studentId` → `notFound()`.
- `GET /api/quizzes/session/[quizId]`: `isOwner(actor.id, studentId)` + `session.studentId !== studentId` → `403`/`404`.
- `/dashboard/institution/[id]/{grades,classes,teachers,coverage,readiness}`: every one calls `getInstitutionOverview` first, which internally calls `requireInstitutionAccess` and throws `InstitutionIntelligenceAccessDeniedError` → caught → `notFound()`, exactly like F13's own 4 institution pages. No new authorization primitive was introduced.
- `/dashboard/assignments`, `/dashboard/assignments/practice`: `studentId` is always server-resolved from the authenticated actor's own identity, never accepted from the client, matching the existing `GET /api/student/teacher-interventions` route's own documented invariant ("there is no studentId for a caller to substitute").

No route in this phase trusts a client-supplied id as an authorization boundary; every one re-derives or re-checks ownership against the database on every request.
