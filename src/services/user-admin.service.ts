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
import { maskEmail } from '@/lib/admin/mask';
import { findClerkIdsMissingInClerk } from '@/services/identity-reconciliation.service';
import { db } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getOrCreateCanonicalUser, getUserRoles, hasRole, type Role, type SelfServiceRole } from '@/lib/identity';
import { recordAdminAction } from '@/lib/admin/audit';
import { countActiveStudyUSAdmins } from '@/lib/admin/authorization';
import { inviteInstitutionAdmin } from '@/services/institution.service';

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
export class InstitutionRequiredError extends Error {
  constructor() {
    super('INSTITUTION_REQUIRED_FOR_COORDINATOR');
  }
}
export class CoordinatorRequiresDirectCreationError extends Error {
  constructor() {
    super('COORDINATOR_REQUIRES_DIRECT_CREATION');
  }
}
export class CurrentPasswordInvalidError extends Error {
  constructor() {
    super('CURRENT_PASSWORD_INVALID');
  }
}
export class PasswordUpdateFailedError extends Error {
  constructor(public clerkMessage: string) {
    super('PASSWORD_UPDATE_FAILED');
  }
}
export class AccountNotActiveError extends Error {
  constructor() {
    super('ACCOUNT_NOT_ACTIVE');
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
export class EmailAlreadyExistsError extends Error {
  constructor() {
    super('EMAIL_ALREADY_EXISTS');
  }
}
/** Clerk succeeded but a later stage failed -- the caller must show "Clerk creado, StudyUS pendiente" and offer reconciliation, never silently retry from scratch (which would create a second Clerk account for the same admin action). */
export class PartialUserCreationError extends Error {
  constructor(public clerkUserId: string, public stage: string, public cause: string) {
    super('PARTIAL_USER_CREATION');
  }
}
export class SelfDeletionForbiddenError extends Error {
  constructor() {
    super('SELF_DELETION_FORBIDDEN');
  }
}
export class DeletionBlockedError extends Error {
  constructor(public blockingDependencies: string[]) {
    super('DELETION_BLOCKED');
  }
}
export class ConfirmationMismatchError extends Error {
  constructor() {
    super('CONFIRMATION_MISMATCH');
  }
}
export class MissingExpirationError extends Error {
  constructor() {
    super('MISSING_EXPIRATION');
  }
}
export class DuplicateReferenceError extends Error {
  constructor() {
    super('DUPLICATE_REFERENCE');
  }
}

const INVITABLE_ROLES: readonly SelfServiceRole[] = ['STUDENT', 'PARENT', 'TEACHER'];

/**
 * Wider than `INVITABLE_ROLES`/`SelfServiceRole` -- ONLY for the admin
 * "Crear usuario" form (`createUserFull`), never for `addRole` or the
 * self-service `/role-select` path, which must stay exactly
 * STUDENT/PARENT/TEACHER. INSTITUTION_ADMIN is allowed here because a
 * STUDYUS_ADMIN creating a brand-new coordinator account is a real,
 * explicitly-requested capability -- but it never goes through
 * `addRole` (which still hard-rejects it): it goes through the same
 * controlled, auditable `inviteInstitutionAdmin` F2 already uses for
 * every other institution-admin grant, and always requires an
 * institution. STUDYUS_ADMIN is deliberately never in this list.
 */
export type AdminCreatableRole = SelfServiceRole | 'INSTITUTION_ADMIN';
const ADMIN_CREATABLE_ROLES: readonly AdminCreatableRole[] = ['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION_ADMIN'];

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
  /** A01-LOGIC-02: CLERK_MISSING = this StudyOS account has no Clerk identity; UNVERIFIED = Clerk unreachable. */
  syncState: 'OK' | 'CLERK_MISSING' | 'UNVERIFIED';
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
  // Technical identities (`is_system`) never appear as user accounts.
  const conditions: string[] = ['NOT u.is_system'];
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
    `SELECT u.id, u.clerk_id, u.email, u.status, u.active_workspace, u.is_test, u.created_at,
            EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_id IN (SELECT id FROM students WHERE user_id = u.id) AND s.status IN ('active','past_due','reactivated')) AS has_license
     FROM users u ${whereClause} ORDER BY u.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...params, pageSize, offset]
  );

  const missingInClerk = await findClerkIdsMissingInClerk(rowsResult.rows.map((r: any) => r.clerk_id));

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
      syncState: missingInClerk === null ? 'UNVERIFIED' : missingInClerk.has(row.clerk_id) ? 'CLERK_MISSING' : 'OK',
      createdAt: new Date(row.created_at).toISOString(),
    });
  }

  return { items, totalCount: countResult.rows[0]?.c ?? 0 };
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
  /** Present only when this account has a STUDENT profile -- links straight to the Membresías y pagos detail. */
  subscriptionId: string | null;
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
    subscriptionId:
      profiles.find((p) => p.type === 'STUDENT') != null
        ? (await db.query(`SELECT id FROM subscriptions WHERE student_id = $1`, [profiles.find((p) => p.type === 'STUDENT')!.id])).rows[0]?.id ?? null
        : null,
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

export async function revokeSessionsOnly(actorUserId: string, targetUserId: string, targetClerkId: string): Promise<number> {
  const count = await revokeAllClerkSessions(targetClerkId);
  await recordAdminAction({ actorUserId, action: 'SESSIONS_REVOKED', targetType: 'USER', targetId: targetUserId, newState: { sessionsRevoked: count } });
  return count;
}

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

// ---------------------------------------------------------------------
// Professional console -- full user creation (real password), with an
// explicit, resumable reconciliation state machine across Clerk and
// Postgres (they can never be one atomic transaction).
// ---------------------------------------------------------------------

export interface CreateUserParams {
  email: string;
  firstName?: string;
  lastName?: string;
  locale?: string;
  isTest?: boolean;
  /** If set, the account is created with this password and no invitation is sent. If omitted, `sendInvitation` must be true. Every account created this way is marked `password_change_required` -- see `reconcileUserCreation`. */
  temporaryPassword?: string;
  sendInvitation?: boolean;
  initialRole: AdminCreatableRole | null;
  /** Required, and only meaningful, when initialRole is INSTITUTION_ADMIN. */
  institutionId?: string;
}

export interface CreateUserResult {
  userId: string;
  clerkUserId: string;
  invitationId?: string;
}

/**
 * Stage 1 (Clerk) is the only stage that can leave nothing behind on
 * failure -- if it throws, no `users` row, no audit row beyond the
 * failure record, nothing to clean up. Stages 2+ are all individually
 * idempotent (`getOrCreateCanonicalUser`, `addRole`'s own ON CONFLICT),
 * so `reconcileUserCreation` can safely resume from the known
 * `clerkUserId` alone, however many times it's retried.
 */
export async function createUserFull(actorUserId: string, params: CreateUserParams): Promise<CreateUserResult> {
  // STUDYUS_ADMIN is never in ADMIN_CREATABLE_ROLES -- this throws for
  // it exactly as it did before, and for any other forged value.
  if (params.initialRole && !ADMIN_CREATABLE_ROLES.includes(params.initialRole)) throw new PrivilegedRoleForbiddenError();
  if (params.initialRole === 'INSTITUTION_ADMIN' && !params.institutionId) throw new InstitutionRequiredError();

  if (params.sendInvitation) {
    // A coordinator account is only ever created via direct temporary-
    // password creation (below), never via email invitation --
    // `inviteUser` stays exactly STUDENT/PARENT/TEACHER, unchanged and
    // still certified as such.
    if (params.initialRole === 'INSTITUTION_ADMIN') throw new CoordinatorRequiresDirectCreationError();
    const intendedRole: SelfServiceRole | null = params.initialRole;
    const result = await inviteUser(actorUserId, params.email, intendedRole);
    return { userId: '', clerkUserId: '', invitationId: result.invitationId };
  }

  if (!params.temporaryPassword) throw new Error('TEMPORARY_PASSWORD_OR_INVITATION_REQUIRED');

  const client = await clerkClient();
  let clerkUser;
  try {
    clerkUser = await client.users.createUser({
      emailAddress: [params.email],
      password: params.temporaryPassword,
      firstName: params.firstName,
      lastName: params.lastName,
      locale: params.locale,
    });
  } catch (error: any) {
    await recordAdminAction({ actorUserId, action: 'USER_CREATION_STARTED', targetType: 'USER', result: 'FAILURE', reason: 'Clerk account creation failed (likely duplicate email)' });
    throw new EmailAlreadyExistsError();
  }

  try {
    return await reconcileUserCreation(actorUserId, clerkUser.id, params.email, params.initialRole, params.isTest ?? false, params.institutionId);
  } catch (error) {
    // Clerk succeeded; Postgres did not. The caller must show this as
    // a resumable partial state, never a generic failure -- retrying
    // createUserFull from scratch would create a SECOND Clerk account
    // for the same person.
    throw new PartialUserCreationError(clerkUser.id, 'USERS_ROW_OR_ROLE', (error as Error).message);
  }
}

/** Resumable by design: safe to call again with the same clerkUserId as many times as needed. */
export async function reconcileUserCreation(
  actorUserId: string,
  clerkUserId: string,
  email: string,
  initialRole: AdminCreatableRole | null,
  isTest: boolean,
  institutionId?: string
): Promise<CreateUserResult> {
  const canonicalUser = await getOrCreateCanonicalUser(clerkUserId, email);

  if (isTest) {
    await db.query(`UPDATE users SET is_test = true, test_created_by = $1 WHERE id = $2 AND is_test = false`, [actorUserId, canonicalUser.id]);
  }

  // Every account that reaches this function was created with a
  // temporary password (an invitation never calls reconcileUserCreation
  // at all -- see createUserFull) -- so it unconditionally requires a
  // real password change before first use. Not a simulated "force
  // change" flag: this is StudyUS's own gate (dashboard/layout.tsx),
  // cleared only after Clerk's own `user.updatePassword()` succeeds --
  // see /account/change-password.
  await db.query(`UPDATE users SET password_change_required = true, password_change_required_at = NOW() WHERE id = $1 AND password_change_required = false`, [canonicalUser.id]);

  if (initialRole === 'INSTITUTION_ADMIN') {
    if (!institutionId) throw new InstitutionRequiredError();
    // The same controlled, auditable F2 path every other
    // INSTITUTION_ADMIN grant uses -- writes user_roles AND an already-
    // APPROVED institution_memberships row, never a bare role grant.
    await inviteInstitutionAdmin(institutionId, canonicalUser.id);
  } else if (initialRole) {
    await addRole(actorUserId, canonicalUser.id, initialRole, clerkUserId);
  }

  await recordAdminAction({ actorUserId, action: 'USER_CREATION_STARTED', targetType: 'USER', targetId: canonicalUser.id, newState: { initialRole, isTest, institutionId: institutionId ?? null } });
  return { userId: canonicalUser.id, clerkUserId };
}

/**
 * Server-controlled password change (Alternative B -- no reliable,
 * password-specific, server-verifiable timestamp exists in the
 * installed Clerk SDK/API: `User.updatedAt` is a generic
 * last-profile-update timestamp, bumped by ANY field change, not
 * specific to a password, so it is not treated as evidence here).
 *
 * This function IS the evidence: it calls Clerk itself, on the
 * server, and only clears `password_change_required` if Clerk's own
 * API confirms both steps succeeded, in this order:
 *   1. `verifyPassword` -- proves the caller actually knows the
 *      current/temporary credential (never trusts a client claim of
 *      "I already changed it").
 *   2. `updateUser({ password, signOutOfOtherSessions: true })` --
 *      the real password change, executed by StudyUS's own backend
 *      using the Backend API (secret-key privileged), not by the
 *      user's browser talking to Clerk directly.
 * If either Clerk call throws, this function throws too and
 * `confirmPasswordChanged` below is never reached -- the flag is only
 * ever cleared in the same call that performed the real change,
 * never by a separate, later, unverifiable claim.
 *
 * The plaintext password exists only as this function's own
 * parameters and the two request bodies sent to Clerk's API client --
 * it is never logged, never persisted, never returned, and goes out
 * of scope the moment this function returns or throws. It DOES transit
 * through this StudyUS server (see the route's own doc comment) on its
 * way to Clerk; it is not simulated to bypass the server.
 */
export async function changeOwnPasswordAndClearRequirement(
  clerkUserId: string,
  canonicalUserId: string,
  accountStatus: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (accountStatus !== 'ACTIVE') throw new AccountNotActiveError();

  const client = await clerkClient();

  try {
    await client.users.verifyPassword({ userId: clerkUserId, password: currentPassword });
  } catch {
    throw new CurrentPasswordInvalidError();
  }

  try {
    await client.users.updateUser(clerkUserId, { password: newPassword, signOutOfOtherSessions: true });
  } catch (error: any) {
    throw new PasswordUpdateFailedError(error?.errors?.[0]?.longMessage ?? error?.errors?.[0]?.message ?? 'PASSWORD_REJECTED_BY_CLERK');
  }

  await confirmPasswordChanged(canonicalUserId);
}

/** Only ever called from `changeOwnPasswordAndClearRequirement`, immediately after Clerk itself confirmed the real change -- never reachable from a bare client claim. Idempotent: clearing an already-false flag is a harmless no-op. */
export async function confirmPasswordChanged(canonicalUserId: string): Promise<void> {
  await db.query(`UPDATE users SET password_change_required = false, password_change_required_at = NULL WHERE id = $1`, [canonicalUserId]);
  await recordAdminAction({ actorUserId: canonicalUserId, action: 'PASSWORD_CHANGE_CONFIRMED', targetType: 'USER', targetId: canonicalUserId });
}

// ---------------------------------------------------------------------
// Deletion impact analysis and permanent deletion -- conservative by
// design: a real, permanent delete of StudyUS data is only ever
// offered when there is nothing to retain. Otherwise the only path is
// Archive (already implemented above), plus a real, permanent deletion
// of the Clerk account is still possible on its own via TEST cleanup
// or -- for a real account with real dependencies -- not at all
// through this function (INV-ADMIN-DEL-01: no invented retention
// policy for academic/payment data).
// ---------------------------------------------------------------------

export type DependencyClassification = 'DELETE' | 'ANONYMIZE' | 'RETAIN_FOR_AUDIT' | 'BLOCK_DELETION';

export interface DeletionImpactItem {
  category: string;
  label: string;
  count: number;
  classification: DependencyClassification;
}

export interface DeletionImpact {
  items: DeletionImpactItem[];
  canHardDelete: boolean;
  blockingReasons: string[];
}

export async function computeDeletionImpact(userId: string): Promise<DeletionImpact> {
  const [roles, students, profiles, subs, payments, parentLinksAsParent, parentLinksAsStudent, memberships, auditCount] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM user_roles WHERE user_id = $1`, [userId]),
    db.query(`SELECT id FROM students WHERE user_id = $1`, [userId]),
    db.query(`SELECT id FROM profiles WHERE user_id = $1`, [userId]),
    db.query(`SELECT COUNT(*)::int AS c FROM subscriptions WHERE student_id IN (SELECT id FROM students WHERE user_id = $1) AND status NOT IN ('unpaid')`, [userId]),
    db.query(`SELECT COUNT(*)::int AS c FROM payments WHERE payer_user_id = $1 AND status = 'SUCCEEDED'`, [userId]),
    db.query(`SELECT COUNT(*)::int AS c FROM parent_student_relationships WHERE parent_id IN (SELECT id FROM profiles WHERE user_id = $1) AND status = 'accepted'`, [userId]),
    db.query(`SELECT COUNT(*)::int AS c FROM parent_student_relationships WHERE student_id IN (SELECT id FROM students WHERE user_id = $1) AND status = 'accepted'`, [userId]),
    db.query(`SELECT COUNT(*)::int AS c FROM institution_memberships WHERE user_id = $1`, [userId]),
    db.query(`SELECT COUNT(*)::int AS c FROM admin_audit_log WHERE target_id = $1`, [userId]),
  ]);

  const studentIds = students.rows.map((r: any) => r.id);
  let evidenceCount = 0;
  if (studentIds.length > 0) {
    const evidence = await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [studentIds]);
    evidenceCount = evidence.rows[0]?.c ?? 0;
  }

  const items: DeletionImpactItem[] = [
    { category: 'roles', label: 'Roles otorgados', count: roles.rows[0].c, classification: 'DELETE' },
    { category: 'profiles', label: 'Perfiles (padre/coordinador)', count: profiles.rows.length, classification: profiles.rows.length > 0 ? 'DELETE' : 'DELETE' },
    { category: 'students', label: 'Identidad académica (estudiante)', count: studentIds.length, classification: studentIds.length > 0 ? 'BLOCK_DELETION' : 'DELETE' },
    { category: 'academic_evidence', label: 'Evidencia de aprendizaje', count: evidenceCount, classification: evidenceCount > 0 ? 'BLOCK_DELETION' : 'DELETE' },
    { category: 'subscriptions', label: 'Suscripciones/licencias con actividad', count: subs.rows[0].c, classification: subs.rows[0].c > 0 ? 'BLOCK_DELETION' : 'DELETE' },
    { category: 'payments', label: 'Pagos reales exitosos', count: payments.rows[0].c, classification: payments.rows[0].c > 0 ? 'BLOCK_DELETION' : 'DELETE' },
    { category: 'parent_relationships', label: 'Relaciones padre-estudiante aceptadas', count: parentLinksAsParent.rows[0].c + parentLinksAsStudent.rows[0].c, classification: (parentLinksAsParent.rows[0].c + parentLinksAsStudent.rows[0].c) > 0 ? 'BLOCK_DELETION' : 'DELETE' },
    { category: 'institution_memberships', label: 'Membresías institucionales', count: memberships.rows[0].c, classification: memberships.rows[0].c > 0 ? 'BLOCK_DELETION' : 'DELETE' },
    { category: 'audit_log', label: 'Historial administrativo', count: auditCount.rows[0].c, classification: 'RETAIN_FOR_AUDIT' },
  ];

  const blocking = items.filter((i) => i.classification === 'BLOCK_DELETION' && i.count > 0);
  return { items, canHardDelete: blocking.length === 0, blockingReasons: blocking.map((i) => i.label) };
}

