/**
 * LX-9 FINAL, PART I -- THE SINGLE CANONICAL LEARNING-PROGRESS READ MODEL.
 *
 * Live QA found the SAME concept reported "Estás aquí: Retener" on
 * Concept Mission while the Progress dashboard's own concept row showed
 * "Aprendiendo" -- two different learner-facing screens answering
 * "where am I in my learning journey?" from two different authorities
 * (Concept Mission: the canonical `LearnerJourneyStage`; Progress
 * dashboard: the raw `MasteryState` enum, a genuinely different axis --
 * evidence CONFIDENCE, not journey PROGRESS).
 *
 * This module is NOT a second Learning Engine and computes nothing new.
 * It is a thin composition of THREE already-canonical, already-existing
 * authorities, each doing exactly what it already did before this file
 * existed:
 *   - `resolveConceptJourneyStage` (path-view.ts) -- the SAME stage
 *     resolver My Path / Concept Mission / the Subjects detail page
 *     already call.
 *   - `deriveJourneyProgress` (journey-progress.ts) -- the SAME fixed
 *     stage-anchor percentage map the Subjects detail page's concept
 *     rows already use.
 *   - `isRetentionWaiting` (learner-journey-contract.ts) -- the SAME
 *     "RETAIN but not yet due" check Concept Mission's NOW card
 *     (LX-9R3-R1 W1) already applies.
 *
 * Every learner-facing surface that needs to answer "where is this
 * concept, what's next, and why" should call `buildCanonicalLearningProgress`
 * instead of re-deriving an equivalent condition locally -- that
 * re-derivation, however well-intentioned, is exactly how the live bug
 * happened.
 */
import { resolveConceptJourneyStage } from './path-view';
import { deriveJourneyProgress } from './journey-progress';
import { isRetentionWaiting, type LearnerJourneyStage } from './learner-journey-contract';
import type { MessageKey } from '@/lib/i18n/messages';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';

/** Evidence dimensions (Part N) -- kept as their OWN, separate shape. They explain the learner's evidence profile; they never define journeyStage/journeyProgressPercent, and are never forced to numerically agree with the journey percentage. */
export interface CanonicalEvidenceDimensions {
  understandingScore: number | null;
  independenceScore: number | null;
  applicationScore: number | null;
  retentionScore: number | null;
  transferScore: number | null;
}

export type CanonicalWaitingReason = 'RETENTION_NOT_DUE';

export interface CanonicalLearningProgress {
  conceptId: string;
  /** The ONLY vocabulary for "where am I" -- LEARN/PRACTICE/READY_TO_PROVE/PROVE/RETAIN/TRANSFER/CONSOLIDATED. Never a second taxonomy ("Aprendiendo", "En progreso", ...). */
  journeyStage: LearnerJourneyStage;
  /** From the fixed LX-9R1 stage-anchor map ONLY -- never mastery_score, avgMasteryPercent, quiz score, confidence, or evidence count. */
  journeyProgressPercent: number;
  /** Reuses Concept Mission's own `conceptMission.stage.*` label vocabulary -- never a second label set. */
  journeyProgressLabelKey: MessageKey;
  /**
   * The canonical Phase 4 decision's ActivityType for this concept,
   * verbatim -- `null` when there is none, OR when `waitingReason` is
   * set (a waiting concept has no actionable next action to report,
   * per LX-9R3-R1 W1 -- never the decision's own not-yet-due fallback
   * activityType, which would misrepresent "nothing to do yet" as an
   * action).
   */
  nextCanonicalAction: ActivityType | null;
  /** Set only when RETAIN is not yet actionable (isRetentionWaiting) -- never inferred for any other stage. */
  waitingReason: CanonicalWaitingReason | null;
  /** The canonical next-eligible-review date, verbatim from `memory.nextReviewAt`, when `waitingReason` is set and a date exists. Never fabricated. */
  nextEligibleAt: string | null;
  /** Understanding/Independence/Application/Retention/Transfer -- kept separate from journeyStage/journeyProgressPercent (Part N). `null` only when no Concept Knowledge State exists yet. */
  evidenceDimensions: CanonicalEvidenceDimensions | null;
}

export interface CanonicalLearningProgressInput {
  conceptId: string;
  subjectId: string;
  knowledgeState: ConceptKnowledgeState | null;
  /** The canonical Phase 4 decision for this concept, when one exists (`getBestLearningDecisionForConcept` / a snapshot's decisions filtered to this concept). */
  activeDecision?: LearningDecision;
  /** Canonical Phase 6 memory facts (`ConceptView.memory`). `null`/omitted when no concept_memory_state row exists yet. */
  memory?: { retentionDue: boolean; nextReviewAt: string | null } | null;
}

/**
 * The ONE function every learner-facing surface should call to answer
 * "where is this concept in its journey, what's next, and why." Pure --
 * no IO, no new computation, deterministic given the same
 * already-fetched canonical inputs.
 */
export function buildCanonicalLearningProgress(input: CanonicalLearningProgressInput): CanonicalLearningProgress {
  const { conceptId, subjectId, knowledgeState, activeDecision, memory } = input;
  const journeyStage = resolveConceptJourneyStage(conceptId, subjectId, knowledgeState, activeDecision);
  const progress = deriveJourneyProgress(journeyStage);
  const waiting = isRetentionWaiting(journeyStage, memory?.retentionDue);

  return {
    conceptId,
    journeyStage,
    journeyProgressPercent: progress.progressPercent,
    journeyProgressLabelKey: progress.progressLabelKey,
    nextCanonicalAction: waiting ? null : activeDecision?.activityType ?? null,
    waitingReason: waiting ? 'RETENTION_NOT_DUE' : null,
    nextEligibleAt: waiting ? memory?.nextReviewAt ?? null : null,
    evidenceDimensions: knowledgeState
      ? {
          understandingScore: knowledgeState.understandingScore,
          independenceScore: knowledgeState.independenceScore,
          applicationScore: knowledgeState.applicationScore,
          retentionScore: knowledgeState.retentionScore,
          transferScore: knowledgeState.transferScore,
        }
      : null,
  };
}
