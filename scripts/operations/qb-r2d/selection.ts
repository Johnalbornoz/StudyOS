/**
 * QB-R2D -- WHICH adaptations are generated live, and why each one (pure, deterministic, no IO).
 *
 * Twenty adaptation specifications across five canonical mathematical concepts and the EA-1 draft task families:
 *   - fourteen across PAA, IB (Paper 1 and Paper 2), Cambridge, PISA and Icfes, chosen so that each tests a
 *     constraint that materially changes the item (calculator, response format, marks, command term, stimulus,
 *     context, reasoning depth);
 *   - six of ONE family (the rate-comparison model) under the STANDARD and the STEM_PLUS learning approach, against a
 *     target where the approach can change the item (the illustrative school profile), one where it changes the
 *     context only (PISA) and one where official constraints win (PAA).
 * The first six are ONE family (the constant-rate linear model) on all five systems: the same-family proof.
 *
 * Every specification is produced by the adaptation engine exactly as the EA-1 / EA-1A proofs of concept produce
 * it: DEV_TEST_CONTENT, draft families, provisional profiles. Nothing is fabricated to make a target reachable.
 */
import { adapt } from '@/lib/assessment-adaptation/adapt';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { LEARNING_APPROACH_POC_REQUEST } from '@/lib/assessment-adaptation/learning-approach-poc';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { buildMathPocSpecifications } from '@/lib/assessment-adaptation/math-poc-matrix';
import { SCHOOL_STEM_PERFORMANCE_PROFILE } from '@/lib/assessment-adaptation/school-stem-performance';
import { EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES } from '@/lib/assessment-adaptation/system-profiles';
import { mathPocFamilyEa1aOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families-ea1a';
import { STANDARD_APPROACH, STEM_PLUS_APPROACH } from '@/lib/learning-approach/learning-approach-profile';

export type SelectionGroup = 'SAME_FAMILY_ALL_SYSTEMS' | 'CONSTRAINT_COVERAGE' | 'LEARNING_APPROACH';
export interface SelectedAdaptation {
  /** Stable key of the selection: `<nn>.<short name>`. The generation unit key is `<selectionKey>#a<attempt>`. */
  selectionKey: string;
  group: SelectionGroup;
  familyId: string;
  targetId: string;
  approach: 'STANDARD' | 'STEM_PLUS' | null;
  /** The constraint this adaptation is in the selection to test. */
  tests: string;
  specification: AdaptationSpecification;
}

const BASE: ReadonlyArray<[string, SelectionGroup, string, string, string]> = [
  ['01.linear-model.paa', 'SAME_FAMILY_ALL_SYSTEMS', 'tf.math.linear.constant-rate-model', 'PAA.MATEMATICAS', 'Selected response, no calculator, exact numbers, one mark, key only (Spanish).'],
  ['02.linear-model.ib-p1', 'SAME_FAMILY_ALL_SYSTEMS', 'tf.math.linear.constant-rate-model', 'IB.MATH_AA_HL.P1', 'Constructed response with method shown, NO calculator, command term fixed, multi-mark parts with a method-and-accuracy scheme.'],
  ['03.linear-model.ib-p2', 'SAME_FAMILY_ALL_SYSTEMS', 'tf.math.linear.constant-rate-model', 'IB.MATH_AA_HL.P2', 'Same system, other component: calculator REQUIRED and realistic values -- the calculator / non-calculator contrast inside one system.'],
  ['04.linear-model.cambridge-p1', 'SAME_FAMILY_ALL_SYSTEMS', 'tf.math.linear.constant-rate-model', 'CAMBRIDGE.9709.P1', 'Constructed response, scientific calculator, another command term; bound to a syllabus version.'],
  ['05.linear-model.pisa', 'SAME_FAMILY_ALL_SYSTEMS', 'tf.math.linear.constant-rate-model', 'PISA.MATHEMATICS', 'Selected response WITH a stimulus of its own (table / graph), authentic context required, transfer required, coded credit.'],
  ['06.linear-model.icfes', 'SAME_FAMILY_ALL_SYSTEMS', 'tf.math.linear.constant-rate-model', 'ICFES.SABER11_MATEMATICAS', 'Selected response, no calculator, plausible context preferred, the Icfes competency model.'],
  ['07.proportion-missing-value.paa', 'CONSTRAINT_COVERAGE', 'tf.math.proportion.missing-value', 'PAA.MATEMATICAS', 'Procedural and ABSTRACT: a SOLVE family with no situation at all.'],
  ['08.proportion-rate-comparison.pisa', 'CONSTRAINT_COVERAGE', 'tf.math.proportion.rate-comparison-model', 'PISA.MATHEMATICS', 'Modelling in context (FORMULATE + SOLVE + INTERPRET) as a selected response, calculator allowed, realistic values.'],
  ['09.quadratic-factorising.paa', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.solve-by-factorising', 'PAA.MATEMATICAS', 'NUMERIC ENTRY (student-produced number): the family excludes options because substitution would replace the method.'],
  ['10.quadratic-factorising.ib-p1', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.solve-by-factorising', 'IB.MATH_AA_HL.P1', 'The same procedural family as a constructed response with marks and the command term "solve", no calculator.'],
  ['11.quadratic-optimum.ib-p2', 'CONSTRAINT_COVERAGE', 'tf.math.quadratic.optimum-of-a-model', 'IB.MATH_AA_HL.P2', 'Modelling with an optimum, calculator required, multi-mark parts: formulate, solve, interpret.'],
  ['12.probability-single-event.icfes', 'CONSTRAINT_COVERAGE', 'tf.math.probability.single-event-equally-likely', 'ICFES.SABER11_MATEMATICAS', 'A COMPUTE family in a personal context, selected response, fraction answers.'],
  ['13.probability-compare.cambridge-p1', 'CONSTRAINT_COVERAGE', 'tf.math.probability.compare-chances-to-decide', 'CAMBRIDGE.9709.P1', 'FORMULATE + COMPUTE + EVALUATE as a constructed response: a verdict that a mark scheme must reward.'],
  ['14.data-judge-claim.paa', 'CONSTRAINT_COVERAGE', 'tf.math.data.judge-claim-against-display', 'PAA.MATEMATICAS', 'Stimulus REQUIRED by the family (table / graph), whole numbers without a calculator, a judgement keyed as an option.'],
  ['15.data-relative-change.ib-p2', 'CONSTRAINT_COVERAGE', 'tf.math.data.rate-of-change-from-realistic-dataset', 'IB.MATH_AA_HL.P2', 'A realistic data set as stimulus and a calculator-dependent computation with stated rounding; refused on the no-calculator paper.'],
];

const APPROACH_FAMILY = 'tf.math.proportion.rate-comparison-model';
const APPROACH: ReadonlyArray<[string, string, 'STANDARD' | 'STEM_PLUS', string]> = [
  ['16.approach.school.standard', 'SCHOOL_STEM_PERFORMANCE', 'STANDARD', 'Baseline for the approach comparison on a target with no official constraint.'],
  ['17.approach.school.stem-plus', 'SCHOOL_STEM_PERFORMANCE', 'STEM_PLUS', 'STEM_PLUS where it can act: constructed response, justified argument -- same concept, same invariants.'],
  ['18.approach.paa.standard', 'PAA.MATEMATICAS', 'STANDARD', 'Baseline on a target with OFFICIAL constraints.'],
  ['19.approach.paa.stem-plus', 'PAA.MATEMATICAS', 'STEM_PLUS', 'STEM_PLUS where official constraints win: format, calculator and reasoning preferences recorded as unmet; only the context moves.'],
  ['20.approach.pisa.stem-plus', 'PISA.MATHEMATICS', 'STEM_PLUS', 'STEM_PLUS on PISA: tools preference honoured, context moved; compared with the PISA item of the same family under no approach (08).'],
];

function approachSpecification(targetId: string, approach: 'STANDARD' | 'STEM_PLUS'): AdaptationSpecification {
  const family = mathPocFamilyEa1aOf(APPROACH_FAMILY);
  if (!family) throw new Error(`SELECTION_FAMILY_NOT_FOUND: ${APPROACH_FAMILY}`);
  const component = EA1_COMPONENT_PROFILES.find((c) => c.componentId === targetId);
  const profile = targetId === SCHOOL_STEM_PERFORMANCE_PROFILE.profileId ? SCHOOL_STEM_PERFORMANCE_PROFILE : EA1_SYSTEM_PROFILES.find((p) => p.profileId === component?.systemProfileId);
  if (!profile) throw new Error(`SELECTION_TARGET_NOT_FOUND: ${targetId}`);
  const r = adapt({ family, profile, component, applicability: MATH_POC_APPLICABILITY, learningApproach: approach === 'STEM_PLUS' ? STEM_PLUS_APPROACH : STANDARD_APPROACH, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: LEARNING_APPROACH_POC_REQUEST });
  if (!r.ok) throw new Error(`SELECTION_ADAPTATION_REFUSED: ${targetId} ${approach}: ${r.refusal.code} ${r.refusal.detail}`);
  return r.specification;
}

/** The twenty selected adaptations, in order. Deterministic: the same repository gives the same specification ids. */
export function buildSelection(): SelectedAdaptation[] {
  const { specifications } = buildMathPocSpecifications();
  const base = BASE.map(([selectionKey, group, familyId, targetId, tests]) => {
    const specification = specifications.get(`${familyId}|${targetId}`);
    if (!specification) throw new Error(`SELECTION_SPECIFICATION_NOT_PRODUCED: ${familyId}|${targetId}`);
    return { selectionKey, group, familyId, targetId, approach: null, tests, specification };
  });
  const approach = APPROACH.map(([selectionKey, targetId, a, tests]) => ({ selectionKey, group: 'LEARNING_APPROACH' as const, familyId: APPROACH_FAMILY, targetId, approach: a, tests, specification: approachSpecification(targetId, a) }));
  return [...base, ...approach];
}

export const unitKeyOf = (selectionKey: string, attempt: number): string => `${selectionKey}#a${attempt}`;
