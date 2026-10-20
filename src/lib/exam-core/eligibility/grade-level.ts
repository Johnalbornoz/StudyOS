/**
 * Exam eligibility -- one comparable grade number for a Student's school year.
 *
 * The Academic Profile stores the school year as the country's own words
 * ('10°', '1° Preparatoria', 'Grade 9', 'Klasse 11', 'DP1'). Eligibility rules
 * compare stages, so every value is normalised to YEARS OF SCHOOLING on the
 * US grade scale (Grade 1 = 1 ... Grade 12 = 12). An unknown or missing value
 * is null: a rule that needs a grade then simply does not apply (never a guess).
 *
 *   CO  6°..11°                       -> 6..11  (also '11', '11.°')
 *   MX  1°-3° Secundaria              -> 7..9
 *       1°-3° Preparatoria / Bachillerato -> 10..12
 *   US / OTHER  Grade N               -> N
 *   DE  Klasse N                      -> N
 *   IB  MYP 1..5                      -> 6..10;  DP1 / DP2 -> 11 / 12
 *
 * Pure.
 */

export interface GradeInput {
  countryOfStudy?: string | null;
  schoolYear?: string | null;
  curriculumType?: string | null;
  ibProgramme?: string | null;
  ibYear?: string | null;
}

const MIN_GRADE = 1;
const MAX_GRADE = 13;

function firstNumber(s: string): number | null {
  const m = s.match(/(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

function bounded(n: number | null): number | null {
  return n !== null && n >= MIN_GRADE && n <= MAX_GRADE ? n : null;
}

function ibGrade(ibYear: string | null | undefined): number | null {
  if (!ibYear) return null;
  const y = ibYear.trim().toUpperCase();
  const dp = y.match(/^DP\s*([12])$/);
  if (dp) return 10 + Number(dp[1]);
  const myp = y.match(/^MYP\s*([1-5])$/);
  if (myp) return 5 + Number(myp[1]);
  return null;
}

/** Years of schooling (US grade scale), or null when the value cannot be read with confidence. */
export function normaliseGradeLevel(input: GradeInput | null | undefined): number | null {
  if (!input) return null;
  const raw = (input.schoolYear ?? '').trim();
  const lower = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = raw ? firstNumber(raw) : null;

  if (raw && n !== null) {
    if (input.countryOfStudy === 'MX') {
      if (lower.includes('secundaria')) return n >= 1 && n <= 3 ? 6 + n : null;
      if (lower.includes('preparatoria') || lower.includes('bachillerato')) return n >= 1 && n <= 3 ? 9 + n : null;
      if (lower.includes('primaria')) return n >= 1 && n <= 6 ? n : null;
    }
    // CO ordinal grades, US 'Grade N', DE 'Klasse N', OTHER: the number is already the grade.
    if (!/[a-z]/.test(lower) || /grade|klasse|grado|year|ano|annee/.test(lower)) return bounded(n);
  }

  // The school year is missing or unreadable: an IB year is a reliable stage of its own.
  if (input.curriculumType === 'ib') return ibGrade(input.ibYear);
  return null;
}
