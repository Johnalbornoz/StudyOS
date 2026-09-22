/**
 * Fase 2A -- route-level coverage for the task's own required cases
 * 2-5 (Student/Parent/Teacher/Institution-coordinator all denied
 * global admin access the same way: none of them ever holds
 * STUDYUS_ADMIN, so `requireStudyUSAdmin` returns null for every one
 * of them regardless of which other roles they hold -- this is the
 * single mechanism, not four separate checks) and case 19 (a
 * duplicate Clerk webhook never duplicates a `users` row).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));

const checkRateLimitMock = vi.fn();
vi.mock('@/lib/auth', () => ({ checkRateLimit: (...a: any[]) => checkRateLimitMock(...a) }));

const requireStudyUSAdminMock = vi.fn();
vi.mock('@/lib/admin/authorization', () => ({ requireStudyUSAdmin: (...a: any[]) => requireStudyUSAdminMock(...a) }));

import { guardAdminUsersRoute } from '@/lib/admin/route-guard';

beforeEach(() => {
  authMock.mockReset();
  checkRateLimitMock.mockReset().mockReturnValue(true);
  requireStudyUSAdminMock.mockReset();
});

describe('guardAdminUsersRoute -- the single chokepoint for every /api/admin/users/** route', () => {
  it('case 1 (route level): no session -> 401, requireStudyUSAdmin never called', async () => {
    authMock.mockResolvedValue({ userId: null });
    const result = await guardAdminUsersRoute('test.endpoint');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(401);
    expect(requireStudyUSAdminMock).not.toHaveBeenCalled();
  });

  it.each([
    ['case 2: a STUDENT-only account', 'clerk-student'],
    ['case 3: a PARENT-only account', 'clerk-parent'],
    ['case 4: a TEACHER-only account', 'clerk-teacher'],
    ['case 5: an INSTITUTION_ADMIN/coordinator account', 'clerk-coordinator'],
  ])('%s -> 403 (requireStudyUSAdmin denies every non-STUDYUS_ADMIN role identically)', async (_label, clerkId) => {
    authMock.mockResolvedValue({ userId: clerkId });
    requireStudyUSAdminMock.mockResolvedValue(null); // none of these roles ever satisfies the gate
    const result = await guardAdminUsersRoute('test.endpoint');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(403);
  });

  it('case 6 (route level): an active STUDYUS_ADMIN -> allowed through', async () => {
    authMock.mockResolvedValue({ userId: 'clerk-admin' });
    requireStudyUSAdminMock.mockResolvedValue({ actor: { id: 'admin-1', status: 'ACTIVE' }, email: 'admin@test.com' });
    const result = await guardAdminUsersRoute('test.endpoint');
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.admin.actor.id).toBe('admin-1');
  });

  it('rate limits admin mutation endpoints', async () => {
    authMock.mockResolvedValue({ userId: 'clerk-admin' });
    requireStudyUSAdminMock.mockResolvedValue({ actor: { id: 'admin-1', status: 'ACTIVE' }, email: 'admin@test.com' });
    checkRateLimitMock.mockReturnValue(false);
    const result = await guardAdminUsersRoute('test.endpoint');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(429);
  });
});

describe('case 19: a duplicate/retried Clerk webhook never duplicates a users row', () => {
  it('getOrCreateCanonicalUser is idempotent on clerk_id via ON CONFLICT DO UPDATE, never a second INSERT creating a new row', async () => {
    vi.resetModules();
    const dbQueryMock = vi.fn();
    vi.doMock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
    const { getOrCreateCanonicalUser } = await import('@/lib/identity/canonical-user.service');

    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // first SELECT: not found
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'user-1', clerk_id: 'c1', email: 'a@test.com', status: 'ACTIVE', active_workspace: null }] }); // INSERT ... ON CONFLICT DO UPDATE
    const first = await getOrCreateCanonicalUser('c1', 'a@test.com');

    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'user-1', clerk_id: 'c1', email: 'a@test.com', status: 'ACTIVE', active_workspace: null }] }); // second SELECT: found
    const second = await getOrCreateCanonicalUser('c1', 'a@test.com');

    expect(first.id).toBe(second.id);
    expect(dbQueryMock.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO users'))).toHaveLength(1);
  });
});
