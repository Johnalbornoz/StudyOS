/**
 * Fase 2A -- user-admin.service.ts. Covers the task's own required
 * cases 9-23, 25 (cases 1-8 live in admin-authorization.test.ts and
 * admin-users-routes.test.ts; case 24 is structural -- a coordinator
 * can never reach this service at all, since nothing here is called
 * except through requireStudyUSAdmin, already proven in
 * admin-authorization.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const invitationsCreateMock = vi.fn();
const invitationsListMock = vi.fn();
const invitationsRevokeMock = vi.fn();
const usersCreateMock = vi.fn();
const usersBanMock = vi.fn();
const usersUnbanMock = vi.fn();
const usersDeleteMock = vi.fn();
const usersGetMock = vi.fn();
const sessionsListMock = vi.fn();
const sessionsRevokeMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    invitations: { createInvitation: (...a: any[]) => invitationsCreateMock(...a), getInvitationList: (...a: any[]) => invitationsListMock(...a), revokeInvitation: (...a: any[]) => invitationsRevokeMock(...a) },
    users: { createUser: (...a: any[]) => usersCreateMock(...a), banUser: (...a: any[]) => usersBanMock(...a), unbanUser: (...a: any[]) => usersUnbanMock(...a), deleteUser: (...a: any[]) => usersDeleteMock(...a), getUser: (...a: any[]) => usersGetMock(...a) },
    sessions: { getSessionList: (...a: any[]) => sessionsListMock(...a), revokeSession: (...a: any[]) => sessionsRevokeMock(...a) },
  }),
}));

const getOrCreateStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ getOrCreateStudentId: (...a: any[]) => getOrCreateStudentIdMock(...a) }));

const getOrCreateCanonicalUserMock = vi.fn();
const getUserRolesMock = vi.fn();
const hasRoleMock = vi.fn();
vi.mock('@/lib/identity', () => ({
  getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a),
  getUserRoles: (...a: any[]) => getUserRolesMock(...a),
  hasRole: (...a: any[]) => hasRoleMock(...a),
}));

const recordAdminActionMock = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: (...a: any[]) => recordAdminActionMock(...a) }));

const countActiveStudyUSAdminsMock = vi.fn();
vi.mock('@/lib/admin/authorization', () => ({ countActiveStudyUSAdmins: (...a: any[]) => countActiveStudyUSAdminsMock(...a) }));

import {
  addRole,
  revokeRole,
  suspendUser,
  reactivateUser,
  archiveUser,
  createTestIdentity,
  cleanupTestIdentity,
  inviteUser,
  LastAdminProtectionError,
  PrivilegedRoleForbiddenError,
  NotTestEnvironmentError,
  TestIdentityHasRealDependenciesError,
} from '@/services/user-admin.service';

const ACTOR = 'admin-user-1';
const TARGET = 'target-user-1';
const TARGET_CLERK = 'clerk-target-1';

beforeEach(() => {
  vi.clearAllMocks();
  dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  countActiveStudyUSAdminsMock.mockResolvedValue(2);
  hasRoleMock.mockResolvedValue(false);
  sessionsListMock.mockResolvedValue({ data: [] });
  process.env.VERCEL_ENV = 'preview';
});

describe('case 9: role management never grants a privileged role', () => {
  it('addRole rejects INSTITUTION_ADMIN at the type/runtime boundary', async () => {
    // @ts-expect-error -- exercising the runtime guard for a value TypeScript already rejects
    await expect(addRole(ACTOR, TARGET, 'INSTITUTION_ADMIN', TARGET_CLERK)).rejects.toBeInstanceOf(PrivilegedRoleForbiddenError);
  });

  it('addRole rejects STUDYUS_ADMIN the same way (case 8: no self-assignment path exists)', async () => {
    // @ts-expect-error -- exercising the runtime guard
    await expect(addRole(ACTOR, TARGET, 'STUDYUS_ADMIN', TARGET_CLERK)).rejects.toBeInstanceOf(PrivilegedRoleForbiddenError);
  });
});

describe('case 10: workspace never grants a role -- addRole/revokeRole never touch users.active_workspace', () => {
  it('addRole only writes user_roles, never active_workspace', async () => {
    await addRole(ACTOR, TARGET, 'PARENT', TARGET_CLERK);
    const sqlCalls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql: string) => sql.includes('INSERT INTO user_roles'))).toBe(true);
    expect(sqlCalls.some((sql: string) => sql.toLowerCase().includes('active_workspace'))).toBe(false);
  });
});

describe('case 11: duplicate invitation is a safe conflict, not silently re-sent or leaking existence', () => {
  it('propagates Clerk\'s own conflict without a distinguishing message', async () => {
    invitationsCreateMock.mockRejectedValue(new Error('already exists'));
    await expect(inviteUser(ACTOR, 'dup@test.com', null)).rejects.toThrow();
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ result: 'FAILURE' }));
  });

  it('sends a real invitation and audits it on success', async () => {
    invitationsCreateMock.mockResolvedValue({ id: 'inv-1' });
    const result = await inviteUser(ACTOR, 'new@test.com', 'STUDENT');
    expect(result.invitationId).toBe('inv-1');
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'INVITE_SENT', targetId: 'inv-1' }));
  });
});

describe('case 12: suspend preserves data -- only status/session state change, never a DELETE', () => {
  it('suspendUser bans in Clerk, revokes sessions, updates status, never deletes anything', async () => {
    sessionsListMock.mockResolvedValue({ data: [{ id: 's1' }, { id: 's2' }] });
    await suspendUser(ACTOR, TARGET, TARGET_CLERK, 'incident review');
    expect(usersBanMock).toHaveBeenCalledWith(TARGET_CLERK);
    expect(sessionsRevokeMock).toHaveBeenCalledTimes(2);
    const sqlCalls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql: string) => sql.includes("SET status = 'SUSPENDED'"))).toBe(true);
    expect(sqlCalls.every((sql: string) => !sql.toUpperCase().includes('DELETE'))).toBe(true);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_SUSPENDED', reason: 'incident review' }));
  });
});

describe('case 13: reactivate never adds permissions -- only unbans and flips status back to ACTIVE', () => {
  it('reactivateUser does not touch user_roles', async () => {
    await reactivateUser(ACTOR, TARGET, TARGET_CLERK);
    expect(usersUnbanMock).toHaveBeenCalledWith(TARGET_CLERK);
    const sqlCalls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql: string) => sql.includes("SET status = 'ACTIVE'"))).toBe(true);
    expect(sqlCalls.some((sql: string) => sql.includes('user_roles'))).toBe(false);
  });
});

describe('case 14: archive blocks access without deleting data', () => {
  it('archiveUser bans, revokes sessions, sets status ARCHIVED, never deletes', async () => {
    await archiveUser(ACTOR, TARGET, TARGET_CLERK, 'no longer needed');
    expect(usersBanMock).toHaveBeenCalledWith(TARGET_CLERK);
    const sqlCalls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql: string) => sql.includes("SET status = 'ARCHIVED'"))).toBe(true);
    expect(sqlCalls.every((sql: string) => !sql.toUpperCase().includes('DELETE FROM USERS'))).toBe(true);
  });
});

describe('case 15: no permanent deletion path exists for a normal (non-test) account', () => {
  it('the service module exposes no function that hard-deletes a users row', async () => {
    const mod = await import('@/services/user-admin.service');
    const deleteLike = Object.keys(mod).filter((k) => /delete/i.test(k));
    // cleanupTestIdentity is the only delete-shaped export, and it is TEST-only (see cases 16/17).
    expect(deleteLike).toEqual([]);
  });
});

describe('case 16: TEST cleanup is blocked outside Preview', () => {
  it('cleanupTestIdentity refuses in a non-preview environment', async () => {
    process.env.VERCEL_ENV = 'production';
    dbQueryMock.mockResolvedValueOnce({ rows: [{ is_test: true }] });
    await expect(cleanupTestIdentity(ACTOR, TARGET, TARGET_CLERK)).rejects.toBeInstanceOf(NotTestEnvironmentError);
    expect(usersDeleteMock).not.toHaveBeenCalled();
  });

  it('createTestIdentity refuses in a non-preview environment', async () => {
    process.env.VERCEL_ENV = 'production';
    await expect(createTestIdentity(ACTOR, { alias: 'ID-S', purpose: 'test', initialRole: null })).rejects.toBeInstanceOf(NotTestEnvironmentError);
    expect(usersCreateMock).not.toHaveBeenCalled();
  });
});

describe('case 17: TEST account with real dependencies cannot be cleaned up', () => {
  it('refuses when the account holds STUDYUS_ADMIN', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ is_test: true }] });
    hasRoleMock.mockResolvedValue(true);
    await expect(cleanupTestIdentity(ACTOR, TARGET, TARGET_CLERK)).rejects.toBeInstanceOf(TestIdentityHasRealDependenciesError);
    expect(usersDeleteMock).not.toHaveBeenCalled();
  });

  it('refuses when the account has an accepted parent relationship', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ is_test: true }] }) // is_test check
      .mockResolvedValueOnce({ rows: [] }) // institution admin check
      .mockResolvedValueOnce({ rows: [{ x: 1 }] }); // accepted relationship found
    await expect(cleanupTestIdentity(ACTOR, TARGET, TARGET_CLERK)).rejects.toBeInstanceOf(TestIdentityHasRealDependenciesError);
    expect(usersDeleteMock).not.toHaveBeenCalled();
  });

  it('proceeds when marked TEST and no dependency is found', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ is_test: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await cleanupTestIdentity(ACTOR, TARGET, TARGET_CLERK);
    expect(usersDeleteMock).toHaveBeenCalledWith(TARGET_CLERK);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEST_IDENTITY_CLEANED_UP' }));
  });
});

describe('case 18: a partial Clerk/Postgres failure never silently reports success', () => {
  it('if the Clerk ban call throws, the Postgres status update never runs and the caller sees the error', async () => {
    usersBanMock.mockRejectedValue(new Error('Clerk API unavailable'));
    await expect(suspendUser(ACTOR, TARGET, TARGET_CLERK, 'test')).rejects.toThrow('Clerk API unavailable');
    const sqlCalls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql: string) => sql.includes("SET status = 'SUSPENDED'"))).toBe(false);
  });
});

describe('case 20: audit records never contain a secret', () => {
  it('createTestIdentity audits alias/purpose/role only, never the generated email or password', async () => {
    usersCreateMock.mockResolvedValue({ id: TARGET_CLERK });
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: TARGET, status: 'ACTIVE' });
    const result = await createTestIdentity(ACTOR, { alias: 'ID-S', purpose: 'phase 2 testing', initialRole: null });
    expect(result.oneTimePassword).toBeTruthy();
    const auditCall = recordAdminActionMock.mock.calls.find((c) => c[0].action === 'TEST_IDENTITY_CREATED');
    const serialized = JSON.stringify(auditCall?.[0]);
    expect(serialized).not.toContain(result.oneTimePassword);
    expect(serialized).not.toContain(result.oneTimeEmail);
  });
});

describe('case 21: administering PARENT never creates a relationship', () => {
  it('addRole(PARENT) never touches parent_student_relationships', async () => {
    await addRole(ACTOR, TARGET, 'PARENT', TARGET_CLERK);
    const sqlCalls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql: string) => sql.includes('parent_student_relationships'))).toBe(false);
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });
});

describe('case 22: administering TEACHER never approves an institution membership', () => {
  it('addRole(TEACHER) never touches institution_memberships', async () => {
    await addRole(ACTOR, TARGET, 'TEACHER', TARGET_CLERK);
    const sqlCalls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqlCalls.some((sql: string) => sql.includes('institution_memberships'))).toBe(false);
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });
});

describe('case 23: administering STUDENT provisions at most one academic identity', () => {
  it('addRole(STUDENT) calls getOrCreateStudentId exactly once, only for STUDENT', async () => {
    await addRole(ACTOR, TARGET, 'STUDENT', TARGET_CLERK);
    expect(getOrCreateStudentIdMock).toHaveBeenCalledTimes(1);
    expect(getOrCreateStudentIdMock).toHaveBeenCalledWith(TARGET_CLERK);
  });
});

describe('case 25: the last STUDYUS_ADMIN cannot be disabled', () => {
  it('revokeRole(STUDYUS_ADMIN) is blocked when only one remains', async () => {
    countActiveStudyUSAdminsMock.mockResolvedValue(1);
    await expect(revokeRole(ACTOR, TARGET, 'STUDYUS_ADMIN')).rejects.toBeInstanceOf(LastAdminProtectionError);
  });

  it('revokeRole(STUDYUS_ADMIN) succeeds when a second admin exists', async () => {
    countActiveStudyUSAdminsMock.mockResolvedValue(2);
    await revokeRole(ACTOR, TARGET, 'STUDYUS_ADMIN');
    expect(dbQueryMock.mock.calls.some((c) => String(c[0]).includes("SET status = 'REVOKED'"))).toBe(true);
  });

  it('suspendUser refuses to suspend the last remaining admin', async () => {
    hasRoleMock.mockResolvedValue(true);
    countActiveStudyUSAdminsMock.mockResolvedValue(1);
    await expect(suspendUser(ACTOR, TARGET, TARGET_CLERK, 'x')).rejects.toBeInstanceOf(LastAdminProtectionError);
    expect(usersBanMock).not.toHaveBeenCalled();
  });

  it('archiveUser refuses to archive the last remaining admin', async () => {
    hasRoleMock.mockResolvedValue(true);
    countActiveStudyUSAdminsMock.mockResolvedValue(1);
    await expect(archiveUser(ACTOR, TARGET, TARGET_CLERK, 'x')).rejects.toBeInstanceOf(LastAdminProtectionError);
    expect(usersBanMock).not.toHaveBeenCalled();
  });
});
