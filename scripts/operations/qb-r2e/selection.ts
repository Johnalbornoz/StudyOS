/**
 * QB-R2E -- the twenty NEW adaptations of the pre-registered run (pure, deterministic, no IO).
 *
 * Produced by adaptation engine 3: every specification states its marks and, where the profile has a vocabulary,
 * its command terms per action. None of these specification ids existed in QB-R2D.
 *
 *   01-05  ONE family (the rate-comparison model, EA-1A version) on all five assessment systems     same-family proof
 *   06-09  the same family under STANDARD and STEM_PLUS: the school profile (06 / 07), PAA (01 / 08), PISA (04 / 09)
 *   10-20  the other four concepts: procedural, modelling, reasoning; selected, numeric and constructed;
 *          calculator and non-calculator papers; table / data stimuli
 *
 * FROZEN with the validators: this file is in the freeze manifest. The selection cannot be changed after results.
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

export type R2eGroup = 'SAME_FAMILY_ALL_SYSTEMS' | 'LEARNING_APPROACH' | 'CONSTRAINT_COVERAGE';
export interface R2eAdaptation { selectionKey: string; group: R2eGroup; familyId: string; targetId: string; approach: 'STANDARD' | 'STEM_PLUS' | null; tests: string; specification: AdaptationSpecification }

export const R2E_PROOF_FAMILY = 'tf.math.proportion.rate-comparison-model' as const;
const LANGUAGE: Record<string, string> = { PAA: 'es', IB: 'en', CAMBRIDGE: 'en', PISA: 'es', ICFES: 'es', SCHOOL_STEM_PERFORMANCE: 'es' };
type Row = [key: string, group: R2eGroup, familyId: string, targetId: string, approach: 'STANDARD' | 'STEM_PLUS' | null, tests: string];
const ROWS: readonly Row[] = [
  ['01.rate-comparison.paa', 'SAME_FAMILY_ALL_SYSTEMS', R2E_PROOF_FAMILY, 'PAA.MATEMATICAS', null, 'Modelling as a selected response without a calculator; baseline of the PAA approach pair.'],
  ['02.rate-comparison.ib-p1', 'SAME_FAMILY_ALL_SYSTEMS', R2E_PROOF_FAMILY, 'IB.MATH_AA_HL.P1', null, 'The same family as a constructed response with marked parts and one command term per part, no calculator.'],
  ['03.rate-comparison.cambridge-p1', 'SAME_FAMILY_ALL_SYSTEMS', R2E_PROOF_FAMILY, 'CAMBRIDGE.9709.P1', null, 'Constructed response under another vocabulary and a scientific calculator; syllabus-version binding.'],
  ['04.rate-comparison.pisa', 'SAME_FAMILY_ALL_SYSTEMS', R2E_PROOF_FAMILY, 'PISA.MATHEMATICS', null, 'Authentic context required, coded credit, calculator allowed; baseline of the PISA approach pair.'],
  ['05.rate-comparison.icfes', 'SAME_FAMILY_ALL_SYSTEMS', R2E_PROOF_FAMILY, 'ICFES.SABER11_MATEMATICAS', null, 'Selected response without a calculator under the Icfes competency model.'],
  ['06.approach.school.standard', 'LEARNING_APPROACH', R2E_PROOF_FAMILY, 'SCHOOL_STEM_PERFORMANCE', 'STANDARD', 'The repaired school specification: marked parts now come with a constructed response (SHORT), not with options.'],
  ['07.approach.school.stem-plus', 'LEARNING_APPROACH', R2E_PROOF_FAMILY, 'SCHOOL_STEM_PERFORMANCE', 'STEM_PLUS', 'STEM_PLUS where no official rule constrains it: the approach moves the response format (EXTENDED).'],
  ['08.approach.paa.stem-plus', 'LEARNING_APPROACH', R2E_PROOF_FAMILY, 'PAA.MATEMATICAS', 'STEM_PLUS', 'STEM_PLUS where OFFICIAL constraints win: preferences recorded as unmet; only the context moves. Paired with 01.'],
  ['09.approach.pisa.stem-plus', 'LEARNING_APPROACH', R2E_PROOF_FAMILY, 'PISA.MATHEMATICS', 'STEM_PLUS', 'STEM_PLUS on PISA: tools honoured, format overridden by an official rule. Paired with 04.'],
  ['10.line-two-points.paa', 'CONSTRAINT_COVERAGE', 'tf.math.linear.line-through-two-points', 'PAA.MATEMATICAS', null, 'Procedural and ABSTRACT (COMPUTE + REPRESENT), selected response with numeric options.'],
  ['11.linear-model.ib-p2', 'CONSTRAINT_COVERAGE', 'tf.math.linear.constant-rate-model', 'IB.MATH_AA_HL.P2', null, 'FORMULATE + INTERPRET on the calculator paper: parts that need different command terms.'],
  ['12.linear-model.pisa', 'CONSTRAINT_COVERAGE', 'tf.math.linear.constant-rate-model', 'PISA.MATHEMATICS', null, 'A stimulus of its own (table / graph) the rate has to be read from; coded credit.'],
  ['13.quadratic-factorising.cambridge-p1', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.solve-by-factorising', 'CAMBRIDGE.9709.P1', null, 'A SOLVE family as a constructed response: nothing may be handed over (no factorised form, no root).'],
  ['14.quadratic-factorising.paa', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.solve-by-factorising', 'PAA.MATEMATICAS', null, 'NUMERIC ENTRY without a calculator: a keyed root recomputed from the stem\'s own equation.'],
  ['15.quadratic-optimum.ib-p1', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.optimum-of-a-model', 'IB.MATH_AA_HL.P1', null, 'Modelling with an optimum WITHOUT a calculator: the factors must come from the situation, in words.'],
  ['16.quadratic-optimum.pisa', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.optimum-of-a-model', 'PISA.MATHEMATICS', null, 'The same modelling family as a numeric entry in an authentic context.'],
  ['17.probability-single-event.ib-p1', 'CONSTRAINT_COVERAGE', 'tf.math.probability.single-event-equally-likely', 'IB.MATH_AA_HL.P1', null, 'A COMPUTE family as a short constructed response with an exact (fraction) answer.'],
  ['18.probability-compare.icfes', 'CONSTRAINT_COVERAGE', 'tf.math.probability.compare-chances-to-decide', 'ICFES.SABER11_MATEMATICAS', null, 'Reasoning to a decision (FORMULATE + COMPUTE + EVALUATE) as a selected response with parallel options.'],
  ['19.data-judge-claim.icfes', 'CONSTRAINT_COVERAGE', 'tf.math.data.judge-claim-against-display', 'ICFES.SABER11_MATEMATICAS', null, 'A stimulus the family requires; a judgement about a claim, whole numbers, no calculator.'],
  ['20.data-relative-change.cambridge-p1', 'CONSTRAINT_COVERAGE', 'tf.math.data.rate-of-change-from-realistic-dataset', 'CAMBRIDGE.9709.P1', null, 'A realistic data set as stimulus and a calculator-dependent result with stated rounding.'],
];

function specify([key, , familyId, targetId, approach]: Row): AdaptationSpecification {
  const family = familyId === R2E_PROOF_FAMILY ? mathPocFamilyEa1aOf(familyId) : MATH_POC_FAMILIES.find((f) => f.familyId === familyId) ?? null;
  if (!family) throw new Error(`R2E_SELECTION_FAMILY_NOT_FOUND: ${familyId}`);
  const component = EA1_COMPONENT_PROFILES.find((c) => c.componentId === targetId);
  const profile = targetId === SCHOOL_STEM_PERFORMANCE_PROFILE.profileId ? SCHOOL_STEM_PERFORMANCE_PROFILE : EA1_SYSTEM_PROFILES.find((p) => p.profileId === component?.systemProfileId);
  if (!profile) throw new Error(`R2E_SELECTION_TARGET_NOT_FOUND: ${targetId}`);
  const r = adapt({ family, profile, component, applicability: MATH_POC_APPLICABILITY, ...(approach ? { learningApproach: approach === 'STEM_PLUS' ? STEM_PLUS_APPROACH : STANDARD_APPROACH } : {}), disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', contentUseClass: 'DEV_TEST_CONTENT', language: LANGUAGE[profile.profileId] ?? 'en' } });
  if (!r.ok) throw new Error(`R2E_SELECTION_ADAPTATION_REFUSED: ${key}: ${r.refusal.code} ${r.refusal.detail}`);
  return r.specification;
}

export function buildR2eSelection(): R2eAdaptation[] {
  return ROWS.map((row) => ({ selectionKey: row[0], group: row[1], familyId: row[2], targetId: row[3], approach: row[4], tests: row[5], specification: specify(row) }));
}
/** The pairs of the approach proof: [baseline, STEM_PLUS, what the pair shows]. */
export const R2E_APPROACH_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['06.approach.school.standard', '07.approach.school.stem-plus', 'A target with no official constraint: the approach moves the response format.'],
  ['01.rate-comparison.paa', '08.approach.paa.stem-plus', 'A target with OFFICIAL constraints: they win, and the unmet preferences are recorded.'],
  ['04.rate-comparison.pisa', '09.approach.pisa.stem-plus', 'PISA: the context and the tools move; the format is the official rule\'s.'],
];
export const r2eUnitKey = (selectionKey: string, attempt: 1 | 2): string => `${selectionKey}#a${attempt}`;
