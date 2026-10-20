/**
 * B2-A -- exposure policy per pool (pure).
 *
 * Exposure stays a per-Student fact supplied by the caller (`ExposureFacts`). What changes with the pool
 * is the RULE:
 *   PREFER_UNSEEN             the existing behaviour: a strong preference, never an exclusion (Practice)
 *   HARD_EXCLUDE_IF_EXPOSED   an item the Student has been delivered before is not a candidate at all
 *                             (Diagnostic, Verification, Reduced Mock, Full Mock 1, Full Mock 2)
 *
 * The rule is chosen by the blueprint's pool, so nothing changes for selections that do not go through a
 * protected pool. Exposure of a stimulus group is the group's (B2-B2): any of its questions delivered, in any
 * version, exposes the whole set -- derived in `selection-unit` from the same per-item facts plus the stimuli
 * the delivery ledger shows the Student has met. Exposure by answer reveal is carried as an optional fact
 * that no source fills yet.
 */
import type { ExposureFacts } from '../solver/candidate';
import { PROTECTED_POOLS, type LogicalPool } from './pools';

export const EXPOSURE_RULES = ['PREFER_UNSEEN', 'HARD_EXCLUDE_IF_EXPOSED'] as const;
export type ExposureRule = (typeof EXPOSURE_RULES)[number];

export interface ExposurePolicy {
  id: string;
  version: string;
  rules: Record<LogicalPool, ExposureRule>;
}

export const PILOT_EXPOSURE_POLICY: ExposurePolicy = {
  id: 'b2-pilot-exposure',
  version: '1',
  rules: { PRACTICE: 'PREFER_UNSEEN', DIAGNOSTIC: 'HARD_EXCLUDE_IF_EXPOSED', VERIFICATION: 'HARD_EXCLUDE_IF_EXPOSED', REDUCED_MOCK: 'HARD_EXCLUDE_IF_EXPOSED', FULL_MOCK_1: 'HARD_EXCLUDE_IF_EXPOSED', FULL_MOCK_2: 'HARD_EXCLUDE_IF_EXPOSED' },
};

/** A protected pool may never be configured with a soft rule. */
export function exposurePolicyViolations(policy: ExposurePolicy): LogicalPool[] {
  return [...PROTECTED_POOLS].filter((p) => policy.rules[p] !== 'HARD_EXCLUDE_IF_EXPOSED').sort();
}

/** No source records that an answer was revealed to a Student. Delivery already counts as exposure. */
export const ANSWER_REVEAL_EXPOSURE = 'DEFERRED' as const;

/** Exposure of an item for protected selection. `answerRevealed` is null until a source records it. */
export interface ProtectedExposureFacts extends ExposureFacts {
  answerRevealed?: boolean | null;
}

export type ExposureRejection = 'EXPOSED_TO_STUDENT' | 'ANSWER_REVEALED_TO_STUDENT';

export function exposureVerdict(facts: ProtectedExposureFacts | undefined, rule: ExposureRule): { allowed: true } | { allowed: false; reason: ExposureRejection } {
  if (rule !== 'HARD_EXCLUDE_IF_EXPOSED' || !facts) return { allowed: true };
  if (facts.answerRevealed === true) return { allowed: false, reason: 'ANSWER_REVEALED_TO_STUDENT' };
  if (facts.seen) return { allowed: false, reason: 'EXPOSED_TO_STUDENT' };
  return { allowed: true };
}
