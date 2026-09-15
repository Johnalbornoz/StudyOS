/**
 * CANON-R2 -- the ONE shared Evidence Qualification authority.
 *
 * "An activity was attempted" and "that attempt qualifies as evidence
 * toward a requirement" are always two separate facts (Invariant 1/2).
 * This module is the only place that ever converts a `RawEvidenceItem`
 * into a QUALIFIES / DOES_NOT_QUALIFY / UNRESOLVED verdict -- the
 * requirement state machine (`engine.ts`) never re-implements or
 * shortcuts this check.
 */
import { CANONICAL_POLICY } from './policy';
import type {
  EvidenceQualificationReasonCode,
  EvidenceQualificationResult,
  PedagogicalActivityType,
  PedagogicalStage,
  RawEvidenceItem,
} from './types';

/**
 * Which declared activity type a given stage's qualifying evidence must
 * carry. CANON-R2R1 Part 4: LEARN now requires its own dedicated
 * `LEARN_CHECK` activity -- arbitrary evidence (a Practice attempt, a
 * premature Transfer attempt, a failed Prove) can never satisfy it
 * merely by existing, superseding CANON-R2's original "any activity
 * type qualifies LEARN" behavior.
 */
const ACTIVITY_TYPE_FOR_STAGE: Partial<Record<PedagogicalStage, PedagogicalActivityType>> = {
  LEARN: 'LEARN_CHECK',
  PRACTICE: 'PRACTICE',
  PROVE: 'PROVE',
  RETAIN: 'RETENTION_CHECK',
  TRANSFER: 'TRANSFER',
};

export interface EvidenceQualificationVerdict {
  result: EvidenceQualificationResult;
  reasonCode: EvidenceQualificationReasonCode;
}

export interface QualificationContext {
  targetStage: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  /** Whether the PREREQUISITE stage is currently satisfied -- required to detect premature evidence (Invariant: premature evidence is historical only). */
  prerequisiteSatisfied: boolean;
  /** ISO timestamp this attempt must be at-or-after to be temporally eligible (RETAIN only, e.g. the qualifying Prove timestamp + minimumWaitDays). Undefined when no temporal gate applies. */
  eligibleFrom?: string;
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

/** Pure. No IO. The single entry point every requirement check must call -- never inlined ad hoc at a call site. */
export function qualifyEvidence(item: RawEvidenceItem, ctx: QualificationContext): EvidenceQualificationVerdict {
  const { targetStage, prerequisiteSatisfied, eligibleFrom } = ctx;

  const expectedActivityType = ACTIVITY_TYPE_FOR_STAGE[targetStage];
  if (expectedActivityType && item.activityType !== expectedActivityType) {
    return { result: 'DOES_NOT_QUALIFY', reasonCode: 'WRONG_ACTIVITY_TYPE' };
  }

  if (item.hasCriticalMisconception) {
    return { result: 'DOES_NOT_QUALIFY', reasonCode: 'CRITICAL_MISCONCEPTION' };
  }

  if (!prerequisiteSatisfied) {
    return { result: 'DOES_NOT_QUALIFY', reasonCode: 'PREMATURE_STAGE_EVIDENCE' };
  }

  if (eligibleFrom && new Date(item.timestamp).getTime() < new Date(eligibleFrom).getTime()) {
    return { result: 'DOES_NOT_QUALIFY', reasonCode: 'TEMPORALLY_INELIGIBLE' };
  }

  switch (targetStage) {
    case 'LEARN': {
      // CANON-R2R1 Part 3/5: a comprehension checkpoint, never mere
      // activity existence. The bar is EXCLUSIVE -- exactly 80% still
      // fails; only a score strictly greater than 80 qualifies.
      // Assistance is explicitly allowed (no independence check here).
      const p = CANONICAL_POLICY.learn;
      if (item.scorePercent <= p.minimumScorePercentExclusive) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'INSUFFICIENT_SCORE' };
      }
      return { result: 'QUALIFIES', reasonCode: 'PASSING_SCORE' };
    }

    case 'PRACTICE': {
      const p = CANONICAL_POLICY.practice;
      if (!inRange(item.difficulty, p.difficulty)) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'NOT_APPLICABLE' };
      }
      if (item.scorePercent < p.minimumScorePercent) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'INSUFFICIENT_SCORE' };
      }
      return { result: 'QUALIFIES', reasonCode: 'PASSING_SCORE' };
    }

    case 'PROVE': {
      const p = CANONICAL_POLICY.prove;
      if (p.independenceRequired && !item.independent) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'ASSISTED_WHEN_INDEPENDENCE_REQUIRED' };
      }
      if (item.itemCount !== p.itemCount) {
        return { result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' };
      }
      if (!inRange(item.difficulty, p.difficulty)) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'NOT_APPLICABLE' };
      }
      if (item.scorePercent < p.minimumScorePercent) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'FAILED_ATTEMPT' };
      }
      return { result: 'QUALIFIES', reasonCode: 'PASSING_SCORE' };
    }

    case 'RETAIN': {
      const p = CANONICAL_POLICY.retention;
      if (p.independenceRequired && !item.independent) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'ASSISTED_WHEN_INDEPENDENCE_REQUIRED' };
      }
      if (p.noveltyRequired && item.novel !== true) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'NOT_APPLICABLE' };
      }
      if (item.itemCount !== p.itemCount) {
        return { result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' };
      }
      if (!inRange(item.difficulty, p.difficulty)) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'NOT_APPLICABLE' };
      }
      if (item.scorePercent < p.minimumScorePercent) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'FAILED_ATTEMPT' };
      }
      return { result: 'QUALIFIES', reasonCode: 'PASSING_SCORE' };
    }

    case 'TRANSFER': {
      const p = CANONICAL_POLICY.transfer;
      if (p.independenceRequired && !item.independent) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'ASSISTED_WHEN_INDEPENDENCE_REQUIRED' };
      }
      if (!inRange(item.difficulty, p.difficulty)) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'NOT_APPLICABLE' };
      }
      if (!item.perChallengeScores || item.perChallengeScores.length !== p.challengeCount) {
        return { result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' };
      }
      if (item.reasoningProvided === false) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'MISSING_REQUIRED_REASONING' };
      }
      // CANON-R2R1 Part 1: FINAL product decision, superseding the
      // implementation-created <50% floor. Every challenge must
      // independently reach 70% -- no compensation by a stronger
      // challenge elsewhere -- AND the overall average independently
      // meets 80%. Neither check alone is sufficient (the spec's own
      // 100/75/70 example: overall 81.67% >= 80 AND every challenge
      // >= 70% -> PASS; a 70/70/70 ledger meets the per-challenge floor
      // but its 70% overall average still FAILS).
      const hasChallengeBelowFloor = item.perChallengeScores.some((s) => s < p.perChallengeMinimumScorePercent);
      const overall = item.perChallengeScores.reduce((a, b) => a + b, 0) / item.perChallengeScores.length;
      if (hasChallengeBelowFloor || overall < p.minimumOverallScorePercent) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'FAILED_ATTEMPT' };
      }
      return { result: 'QUALIFIES', reasonCode: 'PASSING_SCORE' };
    }

    default: {
      const _exhaustive: never = targetStage;
      return _exhaustive;
    }
  }
}
