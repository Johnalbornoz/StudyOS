# F15 — Cache and Context Isolation

Extends F13/F14's own architecture (unchanged) to the new F15 surfaces; re-verified by code reading, not live (same blocker as every other live check this phase — see F15_AUTHENTICATED_E2E_REPORT.md).

## Architecture (unchanged)

Every new F15 page/route is either a Server Component that re-fetches fresh on every request, or a thin Client Component holding only transient, per-interaction state (the current pending question, a submitting flag). None of `ItemRunner`, `QuestionAnswerFields`, or the new `next-item` route's client callers cache authorization-sensitive data across a navigation or a different `attemptId`/`studentId`.

## Specific transitions re-checked this phase

- **Student → Teacher → Parent → Institution (workspace switch)**: unchanged mechanism (`router.refresh()` + full server re-resolution); the new Exam-Taking surface is Student-workspace-only and re-derives `studentId` fresh via `getOrCreateStudentId` on every page load, same as F14's own Exam Prep pages.
- **A different attempt's item never leaks into another attempt's `ItemRunner`**: `ItemRunner` keys all of its fetches off the `attemptId` prop from the URL path segment; there is no cross-attempt client cache (verified by code reading — `useEffect`/`useCallback` dependencies are scoped to `attemptId`).
- **`navigation_state`'s new pending-question field is itself attempt-scoped, server-side, in the database** — not a client cache at all, and not readable by any other attempt or any other student (enforced by `isOwner` on every read, per F15_EXAM_SESSION_INTEGRITY.md).
- **Institution context (Grades/Classes/Teachers/Coverage/Readiness)**: unchanged from F14 — every page re-derives `institutionId` from the URL and re-verifies `requireInstitutionAccess` on every request; the MIN_COHORT_POLICY suppression decision is computed fresh per request (server-side `getActiveAnalyticsPolicy` + `applyCohortSuppression`), never cached client-side.

## What was NOT assumed sufficient on its own (per this task's own caution, inherited from F14)

No `localStorage`/`sessionStorage`/IndexedDB usage exists anywhere in the new F15 code (grep-confirmed, same as F14's own finding). No query/data-fetching library is used anywhere in this codebase (confirmed absent from `package.json`, unchanged).

## Residual

Live, two-session cache-isolation demonstration remains unproven live (carried from F13's own `IVG-F13-05`, unchanged in status, now also covering the new Exam-Taking surface by identical construction).
