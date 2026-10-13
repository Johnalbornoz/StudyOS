/**
 * Governed SPEED STRATEGY (pure, no IO). One engine for every exam system.
 *
 * A speed strategy is certified CONTENT, like an item: a typed, versioned record saying how to answer a kind of
 * question fast, when not to, the time it should take and when to move on. Nothing here writes one at runtime: the
 * engine validates candidates (`speedStrategyIssues`), resolves the certified strategy of an item
 * (`resolveStrategy`), decides when a learner may see it (`strategyVisibility`) and reviews the time of an attempt
 * (`timeReview`). An item with no certified strategy has none -- it is never improvised.
 */
import { createHash } from 'crypto';
import { z } from 'zod';

export const SPEED_STRATEGY_ENGINE_VERSION = 'speed-strategy-1';
const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');

/** The registry. `families` = the kinds of component a type may be attached to. NO_RELIABLE_SHORTCUT is a strategy: "solve it directly" is the honest advice. */
export const STRATEGY_TYPES = {
  BACK_SOLVE_FROM_OPTIONS: { families: ['MATH'], needsOptions: true },
  PLUG_IN_NUMBERS: { families: ['MATH'], needsOptions: false },
  ESTIMATE_AND_ELIMINATE: { families: ['MATH'], needsOptions: true },
  STRUCTURE_BEFORE_COMPUTING: { families: ['MATH'], needsOptions: false },
  UNITS_AND_PROPORTION_CHECK: { families: ['MATH'], needsOptions: false },
  DRAW_OR_MARK_THE_FIGURE: { families: ['MATH'], needsOptions: false },
  READ_THE_QUESTION_FIRST: { families: ['READING', 'ENGLISH'], needsOptions: false },
  LOCATE_THE_EVIDENCE_LINE: { families: ['READING', 'ENGLISH'], needsOptions: false },
  PREDICT_THEN_MATCH: { families: ['READING', 'WRITING', 'ENGLISH'], needsOptions: true },
  ELIMINATE_EXTREMES: { families: ['READING', 'ENGLISH'], needsOptions: true },
  CONTEXT_CLUE_SUBSTITUTION: { families: ['READING', 'ENGLISH'], needsOptions: true },
  CONNECTOR_LOGIC: { families: ['WRITING', 'ENGLISH'], needsOptions: false },
  SHORTEST_CORRECT_VERSION: { families: ['WRITING', 'ENGLISH'], needsOptions: true },
  GRAMMAR_PATTERN_CHECK: { families: ['WRITING', 'ENGLISH'], needsOptions: false },
  READ_AXES_AND_UNITS_FIRST: { families: ['MATH', 'READING'], needsOptions: false },
  SKIP_AND_RETURN: { families: ['MATH', 'READING', 'WRITING', 'ENGLISH'], needsOptions: false },
  NO_RELIABLE_SHORTCUT: { families: ['MATH', 'READING', 'WRITING', 'ENGLISH'], needsOptions: false },
} as const;
export type StrategyType = keyof typeof STRATEGY_TYPES;
export type ComponentFamily = 'MATH' | 'READING' | 'WRITING' | 'ENGLISH';
export const TARGET_TIME_PROVENANCE = ['OFFICIAL_DERIVED', 'STUDYUS_CALIBRATED', 'STUDYUS_HEURISTIC'] as const;
export type TargetTimeProvenance = (typeof TARGET_TIME_PROVENANCE)[number];
/** Observed, independent, correct responses a calibrated time needs before it may call itself calibrated. */
export const MIN_CALIBRATION_SAMPLE = 30;

