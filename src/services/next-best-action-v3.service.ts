/**
 * Phase 3D -- NBA v3. NOT another priority engine: a product-facing
 * projection of Phase 3C's decision + Phase 3D's execution-feasibility
 * output. It surfaces exactly the top item Phase 3D's scheduler already
 * fitted into the current execution window -- no independent scoring,
 * no independent concept selection, and no LLM-generated rationale.
 * `facts` are the same structured, language-independent LearningFacts
 * Phase 3C already built; the caller's i18n layer renders them into
 * prose (mirroring today-plan.service.ts's existing WhyThisFact
 * pattern), never generated here.
 */

import { getDailyLearningPlan, type DailyLearningPlanOptions } from './learning-execution-scheduler.service';
import { selectExecutableNextAction } from '@/lib/learning-execution-policy';
import { startLearningSession, type LearningSession } from './learning-session-engine.service';
import type { ActivityType } from '@/lib/activity-taxonomy';
import type { DueUrgency } from './learning-scheduler.service';
import type { LearningSignal, LearningFact, TargetDimension, PedagogicalPriority } from '@/lib/adaptive-learning-policy';

export interface NextBestActionV3 {
  actionConceptId: string;
  subjectId: string;
  activityType: ActivityType;
  targetDimension: TargetDimension;
  estimatedMinutes: number;
  pedagogicalPriority: PedagogicalPriority;
  temporalUrgency: DueUrgency | null;
  signals: LearningSignal[];
  primarySignal: LearningSignal;
  facts: LearningFact[];
  remediationPathId?: string;
  diagnosisId?: string;
  occurrenceId?: string;
  dueAt?: string | null;
  sessionLaunch: LearningSession;
}

/**
 * The single best next action for a student right now, or null with
 * nothing planned. Computed fresh from the daily plan on every call --
 * no cache, no persisted "next action" row. Once new evidence changes
 * Knowledge State, the next call naturally reflects the new ranking.
 */
export async function getNextBestActionV3(studentId: string, options: DailyLearningPlanOptions = {}): Promise<NextBestActionV3 | null> {
  const plan = await getDailyLearningPlan(studentId, options);
  const top = selectExecutableNextAction(plan);
  if (!top) return null;

  const { decision } = top;
  const sessionLaunch = await startLearningSession({ studentId, learningDecision: decision });

  return {
    actionConceptId: decision.actionConceptId,
    subjectId: decision.subjectId,
    activityType: decision.activityType,
    targetDimension: decision.targetDimension,
    estimatedMinutes: top.estimatedMinutes,
    pedagogicalPriority: decision.pedagogicalPriority,
    temporalUrgency: decision.temporalUrgency,
    signals: decision.signals,
    primarySignal: decision.primarySignal,
    facts: decision.facts,
    remediationPathId: decision.remediationPathId,
    diagnosisId: decision.diagnosisId,
    occurrenceId: decision.occurrenceId,
    dueAt: decision.dueAt,
    sessionLaunch,
  };
}
