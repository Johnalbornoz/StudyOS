/**
 * Exam V2 -- AssessmentCalibrationSuite (section 23).
 *
 * No claim that StudyUs marks like an official examiner is allowed without
 * evidence. The suite holds cases (item + response + expected marks) and a
 * runner that grades them with the CURRENT graders and measures agreement.
 *
 *   origin OFFICIAL_EXEMPLAR / RELEASED_SAMPLE -- published, marked scripts
 *                                                  (none are held today: licensing);
 *   origin BENCHMARK_FIXTURE                    -- StudyUs-authored cases with
 *                                                  expected marks set by the item's key.
 *
 * `equivalenceClaimAllowed` is true only with >= 30 official cases at >= 80%
 * exact agreement and >= 95% within one mark. With zero official cases it is
 * always false -- the report says why.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { ApprovedItemContentSchema, examItemFromApproved, type ExamItem } from '../items';
import { gradeExamItem } from '../item-grading';
import type { AssessorRunner } from '../assessment/double-assessor.service';
import { IB_MATH_AA_HL_V2, CAMBRIDGE_0580_EXTENDED_V2, PISA_2022_V2, PAA_V2 } from '../verticals/v2';
import type { ExamVerticalConfigInput } from '../vertical-config';

export type CalibrationOrigin = 'OFFICIAL_EXEMPLAR' | 'RELEASED_SAMPLE' | 'BENCHMARK_FIXTURE';

export interface CalibrationCase {
  key: string;
  framework: string;
  componentRef: string;
  origin: CalibrationOrigin;
  itemKey: string;
  response: string;
  expectedMarks: number;
  maxMarks: number;
  needsAI: boolean;
}

const itemFrom = (cfg: ExamVerticalConfigInput, key: string) => {
  const it = cfg.items.find((i) => i.content.key === key);
  if (!it) throw new Error(`calibration: unknown item ${key}`);
  return it.content;
};

/** StudyUs benchmark cases: one correct, one partially correct, one wrong per deterministic strategy. */
export const BENCHMARK_CASES: Array<Omit<CalibrationCase, 'origin' | 'needsAI'> & { cfg: ExamVerticalConfigInput }> = [
  { key: 'bm.ib.log.correct-with-working', framework: 'IB', componentRef: 'aahl.p1', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p1.alg.log', response: '{"latex":"4","working":"x(x-2)=8\\nx^2-2x-8=0"}', expectedMarks: 5, maxMarks: 5 },
  { key: 'bm.ib.log.method-only', framework: 'IB', componentRef: 'aahl.p1', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p1.alg.log', response: '{"latex":"-2","working":"x^2-2x-8=0"}', expectedMarks: 2, maxMarks: 5 },
  { key: 'bm.ib.log.no-working', framework: 'IB', componentRef: 'aahl.p1', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p1.alg.log', response: '4', expectedMarks: 5, maxMarks: 5 },
  { key: 'bm.ib.product.equivalent-form', framework: 'IB', componentRef: 'aahl.p1', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p1.calc.product', response: 'x^2e^{2x}(3+2x)', expectedMarks: 3, maxMarks: 3 },
  { key: 'bm.ib.product.wrong', framework: 'IB', componentRef: 'aahl.p1', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p1.calc.product', response: '6x^2e^{2x}', expectedMarks: 0, maxMarks: 3 },
  { key: 'bm.ib.normal.3sf', framework: 'IB', componentRef: 'aahl.p2', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p2.stat.normal', response: '0.0668', expectedMarks: 2, maxMarks: 2 },
  { key: 'bm.ib.normal.2sf', framework: 'IB', componentRef: 'aahl.p2', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p2.stat.normal', response: '0.067', expectedMarks: 1, maxMarks: 2 },
  { key: 'bm.ib.cosine.unit-missing', framework: 'IB', componentRef: 'aahl.p2', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p2.trig.cosine', response: '5.79', expectedMarks: 1.5, maxMarks: 3 },
  { key: 'bm.ib.cosine.converted', framework: 'IB', componentRef: 'aahl.p2', cfg: IB_MATH_AA_HL_V2, itemKey: 'aahl.p2.trig.cosine', response: '57.9 mm', expectedMarks: 3, maxMarks: 3 },
  { key: 'bm.cie.fraction.unsimplified', framework: 'CAMBRIDGE', componentRef: 'cie.p2', cfg: CAMBRIDGE_0580_EXTENDED_V2, itemKey: 'cie.p2.str.probability', response: '{"a":"\\\\frac{12}{90}","b":"\\\\frac{13}{15}"}', expectedMarks: 3, maxMarks: 4 },
  { key: 'bm.cie.standard-form.not-standard', framework: 'CAMBRIDGE', componentRef: 'cie.p2', cfg: CAMBRIDGE_0580_EXTENDED_V2, itemKey: 'cie.p2.num.standard', response: '24000', expectedMarks: 1, maxMarks: 2 },
  { key: 'bm.cie.line.rearranged', framework: 'CAMBRIDGE', componentRef: 'cie.p2', cfg: CAMBRIDGE_0580_EXTENDED_V2, itemKey: 'cie.p2.geo.gradient', response: '2x+y=2', expectedMarks: 3, maxMarks: 3 },
  { key: 'bm.pisa.inequality', framework: 'PISA', componentRef: 'pisa.math', cfg: PISA_2022_V2, itemKey: 'pisa.camb.raz.taxi', response: 'k > 7,5', expectedMarks: 2, maxMarks: 2 },
  { key: 'bm.pisa.decimal-comma', framework: 'PISA', componentRef: 'pisa.math', cfg: PISA_2022_V2, itemKey: 'pisa.cant.empl.cambio', response: '212,76', expectedMarks: 1, maxMarks: 1 },
  { key: 'bm.paa.fraction.unsimplified', framework: 'PAA', componentRef: 'paa.matematicas', cfg: PAA_V2, itemKey: 'paa.m.fracciones.spr', response: '34/24', expectedMarks: 0.5, maxMarks: 1 },
  { key: 'bm.paa.spr.equivalent', framework: 'PAA', componentRef: 'paa.matematicas', cfg: PAA_V2, itemKey: 'paa.m.pitagoras.spr', response: '\\sqrt{144}', expectedMarks: 1, maxMarks: 1 },
];

export function benchmarkCases(): Array<CalibrationCase & { content: unknown }> {
  return BENCHMARK_CASES.map(({ cfg, ...c }) => {
    const content = itemFrom(cfg, c.itemKey);
    const parsed = ApprovedItemContentSchema.parse(content);
    return { ...c, origin: 'BENCHMARK_FIXTURE' as const, needsAI: !!(parsed.rubric || parsed.portfolio), content };
  });
}

export interface CaseResult {
  key: string;
  framework: string;
  origin: CalibrationOrigin;
  expected: number;
  awarded: number | null;
  max: number;
  absError: number | null;
  skipped?: 'NEEDS_AI';
}

export interface CalibrationMetrics {
  graderVersion: string;
  cases: number;
  graded: number;
  officialCases: number;
  exactAgreement: number | null;
  withinOneMark: number | null;
  meanAbsoluteError: number | null;
  byFramework: Record<string, { cases: number; exactAgreement: number | null; meanAbsoluteError: number | null }>;
  equivalenceClaimAllowed: boolean;
  equivalenceReason: string;
}

export const GRADER_VERSION = 'exam-core-grading-v2';

export function computeMetrics(results: CaseResult[]): CalibrationMetrics {
  const graded = results.filter((r) => r.awarded !== null);
  const agree = (rs: CaseResult[]) => (rs.length ? rs.filter((r) => Math.abs(r.absError!) < 1e-9).length / rs.length : null);
  const mae = (rs: CaseResult[]) => (rs.length ? rs.reduce((n, r) => n + r.absError!, 0) / rs.length : null);
  const official = graded.filter((r) => r.origin !== 'BENCHMARK_FIXTURE');
  const byFramework: CalibrationMetrics['byFramework'] = {};
  for (const fw of [...new Set(results.map((r) => r.framework))]) {
    const rs = graded.filter((r) => r.framework === fw);
    byFramework[fw] = { cases: rs.length, exactAgreement: agree(rs), meanAbsoluteError: mae(rs) };
  }
  const offExact = agree(official) ?? 0;
  const offWithin = official.length ? official.filter((r) => r.absError! <= 1).length / official.length : 0;
  const allowed = official.length >= 30 && offExact >= 0.8 && offWithin >= 0.95;
  return {
    graderVersion: GRADER_VERSION,
    cases: results.length,
    graded: graded.length,
    officialCases: official.length,
    exactAgreement: agree(graded),
    withinOneMark: graded.length ? graded.filter((r) => r.absError! <= 1).length / graded.length : null,
    meanAbsoluteError: mae(graded),
    byFramework,
    equivalenceClaimAllowed: allowed,
    equivalenceReason: official.length === 0 ? 'NO_OFFICIAL_EXEMPLARS: agreement is measured on StudyUs benchmark fixtures only.' : allowed ? 'THRESHOLDS_MET' : 'THRESHOLDS_NOT_MET',
  };
}

export async function gradeCases(cases: Array<CalibrationCase & { content: unknown }>, opts: { includeAI: boolean; runner?: AssessorRunner }): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const c of cases) {
    if (c.needsAI && !opts.includeAI) {
      out.push({ key: c.key, framework: c.framework, origin: c.origin, expected: c.expectedMarks, awarded: null, max: c.maxMarks, absError: null, skipped: 'NEEDS_AI' });
      continue;
    }
    const item = examItemFromApproved({ id: '00000000-0000-0000-0000-000000000000', learning_objective_id: '00000000-0000-0000-0000-000000000000', content: c.content }) as ExamItem;
    // The Student's language is the item's language (decimal comma etc.); never derived from the framework.
    const g = await gradeExamItem(item, c.response, (c.content as { language?: string }).language ?? 'en', { assessorRunner: opts.runner });
    const awarded = g.status === 'INVALID' ? 0 : Math.round(g.fraction * g.maxMarks * 1000) / 1000;
    out.push({ key: c.key, framework: c.framework, origin: c.origin, expected: c.expectedMarks, awarded, max: c.maxMarks, absError: Math.abs(awarded - c.expectedMarks) });
  }
  return out;
}

/** Persists the cases (upsert) and one run row. */
export async function recordCalibrationRun(cases: Array<CalibrationCase & { content: unknown }>, results: CaseResult[], metrics: CalibrationMetrics): Promise<string> {
  for (const c of cases) {
    await db.query(
      `INSERT INTO assessment_calibration_cases (case_key, framework, component_ref, origin, item_content, response, expected_marks, max_marks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (case_key) DO UPDATE SET item_content = EXCLUDED.item_content, response = EXCLUDED.response, expected_marks = EXCLUDED.expected_marks, max_marks = EXCLUDED.max_marks`,
      [c.key, c.framework, c.componentRef, c.origin, JSON.stringify(c.content), JSON.stringify({ text: c.response }), c.expectedMarks, c.maxMarks]
    );
  }
  const runKey = `${GRADER_VERSION}:${createHash('sha256').update(JSON.stringify(results)).digest('hex').slice(0, 16)}:${Date.now()}`;
  await db.query(`INSERT INTO assessment_calibration_runs (run_key, grader_version, case_count, metrics, case_results) VALUES ($1, $2, $3, $4, $5)`, [runKey, GRADER_VERSION, results.length, JSON.stringify(metrics), JSON.stringify(results)]);
  return runKey;
}
