import type { Locale } from '@/lib/i18n/messages';
import { LOCALES } from '@/lib/i18n/messages';

/**
 * LX-8 R9-R11 -- ACTIVITY LANGUAGE AUTHORITY (formalized).
 *
 * StudyUS already draws this distinction functionally -- it was just
 * never given its own name/module. `getInterfaceLanguage`
 * (src/lib/i18n/language.ts) governs the shell/nav/account.
 * `resolveQuizLanguage` (same file) already decides what language ONE
 * active learning activity runs in, independent of interface language;
 * `src/app/dashboard/quiz/page.tsx`'s `quizLanguage` state (rendered
 * via `at = getMessages(quizLanguage)`) is that resolved value, held
 * for the whole active session. This module does not replace either --
 * it gives the concept a name so LX-8's multimodal controls (TTS/STT)
 * have one explicit thing to follow, instead of quietly reading
 * `quizLanguage` by convention.
 *
 * R10: `expectedResponseLanguage` is kept as its OWN field, not an
 * alias for `activityLanguage`, so a future language-learning surface
 * (instructionLanguage != targetLanguage != expectedResponseLanguage)
 * can diverge them without a contract change. LX-8 does not redesign
 * language-learning pedagogy -- today it always equals
 * `activityLanguage`, which is itself already the right answer for
 * every non-language-course subject and for language courses (whose
 * target_language IS the language the learner must respond in).
 */
export interface ActivityLanguageContext {
  /** Governs question/instruction/MODEL/GUIDE/help/feedback/TTS/STT for this activity. Never the interface language. */
  activityLanguage: Locale;
  /** The language a learner's response is expected in. Distinct field per R10; equals activityLanguage today. */
  expectedResponseLanguage: Locale;
}

export function buildActivityLanguageContext(activityLanguage: Locale): ActivityLanguageContext {
  return { activityLanguage, expectedResponseLanguage: activityLanguage };
}

/**
 * R11: deterministic locale fallback for a BCP-47 tag the platform
 * handed us (e.g. from `navigator.language`, or a browser voice's own
 * `.lang`) down to StudyUS's fixed 5-locale set. Never guesses a
 * DIFFERENT language -- only strips region/script subtags
 * ("es-MX" -> "es", "pt-BR" -> "pt"). Returns null when even the base
 * subtag isn't one of StudyUS's locales -- callers must show an
 * explicit unavailable state (R11), never silently substitute another
 * language's content.
 */
export function fallbackToSupportedLocale(bcp47: string): Locale | null {
  const base = bcp47.split('-')[0].toLowerCase();
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : null;
}

/**
 * The BCP-47 tag StudyUS asks the browser's TTS/STT APIs for, for a
 * given activityLanguage. One deterministic mapping, never derived
 * from interface language. Region choice is a fixed product default,
 * not a guess -- these are the same 5 locales `Locale` already covers.
 */
const LOCALE_TO_BCP47: Record<Locale, string> = {
  es: 'es-ES',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  pt: 'pt-BR',
};

export function activityLanguageToBCP47(locale: Locale): string {
  return LOCALE_TO_BCP47[locale];
}
