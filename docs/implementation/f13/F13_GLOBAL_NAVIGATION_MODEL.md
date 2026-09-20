# F13 — Global Navigation Model

## One shell, one rendering path (task section 6/28)

`LearnerShell` is the ONLY navigation-rendering component in the authenticated app. Every workspace's nav is a `LearnerNavGroup[]` (the exact same TypeScript shape `learner-navigation.ts` already defined) — `buildLearnerNav`/`buildParentNav`/`buildTeacherNav`/`buildInstitutionNav` are four pure functions returning this one shape; `dashboard/layout.tsx` picks exactly one based on the resolved active workspace and resolves its labels via the existing i18n `getMessages(locale)` call, identically for every workspace.

## Routing discipline (task section 28)

Every new route (`/dashboard/teacher/*`, `/dashboard/institution/*`, `GET /api/institutions/mine`) follows the SAME pattern every certified F7-F12 route already uses: resolve the authenticated actor via Clerk (`auth()`/`verifyAuth()`), resolve the canonical user, call a service function that independently re-verifies authorization, and translate a known denial error into `notFound()`/`403`. UI route existence or hiding is never the security boundary — a denied server-side check is what actually blocks access, verified by the adversarial matrix already re-certified in this phase's regression run (F11/F12's own).

## Deep links (task section 29)

- `/dashboard/teacher/classes/[classId]` and `/dashboard/teacher/students/[studentId]` both re-verify the actor's REAL teacher relationship to that exact class/student on every load — a forged/foreign id renders `notFound()`, identical to a route that never existed (task section 40: never leak existence of an inaccessible resource via a different error shape).
- `/dashboard/institution/[institutionId]/*` re-verifies the actor's REAL, APPROVED `INSTITUTION_ADMIN` membership to that exact institution on every load, identically.
- Unauthenticated deep links to any `/dashboard/*` route redirect to `/sign-in` (existing Clerk-based behavior, unchanged).

## Breadcrumbs / context (task section 30)

`PageHeader`'s `breadcrumb` slot renders one level of "where did I come from" context: Teacher's Student Detail page shows "back to this Class" when reached via a class roster link (carrying `classId` as a query param — routing context only, never an authorization grant) or "back to My Classes" otherwise; Institution's sub-pages render a persistent `InstitutionSubNav` (Overview / Learners / Interventions / Attention Areas) so the institution identity never needs re-selecting mid-drill-down.
