import { db } from '@/lib/db';
import { Locale, isLocale } from './messages';

const DEFAULT_LOCALE: Locale = 'es';

/** The student's chosen interface/UI language. Defaults to 'es' if never set. */
export async function getInterfaceLanguage(studentId: string): Promise<Locale> {
  const result = await db.query(
    `SELECT interface_language FROM user_language_preferences WHERE user_id = $1`,
    [studentId]
  );
  const value = result.rows[0]?.interface_language;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function setInterfaceLanguage(studentId: string, locale: Locale): Promise<void> {
  await db.query(
    `
    INSERT INTO user_language_preferences (user_id, interface_language, preferred_learning_language, source_language, updated_at)
    VALUES ($1, $2, $2, $2, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET interface_language = EXCLUDED.interface_language, updated_at = NOW()
    `,
    [studentId, locale]
  );
}

/**
 * Decide what language a subject's quizzes/content should be generated in.
 *
 * - If the subject itself IS a language course (target_language set, e.g.
 *   "Alemán" -> 'de'), ALWAYS use that language -- practicing German means
 *   reading and answering in German, regardless of the student's UI language.
 * - Otherwise (Math, History, etc.), follow the subject's quiz_language_mode:
 *   either match the student's current interface language, or stay fixed
 *   in English.
 */
export function resolveQuizLanguage(
  subject: { target_language?: string | null; quiz_language_mode?: string },
  interfaceLanguage: Locale
): Locale {
  if (isLocale(subject.target_language)) {
    return subject.target_language;
  }
  if (subject.quiz_language_mode === 'fixed_english') {
    return 'en';
  }
  return interfaceLanguage;
}

/**
 * Track A -- ONE interface-language preference per person, whatever
 * workspace they are in. A Student's preference has always been keyed by
 * `students.id` (must never move, or every Student's saved choice would
 * reset); every other identity is keyed by `users.id`. So a Student+Parent
 * (or Student+Teacher) account reads -- and `/api/language` writes -- the
 * Student key from every workspace, instead of a second, never-written
 * `users.id` preference showing up in the Parent/Teacher workspace.
 */
export async function getUserInterfaceLanguage(userId: string): Promise<Locale> {
  const student = await db.query(
    `SELECT s.id FROM students s
     JOIN user_roles r ON r.user_id = s.user_id AND r.role = 'STUDENT' AND r.status = 'ACTIVE'
     WHERE s.user_id = $1 ORDER BY s.created_at ASC NULLS LAST LIMIT 1`,
    [userId]
  );
  return getInterfaceLanguage(student.rows[0]?.id ?? userId);
}
