/**
 * EA-1A -- three of the mathematics proof-of-concept families at a NEW VERSION that declares what a learning
 * approach can ask of them (pure data, no IO).
 *
 * The EA-1 families are not edited: their version, their content and every specification made from them stay as
 * they are. These are later versions of THE SAME families -- same family id, same PRIMARY concept, same construct,
 * same evidence target, hence the same invariant hash -- that add two things and nothing else:
 *   approachSupport   the transversal competencies the task can evidence, by catalogue code, and the participation
 *                     modes it can be run in;
 *   profileSupport    a declaration for one more assessment system, the school's own STEM performance assessment.
 * They hold no approach id and no curriculum: a family knows neither.
 *
 * Still DRAFT / UNREVIEWED, drafted in-session by the model. The competency codes are the ones the STEM+ approach
 * references; five of the six are PROPOSED codes that the competency catalogue does not hold yet.
 *
 * Mathematics remains the proof discipline. No science family is written: SCIENCE_PROBLEM and
 * SCIENTIFIC_INVESTIGATION stay declared types with no schema and no discipline policy.
 */
import { mathPocFamilyOf } from './math-poc-families';
import type { MathTaskFamily } from './math-problem';
import type { ParticipationMode } from './task-family';

export const MATH_POC_FAMILY_VERSION_EA1A = '0.2.0-draft' as const;
export const SCHOOL_STEM_PERFORMANCE_PROFILE_ID = 'SCHOOL_STEM_PERFORMANCE' as const;
/** Catalogue codes of the transversal competencies, as the STEM+ approach references them. A test keeps the two equal. */
export const TRANSVERSAL = {
  SCIENTIFIC_INQUIRY: 'dev.comp.scientific-inquiry',
  MATHEMATICAL_MODELLING: 'studyus.transversal.mathematical-modelling',
  DATA_AND_COMPUTATIONAL_REASONING: 'studyus.transversal.data-computational-reasoning',
  PROBLEM_SOLVING_AND_TRANSFER: 'studyus.transversal.problem-solving-transfer',
  SCIENTIFIC_COMMUNICATION_AND_ARGUMENTATION: 'studyus.transversal.scientific-communication-argumentation',
} as const;

const next = (familyId: string, transversalCompetencies: string[], participationModes: ParticipationMode[]): MathTaskFamily => {
  const base = mathPocFamilyOf(familyId);
  if (!base) throw new Error(`EA1A_FAMILY_NOT_IN_THE_EA1_PROOF_OF_CONCEPT: ${familyId}`);
  return { ...base, version: MATH_POC_FAMILY_VERSION_EA1A, profileSupport: { ...base.profileSupport, [SCHOOL_STEM_PERFORMANCE_PROFILE_ID]: { status: 'SUPPORTED' } }, approachSupport: { transversalCompetencies, participationModes } };
};

export const MATH_POC_FAMILIES_EA1A: readonly MathTaskFamily[] = [
  // a modelling task: two options compared through a rate the learner must choose -- can be worked by a group
  next('tf.math.proportion.rate-comparison-model', [TRANSVERSAL.MATHEMATICAL_MODELLING, TRANSVERSAL.PROBLEM_SOLVING_AND_TRANSFER], ['INDIVIDUAL', 'COLLABORATIVE']),
  // a judgement about what a data display supports -- data reasoning and argumentation; individual
  next('tf.math.data.judge-claim-against-display', [TRANSVERSAL.DATA_AND_COMPUTATIONAL_REASONING, TRANSVERSAL.SCIENTIFIC_COMMUNICATION_AND_ARGUMENTATION], ['INDIVIDUAL']),
  // a purely procedural task with no situation: it evidences no transversal competency, and says so
  next('tf.math.quadratic.solve-by-factorising', [], ['INDIVIDUAL']),
];
export const mathPocFamilyEa1aOf = (familyId: string): MathTaskFamily | null => MATH_POC_FAMILIES_EA1A.find((f) => f.familyId === familyId) ?? null;
