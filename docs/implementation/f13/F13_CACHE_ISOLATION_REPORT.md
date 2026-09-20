# F13 — Cache Isolation Report

Task section 36 -- explicitly critical. Every claim below is architectural (verified by direct code reading of what fetches what and when), not a live multi-session browser test (the same safe-testing-environment limitation as elsewhere in this phase applies to a LIVE demonstration; the architecture itself is real and independently verifiable).

## No client-side cache of authorization-sensitive data exists anywhere new in this phase

Every new page (`teacher/*`, `institution/*`) is a Next.js Server Component that calls its service function fresh on every request — there is no `useState`/`useSWR`/React Query/localStorage/sessionStorage caching of Teacher/Institution data anywhere in the new surfaces (confirmed: none of the new files import any client-cache library, and only two files are `'use client'` at all — `WorkspaceSwitcher` and `AssignInterventionForm` — neither of which caches server data, both of which only hold local UI-interaction state: which target type is selected, whether a submit is in flight).

## Role switch (task section 36, INV-F13-02/03)

`WorkspaceSwitcher`'s switch handler does `router.push(newHomeHref)` then `router.refresh()` — `refresh()` explicitly invalidates the Next.js Router Cache for the current route tree and re-fetches every Server Component, INCLUDING `dashboard/layout.tsx` itself, which re-runs `resolveAvailableWorkspaces`/`getActiveWorkspace` from the database on that very next render. There is no code path where a prior role's nav groups or page content could survive a switch — the shell that renders after the switch is a completely fresh server render, not a client-side re-render of stale props.

## Parent child switch (task section 36) — unaffected by F13, already correct

The existing Parent page never held a single "current child" — it fetches and renders EVERY accepted child's overview independently, keyed by `studentId` in a `Record`. There is no "switch" operation to leak state during; this was already correct before F13 (re-verified structurally in this phase's own inspection, not changed).

## Teacher student switch / Institution scope switch (task section 36)

Navigating from one student/class/institution to another is a plain Next.js route change (`/dashboard/teacher/students/[studentId]` with a different `studentId`, `/dashboard/institution/[institutionId]/...` with a different `institutionId`) — each is a fresh Server Component render with fresh `params`, fresh authorization checks, and fresh data. No client-side store persists the PREVIOUS student/institution's data across this navigation (none exists to persist it in).

## Authorization revoke (task section 36) — architecturally guaranteed, re-verified by regression

Because every new page independently re-verifies authorization on every server render (never trusting a cached "yes" from a prior request), a revoked Teacher assignment or institution membership is respected on the very next navigation to any affected page — this is the exact same guarantee F11/F12's own real-Postgres regressions already re-certified unchanged in this phase (a revoked membership denies access on the next `canAccessInstitution`/`canAccessClass`/`canTeacherAccessLearner` call, which is EVERY call, since none of these results are cached).

## What was not live-tested this phase

A live, two-tab or two-session browser demonstration of "revoke in tab A, refresh in tab B, access denied" — the architecture guarantees this (no cache exists to go stale), but it was not demonstrated with a live authenticated browser session in this environment (see `F13_PREVIEW_CERTIFICATION.md`). Registered as `IVG-F13-05`.
