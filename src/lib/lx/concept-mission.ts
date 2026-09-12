/**
 * LX-3B / LX-3R -- CONCEPT MISSION READ MODEL (pure presentation).
 *
 * Turns already-canonical StudyUS learning truth for ONE (student,
 * concept) into the single presentation structure the Concept Mission
 * screen renders:
 *
 *   IDENTITY  -> what am I learning
 *   GOAL      -> what does success mean
 *   JOURNEY   -> where am I / what have I done / what remains
 *   NOW       -> the ONE next action
 *   LEARN     -> how the explanation is surfaced
 *
 * ARCHITECTURAL RULE (LX): the Learning Experience may present and
 * orchestrate canonical truth; it may never become a second Learning
 * Engine. This module therefore:
 *   - NEVER computes mastery, evidence sufficiency, difficulty, or a
 *     question count.
 *   - NEVER chooses an ActivityType. The one primary action is a
 *     verbatim pass-through of the canonical Phase 4 `LearningDecision`
 *     (`getBestLearningDecisionForConcept`). When Phase 4 has no
 *     decision, the Mission shows NO activity.
 *   - NEVER invents completion history. A journey rung is only marked
 *     "demonstrated" when a specific canonical record proves it
 *     (evidence rows / independent-evidence rows / a real retention
 *     success timestamp / a demonstrated transfer depth) -- never from
 *     a score threshold, never inferred from the current stage alone.
 *   - Derives the learner-visible stage exclusively through LX-1's pure
 *     `deriveLearnerJourneyStage` contract.
 *
 * JOURNEY STATE SOURCE (LX-3R repair)
 * ----------------------------------
 * `deriveLearnerJourneyStage` needs a Phase 4B `LearningState`. This
 * module NEVER invents one. The read boundary
 * (`concept-mission-view.service.ts`) resolves it canonically and hands
 * this builder a discriminated `journeyInput`:
 *
 *   { kind: 'RESOLVED', learningState, source }
 *       source 'LEARNING_DECISION'          -- from the Phase 4 LearningDecision itself
 *       source 'CANONICAL_POLICY_NO_SIGNALS'-- Phase 4 produced no decision for this
 *                                             concept (authoritatively zero signals),
 *                                             so the boundary called the CANONICAL pure
 *                                             policy `computeLearningState({knowledgeState,
 *                                             signals: []})` -- reused verbatim, never
 *                                             re-implemented.
 *   { kind: 'UNAVAILABLE' }
 *       -- the decision read FAILED (threw). Canonical truth is genuinely
 *          unavailable; the Mission says so and shows no stage marker.
 *
 * There is NO `VALIDATED_MASTERY -> VALIDATED` special case and NO
 * `otherwise -> DEVELOPING` fallback here. Absence of a decision is
 * never converted into an invented stage by this layer.
 */

import {
  deriveLearnerJourneyStage,
  type LearnerJourneyStage,
  type LearnerJourneyIntervention,
} from './learner-journey-contract';
import type { LearningState, LearningFact } from '@/lib/adaptive-learning-policy';
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';
import type { MemoryStatus } from '@/lib/memory-policy';
import type { TransferDepth } from '@/lib/transfer-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';

/** Bumped only when the shape or the derivation rules here change. */
export const CONCEPT_MISSION_VIEW_VERSION = 2 as const;

/* ------------------------------------------------------------------ */
/* Inputs -- every field is an output of an existing canonical source  */
/* ------------------------------------------------------------------ */

/** Canonical Phase 2.2 knowledge-state facts. `null` when no Concept Knowledge State row exists yet. */
export interface ConceptMissionKnowledgeState {
  masteryState: MasteryState;
  validationReadiness: ValidationReadiness;
  /** Presence counts only -- never a score. Used to prove a rung was reached, not to grade it. */
  evidenceCount: number;
  independentEvidenceCount: number;
}

/** Canonical Phase 4 decision for this concept (`getBestLearningDecisionForConcept`). `null` when Phase 4 has nothing actionable. */
export interface ConceptMissionLearningDecision {
  activityType: ActivityType;
  actionConceptId: string;
  learningState: LearningState;
  facts: LearningFact[];
}

export type ConceptMissionJourneySource = 'LEARNING_DECISION' | 'CANONICAL_POLICY_NO_SIGNALS';

