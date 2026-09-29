/**
 * UX-2 -- the learner-facing vocabulary, in one place.
 *
 * Every function here is a lookup from an AUTHORITATIVE state to copy.
 * Internal enums are never renamed and nothing here reads a score, a
 * count or a threshold: a learning status can only be shown when the
 * engine already produced it.
 *
 *   stage     -> `conceptMission.stage.*` (the single stage vocabulary;
 *                My Path and Concept Mission both render it)
 *   challenge -> `xp.challenge.*` (the "Entrénalo / Demuéstralo" framing
 *                of the activity the engine launches)
 */
import type { MessageKey, getMessages } from '@/lib/i18n/messages';
import type { LearnerJourneyStage } from '@/lib/lx/learner-journey-contract';
import type { ChallengeKind } from './next-challenge';

type T = ReturnType<typeof getMessages>;

// Compile-time guarantee: every challenge kind has copy in every locale.
type ChallengeKey = `xp.challenge.${ChallengeKind}`;
const _everyChallengeHasCopy: ChallengeKey extends MessageKey ? true : never = true;
void _everyChallengeHasCopy;

type StageKey = `conceptMission.stage.${LearnerJourneyStage}`;
const _everyStageHasCopy: StageKey extends MessageKey ? true : never = true;
void _everyStageHasCopy;

export function challengeVerb(kind: ChallengeKind, t: T): string {
  return t[`xp.challenge.${kind}` satisfies ChallengeKey];
}

export function stageLabel(stage: LearnerJourneyStage, t: T): string {
  return t[`conceptMission.stage.${stage}` satisfies StageKey];
}

export function reinforceLabel(t: T): string {
  return t['myPathStage.REINFORCE'];
}
