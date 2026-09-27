/**
 * Subject-level generation context shared by live question generation
 * (generate-and-take) and background preparation: the quiz language the
 * subject resolves to, and its IB programme context. Moved verbatim out of
 * the generate-and-take route so a background Prove preparation uses the
 * SAME language and IB/DP/HL context as the live request.
 */
import { db } from '@/lib/db';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { resolveQuizLanguage } from '@/lib/i18n/language';
import type { IBContext } from '@/services/quiz-generation.service';

export async function resolveLanguageForSubject(subjectId: string, studentId: string) {
  const result = await db.query(
    `SELECT target_language, quiz_language_mode FROM subjects WHERE id = $1`,
    [subjectId]
  );
  const subject = result.rows[0] || {};
  const interfaceLanguage = await getInterfaceLanguage(studentId);
  return resolveQuizLanguage(subject, interfaceLanguage);
}

export async function getSubjectIBContext(subjectId: string): Promise<IBContext | null> {
  const result = await db.query(
    `SELECT ib_programme, ib_subject_group, ib_level FROM subjects WHERE id = $1`,
    [subjectId]
  );
  const row = result.rows[0];
  if (!row || row.ib_programme === 'none') return null;
  return { programme: row.ib_programme, subjectGroup: row.ib_subject_group, level: row.ib_level };
}
