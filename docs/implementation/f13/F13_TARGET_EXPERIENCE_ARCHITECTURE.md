# F13 — Target Experience Architecture

## Principle realized

```
Certified Domain Truths (F1 identity/roles/workspace, F2 authorization, F5 evidence/state,
                          F6 coverage, F7/F8 assessment/diagnosis, F9 readiness, F11 interventions, F12 institution intelligence)
        v
ONE shell (LearnerShell), workspace-resolved server-side every request (F1's resolveAvailableWorkspaces/getActiveWorkspace)
        v
Role-specific nav-group builders (learner-navigation.ts / workspace-navigation.ts) -- pure data, no auth decision
        v
Role-specific pages, each independently re-authorized server-side by the service it calls
        v
Shared presentation primitives (StatusBadge / EmptyState / MetricCard / PageHeader) over the EXISTING design tokens
```

F13 introduces zero new academic/assessment/readiness engine (AC-F13-02) — every number rendered by a new page is read from an existing, certified service function, never recomputed.

## What changed vs. what was extended

- **Extended, not replaced**: `LearnerShell` (added an optional `workspaceSwitcher` slot + 2 icons), `dashboard/layout.tsx` (now branches on active workspace before choosing which nav-group builder + which locale-key source to use), `messages.ts` (added ~65 new keys across all 5 locales), `globals.css` (added workspace-switcher styles only).
- **New**: `src/lib/lx/workspace-navigation.ts` (Parent/Teacher/Institution nav groups), `WorkspaceSwitcher.tsx`, `src/components/ui/*` (4 presentation primitives), the Teacher workspace page tree (`/dashboard/teacher/*`), the Institution workspace page tree (`/dashboard/institution/*`), one new read-only roster function (`getAdministeredInstitutions`) + its route (`GET /api/institutions/mine`).
- **Fixed**: `POST /api/teacher/interventions`'s Zod schema (missing EXAM target branch — see `F13_CURRENT_UX_ARCHITECTURE_ASSESSMENT.md`).
- **Untouched**: every existing Student page, the existing Parent page's own internals (only its future integration into the workspace switcher is a documented next step, not done in this phase — see residuals), all F1-F12 backend services/tables/migrations.

## Why ONE shell, not five applications (task section 6)

The shell was already role-agnostic in its rendering logic (it only ever renders `groups: ResolvedNavGroup[]`, resolved server-side) — the only role-specific thing about it before F13 was that `dashboard/layout.tsx` only ever called ONE nav-group builder. Making it workspace-aware required no change to `LearnerShell`'s actual rendering logic, only which data it's handed — confirming the shell was already correctly architected for this, just not yet wired to the real F1 workspace model.
