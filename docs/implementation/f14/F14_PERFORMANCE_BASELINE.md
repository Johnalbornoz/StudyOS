# F14 — Performance Baseline

## What could be measured safely in this environment

No safe, authenticated live environment exists this phase (see F14_ENVIRONMENT_PROVENANCE_REPORT.md), so real TTFB/navigation-latency/workspace-switch timing could not be measured against seeded, realistic data. This is disclosed as `IVG-F14-05`, mirroring F13's own `IVG-F13-06` precedent — never fabricated as a measured number.

## Query-shape characterization (static, by source inspection)

Every new page issues a small, fixed number of queries per request, no per-row loops:

- `/dashboard/exam-prep`: `listStudentExamProfiles` (1 query) + per-profile `getExamDefinition` (1 query each) + `getLatestReadinessSnapshot` (1 query each) via `Promise.all` — O(n) in the number of the Student's own Exam Profiles, which is a small, self-bounded set (a Student manages their own few profiles, never an unbounded list).
- `/dashboard/exam-prep/[examProfileId]`: a fixed ~5 queries (`getStudentExamProfile`, `getExamDefinition`, `getExamVersion`/`getPublishedExamVersion`, `getLatestReadinessSnapshot`, two `getSimulationEligibility` calls) — constant per page view, not scaling with any collection size.
- `/dashboard/assignments`: `getStudentPendingTeacherInterventions` — already bounded by `WHERE status IN ('ASSIGNED','IN_PROGRESS')` (F11-C1, unchanged), plus its own internal `reconcileCompletionsForStudent` reconciliation loop, which only iterates the Student's own currently-`IN_PROGRESS` rows (typically zero or very few).
- `/dashboard/institution/[id]/{classes,teachers}`: already paginated server-side (`clampPagination`, max 100/page) — bounded regardless of institution size, unchanged F12 behavior.
- `PracticeRunner`/`GET /api/quizzes/session/[quizId]`: one `getQuizSession` read (single row by primary key) — O(1).

No new N+1 query pattern was introduced; every list-producing function reused this phase already applies the same `Promise.all`/single-set-based-query discipline F12/F13 established.

## Bundle-size characterization

`next build`'s own route manifest reports each new page's own JS chunk size (visible in the build output); no new page pulls in a new third-party dependency — every new Client Component (`StartSimulationPanel`, `AttemptControls`, `StartAssignmentButton`, `PracticeRunner`) uses only React + `next/navigation`, no new npm package was added to `package.json` this phase (confirmed: `git diff` shows no `package.json`/`package-lock.json` change).

## Baseline this phase actually confirms

- `npx vitest run`: 350 files / 5614 tests in ~7-9 seconds locally (up from F13's 349/5604 in a comparable window) — no meaningful regression in suite runtime.
- `next build`: completes successfully with no new build-time warnings beyond pre-existing ones.
- 16/16 real-Postgres regression scripts (unchanged from F13's own set) each complete within their own ephemeral-instance lifecycle without timeout — no F14 change altered any of their runtime characteristics (none of F14's own new code is exercised by these scripts, which cover F2/F5/F6/F7/F8/F9/F10/F11/F12's own domains).

## Not established this phase (deferred, not fabricated)

Real p50/p95 navigation latency, workspace-switch latency, and Institution dashboard load time under realistic seeded data volumes remain unmeasured. `IVG-F14-05`.
