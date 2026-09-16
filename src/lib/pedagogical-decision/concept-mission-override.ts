/**
 * CANON-R5 Part 10 -- CONCEPT MISSION canonical override.
 *
 * `overrideConceptMissionViewWithCanonicalDecision` takes an ALREADY-BUILT
 * legacy `ConceptMissionView` (computed exactly as before -- Part 3: the
 * old model stays available "for comparison; diagnostics; rollback
 * safety") and replaces ONLY its `journey`/`now`/`learn` fields with
 * equivalents derived exclusively from a fresh `CanonicalPedagogicalDecision`
 * -- never from `activity existence / history count / old masteryState /
 * old validationReadiness` (Part 10's own explicit prohibition).
 * `identity`/`goal`/`contractVersion` are untouched (they are not
 * "next pedagogical action" -- Part 2 does not reach them).
 *
 * Deliberately does NOT modify `buildConceptMissionView` or its pure
 * builder file -- this is a separate, additive, POST-HOC authority
 * override at the read-boundary-service layer, so the legacy pure
 * builder stays byte-for-byte reusable for the feature-gate-off path and
 * for old/new diagnostic comparison (Part 27).
 *
 * Checkmarks: `decision.requirements[].status === 'SATISFIED'` ONLY.
 * Current location: `decision.stage` ONLY. Every `PedagogicalStage`
 * literal (`LEARN|PRACTICE|PROVE|RETAIN|TRANSFER|CONSOLIDATED`) is
 * already a member of `LearnerJourneyStage`, so no separate stage-name
 * translation table is needed or introduced.
 */
import type { CanonicalPedagogicalDecision, PedagogicalActivityType } from '@/lib/pedagogical-engine';
import {
  RUNG_ORDER,
  currentRungIndex,
  type ConceptMissionView,
  type ConceptMissionJourney,
  type ConceptMissionMilestone,
  type ConceptMissionDemonstratedBy,
  type ConceptMissionNow,
  type ConceptMissionLearn,
  type ConceptMissionRung,
} from '@/lib/lx/concept-mission';
import type { ActivityType } from '@/lib/activity-taxonomy';
import { resolveV1ActivityLaunchReadiness } from './activity-launch-readiness';

const DEMONSTRATED_BY_FOR_RUNG: Record<ConceptMissionRung, ConceptMissionDemonstratedBy> = {
  LEARN: 'EVIDENCE_RECORDED',
  PRACTICE: 'EVIDENCE_RECORDED',
  PROVE: 'INDEPENDENT_EVIDENCE_RECORDED',
  RETAIN: 'RETENTION_DEMONSTRATED',
  TRANSFER: 'TRANSFER_DEMONSTRATED',
};

function buildCanonicalMilestones(decision: CanonicalPedagogicalDecision): ConceptMissionMilestone[] {
  const currentIdx = currentRungIndex(decision.stage);
  return RUNG_ORDER.map((rung, i) => {
    const requirement = decision.requirements.find((r) => r.stage === rung);
    const satisfied = requirement?.status === 'SATISFIED';
    const position = i < currentIdx ? 'PASSED' : i === currentIdx ? 'CURRENT' : 'UPCOMING';
    return {
      rung,
      position,
      demonstrated: satisfied,
      demonstratedBy: satisfied ? DEMONSTRATED_BY_FOR_RUNG[rung] : null,
    } satisfies ConceptMissionMilestone;
  });
}

/**
 * Presentation-only copy hint (the exact same `conceptMission.reason.*`
 * i18n vocabulary the legacy path already renders -- `ConceptMission.tsx`
 * looks the key up and falls back to `''` for anything unrecognized, so
 * an imperfect match here degrades to no subtitle, never a crash or
 * wrong translation). Never influences `journey.stage`, milestones, or
 * `now` -- those come from `decision` alone.
 */
function mapReasonCode(decision: CanonicalPedagogicalDecision): string {
  if (decision.intervention === 'REINFORCE') {
    return decision.rollback?.case === 'TRANSFER_CASE_D_CRITICAL_MISCONCEPTION' ? 'ACTIVE_MISCONCEPTION' : 'REPAIR_IN_PROGRESS';
  }
  switch (decision.stage) {
    case 'LEARN':
      return 'NO_KNOWLEDGE_STATE';
    case 'PRACTICE':
      return 'BUILDING_EVIDENCE';
    case 'PROVE':
      return 'EVIDENCE_SUFFICIENT_NOT_YET_VALIDATED';
    case 'RETAIN':
      return 'RETENTION_DUE';
    case 'TRANSFER':
      return 'TRANSFER_REQUIRED';
    case 'CONSOLIDATED':
      return 'VALIDATED_MASTERY';
    default: {
      const _exhaustive: never = decision.stage;
      return _exhaustive;
    }
  }
}

