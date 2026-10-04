/**
 * Track A manual-gate fix -- admin / institution review screens identify the
 * PERSON (name + email), resolved server-side, only for rows the viewer is
 * already authorized to see; never an internal id in normal operation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: vi.fn() } }));

const getUserListMock = vi.fn();
const getUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { getUserList: (...a: any[]) => getUserListMock(...a), getUser: (...a: any[]) => getUserMock(...a) } }),
  currentUser: vi.fn(async () => null),
  auth: vi.fn(async () => ({ userId: null })),
}));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: vi.fn(async () => {}) }));

import { resolveDisplayIdentities, formatIdentity } from '@/lib/identity/display-identity';
import { listAllPendingMembershipsAcrossInstitutions, listPendingMembershipsWithEmail } from '@/services/institution.service';
import { detectSyncErrors } from '@/services/user-admin.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  getUserListMock.mockReset().mockResolvedValue({ data: [] });
  getUserMock.mockReset();
});

describe('requester identity', () => {
  it('returns the requester name + email for each pending request, with its own institution', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM institution_memberships im JOIN institutions i')) {
        return { rows: [{ id: 'm1', institution_id: 'inst-A', user_id: 'u1', membership_role: 'TEACHER', status: 'PENDING', requested_at: new Date('2026-10-01'), institution_name: 'Colegio A' }] };
      }
      if (sql.includes('FROM users u WHERE u.id = ANY')) return { rows: [{ id: 'u1', email: 'teresa@example.com', clerk_id: 'c1', name: 'Teresa Docente' }] };
      return { rows: [] };
    });
    const [r] = await listAllPendingMembershipsAcrossInstitutions();
    expect(r).toMatchObject({ id: 'm1', institutionId: 'inst-A', institutionName: 'Colegio A', requesterName: 'Teresa Docente', requesterEmail: 'teresa@example.com', membershipRole: 'TEACHER' });
  });

  it('a teacher with no StudyUs name gets the Clerk name; with none at all, the email alone (rendering never blocked)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ id: 'u1', email: 't@example.com', clerk_id: 'c1', name: null }, { id: 'u2', email: 'x@example.com', clerk_id: 'c2', name: null }] });
    getUserListMock.mockResolvedValue({ data: [{ id: 'c1', firstName: 'Teresa', lastName: 'Docente' }] });
    const ids = await resolveDisplayIdentities(['u1', 'u2']);
    expect(formatIdentity(ids.get('u1'))).toBe('Teresa Docente · t@example.com');
    expect(formatIdentity(ids.get('u2'))).toBe('x@example.com');

    getUserListMock.mockRejectedValue(new Error('clerk down'));
    const fallback = await resolveDisplayIdentities(['u1']);
    expect(formatIdentity(fallback.get('u1'))).toBe('t@example.com');
  });

  it('an institution resolves identities ONLY for its own requesters (tenant scope unchanged)', async () => {
    dbQueryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('WHERE im.institution_id = $1 AND im.status = \'PENDING\'')) {
        expect(params).toEqual(['inst-A']);
        return { rows: [{ id: 'm1', institution_id: 'inst-A', user_id: 'u-of-A', membership_role: 'TEACHER', status: 'PENDING', user_email: 'a@example.com' }] };
      }
      if (sql.includes('FROM users u WHERE u.id = ANY')) {
        expect(params).toEqual([['u-of-A']]);
        return { rows: [{ id: 'u-of-A', email: 'a@example.com', clerk_id: 'c', name: 'Ana' }] };
      }
      return { rows: [] };
    });
    const rows = await listPendingMembershipsWithEmail('inst-A');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userName: 'Ana', userEmail: 'a@example.com', institutionId: 'inst-A' });
  });

  it('the institution pending-request route keeps its own gate: a non-admin of the institution gets 403 before any read', () => {
    const route = read('src/app/api/institutions/[id]/memberships/pending/route.ts');
    expect(route).toMatch(/canAccessInstitution\(/);
    expect(route.indexOf('canAccessInstitution(')).toBeLessThan(route.indexOf('await listPendingMemberships('));
  });

  it('approve / reject behaviour is unchanged (same decide route, same body)', () => {
    const inbox = read('src/app/dashboard/admin/requests/RequestsInbox.tsx');
    expect(inbox).toMatch(/\/api\/admin\/requests\/\$\{membershipId\}\/decide/);
    expect(inbox).toMatch(/decide\(r\.id, 'APPROVED'\)/);
    expect(inbox).toMatch(/decide\(r\.id, 'REJECTED'\)/);
  });
});

describe('Clerk <-> StudyUs inconsistencies', () => {
  it('identifies the affected account (name, email, state, roles) from its own records', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, clerk_id FROM users')) return { rows: [{ id: 'ok', clerk_id: 'c-ok' }, { id: 'gone', clerk_id: 'c-gone' }] };
      if (sql.includes('FROM users u WHERE u.id = ANY')) return { rows: [{ id: 'gone', email: 'gone@example.com', status: 'ACTIVE', is_test: false, created_at: new Date('2026-09-30'), name: 'Ida', roles: ['STUDENT'] }] };
      return { rows: [] };
    });
    getUserMock.mockImplementation(async (clerkId: string) => {
      if (clerkId === 'c-gone') throw new Error('not found');
      return { id: clerkId };
    });
    const result = await detectSyncErrors(50);
    expect(result.usersWithoutClerkMatch).toEqual(['gone']);
    expect(result.accounts).toEqual([expect.objectContaining({ userId: 'gone', email: 'gone@example.com', name: 'Ida', status: 'ACTIVE', roles: ['STUDENT'] })]);
  });

  it('normal admin operation never needs an internal id: rows show the person and link to the user page', () => {
    const inbox = read('src/app/dashboard/admin/requests/RequestsInbox.tsx');
    expect(inbox).toMatch(/who\(r\.requesterName, r\.requesterEmail\)/);
    expect(inbox).toMatch(/who\(a\.name, a\.email\)/);
    expect(inbox).toMatch(/href=\{`\/dashboard\/admin\/users\/\$\{a\.userId\}`\}/);
    expect(inbox).not.toMatch(/Cuenta interna sin usuario de Clerk correspondiente/);
    expect(inbox).not.toMatch(/row-title">\{r\.institutionName\}/);
  });
});
