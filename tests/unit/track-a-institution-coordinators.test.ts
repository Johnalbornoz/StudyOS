/**
 * Track A -- institution creation and coordinators (Institution Admins).
 * Service rules (duplicates, existing-account assignment, one-time
 * invitations, acceptance checks, removal policy), the DEV-only fixture
 * Platform Admin, route gates and structural guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
const clerkUsersMock = vi.fn();
const clerkInviteMock = vi.fn();
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ users: { getUserList: (...a: any[]) => clerkUsersMock(...a) }, invitations: { createInvitation: (...a: any[]) => clerkInviteMock(...a) } }),
}));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn(async (clerkId: string) => ({ id: `user-of-${clerkId}` })) }));
const auditMock = vi.fn(async () => {});
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: (...a: any[]) => (auditMock as any)(...a) }));
vi.mock('@/lib/identity/display-identity', () => ({ resolveDisplayIdentities: vi.fn(async () => new Map()) }));
const notifyMock = vi.fn(async () => 'n1');
vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: (...a: any[]) => (notifyMock as any)(...a) }));

import {
  createInstitutionProfile,
  slugifyInstitutionName,
  inviteCoordinator,
  acceptCoordinatorInvitation,
  removeCoordinator,
  DuplicateInstitutionError,
  CoordinatorError,
} from '@/services/institution-admin.service';
import { isAdminEmail, DEV_FIXTURE_PLATFORM_ADMIN_EMAIL } from '@/services/admin.service';

type Responder = (sql: string, params: unknown[]) => { rows: any[]; rowCount?: number } | undefined;
const respond = (fn: Responder) => dbQueryMock.mockImplementation(async (sql: string, params: unknown[]) => fn(sql, params) ?? { rows: [], rowCount: 0 });
const sqls = () => dbQueryMock.mock.calls.map((c) => String(c[0]));
const writes = () => sqls().filter((s) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(s));

const ACTIVE_INST = { id: 'inst-A', name: 'Institution E2E A', display_name: null, slug: 'institution-e2e-a', status: 'ACTIVE', created_at: new Date() };

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  clerkUsersMock.mockReset().mockResolvedValue({ data: [] });
  clerkInviteMock.mockReset().mockResolvedValue({ id: 'inv_1' });
  auditMock.mockClear();
  notifyMock.mockClear();
});

describe('DEV-only fixture Platform Admin (allowlist)', () => {
  it('the real allowlisted email is always admin-eligible', () => {
    expect(isAdminEmail('john@jalbornoz.com', { CLERK_SECRET_KEY: 'sk_live_x', VERCEL: '1', VERCEL_ENV: 'production' })).toBe(true);
  });
  it('the fixture email is eligible only on the DEV Clerk test instance (hosted dev target or local)', () => {
    expect(isAdminEmail(DEV_FIXTURE_PLATFORM_ADMIN_EMAIL, { CLERK_SECRET_KEY: 'sk_test_x' })).toBe(true);
    expect(isAdminEmail(DEV_FIXTURE_PLATFORM_ADMIN_EMAIL, { CLERK_SECRET_KEY: 'sk_test_x', VERCEL: '1', VERCEL_TARGET_ENV: 'dev', VERCEL_ENV: 'preview' })).toBe(true);
  });
  it.each([
    ['live Clerk keys', { CLERK_SECRET_KEY: 'sk_live_x' }],
    ['Preview', { CLERK_SECRET_KEY: 'sk_test_x', VERCEL: '1', VERCEL_TARGET_ENV: 'preview', VERCEL_ENV: 'preview' }],
    ['Production', { CLERK_SECRET_KEY: 'sk_test_x', VERCEL: '1', VERCEL_TARGET_ENV: 'production', VERCEL_ENV: 'production' }],
  ])('never on %s', (_label, env) => {
    expect(isAdminEmail(DEV_FIXTURE_PLATFORM_ADMIN_EMAIL, env as any)).toBe(false);
  });
  it('no other fixture identity is ever allowlisted', () => {
    expect(isAdminEmail('studyus-ta-inst-a+clerk_test@example.com', { CLERK_SECRET_KEY: 'sk_test_x' })).toBe(false);
  });
});

describe('Institution creation (INSTITUTION_CREATION)', () => {
  it('slug is derived from the name, accent-free', () => {
    expect(slugifyInstitutionName('  Colegio San José de Cúcuta ')).toBe('colegio-san-jose-de-cucuta');
  });

  it('a duplicate name / slug is refused and nothing is inserted', async () => {
    respond((sql) => (sql.includes('FROM institutions WHERE lower(name)') ? { rows: [{ '?': 1 }] } : undefined));
    await expect(createInstitutionProfile('admin', { name: 'Institution E2E A' })).rejects.toBeInstanceOf(DuplicateInstitutionError);
    expect(writes()).toEqual([]);
  });

  it('stores the full profile, ACTIVE by default, and audits the creation', async () => {
    respond((sql, params) => (sql.startsWith('INSERT INTO institutions') ? { rows: [{ ...ACTIVE_INST, country: params[4], timezone: params[9], locale: params[10] }] } : undefined));
    const inst = await createInstitutionProfile('admin', { name: 'Institution E2E A', country: 'co', timezone: 'America/Bogota', locale: 'es', region: 'Bogotá' });
    const insert = dbQueryMock.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO institutions'))!;
    expect(insert[1]).toEqual(['Institution E2E A', null, 'institution-e2e-a', 'ACTIVE', 'CO', 'Bogotá', null, null, null, 'America/Bogota', 'es']);
    expect(inst.country).toBe('CO');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'INSTITUTION_CREATED', actorUserId: 'admin' }));
  });
});

const institutionLookup: Responder = (sql) => (sql.includes('FROM institutions WHERE id = $1') ? { rows: [ACTIVE_INST] } : undefined);

describe('Coordinator invitation / assignment', () => {
  it('an institution that is not ACTIVE cannot get coordinators', async () => {
    respond((sql) => (sql.includes('FROM institutions WHERE id = $1') ? { rows: [{ ...ACTIVE_INST, status: 'DRAFT' }] } : undefined));
    await expect(inviteCoordinator({ institutionId: 'inst-A', email: 'x@y.com', actorUserId: 'admin' })).rejects.toMatchObject({ code: 'INSTITUTION_NOT_AVAILABLE' });
    expect(writes()).toEqual([]);
  });

  it('an EXISTING StudyUS account is assigned directly (no invitation, no second account)', async () => {
    respond((sql, p) =>
      institutionLookup(sql, p) ??
      (sql.includes('FROM users WHERE lower(email) = $1')
        ? { rows: [{ id: 'teacher-user' }] }
        : sql.includes('INSERT INTO institution_memberships')
          ? { rows: [{ id: 'm1', institution_id: 'inst-A', user_id: 'teacher-user', membership_role: 'INSTITUTION_ADMIN', status: 'APPROVED' }] }
          : undefined)
    );
    const r = await inviteCoordinator({ institutionId: 'inst-A', email: 'Teacher@School.org', actorUserId: 'admin' });
    expect(r).toEqual({ outcome: 'ASSIGNED_EXISTING', membershipId: 'm1', userId: 'teacher-user' });
    expect(sqls().some((s) => s.includes('INSERT INTO institution_admin_invitations'))).toBe(false);
    expect(sqls().some((s) => s.includes('INSERT INTO students') || s.includes("'TEACHER'") && s.startsWith('INSERT INTO user_roles'))).toBe(false);
    expect(clerkUsersMock).not.toHaveBeenCalled();
  });

  it('an account that exists only in Clerk is linked to that same Clerk user', async () => {
    clerkUsersMock.mockResolvedValue({ data: [{ id: 'clerk_9' }] });
    respond((sql, p) =>
      institutionLookup(sql, p) ??
      (sql.includes('INSERT INTO institution_memberships') ? { rows: [{ id: 'm2', institution_id: 'inst-A', user_id: 'user-of-clerk_9', membership_role: 'INSTITUTION_ADMIN', status: 'APPROVED' }] } : undefined)
    );
    const r = await inviteCoordinator({ institutionId: 'inst-A', email: 'new@school.org', actorUserId: 'admin' });
    expect(r).toMatchObject({ outcome: 'ASSIGNED_EXISTING', userId: 'user-of-clerk_9' });
  });

  it('already a coordinator → idempotent, nothing written', async () => {
    respond((sql, p) =>
      institutionLookup(sql, p) ??
      (sql.includes('FROM users WHERE lower(email) = $1') ? { rows: [{ id: 'u1' }] } : sql.includes("membership_role = 'INSTITUTION_ADMIN' AND status = 'APPROVED'") ? { rows: [{ id: 'm1' }] } : undefined)
    );
    expect(await inviteCoordinator({ institutionId: 'inst-A', email: 'a@b.com', actorUserId: 'admin' })).toEqual({ outcome: 'ALREADY_COORDINATOR', membershipId: 'm1' });
    expect(writes()).toEqual([]);
  });

  it('a console-revoked institution administration is never silently re-granted', async () => {
    respond((sql, p) =>
      institutionLookup(sql, p) ??
      (sql.includes('FROM users WHERE lower(email) = $1') ? { rows: [{ id: 'u1' }] } : sql.includes("role = 'INSTITUTION_ADMIN' AND status = 'REVOKED'") ? { rows: [{ '?': 1 }] } : undefined)
    );
    await expect(inviteCoordinator({ institutionId: 'inst-A', email: 'a@b.com', actorUserId: 'admin' })).rejects.toMatchObject({ code: 'ROLE_REVOKED' });
    expect(writes()).toEqual([]);
  });

  it('a new person gets a one-time invitation: only the token HASH is stored; the Clerk email points back to the acceptance page', async () => {
    respond((sql, p) => institutionLookup(sql, p) ?? (sql.includes('INSERT INTO institution_admin_invitations') ? { rows: [{ id: 'inv-1' }] } : undefined));
    const r = await inviteCoordinator({ institutionId: 'inst-A', email: 'Coord@School.org', name: 'Ana', actorUserId: 'admin', acceptBaseUrl: 'https://dev.example' });
    expect(r.outcome).toBe('INVITED');
    const token = (r as any).acceptPath.split('/').pop();
    const insert = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO institution_admin_invitations'))!;
    expect(insert[1][1]).toBe('coord@school.org');
    expect(insert[1][3]).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(insert[1])).not.toContain(token);
    expect(clerkInviteMock).toHaveBeenCalledWith(expect.objectContaining({ emailAddress: 'coord@school.org', redirectUrl: `https://dev.example/invite/coordinator/${token}` }));
  });

  it('a duplicate invitation returns the pending one (no second row)', async () => {
    respond((sql, p) => institutionLookup(sql, p) ?? (sql.includes("AND status = 'PENDING'") && sql.startsWith('SELECT') ? { rows: [{ id: 'inv-1', expires_at: new Date(Date.now() + 1e6) }] } : undefined));
    expect(await inviteCoordinator({ institutionId: 'inst-A', email: 'coord@school.org', actorUserId: 'admin' })).toMatchObject({ outcome: 'ALREADY_INVITED', invitationId: 'inv-1' });
    expect(sqls().some((s) => s.includes('INSERT INTO institution_admin_invitations'))).toBe(false);
  });
});

describe('Invitation acceptance', () => {
  const invitation = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    institution_id: 'inst-A',
    email: 'coord@school.org',
    invitee_name: 'Ana',
    status: 'PENDING',
    expires_at: new Date(Date.now() + 86_400_000),
    accepted_user_id: null,
    invited_by_user_id: 'admin',
    institution_name: 'Institution E2E A',
    institution_status: 'ACTIVE',
    ...over,
  });
  const world = (inv: any): Responder => (sql) =>
    sql.includes('FROM institution_admin_invitations inv JOIN institutions') ? { rows: [inv] } :
    sql.includes("SET status = 'ACCEPTED'") ? { rows: [{ id: 'inv-1' }] } :
    sql.includes('INSERT INTO institution_memberships') ? { rows: [{ id: 'm9', institution_id: 'inst-A', user_id: 'u-coord', membership_role: 'INSTITUTION_ADMIN', status: 'APPROVED' }] } :
    undefined;

  it('the invited email must be the signed-in account\'s (a forwarded link is useless); nothing written', async () => {
    respond(world(invitation()));
    expect(await acceptCoordinatorInvitation('tok'.repeat(10), { userId: 'u-other', email: 'other@school.org' })).toEqual({ outcome: 'EMAIL_MISMATCH' });
    expect(writes()).toEqual([]);
  });

  it('expired → EXPIRED (and marked), revoked → REVOKED, inactive institution → refused', async () => {
    respond(world(invitation({ expires_at: new Date(Date.now() - 1000) })));
    expect((await acceptCoordinatorInvitation('t'.repeat(30), { userId: 'u', email: 'coord@school.org' })).outcome).toBe('EXPIRED');
    expect(sqls().some((s) => s.includes("SET status = 'EXPIRED'"))).toBe(true);
    dbQueryMock.mockReset();
    respond(world(invitation({ status: 'REVOKED' })));
    expect((await acceptCoordinatorInvitation('t'.repeat(30), { userId: 'u', email: 'coord@school.org' })).outcome).toBe('REVOKED');
    dbQueryMock.mockReset();
    respond(world(invitation({ institution_status: 'SUSPENDED' })));
    expect((await acceptCoordinatorInvitation('t'.repeat(30), { userId: 'u', email: 'coord@school.org' })).outcome).toBe('INSTITUTION_NOT_AVAILABLE');
  });

  it('single use: already accepted by someone else → ALREADY_USED; by the same account → ALREADY_ACCEPTED', async () => {
    respond(world(invitation({ status: 'ACCEPTED', accepted_user_id: 'u-coord' })));
    expect((await acceptCoordinatorInvitation('t'.repeat(30), { userId: 'u-x', email: 'coord@school.org' })).outcome).toBe('ALREADY_USED');
    expect((await acceptCoordinatorInvitation('t'.repeat(30), { userId: 'u-coord', email: 'coord@school.org' })).outcome).toBe('ALREADY_ACCEPTED');
  });

  it('accepting claims the PENDING row atomically and grants the capability (no persona)', async () => {
    respond(world(invitation()));
    const r = await acceptCoordinatorInvitation('t'.repeat(30), { userId: 'u-coord', email: 'Coord@School.org' });
    expect(r).toMatchObject({ outcome: 'ACCEPTED', institutionId: 'inst-A' });
    expect(sqls().find((s) => s.includes("SET status = 'ACCEPTED'"))).toMatch(/AND status = 'PENDING'/);
    expect(sqls().some((s) => s.includes('INSERT INTO institution_memberships'))).toBe(true);
    expect(sqls().some((s) => /INSERT INTO user_roles[\s\S]*'(STUDENT|PARENT|TEACHER)'/.test(s))).toBe(false);
  });
});

describe('Coordinator removal policy', () => {
  it('a coordinator cannot remove themself or the last coordinator; a foreign membership id is NOT_FOUND', async () => {
    respond((sql) => (sql.includes('SELECT id, user_id FROM institution_memberships') ? { rows: [{ id: 'm1', user_id: 'me' }] } : undefined));
    await expect(removeCoordinator('inst-A', 'm1', 'me', 'COORDINATOR')).rejects.toMatchObject({ code: 'CANNOT_REMOVE_SELF' });
    dbQueryMock.mockReset();
    respond((sql) => (sql.includes('SELECT id, user_id FROM institution_memberships') ? { rows: [{ id: 'm1', user_id: 'other' }] } : sql.includes('COUNT(*)') ? { rows: [{ n: 1 }] } : undefined));
    await expect(removeCoordinator('inst-A', 'm1', 'me', 'COORDINATOR')).rejects.toMatchObject({ code: 'LAST_COORDINATOR' });
    dbQueryMock.mockReset();
    respond(() => ({ rows: [] }));
    await expect(removeCoordinator('inst-A', 'm-of-B', 'me', 'COORDINATOR')).rejects.toBeInstanceOf(CoordinatorError);
    expect(sqls()[0]).toMatch(/id = \$1 AND institution_id = \$2/);
  });

  it('removal is a soft REVOKE (never a delete), audited', async () => {
    respond((sql) => (sql.includes('SELECT id, user_id FROM institution_memberships') ? { rows: [{ id: 'm1', user_id: 'other' }] } : undefined));
    await removeCoordinator('inst-A', 'm1', 'admin', 'PLATFORM');
    expect(writes()).toEqual([expect.stringMatching(/UPDATE institution_memberships SET status = 'REVOKED'/)]);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'COORDINATOR_REMOVED' }));
  });
});

describe('Structural guards', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
  it('institution creation and Platform Admin coordinator routes are gated by the StudyUS admin guard', () => {
    for (const f of [
      'src/app/api/admin/institutions/route.ts',
      'src/app/api/admin/institutions/[id]/route.ts',
      'src/app/api/admin/institutions/[id]/coordinators/route.ts',
      'src/app/api/admin/institutions/[id]/coordinators/[membershipId]/remove/route.ts',
      'src/app/api/admin/institutions/[id]/coordinator-invitations/[invitationId]/revoke/route.ts',
    ]) {
      const src = read(f);
      expect(src, f).toMatch(/guardAdminUsersRoute\(/);
      expect(src.indexOf('guardAdminUsersRoute('), f).toBeLessThan(src.search(/createInstitutionProfile\(|inviteCoordinator\(|removeCoordinator\(|revokeCoordinatorInvitation\(|updateInstitutionProfile\(|listCoordinators\(|listInstitutionsForPlatformAdmin\(/));
    }
  });
  it('coordinator routes are scoped to an APPROVED admin of THAT institution, before any read or write', () => {
    for (const f of [
      'src/app/api/institutions/[id]/route.ts',
      'src/app/api/institutions/[id]/coordinators/route.ts',
      'src/app/api/institutions/[id]/coordinators/[membershipId]/remove/route.ts',
      'src/app/api/institutions/[id]/coordinator-invitations/[invitationId]/revoke/route.ts',
    ]) {
      const src = read(f);
      expect(src, f).toMatch(/requireInstitutionAdminActor\(id,/);
    }
    expect(read('src/app/api/institutions/[id]/route.ts')).toMatch(/'COORDINATOR'\s*\)/);
  });
  it('institution access and the INSTITUTION workspace require an ACTIVE institution', () => {
    expect(read('src/lib/authorization/index.ts')).toMatch(/i\.status = 'ACTIVE'/);
    expect(read('src/lib/identity/workspace.service.ts')).toMatch(/im\.status = 'APPROVED' AND i\.status = 'ACTIVE'/);
  });
});
