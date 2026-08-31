# `database/` — StudyUs schema governance (Phase 0D)

This directory is the authoritative, version-controlled representation of the StudyUs database schema, introduced in Phase 0D specifically because the legacy `migrations/001-030` folder at the repo root was proven (Phase 0A/0B forensic audits) to no longer reliably describe the live production database.

**`migrations/001-030` at the repo root is left untouched and still exists as a historical artifact.** Nothing here supersedes it in the sense of "replaces" — it is preserved for history, but it is no longer treated as authoritative. See `docs/adr/0001-schema-baseline-strategy.md` for the full reasoning, and `docs/audits/STUDYUS_PHASE_0D_SCHEMA_BASELINE_GOVERNANCE.md` for the migration-by-migration classification.

## Structure

```
database/
  baseline/
    STUDYUS_BASELINE_2026_08.sql   -- byte-accurate pg_dump --schema-only snapshot
                                        of the live production database, captured
                                        2026-08-26. The current source of truth.
  ledger/
    0000_baseline_ledger.sql       -- DDL for the schema_migrations ledger table
                                        (applied once, additively, to production
                                        in Phase 0D -- see the Phase 0D report).
  migrations/
    (empty as of Phase 0D)         -- where FUTURE, governed migrations go from
                                        now on. Never auto-applied. See below.
```

## Rules (see `docs/architecture/database-governance.md` for the full list)

1. **`database/baseline/`** reflects current reality. It is not an "ideal" schema and was never hand-edited to fix known issues (e.g. it still has no CHECK on `mastery_records.mastery_score`, because none exists live). Constraint hardening or other corrections are future migrations, not baseline edits.
2. **`database/migrations/`** is where new, governed migrations go — named `<version>_<name>.sql`, version recommended as a sortable UTC timestamp (e.g. `20260901_1200_add_x.sql`). This directory is intentionally empty right now.
3. **Nothing in this directory is ever auto-applied.** `npm run build`, `npm run start`, and application boot never touch the database schema. Applying a migration is always an explicit, human-run command:
   - `npm run db:status` — read-only; shows what's applied vs. pending, detects checksum drift.
   - `npm run db:migrate` (`-- --dry-run` to preview) — applies pending migrations from `database/migrations/`, each in its own transaction, recording into the `schema_migrations` ledger.
4. **Migrations are immutable once applied.** A mistake in an already-applied migration is fixed by a new, later migration — never by editing the applied file. `db:status`/`db:migrate` both detect and refuse to proceed past checksum drift (an applied file whose content no longer matches what was recorded).
5. **The ledger (`schema_migrations`) never replays history.** Bootstrapping it in Phase 0D did not run, and will never run, `migrations/001-030`.

## Reproducibility

`scripts/db-reproducibility-test.sh` proves `database/baseline/STUDYUS_BASELINE_2026_08.sql` can build a working schema from nothing, against a throwaway local Postgres instance (never production). Run it with `npm run db:repro-test`.
