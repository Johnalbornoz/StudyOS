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
