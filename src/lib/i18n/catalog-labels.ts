/**
 * REM-T1-07 -- ONE place that renders catalog-driven values in the interface
 * locale. Stored values and canonical IDs NEVER change with the locale: these
 * helpers only decide what is DISPLAYED.
 *
 * Fallback rule: when a localized display value does not exist, the canonical
 * official value is shown as-is (never an arbitrary source-language string).
 * Official qualification / programme names (IB Diploma Programme, Cambridge
 * IGCSE, MCCEMS, ...) are not translated.
 */
import type { Locale } from '@/lib/i18n/messages';
import { catalogSubjectByName } from '@/lib/experience/subject-catalog';

const OTHER_COUNTRY: Record<Locale, string> = { es: 'Otro', en: 'Other', de: 'Anderes Land', fr: 'Autre', pt: 'Outro' };

/** Country of study (ISO alpha-2 code, or 'OTHER') in the interface locale. */
export function countryDisplayName(code: string | null | undefined, locale: Locale): string {
  if (!code) return '';
  if (code === 'OTHER') return OTHER_COUNTRY[locale] ?? OTHER_COUNTRY.en;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

type GradeSystem = 'MX_SECUNDARIA' | 'MX_PREPARATORIA' | 'CO' | 'US' | 'DE';

/** Parses a STORED grade label (academic-options.ts SCHOOL_YEARS_BY_COUNTRY) into its system and number. */
export function parseStoredGrade(stored: string | null | undefined): { system: GradeSystem; n: number } | null {
  const v = (stored ?? '').trim();
  let m = /^(\d{1,2})°\s+Secundaria$/.exec(v);
  if (m) return { system: 'MX_SECUNDARIA', n: Number(m[1]) };
  m = /^(\d{1,2})°\s+Preparatoria$/.exec(v);
  if (m) return { system: 'MX_PREPARATORIA', n: Number(m[1]) };
  m = /^(\d{1,2})°$/.exec(v);
  if (m) return { system: 'CO', n: Number(m[1]) };
  m = /^Grade\s+(\d{1,2})$/.exec(v);
  if (m) return { system: 'US', n: Number(m[1]) };
  m = /^Klasse\s+(\d{1,2})$/.exec(v);
  if (m) return { system: 'DE', n: Number(m[1]) };
  return null;
}

const GRADE_TEMPLATES: Record<GradeSystem, Record<Locale, string>> = {
  // Secundaria / Preparatoria are the official Mexican level names: kept, with the year localized.
  MX_SECUNDARIA: { es: '{n}° Secundaria', en: 'Secundaria, year {n}', de: 'Secundaria, {n}. Jahr', fr: 'Secundaria, {n}e année', pt: 'Secundaria, {n}º ano' },
  MX_PREPARATORIA: { es: '{n}° Preparatoria', en: 'Preparatoria, year {n}', de: 'Preparatoria, {n}. Jahr', fr: 'Preparatoria, {n}e année', pt: 'Preparatoria, {n}º ano' },
  CO: { es: '{n}°', en: 'Grade {n}', de: 'Klasse {n}', fr: '{n}e année', pt: '{n}º ano' },
  US: { es: '{n}.º grado', en: 'Grade {n}', de: 'Klasse {n}', fr: '{n}e année (Grade {n})', pt: '{n}º ano' },
  DE: { es: '{n}.º curso (Klasse {n})', en: 'Year {n} (Klasse {n})', de: 'Klasse {n}', fr: '{n}e année (Klasse {n})', pt: '{n}º ano (Klasse {n})' },
};

/** A stored grade label in the interface locale; the stored (canonical) label when it is not recognised. */
export function gradeDisplayLabel(stored: string | null | undefined, locale: Locale): string {
  const g = parseStoredGrade(stored);
  if (!g) return stored ?? '';
  return (GRADE_TEMPLATES[g.system][locale] ?? GRADE_TEMPLATES[g.system].en).replace(/\{n\}/g, String(g.n));
}

/**
 * A learner subject name (stored in whatever locale was active when it was created,
 * e.g. "Matemáticas") in the interface locale when it is a catalog subject; otherwise
 * the stored name unchanged. Never renames the stored row.
 */
export function localizeSubjectName(name: string, locale: Locale | string): string {
  const hit = catalogSubjectByName(name);
  return hit && Object.prototype.hasOwnProperty.call(hit.names, locale) ? hit.names[locale as Locale] : name;
}
