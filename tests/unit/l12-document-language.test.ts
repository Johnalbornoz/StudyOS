/**
 * CR-L12-01 -- <html lang> follows the route locale instead of a
 * hard-coded "en" (Stage finding KF-L12-01).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { FALLBACK_DOCUMENT_LANGUAGE, resolveDocumentLanguage } from '@/lib/i18n/document-language';
import { LOCALES } from '@/lib/i18n/messages';

describe('resolveDocumentLanguage', () => {
  it('Spanish routes declare Spanish', () => {
    expect(resolveDocumentLanguage('/es')).toBe('es');
    expect(resolveDocumentLanguage('/es/how-it-works')).toBe('es');
  });

  it('English routes declare English', () => {
    expect(resolveDocumentLanguage('/en')).toBe('en');
    expect(resolveDocumentLanguage('/en/how-it-works')).toBe('en');
  });

  it('every supported locale declares itself', () => {
    for (const locale of LOCALES) expect(resolveDocumentLanguage(`/${locale}/how-it-works`)).toBe(locale);
  });

  it('a route without a locale keeps the fallback, not a guessed language', () => {
    for (const p of ['/', '/sign-in', '/dashboard/today', '/escape', '/ES', '/xx/es', '', null, undefined]) {
      expect(resolveDocumentLanguage(p)).toBe(FALLBACK_DOCUMENT_LANGUAGE);
    }
  });
});

describe('root layout', () => {
  const source = readFileSync(path.resolve(__dirname, '../../src/app/layout.tsx'), 'utf-8');

  it('does not hard-code the document language', () => {
    expect(source).not.toMatch(/<html[^>]*lang="[a-z-]+"/i);
    expect(source).toMatch(/<html lang=\{lang\}/);
  });

  it('derives it from the path the proxy forwards', () => {
    expect(source).toContain('resolveDocumentLanguage((await headers()).get(PATHNAME_HEADER))');
  });
});
