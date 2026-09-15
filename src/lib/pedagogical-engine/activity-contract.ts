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
import type { ActivityContract, PedagogicalStage } from './types';
import type { DifficultyResolution } from './difficulty-policy';

/** Pure. Deterministic. `intervention` always wins when active -- REINFORCE is an overlay, never a journey stage (see engine.ts). `difficulty` is always the caller's already-resolved, evidence-driven decision -- this function never derives one of its own. */
export function buildActivityContract(
  stage: PedagogicalStage,
  intervention: 'REINFORCE' | null,
  difficulty: DifficultyResolution,
): ActivityContract | null {
  if (intervention !== 'REINFORCE' && stage === 'CONSOLIDATED') return null;

  const d = CANONICAL_POLICY[intervention === 'REINFORCE' ? 'reinforce' : stageDifficultyKey(stage)].difficulty;
  const difficultyDecision = { target: difficulty.target, min: d.min, max: d.max, reasonCode: difficulty.reasonCode };

  if (intervention === 'REINFORCE') {
    return {
      activityType: 'REINFORCE',
      itemCount: { min: CANONICAL_POLICY.practice.minItems, max: CANONICAL_POLICY.practice.maxItems },
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
        // No canonical item-count authority exists for the comprehension
        // check -- never an invented number (matches this codebase's
        // established "UNRESOLVED, not a manufactured count" principle,
        // e.g. evidence-sufficiency-contract.ts).
        itemCount: null,
        difficulty: difficultyDecision,
        independence: false,
        supportLevel: 'ASSISTED',
        minimumScorePercent: CANONICAL_POLICY.learn.minimumScorePercentExclusive,
        evidenceContract: 'LEARN_COMPREHENSION_CHECK_SCORE_EXCLUSIVE_ABOVE_80',
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
        itemCount: { min: p.challengeCount, max: p.challengeCount },
        difficulty: difficultyDecision,
        independence: true,
        supportLevel: 'NONE',
        minimumScorePercent: p.minimumOverallScorePercent,
        evidenceContract: 'TRANSFER_NO_COMPLETE_CHALLENGE_FAILURE_EACH_CHALLENGE_MIN_70',
        transferDepth: [...p.depths],
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
