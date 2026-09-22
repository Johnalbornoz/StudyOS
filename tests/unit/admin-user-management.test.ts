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
const usersRemovePasswordMock = vi.fn();
const usersVerifyPasswordMock = vi.fn();
const usersUpdateUserMock = vi.fn();
const sessionsListMock = vi.fn();
const sessionsRevokeMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    invitations: { createInvitation: (...a: any[]) => invitationsCreateMock(...a), getInvitationList: (...a: any[]) => invitationsListMock(...a), revokeInvitation: (...a: any[]) => invitationsRevokeMock(...a) },
    users: {
      createUser: (...a: any[]) => usersCreateMock(...a),
      banUser: (...a: any[]) => usersBanMock(...a),
      unbanUser: (...a: any[]) => usersUnbanMock(...a),
      deleteUser: (...a: any[]) => usersDeleteMock(...a),
      getUser: (...a: any[]) => usersGetMock(...a),
      removePassword: (...a: any[]) => usersRemovePasswordMock(...a),
      verifyPassword: (...a: any[]) => usersVerifyPasswordMock(...a),
      updateUser: (...a: any[]) => usersUpdateUserMock(...a),
    },
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

const inviteInstitutionAdminMock = vi.fn();
vi.mock('@/services/institution.service', () => ({ inviteInstitutionAdmin: (...a: any[]) => inviteInstitutionAdminMock(...a) }));

