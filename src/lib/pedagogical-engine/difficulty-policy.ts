/**
 * CANON-R2R1 Part 9-17 -- DifficultyPolicy: the ONE authority that
 * derives a stage's `targetDifficulty` from learner EVIDENCE, never a
 * static stage-only midpoint. This is the direct successor to CANON-R2's
 * `activity-contract.ts::mid(min,max)` behavior, which was necessary
 * (canonical ranges) but not sufficient (no evidence sensitivity) --
 * see the CANON-R2R1 report's DIFFICULTY POLICY section for the worked
 * before/after example.
 *
 * Every function here is pure: given already-extracted evidence facts
 * (never the raw ledger or IO), it returns a `{target, reasonCode}` pair
 * from the closed `DifficultyReasonCode` vocabulary (types.ts) -- a
 * consumer (and this module's own tests) can always tell WHY a target
 * was chosen, never just what it is.
 */
import { CANONICAL_POLICY } from './policy';
import type { DifficultyReasonCode, RawEvidenceItem } from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface DifficultyResolution {
  target: number;
  reasonCode: DifficultyReasonCode;
}

/**
 * CANON-R2R1 Part 10-13 -- the centralized, deterministic Practice
 * evidence-selection rule: walk EVERY Practice-activity-type item in
 * chronological order (regardless of whether it independently qualifies
 * the PRACTICE *requirement* -- difficulty policy and requirement
 * qualification are separate concerns, Part 9), applying one of four
 * adjustments per item:
 *   - a critical misconception on the attempt, OR a score below 60%:
 *     decrease by one level (floor 2) -- Part 12 groups these together.
 *   - a score in [60,80): maintain the administered level.
 *   - a score >=80 (qualifying): increase by one level (ceiling 4), or
 *     report MAINTAINED when already at the ceiling (Part 10's own "D4
 *     PASS -> remain D4" example).
 * The FINAL item's outcome is the running target -- "recently
 * demonstrated," not a lifetime average (Part 13). With no Practice
 * evidence at all, the default is the policy's own floor (2).
 */
export function resolvePracticeDifficulty(practiceItemsInOrder: RawEvidenceItem[]): DifficultyResolution {
  const policy = CANONICAL_POLICY.practice;
  let target = policy.difficulty.min;
  let reasonCode: DifficultyReasonCode = 'PRACTICE_DEFAULT_DIFFICULTY';

  for (const item of practiceItemsInOrder) {
    const administered = clamp(item.difficulty, policy.difficulty.min, policy.difficulty.max);
    if (item.hasCriticalMisconception) {
      target = Math.max(policy.difficulty.min, administered - 1);
      reasonCode = 'PRACTICE_MISCONCEPTION_REINFORCEMENT';
    } else if (item.scorePercent >= policy.minimumScorePercent) {
      const increased = Math.min(policy.difficulty.max, administered + 1);
      target = increased;
      reasonCode = increased === administered ? 'PRACTICE_DIFFICULTY_MAINTAINED' : 'PRACTICE_SUCCESS_DIFFICULTY_INCREASE';
    } else if (item.scorePercent >= 60) {
      target = administered;
      reasonCode = 'PRACTICE_DIFFICULTY_MAINTAINED';
    } else {
      target = Math.max(policy.difficulty.min, administered - 1);
      reasonCode = 'PRACTICE_LOW_PERFORMANCE_DIFFICULTY_DECREASE';
    }
  }

  return { target, reasonCode };
}

/**
 * CANON-R2R1 Part 14 -- Prove's target is the highest difficulty the
 * learner has sustained through QUALIFYING Practice evidence (never an
 * isolated lucky response -- qualification already requires >=80% and
 * no misconception), clamped into Prove's own [3,4] range. D2 -> 3,
 * D3 -> 3, D4 -> 4 (the spec's own three worked examples fall directly
 * out of this one clamp). With no qualifying Practice evidence yet,
 * defaults to Prove's floor (3).
 */
