/**
 * Question Bank Factory -- V1 empirical CALIBRATION and MONITORING (pure).
 *
 * Transparent classical statistics only -- no IRT / Rasch is claimed:
 *   empirical difficulty  = mean score fraction (p-value; higher = easier);
 *   discrimination proxy  = upper-lower index: p(top 27% of attempts) - p(bottom 27%),
 *                           attempts ranked by their score on the OTHER items;
 *   distractor shares, sample size, and a confidence LEVEL from the sample size.
 * An item is never "calibrated" from a few responses: below `earlySignalAt`
 * it is INSUFFICIENT_DATA and no monitoring flag can fire. Calibration stays
 * exam- and format-specific: statistics are per item version, and a version
 * belongs to one exam's blueprint.
 */
import { DEFAULT_CALIBRATION_POLICY, type CalibrationPolicy } from './policy';
import type { CalibrationConfidence, LifecycleState } from './lifecycle';

export interface ResponseObservation {
  /** score / max of this item in this response. */
  fraction: number;
  /** Selected option id (selected-response items), else null. */
  optionId: string | null;
  /** Mean fraction of the same attempt on the OTHER items (ranks the attempt). null when the attempt had no other item. */
  restFraction: number | null;
}

export interface ItemCalibration {
  sampleSize: number;
  confidence: CalibrationConfidence;
  empiricalDifficulty: number | null;
  discriminationProxy: number | null;
  correct: number;
  partial: number;
  incorrect: number;
  optionShares: Record<string, number>;
  flags: MonitoringFlag[];
  misconceptionSignals: MisconceptionSignal[];
}

export type MonitoringFlag = 'EXTREME_EASE' | 'EXTREME_DIFFICULTY' | 'POOR_DISCRIMINATION' | 'DEAD_DISTRACTOR' | 'MULTIPLE_ANSWER_SIGNAL';

export interface MisconceptionSignal {
  optionId: string;
  misconceptionCode: string | null;
  share: number;
  sampleSize: number;
}

export function confidenceFor(n: number, p: CalibrationPolicy = DEFAULT_CALIBRATION_POLICY): CalibrationConfidence {
  if (n >= p.highAt) return 'HIGH_CONFIDENCE';
  if (n >= p.moderateAt) return 'MODERATE_CONFIDENCE';
  if (n >= p.earlySignalAt) return 'EARLY_SIGNAL';
  return 'INSUFFICIENT_DATA';
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function calibrateItem(
  obs: ResponseObservation[],
  item: { keyOptionId: string | null; optionIds: string[]; distractorMisconceptions?: Record<string, string> | null },
  p: CalibrationPolicy = DEFAULT_CALIBRATION_POLICY
): ItemCalibration {
  const n = obs.length;
  const confidence = confidenceFor(n, p);
  const correct = obs.filter((o) => o.fraction >= 1 - 1e-9).length;
  const incorrect = obs.filter((o) => o.fraction <= 1e-9).length;
  const difficulty = mean(obs.map((o) => o.fraction));

  const ranked = obs.filter((o) => o.restFraction !== null).sort((a, b) => (b.restFraction as number) - (a.restFraction as number));
  const k = Math.floor(ranked.length * 0.27);
  const discrimination = k >= 5 ? (mean(ranked.slice(0, k).map((o) => o.fraction)) as number) - (mean(ranked.slice(-k).map((o) => o.fraction)) as number) : null;

  const optionShares: Record<string, number> = {};
  const chosen = obs.filter((o) => o.optionId);
  for (const id of item.optionIds) optionShares[id] = chosen.length ? chosen.filter((o) => o.optionId === id).length / chosen.length : 0;

  const flags: MonitoringFlag[] = [];
  const misconceptionSignals: MisconceptionSignal[] = [];
  // Adequate evidence first: nothing is asserted from a handful of responses.
  if (confidence !== 'INSUFFICIENT_DATA' && difficulty !== null) {
    if (difficulty > p.extremeEaseAbove) flags.push('EXTREME_EASE');
    if (difficulty < p.extremeDifficultyBelow) flags.push('EXTREME_DIFFICULTY');
    if (discrimination !== null && discrimination < p.poorDiscriminationBelow) flags.push('POOR_DISCRIMINATION');
    if (item.keyOptionId && chosen.length) {
      const distractors = item.optionIds.filter((id) => id !== item.keyOptionId);
      if (distractors.some((id) => optionShares[id] < p.deadDistractorBelow)) flags.push('DEAD_DISTRACTOR');
      // Strong attempts prefer a distractor over the key: a second defensible answer is likely.
      const top = ranked.slice(0, k).filter((o) => o.optionId);
      if (top.length >= 5) {
        const share = (id: string) => top.filter((o) => o.optionId === id).length / top.length;
        if (distractors.some((id) => share(id) >= share(item.keyOptionId!))) flags.push('MULTIPLE_ANSWER_SIGNAL');
      }
      if (confidence === 'MODERATE_CONFIDENCE' || confidence === 'HIGH_CONFIDENCE') {
        for (const id of distractors) {
          if (optionShares[id] >= p.misconceptionSignalAt) misconceptionSignals.push({ optionId: id, misconceptionCode: item.distractorMisconceptions?.[id] ?? null, share: optionShares[id], sampleSize: n });
        }
      }
    }
  }
  return { sampleSize: n, confidence, empiricalDifficulty: difficulty, discriminationProxy: discrimination, correct, partial: n - correct - incorrect, incorrect, optionShares, flags, misconceptionSignals };
}

/** The lifecycle move calibration evidence justifies (or null). Never fires below EARLY_SIGNAL; promotion needs MODERATE and no flag. */
export function calibrationDecision(state: LifecycleState | null, cal: ItemCalibration): { to: LifecycleState; reason: string } | null {
  if (state === null) return null;
  const strong = cal.confidence === 'MODERATE_CONFIDENCE' || cal.confidence === 'HIGH_CONFIDENCE';
  if (cal.flags.length > 0 && strong && ['PILOT', 'CALIBRATED', 'ACTIVE'].includes(state)) return { to: 'REVIEW_REQUIRED', reason: `MONITORING:${cal.flags.join(',')}` };
  if (state === 'PILOT' && strong && cal.flags.length === 0) return { to: 'CALIBRATED', reason: `CALIBRATION:${cal.confidence}:n=${cal.sampleSize}` };
  return null;
}

/** Aggregate wording for a generation prompt -- anonymous by construction (a share and a sample size). */
export function misconceptionSummary(s: MisconceptionSignal, optionText: string): string {
  return `${Math.round(s.share * 100)}% de las respuestas (n=${s.sampleSize}) eligen «${optionText.slice(0, 120)}»${s.misconceptionCode ? ` (${s.misconceptionCode})` : ''}`;
}
