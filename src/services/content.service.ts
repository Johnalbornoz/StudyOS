import { query } from '@/lib/db';

export async function createContentSource(
  studentId: string,
  subjectId: string,
  sourceType: string,
  sourceLanguage: string,
  storagePath: string
) {
  try {
    const result = await query(
      `INSERT INTO content_sources (student_id, subject_id, source_type, source_language, storage_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [studentId, subjectId, sourceType, sourceLanguage, storagePath]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating content source:', error);
    throw error;
  }
}

export async function getContentSources(studentId: string, subjectId: string) {
  try {
    const result = await query(
      `SELECT * FROM content_sources 
       WHERE student_id = $1 AND subject_id = $2
       ORDER BY uploaded_at DESC`,
      [studentId, subjectId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting content sources:', error);
    return [];
  }
}
