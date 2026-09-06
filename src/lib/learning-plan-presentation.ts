/**
 * Phase 8 -- Step 8F1: PURE, deterministic learner-facing presentation
 * of a learning-plan item.
 *
 * The stored `reason_code` / `source` / `priority_at_plan_time` /
 * `operation_key` / policy version / raw Transfer & Memory internals are
 * MACHINE PROVENANCE and must never reach the learner verbatim. This
 * module maps them to a small, stable set of i18n keys. The actual
 * prose lives in `messages.ts` for all five locales; an AI layer MAY
 * later paraphrase, but this deterministic fallback is always correct
 * and always present.
 *
 * No DB, no AI, no clock, no imports beyond the pure policy types.
 */
import {
  getOrchestrationGoalTier,
  ORCHESTRATION_REASON_CODES,
  type OrchestrationReasonCode,
} from '@/lib/learning-orchestration-policy';
import type { LearningPlanItemStatus } from '@/lib/learning-orchestration-policy';

/** i18n key for the friendly "why is this on my plan" line. */
export function planItemWhyKey(reasonCode: OrchestrationReasonCode): string {
  // Exhaustive by construction: every closed reason code has a key.
  return `plan8.why.${reasonCode}`;
}

/** All the why keys 8F1 requires messages.ts to define (one per closed reason code). */
export const PLAN_ITEM_WHY_KEYS: readonly string[] = ORCHESTRATION_REASON_CODES.map(planItemWhyKey);

/** i18n key for a live item's status chip. Terminal statuses are not shown on the live plan. */
export function planItemStatusKey(status: LearningPlanItemStatus): string {
  return `plan8.status.${status}`;
}

/**
 * Whether the LEARNER may unilaterally skip this item. Only the two
 * lowest-precedence classes -- ordinary curriculum progression and a
 * self-requested extra practice -- are learner-skippable. Every
 * integrity obligation (blockers, retention, assessment prep,
 * verification, transfer progression) is NOT: the server refuses, and
 * the UI must not offer the control.
 */
export function canLearnerSkip(reasonCode: OrchestrationReasonCode): boolean {
  return getOrchestrationGoalTier(reasonCode) >= 6;
}

/**
 * A display bucket for the scheduled date relative to today. PURE --
 * `todayIso` is injected, never read from a clock here.
 */
export type PlanItemDayBucket = 'TODAY' | 'OVERDUE' | 'UPCOMING';

export function planItemDayBucket(scheduledDate: string, todayIso: string): PlanItemDayBucket {
  if (scheduledDate < todayIso) return 'OVERDUE';
  if (scheduledDate === todayIso) return 'TODAY';
  return 'UPCOMING';
}

/**
 * 8G1 compatibility only: the legacy Study Plan API exposed a coarse
 * CRITICAL/HIGH/MEDIUM/LOW band. Derive it deterministically from the
 * canonical goal tier so the compat shim over `/api/study-plan/generate`
 * keeps its old response shape. Not used anywhere in the canonical UI.
 */
export type LegacyPriorityBand = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export function legacyPriorityBand(reasonCode: OrchestrationReasonCode): LegacyPriorityBand {
  const tier = getOrchestrationGoalTier(reasonCode);
  if (tier === 1) return 'CRITICAL';
  if (tier <= 3) return 'HIGH';
  if (tier <= 5) return 'MEDIUM';
  return 'LOW';
}
