/**
 * QB-R2F -- the twenty FRESH adaptations of the next pre-registered run (pure, deterministic, no IO). FROZEN.
 *
 * None of these specifications was generated from in QB-R2D or QB-R2E (QB-R2D's were made by engine 2; of QB-R2E's
 * engine-3 specifications none is repeated here -- a test checks both).
 *
 *   01-05  ONE family (the constant-rate linear model) on all five assessment systems             same-family proof
 *   06-11  ONE family (judging a claim against a display, EA-1A version) under no approach and under STEM_PLUS:
 *          the school profile (06 / 07), PAA (08 / 09), PISA (10 / 11)                              approach proof
 *   12-20  the other concepts and constraints: procedural, modelling, reasoning; selected, numeric and constructed;
 *          calculator and non-calculator papers; stimuli
 */
import { adapt } from '@/lib/assessment-adaptation/adapt';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { SCHOOL_STEM_PERFORMANCE_PROFILE } from '@/lib/assessment-adaptation/school-stem-performance';
import { EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES } from '@/lib/assessment-adaptation/system-profiles';
import { MATH_POC_FAMILIES } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { mathPocFamilyEa1aOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families-ea1a';
import { STANDARD_APPROACH, STEM_PLUS_APPROACH } from '@/lib/learning-approach/learning-approach-profile';

export type R2fGroup = 'SAME_FAMILY_ALL_SYSTEMS' | 'LEARNING_APPROACH' | 'CONSTRAINT_COVERAGE';
export interface R2fAdaptation { selectionKey: string; group: R2fGroup; familyId: string; targetId: string; approach: 'STANDARD' | 'STEM_PLUS' | null; tests: string; specification: AdaptationSpecification }

export const R2F_SAME_FAMILY = 'tf.math.linear.constant-rate-model' as const;
export const R2F_APPROACH_FAMILY = 'tf.math.data.judge-claim-against-display' as const;
const LANGUAGE: Record<string, string> = { PAA: 'es', IB: 'en', CAMBRIDGE: 'en', PISA: 'es', ICFES: 'es', SCHOOL_STEM_PERFORMANCE: 'es' };
type Row = [key: string, group: R2fGroup, familyId: string, targetId: string, approach: 'STANDARD' | 'STEM_PLUS' | null, tests: string];
const ROWS: readonly Row[] = [
  ['01.linear-model.paa', 'SAME_FAMILY_ALL_SYSTEMS', R2F_SAME_FAMILY, 'PAA.MATEMATICAS', null, 'FORMULATE + INTERPRET as a selected response without a calculator: a real question, parallel options.'],
  ['02.linear-model.ib-p1', 'SAME_FAMILY_ALL_SYSTEMS', R2F_SAME_FAMILY, 'IB.MATH_AA_HL.P1', null, 'Constructed response, no calculator: one mark per mark point, a command term per part.'],
  ['03.linear-model.cambridge-p1', 'SAME_FAMILY_ALL_SYSTEMS', R2F_SAME_FAMILY, 'CAMBRIDGE.9709.P1', null, 'Constructed response under another vocabulary and a scientific calculator.'],
  ['04.linear-model.pisa', 'SAME_FAMILY_ALL_SYSTEMS', R2F_SAME_FAMILY, 'PISA.MATHEMATICS', null, 'A stimulus of its own that must NOT state the model: the rate and the start are read from the data.'],
  ['05.linear-model.icfes', 'SAME_FAMILY_ALL_SYSTEMS', R2F_SAME_FAMILY, 'ICFES.SABER11_MATEMATICAS', null, 'Selected response without a calculator under the Icfes competency model.'],
  ['06.approach.school.standard', 'LEARNING_APPROACH', R2F_APPROACH_FAMILY, 'SCHOOL_STEM_PERFORMANCE', 'STANDARD', 'Baseline on a target with no official constraint; a stimulus and a justified judgement.'],
  ['07.approach.school.stem-plus', 'LEARNING_APPROACH', R2F_APPROACH_FAMILY, 'SCHOOL_STEM_PERFORMANCE', 'STEM_PLUS', 'STEM_PLUS where it can act; must NOT be the baseline item retold (scenario and numbers differ).'],
  ['08.approach.paa.baseline', 'LEARNING_APPROACH', R2F_APPROACH_FAMILY, 'PAA.MATEMATICAS', null, 'Baseline on a target with OFFICIAL constraints: a judgement keyed as an option, whole numbers.'],
  ['09.approach.paa.stem-plus', 'LEARNING_APPROACH', R2F_APPROACH_FAMILY, 'PAA.MATEMATICAS', 'STEM_PLUS', 'STEM_PLUS where official constraints win: preferences recorded as unmet.'],
  ['10.approach.pisa.baseline', 'LEARNING_APPROACH', R2F_APPROACH_FAMILY, 'PISA.MATHEMATICS', null, 'Baseline on PISA: authentic context, coded credit, a display.'],
  ['11.approach.pisa.stem-plus', 'LEARNING_APPROACH', R2F_APPROACH_FAMILY, 'PISA.MATHEMATICS', 'STEM_PLUS', 'STEM_PLUS on PISA.'],
  ['12.proportion-missing-value.icfes', 'CONSTRAINT_COVERAGE', 'tf.math.proportion.missing-value', 'ICFES.SABER11_MATEMATICAS', null, 'A SOLVE family as a selected response with numeric options: the corrected same-number rule on real numbers.'],
  ['13.rate-comparison.ib-p2', 'CONSTRAINT_COVERAGE', 'tf.math.proportion.rate-comparison-model', 'IB.MATH_AA_HL.P2', null, 'Modelling on the calculator paper: two quantities are two parts, never one part with two answers.'],
  ['14.line-two-points.cambridge-p1', 'CONSTRAINT_COVERAGE', 'tf.math.linear.line-through-two-points', 'CAMBRIDGE.9709.P1', null, 'COMPUTE + REPRESENT as a constructed response: slope, intercept, equation.'],
  ['15.quadratic-factorising.ib-p1', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.solve-by-factorising', 'IB.MATH_AA_HL.P1', null, 'A SOLVE family judged against the equation the item STATES, whatever side its terms are on.'],
  ['16.quadratic-optimum.cambridge-p1', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.optimum-of-a-model', 'CAMBRIDGE.9709.P1', null, 'Modelling with an optimum: the factors come from the situation in words, never written out.'],
  ['17.quadratic-optimum.paa', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.optimum-of-a-model', 'PAA.MATEMATICAS', null, 'NUMERIC ENTRY: the template that had the fixed-instruction trap.'],
  ['18.probability-single-event.paa', 'CONSTRAINT_COVERAGE', 'tf.math.probability.single-event-equally-likely', 'PAA.MATEMATICAS', null, 'A COMPUTE family, selected response, fraction options that must be distinct in value.'],
  ['19.probability-compare.pisa', 'CONSTRAINT_COVERAGE', 'tf.math.probability.compare-chances-to-decide', 'PISA.MATHEMATICS', null, 'Reasoning to a decision in an authentic context; options that share a label numeral.'],
  ['20.data-relative-change.pisa', 'CONSTRAINT_COVERAGE', 'tf.math.data.rate-of-change-from-realistic-dataset', 'PISA.MATHEMATICS', null, 'A realistic data set as stimulus, selected response, calculator allowed, stated rounding.'],
];
const EA1A = new Set<string>([R2F_APPROACH_FAMILY]);
/** A request field that differs from the default, by selection key. 04: an OCCUPATIONAL context, so that the specification is not the one QB-R2E generated from for the same family and target. */
const REQUEST_OVERRIDES: Readonly<Record<string, Record<string, string>>> = { '04.linear-model.pisa': { context: 'OCCUPATIONAL' } };
function specify([key, , familyId, targetId, approach]: Row): AdaptationSpecification {
  const family = EA1A.has(familyId) ? mathPocFamilyEa1aOf(familyId) : MATH_POC_FAMILIES.find((f) => f.familyId === familyId) ?? null;
  if (!family) throw new Error(`R2F_SELECTION_FAMILY_NOT_FOUND: ${familyId}`);
  const component = EA1_COMPONENT_PROFILES.find((c) => c.componentId === targetId);
  const profile = targetId === SCHOOL_STEM_PERFORMANCE_PROFILE.profileId ? SCHOOL_STEM_PERFORMANCE_PROFILE : EA1_SYSTEM_PROFILES.find((p) => p.profileId === component?.systemProfileId);
  if (!profile) throw new Error(`R2F_SELECTION_TARGET_NOT_FOUND: ${targetId}`);
  const r = adapt({ family, profile, component, applicability: MATH_POC_APPLICABILITY, ...(approach ? { learningApproach: approach === 'STEM_PLUS' ? STEM_PLUS_APPROACH : STANDARD_APPROACH } : {}), disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', contentUseClass: 'DEV_TEST_CONTENT', language: LANGUAGE[profile.profileId] ?? 'en', ...(REQUEST_OVERRIDES[key] ?? {}) } });
  if (!r.ok) throw new Error(`R2F_SELECTION_ADAPTATION_REFUSED: ${key}: ${r.refusal.code} ${r.refusal.detail}`);
  return r.specification;
}
export function buildR2fSelection(): R2fAdaptation[] {
  return ROWS.map((row) => ({ selectionKey: row[0], group: row[1], familyId: row[2], targetId: row[3], approach: row[4], tests: row[5], specification: specify(row) }));
}
/** The pairs of the approach proof: [baseline, STEM_PLUS, what the pair shows]. */
export const R2F_APPROACH_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['06.approach.school.standard', '07.approach.school.stem-plus', 'A target with no official constraint: the approach moves the response format.'],
  ['08.approach.paa.baseline', '09.approach.paa.stem-plus', 'A target with OFFICIAL constraints: they win, and the unmet preferences are recorded.'],
  ['10.approach.pisa.baseline', '11.approach.pisa.stem-plus', 'PISA: what the approach may move, and what the official rule keeps.'],
];
export const r2fUnitKey = (selectionKey: string, attempt: 1 | 2): string => `${selectionKey}#a${attempt}`;