function buildCanonicalJourney(decision: CanonicalPedagogicalDecision): ConceptMissionJourney {
  return {
    status: 'RESOLVED',
    stage: decision.stage,
    intervention: decision.intervention,
    reasonCode: mapReasonCode(decision),
    milestones: buildCanonicalMilestones(decision),
    source: 'CANONICAL_ENGINE_V1',
  };
}

/**
 * PRACTICE, the REINFORCE overlay, and (as of CANON-R6) PROVE reach a
 * real v1 launch today (activity-launch-readiness.ts). PRACTICE/REINFORCE
 * present as the existing 'PRACTICE' ActivityType (the same shape
 * REINFORCE already rendered pre-CANON-R5); PROVE presents as
 * 'SOLO_CHECK' -- the SAME legacy ActivityType `quick_check` already
 * uses for an independent check, and the SAME mapping CANON-R3's own
 * evidence adapter already treats as PROVE's real-world analog. Never
 * hardcoded to 'PRACTICE' regardless of the real activity, which would
 * mislabel a genuine independent Prove CTA as an assisted Practice one.
 */
function toLegacyActivityType(activityType: PedagogicalActivityType | 'REINFORCE'): ActivityType {
  return activityType === 'PROVE' ? 'SOLO_CHECK' : 'PRACTICE';
}

function buildCanonicalNow(decision: CanonicalPedagogicalDecision): ConceptMissionNow {
  if (decision.actionState === 'WAITING') {
    return { kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, facts: [], fallback: 'RETENTION_WAITING', nextEligibleReviewAt: decision.nextEligibleAt };
  }
  if (decision.actionState === 'CONSOLIDATED') {
    return { kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, facts: [], fallback: 'CONSOLIDATED_NO_ACTION', nextEligibleReviewAt: null };
  }
  if (decision.actionState === 'LOCKED' || decision.actionState === 'BLOCKED') {
    return { kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, facts: [], fallback: 'CANONICAL_ACTION_UNAVAILABLE', nextEligibleReviewAt: null };
  }

  // actionState === 'EXECUTABLE'.
  const activityType = decision.intervention === 'REINFORCE' ? 'REINFORCE' : decision.activityContract?.activityType;
  if (!activityType || !resolveV1ActivityLaunchReadiness(activityType).ready) {
    // Either no contract at all (should not occur for EXECUTABLE), or a
    // real v1 activity the existing generation infra cannot yet honor
    // (Prove/Retention exact-10, Transfer's 3-challenge structure,
    // LEARN_CHECK) -- Part 18/33's own "never silently fall back to a
    // legacy activity" rule, applied here to presentation as well as to
    // session start.
    return { kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, facts: [], fallback: 'CANONICAL_ACTION_UNAVAILABLE', nextEligibleReviewAt: null };
  }

  return {
    kind: 'CANONICAL_ACTION',
    activityType: toLegacyActivityType(activityType),
    actionConceptId: decision.conceptId,
    facts: [],
    fallback: null,
    nextEligibleReviewAt: null,
  };
}

function buildCanonicalLearn(decision: CanonicalPedagogicalDecision, hasCachedExplanation: boolean): ConceptMissionLearn {
  const understandingIsTheJob = decision.intervention === 'REINFORCE' || decision.stage === 'LEARN';
  return {
    available: true,
    state: hasCachedExplanation ? 'REVIEW' : 'READ',
    prominence: understandingIsTheJob ? 'PRIMARY_INLINE' : 'SECONDARY',
  };
}

/**
 * `view` must already be the fully-built legacy view (Part 3: computed
 * for diagnostics regardless of the feature gate). Returns a NEW view
 * object; `view` itself is never mutated.
 */
export function overrideConceptMissionViewWithCanonicalDecision(
  view: ConceptMissionView,
  decision: CanonicalPedagogicalDecision,
): ConceptMissionView {
  const hasCachedExplanation = view.learn.state === 'REVIEW';
  return {
    ...view,
    journey: buildCanonicalJourney(decision),
    now: buildCanonicalNow(decision),
    learn: buildCanonicalLearn(decision, hasCachedExplanation),
  };
}