/**
 * Only reachable when `computeDeletionImpact` (recomputed here, never
 * trusted from an earlier client read) reports `canHardDelete: true`.
 * Deletes the real Clerk account (irreversible) and the `users`/
 * `user_roles`/empty-`profiles` rows -- never touches
 * `admin_audit_log` (RETAIN_FOR_AUDIT, kept forever by design, still
 * pointing at the now-deleted `target_id` as a text value, never a
 * hard FK that would block this).
 */
export async function deleteUserPermanently(
  actorUserId: string,
  targetUserId: string,
  targetClerkId: string,
  confirmationEmail: string,
  reason: string
): Promise<void> {
  if (targetUserId === actorUserId) throw new SelfDeletionForbiddenError();
  await assertNotLastAdmin(targetUserId);

  const target = await db.query(`SELECT email FROM users WHERE id = $1`, [targetUserId]);
  if (target.rows.length === 0) throw new Error('NOT_FOUND');
  if ((target.rows[0].email ?? '').toLowerCase() !== confirmationEmail.toLowerCase()) {
    throw new ConfirmationMismatchError();
  }

  const impact = await computeDeletionImpact(targetUserId);
  if (!impact.canHardDelete) throw new DeletionBlockedError(impact.blockingReasons);

  const client = await clerkClient();
  await client.users.deleteUser(targetClerkId);

  await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [targetUserId]);
  await db.query(`DELETE FROM profiles WHERE user_id = $1`, [targetUserId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [targetUserId]);

  await recordAdminAction({
    actorUserId,
    action: 'USER_DELETED_PERMANENTLY',
    targetType: 'USER',
    targetId: targetUserId,
    reason,
    newState: { impact: impact.items.map((i) => ({ category: i.category, count: i.count })) },
  });
}
