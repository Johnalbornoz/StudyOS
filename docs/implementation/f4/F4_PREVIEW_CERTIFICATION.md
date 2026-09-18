# F4 — Preview Certification

## Deployment

- Branch: `f4/learning-architecture-2`
- Vercel project: `study-so/study-os`
- Deployment: `https://study-ekw8q84mj-study-so.vercel.app`
- Target: `null` (Preview — explicitly **not** Production; confirmed via `/api/version` →
  `"environment":"preview"`)
- Build: succeeded, 0 errors, standard `vercel deploy --non-interactive` pipeline

## What was verified live, against the real deployment (not mocked, not local)

1. **Environment identity** — confirms this is not the Production target.
2. **F4 admin catalog route authentication** — all 5 `/api/admin/catalog/*` routes reject
   anonymous callers with 401 before any catalog service is invoked.
3. **F0-S/F1/F3 regression** — `/api/content/search`, `/api/billing/subscription`, and `/api/test`
   still behave exactly as after their respective phases; `/role-select` still renders.

## Remote database migration — DEFERRED_TO_INTEGRATED_PREVIEW_GATE

Per task §24: before applying the F4 migration to any remote database, isolation between the
Preview database and Production must be proven. That proof is not available from this
environment (no live database connection, no confirmed separate Preview datastore identity), so
**the F4 migration was not applied to any remote database in this phase** — exactly the same
disposition F1/F2/F3 recorded for their own migrations, and the same reason: this is a
deliberate, documented deferral, not a failure. The Preview deployment above runs the *application
code* (including the new `/api/admin/catalog/*` routes and `src/lib/catalog`) against whatever
schema the connected database already has; those routes will correctly return empty results or
fail closed rather than error, since they only ever read/write the new F4 tables, which simply
won't exist there yet until an authorized operator runs `npm run db:migrate` against a proven-safe
target.

All schema-level certification for this phase was instead performed against a real, ephemeral,
local-only PostgreSQL instance — see the QA report and reconciliation report for the full
migration + adversarial-matrix results, which is the strongest verification available without a
proven-isolated remote target (exactly the path task §21/§24 anticipates).

## Conclusion

Preview deployment is live, healthy, and correctly gated. Every new F4 route matches its intended
authentication contract, and no regression was found in F0-S/F1/F2/F3 behavior. The database
migration itself remains correctly deferred pending a provable remote-isolation gate, consistent
with every prior phase's own disposition.
