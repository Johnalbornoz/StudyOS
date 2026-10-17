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
import type { DifficultyReasonCode, PracticeExposure, PracticeMix, ProveMix, RawEvidenceItem } from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface DifficultyResolution {
  target: number;
  reasonCode: DifficultyReasonCode;
}

/**
 * D78 (operator decisions 2026-10-17 + refinement D78A) -- Practice BASE level and bounded +1
 * exposure.
 *  - The persistent base starts at Practice's floor (2) and never exceeds PRACTICE_MAX_BASE (3).
 *  - The base rises by +1 ONLY after a Practice session that scored >= 80 with no critical
 *    misconception AND already included the base+1 exposure item AND that item was answered
 *    correct (D78A). A correct level-4 item at base 3 never makes the base 4.
 *  - Nothing lowers the earned base: a < 60 score or a critical misconception only suppresses
 *    the next session's +1 exposure (and REINFORCE then targets the current base).
 *  - Legacy rows (no `practiceExposure`) carry no exposure (never a rise); their administered
 *    difficulty IS that session's base (clamped [2,3]). History is never rewritten.
 *  - The walk is monotone (max): no row -- legacy or new -- ever lowers the earned base.
 *  - Strong signal (unchanged, the existing one): the LATEST Practice attempt >= minimumScorePercent
 *    (80) with no critical misconception -> the next session carries one base+1 item.
 */
export const PRACTICE_MAX_BASE = 3;

export interface PracticeBaseResolution extends DifficultyResolution {
  /** The earned persistent base (= `target`, kept for compatibility with every `difficulty.target` consumer). */
  base: number;
  exposure: { plusOneEligible: boolean; plusOneLevel: number | null; reasonCode: DifficultyReasonCode };
}

/** The base a single Practice evidence row was administered at (exposure-aware; legacy = its administered difficulty). */
export function practiceSessionBaseLevel(item: Pick<RawEvidenceItem, 'difficulty' | 'practiceExposure'>): number {
  const floor = CANONICAL_POLICY.practice.difficulty.min;
  const raw = item.practiceExposure ? item.practiceExposure.baseLevel : item.difficulty;
  return clamp(Math.round(raw), floor, PRACTICE_MAX_BASE);
}

/** Whether this row earned a base rise: >= 80, no critical misconception, a base+1 item served and every one of them correct. */
export function practiceSessionEarnedRise(item: Pick<RawEvidenceItem, 'scorePercent' | 'hasCriticalMisconception' | 'practiceExposure'>): boolean {
  const x = item.practiceExposure;
  if (!x || item.hasCriticalMisconception) return false;
  if (item.scorePercent < CANONICAL_POLICY.practice.minimumScorePercent) return false;
  return x.plusOneItems > 0 && x.plusOneCorrect >= x.plusOneItems;
}

export function resolvePracticeBase(practiceItemsInOrder: RawEvidenceItem[]): PracticeBaseResolution {
  const policy = CANONICAL_POLICY.practice;
  let base = policy.difficulty.min;
  let reasonCode: DifficultyReasonCode = 'PRACTICE_BASE_DEFAULT';
  for (const item of practiceItemsInOrder) {
    // The base is monotone: a session's own base (or its earned rise) can only keep or raise it --
    // a later row recorded at a lower level (a legacy/non-canonical attempt) never lowers it.
    const sessionBase = practiceSessionBaseLevel(item);
    const earned = practiceSessionEarnedRise(item);
    const next = clamp(Math.max(base, earned ? sessionBase + 1 : sessionBase), policy.difficulty.min, PRACTICE_MAX_BASE);
    reasonCode = earned && next > base && next === sessionBase + 1 ? 'PRACTICE_BASE_EARNED_AFTER_EXPOSURE' : 'PRACTICE_BASE_MAINTAINED';
    base = next;
  }
  const latest = practiceItemsInOrder[practiceItemsInOrder.length - 1];
  let exposure: PracticeBaseResolution['exposure'];
  if (!latest) exposure = { plusOneEligible: false, plusOneLevel: null, reasonCode: 'PRACTICE_EXPOSURE_NONE' };
  else if (!latest.hasCriticalMisconception && latest.scorePercent >= policy.minimumScorePercent)
    exposure = { plusOneEligible: true, plusOneLevel: Math.min(policy.difficulty.max, base + 1), reasonCode: 'PRACTICE_EXPOSURE_PLUS_ONE' };
  else if (latest.hasCriticalMisconception || latest.scorePercent < 60)
    exposure = { plusOneEligible: false, plusOneLevel: null, reasonCode: 'PRACTICE_EXPOSURE_SUPPRESSED' };
  else exposure = { plusOneEligible: false, plusOneLevel: null, reasonCode: 'PRACTICE_EXPOSURE_NONE' };
  return { base, target: base, reasonCode, exposure };
}

/**
 * D78 -- the per-level item mix for a session of `itemCount` items. Only a 3-item session carries
 * the +1 item (2 at base + 1 at base+1); a 2-item session (and any other size) is all at base.
 */
export function practiceMixForItemCount(
  baseLevel: number,
  plusOneEligible: boolean,
  itemCount: number,
  exposureReasonCode: DifficultyReasonCode,
): PracticeMix {
  const n = Math.max(0, Math.floor(itemCount));
  const plusOneLevel = Math.min(CANONICAL_POLICY.practice.difficulty.max, baseLevel + 1);
  const withPlusOne = plusOneEligible && n === 3 && plusOneLevel === baseLevel + 1;
  return {
    baseLevel,
    plusOneEligible,
    exposureReasonCode,
    items: withPlusOne ? [{ level: baseLevel, count: n - 1 }, { level: plusOneLevel, count: 1 }] : [{ level: baseLevel, count: n }],
  };
}

