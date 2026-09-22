/**
 * CANON-MIG-R1 -- MIGRATION LEDGER COMPOSITE VERSION REPAIR.
 * The 11 mandatory required cases, in order, plus the pre-existing
 * sha256/diffMigrations coverage this phase did not need to change.
 */
import { describe, it, expect } from 'vitest';
import {
  sha256,
  parseMigrationFilename,
  isValidMigrationFilename,
  normalizeAppliedMigration,
  diffMigrations,
  findDuplicateFileVersions,
} from '@/lib/migration-ledger';

describe('sha256', () => {
  it('is deterministic for the same content', () => {
    expect(sha256('CREATE TABLE foo (id uuid);')).toBe(sha256('CREATE TABLE foo (id uuid);'));
  });

  it('differs for different content', () => {
    expect(sha256('CREATE TABLE foo (id uuid);')).not.toBe(sha256('CREATE TABLE bar (id uuid);'));
  });
});

describe('parseMigrationFilename -- CANON-MIG-R1 Part 1: composite YYYYMMDD_SEQUENCE version, never a first-underscore split', () => {
  it('1. 20260915_1000_canon_r4r1_test -> version 20260915_1000, name canon_r4r1_test', () => {
    expect(parseMigrationFilename('20260915_1000_canon_r4r1_test')).toEqual({
      version: '20260915_1000',
      name: 'canon_r4r1_test',
    });
  });

  it('2. 20260915_1100_canon_r5r1_test -> a version DIFFERENT from the 1000 file\'s', () => {
    const result = parseMigrationFilename('20260915_1100_canon_r5r1_test');
    expect(result).toEqual({ version: '20260915_1100', name: 'canon_r5r1_test' });
    expect(result.version).not.toBe(parseMigrationFilename('20260915_1000_canon_r4r1_test').version);
  });

  it('3. 20260915_1200_canon_r5r1a_test -> a version DIFFERENT from both 1000 and 1100', () => {
    const result = parseMigrationFilename('20260915_1200_canon_r5r1a_test');
    expect(result).toEqual({ version: '20260915_1200', name: 'canon_r5r1a_test' });
    expect(result.version).not.toBe(parseMigrationFilename('20260915_1000_canon_r4r1_test').version);
    expect(result.version).not.toBe(parseMigrationFilename('20260915_1100_canon_r5r1_test').version);
  });

  it('falls back to using the whole stem as both fields when there is no underscore at all', () => {
    expect(parseMigrationFilename('nounderscore')).toEqual({ version: 'nounderscore', name: 'nounderscore' });
  });

  it('falls back to a first-underscore split for a filename with fewer than 3 segments (never crashes)', () => {
    expect(parseMigrationFilename('legacy_name')).toEqual({ version: 'legacy', name: 'name' });
  });

  it('real repository filenames all parse to the composite shape (regression against the live Preview root cause)', () => {
    expect(parseMigrationFilename('20260831_1400_ai_execution_and_decision_audit')).toEqual({
      version: '20260831_1400',
      name: 'ai_execution_and_decision_audit',
    });
    expect(parseMigrationFilename('20260915_1100_canon_r5r1_quiz_session_v1_marker')).toEqual({
      version: '20260915_1100',
      name: 'canon_r5r1_quiz_session_v1_marker',
    });
  });
});

describe('isValidMigrationFilename', () => {
  it('accepts the canonical YYYYMMDD_SEQUENCE_name shape', () => {
    expect(isValidMigrationFilename('20260915_1000_canon_r4r1_test')).toBe(true);
  });

  it('rejects a filename with fewer than 3 segments', () => {
    expect(isValidMigrationFilename('legacy_name')).toBe(false);
    expect(isValidMigrationFilename('nounderscore')).toBe(false);
  });

  it('rejects a non-8-digit date segment', () => {
    expect(isValidMigrationFilename('202609_1000_name')).toBe(false);
  });
});

