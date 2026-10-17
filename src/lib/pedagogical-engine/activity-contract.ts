/**
 * CANON-R2 / CANON-R2R1 -- ActivityContractPolicy: the ONE authority
 * that turns "what stage/intervention is the learner at, plus their
 * evidence-derived difficulty" into the contract the (existing,
 * unmodified) generation system must honor. This module NEVER decides
 * how to generate a question, which model to call, or how to grade one
 * -- it only states the contract those systems consume (Performance
 * Firewall / Prompt Firewall -- see the CANON-R2/CANON-R2R1 reports).
 *
 * CANON-R2R1 Part 18: difficulty is no longer computed here as a static
 * stage-only midpoint -- the caller (`engine.ts`) resolves it from
 * evidence via `difficulty-policy.ts` and passes the resolution in. This
 * module's own job stays unchanged: item counts, independence,
 * support level, minimum score, and the evidence contract label.
 */
import { CANONICAL_POLICY } from './policy';
import type { ActivityContract, DifficultyReasonCode, PedagogicalStage } from './types';
import type { DifficultyResolution } from './difficulty-policy';
import { practiceMixForItemCount } from './difficulty-policy';

/** D78 -- the Practice exposure decision the caller resolved from evidence (PRACTICE / REINFORCE only). */
export interface PracticeExposureDecision {
  plusOneEligible: boolean;
  reasonCode: DifficultyReasonCode;
}

/** Pure. Deterministic. `intervention` always wins when active -- REINFORCE is an overlay, never a journey stage (see engine.ts). `difficulty` is always the caller's already-resolved, evidence-driven decision -- this function never derives one of its own. */
export function buildActivityContract(
  stage: PedagogicalStage,
  intervention: 'REINFORCE' | null,
  difficulty: DifficultyResolution,
  practiceExposure: PracticeExposureDecision | null = null,
): ActivityContract | null {
  if (intervention !== 'REINFORCE' && stage === 'CONSOLIDATED') return null;

  const d = CANONICAL_POLICY[intervention === 'REINFORCE' ? 'reinforce' : stageDifficultyKey(stage)].difficulty;
  const difficultyDecision = { target: difficulty.target, min: d.min, max: d.max, reasonCode: difficulty.reasonCode };

  // D78: the mix is sized for the AUTHORIZED item count (resolveAuthorizedItemCount = itemCount.max).
  if (intervention === 'REINFORCE') {
    return {
      activityType: 'REINFORCE',
      itemCount: { min: CANONICAL_POLICY.practice.minItems, max: CANONICAL_POLICY.practice.maxItems },
      // REINFORCE is all at its target (= the current Practice base): never a +1 item.
      practiceMix: practiceMixForItemCount(difficulty.target, false, CANONICAL_POLICY.practice.maxItems, 'PRACTICE_EXPOSURE_SUPPRESSED'),
      difficulty: difficultyDecision,
      independence: false,
      supportLevel: 'ASSISTED',
      minimumScorePercent: CANONICAL_POLICY.practice.minimumScorePercent,
      evidenceContract: 'REINFORCE_THEN_RESUME_JOURNEY',
    };
  }

  switch (stage) {
    case 'LEARN':
      return {
        activityType: 'LEARN_CHECK',
        // Contract 1.1: a guided session of 4-7 interactions (the AI closes between 4 and 7; the cap is 7). There is
        // no score gate, so `minimumScorePercent` is null. A launcher that needs ONE count (resolveAuthorizedItemCount)
        // gets `max` = 7, the session cap.
        itemCount: { min: CANONICAL_POLICY.learn.minInteractions, max: CANONICAL_POLICY.learn.maxInteractions },
        difficulty: difficultyDecision,
        independence: false,
        supportLevel: 'ASSISTED',
        minimumScorePercent: null,
        evidenceContract: 'LEARN_GUIDED_UNDERSTANDING_4_TO_7_NO_SCORE_GATE',
      };
    case 'PRACTICE': {
      const p = CANONICAL_POLICY.practice;
      return {
        activityType: 'PRACTICE',
        itemCount: { min: p.minItems, max: p.maxItems },
        difficulty: difficultyDecision,
        independence: false,
        supportLevel: 'ASSISTED',
        minimumScorePercent: p.minimumScorePercent,
        evidenceContract: 'PRACTICE_ESTABLISHED_CHALLENGE',
        practiceMix: practiceMixForItemCount(
          difficulty.target,
          practiceExposure?.plusOneEligible ?? false,
          p.maxItems,
          practiceExposure?.reasonCode ?? 'PRACTICE_EXPOSURE_NONE',
        ),
      };
    }
    case 'PROVE': {
      const p = CANONICAL_POLICY.prove;
      return {
        activityType: 'PROVE',
        itemCount: { min: p.itemCount, max: p.itemCount },
        difficulty: difficultyDecision,
        independence: true,
        supportLevel: 'NONE',
        minimumScorePercent: p.minimumScorePercent,
        evidenceContract: 'PROVE_NO_HINTS_NO_TUTOR_NO_WORKED_EXAMPLES',
      };
    }
    case 'RETAIN': {
      const p = CANONICAL_POLICY.retention;
      return {
        activityType: 'RETENTION_CHECK',
        itemCount: { min: p.itemCount, max: p.itemCount },
        difficulty: difficultyDecision,
        independence: true,
        supportLevel: 'NONE',
        minimumScorePercent: p.minimumScorePercent,
        evidenceContract: 'RETENTION_NOVEL_ITEMS_AFTER_MINIMUM_WAIT',
        noveltyRequirements: 'NOVEL_ITEMS_REQUIRED',
      };
    }
    case 'TRANSFER': {
      const p = CANONICAL_POLICY.transfer;
      return {
        activityType: 'TRANSFER',
        // Contract 1.2: an adaptive ladder of 3-5 challenges over NEAR/MID/FAR; each challenge passes at >= 80.
        itemCount: { min: p.minChallenges, max: p.maxChallenges },
        difficulty: difficultyDecision,
        independence: true,
        supportLevel: 'NONE',
        minimumScorePercent: p.perChallengePassPercent,
        evidenceContract: 'TRANSFER_ADAPTIVE_LADDER_3_TO_5_PER_CHALLENGE_80',
        transferDepth: [...p.levels],
      };
    }
    case 'CONSOLIDATED':
      return null;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

function stageDifficultyKey(stage: PedagogicalStage): 'learn' | 'practice' | 'prove' | 'retention' | 'transfer' | 'reinforce' {
  switch (stage) {
    case 'LEARN':
      return 'learn';
    case 'PRACTICE':
      return 'practice';
    case 'PROVE':
      return 'prove';
    case 'RETAIN':
      return 'retention';
    case 'TRANSFER':
      return 'transfer';
    case 'CONSOLIDATED':
      // CONSOLIDATED never reaches the difficulty lookup (buildActivityContract
      // returns null for it before any contract is built) -- 'reinforce' is
      // an arbitrary but harmless placeholder to keep this function total.
      return 'reinforce';
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}
