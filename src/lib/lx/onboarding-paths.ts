/**
 * REM-T1-05 -- the two first-use journeys and their dedicated next steps.
 * Both start from FIRST_SUBJECT_PATH (/dashboard/onboarding) and Back from
 * either returns there (`from=onboarding` marks the Exam Prep entry).
 */
export const ONBOARDING_LEARN_PATH = '/dashboard/onboarding/learn';
export const ONBOARDING_EXAM_PATH = '/dashboard/exam-prep?from=onboarding';
/** Where Back leads from Exam Prep, by the entry that opened it (null = no onboarding Back). */
export function examPrepBackHref(from: string | null | undefined): string | null {
  if (from === 'onboarding') return '/dashboard/onboarding';
  if (from === 'start') return '/dashboard/start';
  return null;
}