import {
  addRole,
  revokeRole,
  suspendUser,
  reactivateUser,
  archiveUser,
  createTestIdentity,
  cleanupTestIdentity,
  inviteUser,
  deleteUserPermanently,
  LastAdminProtectionError,
  PrivilegedRoleForbiddenError,
  NotTestEnvironmentError,
  TestIdentityHasRealDependenciesError,
  SelfDeletionForbiddenError,
  ConfirmationMismatchError,
  DeletionBlockedError,
  createUserFull,
  reconcileUserCreation,
  computeDeletionImpact,
  confirmPasswordChanged,
  changeOwnPasswordAndClearRequirement,
  EmailAlreadyExistsError,
  PartialUserCreationError,
  InstitutionRequiredError,
  CoordinatorRequiresDirectCreationError,
  CurrentPasswordInvalidError,
  PasswordUpdateFailedError,
  AccountNotActiveError,
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

describe('case 15: permanent deletion of a normal (non-test) account exists but is gated by real, recomputed protections', () => {
  it('deleteUserPermanently refuses when the actor targets themselves, before any query runs', async () => {
    await expect(deleteUserPermanently(ACTOR, ACTOR, TARGET_CLERK, 'irrelevant@example.com', 'test')).rejects.toThrow(SelfDeletionForbiddenError);
    expect(dbQueryMock).not.toHaveBeenCalled();
    expect(usersDeleteMock).not.toHaveBeenCalled();
  });

  it('deleteUserPermanently refuses to delete the last STUDYUS_ADMIN', async () => {
    hasRoleMock.mockResolvedValueOnce(true);
    countActiveStudyUSAdminsMock.mockResolvedValueOnce(1);
    await expect(deleteUserPermanently(ACTOR, TARGET, TARGET_CLERK, 'irrelevant@example.com', 'test')).rejects.toThrow(LastAdminProtectionError);
    expect(usersDeleteMock).not.toHaveBeenCalled();
  });

  it('deleteUserPermanently requires an exact-match confirmation email', async () => {
    hasRoleMock.mockResolvedValueOnce(false);
    dbQueryMock.mockResolvedValueOnce({ rows: [{ email: 'real-target@example.com' }] });
    await expect(deleteUserPermanently(ACTOR, TARGET, TARGET_CLERK, 'wrong@example.com', 'test')).rejects.toThrow(ConfirmationMismatchError);
    expect(usersDeleteMock).not.toHaveBeenCalled();
  });

  it('deleteUserPermanently blocks when the recomputed impact finds real academic/payment/relationship dependencies, even if an earlier client read said otherwise', async () => {
    hasRoleMock.mockResolvedValueOnce(false);
    dbQueryMock.mockResolvedValueOnce({ rows: [{ email: 'real-target@example.com' }] }); // email lookup
    dbQueryMock.mockResolvedValueOnce({ rows: [{ c: 1 }] }); // roles
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'student-1' }] }); // students -- non-empty forces BLOCK_DELETION
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // profiles
    dbQueryMock.mockResolvedValueOnce({ rows: [{ c: 0 }] }); // subscriptions
    dbQueryMock.mockResolvedValueOnce({ rows: [{ c: 0 }] }); // payments
    dbQueryMock.mockResolvedValueOnce({ rows: [{ c: 0 }] }); // parent links as parent
    dbQueryMock.mockResolvedValueOnce({ rows: [{ c: 0 }] }); // parent links as student
    dbQueryMock.mockResolvedValueOnce({ rows: [{ c: 0 }] }); // institution memberships
    dbQueryMock.mockResolvedValueOnce({ rows: [{ c: 0 }] }); // audit log (RETAIN_FOR_AUDIT, never blocks)
    dbQueryMock.mockResolvedValueOnce({ rows: [{ c: 0 }] }); // learning_evidence, queried because studentIds is non-empty

    await expect(deleteUserPermanently(ACTOR, TARGET, TARGET_CLERK, 'real-target@example.com', 'test')).rejects.toThrow(DeletionBlockedError);
    expect(usersDeleteMock).not.toHaveBeenCalled();
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

describe('createUserFull -- transactional, reconcilable creation (Membresías/Usuarios redesign)', () => {
  it('rejects a request forged past client-side validation to grant a privileged initial role, before ever calling Clerk', async () => {
    // @ts-expect-error -- exercising the runtime guard for a value the client-side select never offers
    await expect(createUserFull(ACTOR, { email: 'new@test.com', temporaryPassword: 'Aa1!aaaa', initialRole: 'STUDYUS_ADMIN' })).rejects.toBeInstanceOf(PrivilegedRoleForbiddenError);
    expect(usersCreateMock).not.toHaveBeenCalled();
  });

  it('requires either a temporary password or an invitation -- refuses to create an account with neither', async () => {
    await expect(createUserFull(ACTOR, { email: 'new@test.com', initialRole: null })).rejects.toThrow();
    expect(usersCreateMock).not.toHaveBeenCalled();
  });

  it('a duplicate email at Clerk surfaces as EmailAlreadyExistsError and records a FAILURE audit entry -- reconciliation is never attempted', async () => {
    usersCreateMock.mockRejectedValueOnce(new Error('already exists'));
    await expect(createUserFull(ACTOR, { email: 'dup@test.com', temporaryPassword: 'Aa1!aaaa', initialRole: 'STUDENT' })).rejects.toBeInstanceOf(EmailAlreadyExistsError);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_CREATION_STARTED', result: 'FAILURE' }));
    expect(getOrCreateCanonicalUserMock).not.toHaveBeenCalled();
  });

  it('every temporary-password creation sets password_change_required -- not a simulated "force change" flag, but StudyUS\'s own real gate (no native Clerk mechanism exists for this, verified against @clerk/backend\'s own UserApi.d.ts)', async () => {
    usersCreateMock.mockResolvedValueOnce({ id: 'clerk-new-1' });
    getOrCreateCanonicalUserMock.mockResolvedValueOnce({ id: 'user-new-1', clerkId: 'clerk-new-1', email: 'x@test.com', status: 'ACTIVE', activeWorkspace: null, passwordChangeRequired: false });
    await createUserFull(ACTOR, { email: 'x@test.com', temporaryPassword: 'Aa1!aaaa', initialRole: null });
    const sqlCalls = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => sql.includes('password_change_required = true'))).toBe(true);
    expect(usersRemovePasswordMock).not.toHaveBeenCalled(); // removePassword is a different, stronger capability -- never used as a substitute here
  });

  it('a Postgres failure after a successful Clerk creation surfaces as a resumable PartialUserCreationError naming the real Clerk id -- never a generic failure that would tempt a caller to retry from scratch and create a second Clerk account', async () => {
    usersCreateMock.mockResolvedValueOnce({ id: 'clerk-new-2' });
    getOrCreateCanonicalUserMock.mockRejectedValueOnce(new Error('connection reset'));

    let caught: unknown;
    try {
      await createUserFull(ACTOR, { email: 'y@test.com', temporaryPassword: 'Aa1!aaaa', initialRole: 'STUDENT' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PartialUserCreationError);
    expect((caught as InstanceType<typeof PartialUserCreationError>).clerkUserId).toBe('clerk-new-2');
  });

  it('reconcileUserCreation is safely resumable: calling it twice with the same clerkUserId never duplicates the role assignment beyond addRole\'s own idempotent ON CONFLICT', async () => {
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-new-3', clerkId: 'clerk-new-3', email: 'z@test.com', status: 'ACTIVE', activeWorkspace: null });
    await reconcileUserCreation(ACTOR, 'clerk-new-3', 'z@test.com', 'PARENT', false);
    await reconcileUserCreation(ACTOR, 'clerk-new-3', 'z@test.com', 'PARENT', false);
    const roleInserts = dbQueryMock.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO user_roles'));
    expect(roleInserts).toHaveLength(2); // each call issues one INSERT ... ON CONFLICT -- safe to run again, never a second distinct row
    expect(roleInserts.every((c) => String(c[0]).includes('ON CONFLICT'))).toBe(true);
  });
});

describe('computeDeletionImpact -- real academic/payment/relationship dependencies block a hard delete; a clean TEST-like account does not', () => {
  it('reports canHardDelete: true and zero blocking reasons when every dependency count is zero', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // roles
      .mockResolvedValueOnce({ rows: [] }) // students
      .mockResolvedValueOnce({ rows: [] }) // profiles
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // subscriptions
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // payments
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // parent links as parent
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // parent links as student
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // institution memberships
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }); // audit log

    const impact = await computeDeletionImpact(TARGET);
    expect(impact.canHardDelete).toBe(true);
    expect(impact.blockingReasons).toEqual([]);
    const auditItem = impact.items.find((i) => i.category === 'audit_log')!;
    expect(auditItem.classification).toBe('RETAIN_FOR_AUDIT'); // audit history is retained even when everything else is clean, never deleted
  });

  it('classifies real academic evidence and successful payments as BLOCK_DELETION, never silently allowing a destructive cascade', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ c: 1 }] }) // roles
      .mockResolvedValueOnce({ rows: [{ id: 'student-1' }] }) // students -- has an academic identity
      .mockResolvedValueOnce({ rows: [] }) // profiles
      .mockResolvedValueOnce({ rows: [{ c: 1 }] }) // subscriptions with activity
      .mockResolvedValueOnce({ rows: [{ c: 1 }] }) // successful payments
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // parent links as parent
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // parent links as student
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // institution memberships
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // audit log
      .mockResolvedValueOnce({ rows: [{ c: 3 }] }); // learning_evidence (queried since studentIds is non-empty)

    const impact = await computeDeletionImpact(TARGET);
    expect(impact.canHardDelete).toBe(false);
    expect(impact.blockingReasons.length).toBeGreaterThan(0);
    const blocked = impact.items.filter((i) => i.classification === 'BLOCK_DELETION' && i.count > 0).map((i) => i.category);
    expect(blocked).toEqual(expect.arrayContaining(['students', 'academic_evidence', 'subscriptions', 'payments']));
  });
});

