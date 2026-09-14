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
import { resolveConceptJourneyResult } from './path-view';
import { deriveJourneyProgress } from './journey-progress';
import { isRetentionWaiting, type LearnerJourneyStage, type LearnerJourneyIntervention } from './learner-journey-contract';
import { isZeroGapPracticeMismatch } from './evidence-sufficiency-contract';
import type { MessageKey } from '@/lib/i18n/messages';
import type { ConceptKnowledgeState, MasteryPolicy } from '@/services/knowledge-state.service';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import { evidenceModeForActivity, type ActivityType, type EvidenceMode } from '@/lib/activity-taxonomy';

/** Evidence dimensions (Part N) -- kept as their OWN, separate shape. They explain the learner's evidence profile; they never define journeyStage/journeyProgressPercent, and are never forced to numerically agree with the journey percentage. */
export interface CanonicalEvidenceDimensions {
  understandingScore: number | null;
  independenceScore: number | null;
  applicationScore: number | null;
  retentionScore: number | null;
  transferScore: number | null;
}

export type CanonicalWaitingReason = 'RETENTION_NOT_DUE';

/**
 * LX-9R5 PART B: the ONE canonical answer to "can the learner act on
 * this concept right now, and if not, why."
 *   - CONSOLIDATED: the journey itself is finished (stage CONSOLIDATED).
 *   - WAITING: a genuine obligation exists (RETAIN) but isn't due yet --
 *     a valid, honest outcome, never an error (LX-9R5 Part C).
 *   - EXECUTABLE: a real canonical LearningDecision exists for this
 *     concept right now -- `nextCanonicalAction` names it. This
 *     includes a REINFORCE-intervention PRACTICE/REMEDIATION (Part D's
 *     explicit exception): the intervention is what makes it
 *     executable, never a silent fallback.
 *   - BLOCKED: none of the above -- no active decision, not
 *     consolidated, not waiting. A structurally quiet state (e.g.
 *     nothing eligible yet), distinct from a WAITING concept with a
 *     known, dated reason.
 */
export type CanonicalActionState = 'EXECUTABLE' | 'WAITING' | 'CONSOLIDATED' | 'BLOCKED';

export interface CanonicalLearningProgress {
  conceptId: string;
  /** The ONLY vocabulary for "where am I" -- LEARN/PRACTICE/READY_TO_PROVE/PROVE/RETAIN/TRANSFER/CONSOLIDATED. Never a second taxonomy ("Aprendiendo", "En progreso", ...). */
  journeyStage: LearnerJourneyStage;
  /** From the fixed LX-9R1 stage-anchor map ONLY -- never mastery_score, avgMasteryPercent, quiz score, confidence, or evidence count. */
  journeyProgressPercent: number;
  /** Reuses Concept Mission's own `conceptMission.stage.*` label vocabulary -- never a second label set. */
  journeyProgressLabelKey: MessageKey;
  /** Whether there is anything to DO right now -- see `CanonicalActionState`'s own doc comment. Every surface must branch on THIS, never infer executability from `journeyStage` alone (the exact My Path bug this phase fixes: stage RETAIN does not imply "offer Practice"). */
  actionState: CanonicalActionState;
  /**
   * The canonical Phase 4 decision's ActivityType for this concept,
   * verbatim -- `null` whenever `actionState !== 'EXECUTABLE'` (a
   * waiting/consolidated/blocked concept has no actionable next action
   * to report, per LX-9R3-R1 W1 -- never the decision's own not-yet-due
   * fallback activityType, which would misrepresent "nothing to do
   * yet" as an action).
   */
  nextCanonicalAction: ActivityType | null;
  /** Set only when `actionState === 'WAITING'` -- never inferred for any other stage. */
  waitingReason: CanonicalWaitingReason | null;
  /** The canonical next-eligible-review date, verbatim from `memory.nextReviewAt`, when `actionState === 'WAITING'` and a date exists. Never fabricated. */
  nextEligibleAt: string | null;
  /** LX-9R5 PART D: `'REINFORCE'` when this concept has an active blocking condition (misconception/prerequisite/repair) -- the ONE explicit signal that justifies `nextCanonicalAction` being PRACTICE/REMEDIATION even though the concept may otherwise look further along. `null` when no intervention is active. Verbatim from `deriveLearnerJourneyStage`'s own `.intervention` -- never re-derived. */
  intervention: LearnerJourneyIntervention | null;
  /** Understanding/Independence/Application/Retention/Transfer -- kept separate from journeyStage/journeyProgressPercent (Part N). `null` only when no Concept Knowledge State exists yet. */
  evidenceDimensions: CanonicalEvidenceDimensions | null;
  /** The EvidenceMode of `nextCanonicalAction` (a pure function of ActivityType, `evidenceModeForActivity`) -- `null` whenever there is no next canonical action. Answers "what KIND of activity is next," never "did the learner use help" (that is `assistanceUsed`, Part G -- a fact about ONE completed attempt, never inferred from EvidenceMode alone). */
  evidenceMode: EvidenceMode | null;
  /**
   * LX-9R5 PART G: whether the learner actually invoked a hint/guided
   * help/solution reveal on the ONE specific attempt this read model is
   * describing (e.g. for a Results/history rendering call) -- `null`
   * when this call is describing ongoing concept state rather than one
   * completed attempt, since there is no single attempt to report on.
   * Passed through verbatim from the caller's own already-recorded
   * fact; this module never infers it from ActivityType/EvidenceMode.
   */
  assistanceUsed: boolean | null;
}