describe('normalizeAppliedMigration -- CANON-MIG-R1 Part 2/3: in-memory only, never mutates the ledger', () => {
  it('4. a legacy applied row (version=20260915, name=1000_canon_r4r1_test) normalizes to the composite identity', () => {
    expect(normalizeAppliedMigration({ version: '20260915', name: '1000_canon_r4r1_test', checksum: 'abc' })).toEqual({
      version: '20260915_1000',
      name: 'canon_r4r1_test',
      checksum: 'abc',
    });
  });

  it('5. a new-format applied row (version already composite) is returned completely unchanged', () => {
    const row = { version: '20260915_1100', name: 'canon_r5r1_test', checksum: 'xyz' };
    expect(normalizeAppliedMigration(row)).toEqual(row);
  });

  it('a row with a non-date-shaped version is returned unchanged (defensive -- covers pre-existing non-date test versions like "1")', () => {
    expect(normalizeAppliedMigration({ version: '1', name: 'a', checksum: 'x' })).toEqual({ version: '1', name: 'a', checksum: 'x' });
  });

  it('a legacy-dated row with no sequence-shaped name prefix is returned unchanged (defensive, never guesses)', () => {
    const row = { version: '20260915', name: 'no_sequence_prefix_here', checksum: 'x' };
    expect(normalizeAppliedMigration(row)).toEqual(row);
  });

  it('a row with no `name` at all is returned unchanged (name is optional for backward compatibility)', () => {
    const row = { version: '20260915', checksum: 'x' };
    expect(normalizeAppliedMigration(row)).toEqual(row);
  });
});

describe('diffMigrations -- CANON-MIG-R1 Part 4/6/7: normalizes applied rows before comparing, never weakens checksum drift detection', () => {
  it('6. the 1000 file matches its legacy-shaped, already-applied ledger row with the SAME checksum -> neither pending nor drifted', () => {
    const files = [{ version: '20260915_1000', name: 'canon_r4r1_pedagogical_requirement_recognition', checksum: 'checksum-1000' }];
    const applied = [{ version: '20260915', name: '1000_canon_r4r1_pedagogical_requirement_recognition', checksum: 'checksum-1000' }];
    const { pending, drifted } = diffMigrations(files, applied);
    expect(pending).toEqual([]);
    expect(drifted).toEqual([]);
  });

  it('7. the 1000 file has a DIFFERENT checksum than its legacy-shaped ledger row -> drifted, not pending (checksum protection is never weakened)', () => {
    const files = [{ version: '20260915_1000', name: 'canon_r4r1_pedagogical_requirement_recognition', checksum: 'checksum-1000-EDITED' }];
    const applied = [{ version: '20260915', name: '1000_canon_r4r1_pedagogical_requirement_recognition', checksum: 'checksum-1000' }];
    const { pending, drifted } = diffMigrations(files, applied);
    expect(pending).toEqual([]);
    expect(drifted.map((d) => d.version)).toEqual(['20260915_1000']);
  });

  it('8. the LIVE Preview shape: 1000 legacy-applied + 1100/1200 files on disk -> exactly 1100 and 1200 pending, 1000 neither pending nor drifted', () => {
    const files = [
      { version: '20260915_1000', name: 'canon_r4r1_pedagogical_requirement_recognition', checksum: 'c1000' },
      { version: '20260915_1100', name: 'canon_r5r1_quiz_session_v1_marker', checksum: 'c1100' },
      { version: '20260915_1200', name: 'canon_r5r1a_quiz_session_authorized_contract', checksum: 'c1200' },
    ];
    const applied = [{ version: '20260915', name: '1000_canon_r4r1_pedagogical_requirement_recognition', checksum: 'c1000' }];
    const { pending, drifted } = diffMigrations(files, applied);
    expect(pending.map((p) => p.version)).toEqual(['20260915_1100', '20260915_1200']);
    expect(drifted).toEqual([]);
  });

  it('9. multiple same-day files never collide -- each keeps its own applied/pending identity independently', () => {
    const files = [
      { version: '20260915_1000', name: 'a', checksum: 'ca' },
      { version: '20260915_1100', name: 'b', checksum: 'cb' },
      { version: '20260915_1200', name: 'c', checksum: 'cc' },
    ];
    // Only 1100 is applied (new-format row) -- 1000 and 1200 must independently show as pending, never conflated onto the single '20260915' bucket the OLD parser would have produced.
    const applied = [{ version: '20260915_1100', name: 'b', checksum: 'cb' }];
    const { pending, drifted } = diffMigrations(files, applied);
    expect(pending.map((p) => p.version).sort()).toEqual(['20260915_1000', '20260915_1200']);
    expect(drifted).toEqual([]);
  });

  it('a file whose version is not in the ledger is pending', () => {
    const { pending, drifted } = diffMigrations([{ version: '1', name: 'a', checksum: 'abc' }], []);
    expect(pending).toEqual([{ version: '1', name: 'a', checksum: 'abc' }]);
    expect(drifted).toEqual([]);
  });

  it('a file whose version IS in the ledger with a matching checksum is neither pending nor drifted', () => {
    const { pending, drifted } = diffMigrations([{ version: '1', name: 'a', checksum: 'abc' }], [{ version: '1', checksum: 'abc' }]);
    expect(pending).toEqual([]);
    expect(drifted).toEqual([]);
  });

  it('a file whose version IS in the ledger but with a DIFFERENT checksum is drifted, not pending', () => {
    const { pending, drifted } = diffMigrations([{ version: '1', name: 'a', checksum: 'new-checksum' }], [{ version: '1', checksum: 'old-checksum' }]);
    expect(pending).toEqual([]);
    expect(drifted).toEqual([{ version: '1', name: 'a', checksum: 'new-checksum' }]);
  });

  it('handles a mix of pending, drifted, and already-applied-unchanged files correctly', () => {
    const files = [
      { version: '1', name: 'a', checksum: 'a1' },
      { version: '2', name: 'b', checksum: 'b2-new' },
      { version: '3', name: 'c', checksum: 'c3' },
    ];
    const applied = [
      { version: '1', checksum: 'a1' },
      { version: '2', checksum: 'b2-old' },
    ];
    const { pending, drifted } = diffMigrations(files, applied);
    expect(pending.map((p) => p.version)).toEqual(['3']);
    expect(drifted.map((d) => d.version)).toEqual(['2']);
  });

  it('an empty file list produces no pending and no drifted entries', () => {
    expect(diffMigrations([], [{ version: '1', checksum: 'x' }])).toEqual({ pending: [], drifted: [] });
  });
});

