/**
 * B5-D -- the entry-point cutover. Pure.
 *
 * Today, My Path and every other surface launch a practice through the server's launch target (the Learning
 * Decision authority chooses the concept and the activity; nothing here does). When canonical execution is
 * ON, a launch into the existing quiz flow for an activity the assessment system owns is re-pointed at the
 * canonical setup, carrying the SAME intent: which concept, which activity. It carries no question, no
 * count and no difficulty -- the Blueprint Core decides those.
 *
 * Activities the assessment system does not own (teaching, transfer, diagnosis of an open issue, pending
 * verification, remediation) keep their own flows whatever the flag says.
 */
import type { LearningIntent } from '@/lib/assessment-blueprint/policy/learning';
import type { LaunchOrigin } from './launch';

export const ASSESSMENT_SETUP_PATH = '/dashboard/assessment' as const;

/** The existing quiz modes that ARE assessments of one concept, and the canonical intent of each. */
export const ASSESSMENT_INTENT_OF_QUIZ_MODE: Readonly<Record<string, LearningIntent>> = {
  topic_practice: 'CONCEPT_PRACTICE',
  canonical_prove: 'MASTERY_CHECK',
  canonical_retain: 'RETENTION_CHECK',
};

export function assessmentSetupHref(scope: { learnerConceptId: string }, intent: LearningIntent, origin: LaunchOrigin = 'TODAY'): string {
  return `${ASSESSMENT_SETUP_PATH}?${new URLSearchParams({ intent, origin, lc: scope.learnerConceptId }).toString()}`;
}

/**
 * The launch target a surface should navigate to. `enabled` is the server flag, passed in by the server-side
 * launch builder. A resume of a specific existing quiz (`quizId`) is never re-pointed: that attempt already
 * has its authority.
 */
export function entryTargetFor(path: string, params: Readonly<Record<string, string>>, enabled: boolean, origin: LaunchOrigin = 'TODAY'): string | null {
  if (!enabled || path !== '/dashboard/quiz' || params.quizId || !params.conceptId) return null;
  const intent = ASSESSMENT_INTENT_OF_QUIZ_MODE[params.mode ?? ''];
  return intent ? assessmentSetupHref({ learnerConceptId: params.conceptId }, intent, origin) : null;
}
