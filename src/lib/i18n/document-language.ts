import { isLocale, type Locale } from './messages';

/**
 * The language declared on `<html lang>` when the route does not carry a
 * locale (sign-in, the authenticated app). Unchanged from the value the
 * root layout has always rendered.
 */
export const FALLBACK_DOCUMENT_LANGUAGE: Locale = 'en';

/**
 * The document language for a request path: the leading locale segment of
 * a localized route (`/es`, `/en/how-it-works`), otherwise the fallback.
 * Pure -- the root layout supplies the path the proxy forwards.
 */
export function resolveDocumentLanguage(pathname: string | null | undefined): Locale {
  const segment = pathname?.split('/')[1];
  return isLocale(segment) ? segment : FALLBACK_DOCUMENT_LANGUAGE;
}
