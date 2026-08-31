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

import { auth, currentUser } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

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
 * Verify student access to their own data
 *
 * Rules:
 * - Students can only access their own studentId
 * - Teachers can access students they teach
 * - Admins can access any student
 */
export async function verifyStudentAccess(
  userId: string,
  studentId: string,
  role: UserRole
): Promise<boolean> {
  // Admins can access anyone
  if (role === 'admin') {
    return true;
  }

  // Students can only access themselves
  if (role === 'student') {
    const isOwner = await isUserStudent(userId, studentId);
    return isOwner;
  }

  // Teachers can access their students
  if (role === 'teacher') {
    const canTeach = await canTeacherAccessStudent(userId, studentId);
    return canTeach;
  }

  return false;
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

    const inserted = await client.query(
      `INSERT INTO students (clerk_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
       RETURNING id`,
      [clerkUserId, email, name]
    );
    const studentId = inserted.rows[0].id;

    await client.query(
      `INSERT INTO profiles (id, user_type, full_name)
       VALUES ($1, 'student', $2)
       ON CONFLICT (id) DO NOTHING`,
      [studentId, name]
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
 * Resolve a Clerk user ID to the internal student UUID (shared by
 * profiles.id and students.id), creating the rows on first use. Also
 * repairs the case where a students row exists without its matching
 * profiles/student_profiles rows (e.g. from before this fix landed).
 */
export async function getOrCreateStudentId(clerkUserId: string): Promise<string> {
  const existing = await db.query(
    `SELECT id FROM students WHERE clerk_id = $1`,
    [clerkUserId]
  );
  if (existing.rows.length > 0) {
    const studentId = existing.rows[0].id;
    await ensureProfileRows(studentId, null);
    return studentId;
  }

  const user = await currentUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    `${clerkUserId}@placeholder.local`;
  const name = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null : null;

  return upsertStudentRecord(clerkUserId, email, name);
}

/**
 * Same as getOrCreateStudentId but for use from the Clerk webhook, where
 * email/name are already available in the event payload (avoids an
 * extra Clerk API call via currentUser()).
 */
export async function upsertStudentFromWebhook(
  clerkUserId: string,
  email: string,
  name: string | null
): Promise<string> {
  return upsertStudentRecord(clerkUserId, email, name);
}

/**
 * Resolve a Clerk user ID to a parent's profile UUID, creating the
 * profiles row (user_type='parent') on first use. Separate from
 * getOrCreateStudentId: parents have no legacy `students` table entry,
 * so identity resolution goes through profiles.clerk_id instead.
 */
export async function getOrCreateParentId(clerkUserId: string): Promise<string> {
  const existing = await db.query(`SELECT id FROM profiles WHERE clerk_id = $1`, [clerkUserId]);
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const user = await currentUser();
  const name = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null : null;

  const inserted = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id) VALUES (gen_random_uuid(), 'parent', $1, $2) RETURNING id`,
    [name, clerkUserId]
  );
  return inserted.rows[0].id;
}

/**
 * Check if teacher can access student
 */
async function canTeacherAccessStudent(
  teacherId: string,
  studentId: string
): Promise<boolean> {
  try {
    // TODO: Implement after creating teacher-student mapping table
    // Check if teacherId is assigned to teach studentId
    return false;
  } catch (error) {
    console.error('Error checking teacher access:', error);
    return false;
  }
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
