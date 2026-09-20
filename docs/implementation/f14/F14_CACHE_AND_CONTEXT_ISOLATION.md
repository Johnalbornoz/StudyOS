# F14 — Cache and Context Isolation

## Architecture (unchanged from F13, extended to new surfaces)

Every new F14 page is a Next.js Server Component that re-runs its own data fetch fresh on every request — none of them cache authorization-sensitive data in a module-level variable, a React context provider, or browser storage. Client Components introduced this phase (`StartSimulationPanel`, `AttemptControls`, `StartAssignmentButton`, `PracticeRunner`) hold only transient, per-interaction UI state (form field values, a submitting/loading flag, a fetched question set for the *current* quizId prop) — none of them persist data across a navigation or a different quizId/interventionId/institutionId.

## Specific transitions checked

- **Teacher → Parent → Institution (workspace switch)**: unchanged from F13 — `WorkspaceSwitcher` POSTs to `/api/identity/workspace`, then `router.push` + `router.refresh()`, forcing every Server Component (including all new F14 pages) to re-resolve from scratch. No F14 page reads workspace/role state from anything other than the layout's own server-resolved props.
- **Parent child A → child B**: the Parent page already scopes every fetch by `studentId` in the URL/query string (`/api/parent/child-overview?studentId=`, and this phase's new `/api/parent/learners/${studentId}/exam-prep`); switching which child's card is being read never reuses another child's fetched data — each child's `examPrep[child.studentId]` entry is keyed independently in the page's own state object.
- **Institution context A → institution context B**: every new Institution page takes `institutionId` from the URL path segment and re-verifies `requireInstitutionAccess` on every request; there is no institution-scoped client cache anywhere in this phase's code to go stale.
- **Student → other workspace and back**: the Assignments/Exam-Prep pages are Student-only (STUDENT workspace); switching away and back re-runs `getOrCreateStudentId`/`getStudentExamProfile`/`getStudentPendingTeacherInterventions` fresh, same as every other Student page.
- **Assignment start → practice → back to Assignments list**: `PracticeRunner` fetches the quiz session fresh on mount from its `quizId` prop (no cross-quiz cache); the Assignments list re-fetches `getStudentPendingTeacherInterventions` (which itself runs `reconcileCompletionsForStudent`) on every page load, so a just-completed practice's status is never stale on return.

## What was NOT assumed to be sufficient on its own

Per this task's own explicit caution ("Do not assume `router.refresh()` alone solves every possible cache"), each new client-side fetch was individually checked for scoping:
- `StartSimulationPanel`/`StartAssignmentButton`/`AttemptControls` issue a `fetch()` per action and either `router.push()` to a new URL (forcing a fresh Server Component render of the destination) or `router.refresh()` in place — none of them hold a `useState` cache that survives past their own component's props changing.
- `PracticeRunner`'s `useEffect([quizId, studentId])` re-fetches whenever either prop changes — it cannot serve a stale question set for a different quizId.
- No `localStorage`/`sessionStorage`/IndexedDB usage exists anywhere in this phase's new code (grep-confirmed).
- No query/data-fetching library (React Query, SWR, etc.) is used anywhere in this codebase — confirmed absent from `package.json` — so there is no library-level cache layer to reason about beyond Next.js's own server-render-per-request model and the explicit `router.refresh()` calls already audited.

## Residual (unchanged from F13, not worsened)

Live, two-session cache-isolation demonstration (revoke a membership in one session, confirm the next request in another session is denied) remains unproven in a live environment for the same reason as F13 — no safe authenticated test environment. The architectural guarantee (no client cache exists to go stale) is unchanged and, if anything, extended by identical construction to every new surface. Registered as `IVG-F13-05`, carried forward, not re-numbered.
