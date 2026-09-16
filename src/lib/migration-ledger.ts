/**
 * Pure logic for the StudyUs migration ledger/runner
 * (scripts/db-status.ts, scripts/db-migrate.ts). Extracted here so it's
 * testable without a real database connection -- see
 * tests/unit/migration-ledger.test.ts.
 *
 * This module never touches the database itself; it only computes
 * checksums and diffs a list of migration files against a list of
 * already-applied ledger rows.
 *
 * CANON-MIG-R1 -- COMPOSITE VERSION REPAIR. The canonical migration
 * filename shape this repository has used since its very first file
 * (`20260831_1400_ai_execution_and_decision_audit.sql`) is
 * `<YYYYMMDD>_<SEQUENCE>_<NAME>` -- but `parseMigrationFilename`
 * previously split at the FIRST underscore only, so `version` was just
 * the 8-digit date and `SEQUENCE_NAME` was folded into `name`. Because
 * `schema_migrations.version` is the ledger's PRIMARY KEY, two
 * migrations filed on the SAME calendar day (e.g. `20260915_1000_...`
 * and `20260915_1100_...`) collided onto the identical logical version
 * `'20260915'` -- confirmed live in Preview, where only the first
 * (`1000`) migration of 2026-09-15 could ever be correctly recognized
 * as applied; `1100`/`1200` were misreported as checksum DRIFT against
 * that same row instead of being recognized as separate, still-pending
 * migrations.
 *
 * The fix has two halves:
 *   1. `parseMigrationFilename` now returns the full `YYYYMMDD_SEQUENCE`
 *      composite as `version` (Parts 0/1).
 *   2. `normalizeAppliedMigration` recognizes an ALREADY-APPLIED ledger
 *      row written by the OLD, buggy parser (`version` is a bare
 *      8-digit date AND `name` starts with a `SEQUENCE_` prefix) and
 *      folds that same sequence into an in-memory-only composite
 *      version for comparison purposes -- `schema_migrations` itself is
 *      NEVER updated, edited, or backfilled (Part 2/12). `diffMigrations`
 *      applies this normalization to every applied row before comparing,
 *      so every existing legacy-shaped row in the LIVE Preview ledger
 *      (not just the one example this phase's spec calls out) is
 *      recognized correctly without a single UPDATE/DELETE statement.
 */

import { createHash } from 'crypto';