/**
 * How the read boundary resolved the canonical learning state. The
 * builder never computes this -- it only routes it into
 * `deriveLearnerJourneyStage` (RESOLVED) or renders "unavailable".
 */
export type ConceptMissionJourneyInput =
  | { kind: 'RESOLVED'; learningState: LearningState; source: ConceptMissionJourneySource }
  | { kind: 'UNAVAILABLE' };

/** Canonical Phase 6 memory facts (`ConceptView.memory`). `null` when no concept_memory_state row exists yet. */
export interface ConceptMissionMemory {
  /** A genuine retention-success timestamp -- the only proof that RETAIN was demonstrated. */
  lastSuccessfulRetentionAt: string | null;
  retentionDue: boolean;
  memoryStatus: MemoryStatus | null;
}

export interface ConceptMissionInputs {
  conceptName: string;
  subjectId: string;
  subjectName: string;
  /**
   * A canonical stored concept description / objective, when one
   * exists. LX-3P-R1: the authoritative production schema stores no
   * such field (`concept_localizations` has only `label`), so the read
   * boundary currently always passes `null` here and the name-based
   * fallback in `buildGoal` is used. Kept as an input so a future
   * canonical objective source can supply it without a contract change.
   */
  conceptDescription: string | null;
  /** Pre-interpolated fallback goal copy (interface language). Used only when `conceptDescription` is blank. */
  goalFallbackText: string;
  knowledgeState: ConceptMissionKnowledgeState | null;
  /** How the boundary canonically resolved the journey state. See ConceptMissionJourneyInput. */
  journeyInput: ConceptMissionJourneyInput;
  /** The Phase 4 decision, for the NOW card only. `null` = NO_CANONICAL_ACTION (including on a read failure). */
  learningDecision: ConceptMissionLearningDecision | null;
  /** Canonical Phase 6 memory facts (`ConceptView.memory`). `null` when no row yet. */
  memory: ConceptMissionMemory | null;
  /** Canonical Phase 7 depth (`concept_transfer_state.transfer_depth`). `null` when no row yet. */
  transferDepth: TransferDepth | null;
  /** Whether a concept_explanations row already exists for this locale -- drives "Read" vs "Review" copy only. */
  hasCachedExplanation: boolean;
}

/* ------------------------------------------------------------------ */
/* View                                                               */
/* ------------------------------------------------------------------ */

/** The five learner-visible journey rungs. READY_TO_PROVE is a readiness flag on PROVE, not a sixth rung. */
export type ConceptMissionRung = 'LEARN' | 'PRACTICE' | 'PROVE' | 'RETAIN' | 'TRANSFER';

export type ConceptMissionMilestonePosition = 'PASSED' | 'CURRENT' | 'UPCOMING' | 'INDETERMINATE';

export type ConceptMissionDemonstratedBy =
  | 'EVIDENCE_RECORDED'
  | 'INDEPENDENT_EVIDENCE_RECORDED'
  | 'RETENTION_DEMONSTRATED'
  | 'TRANSFER_DEMONSTRATED';

export interface ConceptMissionMilestone {
  rung: ConceptMissionRung;
  /** 'INDETERMINATE' when the canonical learning state is unavailable -- the rail is shown without a "you are here". */
  position: ConceptMissionMilestonePosition;
  /** True only when a specific canonical record proves this rung was reached. Never inferred from `position`. */
  demonstrated: boolean;
  demonstratedBy: ConceptMissionDemonstratedBy | null;
  /** Present on PROVE only: the "prove it on your own" gate is open but mastery is not yet validated. */
  readyToProve?: boolean;
}

export type ConceptMissionJourney =
  | {
      status: 'RESOLVED';
      stage: LearnerJourneyStage;
      intervention: LearnerJourneyIntervention | null;
      /** Raw reason code from `deriveLearnerJourneyStage` -- the page maps it to `conceptMission.reason.*` copy. */
      reasonCode: string;
      milestones: ConceptMissionMilestone[];
      source: ConceptMissionJourneySource;
    }
  | {
      status: 'UNAVAILABLE';
      /** Why the stage cannot be shown -- honest, not a stage. */
      reason: 'LEARNING_STATE_READ_FAILED';
      milestones: ConceptMissionMilestone[];
    };

