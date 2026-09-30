/**
 * UX-5 -- the Tutor's age-band policy input.
 *
 * Derived ONLY from the structured Academic Profile catalogs the Student
 * chose from (`academic-options.ts`: country school years, IB MYP / DP
 * years). Never parsed from free text, never guessed from other data. When
 * no structured value exists the band is UNKNOWN and every consumer applies
 * the MOST restrictive rules.
 */
import { SCHOOL_YEARS_BY_COUNTRY, IB_MYP_YEARS, IB_DP_YEARS } from '@/lib/academic-options';

export const AGE_BANDS = ['PRE_TEEN', 'EARLY_TEEN', 'OLDER_TEEN', 'UNKNOWN'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Catalog entry -> band. Grades 6-7 pre-teen, 8-9 early teen, 10+ older teen (country catalogs start at grade 6). */
const BAND_BY_SCHOOL_YEAR: Record<string, AgeBand> = {};
for (const years of Object.values(SCHOOL_YEARS_BY_COUNTRY)) {
  years.forEach((label, i) => {
    // every catalog is ordered from its first secondary year (grade 6 / 1° Secundaria / Klasse 6)
    const grade = 6 + i;
    BAND_BY_SCHOOL_YEAR[label] = grade <= 7 ? 'PRE_TEEN' : grade <= 9 ? 'EARLY_TEEN' : 'OLDER_TEEN';
  });
}
IB_MYP_YEARS.forEach((label, i) => {
  // MYP 1-2 ~ 11-12, MYP 3-5 ~ 13-16 (MYP 5 kept in the stricter band)
  BAND_BY_SCHOOL_YEAR[label] = i <= 1 ? 'PRE_TEEN' : 'EARLY_TEEN';
});
IB_DP_YEARS.forEach((label) => {
  BAND_BY_SCHOOL_YEAR[label] = 'OLDER_TEEN';
});

export function ageBandFor(profile: { schoolYear?: string | null; ibProgramme?: string | null; ibYear?: string | null } | null): AgeBand {
  if (!profile) return 'UNKNOWN';
  // IB year first (the more specific structured value), then the country catalog.
  if (profile.ibYear && BAND_BY_SCHOOL_YEAR[profile.ibYear]) return BAND_BY_SCHOOL_YEAR[profile.ibYear];
  if (profile.schoolYear && BAND_BY_SCHOOL_YEAR[profile.schoolYear]) return BAND_BY_SCHOOL_YEAR[profile.schoolYear];
  return 'UNKNOWN';
}

/** Ordinal for "is this content allowed for this band": a stricter band never receives content approved only for an older one. */
export function bandRank(band: AgeBand): number {
  return band === 'OLDER_TEEN' ? 3 : band === 'EARLY_TEEN' ? 2 : band === 'PRE_TEEN' ? 1 : 0;
}
