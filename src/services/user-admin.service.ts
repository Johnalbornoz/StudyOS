/**
 * Fase 2A -- secure user administration. Clerk remains the exclusive
 * authority over authentication, credentials, verified email,
 * passwords, MFA, and sessions (INV-ADMIN2A-04): this file never
 * stores, returns, or logs a password, token, cookie, or session
 * value -- every Clerk interaction goes through `clerkClient()`
 * (`@clerk/nextjs/server`), and every write to our own tables records
 * only role/status/workspace/test-metadata, never identity credentials.
 *
 * Every mutating function here takes `actorUserId` (the F1 canonical
 * id of the acting STUDYUS_ADMIN, already resolved by the caller via
 * `requireStudyUSAdmin` -- never re-derived from client input) and
 * writes exactly one `admin_audit_log` row per call, success or
 * failure, via `recordAdminAction`.
 */
import { clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getOrCreateCanonicalUser, getUserRoles, hasRole, type Role, type SelfServiceRole } from '@/lib/identity';
import { recordAdminAction } from '@/lib/admin/audit';
import { countActiveStudyUSAdmins } from '@/lib/admin/authorization';

export class LastAdminProtectionError extends Error {
  constructor() {
    super('LAST_ADMIN_PROTECTED');
  }
}
export class PrivilegedRoleForbiddenError extends Error {
  constructor() {
    super('PRIVILEGED_ROLE_FORBIDDEN');
  }
}
export class NotTestEnvironmentError extends Error {
  constructor() {
    super('NOT_PREVIEW_ENVIRONMENT');
  }
}
export class TestIdentityHasRealDependenciesError extends Error {
  constructor(public dependencies: string[]) {
    super('TEST_IDENTITY_HAS_DEPENDENCIES');
  }
}

const INVITABLE_ROLES: readonly SelfServiceRole[] = ['STUDENT', 'PARENT', 'TEACHER'];

function isPreviewEnvironment(): boolean {
  return process.env.VERCEL_ENV === 'preview';
}

// ---------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------

export interface UserListFilters {
  query?: string;
  role?: Role;
  status?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  workspace?: string;
  isTest?: boolean;
  institutionId?: string;
}

export interface UserListItem {
  userId: string;
  displayLabel: string;
  status: string;
  activeWorkspace: string | null;
  roles: string[];
  isTest: boolean;
  hasLicense: boolean;
  syncState: 'OK' | 'CLERK_MISSING';
  createdAt: string;
}

export interface PendingInvitationItem {
  invitationId: string;
  emailMasked: string;
  intendedRole: string | null;
  createdAt: string;
}

