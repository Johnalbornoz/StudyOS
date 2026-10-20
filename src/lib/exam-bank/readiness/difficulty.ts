/**
 * Governed DIFFICULTY profile of an Exam Bank item (pure, no IO). Design: docs/audits/exam-bank/EXAM_BANK_READINESS_ENGINE.md
 * section "Difficulty calibration".
 *
 * A difficulty is never just easy / medium / hard. It is an estimate WITH ITS SOURCE and its confidence:
 *   difficultyIndex   the repository's existing scale (src/lib/exam-core/items.ts `difficultyIndex`, 0.3..2): difficulty
 *                     RELATIVE TO THE TARGET EXAM, 1.0 = the official exam's own difficulty. null when no estimate
 *                     exists -- and a missing index is NEVER read as 1.0 (that would make uncalibrated content look
 *                     exactly on-target).
 *   difficultyBand    a coarse band derived from the index (or the authored 1..5 level) for assembly only.
 *   calibrationSource CONSTRUCT_DESIGN (authored level) < AUTOMATED_PRIOR (model estimate) < EXPERT_REVIEW < EMPIRICAL.
 *   sampleSize        independent, unassisted Student responses behind an EMPIRICAL estimate (0 otherwise).
 *
 * CALIBRATED means EMPIRICAL with enough independent responses under the policy. Nothing else is calibrated, and no
 * surface may claim psychometric calibration otherwise. Modes that need calibration (Challenge) fail closed.
 */

export type CalibrationSource = 'CONSTRUCT_DESIGN' | 'AUTOMATED_PRIOR' | 'EXPERT_REVIEW' | 'EMPIRICAL';
export type DifficultyBand = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface DifficultyProfile {
  difficultyIndex: number | null;
  difficultyBand: DifficultyBand | null;
  /** 0..1 confidence in the index under its source. */
  confidence: number;
  calibrationSource: CalibrationSource;
  sampleSize: number;
  lastCalibratedAt: string | null;
}

export interface CalibrationPolicy {
  /** Minimum independent responses for an EMPIRICAL estimate to count as calibrated. */
  minEmpiricalSample: number;
  /** An empirical estimate older than this (days) is stale and no longer calibrated. null = never stale. */
  maxAgeDays: number | null;
}
/** A conservative default; a product decision may raise it. Not a psychometric claim by itself. */
export const DEFAULT_CALIBRATION_POLICY: CalibrationPolicy = { minEmpiricalSample: 200, maxAgeDays: 730 };

const BANDS: readonly DifficultyBand[] = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
/** The band of an exam-relative index: MEDIUM is 0.9..1.1 around the official difficulty. */
export const bandOfIndex = (i: number): DifficultyBand => (i < 0.6 ? 'VERY_LOW' : i < 0.9 ? 'LOW' : i <= 1.1 ? 'MEDIUM' : i <= 1.4 ? 'HIGH' : 'VERY_HIGH');

/** An authored 1..5 level is a CONSTRUCT_DESIGN prior: a band, no index, low confidence. Never calibrated. */
export function profileFromAuthoredLevel(level: number): DifficultyProfile {
  const l = Math.min(5, Math.max(1, Math.round(level)));
  return { difficultyIndex: null, difficultyBand: BANDS[l - 1], confidence: 0.2, calibrationSource: 'CONSTRUCT_DESIGN', sampleSize: 0, lastCalibratedAt: null };
}

/** Is this profile a governed empirical calibration under the policy, now? */
export function isCalibrated(p: DifficultyProfile | null, policy: CalibrationPolicy = DEFAULT_CALIBRATION_POLICY, now: Date = new Date()): boolean {
  if (!p || p.calibrationSource !== 'EMPIRICAL' || p.difficultyIndex === null) return false;
  if (p.sampleSize < policy.minEmpiricalSample) return false;
  if (policy.maxAgeDays !== null) {
    if (!p.lastCalibratedAt) return false;
    const age = (now.getTime() - new Date(p.lastCalibratedAt).getTime()) / 86_400_000;
    if (!(age >= 0 && age <= policy.maxAgeDays)) return false;
  }
  return true;
}

export type CalibrationStatus = 'CALIBRATED' | 'NOT_CALIBRATED';
/** The calibration verdict of a profile. A missing profile, a missing index or a non-empirical source is NOT_CALIBRATED. */
export const calibrationStatusOf = (p: DifficultyProfile | null, policy: CalibrationPolicy = DEFAULT_CALIBRATION_POLICY, now: Date = new Date()): CalibrationStatus => (isCalibrated(p, policy, now) ? 'CALIBRATED' : 'NOT_CALIBRATED');
/**
 * The difficulty index a consumer may use, or null. NEVER a synthetic number: an unknown difficulty is unknown, it is
 * not 1.0 (the official difficulty). Only a calibrated profile yields a number.
 */
export const calibratedDifficultyIndex = (p: DifficultyProfile | null, policy: CalibrationPolicy = DEFAULT_CALIBRATION_POLICY, now: Date = new Date()): number | null => (isCalibrated(p, policy, now) ? p!.difficultyIndex : null);
