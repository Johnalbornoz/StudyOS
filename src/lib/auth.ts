/**
 * Authorization & Tenant Verification
 *
 * Ensures:
 * 1. User is authenticated (via Clerk)
 * 2. User can access the requested resource
 * 3. Multi-tenancy is respected (students can't access other students' data)
 */

import { auth } from '@clerk/nextjs/server';
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
    // Link between Clerk userId and studentId needs to be in a mapping table
    // For now, assume direct match (same ID)
    // TODO: Create users table linking clerk userId to studentId
    return userId === studentId;
  } catch (error) {
    console.error('Error checking student ownership:', error);
    return false;
  }
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
