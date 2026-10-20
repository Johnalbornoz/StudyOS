/**
 * J3.3 -- "No sé qué examen necesito": guided discovery (pure).
 *
 * Suggestions come ONLY from the governed eligibility rules that already exist
 * (country + grade: Saber 11, PAA, PISA). There is no governed data mapping an
 * educational goal, a university or a programme to a required exam, so none of
 * those is asked as if it decided anything, and no requirement is ever claimed:
 * every result carries TARGET_REQUIREMENT_UNCONFIRMED ("confirm with your
 * institution"). Only Student-visible catalogue objectives are suggested.
 */
import { COUNTRIES, SCHOOL_YEARS_BY_COUNTRY, type CountryOfStudy } from '@/lib/academic-options';
import { normaliseGradeLevel } from '@/lib/exam-core/eligibility/grade-level';
import { ASSESSMENT_ELIGIBILITY_RULES, resolveObjectiveEligibility, type EligibilityReasonCode } from '@/lib/exam-core/eligibility/rules';
import type { ExamObjective } from '@/lib/exam-core/objectives/objective-catalog';

export interface DiscoveryCountry {
  value: string;
  label: string;
  /** School-year labels offered for this country. */
  grades: string[];
}

/** Profile countries, plus the countries the governed rules name (e.g. PR for the PAA). */
export function discoveryCountries(): DiscoveryCountry[] {
  const out: DiscoveryCountry[] = COUNTRIES.map((c) => ({ value: c.value, label: c.label, grades: SCHOOL_YEARS_BY_COUNTRY[c.value] }));
  const named = new Set(ASSESSMENT_ELIGIBILITY_RULES.flatMap((r) => (r.countries === 'ANY' ? [] : r.countries)));
  if (named.has('PR') && !out.some((c) => c.value === 'PR')) out.splice(out.length - 1, 0, { value: 'PR', label: 'Puerto Rico', grades: SCHOOL_YEARS_BY_COUNTRY.US });
  return out;
}

export interface DiscoverySuggestion {
  objectiveKey: string;
  label: string;
  framework: ExamObjective['framework'];
  reason: Extract<EligibilityReasonCode, 'COUNTRY_GRADE' | 'GRADE'>;
  /** Always: StudyUs has no verified admission-requirement data. */
  requirement: 'TARGET_REQUIREMENT_UNCONFIRMED';
}

export const MAX_DISCOVERY_SUGGESTIONS = 3;

export function discoverExamSuggestions(input: { country: string | null; schoolYear: string | null }, objectives: ExamObjective[]): DiscoverySuggestion[] {
  const country = input.country && input.country !== 'OTHER' ? input.country : null;
  const gradeCountry = (country === 'PR' ? 'US' : country) as CountryOfStudy | null;
  const gradeLevel = normaliseGradeLevel({ countryOfStudy: gradeCountry, schoolYear: input.schoolYear });
  if (gradeLevel === null) return [];
  const candidates = objectives.filter((o) => o.kind === 'EXAM');
  const eligibility = resolveObjectiveEligibility(candidates, { country, gradeLevel, programmes: [], assignments: [], profileCompleted: false }, { programmes: [], subjectsByConfigKey: {} });
  const out: DiscoverySuggestion[] = [];
  const seenFramework = new Set<string>();
  for (const e of eligibility.filter((x) => x.eligible).sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key))) {
    const o = candidates.find((c) => c.key === e.key)!;
    const reason = e.reasons.find((r) => r.code === 'COUNTRY_GRADE' || r.code === 'GRADE');
    if (!reason || seenFramework.has(o.framework)) continue;
    seenFramework.add(o.framework);
    out.push({ objectiveKey: o.key, label: o.label, framework: o.framework, reason: reason.code as DiscoverySuggestion['reason'], requirement: 'TARGET_REQUIREMENT_UNCONFIRMED' });
    if (out.length === MAX_DISCOVERY_SUGGESTIONS) break;
  }
  return out;
}
