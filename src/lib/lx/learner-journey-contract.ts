/**
 * LX-1B -- CANONICAL LEARNER JOURNEY CONTRACT.
 *
 * A PURE PRESENTATION-LAYER translation from already-canonical StudyUS
 * learning truth into the learner-visible journey vocabulary:
 *
 *   NOT_STARTED -> LEARN -> PRACTICE -> READY_TO_PROVE -> PROVE
 *               -> RETAIN -> TRANSFER -> CONSOLIDATED
 *   ( + REINFORCE as a temporary intervention overlay )
 *
 * THIS IS NOT A SECOND LEARNING-STATE ENGINE.
 *
 *  - It NEVER reads a raw dimension score, evidence row, threshold,
 *    misconception count, retention timestamp, or transfer score.
 *  - Its ONLY inputs are values other canonical authorities already
 *    computed: Phase 4B `LearningState`
 *    (adaptive-learning-policy.computeLearningState), Phase 2.2
 *    `MasteryState` / `ValidationReadiness` (knowledge-state.service),
 *    Phase 6 `MemoryStatus` + the already-derived `retentionDue`
 *    overlay (memory-policy / memory-read.service), and Phase 7
 *    `TransferDepth` (transfer-policy / transfer-read.service).
 *  - `LearningState` already encodes StudyUS's own precedence
 *    (misconception > prerequisite > repair > verification >
 *    independence > retention > transfer > validated > developing).
 *    This function MIRRORS that precedence; it never re-orders it and
 *    never overrides it with a UX rule.
 *
 * REINFORCE is not a progress stage. It is an intervention flag that
 * sits ON TOP of a best-effort underlying stage; once the intervention
 * clears, the learner is back on the canonical journey with no
 * permanent "reinforced" marker.
 */

import type { LearningState } from '@/lib/adaptive-learning-policy';
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';
import type { MemoryStatus } from '@/lib/memory-policy';
import type { TransferDepth } from '@/lib/transfer-policy';

/** Bumped only when this deterministic mapping or its precedence changes. */
export const LEARNER_JOURNEY_CONTRACT_VERSION = 1 as const;

/** The learner-visible journey vocabulary. Presentation only -- never persisted as a learning state. */
export type LearnerJourneyStage =
  | 'NOT_STARTED'
  | 'LEARN'
  | 'PRACTICE'
  | 'READY_TO_PROVE'
  | 'PROVE'
  | 'RETAIN'
  | 'TRANSFER'
  | 'CONSOLIDATED';

export type LearnerJourneyIntervention = 'REINFORCE';

/**
 * The exact canonical facts this mapping consumes. Every field is an
 * output of an existing authority -- nothing here is a score or a
 * threshold.
 */
export interface LearnerJourneyInputs {
  /** Phase 4B canonical -- adaptive-learning-policy.computeLearningState(context). The primary driver. */
  learningState: LearningState;
  /** Phase 2.2 canonical -- knowledge-state.service. `null` when no Concept Knowledge State row exists yet. */
  masteryState: MasteryState | null;
  /** Phase 2.2 canonical -- knowledge-state.service. `null` when no row exists yet. */
  validationReadiness: ValidationReadiness | null;
  /** Phase 6 canonical -- memory-policy.computeMemoryStatus, persisted on concept_memory_state. Optional (a concept with no memory state yet). */
  memoryStatus?: MemoryStatus | null;
  /** Phase 6 canonical -- the already-derived `nextReviewAt <= now` overlay (memory-read.service). NEVER recomputed here. */
  retentionDue?: boolean;
  /** Phase 7 canonical -- concept_transfer_state.transfer_depth (transfer-read.service). Optional. */
  transferDepth?: TransferDepth | null;
}

export interface LearnerJourneyResult {
  /** The learner-visible progress stage. Always present. */
  stage: LearnerJourneyStage;
  /**
   * Present only while a blocking intervention is active
   * (misconception / prerequisite / repair). When set, `stage` is a
   * best-effort underlying position -- the true pre-intervention stage
   * is carried by LX-5 continuation, not recoverable from
   * `LearningState` alone (see B3 gap note).
   */
  intervention: LearnerJourneyIntervention | null;
  /** The single canonical fact that decided this stage -- for "why am I here" copy, never a score. */
  reason: string;
  contractVersion: typeof LEARNER_JOURNEY_CONTRACT_VERSION;
}

