/**
 * Authorization & Tenant Verification
 *
 * Ensures:
 * 1. User is authenticated (via Clerk)
 * 2. User can access the requested resource
 * 3. Multi-tenancy is respected (students can't access other students' data)
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
 * Resolve a Clerk user ID to the internal students.id (UUID),
 * creating the row on first use if it doesn't exist yet.
 */
export async function getOrCreateStudentId(clerkUserId: string): Promise<string> {
  const existing = await db.query(
    `SELECT id FROM students WHERE clerk_id = $1`,
    [clerkUserId]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const user = await currentUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    `${clerkUserId}@placeholder.local`;
  const name = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null : null;

  const result = await db.query(
    `INSERT INTO students (clerk_id, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [clerkUserId, email, name]
  );
  return result.rows[0].id;
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
 * Verify subject/concept access (multi-tenancy)
 *
 * Ensures user can only access resources they're enrolled in
 */
export async function verifySubjectAccess(
  studentId: string,
  subjectId: string
): Promise<boolean> {
  try {
    // Check if student is enrolled in subject
    const result = await db.query(
      `
      SELECT 1 FROM student_subjects
      WHERE student_id = $1 AND subject_id = $2
      LIMIT 1
      `,
      [studentId, subjectId]
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
