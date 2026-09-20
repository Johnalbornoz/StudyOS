# F15 — Database & Migration Readiness

## Migration governance (real, existing, unchanged mechanism)

`scripts/db-migrate.ts` (unchanged this phase): applies every PENDING file in `database/migrations/` inside its own transaction, recorded into a `schema_migrations` ledger only on success — never invoked automatically (not from build, not from app startup, not from any deploy hook; explicit, human-run only via `npm run db:migrate`). This phase's own one new migration (`20261010_1000_f15_min_cohort_policy.sql`) follows this exact, unchanged governance.

## F15's own migration

`20261010_1000_f15_min_cohort_policy.sql` — a single, idempotent `INSERT ... WHERE NOT EXISTS` seeding the real MIN_COHORT_POLICY row (see ADR-F15-MIN-COHORT-POLICY.md). Verified this phase:
- Applies cleanly on top of the full migration history through F14 (confirmed by all 16 real-Postgres regression scripts, which each apply the FULL chronological migration history from scratch, including this new file).
- Idempotent: F12's own cert script explicitly re-applies its migration a second time as part of its own certification and passed unchanged.
- No index/constraint/FK change — purely a data seed into an already-existing table (`institution_analytics_policy_versions`, created by F12's own migration, unchanged schema).

## Backward compatibility

No column was renamed, dropped, or retyped. No existing row was modified (the migration only inserts, guarded by `WHERE NOT EXISTS`, so a database that somehow already has a policy row is left untouched rather than overwritten).

## Indexes/constraints (unchanged, re-verified)

`idx_institution_analytics_policy_versions_one_active` (a partial unique index on `((1)) WHERE status = 'ACTIVE'`, F12's own, unchanged) continues to enforce at most one ACTIVE policy row — this phase's migration relies on this exact constraint rather than re-implementing "only one active row" logic in application code.

## Preview database migration state

**Not verified this phase.** The real Preview deployment (F15_PREVIEW_CERTIFICATION.md) was deployed via `vercel deploy`, which builds and runs the application but does **not** run `npm run db:migrate` (by design — migration is a deliberate, separate, human-run operation, never a deploy hook, per `db-migrate.ts`'s own header comment). Whether the Preview database has F15's own new migration (or even the full F11-F14 history) applied is **unknown and unverified** — this agent has no access to the Preview database to check. Carried as `IVG-F7-01`'s own long-standing scope (unresolved since F7, now also explicitly covering F15's own new migration).

## Pilot data growth (reasoned, not measured)

The new `simulation_attempts.navigation_state` JSONB column now grows meaningfully during an active exam attempt (holds the full pending `GeneratedQuestion` object, cleared on each submission) — a real, if modest, per-attempt storage characteristic that did not exist before this phase (previously this column only ever held a small `{currentTargetIndex, visitedTargetIds, mode, rules}` object). Not expected to be a capacity concern at pilot scale (single question objects, cleared after each answer, not accumulated).

## Recommendation before Pilot

1. **Operator action required**: confirm the Preview (and any eventual Pilot) database actually has the full migration history applied, including `20261010_1000_f15_min_cohort_policy.sql`, via `npm run db:migrate -- --dry-run` pointed at that database's own `DATABASE_URL` (never run destructively without first confirming target).
2. This should be a Pilot gate check, not assumed.
