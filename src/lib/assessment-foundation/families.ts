/**
 * B1 -- the three assessment (blueprint) families. One shared contract set, three policies:
 *
 *   LEARNING           optimises learning / evidence needs (the Learner State and the canonical engine decide).
 *   EXAM_PREPARATION   may adapt emphasis to learner gaps, exam relevance, the preparation goal and time.
 *   OFFICIAL_EXAM      must preserve verified official fidelity; never adapts to the learner.
 *
 * Question count is owned by none of the question stores: it results from the family's policy
 * (evidence requirements, or gaps + relevance + time, or the official blueprint's slots).
 */
export const ASSESSMENT_FAMILIES = ['LEARNING', 'EXAM_PREPARATION', 'OFFICIAL_EXAM'] as const;
export type AssessmentFamily = (typeof ASSESSMENT_FAMILIES)[number];

/** Who owns the number of questions of an assessment of this family. */
export const COUNT_AUTHORITY: Record<AssessmentFamily, 'EVIDENCE_REQUIREMENTS' | 'PREPARATION_POLICY' | 'OFFICIAL_BLUEPRINT'> = {
  LEARNING: 'EVIDENCE_REQUIREMENTS',
  EXAM_PREPARATION: 'PREPARATION_POLICY',
  OFFICIAL_EXAM: 'OFFICIAL_BLUEPRINT',
};

/** May the structure / emphasis of an assessment of this family follow the learner's weaknesses? */
export const ADAPTS_TO_LEARNER: Record<AssessmentFamily, boolean> = { LEARNING: true, EXAM_PREPARATION: true, OFFICIAL_EXAM: false };

/**
 * What an assessment is, semantically, for the system and the Student:
 *   OFFICIAL_MOCK            a VERIFIED COMPLETE official-format mock: frozen form of FULL fidelity (exam_instances).
 *   REDUCED_MOCK             a frozen mock following the official model, smaller than the complete official form.
 *   EXAM_CHALLENGE           a frozen exam-instance assessment deliberately harder than the official exam.
 *   EXAM_PRACTICE            blueprint-shaped practice through an exam instance (not a full official form).
 *   PREPARATION_SIMULATION   the legacy simulation path: learner-adaptive, may source lazily. Never an official mock.
 *   LEARNING_ACTIVITY        a Learning Engine activity (practice, prove, retain, transfer ...).
 */
export const ASSESSMENT_PATHS = ['OFFICIAL_MOCK', 'REDUCED_MOCK', 'EXAM_CHALLENGE', 'EXAM_PRACTICE', 'PREPARATION_SIMULATION', 'LEARNING_ACTIVITY'] as const;
export type AssessmentPath = (typeof ASSESSMENT_PATHS)[number];

export const FAMILY_OF_PATH: Record<AssessmentPath, AssessmentFamily> = {
  OFFICIAL_MOCK: 'OFFICIAL_EXAM',
  // A reduced mock follows the official model without adapting to the learner; it is simply not the complete form.
  REDUCED_MOCK: 'OFFICIAL_EXAM',
  // A challenge is a preparation instrument: frozen and officially timed, deliberately above official difficulty.
  EXAM_CHALLENGE: 'EXAM_PREPARATION',
  EXAM_PRACTICE: 'EXAM_PREPARATION',
  PREPARATION_SIMULATION: 'EXAM_PREPARATION',
  LEARNING_ACTIVITY: 'LEARNING',
};