describe('findDuplicateFileVersions -- CANON-MIG-R1 Part 8/9: no silent Map overwrite', () => {
  it('10. two files that resolve to the SAME canonical version are detected', () => {
    const files = [
      { version: '20260915_1100', name: 'a', checksum: 'ca' },
      { version: '20260915_1100', name: 'b', checksum: 'cb' },
    ];
    expect(findDuplicateFileVersions(files)).toEqual(['20260915_1100']);
  });

  it('distinct versions never appear as duplicates', () => {
    const files = [
      { version: '20260915_1000', name: 'a', checksum: 'ca' },
      { version: '20260915_1100', name: 'b', checksum: 'cb' },
      { version: '20260915_1200', name: 'c', checksum: 'cc' },
    ];
    expect(findDuplicateFileVersions(files)).toEqual([]);
  });

  it('an empty file list has no duplicates', () => {
    expect(findDuplicateFileVersions([])).toEqual([]);
  });
});

describe('R14 regression -- the REAL database/migrations/ directory on disk never has two files sharing a canonical version', () => {
  it('parses every real migration filename and finds zero duplicate versions', () => {
    const { readdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const dir = join(process.cwd(), 'database', 'migrations');
    const filenames: string[] = readdirSync(dir).filter((f: string) => f.endsWith('.sql'));
    const files = filenames.map((f) => ({
      ...parseMigrationFilename(f.replace(/\.sql$/, '')),
      checksum: 'n/a', // content is irrelevant to this check -- only version collisions matter
    }));
    expect(findDuplicateFileVersions(files)).toEqual([]);
  });

  it('the two migrations originally filed under the colliding 20260921_1000 version now have distinct versions', () => {
    const { readdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const dir = join(process.cwd(), 'database', 'migrations');
    const filenames: string[] = readdirSync(dir).filter((f: string) => f.endsWith('.sql'));
    expect(filenames).toContain('20260921_1000_f3_subscription_entitlement_foundation.sql');
    expect(filenames).toContain('20260921_1100_student_initiated_parent_invitation.sql');
    expect(filenames).not.toContain('20260921_1000_student_initiated_parent_invitation.sql');
  });
});
