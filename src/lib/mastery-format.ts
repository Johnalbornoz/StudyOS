/**
 * Canonical mastery-percentage presentation.
 *
 * FORENSIC AUDIT FINDING: `mastery_records.mastery_score` is canonically
 * 0-100 -- already percentage points -- NOT a 0.0-1.0 fraction. Proof:
 *
 *  - The write-path algorithm (src/lib/algorithms/mastery.ts's
 *    `updateMastery`) clamps `Math.max(0, Math.min(100, newMastery))`,
 *    unchanged since the file's very first commit.
 *  - Every threshold across the codebase that reads this column is a
 *    0-100 point value: shouldCreateLearningDebt (>=60), calculateDebtSeverity
 *    (<40, <50), shouldResolveLearningDebt (<=85), getMasteryLevel
 *    (40/60/75/85/95), learning-debt.service.ts's masteryAbove85 (>85),
 *    the concept-detail CTA heuristic (<50).
 *  - spaced-repetition.ts's calculateReviewIntervalDays explicitly does
 *    `masteryScore / 100`.
 *  - The algorithm's own pre-existing test suite (tests/unit/mastery.test.ts,
 *    tests/unit/learning-debt.test.ts) calls it with values like 75, 85, 10, 90.
 *  - Live production rows contain mastery_score = 1.65 and 5.30, which
 *    could not exist if the migrations/001 CHECK (<=1) were actually
 *    enforced -- that CHECK was an authoring inconsistency from the
 *    project's very first commit (written alongside, but never matching,
 *    this same 0-100-clamping algorithm) and has never reflected the
 *    live database or the real contract.
 *
 * This module therefore never multiplies mastery_records.mastery_score
 * by 100 -- it only ROUNDS an already-0-100 value for display. Do NOT
 * reintroduce a fraction interpretation here.
 *
 * Knowledge State dimension scores (understanding/independence/
 * application/retention/transfer, from concept_knowledge_state) are a
 * SEPARATE data model that happens to share the same 0-100 numeric
 * range -- see dimensionToPercent/formatDimensionPercent below. Keep
 * them structurally distinct from MasteryScore: a mastery_records value
 * and a Knowledge State dimension value must never be averaged together
 * or substituted for each other, even though neither needs unit
 * conversion.
 */

declare const MASTERY_SCORE: unique symbol;
/** A validated mastery_records.mastery_score value, always in [0, 100]. Never construct this except via toMasteryScore/tryMasteryScore. */
export type MasteryScore = number & { readonly [MASTERY_SCORE]: true };

export class InvalidMasteryScoreError extends RangeError {
  constructor(value: number) {
    super(
      `Invalid mastery score: ${value}. mastery_records.mastery_score is canonically 0-100 ` +
        `(already percentage points, not a fraction -- see the forensic mastery-contract audit). ` +
        `A value outside [0, 100] is a bug to surface immediately -- never clamp it into range and ` +
        `never multiply it by 100.`
    );
    this.name = 'InvalidMasteryScoreError';
  }
}

/** The only way to obtain a MasteryScore. Throws on anything outside [0, 100] -- never clamps, never guesses. */
export function toMasteryScore(value: number): MasteryScore {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new InvalidMasteryScoreError(value);
  }
  return value as MasteryScore;
}

/**
 * Same validation as toMasteryScore, for read boundaries that must not
 * crash a whole page render over one bad row: logs the error and
 * returns null (treated exactly like "no mastery record yet" --
 * unknown, never a wrong number) instead of throwing. Prefer
 * toMasteryScore wherever a thrown error is acceptable (tests, or
 * anywhere with its own error boundary); use this at the edge of live
 * DB reads. A valid low value (e.g. 1.65, 5.30) is NOT rejected here --
 * only values genuinely outside [0, 100] are.
 */
export function tryMasteryScore(value: number | string | null | undefined, context?: string): MasteryScore | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'string' ? Number(value) : value;
  try {
    return toMasteryScore(numeric);
  } catch (err) {
    console.error(`[mastery-format]${context ? ` ${context}:` : ''}`, (err as Error).message);
    return null;
  }
}

/** Rounds a validated mastery score for display. NOT a unit conversion -- mastery_records.mastery_score is already 0-100. */
export function masteryToPercent(score: MasteryScore | null | undefined): number | null {
  if (score === null || score === undefined) return null;
  return Math.round(score);
}

/** Display string for a single mastery value, e.g. "3%". Em dash when unknown. */
export function formatMasteryPercent(score: MasteryScore | null | undefined): string {
  const pct = masteryToPercent(score);
  return pct === null ? '—' : `${pct}%`;
}

/**
 * Signed delta string for a before/after mastery pair, e.g. "+1".
 * Rounds each endpoint to a whole percent FIRST, then subtracts, so the
 * shown delta always reconciles with the shown before/after numbers
 * (0% -> 1% always shows "+1" -- never an off-by-one from independently
 * rounding the raw delta).
 */
export function formatMasteryDelta(
  oldScore: MasteryScore | null | undefined,
  newScore: MasteryScore | null | undefined
): string {
  const oldPct = masteryToPercent(oldScore) ?? 0;
  const newPct = masteryToPercent(newScore) ?? 0;
  const delta = newPct - oldPct;
  return delta >= 0 ? `+${delta}` : `${delta}`;
}

/**
 * Averages RAW (unrounded) mastery scores and rounds once, at the end --
 * e.g. [1.65, 5.30] averages to 3.475, which rounds to 3%, not
 * round(1.65)=2 and round(5.30)=5 averaged to round(3.5)=4. Precision is
 * preserved through the aggregation; rounding happens only at the final
 * presentation boundary. Takes MasteryScore[], not plain number[] or a
 * mix of already-rounded percents, so a caller can only ever feed it
 * validated raw mastery_score values.
 */
export function averageMasteryScore(scores: MasteryScore[]): MasteryScore | null {
  if (scores.length === 0) return null;
  return toMasteryScore(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
}

/**
 * Knowledge State dimension formatter (understanding / independence /
 * application / retention / transfer). These arrive already on a
 * 0-100 scale -- this only clamps/rounds and supplies the
 * unknown-evidence label. `null` means "not enough evidence yet" and
 * must render as `unknownLabel`, never as "0%": missing evidence is
 * not the same claim as demonstrated failure. Deliberately NOT typed
 * as MasteryScore -- a Knowledge State dimension score and a
 * mastery_records value are different data models and must never be
 * averaged together or substituted for each other, even though both
 * are 0-100 and need no unit conversion.
 */
export function formatDimensionPercent(score0to100: number | null | undefined, unknownLabel: string): string {
  const pct = dimensionToPercent(score0to100);
  return pct === null ? unknownLabel : `${pct}%`;
}

export function dimensionToPercent(score0to100: number | null | undefined): number | null {
  if (score0to100 === null || score0to100 === undefined || !Number.isFinite(score0to100)) return null;
  return Math.round(Math.max(0, Math.min(100, score0to100)));
}
