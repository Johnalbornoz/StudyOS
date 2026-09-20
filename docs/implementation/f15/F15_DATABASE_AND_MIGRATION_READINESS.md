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

**VERIFIED this phase (F15-C1, 2026-09-20) — supersedes the "not verified" claim below, which described F15's own original, un-investigated state.**

F15's own concern (below) turned out to be justified: the real Preview runtime was NOT connected to the database the operator had been migrating locally. This was discovered, diagnosed, and closed end to end:

1. **Discovery** (live, not assumed): the deployed Preview app failed every authenticated request with Postgres error `42P01 relation "users" does not exist`, confirmed via `npx vercel logs`.
2. **Root cause**: a temporary, Preview-only, credential-free diagnostic route (`src/app/api/diagnostics/preview-db/route.ts`, 404s outside `VERCEL_ENV=preview`, never returns a connection string/hostname/credential) was built, tested (12 unit tests), and deployed. It proved via a one-way SHA-256 fingerprint of `hostname|databaseName` that the runtime Preview database (`dbFingerprint 53d158d5811e7ee0`) was a **different** database from the one the operator had migrated locally (`6671e7382d808d06`).
3. **Classification**: the runtime database's own migration ledger (15 rows) was queried live and cross-checked name-for-name against `database/migrations/*.sql`. It matched, in exact order, the first 14 repository migration files plus the Phase 0D baseline snapshot row — i.e. a genuine, non-corrupt, in-sequence prefix of this repo's own history, simply arrested one file before `20260918_1000_f0s_ai_global_limits`. Classified `CURRENT_STUDYUS_PARTIAL_HISTORY` (not corrupt, not foreign) precisely because `20260919_1000_f1_unified_identity` was absent from the ledger — consistent with, not contradicting, the missing `users` table.
4. **Trial**: the operator created a temporary Neon branch (`f15-migration-trial-20260919`, id `br-square-glade-ayyrqhpa`, parented off Preview, auto-delete 2026-09-20 22:54 CST) and rehearsed the full migration there before touching the real Preview database.
5. **Repair executed** (by the operator, against the real runtime Preview database, using the same governed `npm run db:migrate` runner already certified elsewhere in this program): the remaining 17 migrations (`20260918_1000_f0s_ai_global_limits` → `20261010_1000_f15_min_cohort_policy`) were applied. A second dry-run reported zero pending migrations.
6. **Independent re-verification** (by this agent, not taken on the operator's word): the diagnostic route was queried live a second time and returned:
   - `appliedMigrationCount: 32`, `publicTableCount: 132`, `usersTableExists/userRolesTableExists/institutionsTableExists/schemaMigrationsTableExists: true`.
   - `migrationIds` entries 16–32 match, in order, the repository's remaining `f0s_ai_global_limits` → `f15_min_cohort_policy` files exactly.
   - `dbFingerprint` unchanged (`53d158d5811e7ee0`) — confirms this is a genuine in-place repair of the SAME runtime database, not a repoint to a different one.
7. **F1 identity backfill**: run twice via the already-certified `runIdentityBackfill()` (`src/services/identity-backfill.service.ts`, `ON CONFLICT DO NOTHING` throughout — idempotent by construction, not by luck). The second run reported zero new writes, confirming idempotency in practice, not just in code.
8. **Identity integrity, independently re-derived** via the same diagnostic route (reusing the certified `getCounts()` the backfill service itself uses, plus duplicate/broken-FK checks added this phase): `studentsTotal: 11`, `usersTotal: 11`, `profilesTotal: 15`, `userRolesTotal: 15` (`STUDENT: 11`, `PARENT: 4`), `institutionsCount: 0`, `studentsWithoutUser: 0`, `profilesWithoutUser: 0`, `studentBrokenLinks: 0`, `profileBrokenLinks: 0`, `duplicateClerkIds: 0`, `duplicateUserRoles: 0`. All 11 pre-existing students were preserved (`studentsTotal` unchanged at 11 before/after, per the operator's own before/after backfill report).
9. **Production**: not modified at any point in this process — no Production environment variable, database, or deployment was touched. Confirmed by inspecting only Preview-scoped `DATABASE_URL` and deploying exclusively via `vercel deploy` (never `--prod`).

No connection string, hostname, username, password, or other credential was ever printed, logged, or committed during this investigation or repair.

`IVG-F7-01` and `IVG-F12-02` are now marked **RESOLVED** in `F15_IVG_REGISTER.md` on this evidence.

### F15's own original claim (superseded above, kept for history)

**Not verified this phase [F15].** The real Preview deployment (F15_PREVIEW_CERTIFICATION.md) was deployed via `vercel deploy`, which builds and runs the application but does **not** run `npm run db:migrate` (by design — migration is a deliberate, separate, human-run operation, never a deploy hook, per `db-migrate.ts`'s own header comment). Whether the Preview database has F15's own new migration (or even the full F11-F14 history) applied is **unknown and unverified** — this agent has no access to the Preview database to check. Carried as `IVG-F7-01`'s own long-standing scope (unresolved since F7, now also explicitly covering F15's own new migration).

## Pilot data growth (reasoned, not measured)

The new `simulation_attempts.navigation_state` JSONB column now grows meaningfully during an active exam attempt (holds the full pending `GeneratedQuestion` object, cleared on each submission) — a real, if modest, per-attempt storage characteristic that did not exist before this phase (previously this column only ever held a small `{currentTargetIndex, visitedTargetIds, mode, rules}` object). Not expected to be a capacity concern at pilot scale (single question objects, cleared after each answer, not accumulated).

## Recommendation before Pilot

~~1. **Operator action required**: confirm the Preview (and any eventual Pilot) database actually has the full migration history applied, including `20261010_1000_f15_min_cohort_policy.sql`, via `npm run db:migrate -- --dry-run` pointed at that database's own `DATABASE_URL` (never run destructively without first confirming target).~~
~~2. This should be a Pilot gate check, not assumed.~~

**Done — see "VERIFIED this phase" above.** Remaining recommendation: the temporary Neon trial branch (`f15-migration-trial-20260919`) is scheduled for auto-delete 2026-09-20 22:54 CST; no action needed unless the operator wants it removed sooner. The temporary diagnostic route (`src/app/api/diagnostics/preview-db/route.ts`) should still be removed once F15-C1's own investigation is fully closed out (unchanged from its original, self-documented removal instruction).
