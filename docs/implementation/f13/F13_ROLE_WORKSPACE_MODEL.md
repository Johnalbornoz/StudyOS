# F13 — Role / Workspace Model

## Reused, not reinvented (INV-F13-01/02/03)

F13 introduces zero new role/workspace resolution logic. `dashboard/layout.tsx` calls F1's own, unchanged `resolveAvailableWorkspaces(userId)` and `getActiveWorkspace(userId)` on every request, and the `WorkspaceSwitcher` component writes exclusively through F1's own, unchanged `POST /api/identity/workspace` (which itself calls `setActiveWorkspace`, failing closed with `WORKSPACE_UNAVAILABLE` for anything not currently in `resolveAvailableWorkspaces`).

## Role switching changes context only (INV-F13-02/03, task section 7)

Switching workspace:
1. Writes `users.active_workspace` (a UI-context column, F1) — nothing else.
2. Triggers `router.push` to the new workspace's home route + `router.refresh()` — forcing the ENTIRE server component tree (starting with `dashboard/layout.tsx` itself) to re-fetch fresh from the database.
3. Never merges permissions: a PARENT+TEACHER actor viewing the Teacher workspace sees ONLY Teacher nav/data; switching to Parent shows ONLY Parent nav/data. No code path unions the two.

## Single-workspace vs multi-workspace UI (task section 7)

`WorkspaceSwitcher` renders a plain, non-interactive label when `available.length <= 1` (the common case today, since most fixtures/accounts have exactly one role) and a real dropdown switcher otherwise — both cases "show the active role/workspace clearly," satisfying the task's requirement without a confusing always-present dropdown that would always fail for a single-role user.

## Interface-language keying — a deliberate, disclosed inconsistency (task section 20's INV-F13-20, "account language governs global shell")

Student workspace: locale keyed by `students.id` (unchanged, exactly as before F13 — zero risk to existing saved preferences). Non-Student workspaces (Parent/Teacher/Institution/Admin): locale keyed by the F1 canonical `users.id`, via the SAME `user_language_preferences` table (which has no formal FK today, confirmed by schema inspection — it will accept either id space without conflict). This is a genuine, intentional inconsistency: unifying the key would require either a migration (backfilling `students.id` rows to also exist under `users.id`, or adding a real FK/mapping) or accepting that a pre-existing Student's saved language preference silently "resets" the first time their layout is rendered under the new lookup — both are real product/migration decisions this phase does not make unilaterally. Documented as a residual for F14 (see `F13_NEXT_PHASE_HANDOFF.md`).

## Admin workspace (task section 22)

Not restructured this phase. `ADMIN`/default-`STUDENT` both currently render the Student shell's own nav-group builder (which already includes the `isAdminEmail`-gated admin link, unchanged since before F13). A dedicated ADMIN nav-group builder is a natural next step (mirroring `buildTeacherNav`'s own pattern) but was not required to unblock any of this phase's own acceptance criteria.
