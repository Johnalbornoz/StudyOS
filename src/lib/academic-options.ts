/**
 * Country/grade option catalogs for the Academic Profile. Kept as data
 * (not hardcoded into the form component) so adding a country later is
 * a data change, not a structural one -- matches the brief's "no
 * destructive migrations to add a country" requirement.
 */

export type CountryOfStudy = 'CO' | 'MX' | 'US' | 'DE' | 'OTHER';
export type CurriculumType = 'national' | 'ib' | 'other' | 'not_sure';

export const COUNTRIES: { value: CountryOfStudy; label: string }[] = [
  { value: 'CO', label: 'Colombia' },
  { value: 'MX', label: 'México' },
  { value: 'US', label: 'United States' },
  { value: 'DE', label: 'Deutschland' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * School-year options per country. Free-text values (not an enum in
 * the DB) so a country's list can grow without a migration -- Germany
 * in particular is deliberately coarse for now (see brief section 6)
 * pending Gymnasium/Gesamtschule/Realschule modeling.
 */
export const SCHOOL_YEARS_BY_COUNTRY: Record<CountryOfStudy, string[]> = {
  CO: ['6°', '7°', '8°', '9°', '10°', '11°'],
  MX: ['1° Secundaria', '2° Secundaria', '3° Secundaria', '1° Preparatoria', '2° Preparatoria', '3° Preparatoria'],
  US: ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
  DE: ['Klasse 6', 'Klasse 7', 'Klasse 8', 'Klasse 9', 'Klasse 10', 'Klasse 11', 'Klasse 12', 'Klasse 13'],
  OTHER: ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
};

export const IB_MYP_YEARS = ['MYP 1', 'MYP 2', 'MYP 3', 'MYP 4', 'MYP 5'];
export const IB_DP_YEARS = ['DP1', 'DP2'];
