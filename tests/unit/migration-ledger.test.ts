import { describe, it, expect } from 'vitest';
import { sha256, parseMigrationFilename, diffMigrations } from '@/lib/migration-ledger';

describe('sha256', () => {
  it('is deterministic for the same content', () => {
    expect(sha256('CREATE TABLE foo (id uuid);')).toBe(sha256('CREATE TABLE foo (id uuid);'));
  });

  it('differs for different content', () => {
    expect(sha256('CREATE TABLE foo (id uuid);')).not.toBe(sha256('CREATE TABLE bar (id uuid);'));
  });
});

describe('parseMigrationFilename', () => {
  it('splits version from name at the first underscore', () => {
    expect(parseMigrationFilename('20260901_1200_add_engine_versioning')).toEqual({
      version: '20260901',
      name: '1200_add_engine_versioning',
    });
  });

  it('falls back to using the whole stem as both fields when there is no underscore', () => {
    expect(parseMigrationFilename('nounderscore')).toEqual({ version: 'nounderscore', name: 'nounderscore' });
  });
});

describe('diffMigrations', () => {
  it('a file whose version is not in the ledger is pending', () => {
    const { pending, drifted } = diffMigrations(
      [{ version: '1', name: 'a', checksum: 'abc' }],
      []
    );
    expect(pending).toEqual([{ version: '1', name: 'a', checksum: 'abc' }]);
    expect(drifted).toEqual([]);
  });

  it('a file whose version IS in the ledger with a matching checksum is neither pending nor drifted', () => {
    const { pending, drifted } = diffMigrations(
      [{ version: '1', name: 'a', checksum: 'abc' }],
      [{ version: '1', checksum: 'abc' }]
    );
    expect(pending).toEqual([]);
    expect(drifted).toEqual([]);
  });

  it('a file whose version IS in the ledger but with a DIFFERENT checksum is drifted, not pending', () => {
    const { pending, drifted } = diffMigrations(
      [{ version: '1', name: 'a', checksum: 'new-checksum' }],
      [{ version: '1', checksum: 'old-checksum' }]
    );
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
      { version: '1', checksum: 'a1' }, // unchanged
      { version: '2', checksum: 'b2-old' }, // drifted
      // version 3 not yet applied -> pending
    ];
    const { pending, drifted } = diffMigrations(files, applied);
    expect(pending.map((p) => p.version)).toEqual(['3']);
    expect(drifted.map((d) => d.version)).toEqual(['2']);
  });

  it('an empty file list produces no pending and no drifted entries', () => {
    expect(diffMigrations([], [{ version: '1', checksum: 'x' }])).toEqual({ pending: [], drifted: [] });
  });
});
