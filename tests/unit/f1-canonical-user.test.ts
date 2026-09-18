/**
 * F1 -- canonical user resolution and role reads. Mocked `db`,
 * complements (does not replace) the real-Postgres certification in
 * scripts/operations/f1-identity-migration-cert.sh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { getOrCreateCanonicalUser, getCanonicalUserByClerkId, getUserRoles, hasRole } from '@/lib/identity';

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('getOrCreateCanonicalUser', () => {
  it('returns the existing users row when one already exists for this clerk_id', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'u1', clerk_id: 'c1', email: 'a@b.com', status: 'ACTIVE', active_workspace: null }] });
    const user = await getOrCreateCanonicalUser('c1');
    expect(user).toEqual({ id: 'u1', clerkId: 'c1', email: 'a@b.com', status: 'ACTIVE', activeWorkspace: null });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('creates a new users row when none exists yet, idempotent via ON CONFLICT', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // SELECT: not found
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'u2', clerk_id: 'c2', email: null, status: 'ACTIVE', active_workspace: null }] }); // INSERT ... RETURNING
    const user = await getOrCreateCanonicalUser('c2');
    expect(user.id).toBe('u2');
    expect(dbQueryMock).toHaveBeenCalledTimes(2);
    expect(dbQueryMock.mock.calls[1][0]).toMatch(/ON CONFLICT \(clerk_id\)/);
  });

  it('is a sibling of getOrCreateStudentId, never a replacement -- does not touch students/profiles', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'u1', clerk_id: 'c1', email: null, status: 'ACTIVE', active_workspace: null }] });
    await getOrCreateCanonicalUser('c1');
    for (const call of dbQueryMock.mock.calls) {
      expect(call[0]).not.toMatch(/\bstudents\b|\bprofiles\b/i);
    }
  });
});

describe('getCanonicalUserByClerkId', () => {
  it('returns null (never throws) when no user exists yet', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getCanonicalUserByClerkId('unknown')).toBeNull();
  });
});

describe('getUserRoles / hasRole', () => {
  it('only ever returns ACTIVE role grants', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ role: 'STUDENT', status: 'ACTIVE', granted_via: 'BACKFILL' }] });
    const roles = await getUserRoles('u1');
    expect(roles).toEqual([{ role: 'STUDENT', status: 'ACTIVE', grantedVia: 'BACKFILL' }]);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/status = 'ACTIVE'/);
  });

  it('hasRole is false for a role the user does not hold', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    expect(await hasRole('u1', 'STUDYUS_ADMIN')).toBe(false);
  });

  it('hasRole is true for a role the user actively holds', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    expect(await hasRole('u1', 'STUDENT')).toBe(true);
  });
});
