/**
 * Fase 2A -- requireStudyUSAdmin is the sole gate for the global user-
 * administration surface. Covers the task's own required cases 1
 * (unauthenticated), 6 (active admin allowed), 7 (suspended admin
 * rejected), plus the bootstrap/self-heal and fail-closed-on-mismatch
 * behavior that makes STUDYUS_ADMIN a real, canonical role rather than
 * a client-trusted claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ currentUser: () => currentUserMock() }));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const isAdminEmailMock = vi.fn();
vi.mock('@/services/admin.service', () => ({ isAdminEmail: (...a: any[]) => isAdminEmailMock(...a) }));

const getOrCreateCanonicalUserMock = vi.fn();
const hasRoleMock = vi.fn();
vi.mock('@/lib/identity', () => ({
  getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a),
  hasRole: (...a: any[]) => hasRoleMock(...a),
}));

import { requireStudyUSAdmin, countActiveStudyUSAdmins } from '@/lib/admin/authorization';

beforeEach(() => {
  currentUserMock.mockReset().mockResolvedValue({ primaryEmailAddress: { emailAddress: 'admin@test.com' }, emailAddresses: [] });
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  isAdminEmailMock.mockReset().mockReturnValue(false);
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });
  hasRoleMock.mockReset().mockResolvedValue(false);
});

describe('requireStudyUSAdmin', () => {
  it('case 1: no Clerk session -> denied', async () => {
    expect(await requireStudyUSAdmin(null)).toBeNull();
    expect(getOrCreateCanonicalUserMock).not.toHaveBeenCalled();
  });

  it('case 6: allowlisted email with the role already granted -> allowed', async () => {
    isAdminEmailMock.mockReturnValue(true);
    hasRoleMock.mockResolvedValue(true);
    const result = await requireStudyUSAdmin('clerk-1');
    expect(result).not.toBeNull();
    expect(result?.actor.id).toBe('user-1');
  });

  it('case 7: suspended account -> denied even if otherwise allowlisted', async () => {
    isAdminEmailMock.mockReturnValue(true);
    hasRoleMock.mockResolvedValue(true);
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'SUSPENDED' });
    expect(await requireStudyUSAdmin('clerk-1')).toBeNull();
  });

  it('archived account -> denied', async () => {
    isAdminEmailMock.mockReturnValue(true);
    hasRoleMock.mockResolvedValue(true);
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'ARCHIVED' });
    expect(await requireStudyUSAdmin('clerk-1')).toBeNull();
  });

  it('a non-allowlisted account with no STUDYUS_ADMIN role -> denied, never bootstrapped', async () => {
    isAdminEmailMock.mockReturnValue(false);
    hasRoleMock.mockResolvedValue(false);
    expect(await requireStudyUSAdmin('clerk-1')).toBeNull();
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('bootstraps the role exactly once for an allowlisted account that does not yet hold it', async () => {
    isAdminEmailMock.mockReturnValue(true);
    hasRoleMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await requireStudyUSAdmin('clerk-1');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/STUDYUS_ADMIN/);
    expect(result).not.toBeNull();
  });

  it('fails closed on a hypothetical mismatch: role granted but email no longer allowlisted', async () => {
    isAdminEmailMock.mockReturnValue(false);
    hasRoleMock.mockResolvedValue(true);
    expect(await requireStudyUSAdmin('clerk-1')).toBeNull();
  });

  it('never grants the role from a client-supplied claim -- only isAdminEmail(server-resolved email) can trigger bootstrap', async () => {
    isAdminEmailMock.mockReturnValue(false);
    hasRoleMock.mockResolvedValue(false);
    await requireStudyUSAdmin('clerk-1');
    // The only inputs to isAdminEmail are resolved server-side (currentUser()), never the request body.
    expect(isAdminEmailMock).toHaveBeenCalledWith('admin@test.com');
  });
});

describe('countActiveStudyUSAdmins', () => {
  it('counts only ACTIVE STUDYUS_ADMIN rows', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ c: 1 }] });
    expect(await countActiveStudyUSAdmins()).toBe(1);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/STUDYUS_ADMIN/);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/status = 'ACTIVE'/);
  });
});
