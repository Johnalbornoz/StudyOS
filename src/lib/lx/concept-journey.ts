import type { ConceptMissionRung } from './concept-mission';
import { RUNG_ORDER, currentRungIndex } from './concept-mission';
import { deriveLearnerJourneyStage, type LearnerJourneyResult, type LearnerJourneyIntervention } from './learner-journey-contract';

/**
 * LX-7 -- CANONICAL LEARNING JOURNEY (My Path adapter).
 *
 * My Path does NOT define its own stage authority. There already is
 * one: LX-1B's `deriveLearnerJourneyStage` (learner-journey-contract.ts)
 * -- the exact function Concept Mission's journey rail already renders
 * from (`concept-mission.ts` -> `buildJourney`). Reusing it here means
 * My Path, Concept Mission, and (via `LearningDecision.learningState`)
 * Today all read the SAME underlying journey position for a concept --
 * never a second, independently-derived stage that could disagree.
 *
 * This module only adapts that result into the flat 5-stage LINE shape
 * My Path renders (`RUNG_ORDER`, also reused verbatim from
 * concept-mission.ts): which rungs are behind, current, or ahead. It
 * adds no new pedagogy, no threshold, no score -- see path-view.ts for
 * how each concept's `LearnerJourneyInputs` are assembled, purely from
 * already-canonical, already-batched reads.
 */

export type JourneyStage = ConceptMissionRung | 'CONSOLIDATED';

export interface ConceptJourney {
  /** CONSOLIDATED means the entire journey line is complete -- never a 6th clickable task (R7/R9). */
  currentStage: JourneyStage;
  completedStages: ConceptMissionRung[];
  pendingStages: ConceptMissionRung[];
  consolidated: boolean;
  /** REINFORCE overlay attached to `currentStage` (R7/R10) -- never a stage of its own. Verbatim from the LX-1B contract. */
  intervention: LearnerJourneyIntervention | null;
  /** Provenance for future Decision Trace/admin QA (R30) -- never shown to the learner. Verbatim reason code from LX-1B. */
  reasonCode: string;
}

/** Adapts one LX-1B `LearnerJourneyResult` into My Path's flat rendering line. */
export function conceptJourneyFromResult(result: LearnerJourneyResult): ConceptJourney {
  if (result.stage === 'CONSOLIDATED') {
    return {
      currentStage: 'CONSOLIDATED',
      completedStages: [...RUNG_ORDER],
      pendingStages: [],
      consolidated: true,
      intervention: result.intervention,
      reasonCode: result.reason,
    };
  }
  const idx = currentRungIndex(result.stage);
  const rung = RUNG_ORDER[idx];
  return {
    currentStage: rung,
    completedStages: RUNG_ORDER.slice(0, idx),
    pendingStages: RUNG_ORDER.slice(idx + 1),
    consolidated: false,
    intervention: result.intervention,
    reasonCode: result.reason,
  };
}

export { deriveLearnerJourneyStage };
export type { LearnerJourneyInputs, LearnerJourneyStage, LearnerJourneyIntervention } from './learner-journey-contract';
