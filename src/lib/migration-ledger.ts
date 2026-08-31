/**
 * Pure logic for the StudyUs migration ledger/runner
 * (scripts/db-status.ts, scripts/db-migrate.ts). Extracted here so it's
 * testable without a real database connection -- see
 * tests/unit/migration-ledger.test.ts.
 *
 * This module never touches the database itself; it only computes
 * checksums and diffs a list of migration files against a list of
 * already-applied ledger rows.
 */

import { createHash } from 'crypto';

export interface MigrationFile {
  version: string;
  name: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  checksum: string;
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * `<version>_<name>.sql` -> { version, name }. `version` is everything
 * before the first underscore; `name` is the rest (with the `.sql`
 * extension already stripped by the caller). Falls back to using the
 * whole stem as both version and name if there's no underscore, rather
 * than throwing, so a malformed filename fails a later, more specific
 * check (e.g. a missing/duplicate version) instead of crashing the
 * whole status/migrate run.
 */
export function parseMigrationFilename(filenameWithoutExt: string): { version: string; name: string } {
  const [version, ...nameParts] = filenameWithoutExt.split('_');
  return { version, name: nameParts.join('_') || filenameWithoutExt };
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
 */
export function diffMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationDiff {
  const appliedByVersion = new Map(applied.map((a) => [a.version, a.checksum]));
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
