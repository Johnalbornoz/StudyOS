/**
 * F2 -- parent/guardian relationship state machine, focused on the
 * unlink/revoke safety requirements (INV-F2-07/08). Extends F0-R's
 * finding (unlinkChild used to hard-DELETE) with the fix and its test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { unlinkChild, revokeRelationshipByStudent, verifyParentAccess } from '@/services/parent.service';

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('unlinkChild -- soft revoke, never a hard delete', () => {
  it('issues an UPDATE, never a DELETE', async () => {
    await unlinkChild('parent-1', 'student-1');
    const sql = dbQueryMock.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE parent_student_relationships/);
    expect(sql).not.toMatch(/DELETE/);
    expect(sql).toMatch(/status = 'revoked'/);
  });

  it('scopes the update to this exact parent+student pair', async () => {
    await unlinkChild('parent-1', 'student-1');
    expect(dbQueryMock).toHaveBeenCalledWith(expect.any(String), ['parent-1', 'student-1']);
  });
});

describe('revokeRelationshipByStudent -- the learner\'s own side', () => {
  it('only transitions a currently-accepted relationship, scoped to this exact student', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ parent_id: 'parent-1' }], rowCount: 1 });
    const ok = await revokeRelationshipByStudent('student-1', 'parent-1');
    expect(ok).toBe(true);
    const [sql, params] = dbQueryMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE parent_student_relationships/);
    expect(sql).toMatch(/status = 'accepted'/);
    expect(sql).not.toMatch(/DELETE/);
    expect(params).toEqual(['student-1', 'parent-1']);
  });

  it('returns false (no-op) when there is no matching accepted relationship -- e.g. a student attempting to revoke a relationship that does not belong to them', async () => {
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    const ok = await revokeRelationshipByStudent('student-1', 'someone-elses-parent-id');
    expect(ok).toBe(false);
  });
});

describe('verifyParentAccess -- unaffected by the new revoked state except to deny it', () => {
  it('ALLOW only for status=accepted', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ '?': 1 }], rowCount: 1 });
    expect(await verifyParentAccess('parent-1', 'student-1')).toBe(true);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/status = 'accepted'/);
  });

  it('DENY when the relationship is revoked (the query never matches anything but accepted, so revoked rows are excluded identically to pending/declined)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await verifyParentAccess('parent-1', 'student-1')).toBe(false);
  });
});
