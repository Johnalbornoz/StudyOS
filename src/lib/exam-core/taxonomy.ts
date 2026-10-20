/**
 * Track B -- the exam-family taxonomy. Exactly the six families the
 * product supports, enforced by the application layer (createExamDefinition,
 * the vertical configuration schema, the admin API). A DB CHECK is a
 * post-merge follow-up (shared DEV with the Roles track; see migration
 * 20261019_1000 and docs/exams/EXAM_CORE_IMPLEMENTATION.md).
 *
 * AICE is selectable as its own family, but it belongs to the Cambridge
 * ecosystem: it reuses every Cambridge structure (qualification -> subject
 * -> paper) and is represented as a qualification/aggregation
 * configuration, never as a separate engine.
 */

export const EXAM_FAMILIES = ['PAA', 'PISA', 'IB', 'CAMBRIDGE', 'AICE', 'ICFES'] as const;
export type ExamFamily = (typeof EXAM_FAMILIES)[number];

export type ExamEcosystem = 'PAA' | 'PISA' | 'IB' | 'CAMBRIDGE' | 'ICFES';

export interface ExamFamilyDescriptor {
  family: ExamFamily;
  /** The ecosystem whose structures the family reuses (AICE -> CAMBRIDGE). */
  ecosystem: ExamEcosystem;
  /** F6 programme classification the family's programmes normally use. */
  programmeType: 'CURRICULUM' | 'ASSESSMENT_FRAMEWORK' | 'ADMISSION_EXAM';
  /** Whether a year/session is meaningful for this family's versions (never required). */
  usesYearSession: boolean;
  /**
   * QB D3 -- what an assessment of this family IS. EXAM_PREPARATION: a fixed-form exam StudyUs may simulate.
   * COMPETENCY_BENCHMARK: a sample-based survey with rotated booklets (PISA) -- practice, competency /
   * transfer assessment and benchmark preparation, never a reproduced "Mock".
   */
  assessmentSemantics: 'EXAM_PREPARATION' | 'COMPETENCY_BENCHMARK';
}

export const EXAM_FAMILY_DESCRIPTORS: Record<ExamFamily, ExamFamilyDescriptor> = {
  PAA: { family: 'PAA', ecosystem: 'PAA', programmeType: 'ADMISSION_EXAM', usesYearSession: true, assessmentSemantics: 'EXAM_PREPARATION' },
  PISA: { family: 'PISA', ecosystem: 'PISA', programmeType: 'ASSESSMENT_FRAMEWORK', usesYearSession: true, assessmentSemantics: 'COMPETENCY_BENCHMARK' },
  IB: { family: 'IB', ecosystem: 'IB', programmeType: 'CURRICULUM', usesYearSession: true, assessmentSemantics: 'EXAM_PREPARATION' },
  CAMBRIDGE: { family: 'CAMBRIDGE', ecosystem: 'CAMBRIDGE', programmeType: 'CURRICULUM', usesYearSession: true, assessmentSemantics: 'EXAM_PREPARATION' },
  AICE: { family: 'AICE', ecosystem: 'CAMBRIDGE', programmeType: 'CURRICULUM', usesYearSession: true, assessmentSemantics: 'EXAM_PREPARATION' },
  ICFES: { family: 'ICFES', ecosystem: 'ICFES', programmeType: 'ADMISSION_EXAM', usesYearSession: true, assessmentSemantics: 'EXAM_PREPARATION' },
};

export function isExamFamily(value: unknown): value is ExamFamily {
  return typeof value === 'string' && (EXAM_FAMILIES as readonly string[]).includes(value);
}

/** Legacy / unknown labels resolve to null -- never guessed into a family. */
export function toExamFamily(value: unknown): ExamFamily | null {
  return isExamFamily(value) ? value : null;
}
