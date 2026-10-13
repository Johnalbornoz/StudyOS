/**
 * Nominal response time of a GENERATED item (Learning / Internal Assessment).
 *
 * A generated item has no measured duration, so a Student's time limit could never be fitted to it: every
 * candidate was "duration unknown" and a timed Internal Assessment refused to start. This states the time a
 * generated item is PLANNED to take, from the two facts the item store records for it: its question type and
 * its difficulty (1-5).
 *
 * It is a planning allowance, not a measurement, and it belongs to generated items only. A Certified Exam
 * Bank item never reads it: an exam's timing comes from the exam's own specification.
 */
import { knownOrUnknown } from './known';
import type { QuestionCoverage } from './question-coverage';

/** Seconds a question of this type is planned to take at difficulty 3. */
const BASE_SECONDS_OF_TYPE: Record<string, number> = {
  true_false: 30,
  fill_blank: 45,
  multiple_choice: 60,
  matching: 75,
  classification: 75,
  short_answer: 120,
  numeric_problem: 120,
  comparison: 120,
  error_detection: 120,
  scenario: 150,
  justification: 150,
  step_by_step: 180,
  case_study: 240,
};

/** A type this table does not name is planned as an open response. */
const DEFAULT_BASE_SECONDS = 120;

const DIFFICULTY_FACTOR: Record<number, number> = { 1: 0.75, 2: 0.85, 3: 1, 4: 1.25, 5: 1.5 };

/** Planned seconds for a generated item, in steps of 15. null when the item records no type or no difficulty on the 1-5 scale. */
export function nominalResponseSeconds(questionType: string | null | undefined, difficulty: number | null | undefined): number | null {
  if (!questionType || typeof difficulty !== 'number') return null;
  const factor = DIFFICULTY_FACTOR[difficulty];
  if (factor === undefined) return null;
  const base = BASE_SECONDS_OF_TYPE[questionType] ?? DEFAULT_BASE_SECONDS;
  return Math.max(15, Math.round((base * factor) / 15) * 15);
}

/**
 * A generated item's coverage with its planned time stated. Applied where the Student's own generated items are
 * loaded, and only there: a coverage from any other store is returned untouched.
 */
export function withNominalResponseTime(coverage: QuestionCoverage): QuestionCoverage {
  if (coverage.ref.store !== 'LEARNING_ITEM_CACHE') return coverage;
  const questionType = coverage.questionType.state === 'KNOWN' ? coverage.questionType.value : null;
  const difficulty = coverage.difficulty.state === 'KNOWN' ? coverage.difficulty.value : null;
  return { ...coverage, estimatedSeconds: knownOrUnknown(nominalResponseSeconds(questionType, difficulty)) };
}