export interface MigrationFile {
  version: string;
  name: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  /**
   * Optional for backward compatibility with callers/tests that only
   * ever dealt with non-date-shaped versions (where normalization is a
   * guaranteed no-op regardless) -- a REAL `schema_migrations` row
   * always has one (`SELECT version, name, checksum ...`).
   */
  name?: string;
  checksum: string;
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** The one shape every migration filename in this repository has used since its first file. */
const CANONICAL_FILENAME_RE = /^(\d{8})_([^_]+)_(.+)$/;

/**
 * `<YYYYMMDD>_<SEQUENCE>_<NAME>` -> `{ version: 'YYYYMMDD_SEQUENCE', name: 'NAME' }`.
 * `SEQUENCE` may be any non-underscore token (this repository's own
 * convention is a 4-digit time-like value -- `1000`, `1100`, `1400` --
 * but nothing here assumes exactly 4 digits). CANON-MIG-R1 Part 1: this
 * NEVER splits at only the first underscore -- a filename with fewer
 * than 3 underscore-separated segments falls back to the historical
 * "whole stem as both fields" / "first-underscore-split" behavior
 * (unchanged from before this phase) rather than crashing, so a
 * genuinely malformed filename fails a later, more specific check
 * (`isValidMigrationFilename`) instead of throwing here.
 */
export function parseMigrationFilename(filenameWithoutExt: string): { version: string; name: string } {
  const canonical = filenameWithoutExt.match(CANONICAL_FILENAME_RE);
  if (canonical) {
    const [, date, sequence, name] = canonical;
    return { version: `${date}_${sequence}`, name };
  }
  const [version, ...nameParts] = filenameWithoutExt.split('_');
  return { version, name: nameParts.join('_') || filenameWithoutExt };
}

/** CANON-MIG-R1 Part 10 -- the same shape `parseMigrationFilename` recognizes as canonical, checked independently so a malformed file on disk can be rejected explicitly rather than silently falling back. Never applied to ledger rows (Part 10: "Do not make legacy ledger rows conform to filename validation"). */
export function isValidMigrationFilename(filenameWithoutExt: string): boolean {
  return CANONICAL_FILENAME_RE.test(filenameWithoutExt);
}

/** A bare 8-digit date -- exactly what the OLD, buggy parser produced as `version` for every migration, regardless of how many shared that calendar day. */
const LEGACY_DATE_ONLY_VERSION_RE = /^\d{8}$/;
/** The OLD, buggy parser's `name` output: `SEQUENCE_realName` (the sequence token the date-only version swallowed, folded into name instead). */
const LEGACY_NAME_SEQUENCE_PREFIX_RE = /^(\d+)_(.+)$/;

/**
 * CANON-MIG-R1 Part 2/3 -- IN-MEMORY-ONLY normalization of one applied
 * ledger row, for comparison purposes. Never touches the database; the
 * caller (`diffMigrations`) only ever reads `schema_migrations`, never
 * writes it.
 *
 * A row is recognized as legacy-shaped (and folded into the new
 * composite identity) only when BOTH:
 *   - `version` is a bare 8-digit date (never anything else -- a
 *     genuinely new-format row's version already contains its own `_`,
 *     so this check alone rules it out); AND
 *   - `name` starts with a `SEQUENCE_` prefix (the exact shape the old
 *     parser always produced, since it folded the sequence segment into
 *     `name` rather than dropping it).
 *
 * Every other row (already-composite, or missing `name`, or a
 * non-date-shaped version from an unrelated caller/test) is returned
 * completely unchanged -- this function is the identity function for
 * every case it does not explicitly recognize.
 */
export function normalizeAppliedMigration(row: AppliedMigration): AppliedMigration {
  if (!LEGACY_DATE_ONLY_VERSION_RE.test(row.version)) return row;
  if (!row.name) return row;
  const match = row.name.match(LEGACY_NAME_SEQUENCE_PREFIX_RE);
  if (!match) return row;
  const [, sequence, realName] = match;
  return { ...row, version: `${row.version}_${sequence}`, name: realName };
}

export interface MigrationDiff {
  pending: MigrationFile[];
  drifted: MigrationFile[];
}

/**
 * Compares migration files found on disk against what the ledger says
 * is already applied. A file whose version isn't in the ledger yet is
 * "pending". A file whose version IS in the ledger but whose checksum
 * no longer matches is "drifted" -- an already-applied migration was
 * edited after the fact, which must never happen (migrations are
 * immutable once applied; a correction is a new migration, not an edit).
 *
 * CANON-MIG-R1 Part 4/6/7: every `applied` row is passed through
 * `normalizeAppliedMigration` BEFORE the comparison map is built, so
 * both `db:migrate` and `db:status` (the only two callers) get correct,
 * checksum-strict identity matching for free, including against
 * historical legacy-shaped rows already sitting in a live ledger --
 * without either script needing to remember to normalize itself.
 */
export function diffMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationDiff {
  const normalizedApplied = applied.map(normalizeAppliedMigration);
  const appliedByVersion = new Map(normalizedApplied.map((a) => [a.version, a.checksum]));
  const pending: MigrationFile[] = [];
  const drifted: MigrationFile[] = [];

  for (const f of files) {
    const appliedChecksum = appliedByVersion.get(f.version);
    if (appliedChecksum === undefined) {
      pending.push(f);
    } else if (appliedChecksum !== f.checksum) {
      drifted.push(f);
    }
  }

  return { pending, drifted };
}

/**
 * CANON-MIG-R1 Part 8/9 -- defensive validation: two migration FILES
 * (never ledger rows) must never resolve to the same canonical version.
 * Before this phase, that could only happen via a literal duplicate
 * filename (already impossible -- `readdirSync` can't list the same
 * name twice); this phase's own composite-version change makes it
 * newly possible for two genuinely different filenames to collide if a
 * future file is misnamed (e.g. two files both parsing to
 * `20260915_1100`) -- returns every version with more than one file, so
 * the caller can abort BEFORE the `bySql` Map is built (a `Map` would
 * otherwise silently keep only the last entry for a duplicate key).
 */
export function findDuplicateFileVersions(files: MigrationFile[]): string[] {
  const seen = new Map<string, number>();
  for (const f of files) seen.set(f.version, (seen.get(f.version) ?? 0) + 1);
  return [...seen.entries()].filter(([, count]) => count > 1).map(([version]) => version);
}
