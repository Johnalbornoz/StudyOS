/**
 * Cambridge AICE Diploma -- the governed, versioned award policy.
 *
 * Every rule comes from cambridgeinternational.org (docs/exams/v2/sources/
 * aice-diploma.json, retrieved 2026-10-01) and carries its source key and
 * confidence. Rules Cambridge does not state publicly are NOT guessed: they are
 * marked `confirmed: false` and the StudyUs behaviour chosen for them is the
 * conservative one, shown to the Student as a planning assumption.
 *
 * The AICE Diploma is a group award over Cambridge International AS & A Level
 * results -- never an exam definition of its own.
 */

export type AiceLevel = 'AS' | 'A';
export type AiceGroup = 'CORE' | 'GROUP_1' | 'GROUP_2' | 'GROUP_3' | 'GROUP_4';
export type SeriesMonth = 3 | 6 | 11;
export interface ExamSeries {
  year: number;
  month: SeriesMonth;
}

export const AS_GRADES = ['a', 'b', 'c', 'd', 'e', 'U'] as const;
export const A_GRADES = ['A*', 'A', 'B', 'C', 'D', 'E', 'U'] as const;
export type AsGrade = (typeof AS_GRADES)[number];
export type AGrade = (typeof A_GRADES)[number];

export interface PolicyRule<T> {
  value: T;
  sourceKey: string;
  confirmed: boolean;
  note?: string;
}

export const AICE_DIPLOMA_POLICY = {
  version: 'AICE-DIPLOMA-2026-10',
  retrievedAt: '2026-10-01',
  sources: {
    'cie-aice-qualification': 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-advanced/cambridge-aice-diploma/qualification/',
    'cie-aice-curriculum': 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-advanced/cambridge-aice-diploma/curriculum/',
    'cie-us-grades-guide': 'https://www.cambridgeinternational.org/usa/about-cambridge-international-us/guide-to-cambridge-grades/',
  } as Record<string, string>,
  minimumCredits: { value: 7, sourceKey: 'cie-aice-qualification', confirmed: true } as PolicyRule<number>,
  creditsPerLevel: { value: { AS: 1, A: 2 }, sourceKey: 'cie-aice-qualification', confirmed: true } as PolicyRule<Record<AiceLevel, number>>,
  coreSyllabus: { value: '9239', sourceKey: 'cie-aice-qualification', confirmed: true, note: 'Cambridge International AS Level Global Perspectives & Research is compulsory.' } as PolicyRule<string>,
  requiredGroups: { value: ['GROUP_1', 'GROUP_2', 'GROUP_3'] as AiceGroup[], sourceKey: 'cie-aice-qualification', confirmed: true, note: 'At least one credit from each.' } as PolicyRule<AiceGroup[]>,
  group4MaxCredits: { value: 2, sourceKey: 'cie-aice-qualification', confirmed: true } as PolicyRule<number>,
  /** A Level GP&R meets the core AND gives one credit that counts in Group 4. */
  gprALevelExtraGroup4Credit: { value: true, sourceKey: 'cie-aice-qualification', confirmed: true } as PolicyRule<boolean>,
  /** With A Level GP&R, A Level GP&R + three A Levels (8 credits) is allowed when it gives the best outcome. */
  gprALevelPlusThreeALevels: { value: true, sourceKey: 'cie-aice-qualification', confirmed: true } as PolicyRule<boolean>,
  /** With A Level GP&R, A Level Thinking Skills (9694) may exceed the Group 4 limit when it gives the best outcome. */
  thinkingSkillsAOverGroup4WithGprA: { value: '9694', sourceKey: 'cie-aice-qualification', confirmed: true } as PolicyRule<string>,
  window: { value: { months: 25, maxSeries: 5 }, sourceKey: 'cie-aice-qualification', confirmed: true, note: 'Up to five exam series within a 25-month period.' } as PolicyRule<{ months: number; maxSeries: number }>,
  points: {
    value: { A: { 'A*': 140, A: 120, B: 100, C: 80, D: 60, E: 40 } as Record<string, number>, AS: { a: 60, b: 50, c: 40, d: 30, e: 20 } as Record<string, number> },
    sourceKey: 'cie-aice-qualification',
    confirmed: true,
  } as PolicyRule<{ A: Record<string, number>; AS: Record<string, number> }>,
  maxScore: { value: 420, sourceKey: 'cie-aice-qualification', confirmed: true } as PolicyRule<number>,
  awardBands: { value: [{ band: 'DISTINCTION', min: 360, max: 420 }, { band: 'MERIT', min: 250, max: 359 }, { band: 'PASS', min: 140, max: 249 }] as Array<{ band: 'DISTINCTION' | 'MERIT' | 'PASS'; min: number; max: number }>, sourceKey: 'cie-aice-qualification', confirmed: true } as PolicyRule<Array<{ band: 'DISTINCTION' | 'MERIT' | 'PASS'; min: number; max: number }>>,
  // ---- not stated publicly: conservative StudyUs behaviour, disclosed ----
  oneCountedInstancePerSyllabus: { value: true, sourceKey: 'cie-aice-qualification', confirmed: false, note: 'A syllabus counts once (its A Level, or its AS Level -- never both).' } as PolicyRule<boolean>,
  bestEligibleRetake: { value: true, sourceKey: 'cie-aice-qualification', confirmed: false, note: 'With several results for the same syllabus and level, the best eligible one is used.' } as PolicyRule<boolean>,
  scoreMethod: { value: 'SUM_OF_COUNTED_RESULTS_CAPPED', sourceKey: 'cie-aice-qualification', confirmed: false, note: 'Points of the counted results (core included), capped at 420; Cambridge only states "best overall outcome".' } as PolicyRule<string>,
  series: { value: { months: [6, 11, 3] as SeriesMonth[], marchCountries: ['IN'] }, sourceKey: 'cie-aice-qualification', confirmed: true, note: 'June and November; March is for India only.' } as PolicyRule<{ months: SeriesMonth[]; marchCountries: string[] }>,
} as const;

