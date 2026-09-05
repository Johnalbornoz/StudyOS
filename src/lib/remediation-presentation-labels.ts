import type { getMessages } from '@/lib/i18n/messages';
import type { RemediationStepType, RemediationStepStatus, RemediationPattern } from '@/services/remediation.service';
import type { SupportLevel } from '@/lib/adaptive-teaching-policy';
import { evidenceModeForActivity } from '@/lib/activity-taxonomy';
import { canUseAI } from '@/lib/ai-permission-policy';
import { activityTypeForQuizMode, type QuizMode } from '@/services/quiz-persistence.service';

/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-B1: pure presentation mapping for the Remediation Session
 * Shell, mirroring activityCta.ts / concept-situation-labels.ts's own
 * established pattern exactly. Every function here is a total map
 * from an already-canonical enum (RemediationStepType,
 * RemediationStepStatus, RemediationPattern, SupportLevel) to
 * student-facing copy -- none of them decide which step, pattern, or
 * support level applies; they only render whatever the canonical
 * owner (remediation.service.ts / adaptive-teaching-policy.ts)
 * already produced. A raw enum value is never returned to a caller
 * that might render it directly.
 */

type Messages = ReturnType<typeof getMessages>;

export function remediationStepLabel(stepType: RemediationStepType, t: Messages): string {
  return t[`remediation.stepLabel.${stepType}` as keyof Messages];
}

export function remediationStepDescription(stepType: RemediationStepType, t: Messages): string {
  return t[`remediation.stepDescription.${stepType}` as keyof Messages];
}

export function remediationStepCta(stepType: RemediationStepType, t: Messages): string {
  return t[`remediation.stepCta.${stepType}` as keyof Messages];
}

export function remediationStepStatusLabel(status: RemediationStepStatus, t: Messages): string {
  if (status === 'completed') return t['remediation.stepStatusCompleted'];
  if (status === 'active') return t['remediation.stepStatusActive'];
  // 'pending' and 'skipped' both read as "not yet reached / not shown"
  // from the student's point of view -- neither exposes the raw enum.
  return t['remediation.stepStatusPending'];
}

export function remediationSupportLevelCopy(supportLevel: SupportLevel, t: Messages): string {
  return t[`remediation.supportLevel.${supportLevel}` as keyof Messages];
}

export function remediationPatternWhy(pattern: RemediationPattern, t: Messages): string {
  return t[`remediation.pattern.${pattern}` as keyof Messages];
}

/**
 * Worked-example honesty (Section 15): only ever promise a worked
 * example when the canonical SupportLevel is exactly HIGH_SUPPORT.
 * Never inferred from free text, step name, or any other signal.
 */
export function remediationPromisesWorkedExample(supportLevel: SupportLevel | null): boolean {
  return supportLevel === 'HIGH_SUPPORT';
}

/**
 * The exact same RemediationStepType -> quiz mode mapping
 * remediationStepHref itself switches on (Section 12) -- kept here
 * ONLY to ground the independence signal below in the real,
 * already-canonical quiz-mode -> ActivityType -> EvidenceMode chain
 * (quiz-persistence.service.ts's own `activityTypeForQuizMode`),
 * never to build a second routing table (remediationStepHref remains
 * the sole source of the actual href). EXPLAIN/TRANSFER route to
 * their own cognitive pages, not the quiz engine, so they have no
 * QuizMode/EvidenceMode to ground a claim in -- never guessed.
 */
const QUIZ_MODE_BY_STEP_TYPE: Partial<Record<RemediationStepType, QuizMode>> = {
  LEARN: 'topic_practice',
  GUIDED_PRACTICE: 'topic_practice',
  RETRIEVAL: 'quick_check',
  SOLO_VERIFY: 'cumulative_assessment',
};

/**
 * Independence moment (Section 17): grounded in the canonical
 * evidence-mode + AI-permission policy, never in the step's name
 * string alone. Re-derives whether AI assistance (HINT) is disallowed
 * for a step from the same two canonical policy modules the server
 * itself enforces with (activity-taxonomy.ts / ai-permission-policy.ts),
 * via the same quiz-mode mapping remediationStepHref uses to build the
 * step's own href -- never a fabricated per-step-type guess. Steps
 * with no quiz-mode grounding (EXPLAIN/TRANSFER) return false rather
 * than inventing one. The UI display is never the enforcement
 * authority; the server (/api/quizzes/hint et al.) re-checks
 * canUseAI itself on every request regardless of what this returns.
 */
export function remediationStepIsIndependent(stepType: RemediationStepType): boolean {
  const quizMode = QUIZ_MODE_BY_STEP_TYPE[stepType];
  if (!quizMode) return false;
  const evidenceMode = evidenceModeForActivity(activityTypeForQuizMode(quizMode));
  return !canUseAI({ evidenceMode, feature: 'HINT' });
}
