/**
 * UX-2 -- progress-bar colour, derived from authoritative STATE, never
 * from a score threshold.
 *
 * Before UX-2 five components coloured bars with a local
 * `score >= 75 ? good : score >= 50 ? warn : critical` rule -- a UI-side
 * re-judgement of the learner that no engine produced. Colour now follows
 * the canonical journey stage (and its REINFORCE overlay) when there is
 * one, and is neutral otherwise: a percentage is shown as a quantity, not
 * as a verdict.
 */
import type { LearnerJourneyStage, LearnerJourneyIntervention } from '@/lib/lx/learner-journey-contract';

export type ProgressTone = 'neutral' | 'active' | 'strong' | 'attention';

export function journeyStageTone(stage: LearnerJourneyStage | null | undefined, intervention?: LearnerJourneyIntervention | null): ProgressTone {
  if (intervention === 'REINFORCE') return 'attention';
  switch (stage) {
    case 'RETAIN':
    case 'TRANSFER':
    case 'CONSOLIDATED':
      return 'strong';
    case 'PRACTICE':
    case 'READY_TO_PROVE':
    case 'PROVE':
      return 'active';
    default:
      return 'neutral';
  }
}

const FILL_CLASS: Record<ProgressTone, string> = {
  neutral: 'fill-neutral',
  active: 'fill-brand',
  strong: 'fill-good',
  attention: 'fill-warn',
};

export function progressFillClass(tone: ProgressTone): string {
  return FILL_CLASS[tone];
}

/**
 * Aggregates (a subject's mean journey progress, a parent/admin average)
 * have no single stage behind them: they are drawn as a quantity in the
 * brand colour, never re-judged as good/warn/critical.
 */
export const QUANTITY_FILL_CLASS = 'fill-brand';