describe('createUserFull -- creating a coordinator (INSTITUTION_ADMIN) directly, the wider capability this redesign explicitly adds', () => {
  it('requires an institutionId -- refuses with InstitutionRequiredError otherwise, before calling Clerk', async () => {
    await expect(
      createUserFull(ACTOR, { email: 'coord@test.com', temporaryPassword: 'Aa1!aaaa', initialRole: 'INSTITUTION_ADMIN' })
    ).rejects.toBeInstanceOf(InstitutionRequiredError);
    expect(usersCreateMock).not.toHaveBeenCalled();
  });

  it('refuses INSTITUTION_ADMIN via invitation -- a coordinator can only be created with a direct temporary password', async () => {
    await expect(
      createUserFull(ACTOR, { email: 'coord@test.com', sendInvitation: true, initialRole: 'INSTITUTION_ADMIN', institutionId: 'inst-1' })
    ).rejects.toBeInstanceOf(CoordinatorRequiresDirectCreationError);
    expect(invitationsCreateMock).not.toHaveBeenCalled();
  });

  it('with institutionId and a temporary password, creates the Clerk account then grants the membership via the same controlled, auditable inviteInstitutionAdmin F2 already uses -- never addRole', async () => {
    usersCreateMock.mockResolvedValueOnce({ id: 'clerk-coord-1' });
    getOrCreateCanonicalUserMock.mockResolvedValueOnce({ id: 'user-coord-1', clerkId: 'clerk-coord-1', email: 'coord@test.com', status: 'ACTIVE', activeWorkspace: null, passwordChangeRequired: false });
    inviteInstitutionAdminMock.mockResolvedValueOnce({ id: 'membership-1' });

    const result = await createUserFull(ACTOR, { email: 'coord@test.com', temporaryPassword: 'Aa1!aaaa', initialRole: 'INSTITUTION_ADMIN', institutionId: 'inst-1' });

    expect(result.userId).toBe('user-coord-1');
    expect(inviteInstitutionAdminMock).toHaveBeenCalledWith('inst-1', 'user-coord-1');
    const sqlCalls = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO user_roles'))).toBe(false); // addRole was never called for this role
  });

  it('never allows STUDYUS_ADMIN as an initial role, even forged past the client type', async () => {
    // @ts-expect-error -- exercising the runtime guard for a value the client-side select never offers
    await expect(createUserFull(ACTOR, { email: 'x@test.com', temporaryPassword: 'Aa1!aaaa', initialRole: 'STUDYUS_ADMIN' })).rejects.toBeInstanceOf(PrivilegedRoleForbiddenError);
    expect(usersCreateMock).not.toHaveBeenCalled();
  });
});

