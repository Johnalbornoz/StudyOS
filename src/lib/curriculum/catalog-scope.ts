/**
 * Curriculum catalogue SCOPE (pure): national vs international curricula,
 * derived from metadata the canonical catalogue already carries -- never a
 * hardcoded list of IB / Cambridge.
 *
 *   NATIONAL       the authority belongs to a country (academic_organizations.country,
 *                  or a GOVERNMENT_AUTHORITY), e.g. SEP (MX), MEN (CO), a Secretaría.
 *   INTERNATIONAL  an international programme body with no country, e.g. IB, Cambridge.
 *
 * Only `academic_programmes.programme_type = 'CURRICULUM'` ever reaches this
 * catalogue: assessment frameworks (PISA) and admission exams (PAA, Saber 11)
 * are Exam Engine targets and belong to "Preparación para el examen", not here.
 */

export type CurriculumScope = 'NATIONAL' | 'INTERNATIONAL';

export interface ScopedSource {
  academicSubjectId: string;
  versionId: string;
  subject: string;
  level: string | null;
  qualification: string | null;
  programmeId: string;
  programme: string;
  authorityId?: string;
  authority: string;
  country: string | null;
  sourceType: string;
}

export function curriculumScope(s: Pick<ScopedSource, 'country' | 'sourceType'>): CurriculumScope {
  return s.country || s.sourceType === 'GOVERNMENT_AUTHORITY' ? 'NATIONAL' : 'INTERNATIONAL';
}

/** Programme types allowed in curriculum configuration (exams never are). */
export const CURRICULUM_PROGRAMME_TYPES = ['CURRICULUM'] as const;

const KNOWN_COUNTRIES: Record<string, string> = { MX: 'México', CO: 'Colombia' };

/** A readable country name for any ISO code the catalogue holds (no hardcoded list of supported countries). */
export function countryLabel(code: string, locale = 'es'): string {
  if (KNOWN_COUNTRIES[code] && locale === 'es') return KNOWN_COUNTRIES[code];
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return KNOWN_COUNTRIES[code] ?? code;
  }
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];
const byLabel = (a: string, b: string) => a.localeCompare(b, 'es');
const authorityKey = (s: ScopedSource) => s.authorityId ?? s.authority;

/** Which scopes the published catalogue actually offers (an empty scope is never shown). */
export function availableScopes(sources: ScopedSource[]): CurriculumScope[] {
  const present = new Set(sources.map(curriculumScope));
  return (['NATIONAL', 'INTERNATIONAL'] as const).filter((s) => present.has(s));
}

export function nationalCountries(sources: ScopedSource[]): string[] {
  return uniq(sources.filter((s) => curriculumScope(s) === 'NATIONAL' && s.country).map((s) => s.country as string)).sort(byLabel);
}

/** Programmes for a country (national) -- one entry per programme, with its authority. */
export function nationalProgrammes(sources: ScopedSource[], country: string): ScopedSource[] {
  const m = new Map<string, ScopedSource>();
  for (const s of sources) if (curriculumScope(s) === 'NATIONAL' && s.country === country && !m.has(s.programmeId)) m.set(s.programmeId, s);
  return [...m.values()];
}

/** International authorities present in the catalogue (e.g. IB, Cambridge), one entry each. */
export function internationalAuthorities(sources: ScopedSource[]): Array<{ key: string; name: string; programmes: number }> {
  const m = new Map<string, { key: string; name: string; programmes: Set<string> }>();
  for (const s of sources) {
    if (curriculumScope(s) !== 'INTERNATIONAL') continue;
    const k = authorityKey(s);
    const e = m.get(k) ?? { key: k, name: s.authority, programmes: new Set<string>() };
    e.programmes.add(s.programmeId);
    m.set(k, e);
  }
  return [...m.values()].map((e) => ({ key: e.key, name: e.name, programmes: e.programmes.size })).sort((a, b) => byLabel(a.name, b.name));
}

export function internationalProgrammes(sources: ScopedSource[], authority: string): ScopedSource[] {
  const m = new Map<string, ScopedSource>();
  for (const s of sources) if (curriculumScope(s) === 'INTERNATIONAL' && authorityKey(s) === authority && !m.has(s.programmeId)) m.set(s.programmeId, s);
  return [...m.values()];
}

/** Qualifications of one programme (e.g. AS / A Level); empty when the programme has none. */
export function programmeQualifications(sources: ScopedSource[], programmeId: string): string[] {
  return uniq(sources.filter((s) => s.programmeId === programmeId && s.qualification).map((s) => s.qualification as string)).sort(byLabel);
}
