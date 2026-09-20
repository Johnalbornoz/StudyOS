# F13 — Performance Characterization

Task section 35 — characterization only, never a Production capacity claim.

## What was measured this phase

- **Build**: `npm run build` completed cleanly (see `F13_QA_REPORT.md`) — no bundle-size regression alarms surfaced by Next.js's own build output for the new routes (each new page is a small, focused Server Component with no heavy client-side dependency added — only two new `'use client'` files exist in the entire phase, `WorkspaceSwitcher` and `AssignInterventionForm`, both trivial in size).
- **Query shape** (a structural proxy for load latency, task section 35's own "duplicate requests / sequential fetches that can parallelize"): every new page that needs more than one piece of data uses `Promise.all` (Teacher Student Detail: overview + interventions in parallel; Institution Interventions/Attention pages: overview + summary in parallel) — no new page issues avoidable sequential round trips.
- **No client waterfalls introduced**: confirmed by code reading — no new page fetches data in a `useEffect` after initial render (all new pages are Server Components; the two client components only POST on explicit user action, never GET-on-mount).
- **Local app boot**: the dev server started and rendered the public marketing page in ~200ms (`Ready in 215ms`, per the dev server's own log) — a basic, honest sanity signal that the build artifact this phase produced is not obviously broken, not a load-bearing performance metric.

## What was NOT measured this phase (honestly deferred)

Real navigation latency for the new Teacher/Institution pages (dashboard data load, role switch, institution/class/student-detail navigation) requires an authenticated session against real seeded data — this environment had no safe way to establish one (see `F13_PREVIEW_CERTIFICATION.md`). No number is fabricated in its place. Registered as `IVG-F13-06`.

## Role-switch / cache-safety performance note

`router.refresh()` (used by `WorkspaceSwitcher`) forces a full server-component re-render of the current route tree — this is the CORRECT, safe choice for cache isolation (see `F13_CACHE_ISOLATION_REPORT.md`) but is inherently not "free" the way a client-cached optimistic update would be. This is a deliberate correctness-over-perceived-speed tradeoff, not an oversight — a stale-but-fast role switch would be a security/correctness defect (INV-F13-02/03), never an acceptable performance optimization.