export type AicePolicy = typeof AICE_DIPLOMA_POLICY;

export const creditsFor = (level: AiceLevel, policy: AicePolicy = AICE_DIPLOMA_POLICY) => policy.creditsPerLevel.value[level];

export function isValidGrade(level: AiceLevel, grade: string): boolean {
  return level === 'AS' ? (AS_GRADES as readonly string[]).includes(grade) : (A_GRADES as readonly string[]).includes(grade);
}
export const isPass = (grade: string) => grade !== 'U';

export function pointsFor(level: AiceLevel, grade: string, policy: AicePolicy = AICE_DIPLOMA_POLICY): number {
  if (!isValidGrade(level, grade) || !isPass(grade)) return 0;
  return policy.points.value[level][grade] ?? 0;
}

export function bandFor(points: number, policy: AicePolicy = AICE_DIPLOMA_POLICY): 'DISTINCTION' | 'MERIT' | 'PASS' | null {
  return policy.awardBands.value.find((b) => points >= b.min && points <= b.max)?.band ?? null;
}

export const seriesIndex = (s: ExamSeries) => s.year * 12 + (s.month - 1);
export const seriesLabelKey = (s: ExamSeries) => `${s.month === 3 ? 'MARCH' : s.month === 6 ? 'JUNE' : 'NOVEMBER'}`;

/** Series a Student can sit: June and November everywhere; March only where Cambridge offers it. */
export function availableSeries(fromYear: number, years: number, countryCode: string | null, policy: AicePolicy = AICE_DIPLOMA_POLICY): ExamSeries[] {
  const out: ExamSeries[] = [];
  const march = !!countryCode && policy.series.value.marchCountries.includes(countryCode.toUpperCase());
  for (let y = fromYear; y < fromYear + years; y++) for (const m of [3, 6, 11] as SeriesMonth[]) if (m !== 3 || march) out.push({ year: y, month: m });
  return out;
}

/** The last series in which a result can still count: the 25-month window spans at most 24 months between series. */
export function expiresAfter(s: ExamSeries, policy: AicePolicy = AICE_DIPLOMA_POLICY): ExamSeries {
  const idx = seriesIndex(s) + (policy.window.value.months - 1);
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 1) as SeriesMonth };
}
