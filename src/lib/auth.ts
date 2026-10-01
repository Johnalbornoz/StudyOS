/**
 * Authorization & Tenant Verification
 *
 * Ensures:
 * 1. User is authenticated (via Clerk)
 * 2. User can access the requested resource
 * 3. Multi-tenancy is respected (students can't access other students' data)
 *
 * ---------------------------------------------------------------------
 * Current StudyUs Student Identity Contract (Phase 0C -- compatibility
 * contract, not the target design; a real consolidation is a separate,
 * later migration project, not this one)
 * ---------------------------------------------------------------------
 *
 *   Clerk User (authenticated account)
 *           |
 *           v
 *   Shared Student UUID  <-- one value, minted once, by this file only
 *      |            |
 *      v            v
 *  students.id   profiles.id  (+ student_profiles.id, same value)
 *
 * - Clerk identifies the authenticated account (`userId` from `auth()`).
 * - `students.id` is the Learning OS / learning-engine identity --
 *   mastery, learning debt, quizzes, knowledge state, verification, and
 *   most newer (Phase 2+) tables key off this one.
 * - `profiles.id` (+ `student_profiles.id`) is used by the original/
 *   legacy application domains -- confirmed live: `subjects`,
 *   `mastery_records`, `learning_evidence`, `errors`, `learning_debt`,
 *   `tutor_conversations`, and others key off THIS one instead.
 * - There is NO foreign key between `students.id` and `profiles.id` --
 *   do not assume or claim one exists anywhere in code or docs. They
 *   are two independent primary-key spaces.
 * - For every student, both IDs MUST currently hold the exact same
 *   UUID value. This is enforced only by application convention (this
 *   file), never by the database.
 * - `getOrCreateStudentId` (below) is the ONLY canonical provisioning
 *   path. It mints the UUID once (as `students.id`, via
 *   `upsertStudentRecord`) and immediately mirrors it into
 *   `profiles`/`student_profiles` (via `ensureProfileRows`), including
 *   self-repair on every call for a student who already exists.
 * - New code MUST NOT invent another student identifier or another
 *   provisioning path. If you need a student's ID, call
 *   `getOrCreateStudentId` (or read `students.clerk_id`/`profiles.clerk_id`
 *   for lookups) -- never mint a UUID or write directly to `students`/
 *   `profiles`/`student_profiles` from anywhere else. (See
 *   `src/services/student.service.ts` for a documented example of what
 *   NOT to do -- a dead, pre-existing alternate path that would violate
 *   this contract if it were ever wired up again.)
 * - Any future consolidation of `students`/`profiles` into one table is
 *   out of scope here and belongs to a separate migration project.
 */

import { auth, currentUser, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, hasRole } from '@/lib/identity/canonical-user.service';

export type UserRole = 'student' | 'teacher' | 'admin';

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
}

/**
 * Verify authentication and return auth context
 */
export async function verifyAuth(): Promise<AuthContext | null> {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    return null;
  }

  // Get user role from session or database
  const role = (sessionClaims?.role as UserRole) || 'student';
  const email = (sessionClaims?.email as string) || '';

  return { userId, email, role };
}

/**
 * Verify student access to their own data -- OWNER ONLY (default-deny).
 *
 * Foundation (roles/exams shared, ADR-F06): this guard protects the
 * Student's own learning routes (plan, cognitive submit, record-evidence,
 * assessments, ...), several of which WRITE canonical evidence. It used to
 * honour a Clerk session-claim `role`: 'admin' passed for ANY student and
 * 'teacher' could read -- and, via record-evidence, write independent
 * evidence -- for a taught student. Those were a second, non-canonical role
 * model (canonical roles live in user_roles) and let a non-owner manipulate
 * cognitive state. Teacher / Parent / Institution / StudyUS-admin reads go
 * through their own scoped read models (src/lib/authorization,
 * src/lib/teacher, src/lib/parent, src/lib/admin), never through this guard.
 * `role` is kept in the signature so callers are unchanged; it no longer
 * grants anything.
 */
