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
  // B5-F: the learner-selected "independent check" of one concept is a mastery check (same semantics as prove:
  // independent, no assistance); it is the same intent whichever surface asks for it.
  quick_check: 'MASTERY_CHECK',
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

/**
 * B5-F -- the link of a learner-selected check of ONE concept (a concept row's "independent check"). The same
 * boundary as every other launch: with canonical execution ON it is the canonical setup with the intent of
 * that quiz mode; OFF, the existing quiz link. `enabled` is the SERVER flag, handed down by the server page --
 * a client component never reads it and never builds a route of its own.
 */
export function conceptCheckHref(target: { subjectId: string; conceptId: string; mode: string }, enabled: boolean, origin: LaunchOrigin = 'LEARNING_PATH'): string {
  const params = { subjectId: target.subjectId, conceptId: target.conceptId, mode: target.mode };
  return entryTargetFor('/dashboard/quiz', params, enabled, origin) ?? `/dashboard/quiz?${new URLSearchParams(params).toString()}`;
}
