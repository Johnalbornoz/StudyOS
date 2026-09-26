/**
 * Admin/Auth reset block -- A01-UX-01, A01-UX-02, A01-LOGIC-01, A01-LOGIC-02.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redirectMock, getUserListMock, dbQueryMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getUserListMock: vi.fn(),
  dbQueryMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { getUserList: getUserListMock } }),
}));
vi.mock('@/lib/db', () => ({ db: { query: dbQueryMock } }));

import { resolveShellContext, isAdminRoute } from '@/lib/admin/shell-context';
import { ADMIN_HOME, ADMIN_SECTIONS } from '@/lib/admin/sections';
import { buildAdminNav } from '@/lib/lx/workspace-navigation';
import { buildLearnerNav } from '@/lib/lx/learner-navigation';
import {
  classifyIdentityInconsistencies,
  detectIdentityInconsistencies,
  findClerkIdsMissingInClerk,
} from '@/services/identity-reconciliation.service';
import AdminIndexPage from '@/app/dashboard/admin/page';

beforeEach(() => {
  redirectMock.mockClear();
  getUserListMock.mockReset();
  dbQueryMock.mockReset();
});

describe('A01-UX-01 -- legacy /dashboard/admin', () => {
  it('redirects to the console Overview', () => {
    expect(() => AdminIndexPage()).toThrow(`NEXT_REDIRECT:${ADMIN_HOME}`);
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/admin/overview');
  });

  it('the Administration sidebar link lands on Overview', () => {
    const nav = buildLearnerNav({ isAdmin: true, debtCount: 0, notifCount: 0, assignmentCount: 0 });
    const admin = nav.flatMap((g) => g.items).find((i) => i.key === 'admin');
    expect(admin?.href).toBe('/dashboard/admin/overview');
  });
});

describe('A01-UX-02 / A01-LOGIC-01 -- shell context', () => {
  it('recognizes admin routes only', () => {
    expect(isAdminRoute('/dashboard/admin')).toBe(true);
    expect(isAdminRoute('/dashboard/admin/users/abc')).toBe(true);
    expect(isAdminRoute('/dashboard/administrator')).toBe(false);
    expect(isAdminRoute('/dashboard')).toBe(false);
    expect(isAdminRoute(null)).toBe(false);
  });

  it('a multi-role admin on an admin route is presented as ADMIN even when STUDENT is the stored workspace', () => {
    const ctx = resolveShellContext({
      pathname: '/dashboard/admin/overview',
      available: ['STUDENT', 'ADMIN'],
      stored: 'STUDENT',
      defaultWorkspace: 'STUDENT',
    });
    expect(ctx).toEqual({ workspace: 'ADMIN', redirectTo: null });
  });

  it('outside admin routes the stored workspace is kept (Student role is preserved)', () => {
    const ctx = resolveShellContext({
      pathname: '/dashboard/subjects',
      available: ['STUDENT', 'ADMIN'],
      stored: 'STUDENT',
      defaultWorkspace: 'STUDENT',
    });
    expect(ctx).toEqual({ workspace: 'STUDENT', redirectTo: null });
  });

  it('an admin-only account landing on /dashboard goes to the console instead of a Student home', () => {
    const ctx = resolveShellContext({ pathname: '/dashboard', available: ['ADMIN'], stored: null, defaultWorkspace: 'ADMIN' });
    expect(ctx).toEqual({ workspace: 'ADMIN', redirectTo: ADMIN_HOME });
  });

  it('a non-admin on an admin route is never presented as ADMIN (pages still deny access)', () => {
    const ctx = resolveShellContext({ pathname: '/dashboard/admin/users', available: ['STUDENT'], stored: 'STUDENT', defaultWorkspace: 'STUDENT' });
    expect(ctx.workspace).toBe('STUDENT');
  });

  it('the ADMIN workspace gets its own navigation with every console section', () => {
    const items = buildAdminNav().flatMap((g) => g.items);
    expect(items.map((i) => i.href)).toEqual(ADMIN_SECTIONS.map((s) => s.href));
    expect(items.every((i) => typeof i.label === 'string' && i.label.length > 0)).toBe(true);
  });
});

describe('A01-LOGIC-02 -- Clerk <-> StudyOS reconciliation', () => {
  const db = [
    { id: 'u1', clerkId: 'user_a', email: 'alice@example.com', status: 'ACTIVE', createdAt: null },
    { id: 'u2', clerkId: 'user_gone', email: 'bob@example.com', status: 'ACTIVE', createdAt: null },
  ];
  const clerk = [
    { id: 'user_a', email: 'alice@example.com', createdAt: null },
    { id: 'user_new', email: 'carol@example.com', createdAt: null },
  ];

  it('detects both directions, with masked emails', () => {
    const items = classifyIdentityInconsistencies(db, clerk);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'DB_WITHOUT_CLERK', userId: 'u2', emailMasked: 'bo*@example.com' });
    expect(items[1]).toMatchObject({ kind: 'CLERK_WITHOUT_DB', userId: null, emailMasked: 'ca***@example.com' });
    expect(JSON.stringify(items)).not.toContain('bob@example.com');
  });

  it('reports zero inconsistencies when both sides match', () => {
    expect(classifyIdentityInconsistencies([db[0]], [clerk[0]])).toEqual([]);
  });

  it('excludes technical identities and reports Clerk-unreachable as unverified, never as zero', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    getUserListMock.mockRejectedValue(new Error('network'));
    const report = await detectIdentityInconsistencies();
    expect(dbQueryMock.mock.calls[0][0]).toContain('NOT is_system');
    expect(report.clerkReachable).toBe(false);
    expect(report.clerkUsers).toBeNull();
  });

  it('end to end with a reachable Clerk', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ id: 'u2', clerk_id: 'user_gone', email: 'bob@example.com', status: 'ACTIVE', created_at: null }] });
    getUserListMock.mockResolvedValue({ data: [{ id: 'user_new', emailAddresses: [{ id: 'e1', emailAddress: 'carol@example.com' }], primaryEmailAddressId: 'e1', createdAt: 0 }] });
    const report = await detectIdentityInconsistencies();
    expect(report.items.map((i) => i.kind)).toEqual(['DB_WITHOUT_CLERK', 'CLERK_WITHOUT_DB']);
  });

  it('per-row sync check: missing ids are flagged, unreachable Clerk yields null', async () => {
    getUserListMock.mockResolvedValue({ data: [{ id: 'user_a' }] });
    expect(await findClerkIdsMissingInClerk(['user_a', 'user_gone'])).toEqual(new Set(['user_gone']));
    getUserListMock.mockRejectedValue(new Error('down'));
    expect(await findClerkIdsMissingInClerk(['user_a'])).toBeNull();
  });
});