export const SpeedStrategySchema = z.object({
  v: z.literal(1),
  strategyId: z.string().regex(/^strat\.[a-z0-9]+([.-][a-z0-9]+)*$/),
  version: z.number().int().positive(),
  type: z.enum(Object.keys(STRATEGY_TYPES) as [StrategyType, ...StrategyType[]]),
  language: z.string().min(2).max(10),
  /** What it applies to. The most specific non-empty level wins: item, then concept, then bucket. */
  scope: z.object({ systemId: z.string().min(1), componentId: z.string().min(1), family: z.enum(['MATH', 'READING', 'WRITING', 'ENGLISH']), blueprintBucketIds: z.array(z.string()), conceptStableIds: z.array(z.string()), itemIds: z.array(z.string()) }),
  title: z.string().min(4).max(80),
  /** What to do, in order. Short: a strategy that takes a page to read saves no time. */
  steps: z.array(z.string().min(8).max(220)).min(1).max(5),
  whenToUse: z.string().min(10).max(300),
  whenNotToUse: z.string().min(10).max(300),
  commonTrap: z.string().min(10).max(300).nullable(),
  targetTime: z.object({ seconds: z.number().int().min(10).max(600), provenance: z.enum(TARGET_TIME_PROVENANCE), basis: z.string().min(10).max(300), sampleSize: z.number().int().nonnegative().nullable() }),
  /** Past this, guess-mark-move on. Always later than the target. */
  skipThresholdSeconds: z.number().int().min(15).max(900),
  certification: z.object({ state: z.enum(['CANDIDATE', 'CERTIFIED', 'REJECTED']), mode: z.enum(['HUMAN', 'AUTOMATED']).nullable(), recordId: z.string().nullable() }),
  lineage: z.object({ source: z.string().min(1), generator: z.string().nullable() }),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SpeedStrategy = z.infer<typeof SpeedStrategySchema>;
/** The digest of the advice itself. Certification and lineage are facts ABOUT it, not part of it. */
export const speedStrategyDigest = (s: Omit<SpeedStrategy, 'digest' | 'certification' | 'lineage'>): string => { const { strategyId, version, type, language, scope, title, steps, whenToUse, whenNotToUse, commonTrap, targetTime, skipThresholdSeconds } = s; return sha({ strategyId, version, type, language, scope, title, steps, whenToUse, whenNotToUse, commonTrap, targetTime, skipThresholdSeconds }); };

/** The official pace of a component: its official minutes over its official item count. The only source of an OFFICIAL_DERIVED time. */
export const officialSecondsPerItem = (official: { minutes: number; items: number }): number => Math.round((official.minutes * 60) / official.items);

export type SpeedStrategyIssue =
  | 'SCHEMA_INVALID' | 'DIGEST_IS_NOT_OF_THE_STRATEGY' | 'SCOPE_IS_EMPTY' | 'TYPE_NOT_FOR_THIS_COMPONENT' | 'TYPE_NEEDS_OPTIONS_THE_ITEMS_DO_NOT_HAVE' | 'SKIP_THRESHOLD_NOT_AFTER_THE_TARGET'
  | 'OFFICIAL_DERIVED_TIME_IS_NOT_THE_OFFICIAL_PACE' | 'CALIBRATED_TIME_WITHOUT_ENOUGH_OBSERVATIONS' | 'HEURISTIC_TIME_FAR_FROM_THE_OFFICIAL_PACE' | 'STRATEGY_REVEALS_AN_ANSWER' | 'NO_SHORTCUT_PROMISES_A_SHORTCUT' | 'CERTIFIED_WITHOUT_A_RECORD';

export interface StrategyContext {
  /** The official pace of the component the strategy is scoped to. */
  official: { minutes: number; items: number };
  /** The items the strategy would be attached to: their answers must not appear in the advice. */
  items: readonly { itemId: string; hasOptions: boolean; keyTexts: readonly string[] }[];
}
const flat = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const SHORTCUT_PROMISE = /\b(atajo|truco|shortcut|trick|sin calcular|without calculating)\b/;

/** Why this strategy may not be certified. Empty = it may. */
export function speedStrategyIssues(candidate: unknown, ctx: StrategyContext): SpeedStrategyIssue[] {
  const parsed = SpeedStrategySchema.safeParse(candidate);
  if (!parsed.success) return ['SCHEMA_INVALID'];
  const s = parsed.data;
  const out = new Set<SpeedStrategyIssue>();
  if (speedStrategyDigest(s) !== s.digest) out.add('DIGEST_IS_NOT_OF_THE_STRATEGY');
  if (s.scope.blueprintBucketIds.length + s.scope.conceptStableIds.length + s.scope.itemIds.length === 0) out.add('SCOPE_IS_EMPTY');
  const type = STRATEGY_TYPES[s.type];
  if (!(type.families as readonly string[]).includes(s.scope.family)) out.add('TYPE_NOT_FOR_THIS_COMPONENT');
  if (type.needsOptions && ctx.items.some((i) => !i.hasOptions)) out.add('TYPE_NEEDS_OPTIONS_THE_ITEMS_DO_NOT_HAVE');
  if (s.skipThresholdSeconds <= s.targetTime.seconds) out.add('SKIP_THRESHOLD_NOT_AFTER_THE_TARGET');
  const pace = officialSecondsPerItem(ctx.official);
  // a time says where it comes from, and the claim is checked
  if (s.targetTime.provenance === 'OFFICIAL_DERIVED' && s.targetTime.seconds !== pace) out.add('OFFICIAL_DERIVED_TIME_IS_NOT_THE_OFFICIAL_PACE');
  if (s.targetTime.provenance === 'STUDYUS_CALIBRATED' && (s.targetTime.sampleSize ?? 0) < MIN_CALIBRATION_SAMPLE) out.add('CALIBRATED_TIME_WITHOUT_ENOUGH_OBSERVATIONS');
  if (s.targetTime.provenance === 'STUDYUS_HEURISTIC' && (s.targetTime.seconds < pace * 0.4 || s.targetTime.seconds > pace * 2.5)) out.add('HEURISTIC_TIME_FAR_FROM_THE_OFFICIAL_PACE');
  // advice is about the METHOD: it never carries the answer of an item it is shown with
  const advice = flat([s.title, ...s.steps, s.whenToUse, s.whenNotToUse, s.commonTrap ?? ''].join(' | '));
  const reveals = (key: string) => { const k = flat(key); return k.length >= 4 ? advice.includes(k) : new RegExp(`(^|[^a-z0-9./,-])(= ?|respuesta:? ?|answer:? ?)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9/])`).test(advice); };
  if (s.scope.itemIds.length > 0 && ctx.items.some((i) => i.keyTexts.some(reveals))) out.add('STRATEGY_REVEALS_AN_ANSWER');
  if (s.type === 'NO_RELIABLE_SHORTCUT' && SHORTCUT_PROMISE.test(flat([s.title, ...s.steps].join(' ')).replace(/\b(no hay|sin|no|not?|ningun)\s+(un\s+|a\s+)?(atajo|truco|shortcut|trick)\b/g, ''))) out.add('NO_SHORTCUT_PROMISES_A_SHORTCUT');
  if (s.certification.state === 'CERTIFIED' && (!s.certification.mode || !s.certification.recordId)) out.add('CERTIFIED_WITHOUT_A_RECORD');
  return [...out];
}

export interface StrategyTarget { itemId: string; conceptStableId: string; blueprintBucketId: string; componentId: string; language: string }
/** The CERTIFIED strategy of an item: the most specific one in scope, newest version. None certified = null. Never a candidate, never generated. */
export function resolveStrategy(item: StrategyTarget, strategies: readonly SpeedStrategy[]): SpeedStrategy | null {
  const rank = (s: SpeedStrategy): number => (s.scope.itemIds.includes(item.itemId) ? 3 : s.scope.conceptStableIds.includes(item.conceptStableId) ? 2 : s.scope.blueprintBucketIds.includes(item.blueprintBucketId) ? 1 : 0);
  return strategies.filter((s) => s.certification.state === 'CERTIFIED' && s.scope.componentId === item.componentId && s.language === item.language && rank(s) > 0)
    .sort((a, b) => rank(b) - rank(a) || b.version - a.version || a.strategyId.localeCompare(b.strategyId))[0] ?? null;
}
export function strategyCoverage(items: readonly StrategyTarget[], strategies: readonly SpeedStrategy[]): { items: number; withStrategy: number; fraction: number; byBucket: Record<string, { items: number; withStrategy: number }> } {
  const byBucket: Record<string, { items: number; withStrategy: number }> = {};
  let withStrategy = 0;
  for (const i of items) { const has = resolveStrategy(i, strategies) !== null; const b = (byBucket[i.blueprintBucketId] ??= { items: 0, withStrategy: 0 }); b.items += 1; if (has) { b.withStrategy += 1; withStrategy += 1; } }
  return { items: items.length, withStrategy, fraction: items.length === 0 ? 0 : withStrategy / items.length, byBucket };
}

/** The two experiences. A simulation is the exam: no help while it runs. A coach session offers the strategy on request, and using it is recorded. */
export type StrategyExperience = 'PRACTICE_COACH' | 'EXAM_SIMULATION';
export type StrategyPhase = 'BEFORE_ANSWER' | 'AFTER_ANSWER' | 'REVIEW';
export function strategyVisibility(experience: StrategyExperience, phase: StrategyPhase): { visible: boolean; onRequest: boolean; marksAssisted: boolean } {
  if (phase === 'REVIEW') return { visible: true, onRequest: false, marksAssisted: false };
  if (experience === 'EXAM_SIMULATION') return { visible: false, onRequest: false, marksAssisted: false };
  return phase === 'BEFORE_ANSWER' ? { visible: true, onRequest: true, marksAssisted: true } : { visible: true, onRequest: false, marksAssisted: false };
}
/** A response is ASSISTED when the strategy was opened before it was answered. Assisted work is practice, not independent evidence of the skill. */
export function isAssisted(r: { strategyRevealedAtMs: number | null; answeredAtMs: number | null }): boolean {
  return r.strategyRevealedAtMs !== null && (r.answeredAtMs === null || r.strategyRevealedAtMs <= r.answeredAtMs);
}

export interface TimedResponse { itemId: string; seconds: number; answered: boolean; correct: boolean; assisted: boolean; targetSeconds: number; skipThresholdSeconds: number; provenance: TargetTimeProvenance }
export type TimeVerdict = 'FAST_AND_RIGHT' | 'ON_PACE_AND_RIGHT' | 'RIGHT_BUT_SLOW' | 'RUSHED_AND_WRONG' | 'WRONG_ON_PACE' | 'STUCK_PAST_THE_SKIP_POINT' | 'NOT_ANSWERED';
export function timeVerdict(r: TimedResponse): TimeVerdict {
  if (!r.answered) return r.seconds > r.skipThresholdSeconds ? 'STUCK_PAST_THE_SKIP_POINT' : 'NOT_ANSWERED';
  if (r.seconds > r.skipThresholdSeconds && !r.correct) return 'STUCK_PAST_THE_SKIP_POINT';
  if (r.correct) return r.seconds <= r.targetSeconds * 0.6 ? 'FAST_AND_RIGHT' : r.seconds <= r.targetSeconds ? 'ON_PACE_AND_RIGHT' : 'RIGHT_BUT_SLOW';
  return r.seconds <= r.targetSeconds * 0.5 ? 'RUSHED_AND_WRONG' : 'WRONG_ON_PACE';
}
/** The time review of an attempt: per response and in total. Seconds over the target are what a strategy can win back. */
export function timeReview(responses: readonly TimedResponse[]): { perItem: { itemId: string; verdict: TimeVerdict; seconds: number; targetSeconds: number; overSeconds: number; assisted: boolean; provenance: TargetTimeProvenance }[]; totalSeconds: number; targetSeconds: number; secondsOverTarget: number; secondsPastSkipPoint: number; verdicts: Partial<Record<TimeVerdict, number>>; assisted: number; onPace: boolean } {
  const perItem = responses.map((r) => ({ itemId: r.itemId, verdict: timeVerdict(r), seconds: r.seconds, targetSeconds: r.targetSeconds, overSeconds: Math.max(0, r.seconds - r.targetSeconds), assisted: r.assisted, provenance: r.provenance }));
  const verdicts: Partial<Record<TimeVerdict, number>> = {};
  for (const p of perItem) verdicts[p.verdict] = (verdicts[p.verdict] ?? 0) + 1;
  const totalSeconds = responses.reduce((n, r) => n + r.seconds, 0); const targetSeconds = responses.reduce((n, r) => n + r.targetSeconds, 0);
  return { perItem, totalSeconds, targetSeconds, secondsOverTarget: perItem.reduce((n, p) => n + p.overSeconds, 0), secondsPastSkipPoint: responses.reduce((n, r) => n + Math.max(0, r.seconds - r.skipThresholdSeconds), 0), verdicts, assisted: responses.filter((r) => r.assisted).length, onPace: totalSeconds <= targetSeconds };
}