/** Planned base+1 items in a mix (0 or 1). */
export function plannedPlusOneItems(mix: Pick<PracticeMix, 'baseLevel' | 'items'>): number {
  return mix.items.filter((i) => i.level === mix.baseLevel + 1).reduce((a, i) => a + i.count, 0);
}

/** D78 -- the exposure a Practice session ACTUALLY carried, from its served item levels and binary correctness. */
export function computePracticeExposure(
  baseLevel: number,
  items: ReadonlyArray<{ difficulty: number; correct: boolean }>,
  /** D79/D80 -- whether the session recorded a practiceMixFallback; omitted = not recorded (pre-D79 callers). */
  mixFallback?: boolean,
): PracticeExposure {
  const plusOne = items.filter((i) => Math.round(i.difficulty) === baseLevel + 1);
  return {
    baseLevel,
    plusOneItems: plusOne.length,
    plusOneLevel: plusOne.length > 0 ? baseLevel + 1 : null,
    plusOneCorrect: plusOne.filter((i) => i.correct).length,
    ...(mixFallback !== undefined ? { mixFallback } : {}),
  };
}

/**
 * SUPERSEDED by `resolvePracticeBase` (D78): no longer consulted by the engine. Kept, unchanged,
 * only so its historical CANON-R2R1 tests stay replayable.
 *
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
 * D79 (operator decision 2026-10-17) -- PROVE level mix.
 *  - Without qualifying advanced Practice evidence: 10 items at level 3.
 *  - With it: 7 at level 3 + 3 at level 4 (PROVE_ADVANCED_LEVEL4_COUNT).
 * Qualifying advanced Practice evidence = at least ONE completed Practice session whose recorded
 * exposure shows: base 3, score >= 80, the SERVED base+1 item at level 4, every such item answered
 * correct (binary), no practiceMixFallback (D80: a fallback never counts), and -- as for every
 * qualifying Practice -- no critical misconception. A row without the D79 `mixFallback` flag
 * (D78-only) never qualifies: the absence of a fallback cannot be proven.
 * The persistent Practice base stays capped at 3; PROVE's `difficulty.target` stays 3.
 */
export const PROVE_ADVANCED_LEVEL4_COUNT = 3;
export const PROVE_BASE_LEVEL = 3;
export const PROVE_ADVANCED_LEVEL = 4;

export function isAdvancedPracticeEvidence(item: RawEvidenceItem): boolean {
  const x = item.practiceExposure;
  if (item.activityType !== 'PRACTICE' || !x) return false;
  if (item.hasCriticalMisconception) return false;
  if (item.scorePercent < CANONICAL_POLICY.practice.minimumScorePercent) return false;
  if (x.mixFallback !== false) return false;
  return x.baseLevel === PROVE_BASE_LEVEL && x.plusOneLevel === PROVE_ADVANCED_LEVEL && x.plusOneItems > 0 && x.plusOneCorrect === x.plusOneItems;
}

export interface ProveLevelMixResolution extends DifficultyResolution {
  mix: ProveMix;
}

export function resolveProveLevelMix(practiceItemsInOrder: RawEvidenceItem[]): ProveLevelMixResolution {
  const n = CANONICAL_POLICY.prove.itemCount;
  const qualifying = practiceItemsInOrder.find(isAdvancedPracticeEvidence) ?? null;
  const reasonCode: DifficultyReasonCode = qualifying ? 'PROVE_LEVEL_MIX_ADVANCED_PRACTICE_EVIDENCE' : 'PROVE_LEVEL_MIX_BASE';
  const items = qualifying
    ? [{ level: PROVE_BASE_LEVEL, count: n - PROVE_ADVANCED_LEVEL4_COUNT }, { level: PROVE_ADVANCED_LEVEL, count: PROVE_ADVANCED_LEVEL4_COUNT }]
    : [{ level: PROVE_BASE_LEVEL, count: n }];
  return { target: PROVE_BASE_LEVEL, reasonCode, mix: { items, reasonCode, qualifyingEvidenceId: qualifying?.id ?? null } };
}

/** D79 -- the level counts actually served (sorted by level). */
export function servedLevelCounts(difficulties: ReadonlyArray<number>): Array<{ level: number; count: number }> {
  const m = new Map<number, number>();
  for (const d of difficulties) m.set(Math.round(d), (m.get(Math.round(d)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ level, count }));
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
 * CANON-R2R1 Part 17 -- REINFORCE's difficulty is derived from the learner's evidence, never a
 * fixed/random number. D78 (2026-10-17) replaced "one level below the Practice trend" with the
 * learner's CURRENT earned Practice base (`resolvePracticeBase`), clamped into REINFORCE's own
 * [1,3] range -- a low score or misconception no longer lowers the level, it removes the +1 item.
 */
export function resolveReinforceDifficulty(practiceBase: number): DifficultyResolution {
  // D78 (2026-10-17): REINFORCE targets the learner's CURRENT Practice base (never base-1),
  // clamped into REINFORCE's own [1,3] range.
  const policy = CANONICAL_POLICY.reinforce;
  const target = clamp(practiceBase, policy.difficulty.min, policy.difficulty.max);
  return { target, reasonCode: 'REINFORCE_AT_CURRENT_PRACTICE_BASE' };
}

/** LEARN's own difficulty is not evidence-driven by this phase's spec -- a fixed policy midpoint, matching CANON-R2's original behavior. */
export function resolveLearnDifficulty(): DifficultyResolution {
  const policy = CANONICAL_POLICY.learn;
  return { target: Math.round((policy.difficulty.min + policy.difficulty.max) / 2), reasonCode: 'LEARN_UNDERSTANDING_ONLY' };
}