export function resolveProveDifficulty(highestQualifyingPracticeDifficulty: number | null): DifficultyResolution {
  const policy = CANONICAL_POLICY.prove;
  const target =
    highestQualifyingPracticeDifficulty == null
      ? policy.difficulty.min
      : clamp(highestQualifyingPracticeDifficulty, policy.difficulty.min, policy.difficulty.max);
  return { target, reasonCode: 'PROVE_DIFFICULTY_FROM_QUALIFYING_PRACTICE' };
}

/**
 * CANON-R2R1 Part 15 -- Retention must test at a difficulty comparable
 * to the Prove that opened its current window -- never a generic stage
 * default. `qualifyingProveDifficulty` is the difficulty ACTUALLY
 * administered on that specific qualifying Prove attempt (already
 * inside [3,4] by Prove's own qualification rule); clamped again here
 * only as a defensive measure, never as the primary source of the value.
 */
export function resolveRetentionDifficulty(qualifyingProveDifficulty: number | null): DifficultyResolution {
  const policy = CANONICAL_POLICY.retention;
  const target =
    qualifyingProveDifficulty == null
      ? policy.difficulty.min
      : clamp(qualifyingProveDifficulty, policy.difficulty.min, policy.difficulty.max);
  return { target, reasonCode: 'RETENTION_MATCHES_QUALIFYING_PROVE_DIFFICULTY' };
}

/**
 * CANON-R2R1 Part 16 -- Transfer defaults to the base of its range (4);
 * target 5 is never automatic merely because the stage is Transfer.
 * Documented CANON-R2R1 policy decision for what "evidence supports a
 * higher challenge" means concretely: the qualifying Prove reached
 * Prove's own ceiling (4, i.e. strength/consistency at the hardest Prove
 * level) AND the qualifying Retention score was strong (>=90%) AND no
 * critical misconception is currently active. Any one of those failing
 * keeps Transfer at its base difficulty.
 */
export function resolveTransferDifficulty(params: {
  qualifyingProveDifficulty: number | null;
  qualifyingRetentionScore: number | null;
  activeCriticalMisconception: boolean;
}): DifficultyResolution {
  const policy = CANONICAL_POLICY.transfer;
  const provePeak = params.qualifyingProveDifficulty === CANONICAL_POLICY.prove.difficulty.max;
  const retentionStrong = params.qualifyingRetentionScore != null && params.qualifyingRetentionScore >= 90;
  if (!params.activeCriticalMisconception && provePeak && retentionStrong) {
    return { target: policy.difficulty.max, reasonCode: 'TRANSFER_ADVANCED_DIFFICULTY_SUPPORTED' };
  }
  return { target: policy.difficulty.min, reasonCode: 'TRANSFER_BASE_DIFFICULTY' };
}

/**
 * CANON-R2R1 Part 17 -- REINFORCE's difficulty must be derived from the
 * blocking evidence, never a fixed/random number. Documented CANON-R2R1
 * policy decision: one level below the learner's own current Practice
 * difficulty trend (the same trend `resolvePracticeDifficulty` already
 * computes), clamped into REINFORCE's own [1,3] range -- a concrete,
 * deterministic step back for remediation, grounded in the same evidence
 * already driving Practice.
 */
export function resolveReinforceDifficulty(practiceTarget: number): DifficultyResolution {
  const policy = CANONICAL_POLICY.reinforce;
  const target = clamp(practiceTarget - 1, policy.difficulty.min, policy.difficulty.max);
  return { target, reasonCode: 'REINFORCE_DERIVED_FROM_PRACTICE_GAP' };
}

/** LEARN's own difficulty is not evidence-driven by this phase's spec -- a fixed policy midpoint, matching CANON-R2's original behavior. */
export function resolveLearnDifficulty(): DifficultyResolution {
  const policy = CANONICAL_POLICY.learn;
  return { target: Math.round((policy.difficulty.min + policy.difficulty.max) / 2), reasonCode: 'LEARN_UNDERSTANDING_ONLY' };
}