export interface CanonicalLearningProgressInput {
  conceptId: string;
  subjectId: string;
  knowledgeState: ConceptKnowledgeState | null;
  /** The canonical Phase 4 decision for this concept, when one exists (`getBestLearningDecisionForConcept` / a snapshot's decisions filtered to this concept). */
  activeDecision?: LearningDecision;
  /** Canonical Phase 6 memory facts (`ConceptView.memory`). `null`/omitted when no concept_memory_state row exists yet. */
  memory?: { retentionDue: boolean; nextReviewAt: string | null } | null;
  /** See `CanonicalLearningProgress.assistanceUsed`'s own doc comment. Omit unless this call is describing one specific completed attempt. */
  assistanceUsed?: boolean | null;
  /**
   * LX-9R8 PART A1/A3: the active mastery policy -- required to detect a
   * zero-gap PRACTICE/REVIEW authority mismatch (`isZeroGapPracticeMismatch`).
   * Optional only for backward compatibility with a caller that hasn't
   * fetched it; omitting it means this read model CANNOT catch a
   * zero-gap mismatch for that call, so every caller should supply it.
   */
  masteryPolicy?: MasteryPolicy;
}

/**
 * The ONE function every learner-facing surface should call to answer
 * "where is this concept in its journey, can I act on it right now,
 * and if so with what." Pure -- no IO, no new computation,
 * deterministic given the same already-fetched canonical inputs. Does
 * NOT invent a second decision engine: `actionState`/`nextCanonicalAction`
 * are composed entirely from the SAME `LearningDecision` and memory
 * facts every canonical authority already produces.
 */
export function buildCanonicalLearningProgress(input: CanonicalLearningProgressInput): CanonicalLearningProgress {
  const { conceptId, subjectId, knowledgeState, activeDecision, memory, assistanceUsed, masteryPolicy } = input;
  const journeyResult = resolveConceptJourneyResult(conceptId, subjectId, knowledgeState, activeDecision);
  const journeyStage = journeyResult.stage;
  const progress = deriveJourneyProgress(journeyStage);
  const waiting = isRetentionWaiting(journeyStage, memory?.retentionDue);

  // LX-9R8 PART A1/A3: a PRACTICE/REVIEW decision whose canonical
  // evidence gap is already 0, with no REINFORCE intervention, is NOT
  // an executable canonical action -- selectActivityType's qualitative
  // fallthrough (masteryState/understandingScore) never checked the
  // quantitative evidence count. Checked BEFORE ever reporting
  // EXECUTABLE, so no learner-facing surface built on this read model
  // can offer a zero-gap Practice CTA.
  const zeroGapMismatch =
    !!activeDecision &&
    !!masteryPolicy &&
    isZeroGapPracticeMismatch({
      activityType: activeDecision.activityType,
      hasReinforceIntervention: journeyResult.intervention === 'REINFORCE',
      currentSufficiency: knowledgeState
        ? {
            evidenceCount: knowledgeState.evidenceCount,
            independentEvidenceCount: knowledgeState.independentEvidenceCount,
            passed:
              knowledgeState.evidenceCount >= masteryPolicy.minimumEvidenceCount &&
              knowledgeState.independentEvidenceCount >= masteryPolicy.minimumIndependentEvidenceCount,
          }
        : null,
      masteryPolicy,
    });

  const actionState: CanonicalActionState =
    journeyStage === 'CONSOLIDATED' ? 'CONSOLIDATED' : waiting ? 'WAITING' : activeDecision && !zeroGapMismatch ? 'EXECUTABLE' : 'BLOCKED';
  const nextCanonicalAction = actionState === 'EXECUTABLE' ? activeDecision!.activityType : null;

  return {
    conceptId,
    journeyStage,
    journeyProgressPercent: progress.progressPercent,
    journeyProgressLabelKey: progress.progressLabelKey,
    actionState,
    nextCanonicalAction,
    waitingReason: actionState === 'WAITING' ? 'RETENTION_NOT_DUE' : null,
    nextEligibleAt: actionState === 'WAITING' ? memory?.nextReviewAt ?? null : null,
    intervention: journeyResult.intervention,
    evidenceDimensions: knowledgeState
      ? {
          understandingScore: knowledgeState.understandingScore,
          independenceScore: knowledgeState.independenceScore,
          applicationScore: knowledgeState.applicationScore,
          retentionScore: knowledgeState.retentionScore,
          transferScore: knowledgeState.transferScore,
        }
      : null,
    evidenceMode: nextCanonicalAction ? evidenceModeForActivity(nextCanonicalAction) : null,
    assistanceUsed: assistanceUsed ?? null,
  };
}
