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
import { CANONICAL_POLICY, type TransferLevel } from './policy';
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

/** Contract 1.2: ladder level rank (NEAR 0, MID 1, FAR 2); -1 for no level. Read from the one policy list. */
export function transferLevelRank(level: TransferLevel | null | undefined): number {
  return level ? CANONICAL_POLICY.transfer.levels.indexOf(level) : -1;
}

/** Whether `level` is at least `minimum` on the ladder (`null` never is). */
export function meetsTransferLevel(level: TransferLevel | null | undefined, minimum: TransferLevel): boolean {
  return level != null && transferLevelRank(level) >= transferLevelRank(minimum);
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

  // Contract 1.3: an INTERNAL_ASSESSMENT item is never the activity type of any stage, so it is always
  // WRONG_ACTIVITY_TYPE above -- it never satisfies a stage. Its revalidation effect lives in engine.ts's replay.
  switch (targetStage) {
    case 'LEARN': {
      // Contract 1.1 (2026-10-16): LEARN is a guided understanding session of 4-7 interactions with NO score gate.
      // Assistance is explicitly allowed (no independence check). Anything that is neither a well-formed guided
      // session nor a completed legacy check is UNRESOLVED -- never a pass, never a failure.
      const p = CANONICAL_POLICY.learn;
      const isGuidedSession = item.learnInteractionCount !== undefined || item.learnClosedBy !== undefined;
      if (isGuidedSession) {
        const n = item.learnInteractionCount;
        if (n === undefined || !Number.isInteger(n) || n < p.minInteractions || n > p.maxInteractions) {
          return { result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' };
        }
        // AI closes once it judges understanding (any count from 4 to 7); CAP closes only at exactly 7.
        if (item.learnClosedBy === 'AI' && n >= p.minInteractions) return { result: 'QUALIFIES', reasonCode: 'LEARN_COMPLETED' };
        if (item.learnClosedBy === 'CAP' && n === p.maxInteractions) return { result: 'QUALIFIES', reasonCode: 'LEARN_COMPLETED' };
        return { result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' };
      }
      // Legacy LEARN_CHECK quiz row (no learnSession): qualifies once completed with >= minInteractions items; its
      // score no longer gates. A row with fewer (or an unknown, 0) item count is UNRESOLVED.
      if (item.itemCount >= p.minInteractions) return { result: 'QUALIFIES', reasonCode: 'LEARN_COMPLETED' };
      return { result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' };
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
      // Contract 1.2 (2026-10-16): the adaptive APPLY ladder. The 70% per-challenge floor and the 80% overall mean are
      // retired -- a challenge passes at >= 80 (already folded into `transferHighestLevel` by the adapter), and only
      // the highest passed AND certified level decides. A critical misconception was already handled above (Case D).
      const p = CANONICAL_POLICY.transfer;
      if (p.independenceRequired && !item.independent) {
        return { result: 'DOES_NOT_QUALIFY', reasonCode: 'ASSISTED_WHEN_INDEPENDENCE_REQUIRED' };
      }
      // A legacy 3-challenge NEAR/CONTEXTUAL/HIGHER row (or any row without a ladder): UNRESOLVED -- no
      // qualification, no rollback, and never a CONTEXTUAL/HIGHER -> MID/FAR mapping.
      if (!Array.isArray(item.transferLadder)) {
        return { result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' };
      }
      if (meetsTransferLevel(item.transferHighestLevel ?? null, p.consolidatedMinimumLevel)) {
        return { result: 'QUALIFIES', reasonCode: 'TRANSFER_LEVEL_REACHED' };
      }
      // NEAR or nothing: does not qualify, but this is NOT a FAILED_ATTEMPT (no rollback; the concept stays in TRANSFER).
      return { result: 'DOES_NOT_QUALIFY', reasonCode: 'TRANSFER_LEVEL_BELOW_CONSOLIDATION' };
    }

    default: {
      const _exhaustive: never = targetStage;
      return _exhaustive;
    }
  }
}
