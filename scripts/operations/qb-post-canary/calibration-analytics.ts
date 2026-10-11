/**
 * POST-CANARY -- HUMAN CALIBRATION ANALYTICS (pure). Code now; it runs when human labels exist.
 *
 * Three judges are compared with the SETTLED human label, dimension by dimension: validators revision 4,
 * validators revision 5, and the frozen AI reviewer. For every comparison: a confusion table, precision, recall,
 * false-positive rate, false-negative rate and agreement rate -- each rate WITH ITS COUNTS and a 95% Wilson
 * interval, because 37 items is a small sample -- and every disagreement listed item by item.
 *
 * WHICH LABEL COUNTS. Only an item with a SETTLED human label enters a metric (see `humanLabelOf`). Items awaiting
 * a second review, and items two people decided differently, are reported by name and are in no rate.
 * A human AMBIGUOUS or NOT_ASSESSABLE on a dimension takes the item out of that dimension, by name.
 *
 * "POSITIVE" MEANS "DEFECT". A judge is right to flag (true positive) when the person found the defect.
 * NO LABEL IS EVER INVENTED: with no settled label there is nothing to compute, and `analyse` says so.
 */
import type { HumanLabel, HumanResponse } from './human-review';

export const ANALYTICS = { id: 'studyus-human-calibration-analytics', version: '1' } as const;
export const DIMENSIONS = ['CORRECTNESS', 'ANSWER_KEY', 'CONSTRUCT', 'DIFFICULTY', 'ASSESSMENT_SYSTEM_FIDELITY', 'OVERALL_DECISION'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Judge = 'VALIDATOR_V4' | 'VALIDATOR_V5' | 'AI_REVIEWER';
/** What a judge said on a dimension: it flagged a defect, it did not, or it has nothing to say there. */
export type Call = 'DEFECT' | 'NO_DEFECT' | 'NO_OPINION';
export interface AnalyticsRow { itemId: string; blind: boolean; human: HumanLabel; calls: Record<Judge, Record<Dimension, Call>> }

export const JUDGE_DEFINITIONS: Readonly<Record<Judge, Readonly<Record<Dimension, string>>>> = {
  VALIDATOR_V4: { CORRECTNESS: 'answer key FAILED or machine recomputation FAIL', ANSWER_KEY: 'answer key FAILED', CONSTRUCT: 'construct preservation FAIL', DIFFICULTY: 'NO_OPINION: revision 4 has no difficulty check', ASSESSMENT_SYSTEM_FIDELITY: 'profile compliance FAIL', OVERALL_DECISION: 'any gate failure' },
  VALIDATOR_V5: { CORRECTNESS: 'answer key KEY_CONTRADICTED', ANSWER_KEY: 'answer key KEY_CONTRADICTED', CONSTRUCT: 'construct preservation FAIL', DIFFICULTY: 'demand check BELOW_DEMAND; NO_OPINION when UNVERIFIED', ASSESSMENT_SYSTEM_FIDELITY: 'profile compliance FAIL (hard channel)', OVERALL_DECISION: 'any hard gate failure' },
  AI_REVIEWER: { CORRECTNESS: 'ACADEMIC_CORRECTNESS = FAIL or own solution DISAGREES', ANSWER_KEY: 'own solution DISAGREES with the key', CONSTRUCT: 'CONSTRUCT_VALIDITY = FAIL', DIFFICULTY: 'DIFFICULTY = FAIL or CONCERN', ASSESSMENT_SYSTEM_FIDELITY: 'PROFILE_FIDELITY = FAIL', OVERALL_DECISION: 'classification REJECTED; APPROVED is NO_DEFECT; NEEDS_HUMAN_REVIEW is NO_OPINION (the AI deferred)' },
};
/** What the person found on a dimension: a defect, none, or not usable for this dimension. */
export function humanFinding(r: HumanResponse, d: Dimension): 'DEFECT' | 'NO_DEFECT' | 'EXCLUDED' {
  const three = (v: string, bad: string[], good: string[]) => (bad.includes(v) ? 'DEFECT' : good.includes(v) ? 'NO_DEFECT' : 'EXCLUDED');
  switch (d) {
    case 'CORRECTNESS': return three(r.academic_correctness, ['INCORRECT'], ['CORRECT']);
    case 'ANSWER_KEY': return three(r.answer_key_correctness, ['INCORRECT'], ['CORRECT']);
    case 'CONSTRUCT': return three(r.construct_fit, ['DOES_NOT_FIT'], ['FITS', 'PARTIALLY_FITS']);
    case 'DIFFICULTY': return three(r.difficulty_achieved, ['EASIER_THAN_STATED_BAND', 'HARDER_THAN_STATED_BAND'], ['MATCHES_STATED_BAND']);
    case 'ASSESSMENT_SYSTEM_FIDELITY': return three(r.assessment_system_fidelity, ['NOT_FAITHFUL'], ['FAITHFUL', 'PARTIALLY_FAITHFUL']);
    default: return r.final_human_decision === 'APPROVED' ? 'NO_DEFECT' : 'DEFECT';
  }
}
export interface Rate { value: number | null; numerator: number; denominator: number; wilson95: [number, number] | null }
export function rate(numerator: number, denominator: number): Rate {
  if (denominator === 0) return { value: null, numerator, denominator, wilson95: null };
  const p = numerator / denominator, z = 1.959964, n = denominator;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n), half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return { value: p, numerator, denominator, wilson95: [Math.max(0, centre - half), Math.min(1, centre + half)] };
}
export interface Comparison { judge: Judge; dimension: Dimension; subset: 'ALL' | 'BLIND' | 'NOT_BLIND'; n: number; confusion: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number }; precision: Rate; recall: Rate; falsePositiveRate: Rate; falseNegativeRate: Rate; agreementRate: Rate; disagreements: Array<{ itemId: string; judge: Call; human: string }>; excluded: Array<{ itemId: string; why: string }> }
function compare(rows: readonly AnalyticsRow[], judge: Judge, dimension: Dimension, subset: Comparison['subset']): Comparison {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const disagreements: Comparison['disagreements'] = [], excluded: Comparison['excluded'] = [];
  for (const r of rows) {
    if (subset !== 'ALL' && r.blind !== (subset === 'BLIND')) continue;
    if (r.human.state !== 'SETTLED') { excluded.push({ itemId: r.itemId, why: `HUMAN_LABEL_${r.human.state}` }); continue; }
    const h = humanFinding(r.human.label, dimension), j = r.calls[judge][dimension];
    if (h === 'EXCLUDED') { excluded.push({ itemId: r.itemId, why: 'HUMAN_AMBIGUOUS_OR_NOT_ASSESSABLE_ON_THIS_DIMENSION' }); continue; }
    if (j === 'NO_OPINION') { excluded.push({ itemId: r.itemId, why: 'JUDGE_HAS_NO_OPINION_ON_THIS_DIMENSION' }); continue; }
    if (j === 'DEFECT' && h === 'DEFECT') tp += 1; else if (j === 'DEFECT') { fp += 1; disagreements.push({ itemId: r.itemId, judge: j, human: h }); } else if (h === 'DEFECT') { fn += 1; disagreements.push({ itemId: r.itemId, judge: j, human: h }); } else tn += 1;
  }
  const n = tp + fp + tn + fn;
  return { judge, dimension, subset, n, confusion: { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn }, precision: rate(tp, tp + fp), recall: rate(tp, tp + fn), falsePositiveRate: rate(fp, fp + tn), falseNegativeRate: rate(fn, fn + tp), agreementRate: rate(tp + tn, n), disagreements, excluded };
}
export class NoHumanLabelsError extends Error { constructor() { super('NO_SETTLED_HUMAN_LABEL: there is nothing to analyse. No label is invented or simulated.'); this.name = 'NoHumanLabelsError'; } }
export interface Analysis { analytics: typeof ANALYTICS; smallSampleCaveat: string; items: { total: number; settled: number; awaitingSecondReview: string[]; unsettled: string[]; notReviewed: string[] }; comparisons: Comparison[] }
export function analyse(rows: readonly AnalyticsRow[]): Analysis {
  const settled = rows.filter((r) => r.human.state === 'SETTLED');
  if (settled.length === 0) throw new NoHumanLabelsError();
  const comparisons: Comparison[] = [];
  for (const judge of ['VALIDATOR_V4', 'VALIDATOR_V5', 'AI_REVIEWER'] as const) for (const dimension of DIMENSIONS) for (const subset of ['ALL', 'BLIND', 'NOT_BLIND'] as const) comparisons.push(compare(rows, judge, dimension, subset));
  return {
    analytics: ANALYTICS,
    smallSampleCaveat: `${settled.length} settled items. Every rate is shown with its counts and a 95% Wilson interval; with this few items the intervals are wide and a rate alone means little. The sample was chosen for uncertainty, not at random: these rates do not estimate the rates of the whole batch.`,
    items: { total: rows.length, settled: settled.length, awaitingSecondReview: rows.filter((r) => r.human.state === 'AWAITING_SECOND_REVIEW').map((r) => r.itemId), unsettled: rows.filter((r) => r.human.state === 'UNSETTLED').map((r) => r.itemId), notReviewed: rows.filter((r) => r.human.state === 'NO_REVIEW').map((r) => r.itemId) },
    comparisons,
  };
}
