/**
 * Shared SEO constants and helpers for the public marketing surface
 * (root `/` + `/[locale]/...`). The authenticated app under
 * `/dashboard` is intentionally excluded from all of this -- see
 * `src/app/robots.ts` and `src/app/dashboard/layout.tsx`'s `noindex`.
 */

import type { Locale } from '@/lib/i18n/messages';
import { LOCALES } from '@/lib/i18n/messages';

export const SITE_URL = 'https://www.studyus.pro';
export const SITE_NAME = 'StudyUS';

// Matches the language the root `/` route has always defaulted to
// (see the pre-existing `getMessages('es')` call in the original
// src/app/page.tsx) -- kept as-is to avoid changing default behavior
// for visitors with no detectable language preference.
export const DEFAULT_LOCALE: Locale = 'es';

export const MARKETING_LOCALES: Locale[] = LOCALES;

/**
 * Builds the `alternates.languages` map Next's Metadata API expects,
 * pointing every supported locale at the same logical page plus an
 * `x-default` pointing at the bare (locale-negotiating) URL.
 */
export function buildLanguageAlternates(pathSuffix: string = ''): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of MARKETING_LOCALES) {
    languages[locale] = `${SITE_URL}/${locale}${pathSuffix}`;
  }
  languages['x-default'] = `${SITE_URL}${pathSuffix}`;
  return languages;
}

export function isSupportedLocale(value: string): value is Locale {
  return (MARKETING_LOCALES as string[]).includes(value);
}

/**
 * Picks the best-supported locale from a raw `Accept-Language` header
 * value, falling back to DEFAULT_LOCALE when nothing matches -- used
 * only to route an unauthenticated visitor at `/` to a real localized
 * URL, never to gate/hide content.
 */
export function pickLocaleFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const preferred = header
    .split(',')
    .map((part) => part.trim().split(';')[0].toLowerCase().slice(0, 2));
  for (const lang of preferred) {
    if (isSupportedLocale(lang)) return lang;
  }
  return DEFAULT_LOCALE;
}
