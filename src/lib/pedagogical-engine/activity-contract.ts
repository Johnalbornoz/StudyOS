/**
 * CANON-R2 -- ActivityContractPolicy: the ONE authority that turns "what
 * stage/intervention is the learner at" into the numeric contract the
 * (existing, unmodified) generation system must honor. This module
 * NEVER decides how to generate a question, which model to call, or
 * how to grade one -- it only states the contract those systems consume
 * (Performance Firewall / Prompt Firewall -- see CANON_R2 report).
 */
import { CANONICAL_POLICY } from './policy';
import type { ActivityContract, PedagogicalStage } from './types';

function mid(min: number, max: number): number {
  return Math.round((min + max) / 2);
}

/** Pure. Deterministic. `intervention` always wins when active -- REINFORCE is an overlay, never a journey stage (see engine.ts). */
export function buildActivityContract(stage: PedagogicalStage, intervention: 'REINFORCE' | null): ActivityContract | null {
  if (intervention === 'REINFORCE') {
    const d = CANONICAL_POLICY.reinforce.difficulty;
    return {
      activityType: 'REINFORCE',
      itemCount: { min: CANONICAL_POLICY.practice.minItems, max: CANONICAL_POLICY.practice.maxItems },
      difficulty: { target: mid(d.min, d.max), min: d.min, max: d.max, reasonCode: 'REINFORCE_INTERVENTION' },
      independence: false,
      supportLevel: 'ASSISTED',
      minimumScorePercent: CANONICAL_POLICY.practice.minimumScorePercent,
      evidenceContract: 'REINFORCE_THEN_RESUME_JOURNEY',
    };
  }

  switch (stage) {
    case 'LEARN': {
      const d = CANONICAL_POLICY.learn.difficulty;
      return {
        activityType: 'LEARN_CHECK',
        itemCount: null,
        difficulty: { target: mid(d.min, d.max), min: d.min, max: d.max, reasonCode: 'LEARN_UNDERSTANDING_ONLY' },
        independence: false,
        supportLevel: 'ASSISTED',
        minimumScorePercent: null,
        evidenceContract: 'UNDERSTANDING_ONLY_NOT_MASTERY',
      };
    }
    case 'PRACTICE': {
      const p = CANONICAL_POLICY.practice;
      return {
        activityType: 'PRACTICE',
        itemCount: { min: p.minItems, max: p.maxItems },
        difficulty: { target: mid(p.difficulty.min, p.difficulty.max), min: p.difficulty.min, max: p.difficulty.max, reasonCode: 'PRACTICE_ADAPTIVE' },
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
        difficulty: { target: mid(p.difficulty.min, p.difficulty.max), min: p.difficulty.min, max: p.difficulty.max, reasonCode: 'PROVE_INDEPENDENT_DEMONSTRATION' },
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
        difficulty: { target: mid(p.difficulty.min, p.difficulty.max), min: p.difficulty.min, max: p.difficulty.max, reasonCode: 'RETENTION_COMPARABLE_TO_QUALIFYING_PROVE' },
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
        difficulty: { target: mid(p.difficulty.min, p.difficulty.max), min: p.difficulty.min, max: p.difficulty.max, reasonCode: 'TRANSFER_STRUCTURED_CHALLENGES' },
        independence: true,
        supportLevel: 'NONE',
        minimumScorePercent: p.minimumOverallScorePercent,
        evidenceContract: 'TRANSFER_NO_COMPLETE_CHALLENGE_FAILURE',
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
