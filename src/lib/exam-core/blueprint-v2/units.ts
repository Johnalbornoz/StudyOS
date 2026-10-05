/**
 * Blueprint Engine V2 / BP-0 -- typed scoring units.
 *
 * A score is never a bare number. Each stage of an exam's scoring pipeline
 * produces a value of exactly one unit, and the types make it a compile
 * error to hand one unit where another is expected (a RawMarks value is not
 * a WeightedScore, a Grade is not QualificationPoints). Values can only be
 * built through the constructors below, which validate them; an object
 * literal of the right shape does not type-check because of the brand.
 *
 * Not every exam reaches every unit (PAA has no Grade; PISA has no
 * individual score). Nothing here assumes a stage exists.
 *
 * "points" is not a unit: QUALIFICATION_POINTS exists only for a
 * qualification rule that defines points (e.g. a diploma award rule).
 */

declare const BRAND: unique symbol;
type Branded<U extends string, T> = T & { readonly unit: U; readonly [BRAND]: U };

export const SCORE_UNITS = ['RAW_MARKS', 'COMPONENT_SCORE', 'WEIGHTED_SCORE', 'SCALED_SCORE', 'GRADE', 'QUALIFICATION_POINTS'] as const;
export type ScoreUnit = (typeof SCORE_UNITS)[number];

/** Marks earned out of marks available (items as delivered). */
export type RawMarks = Branded<'RAW_MARKS', { earned: number; available: number }>;
/** One component's marks, measured against the component's maximum. */
export type ComponentScore = Branded<'COMPONENT_SCORE', { componentKey: string; earned: number; max: number; maxBasis: 'OFFICIAL_MAX' | 'DELIVERED' }>;
/** Sum of weighted component fractions, in percentage points of the subject; `coveredWeightPercent` says how much of the subject it covers. */
export type WeightedScore = Branded<'WEIGHTED_SCORE', { value: number; coveredWeightPercent: number; componentKeys: string[] }>;
/** A value on a published scale (e.g. a conversion table's output). */
export type ScaledScore = Branded<'SCALED_SCORE', { value: number; scaleKey: string }>;
/** A grade label on a published grade scale. */
export type Grade = Branded<'GRADE', { label: string; scaleKey: string }>;
/** Points defined by a qualification award rule. */
export type QualificationPoints = Branded<'QUALIFICATION_POINTS', { value: number; ruleKey: string }>;

export type ScoreValue = RawMarks | ComponentScore | WeightedScore | ScaledScore | Grade | QualificationPoints;

export class ScoreUnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoreUnitError';
  }
}

function finiteNonNegative(n: number, what: string): void {
  if (!Number.isFinite(n) || n < 0) throw new ScoreUnitError(`${what} must be a finite, non-negative number (got ${n})`);
}

function brand<U extends string, T extends object>(unit: U, value: T): Branded<U, T> {
  return Object.freeze({ ...value, unit }) as Branded<U, T>;
}

export function rawMarks(earned: number, available: number): RawMarks {
  finiteNonNegative(earned, 'earned marks');
  finiteNonNegative(available, 'available marks');
  if (earned > available) throw new ScoreUnitError(`earned marks (${earned}) exceed available marks (${available})`);
  return brand('RAW_MARKS', { earned, available });
}

export function sumRawMarks(parts: readonly RawMarks[]): RawMarks {
  return rawMarks(
    parts.reduce((n, p) => n + p.earned, 0),
    parts.reduce((n, p) => n + p.available, 0)
  );
}

/**
 * Raw marks of one component -> component score. The basis is OFFICIAL_MAX
 * only when the delivered form is the whole component (delivered marks equal
 * the official maximum). A reduced form keeps its DELIVERED basis: 18 of 25
 * delivered marks is not 18 of the paper's 110, and must never be weighted
 * as if it were.
 */
export function componentScore(componentKey: string, raw: RawMarks, officialMax: number | null): ComponentScore {
  if (officialMax !== null) {
    finiteNonNegative(officialMax, 'official maximum');
    if (officialMax === 0) throw new ScoreUnitError('official maximum must be positive');
    if (raw.available > officialMax) throw new ScoreUnitError(`component ${componentKey}: delivered marks (${raw.available}) exceed the official maximum (${officialMax})`);
    if (raw.available === officialMax) return brand('COMPONENT_SCORE', { componentKey, earned: raw.earned, max: officialMax, maxBasis: 'OFFICIAL_MAX' as const });
  }
  return brand('COMPONENT_SCORE', { componentKey, earned: raw.earned, max: raw.available, maxBasis: 'DELIVERED' as const });
}

export function componentFraction(score: ComponentScore): number {
  return score.max === 0 ? 0 : score.earned / score.max;
}

/** Weight of a component, in percent of the subject. Only obtainable from an authoritative fact (see pipeline.ts). */
export type AuthoritativeWeight = Branded<'COMPONENT_WEIGHT', { componentKey: string; percent: number }>;

/** @internal used by the pipeline after it checked provenance. */
export function authoritativeWeight(componentKey: string, percent: number): AuthoritativeWeight {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new ScoreUnitError(`weight of ${componentKey} must be in (0, 100] (got ${percent})`);
  return brand('COMPONENT_WEIGHT', { componentKey, percent });
}

/**
 * Weighted score = sum(component fraction x weight). Only components with an
 * OFFICIAL_MAX basis can be weighted -- a fraction of a reduced form is not a
 * fraction of the component. Weights are never renormalized: a subject whose
 * configured components cover 80% reports coveredWeightPercent = 80.
 */
export function weightedScore(parts: ReadonlyArray<{ score: ComponentScore; weight: AuthoritativeWeight }>): WeightedScore {
  if (parts.length === 0) throw new ScoreUnitError('a weighted score needs at least one component');
  const keys = new Set<string>();
  let value = 0;
  let covered = 0;
  for (const { score, weight } of parts) {
    if (score.componentKey !== weight.componentKey) throw new ScoreUnitError(`weight for ${weight.componentKey} applied to component ${score.componentKey}`);
    if (score.maxBasis !== 'OFFICIAL_MAX') throw new ScoreUnitError(`component ${score.componentKey} has no official maximum; it cannot be weighted`);
    if (keys.has(score.componentKey)) throw new ScoreUnitError(`component ${score.componentKey} weighted twice`);
    keys.add(score.componentKey);
    value += componentFraction(score) * weight.percent;
    covered += weight.percent;
  }
  if (covered > 100 + 1e-9) throw new ScoreUnitError(`weights sum to ${covered}% (> 100%)`);
  return brand('WEIGHTED_SCORE', { value: Math.round(value * 1e6) / 1e6, coveredWeightPercent: Math.round(covered * 1e6) / 1e6, componentKeys: [...keys].sort() });
}

/** @internal built only from an authoritative conversion / boundary set (pipeline.ts). */
export function scaledScore(value: number, scaleKey: string): ScaledScore {
  if (!Number.isFinite(value)) throw new ScoreUnitError('scaled score must be finite');
  return brand('SCALED_SCORE', { value, scaleKey });
}

/** @internal built only from an authoritative boundary set (pipeline.ts). */
export function grade(label: string, scaleKey: string): Grade {
  if (!label) throw new ScoreUnitError('grade label must not be empty');
  return brand('GRADE', { label, scaleKey });
}

/** @internal built only from an authoritative qualification rule. */
export function qualificationPoints(value: number, ruleKey: string): QualificationPoints {
  finiteNonNegative(value, 'qualification points');
  return brand('QUALIFICATION_POINTS', { value, ruleKey });
}
