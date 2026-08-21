import { query } from '@/lib/db';

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
