# F6 — Preview Certification

## Deployment

- Branch: `f6/curriculum-standards-mapping`
- Vercel project: `study-so/study-os`
- Deployment: `https://study-laso3jny6-study-so.vercel.app`
- Target: `null` (Preview — explicitly **not** Production; confirmed via `/api/version` →
  `"environment":"preview"`)
- Build: succeeded, 0 errors.

## What was verified live, against the real deployment (not mocked, not local)

1. **Environment identity** — `/api/version` returns `environment: "preview"`, confirming this
   is not the Production target.
2. **F6 admin route authentication** — all 6 `/api/admin/curriculum/*` routes (structures,
   structure-nodes, objectives, mappings, mappings/transition, coverage) reject anonymous
   requests with 401.
3. **F0-S/F1/F3/F4/F5 regression** — `/api/content/search`, `/api/billing/subscription`,
   `/api/admin/catalog/subjects`, `/api/admin/learner-state/skill` all still return 401 to
   anonymous callers; `/api/test` still returns 404; `/role-select` still renders (200).

## What was NOT verified live (and why)

Authenticated end-to-end editorial workflows (a real editor proposing a mapping, a real reviewer
approving it, a real publisher publishing it) were not exercised against Preview, for the same
reason as every prior phase: creating real authenticated sessions with editorial grants against a
shared Preview environment is out of scope for an anonymous smoke test. The full workflow **was**
verified end-to-end against real PostgreSQL via the real service functions in
`f6-lifecycle-cert-runner.ts` — the strongest verification available without live user sessions.

## Remote database migration — DEFERRED_TO_INTEGRATED_PREVIEW_GATE

Per task §40: before applying the F6 migration to any remote database, isolation between the
Preview database and Production must be proven. That proof is not available from this
environment, so the F6 migration was **not** applied to any remote database — the same
disposition F1-F5 recorded for their own migrations. All schema-level certification instead ran
against a real, ephemeral, local-only PostgreSQL instance.

## Conclusion

Preview deployment is live, healthy, and correctly gated. Every new F6 route matches its intended
authentication contract, and no regression was found in F0-S/F1/F3/F4/F5 behavior. The database
migration itself remains correctly deferred pending a provable remote-isolation gate, consistent
with every prior phase's own disposition.