export type ConceptMissionNowKind = 'CANONICAL_ACTION' | 'NO_CANONICAL_ACTION';
export type ConceptMissionNowFallback = 'LEARN_FIRST' | 'CONSOLIDATED_NO_ACTION';

export interface ConceptMissionNow {
  kind: ConceptMissionNowKind;
  /** Verbatim from the canonical LearningDecision. `null` iff `kind === 'NO_CANONICAL_ACTION'`. The Mission never picks this. */
  activityType: ActivityType | null;
  actionConceptId: string | null;
  /** For WhyThisV3. Empty when there is no canonical decision. */
  facts: LearningFact[];
  /** Only when `kind === 'NO_CANONICAL_ACTION'`: what the screen offers instead of an activity. */
  fallback: ConceptMissionNowFallback | null;
  /**
   * Deliberately NO time estimate. LX-3E: do not invent "~N min" -- omit
   * until a real estimated-duration authority exists.
   */
}

export interface ConceptMissionGoal {
  text: string;
  source: 'CONCEPT_DESCRIPTION' | 'FALLBACK_FROM_NAME';
}

export interface ConceptMissionLearn {
  /** The explanation surface is always reachable (endpoint always resolves). */
  available: true;
  /** 'REVIEW' when an explanation is already cached for this locale, else 'READ'. Copy hint only. */
  state: 'READ' | 'REVIEW';
  /** PRIMARY_INLINE when understanding is the current job (stage LEARN / NOT_STARTED / REINFORCE, or state unavailable); else SECONDARY. */
  prominence: 'PRIMARY_INLINE' | 'SECONDARY';
}

export interface ConceptMissionView {
  identity: { conceptName: string; subjectName: string; subjectId: string };
  goal: ConceptMissionGoal;
  journey: ConceptMissionJourney;
  now: ConceptMissionNow;
  learn: ConceptMissionLearn;
  contractVersion: typeof CONCEPT_MISSION_VIEW_VERSION;
}

/* ------------------------------------------------------------------ */
/* Derivation                                                         */
/* ------------------------------------------------------------------ */

/** LX-7: exported so My Path can lay out the identical five-rung line and PASSED/CURRENT/UPCOMING split this rail uses -- one shared ordering, never a second copy. */
export const RUNG_ORDER: readonly ConceptMissionRung[] = ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'];

/** Which rung a learner-visible stage sits on. CONSOLIDATED = past the last rung. LX-7: exported for the same reason as RUNG_ORDER above. */
export function currentRungIndex(stage: LearnerJourneyStage): number {
  switch (stage) {
    case 'NOT_STARTED':
    case 'LEARN':
      return 0; // LEARN
    case 'PRACTICE':
      return 1; // PRACTICE
    case 'READY_TO_PROVE':
    case 'PROVE':
      return 2; // PROVE
    case 'RETAIN':
      return 3; // RETAIN
    case 'TRANSFER':
      return 4; // TRANSFER
    case 'CONSOLIDATED':
      return RUNG_ORDER.length; // everything behind
  }
}

/** Presence-of-canonical-record proof that a rung was reached. Never a score, never inferred from stage. */
function demonstratedFor(
  rung: ConceptMissionRung,
  inputs: ConceptMissionInputs,
): ConceptMissionDemonstratedBy | null {
  const ks = inputs.knowledgeState;
  switch (rung) {
    case 'LEARN':
    case 'PRACTICE':
      return ks && ks.evidenceCount > 0 ? 'EVIDENCE_RECORDED' : null;
    case 'PROVE':
      return ks && ks.independentEvidenceCount > 0 ? 'INDEPENDENT_EVIDENCE_RECORDED' : null;
    case 'RETAIN':
      return inputs.memory?.lastSuccessfulRetentionAt != null ? 'RETENTION_DEMONSTRATED' : null;
    case 'TRANSFER':
      return inputs.transferDepth != null && inputs.transferDepth !== 'NONE' ? 'TRANSFER_DEMONSTRATED' : null;
  }
}

/**
 * @param stage the resolved learner-visible stage, or `null` when the
 *   canonical learning state is unavailable (every rung -> INDETERMINATE,
 *   `demonstrated` still driven purely by canonical records).
 */
