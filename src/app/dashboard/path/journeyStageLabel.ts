import type { JourneyStage } from '@/lib/lx/concept-journey';
import type { getMessages } from '@/lib/i18n/messages';

/**
 * LX-7 -- UI translation only, mirroring activityLabel.ts's own
 * pattern: maps the fixed `JourneyStage` union to the learner-friendly
 * copy the spec requires (LEARN -> "Learn it", RETAIN -> "Keep it
 * fresh", ...). Never introduces a new stage, never chooses one --
 * the caller must already hold a real `ConceptJourney` from
 * concept-journey.ts.
 */
export function journeyStageLabel(stage: JourneyStage, t: ReturnType<typeof getMessages>): string {
  return t[`myPathStage.${stage}` as keyof typeof t];
}

/** The REINFORCE overlay's own label -- never a stage of the line itself (R7). */
export function journeyReinforceLabel(t: ReturnType<typeof getMessages>): string {
  return t['myPathStage.REINFORCE'];
}

/** R25: accessible, non-color status text for one stage pip. */
export function journeyStageStateLabel(state: 'COMPLETED' | 'CURRENT' | 'PENDING', t: ReturnType<typeof getMessages>): string {
  return t[`myPathStageState.${state}` as keyof typeof t];
}
