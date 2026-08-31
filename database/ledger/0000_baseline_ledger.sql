-- StudyUs migration ledger.
--
-- Governance infrastructure ONLY -- this table's existence does not
-- cause any historical migration (migrations/001-030) or any future
-- migration to execute. It is purely bookkeeping: a record of which
-- migration files (identified by version + a content checksum) have
-- been applied to a given database, and when.
--
-- Design notes:
--   - `version` is the primary key and the unique migration identifier.
--     Future migration files live in database/migrations/ and are named
--     `<version>_<short-name>.sql` (version recommended as a sortable
--     UTC timestamp, e.g. 20260901_1200) -- deliberately NOT reusing
--     the legacy migrations/001-030 numbering scheme, so there is no
--     possibility of an id collision or implied continuity with files
--     already known to not reliably describe the live database
--     (see docs/audits/STUDYUS_PHASE_0B_LIVE_SCHEMA_RECONCILIATION.md).
--   - `checksum` is a sha256 hex digest of the migration file's exact
--     content at the time it was applied, so `scripts/db-status.ts`
--     can detect if an already-applied migration file was edited after
--     the fact (drift that must never happen, per the immutability
--     rule in docs/architecture/database-governance.md).
--   - `applied_at` is server-side `NOW()`, not client-supplied, so the
--     ledger's timeline can't be spoofed by a misconfigured client clock.
--
-- This file is applied ONCE, by hand, via a reviewed operation (see the
-- Phase 0D report for exactly when/how it was applied to production).
-- It is idempotent (IF NOT EXISTS) and safe to run again.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE schema_migrations IS
  'Migration ledger (Phase 0D governance infrastructure). Bookkeeping only -- never auto-replayed. See database/README.md.';