/** Opaque, paginated, search/filter-capable listing. Never returns a raw Clerk id or DB row id to the client beyond the opaque `userId` the rest of this API already treats as an identifier. */
export async function listUsers(filters: UserListFilters, page: number, pageSize: number): Promise<{ items: UserListItem[]; totalCount: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (filters.query) {
    conditions.push(`(u.email ILIKE $${i} OR u.test_alias ILIKE $${i})`);
    params.push(`%${filters.query}%`);
    i++;
  }
  if (filters.status) {
    conditions.push(`u.status = $${i}`);
    params.push(filters.status);
    i++;
  }
  if (filters.workspace) {
    conditions.push(`u.active_workspace = $${i}`);
    params.push(filters.workspace);
    i++;
  }
  if (typeof filters.isTest === 'boolean') {
    conditions.push(`u.is_test = $${i}`);
    params.push(filters.isTest);
    i++;
  }
  if (filters.role) {
    conditions.push(`EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = $${i} AND ur.status = 'ACTIVE')`);
    params.push(filters.role);
    i++;
  }
  if (filters.institutionId) {
    conditions.push(`EXISTS (SELECT 1 FROM institution_memberships im WHERE im.user_id = u.id AND im.institution_id = $${i})`);
    params.push(filters.institutionId);
    i++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const countResult = await db.query(`SELECT COUNT(*)::int AS c FROM users u ${whereClause}`, params);
  const rowsResult = await db.query(
    `SELECT u.id, u.email, u.status, u.active_workspace, u.is_test, u.created_at,
            EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_id IN (SELECT id FROM students WHERE user_id = u.id) AND s.status IN ('active','past_due','reactivated')) AS has_license
     FROM users u ${whereClause} ORDER BY u.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...params, pageSize, offset]
  );

  const items: UserListItem[] = [];
  for (const row of rowsResult.rows) {
    const roles = await getUserRoles(row.id);
    items.push({
      userId: row.id,
      displayLabel: row.is_test ? '(cuenta de prueba)' : maskEmail(row.email),
      status: row.status,
      activeWorkspace: row.active_workspace,
      roles: roles.map((r) => r.role),
      isTest: row.is_test,
      hasLicense: row.has_license,
      syncState: 'OK',
      createdAt: new Date(row.created_at).toISOString(),
    });
  }

  return { items, totalCount: countResult.rows[0]?.c ?? 0 };
}

function maskEmail(email: string | null): string {
  if (!email) return '(sin correo)';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/** Pending Clerk invitations not yet reflected in `users` -- merged into the same list surface by the UI, never inventing a `users` row for them. */
export async function listPendingInvitations(query?: string): Promise<PendingInvitationItem[]> {
  const client = await clerkClient();
  const result = await client.invitations.getInvitationList({ status: 'pending', query, limit: 100 });
  return result.data.map((inv) => ({
    invitationId: inv.id,
    emailMasked: maskEmail(inv.emailAddress),
    intendedRole: (inv.publicMetadata as any)?.intendedRole ?? null,
    createdAt: new Date(inv.createdAt).toISOString(),
  }));
}

export interface UserDetail extends UserListItem {
  profiles: { type: string; id: string }[];
  institutionMemberships: { institutionId: string; institutionName: string; role: string; status: string }[];
  auditHistory: Array<{ action: string; occurredAt: string; result: string; reason: string | null }>;
  statusChangedAt: string | null;
  testMetadata: { alias: string | null; purpose: string | null; reviewAt: string | null } | null;
}

export async function getClerkIdForCanonicalUser(userId: string): Promise<string | null> {
  const result = await db.query(`SELECT clerk_id FROM users WHERE id = $1`, [userId]);
  return result.rows[0]?.clerk_id ?? null;
}

export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const userResult = await db.query(
    `SELECT id, email, status, active_workspace, is_test, test_alias, test_purpose, test_review_at, status_changed_at, created_at,
            EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_id IN (SELECT id FROM students WHERE user_id = users.id) AND s.status IN ('active','past_due','reactivated')) AS has_license
     FROM users WHERE id = $1`,
    [userId]
  );
  if (userResult.rows.length === 0) return null;
  const row = userResult.rows[0];

  const [roles, profiles, memberships, auditHistory] = await Promise.all([
    getUserRoles(userId),
    db.query(`SELECT id FROM students WHERE user_id = $1`, [userId]).then((r) => r.rows.map((p: any) => ({ type: 'STUDENT', id: p.id }))),
    db.query(
      `SELECT im.institution_id, i.name AS institution_name, im.membership_role, im.status
       FROM institution_memberships im JOIN institutions i ON i.id = im.institution_id WHERE im.user_id = $1`,
      [userId]
    ),
    db.query(
      `SELECT action, occurred_at, result, reason FROM admin_audit_log WHERE target_type = 'USER' AND target_id = $1 ORDER BY occurred_at DESC LIMIT 50`,
      [userId]
    ),
  ]);

  return {
    userId: row.id,
    displayLabel: row.is_test ? '(cuenta de prueba)' : maskEmail(row.email),
    status: row.status,
    activeWorkspace: row.active_workspace,
    roles: roles.map((r) => r.role),
    isTest: row.is_test,
    hasLicense: row.has_license,
    syncState: 'OK',
    createdAt: new Date(row.created_at).toISOString(),
    profiles,
    institutionMemberships: memberships.rows.map((m: any) => ({
      institutionId: m.institution_id,
      institutionName: m.institution_name,
      role: m.membership_role,
      status: m.status,
    })),
    auditHistory: auditHistory.rows.map((a: any) => ({
      action: a.action,
      occurredAt: new Date(a.occurred_at).toISOString(),
      result: a.result,
      reason: a.reason,
    })),
    statusChangedAt: row.status_changed_at ? new Date(row.status_changed_at).toISOString() : null,
    testMetadata: row.is_test ? { alias: row.test_alias, purpose: row.test_purpose, reviewAt: row.test_review_at ? new Date(row.test_review_at).toISOString() : null } : null,
  };
}

// ---------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------

/**
 * Idempotent: `ignoreExisting: false` (the Clerk default) means a
 * duplicate invite to the same email is rejected by Clerk itself with
 * a safe conflict, never silently sent twice or leaking whether that
 * email already has an account (INV-ADMIN2A-05, enumeration safety --
 * the same conflict shape is returned whether the email is unknown,
 * already invited, or already a real account).
 */
export async function inviteUser(actorUserId: string, email: string, intendedRole: SelfServiceRole | null): Promise<{ invitationId: string }> {
  if (intendedRole && !INVITABLE_ROLES.includes(intendedRole)) {
    throw new PrivilegedRoleForbiddenError();
  }
  const client = await clerkClient();
  try {
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: intendedRole ? { intendedRole } : undefined,
    });
    await recordAdminAction({
      actorUserId,
      action: 'INVITE_SENT',
      targetType: 'INVITATION',
      targetId: invitation.id,
      newState: { intendedRole },
    });
    return { invitationId: invitation.id };
  } catch (error) {
    await recordAdminAction({ actorUserId, action: 'INVITE_SENT', targetType: 'INVITATION', result: 'FAILURE', reason: 'Clerk rejected the invitation (duplicate or invalid)' });
    throw error;
  }
}

export async function revokeInvitation(actorUserId: string, invitationId: string): Promise<void> {
  const client = await clerkClient();
  await client.invitations.revokeInvitation(invitationId);
  await recordAdminAction({ actorUserId, action: 'INVITE_REVOKED', targetType: 'INVITATION', targetId: invitationId });
}

// ---------------------------------------------------------------------
// Role management -- never STUDYUS_ADMIN or INSTITUTION_ADMIN
// ---------------------------------------------------------------------

export async function addRole(actorUserId: string, targetUserId: string, role: SelfServiceRole, targetClerkId: string): Promise<void> {
  if (!INVITABLE_ROLES.includes(role)) throw new PrivilegedRoleForbiddenError();

  await db.query(
    `INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, $2, 'ACTIVE', 'INVITATION')
     ON CONFLICT (user_id, role) DO UPDATE SET status = 'ACTIVE', revoked_at = NULL, revoked_by_user_id = NULL WHERE user_roles.status = 'REVOKED'`,
    [targetUserId, role]
  );

  // Mirrors assignSelfServiceRole's own invariant: STUDENT role always
  // provisions the canonical dual identity immediately, and ONLY then --
  // never as a side effect of any other role grant (INV-ADMIN2A-06).
  if (role === 'STUDENT') {
    await getOrCreateStudentId(targetClerkId);
  }

  await recordAdminAction({ actorUserId, action: 'ROLE_ADDED', targetType: 'USER', targetId: targetUserId, newState: { role } });
}

export async function revokeRole(actorUserId: string, targetUserId: string, role: Role): Promise<void> {
  if (role === 'STUDYUS_ADMIN') {
    const remaining = await countActiveStudyUSAdmins();
    if (remaining <= 1) throw new LastAdminProtectionError();
  }
  await db.query(
    `UPDATE user_roles SET status = 'REVOKED', revoked_at = NOW(), revoked_by_user_id = $1
     WHERE user_id = $2 AND role = $3 AND status = 'ACTIVE'`,
    [actorUserId, targetUserId, role]
  );
  await recordAdminAction({ actorUserId, action: 'ROLE_REVOKED', targetType: 'USER', targetId: targetUserId, newState: { role } });
}

// ---------------------------------------------------------------------
// Suspend / reactivate / archive
// ---------------------------------------------------------------------

async function revokeAllClerkSessions(clerkUserId: string): Promise<number> {
  const client = await clerkClient();
  const sessions = await client.sessions.getSessionList({ userId: clerkUserId, status: 'active' });
  let revoked = 0;
  for (const session of sessions.data) {
    await client.sessions.revokeSession(session.id);
    revoked++;
  }
  return revoked;
}

async function assertNotLastAdmin(targetUserId: string): Promise<void> {
  const isAdmin = await hasRole(targetUserId, 'STUDYUS_ADMIN');
  if (!isAdmin) return;
  const remaining = await countActiveStudyUSAdmins();
  if (remaining <= 1) throw new LastAdminProtectionError();
}

export async function suspendUser(actorUserId: string, targetUserId: string, targetClerkId: string, reason: string): Promise<void> {
  await assertNotLastAdmin(targetUserId);

  const client = await clerkClient();
  await client.users.banUser(targetClerkId);
  const revokedCount = await revokeAllClerkSessions(targetClerkId);

  await db.query(
    `UPDATE users SET status = 'SUSPENDED', status_changed_at = NOW(), status_changed_by = $1 WHERE id = $2`,
    [actorUserId, targetUserId]
  );
  await recordAdminAction({ actorUserId, action: 'USER_SUSPENDED', targetType: 'USER', targetId: targetUserId, reason, newState: { sessionsRevoked: revokedCount } });
}

export async function reactivateUser(actorUserId: string, targetUserId: string, targetClerkId: string): Promise<void> {
  const client = await clerkClient();
  await client.users.unbanUser(targetClerkId);

  await db.query(`UPDATE users SET status = 'ACTIVE', status_changed_at = NOW(), status_changed_by = $1 WHERE id = $2`, [actorUserId, targetUserId]);
  await recordAdminAction({ actorUserId, action: 'USER_REACTIVATED', targetType: 'USER', targetId: targetUserId });
}

export async function archiveUser(actorUserId: string, targetUserId: string, targetClerkId: string, reason: string): Promise<void> {
  await assertNotLastAdmin(targetUserId);

  const client = await clerkClient();
  await client.users.banUser(targetClerkId);
  const revokedCount = await revokeAllClerkSessions(targetClerkId);

  await db.query(`UPDATE users SET status = 'ARCHIVED', status_changed_at = NOW(), status_changed_by = $1 WHERE id = $2`, [actorUserId, targetUserId]);
  await recordAdminAction({ actorUserId, action: 'USER_ARCHIVED', targetType: 'USER', targetId: targetUserId, reason, newState: { sessionsRevoked: revokedCount } });
}

// ---------------------------------------------------------------------
// Test identities (Mechanism B -- preconfigured, Preview only)
// ---------------------------------------------------------------------

export interface TestIdentityRequest {
  alias: string;
  purpose: string;
  initialRole: SelfServiceRole | null;
}

export interface TestIdentityResult {
  userId: string;
  clerkUserId: string;
  /** Returned exactly once, to the calling admin only -- never persisted, never logged, never included in any audit row or document. */
  oneTimeEmail: string;
  oneTimePassword: string;
}

/** Mechanism B: creates a real, ready-to-use Clerk account via the Backend API (never the public /sign-up form -- this cannot be blocked by a bot-check, since it is a server-to-server call, not a browser flow) and immediately marks it TEST. Preview-only. */
export async function createTestIdentity(actorUserId: string, req: TestIdentityRequest): Promise<TestIdentityResult> {
  if (!isPreviewEnvironment()) throw new NotTestEnvironmentError();

  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `studyus-test-${suffix}@example.com`;
  const password = `Test-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}!`;

  const client = await clerkClient();
  const clerkUser = await client.users.createUser({ emailAddress: [email], password });

  const canonicalUser = await getOrCreateCanonicalUser(clerkUser.id, email);
  await db.query(
    `UPDATE users SET is_test = true, test_alias = $1, test_purpose = $2, test_created_by = $3, test_review_at = NOW() + INTERVAL '14 days' WHERE id = $4`,
    [req.alias, req.purpose, actorUserId, canonicalUser.id]
  );

  if (req.initialRole) {
    await addRole(actorUserId, canonicalUser.id, req.initialRole, clerkUser.id);
  }

  await recordAdminAction({
    actorUserId,
    action: 'TEST_IDENTITY_CREATED',
    targetType: 'TEST_IDENTITY',
    targetId: canonicalUser.id,
    newState: { alias: req.alias, purpose: req.purpose, initialRole: req.initialRole },
  });

  return { userId: canonicalUser.id, clerkUserId: clerkUser.id, oneTimeEmail: email, oneTimePassword: password };
}

/** Preview-only, TEST-only, dependency-checked cleanup. Fails closed on any doubt (INV-ADMIN2A-07). */
export async function cleanupTestIdentity(actorUserId: string, targetUserId: string, targetClerkId: string): Promise<void> {
  if (!isPreviewEnvironment()) throw new NotTestEnvironmentError();

  const userRow = await db.query(`SELECT is_test FROM users WHERE id = $1`, [targetUserId]);
  if (userRow.rows.length === 0 || !userRow.rows[0].is_test) throw new TestIdentityHasRealDependenciesError(['NOT_MARKED_TEST']);

  const dependencies: string[] = [];
  if (await hasRole(targetUserId, 'STUDYUS_ADMIN')) dependencies.push('STUDYUS_ADMIN_ROLE');
  const institutionAdmin = await db.query(
    `SELECT 1 FROM institution_memberships WHERE user_id = $1 AND membership_role = 'INSTITUTION_ADMIN' AND status = 'APPROVED'`,
    [targetUserId]
  );
  if (institutionAdmin.rows.length > 0) dependencies.push('ADMINISTERS_INSTITUTION');

  const realParentLinks = await db.query(
    `SELECT 1 FROM parent_student_relationships psr
     WHERE (
       psr.parent_id IN (SELECT id FROM profiles WHERE user_id = $1)
       OR psr.student_id IN (SELECT id FROM students WHERE user_id = $1)
     )
     AND psr.status = 'accepted'
     LIMIT 1`,
    [targetUserId]
  );
  if (realParentLinks.rows.length > 0) dependencies.push('HAS_ACCEPTED_RELATIONSHIP');

  const realPayments = await db.query(
    `SELECT 1 FROM payments WHERE payer_user_id = $1 AND status = 'SUCCEEDED' LIMIT 1`,
    [targetUserId]
  );
  if (realPayments.rows.length > 0) dependencies.push('HAS_REAL_PAYMENT');

  if (dependencies.length > 0) throw new TestIdentityHasRealDependenciesError(dependencies);

  const client = await clerkClient();
  await client.users.deleteUser(targetClerkId);
  await db.query(`UPDATE users SET status = 'ARCHIVED', status_changed_at = NOW(), status_changed_by = $1 WHERE id = $2`, [actorUserId, targetUserId]);

  await recordAdminAction({ actorUserId, action: 'TEST_IDENTITY_CLEANED_UP', targetType: 'TEST_IDENTITY', targetId: targetUserId });
}

// ---------------------------------------------------------------------
// Clerk <-> StudyUS consistency
// ---------------------------------------------------------------------

export interface SyncCheckResult {
  usersWithoutClerkMatch: string[];
}

/** Best-effort, read-only detection -- never fabricates a role or profile. A `users` row whose `clerk_id` no longer resolves via Clerk is flagged, not repaired automatically. */
export async function detectSyncErrors(sampleLimit: number): Promise<SyncCheckResult> {
  const client = await clerkClient();
  const rows = await db.query(`SELECT id, clerk_id FROM users ORDER BY created_at DESC LIMIT $1`, [sampleLimit]);
  const missing: string[] = [];
  for (const row of rows.rows) {
    try {
      await client.users.getUser(row.clerk_id);
    } catch {
      missing.push(row.id);
    }
  }
  return { usersWithoutClerkMatch: missing };
}

export async function reconcileSyncError(actorUserId: string, targetUserId: string): Promise<void> {
  // Deliberately does not fabricate a role, profile, or Clerk account --
  // the only safe reconciliation this phase performs is marking the
  // finding as reviewed in the audit trail, so an operator's manual
  // decision is recorded rather than silently guessed.
  await recordAdminAction({ actorUserId, action: 'SYNC_RECONCILED', targetType: 'USER', targetId: targetUserId, reason: 'Manual review completed; no automatic repair performed' });
}
