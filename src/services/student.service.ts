import { query } from '@/lib/db';

/**
 * @deprecated DEAD CODE -- zero callers anywhere in the repository
 * (verified Phase 0C). DO NOT wire this up. It writes the raw Clerk
 * `userId` directly as `profiles.id`, and never creates a `students`
 * row at all -- it would silently violate the shared-UUID identity
 * contract documented in `src/lib/auth.ts` (students.id === profiles.id)
 * if it were ever called. The only canonical student-provisioning path
 * is `getOrCreateStudentId` in `src/lib/auth.ts`.
 */
export async function createStudent(
  userId: string,
  email: string,
  fullName: string,
  userType: 'student' | 'parent' | 'admin'
) {
  try {
    // Insert into profiles
    await query(
      `INSERT INTO profiles (id, user_type, full_name) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO NOTHING`,
      [userId, userType, fullName]
    );

    // If student, insert into student_profiles
    if (userType === 'student') {
      await query(
        `INSERT INTO student_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [userId]
      );
    }

    return { success: true, userId };
  } catch (error) {
    console.error('Error creating student:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * @deprecated DEAD CODE -- zero callers anywhere in the repository
 * (verified Phase 0C). Reads `profiles` directly by a caller-supplied
 * `userId` with no relation to the canonical `getOrCreateStudentId`
 * flow in `src/lib/auth.ts`.
 */
export async function getStudent(userId: string) {
  try {
    const result = await query(
      `SELECT * FROM profiles WHERE id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting student:', error);
    return null;
  }
}