const BLOCKED_OR_REPAIR: ReadonlySet<LearningState> = new Set<LearningState>([
  'MISCONCEPTION_BLOCKED',
  'PREREQUISITE_BLOCKED',
  'NEEDS_REPAIR',
]);

/**
 * Deterministic. First matching rule wins. The order below is the same
 * severity order `computeLearningState` itself applies -- this function
 * does not invent a new one.
 */
export function deriveLearnerJourneyStage(inputs: LearnerJourneyInputs): LearnerJourneyResult {
  const { learningState, masteryState, validationReadiness } = inputs;
  const v = LEARNER_JOURNEY_CONTRACT_VERSION;

  // 1. No canonical Knowledge State yet -> the journey has not begun.
  if (learningState === 'NOT_STARTED' || masteryState == null || masteryState === 'UNKNOWN') {
    return { stage: 'NOT_STARTED', intervention: null, reason: 'NO_KNOWLEDGE_STATE', contractVersion: v };
  }

  // 2. A blocking problem is active -> REINFORCE intervention. `stage`
  //    is a coarse underlying position only; the accurate return stage
  //    is LX-5's job.
  if (BLOCKED_OR_REPAIR.has(learningState)) {
    return {
      stage: 'PRACTICE',
      intervention: 'REINFORCE',
      reason:
        learningState === 'MISCONCEPTION_BLOCKED'
          ? 'ACTIVE_MISCONCEPTION'
          : learningState === 'PREREQUISITE_BLOCKED'
            ? 'PREREQUISITE_GAP'
            : 'REPAIR_IN_PROGRESS',
      contractVersion: v,
    };
  }

  // 3. The independent-demonstration moment is live.
  if (learningState === 'PENDING_VERIFICATION') {
    return { stage: 'PROVE', intervention: null, reason: 'VERIFICATION_PENDING', contractVersion: v };
  }
  if (learningState === 'INSUFFICIENT_INDEPENDENT_EVIDENCE') {
    return { stage: 'PROVE', intervention: null, reason: 'NO_INDEPENDENT_EVIDENCE_YET', contractVersion: v };
  }

  // 4. Retention obligation (already prioritised ahead of transfer /
  //    validated by computeLearningState).
  if (learningState === 'RETENTION_RISK') {
    return { stage: 'RETAIN', intervention: null, reason: 'RETENTION_DUE', contractVersion: v };
  }

  // 5. Transfer obligation.
  if (learningState === 'TRANSFER_GAP') {
    return { stage: 'TRANSFER', intervention: null, reason: 'TRANSFER_REQUIRED', contractVersion: v };
  }

  // 6. Fully validated and nothing above pulled it back -> consolidated.
  if (learningState === 'VALIDATED') {
    return { stage: 'CONSOLIDATED', intervention: null, reason: 'VALIDATED_MASTERY', contractVersion: v };
  }

  // 7. Residual DEVELOPING band (LEARNING / DEVELOPING / PROVISIONAL_MASTERY
  //    with nothing blocking). Split by the canonical MasteryState /
  //    ValidationReadiness -- still states, not scores.
  if (masteryState === 'LEARNING') {
    return { stage: 'LEARN', intervention: null, reason: 'UNDERSTANDING_STILL_FORMING', contractVersion: v };
  }
  if (validationReadiness === 'READY') {
    // Evidence is sufficient; mastery is not yet validated -> the
    // "prove it on your own" gate is open.
    return { stage: 'READY_TO_PROVE', intervention: null, reason: 'EVIDENCE_SUFFICIENT_NOT_YET_VALIDATED', contractVersion: v };
  }
  return { stage: 'PRACTICE', intervention: null, reason: 'BUILDING_EVIDENCE', contractVersion: v };
}