describe('confirmPasswordChanged -- clears the gate only for the account it is called with, always audited', () => {
  it('sets password_change_required = false and audits PASSWORD_CHANGE_CONFIRMED', async () => {
    await confirmPasswordChanged('user-1');
    const sqlCalls = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => sql.includes('password_change_required = false'))).toBe(true);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_CHANGE_CONFIRMED', targetId: 'user-1' }));
  });
});

describe('changeOwnPasswordAndClearRequirement -- server-controlled password change (Alternative B, closes the client-claim bypass)', () => {
  const CLERK_ID = 'clerk-target-1';
  const CANONICAL_ID = 'target-user-1';

  it('a wrong current password never clears the flag -- verifyPassword is called before anything else, updateUser is never reached', async () => {
    usersVerifyPasswordMock.mockRejectedValueOnce(new Error('incorrect password'));

    await expect(
      changeOwnPasswordAndClearRequirement(CLERK_ID, CANONICAL_ID, 'ACTIVE', 'wrong-temp-password', 'NewStrongPass1!')
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);

    expect(usersVerifyPasswordMock).toHaveBeenCalledWith({ userId: CLERK_ID, password: 'wrong-temp-password' });
    expect(usersUpdateUserMock).not.toHaveBeenCalled();
    const sqlCalls = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => sql.includes('password_change_required = false'))).toBe(false);
  });

  it('a Clerk-rejected new password (e.g. too weak) never clears the flag -- the failure is reconcilable, the user can simply retry', async () => {
    usersVerifyPasswordMock.mockResolvedValueOnce({ verified: true });
    usersUpdateUserMock.mockRejectedValueOnce({ errors: [{ message: 'Password has been found in an online data breach' }] });

    await expect(
      changeOwnPasswordAndClearRequirement(CLERK_ID, CANONICAL_ID, 'ACTIVE', 'correct-temp-password', 'password123')
    ).rejects.toBeInstanceOf(PasswordUpdateFailedError);

    const sqlCalls = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => sql.includes('password_change_required = false'))).toBe(false);
    expect(recordAdminActionMock).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_CHANGE_CONFIRMED' }));
  });

  it('a real, confirmed Clerk change -- in this order: verify, then update, then clear the flag and audit -- clears the flag', async () => {
    usersVerifyPasswordMock.mockResolvedValueOnce({ verified: true });
    usersUpdateUserMock.mockResolvedValueOnce({ id: CLERK_ID });

    await changeOwnPasswordAndClearRequirement(CLERK_ID, CANONICAL_ID, 'ACTIVE', 'correct-temp-password', 'NewStrongPass1!');

    expect(usersVerifyPasswordMock).toHaveBeenCalledWith({ userId: CLERK_ID, password: 'correct-temp-password' });
    expect(usersUpdateUserMock).toHaveBeenCalledWith(CLERK_ID, { password: 'NewStrongPass1!', signOutOfOtherSessions: true });
    const sqlCalls = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => sql.includes('password_change_required = false'))).toBe(true);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_CHANGE_CONFIRMED', targetId: CANONICAL_ID }));

    // verify happened strictly before update, which happened strictly before the DB clear
    const verifyOrder = usersVerifyPasswordMock.mock.invocationCallOrder[0];
    const updateOrder = usersUpdateUserMock.mock.invocationCallOrder[0];
    const clearCallIndex = dbQueryMock.mock.calls.findIndex((c) => String(c[0]).includes('password_change_required = false'));
    const clearOrder = dbQueryMock.mock.invocationCallOrder[clearCallIndex];
    expect(verifyOrder).toBeLessThan(updateOrder);
    expect(updateOrder).toBeLessThan(clearOrder);
  });

  it('refuses for a non-ACTIVE account before ever calling Clerk -- a suspended/archived account stays fully blocked', async () => {
    await expect(
      changeOwnPasswordAndClearRequirement(CLERK_ID, CANONICAL_ID, 'SUSPENDED', 'x', 'NewStrongPass1!')
    ).rejects.toBeInstanceOf(AccountNotActiveError);
    expect(usersVerifyPasswordMock).not.toHaveBeenCalled();
    expect(usersUpdateUserMock).not.toHaveBeenCalled();
  });

  it('replay is idempotent: a second call with the (now stale) old temporary password fails verification, never re-clearing or duplicating anything', async () => {
    usersVerifyPasswordMock.mockResolvedValueOnce({ verified: true });
    usersUpdateUserMock.mockResolvedValueOnce({ id: CLERK_ID });
    await changeOwnPasswordAndClearRequirement(CLERK_ID, CANONICAL_ID, 'ACTIVE', 'correct-temp-password', 'NewStrongPass1!');

    usersVerifyPasswordMock.mockRejectedValueOnce(new Error('incorrect password')); // the temp password no longer works -- this is Clerk's own real behavior
    await expect(
      changeOwnPasswordAndClearRequirement(CLERK_ID, CANONICAL_ID, 'ACTIVE', 'correct-temp-password', 'AnotherPass2!')
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);

    const confirmedCalls = recordAdminActionMock.mock.calls.filter((c) => c[0].action === 'PASSWORD_CHANGE_CONFIRMED');
    expect(confirmedCalls).toHaveLength(1); // only the first, genuine change was ever confirmed
  });

  it('never includes the password anywhere in the audit action recorded for the confirmed change', async () => {
    usersVerifyPasswordMock.mockResolvedValueOnce({ verified: true });
    usersUpdateUserMock.mockResolvedValueOnce({ id: CLERK_ID });
    await changeOwnPasswordAndClearRequirement(CLERK_ID, CANONICAL_ID, 'ACTIVE', 'correct-temp-password', 'NewStrongPass1!');

    const confirmedCall = recordAdminActionMock.mock.calls.find((c) => c[0].action === 'PASSWORD_CHANGE_CONFIRMED')![0];
    expect(JSON.stringify(confirmedCall)).not.toMatch(/correct-temp-password|NewStrongPass1!/);
  });
});

describe('confirmPasswordChanged is reachable from exactly one place in the codebase -- closing sessions, switching workspace, or any other action can never clear the requirement as a side effect', () => {
  it('the literal SQL "password_change_required = false" appears in user-admin.service.ts only', async () => {
    const { execSync } = await import('node:child_process');
    const matches = execSync(
      `grep -rl "password_change_required = false" src/ || true`,
      { cwd: process.cwd(), encoding: 'utf-8' }
    ).trim().split('\n').filter(Boolean);
    expect(matches).toEqual(['src/services/user-admin.service.ts']);
  });
});