export async function verifyStudentAccess(
  userId: string,
  studentId: string,
  _role?: UserRole
): Promise<boolean> {
  return isUserStudent(userId, studentId);
}

/**
 * Check if userId is the owner of studentId
 */
async function isUserStudent(userId: string, studentId: string): Promise<boolean> {
  try {
    const result = await db.query(
      `SELECT 1 FROM students WHERE clerk_id = $1 AND id = $2`,
      [userId, studentId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error checking student ownership:', error);
    return false;
  }
}

/**
 * Create/update the student identity across both subsystems that share
 * this database: the original StudyOS profiles/student_profiles tables
 * (subjects.student_id references profiles.id) and IC-Engine's students
 * table (mastery/learning-debt/quizzes/content reference students.id).
 * Both rows are written with the SAME uuid so either FK resolves.
 */
async function ensureProfileRows(studentId: string, name: string | null): Promise<void> {
  await db.query(
    `INSERT INTO profiles (id, user_type, full_name)
     VALUES ($1, 'student', $2)
     ON CONFLICT (id) DO NOTHING`,
    [studentId, name]
  );
  await db.query(
    `INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [studentId]
  );
}

async function upsertStudentRecord(
  clerkUserId: string,
  email: string,
  name: string | null
): Promise<string> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // F1 canonical link: students.user_id / profiles.user_id point at the
    // `users` row of the same Clerk identity. Ownership (entitlements' isOwner,
    // F2 canAccessLearner) is decided on this link, so a Student created
    // without it could never be licensed or authorized as owner. Never
    // overwrites an existing link.
    const inserted = await client.query(
      `INSERT INTO students (clerk_id, email, name, user_id)
       VALUES ($1, $2, $3, (SELECT id FROM users WHERE clerk_id = $1 AND NOT is_system))
       ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name,
         user_id = COALESCE(students.user_id, EXCLUDED.user_id)
       RETURNING id, user_id`,
      [clerkUserId, email, name]
    );
    const studentId = inserted.rows[0].id;
    const linkedUserId = inserted.rows[0].user_id ?? null;

    await client.query(
      `INSERT INTO profiles (id, user_type, full_name, user_id)
       VALUES ($1, 'student', $2, $3)
       ON CONFLICT (id) DO UPDATE SET user_id = COALESCE(profiles.user_id, EXCLUDED.user_id)`,
      [studentId, name, linkedUserId]
    );
    await client.query(
      `INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [studentId]
    );

    await client.query('COMMIT');
    return studentId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Repairs a students/profiles row created without its F1 canonical link
 * (every Student created after F1 by the path above, before this fix).
 * Same exact-clerk_id rule as the F1 identity backfill; only fills NULLs.
 */
async function linkStudentToCanonicalUser(studentId: string): Promise<void> {
  await db.query(
    `UPDATE students s SET user_id = u.id
     FROM users u
     WHERE s.id = $1 AND s.user_id IS NULL AND u.clerk_id = s.clerk_id AND NOT u.is_system`,
    [studentId]
  );
  await db.query(
    `UPDATE profiles p SET user_id = s.user_id
     FROM students s
     WHERE p.id = $1 AND s.id = p.id AND p.user_type = 'student' AND p.user_id IS NULL AND s.user_id IS NOT NULL`,
    [studentId]
  );
}

/** Thrown when a students row would be created for an identity without an ACTIVE STUDENT role. */
export class StudentRoleRequiredError extends Error {
  constructor() {
    super('STUDENT_ROLE_REQUIRED');
    this.name = 'StudentRoleRequiredError';
  }
}

/**
 * Resolve a Clerk user ID to the internal student UUID (shared by
 * profiles.id and students.id), creating the rows on first use. Also
 * repairs the case where a students row exists without its matching
 * profiles/student_profiles rows (e.g. from before this fix landed).
 */
/**
 * Track A -- the Clerk profile (email, name) of THIS clerkUserId. Inside a
 * request made by someone else (an admin granting a Student role to another
 * account) `currentUser()` is the ADMIN, so its email/name must never be
 * copied onto the target's new students/profiles row: fall back to the
 * Backend API lookup of the target itself.
 */
async function resolveClerkIdentity(clerkUserId: string): Promise<{ email: string | null; name: string | null }> {
  const fromUser = (u: any) => ({
    email: u?.primaryEmailAddress?.emailAddress || u?.emailAddresses?.[0]?.emailAddress || null,
    name: u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null : null,
  });
  const sessionUser = await currentUser().catch(() => null);
  if (sessionUser && (!sessionUser.id || sessionUser.id === clerkUserId)) return fromUser(sessionUser);
  try {
    const client = await clerkClient();
    return fromUser(await client.users.getUser(clerkUserId));
  } catch {
    return { email: null, name: null };
  }
}

export async function getOrCreateStudentId(clerkUserId: string): Promise<string> {
  const existing = await db.query(
    `SELECT id FROM students WHERE clerk_id = $1`,
    [clerkUserId]
  );
  if (existing.rows.length > 0) {
    const studentId = existing.rows[0].id;
    await ensureProfileRows(studentId, null);
    await linkStudentToCanonicalUser(studentId);
    return studentId;
  }

  // Foundation (multi-role contract, ADR-F01/F06): a NEW students row is only
  // ever created for an identity that holds an ACTIVE STUDENT role. Roles are
  // granted first (role-select / admin console, both of which then call this
  // function), so legitimate provisioning is unchanged; what this closes is a
  // Parent-only / Teacher-only / admin-only identity silently becoming a
  // Student by calling one of the many Student routes that use this function
  // directly. The existing-row path above is untouched.
  const studentRole = await db.query(
    `SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
     WHERE u.clerk_id = $1 AND r.role = 'STUDENT' AND r.status = 'ACTIVE' LIMIT 1`,
    [clerkUserId]
  );
  if ((studentRole.rows?.length ?? 0) === 0) {
    throw new StudentRoleRequiredError();
  }

  const identity = await resolveClerkIdentity(clerkUserId);
  const email = identity.email || `${clerkUserId}@placeholder.local`;
  return upsertStudentRecord(clerkUserId, email, identity.name);
}

/**
 * Same as getOrCreateStudentId but for use from the Clerk webhook, where
 * email/name are already available in the event payload (avoids an
 * extra Clerk API call via currentUser()). No longer called by the
 * webhook itself (2026-09-21 onboarding rework -- see
 * src/app/api/webhooks/clerk/route.ts) since `user.created` must never
 * provision a role on anyone's behalf; kept for any legacy/migration
 * script that legitimately already knows the caller is a Student.
 */
export async function upsertStudentFromWebhook(
  clerkUserId: string,
  email: string,
  name: string | null
): Promise<string> {
  return upsertStudentRecord(clerkUserId, email, name);
}

/**
 * Onboarding model (2026-09-21) -- the role-checked gate every Student-
 * only route must call INSTEAD of `getOrCreateStudentId` directly.
 * `getOrCreateStudentId` alone will provision a `students` row for
 * *any* authenticated caller with no regard for whether they ever
 * selected STUDENT -- exactly the "any account can silently become a
 * Student" defect this closes (the Clerk webhook was the other,
 * already-fixed instance of the same class of bug). Returns `null`
 * (never throws, never provisions anything) when the caller's
 * canonical identity has no ACTIVE STUDENT role -- callers must treat
 * `null` as 403 FORBIDDEN, not as "create one anyway".
 */
export async function requireStudentId(clerkUserId: string): Promise<string | null> {
  const canonicalUser = await getOrCreateCanonicalUser(clerkUserId);
  const isStudent = await hasRole(canonicalUser.id, 'STUDENT');
  if (!isStudent) return null;
  return getOrCreateStudentId(clerkUserId);
}

/**
 * Track A -- the role-checked gate for Parent-only routes, the PARENT twin of
 * `requireStudentId`: returns null (never provisions a parent profile) when
 * the caller holds no ACTIVE PARENT role. Callers treat null as 403.
 */
export async function requireParentProfileId(clerkUserId: string): Promise<string | null> {
  const canonicalUser = await getOrCreateCanonicalUser(clerkUserId);
  const isParent = await hasRole(canonicalUser.id, 'PARENT');
  if (!isParent) return null;
  return getOrCreateParentId(clerkUserId);
}

/**
 * Resolve a Clerk user ID to a parent's profile UUID, creating the
 * profiles row (user_type='parent') on first use. Separate from
 * getOrCreateStudentId: parents have no legacy `students` table entry,
 * so identity resolution goes through profiles.clerk_id instead.
 *
 * F10: also resolves/attaches the F1 canonical `users.id` to
 * `profiles.user_id`. Before this fix, a parent's profiles row was
 * created with `user_id` left NULL, which meant F2's own canonical
 * `isActiveParentOf`/`canAccessLearner` (which require
 * `profiles.user_id = actorUserId`) could never match a real, accepted
 * parent relationship -- every existing Parent route worked around this
 * by checking `parent_student_relationships` directly instead
 * (`verifyParentAccess`), rather than by fixing the identity gap. Every
 * call self-repairs a previously-NULL `user_id` on an existing row, the
 * same self-healing pattern `ensureProfileRows` already uses for
 * students.
 */
export async function getOrCreateParentId(clerkUserId: string): Promise<string> {
  const existing = await db.query(`SELECT id, user_id, clerk_id FROM profiles WHERE clerk_id = $1`, [clerkUserId]);
  if (existing.rows.length > 0) {
    const profileId = existing.rows[0].id;
    if (!existing.rows[0].user_id) {
      const canonicalUser = await getOrCreateCanonicalUser(clerkUserId);
      await db.query(`UPDATE profiles SET user_id = $1 WHERE id = $2 AND user_id IS NULL`, [canonicalUser.id, profileId]);
    }
    return profileId;
  }

  const { email, name } = await resolveClerkIdentity(clerkUserId);

  const canonicalUser = await getOrCreateCanonicalUser(clerkUserId, email);

  const inserted = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', $1, $2, $3) RETURNING id`,
    [name, clerkUserId, canonicalUser.id]
  );
  return inserted.rows[0].id;
}

/**
 * Verify subject access (multi-tenancy).
 *
 * Phase 0C fix: this previously queried a `student_subjects` junction
 * table that does not exist in the live database (confirmed by
 * Phase 0B's live-schema forensics) -- every call would have thrown,
 * been caught below, and silently returned false. There was no live
 * caller of this function at the time (verified repo-wide), so the
 * defect was real but dormant, not an active production break.
 *
 * The real, live ownership model (confirmed live: `subjects.student_id
 * NOT NULL REFERENCES profiles(id)`, and used this exact way by every
 * other subject-scoped query in the codebase, e.g.
 * `SELECT ... FROM subjects WHERE id = $1 AND student_id = $2`) is a
 * direct one-subject-belongs-to-one-student relationship: no junction
 * table, no many-to-many. `studentId` here is the shared student UUID
 * (see the identity-contract note on getOrCreateStudentId below) --
 * the same value already used as `subjects.student_id` by every other
 * caller in the codebase, so no caller-side change is needed to adopt
 * this fix.
 *
 * Fails closed: a missing subject, a subject owned by someone else, or
 * any DB error all resolve to `false`, exactly as before.
 */
export async function verifySubjectAccess(
  studentId: string,
  subjectId: string
): Promise<boolean> {
  try {
    const result = await db.query(
      `
      SELECT 1 FROM subjects
      WHERE id = $1 AND student_id = $2
      LIMIT 1
      `,
      [subjectId, studentId]
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying subject access:', error);
    return false;
  }
}

/**
 * F0-S -- verify content-source ownership (multi-tenancy), same shape
 * and same fail-closed contract as `verifySubjectAccess` above: a
 * missing content source, one owned by a different student, or any DB
 * error all resolve to `false`. `content_sources.student_id` is the
 * live, direct ownership column (confirmed by `content.service.ts`'s
 * own `getContentSources`/`deleteContentSource`, which already scope
 * every query this same way) -- this is not a new authorization model,
 * just the first shared helper for a check that content routes were
 * previously skipping entirely.
 */
export async function verifyContentSourceAccess(
  studentId: string,
  contentSourceId: string
): Promise<boolean> {
  try {
    const result = await db.query(
      `
      SELECT 1 FROM content_sources
      WHERE id = $1 AND student_id = $2
      LIMIT 1
      `,
      [contentSourceId, studentId]
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying content source access:', error);
    return false;
  }
}

/**
 * STUDENT E2E -- object-level ownership for the remaining Student-owned ids
 * that routes accepted from the client without binding them to the
 * authenticated Student. Same fail-closed contract as the helpers above:
 * missing row, another Student's row, or any DB error => false.
 */
export async function verifyConceptAccess(studentId: string, conceptId: string, subjectId?: string | null): Promise<boolean> {
  try {
    const result = await db.query(
      `SELECT 1 FROM concepts c JOIN subjects s ON s.id = c.subject_id
       WHERE c.id = $1 AND s.student_id = $2 AND ($3::uuid IS NULL OR c.subject_id = $3::uuid)
       LIMIT 1`,
      [conceptId, studentId, subjectId ?? null]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying concept access:', error);
    return false;
  }
}

/** Every concept id must belong to the Student (and to `subjectId` when given). */
export async function verifyConceptsAccess(studentId: string, conceptIds: string[], subjectId?: string | null): Promise<boolean> {
  const ids = [...new Set(conceptIds)];
  if (ids.length === 0) return true;
  try {
    const result = await db.query(
      `SELECT count(*)::int AS n FROM concepts c JOIN subjects s ON s.id = c.subject_id
       WHERE c.id = ANY($1::uuid[]) AND s.student_id = $2 AND ($3::uuid IS NULL OR c.subject_id = $3::uuid)`,
      [ids, studentId, subjectId ?? null]
    );
    return result.rows[0]?.n === ids.length;
  } catch (error) {
    console.error('Error verifying concepts access:', error);
    return false;
  }
}

export async function verifyDiagnosisAccess(studentId: string, diagnosisId: string): Promise<boolean> {
  try {
    const result = await db.query(`SELECT 1 FROM cognitive_diagnoses WHERE id = $1 AND student_id = $2 LIMIT 1`, [diagnosisId, studentId]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying diagnosis access:', error);
    return false;
  }
}

export async function verifyRemediationStepAccess(studentId: string, stepId: string): Promise<boolean> {
  try {
    const result = await db.query(
      `SELECT 1 FROM remediation_steps rs JOIN remediation_paths rp ON rp.id = rs.remediation_path_id
       WHERE rs.id = $1 AND rp.student_id = $2 LIMIT 1`,
      [stepId, studentId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying remediation step access:', error);
    return false;
  }
}

/**
 * Middleware helper for API routes
 *
 * Usage in route handlers:
 * ```
 * const { authContext, error } = await requireAuth();
 * if (error) return NextResponse.json({ error }, { status: 401 });
 *
 * const canAccess = await verifyStudentAccess(
 *   authContext.userId,
 *   body.studentId,
 *   authContext.role
 * );
 * if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 * ```
 */
export async function requireAuth() {
  const authContext = await verifyAuth();

  if (!authContext) {
    return {
      authContext: null,
      error: 'Unauthorized',
    };
  }

  return {
    authContext,
    error: null,
  };
}

/**
 * Rate limiting helper (prevent abuse)
 *
 * TODO: Implement with Redis for production
 */
const rateLimitMap: Map<string, { count: number; resetAt: number }> = new Map();

export function checkRateLimit(
  userId: string,
  endpoint: string,
  maxRequests: number = 100,
  windowSeconds: number = 60
): boolean {
  const key = `${userId}:${endpoint}`;
  const now = Date.now();

  const limit = rateLimitMap.get(key);

  if (!limit || now > limit.resetAt) {
    // New window
    rateLimitMap.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }

  if (limit.count >= maxRequests) {
    return false; // Rate limited
  }

  limit.count++;
  return true;
}
