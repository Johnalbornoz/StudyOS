/**
 * Track B / B1 -- the scoring POLICY a vertical supplies as configuration
 * (`scoring_models.config`). The core executes it deterministically
 * (scoring-engine.ts); nothing here is exam-family specific.
 *
 * Strategies:
 *   RAW               -- earned marks / available marks.
 *   WEIGHTED_ITEMS    -- every item contributes its own `marks` (or a
 *                        per-question-type weight); the result is the
 *                        weighted fraction.
 *   SECTION_WEIGHTED  -- each section's fraction, combined with the
 *                        configured section weights (normalized).
 *   CRITERIA          -- marks grouped by rubric criterion, each criterion
 *                        weighted (normalized); items carry per-criterion
 *                        awards (mark-scheme parts).
 *
 * Transformations (applied to the strategy's fraction, 0..1):
 *   NONE | LINEAR (min..max, decimals) | PIECEWISE (monotone points) | BANDS (labels).
 *
 * Official conversions are NEVER hard-coded: a transform is data, and
 * `provenance.official` must be explicitly true AND carry a source for the
 * result to be labelled official. Every DEV fixture sets official=false.
 *
 * A missing/absent config is a real state (INV-F7-09): the engine reports
 * NO_SCORING_POLICY and never falls back to a default formula. Raw marks are
 * still recorded as facts.
 */
import { createHash } from 'crypto';
import { z } from 'zod';

export const SCORING_ENGINE_VERSION = 'exam-scoring-v1';

const TransformSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }),
  z.object({
    type: z.literal('LINEAR'),
    min: z.number(),
    max: z.number(),
    decimals: z.number().int().min(0).max(4).default(0),
  }),
  z.object({
    type: z.literal('PIECEWISE'),
    // [fraction 0..1, scaled value]; strictly increasing fractions, covering 0 and 1.
    points: z.array(z.tuple([z.number().min(0).max(1), z.number()])).min(2),
    decimals: z.number().int().min(0).max(4).default(0),
  }),
  z.object({
    type: z.literal('BANDS'),
    // Lowest band first; a band applies from its minFraction (inclusive) up to the next band.
    bands: z.array(z.object({ minFraction: z.number().min(0).max(1), label: z.string().min(1).max(60) })).min(1),
  }),
]);

export const ScoringPolicySchema = z
  .object({
    engine: z.literal(SCORING_ENGINE_VERSION),
    strategy: z.enum(['RAW', 'WEIGHTED_ITEMS', 'SECTION_WEIGHTED', 'CRITERIA']),
    /** Per question type multiplier for WEIGHTED_ITEMS (applied on top of item marks). */
    questionTypeWeights: z.record(z.string(), z.number().positive()).optional(),
    /** Section weights for SECTION_WEIGHTED, keyed by component (section) key. */
    sectionWeights: z.record(z.string(), z.number().positive()).optional(),
    /** Criterion weights for CRITERIA, keyed by criterion id. */
    criterionWeights: z.record(z.string(), z.number().positive()).optional(),
    /** Partial credit: when false, any item below full marks earns 0. */
    partialCredit: z.boolean().default(true),
    /** Marks assumed for a planned item that was never delivered (missing). */
    defaultItemMarks: z.number().positive().default(1),
    transform: TransformSchema.default({ type: 'NONE' }),
    /** Presentation hint for the final value (e.g. "%", "points", "level"). */
    unit: z.string().max(30).optional(),
    reporting: z
      .object({
        strengthFraction: z.number().min(0).max(1).default(0.75),
        gapFraction: z.number().min(0).max(1).default(0.5),
      })
      .default({ strengthFraction: 0.75, gapFraction: 0.5 }),
    provenance: z.object({
      official: z.boolean(),
      source: z.string().min(1).max(300),
    }),
  })
  .superRefine((policy, ctx) => {
    if (policy.provenance.official && /fixture|dev|illustrative/i.test(policy.provenance.source)) {
      ctx.addIssue({ code: 'custom', message: 'a DEV/fixture source can never be marked official', path: ['provenance', 'official'] });
    }
    if (policy.strategy === 'SECTION_WEIGHTED' && !policy.sectionWeights) {
      ctx.addIssue({ code: 'custom', message: 'SECTION_WEIGHTED requires sectionWeights', path: ['sectionWeights'] });
    }
    if (policy.transform.type === 'PIECEWISE') {
      const xs = policy.transform.points.map((p) => p[0]);
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] <= xs[i - 1]) ctx.addIssue({ code: 'custom', message: 'PIECEWISE points must have strictly increasing fractions', path: ['transform', 'points'] });
      }
      if (xs[0] !== 0 || xs[xs.length - 1] !== 1) ctx.addIssue({ code: 'custom', message: 'PIECEWISE points must cover fractions 0 and 1', path: ['transform', 'points'] });
    }
    if (policy.transform.type === 'BANDS') {
      const xs = policy.transform.bands.map((b) => b.minFraction);
      if (xs[0] !== 0) ctx.addIssue({ code: 'custom', message: 'the lowest band must start at 0', path: ['transform', 'bands'] });
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] <= xs[i - 1]) ctx.addIssue({ code: 'custom', message: 'bands must be strictly increasing', path: ['transform', 'bands'] });
      }
    }
    if (policy.transform.type === 'LINEAR' && policy.transform.max <= policy.transform.min) {
      ctx.addIssue({ code: 'custom', message: 'LINEAR max must exceed min', path: ['transform'] });
    }
  });

export type ScoringPolicy = z.infer<typeof ScoringPolicySchema>;
export type ScoringTransform = z.infer<typeof TransformSchema>;

export type ParsedScoringPolicy = { ok: true; policy: ScoringPolicy } | { ok: false; reason: 'NO_SCORING_POLICY' | 'INVALID_SCORING_POLICY'; detail?: string };

/** Validates a stored `scoring_models.config`. Absent config is NO_SCORING_POLICY, never a default formula. */
export function parseScoringPolicy(config: unknown): ParsedScoringPolicy {
  if (config === null || config === undefined) return { ok: false, reason: 'NO_SCORING_POLICY' };
  const parsed = ScoringPolicySchema.safeParse(config);
  if (!parsed.success) return { ok: false, reason: 'INVALID_SCORING_POLICY', detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, policy: parsed.data };
}

/** Deterministic JSON (sorted keys) -- the basis of every provenance hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
