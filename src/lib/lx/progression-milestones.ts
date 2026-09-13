/**
 * LX-9 A3/A4 -- MOTIVATION MILESTONE PROJECTION.
 *
 * A PURE PRESENTATION-LAYER derivation, exactly like `concept-journey.ts`
 * / `learner-journey-contract.ts` before it: this file computes NOTHING
 * new about a learner's competence. It only detects whether the
 * learner-visible `LearnerJourneyStage` (LX-1B, `learner-journey-
 * contract.ts`) crossed one of a small set of meaningful thresholds
 * between two already-canonical evaluations, and maps that crossing to
 * one calm, evidence-grounded feedback line.
 *
 * "Milestones must come from evidence. No fabricated achievement." (A4)
 * is enforced structurally: this module accepts only two
 * `LearnerJourneyStage` values (never a score, count, or percentage)
 * and a milestone fires ONLY on a genuine forward crossing -- the same
 * stage twice, or a backward move (e.g. a REINFORCE intervention
 * pulling the learner back), yields `null`. There is no separate
 * "gamification progression engine" here (A2) -- this is a read of the
 * SAME canonical stage `deriveLearnerJourneyStage` already produces,
 * never a second authority.
 */
import type { LearnerJourneyStage } from './learner-journey-contract';
import type { MessageKey } from '@/lib/i18n/messages';

export type MilestoneType = 'STARTED' | 'PROVED' | 'RETAINED' | 'TRANSFERRED' | 'CONSOLIDATED';

/** Canonical forward order of the LX-1B journey -- the ONLY thing milestone detection compares. */
const STAGE_ORDER: readonly LearnerJourneyStage[] = [
  'NOT_STARTED',
  'LEARN',
  'PRACTICE',
  'READY_TO_PROVE',
  'PROVE',
  'RETAIN',
  'TRANSFER',
  'CONSOLIDATED',
];

function stageIndex(stage: LearnerJourneyStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * A4: fires only on a genuine FORWARD crossing of one of the five
 * named thresholds -- never on a lateral move within the same band,
 * never on a backward move (e.g. a REINFORCE intervention temporarily
 * lowering the rendered stage), and never twice for the same crossing
 * (a caller comparing the SAME `before` on a later, unrelated call gets
 * `null` again, since `before` no longer equals what preceded the
 * ALREADY-reported crossing). `before === null` is treated as
 * `NOT_STARTED` (no prior canonical stage to compare against, e.g. the
 * very first evaluation this session has ever seen for the learner).
 */
export function deriveMilestoneFromStageTransition(
  before: LearnerJourneyStage | null,
  after: LearnerJourneyStage,
): MilestoneType | null {
  const b = before ?? 'NOT_STARTED';
  if (after === b) return null;
  const beforeIndex = stageIndex(b);
  const afterIndex = stageIndex(after);
  if (afterIndex <= beforeIndex) return null;

  const crossed = (threshold: LearnerJourneyStage): boolean => beforeIndex <= stageIndex(threshold) && afterIndex > stageIndex(threshold);

  // PROVE/RETAIN/TRANSFER are OPEN-OBLIGATION stages (independent-
  // demonstration due / retention due / transfer due), not achievements
  // in themselves -- the achievement is CLEARING one, i.e. moving PAST
  // it to the next stage. TRANSFER and CONSOLIDATED are ADJACENT in the
  // LX-1B taxonomy, though, so "moved past TRANSFER" and "reached
  // CONSOLIDATED" are the exact same event -- TRANSFERRED is therefore
  // reported only for the specific transition OUT of the transfer-due
  // stage itself, never fabricated for a jump that skipped TRANSFER
  // entirely (that jump is correctly just CONSOLIDATED, checked next).
  if (b === 'TRANSFER' && after === 'CONSOLIDATED') return 'TRANSFERRED';
  if (after === 'CONSOLIDATED') return 'CONSOLIDATED';
  if (crossed('RETAIN')) return 'RETAINED';
  if (crossed('PROVE')) return 'PROVED';
  if (crossed('NOT_STARTED')) return 'STARTED';
  return null;
}

/** A8: one calm, evidence-based completion line per milestone -- never "Awesome!!! +500 XP" (A9: correct answer != achievement; this key is used ONLY when a real milestone fired, never for an ordinary score-tier result). */
const MILESTONE_FEEDBACK_KEY: Record<MilestoneType, MessageKey> = {
  STARTED: 'progression.milestoneStarted',
  PROVED: 'progression.milestoneProved',
  RETAINED: 'progression.milestoneRetained',
  TRANSFERRED: 'progression.milestoneTransferred',
  CONSOLIDATED: 'progression.milestoneConsolidated',
};

export function milestoneFeedbackKey(milestone: MilestoneType): MessageKey {
  return MILESTONE_FEEDBACK_KEY[milestone];
}
