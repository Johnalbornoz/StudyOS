/**
 * IB (International Baccalaureate) alignment helpers.
 *
 * These are built on the IB's publicly documented structural
 * conventions (command-term taxonomy by cognitive/assessment-objective
 * level, the shape of the DP 1-7 and MYP criteria scales) -- NOT a
 * reproduction of any specific official subject guide's exact glossary
 * or grade-boundary table, which are restricted documents that differ
 * per subject and are only finalized after each exam session. Anything
 * derived here (grade estimates, command terms) is a practice aid and
 * must be presented as an approximation, never as an official result.
 */

export type IBProgramme = 'none' | 'MYP' | 'DP';
export type IBLevel = 'SL' | 'HL';

export const IB_SUBJECT_GROUPS: { value: string; label: string }[] = [
  { value: 'language_literature', label: 'Language & Literature' },
  { value: 'language_acquisition', label: 'Language Acquisition' },
  { value: 'individuals_societies', label: 'Individuals & Societies' },
  { value: 'sciences', label: 'Sciences' },
  { value: 'mathematics', label: 'Mathematics' },
  { value: 'arts', label: 'Arts' },
  { value: 'design', label: 'Design' },
  { value: 'physical_health_education', label: 'Physical & Health Education' },
];

/** MYP criteria per subject group -- the four labels vary by group. */
export const MYP_CRITERIA: Record<string, { code: string; label: string }[]> = {
  sciences: [
    { code: 'A', label: 'Knowledge and understanding' },
    { code: 'B', label: 'Inquiring and designing' },
    { code: 'C', label: 'Processing and evaluating' },
    { code: 'D', label: 'Reflecting on the impacts of science' },
  ],
  mathematics: [
    { code: 'A', label: 'Knowing and understanding' },
    { code: 'B', label: 'Investigating patterns' },
    { code: 'C', label: 'Communicating' },
    { code: 'D', label: 'Applying mathematics in real-life contexts' },
  ],
  individuals_societies: [
    { code: 'A', label: 'Knowing and understanding' },
    { code: 'B', label: 'Investigating' },
    { code: 'C', label: 'Communicating' },
    { code: 'D', label: 'Thinking critically' },
  ],
  language_literature: [
    { code: 'A', label: 'Analysing' },
    { code: 'B', label: 'Organizing' },
    { code: 'C', label: 'Producing text' },
    { code: 'D', label: 'Using language' },
  ],
  language_acquisition: [
    { code: 'A', label: 'Comprehending spoken and visual text' },
    { code: 'B', label: 'Comprehending written and visual text' },
    { code: 'C', label: 'Communicating' },
    { code: 'D', label: 'Using language' },
  ],
  arts: [
    { code: 'A', label: 'Knowing and understanding' },
    { code: 'B', label: 'Developing skills' },
    { code: 'C', label: 'Thinking creatively' },
    { code: 'D', label: 'Responding' },
  ],
  design: [
    { code: 'A', label: 'Inquiring and analysing' },
    { code: 'B', label: 'Developing ideas' },
    { code: 'C', label: 'Creating the solution' },
    { code: 'D', label: 'Evaluating' },
  ],
  physical_health_education: [
    { code: 'A', label: 'Knowing and understanding' },
    { code: 'B', label: 'Planning for performance' },
    { code: 'C', label: 'Applying and performing' },
    { code: 'D', label: 'Reflecting and improving performance' },
  ],
};

/**
 * Command terms grouped by cognitive tier, mapped loosely onto this
 * app's existing 1-5 difficulty scale. Tier 1 ~ DP AO1 / MYP lower
 * bands (recall), tier 2 ~ AO2 (application), tier 3 ~ AO3 (synthesis
 * and evaluation, the top MYP bands).
 */
export function commandTermsForDifficulty(difficulty: number): string[] {
  if (difficulty <= 2) {
    return ['State', 'Define', 'List', 'Identify', 'Label', 'Outline'];
  }
  if (difficulty === 3) {
    return ['Describe', 'Explain', 'Calculate', 'Demonstrate', 'Distinguish', 'Apply'];
  }
  return ['Analyse', 'Evaluate', 'Discuss', 'Compare', 'Contrast', 'Justify', 'To what extent', 'Examine'];
}

/**
 * Rough, generic percentage -> DP 1-7 mapping. Real grade boundaries
 * are set per subject per exam session by the IB and are not knowable
 * in advance -- always label this as an estimate, never a predicted
 * official grade.
 */
export function estimateDPGrade(percentage: number): number {
  const bounds = [45, 55, 65, 73, 81, 89]; // upper bound of grades 1..6; 7 is above the last
  let grade = 1;
  for (const b of bounds) {
    if (percentage >= b) grade++;
    else break;
  }
  return Math.min(7, Math.max(1, grade));
}

/** Rough percentage -> MYP criterion band (0-8). */
export function estimateMYPBand(percentage: number): number {
  return Math.min(8, Math.max(0, Math.round((percentage / 100) * 8)));
}

/** Rough MYP total-out-of-32 -> final 1-7 (generic boundaries, not an official conversion grid). */
export function estimateMYPFinalGrade(totalOutOf32: number): number {
  const bounds = [5, 9, 14, 18, 23, 27]; // upper bound of grades 1..6
  let grade = 1;
  for (const b of bounds) {
    if (totalOutOf32 > b) grade++;
    else break;
  }
  return Math.min(7, Math.max(1, grade));
}
