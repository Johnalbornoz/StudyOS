# F5 — Preview Certification

## Deployment

- Branch: `f5/evidence-learner-state-2`
- Vercel project: `study-so/study-os`
- Deployment: `https://study-nh2ia5iyu-study-so.vercel.app`
- Deployed commit: `0be4e1b` (`test(f5): real-Postgres migration and adversarial Learner State
  certification`) — the branch tip's remaining commits are documentation-only
  (`docs(f5): reconciliation, replay/explainability, QA, risk register, and handoff`) and do not
  change any runtime behavior; the deployed build is functionally identical to the branch's final
  state.
- Target: `null` (Preview — explicitly **not** Production; confirmed via `/api/version` →
  `"environment":"preview"`)
- Build: succeeded, 0 errors. Two CLI-side deploy attempts at the final doc-only commit failed
  with a transient `fetch failed` network error while polling build status (the remote build
  itself continued/queued independently of the CLI's local connection) — this is a client-side
  polling flake, not a build failure; the certified deployment above completed and serves
  correctly, verified live below.

## What was verified live, against the real deployment (not mocked, not local)

1. **Environment identity** — `/api/version` returns `environment: "preview"` and the exact
   commit SHA, confirming this is not the Production target.
2. **F5 admin route authentication** — all 6 `/api/admin/learner-state/*` routes reject
   anonymous requests with 401.
3. **F0-S/F1/F3/F4 regression** — `/api/content/search`, `/api/billing/subscription`,
   `/api/admin/catalog/subjects` still return 401 to anonymous callers; `/api/test` still returns
   404; `/role-select` still renders (200).

## What was NOT verified live (and why)

- Authenticated end-to-end evidence flows (a real learner submitting tagged evidence and reading
  back real Skill/Competency/Transfer-analytics state) were not exercised against Preview, for
  the same reason as every prior phase: creating real authenticated sessions against a shared
  Preview environment is out of scope for an anonymous smoke test. The full lifecycle **was**
  verified end-to-end against real PostgreSQL via the real `updateMastery()` production function
  in `f5-lifecycle-cert-runner.ts` — the strongest verification available without live user
  sessions, and the same mechanism every prior phase (F1-F4) used for this exact reason.

## Remote database migration — DEFERRED_TO_INTEGRATED_PREVIEW_GATE

Per task §37: before applying the F5 migration to any remote database, isolation between the
Preview database and Production must be proven. That proof is not available from this
environment, so the F5 migration was **not** applied to any remote database — the same
disposition F1-F4 recorded for their own migrations. All schema-level certification instead ran
against a real, ephemeral, local-only PostgreSQL instance (see the QA and reconciliation
reports).

## Conclusion

Preview deployment is live, healthy, and correctly gated. Every new F5 route matches its
intended authentication contract, and no regression was found in F0-S/F1/F3/F4 behavior. The
database migration itself remains correctly deferred pending a provable remote-isolation gate,
consistent with every prior phase's own disposition.
