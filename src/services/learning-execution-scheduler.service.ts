/**
 * Phase 3D -- Execution Scheduler (IO layer). Loads Phase 3C's ranked
 * LearningDecision[] and hands it to the pure policy in
 * @/lib/learning-execution-policy.ts. Never reorders pedagogical
 * priority, never re-implements any part of Phase 3C's ranking.
 */

import { getLearningDecisions } from './adaptive-learning-orchestrator.service';
import { buildDailyLearningPlan, type DailyLearningPlan } from '@/lib/learning-execution-policy';

export {
  estimateActivityMinutes,
  selectExecutableNextAction,
  buildDailyLearningPlan,
  type DailyLearningPlan,
  type LearningPlanItem,
  type DeferredDecision,
  type DeferReason,
  type ExecutionReason,
  type ExecutionConstraints,
} from '@/lib/learning-execution-policy';

/** No LLM estimates time budget -- until a real preference source exists, this is a documented product default (a single practice-style session), overridable per call. */
const DEFAULT_AVAILABLE_MINUTES = 30;

export interface DailyLearningPlanOptions {
  availableMinutes?: number;
  now?: Date;
  preferredLanguage?: string;
}

/**
 * Computed fresh on every call -- no persisted "today's plan" row.
 * Once new evidence changes Knowledge State, the very next call here
 * naturally reflects the new Phase 3C ranking; this is the Learning OS
 * closed loop, not a cache-invalidation problem.
 */
export async function getDailyLearningPlan(studentId: string, options: DailyLearningPlanOptions = {}): Promise<DailyLearningPlan> {
  const decisions = await getLearningDecisions(studentId, options.preferredLanguage);
  const availableMinutes = options.availableMinutes ?? DEFAULT_AVAILABLE_MINUTES;
  const now = options.now ?? new Date();
  return buildDailyLearningPlan(studentId, decisions, { availableMinutes, now });
}