function buildMilestones(
  stage: LearnerJourneyStage | null,
  inputs: ConceptMissionInputs,
): ConceptMissionMilestone[] {
  const currentIdx = stage === null ? -1 : currentRungIndex(stage);
  return RUNG_ORDER.map((rung, i) => {
    const position: ConceptMissionMilestonePosition =
      stage === null
        ? 'INDETERMINATE'
        : i < currentIdx
          ? 'PASSED'
          : i === currentIdx
            ? 'CURRENT'
            : 'UPCOMING';
    const demonstratedBy = demonstratedFor(rung, inputs);
    const milestone: ConceptMissionMilestone = {
      rung,
      position,
      demonstrated: demonstratedBy != null,
      demonstratedBy,
    };
    if (rung === 'PROVE') milestone.readyToProve = stage === 'READY_TO_PROVE';
    return milestone;
  });
}

function buildGoal(inputs: ConceptMissionInputs): ConceptMissionGoal {
  const described = inputs.conceptDescription?.trim();
  if (described) return { text: described, source: 'CONCEPT_DESCRIPTION' };
  return { text: inputs.goalFallbackText, source: 'FALLBACK_FROM_NAME' };
}

function buildJourney(inputs: ConceptMissionInputs): ConceptMissionJourney {
  if (inputs.journeyInput.kind === 'UNAVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      reason: 'LEARNING_STATE_READ_FAILED',
      milestones: buildMilestones(null, inputs),
    };
  }
  const { learningState, source } = inputs.journeyInput;
  const journeyResult = deriveLearnerJourneyStage({
    learningState,
    masteryState: inputs.knowledgeState?.masteryState ?? null,
    validationReadiness: inputs.knowledgeState?.validationReadiness ?? null,
    memoryStatus: inputs.memory?.memoryStatus ?? null,
    retentionDue: inputs.memory?.retentionDue ?? false,
    transferDepth: inputs.transferDepth ?? null,
  });
  return {
    status: 'RESOLVED',
    stage: journeyResult.stage,
    intervention: journeyResult.intervention,
    reasonCode: journeyResult.reason,
    milestones: buildMilestones(journeyResult.stage, inputs),
    source,
  };
}

function buildNow(
  journey: ConceptMissionJourney,
  decision: ConceptMissionLearningDecision | null,
): ConceptMissionNow {
  if (decision) {
    return {
      kind: 'CANONICAL_ACTION',
      activityType: decision.activityType,
      actionConceptId: decision.actionConceptId,
      facts: decision.facts,
      fallback: null,
    };
  }
  const consolidated = journey.status === 'RESOLVED' && journey.stage === 'CONSOLIDATED';
  return {
    kind: 'NO_CANONICAL_ACTION',
    activityType: null,
    actionConceptId: null,
    facts: [],
    fallback: consolidated ? 'CONSOLIDATED_NO_ACTION' : 'LEARN_FIRST',
  };
}

function buildLearn(journey: ConceptMissionJourney, hasCachedExplanation: boolean): ConceptMissionLearn {
  const understandingIsTheJob =
    journey.status === 'UNAVAILABLE' ||
    journey.intervention === 'REINFORCE' ||
    journey.stage === 'LEARN' ||
    journey.stage === 'NOT_STARTED';
  return {
    available: true,
    state: hasCachedExplanation ? 'REVIEW' : 'READ',
    prominence: understandingIsTheJob ? 'PRIMARY_INLINE' : 'SECONDARY',
  };
}

/**
 * Pure. Deterministic. No I/O. Given already-fetched canonical values
 * (and a canonically-resolved `journeyInput`), returns the one
 * presentation structure the Concept Mission renders.
 */
export function buildConceptMissionView(inputs: ConceptMissionInputs): ConceptMissionView {
  const journey = buildJourney(inputs);
  return {
    identity: {
      conceptName: inputs.conceptName,
      subjectName: inputs.subjectName,
      subjectId: inputs.subjectId,
    },
    goal: buildGoal(inputs),
    journey,
    now: buildNow(journey, inputs.learningDecision),
    learn: buildLearn(journey, inputs.hasCachedExplanation),
    contractVersion: CONCEPT_MISSION_VIEW_VERSION,
  };
}
