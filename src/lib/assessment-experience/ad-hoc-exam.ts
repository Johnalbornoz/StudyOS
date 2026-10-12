/**
 * A Student's own partial exam ("Crear examen" on a Subject) -- the rules that are pure.
 *
 * Subject -> the concepts the Student chose -> a size and an optional time limit -> an assessment.
 * It needs no institution, programme, qualification, exam definition or official blueprint.
 *
 * ONE canonical representation: the learning intent AD_HOC_CONCEPT_EXAM, run by the existing learning
 * assessment (the Blueprint Core selects from eligible content only and never generates; the start authority
 * freezes it; completion writes evidence through the one evidence loop). The intent is frozen with the
 * assessment and carried by its evidence, so the provenance stays explicit: self-created, never official.
 */
import type { LearningIntent } from '@/lib/assessment-blueprint/policy/learning';
import { PRACTICE_DEPTHS, type PracticeDepth } from '@/lib/assessment-blueprint/policy/practice-depth';
import { ASSESSMENT_SETUP_PATH } from './entry';
import { AD_HOC_EXAM_MAX_CONCEPTS, isUuid, normalizeSelection } from '@/lib/ad-hoc-exam/selection';
import { REQUESTED_DIFFICULTY_BANDS, type RequestedDifficultyBand } from '@/lib/exam-core/question-bank/requested-difficulty';

export { AD_HOC_EXAM_MAX_CONCEPTS };
/** The sizes a Student can choose: the existing practice depths. */
export const AD_HOC_EXAM_SIZES = PRACTICE_DEPTHS;
export type AdHocExamSize = PracticeDepth;

/**
 * The difficulties a Student can choose: the Question Bank's own item bands (question-bank/quality `DifficultyBand`).
 * null = not stated: the exam keeps the canonical band of an independent check as a preference.
 */
export const AD_HOC_EXAM_DIFFICULTIES = REQUESTED_DIFFICULTY_BANDS;
export type AdHocExamDifficulty = RequestedDifficultyBand;

export const AD_HOC_EXAM_INTENT = 'AD_HOC_CONCEPT_EXAM' as const satisfies LearningIntent;
export const AD_HOC_EXAM_ORIGIN = 'SUBJECT' as const;
/**
 * The time a Student says they have. It bounds how much the exam asks (the Blueprint Core fits the selection to it,
 * against recorded durations only); it is not a countdown. null = not stated.
 */
export const AD_HOC_EXAM_MINUTES = [15, 30, 45, 60, 90] as const;

export const isAdHocExamIntent = (intent: string | null | undefined): boolean => intent === AD_HOC_EXAM_INTENT;

/**
 * The link that opens the setup of this exam: exactly these concepts of this Subject, nothing else.
 * `conceptIds` are the Student's own concepts of that Subject; the server checks both again.
 */
export function adHocExamHref(input: { subjectId: string; conceptIds: readonly string[]; depth?: PracticeDepth | null; minutes?: number | null; difficulty?: AdHocExamDifficulty | null }): string | null {
  const selection = normalizeSelection(input.conceptIds);
  if (!selection.ok || !isUuid(input.subjectId)) return null;
  const params = new URLSearchParams({ intent: AD_HOC_EXAM_INTENT, origin: AD_HOC_EXAM_ORIGIN, s: input.subjectId, lc: selection.conceptIds.join(',') });
  if (input.depth && (PRACTICE_DEPTHS as readonly string[]).includes(input.depth)) params.set('depth', input.depth);
  if (input.minutes && (AD_HOC_EXAM_MINUTES as readonly number[]).includes(input.minutes)) params.set('m', String(input.minutes));
  if (input.difficulty && (AD_HOC_EXAM_DIFFICULTIES as readonly string[]).includes(input.difficulty)) params.set('d', input.difficulty);
  return `${ASSESSMENT_SETUP_PATH}?${params.toString()}`;
}

/** Selecting a Topic or Subtopic selects its concepts; clearing it clears them. Pure, for the selector. */
export function toggleGroup(selected: readonly string[], groupConceptIds: readonly string[]): string[] {
  const set = new Set(selected);
  const allIn = groupConceptIds.length > 0 && groupConceptIds.every((id) => set.has(id));
  for (const id of groupConceptIds) {
    if (allIn) set.delete(id);
    else set.add(id);
  }
  return [...set];
}

/** Where starting a scheduled exam goes: the same setup, naming the schedule. Its scope is read from the schedule on the server. */
export function scheduledAdHocExamHref(scheduledAssessmentId: string): string {
  return `/dashboard/assessment?${new URLSearchParams({ intent: AD_HOC_EXAM_INTENT, origin: AD_HOC_EXAM_ORIGIN, sch: scheduledAssessmentId, confirm: '1' }).toString()}`;
}

/** Fired in the browser when a schedule was saved, so the Subject's list shows it without a reload. */
export const AD_HOC_SCHEDULED_EVENT = 'studyus:ad-hoc-exam-scheduled';

/**
 * The moment a Student typed (a `datetime-local` value: their wall time, no zone) as an instant with its
 * offset, using the browser's own clock. Returns null for anything that is not a full date AND time.
 */
export function scheduledInstantOfLocal(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
