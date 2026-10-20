/**
 * Governed SPEED STRATEGY (pure, no IO). One engine for every exam system.
 *
 * A speed strategy is certified CONTENT, kept apart from an item's answer key and from its explanation: a typed,
 * versioned record of the fastest RELIABLE way to answer a kind of question, when not to use it, the time it should
 * take and when to move on. Strategies are reusable FAMILIES: one is certified once and inherited by the items its
 * applicability rule names -- deterministically, and only where a proof shows the fast path gives the item's key.
 *
 * Nothing here writes a strategy at runtime. The engine validates candidates (`speedStrategyIssues`), resolves the
 * certified strategy of an item (`resolveStrategy`), decides when a learner may see it (`strategyVisibility`) and
 * reviews the time of an attempt (`timeReview`). An item with no certified strategy has none: it is never improvised.
 * NO_RELIABLE_SHORTCUT is a strategy: "solve it directly, in order" is the honest advice where no shortcut is safe.
 */
import { createHash } from 'crypto';
import { z } from 'zod';

export const SPEED_STRATEGY_ENGINE_VERSION = 'speed-strategy-2';
const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');

/** The registry of strategy types. `needsOptions`: the method reads the answer choices, so it exists only for an item that shows some. */
export const STRATEGY_TYPES = {
  DIRECT_SOLVE: { needsOptions: false }, ESTIMATE: { needsOptions: false }, BOUNDING: { needsOptions: false },
  BACKSOLVE_FROM_OPTIONS: { needsOptions: true }, PLUG_IN_OPTIONS: { needsOptions: true }, ELIMINATION: { needsOptions: true }, ANSWER_CHOICE_SPACING: { needsOptions: true },
  SIGN_CHECK: { needsOptions: false }, PARITY_CHECK: { needsOptions: false }, MAGNITUDE_CHECK: { needsOptions: false }, UNIT_DIMENSION_CHECK: { needsOptions: false },
  BENCHMARK_VALUE: { needsOptions: false }, PROPORTIONAL_REASONING: { needsOptions: false }, FACTOR_PATTERN: { needsOptions: false }, ALGEBRAIC_STRUCTURE: { needsOptions: false },
  SUBSTITUTION: { needsOptions: false }, GRAPH_VISUAL_READ: { needsOptions: false }, INTERCEPT_OR_SLOPE_READ: { needsOptions: false }, SPECIAL_TRIANGLE: { needsOptions: false },
  MENTAL_ARITHMETIC: { needsOptions: false }, NO_RELIABLE_SHORTCUT: { needsOptions: false },
} as const;
export type StrategyType = keyof typeof STRATEGY_TYPES;
export const TIMING_PROVENANCES = ['OFFICIAL_DERIVED', 'STUDYUS_CALIBRATED', 'STUDYUS_HEURISTIC'] as const;
export type TimingProvenance = (typeof TIMING_PROVENANCES)[number];
/** Observed, independent, correct responses a calibrated time needs before it may call itself calibrated. */
export const MIN_CALIBRATION_SAMPLE = 30;
export const STRATEGY_CERTIFICATION_STATES = ['HUMAN_CERTIFIED', 'AUTOMATED_CERTIFIED_PILOT', 'INHERITED_DETERMINISTIC', 'CANDIDATE', 'REVIEW_REQUIRED', 'REJECTED'] as const;
export type StrategyCertificationState = (typeof STRATEGY_CERTIFICATION_STATES)[number];
/** Only these reach a learner. */
export const DELIVERABLE_STRATEGY_STATES: readonly StrategyCertificationState[] = ['HUMAN_CERTIFIED', 'AUTOMATED_CERTIFIED_PILOT', 'INHERITED_DETERMINISTIC'];

const Text = (max: number) => z.string().min(8).max(max);
export const SpeedStrategySchema = z.object({
  v: z.literal(2),
  strategyId: z.string().regex(/^strat\.[a-z0-9]+([.-][a-z0-9]+)*$/),
  strategyVersion: z.number().int().positive(),
  strategyType: z.enum(Object.keys(STRATEGY_TYPES) as [StrategyType, ...StrategyType[]]),
  /** The reusable family the strategy belongs to (what is certified once). */
  strategyFamily: z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/),
  language: z.string().min(2).max(10),
  strategyTitle: z.string().min(4).max(80),
  /** Which items inherit it. All stated conditions must hold; `stemPattern` is a regular expression over the item's stem. */
  applicabilityRules: z.object({ systemId: z.string().min(1), componentId: z.string().min(1), constructFamilyId: z.string().min(1), constructFamilyVersion: z.string().min(1), stemPattern: z.string().min(1).nullable() }),
  targetTimeSeconds: z.number().int().min(10).max(600),
  skipThresholdSeconds: z.number().int().min(15).max(900),
  timingProvenance: z.object({ target: z.enum(TIMING_PROVENANCES), skipThreshold: z.enum(TIMING_PROVENANCES), basis: Text(300), sampleSize: z.number().int().nonnegative().nullable() }),
  /** The fastest reliable method, in order. Short: advice that takes a page to read saves no time. */
  fastPath: z.array(Text(220)).min(1).max(4),
  /** The standard method: always valid, the fallback when the fast path does not fit. */
  directPath: z.array(Text(220)).min(1).max(4),
  whyFastPathWorks: Text(320),
  eliminationRules: z.array(Text(220)).max(4),
  mentalMathOpportunity: Text(260).nullable(),
  commonTimeTrap: Text(300),
  whenNotToUse: Text(300),
  /** NONE: the method never reads the answer choices. REQUIRED: it cannot be used without them. */
  answerChoiceDependency: z.enum(['NONE', 'HELPFUL', 'REQUIRED']),
  strategyCertificationState: z.enum(STRATEGY_CERTIFICATION_STATES),
  /** Who decided: a policy for an automated state, a recorded human decision for a human one. Never a person for an automated decision. */
  certification: z.object({ decidedBy: z.string().min(1), policyId: z.string().nullable(), humanDecisionId: z.string().nullable() }),
  strategyDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SpeedStrategy = z.infer<typeof SpeedStrategySchema>;
export type SpeedStrategyBody = Omit<SpeedStrategy, 'strategyDigest' | 'strategyCertificationState' | 'certification'>;
/** The digest of the advice itself. Certification is a fact ABOUT the strategy, not part of it. */
export function speedStrategyDigest(s: SpeedStrategyBody): string {
  const { v, strategyId, strategyVersion, strategyType, strategyFamily, language, strategyTitle, applicabilityRules, targetTimeSeconds, skipThresholdSeconds, timingProvenance, fastPath, directPath, whyFastPathWorks, eliminationRules, mentalMathOpportunity, commonTimeTrap, whenNotToUse, answerChoiceDependency } = s;
  return sha({ v, strategyId, strategyVersion, strategyType, strategyFamily, language, strategyTitle, applicabilityRules, targetTimeSeconds, skipThresholdSeconds, timingProvenance, fastPath, directPath, whyFastPathWorks, eliminationRules, mentalMathOpportunity, commonTimeTrap, whenNotToUse, answerChoiceDependency });
}

/** The official pace of a component: its official minutes over its official item count. The only source of an OFFICIAL_DERIVED time. */
export const officialSecondsPerItem = (official: { minutes: number; items: number }): number => Math.round((official.minutes * 60) / official.items);

export type SpeedStrategyIssue =
  | 'SCHEMA_INVALID' | 'DIGEST_IS_NOT_OF_THE_STRATEGY' | 'STEM_PATTERN_IS_NOT_A_REGULAR_EXPRESSION' | 'TYPE_NEEDS_OPTIONS_THE_ITEMS_DO_NOT_HAVE' | 'OPTION_DEPENDENCY_DISAGREES_WITH_THE_TYPE' | 'ELIMINATION_RULES_WITHOUT_OPTIONS'
  | 'SKIP_THRESHOLD_NOT_AFTER_THE_TARGET' | 'OFFICIAL_DERIVED_TIME_IS_NOT_THE_OFFICIAL_PACE' | 'CALIBRATED_TIME_WITHOUT_ENOUGH_OBSERVATIONS' | 'HEURISTIC_TIME_FAR_FROM_THE_OFFICIAL_PACE'
  | 'STRATEGY_REVEALS_AN_ANSWER' | 'NO_SHORTCUT_PROMISES_A_SHORTCUT' | 'AUTOMATED_DECISION_ATTRIBUTED_TO_A_PERSON' | 'HUMAN_STATE_WITHOUT_A_RECORDED_DECISION';

export interface StrategyContext {
  /** The official pace of the component the strategy is scoped to. */
  official: { minutes: number; items: number };
  /** The items that inherit the strategy: whether they show options, and their keys (never to appear in the advice). */
  items: readonly { itemId: string; hasOptions: boolean; keyTexts: readonly string[] }[];
}
const flat = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const SHORTCUT_PROMISE = /\b(atajo|truco|shortcut|trick)\b/;
const NEGATED_SHORTCUT = /\b(no hay|no existe|sin|ningun|no|not?)\s+(un\s+|a\s+|ningun\s+)?(atajo|truco|shortcut|trick)\b/g;
const adviceOf = (s: SpeedStrategy): string => [s.strategyTitle, ...s.fastPath, ...s.directPath, s.whyFastPathWorks, ...s.eliminationRules, s.mentalMathOpportunity ?? '', s.commonTimeTrap, s.whenNotToUse].join(' | ');

/** Why this strategy may not be certified. Empty = it may. */
export function speedStrategyIssues(candidate: unknown, ctx: StrategyContext): SpeedStrategyIssue[] {
  const parsed = SpeedStrategySchema.safeParse(candidate);
  if (!parsed.success) return ['SCHEMA_INVALID'];
  const s = parsed.data;
  const out = new Set<SpeedStrategyIssue>();
  if (speedStrategyDigest(s) !== s.strategyDigest) out.add('DIGEST_IS_NOT_OF_THE_STRATEGY');
  if (s.applicabilityRules.stemPattern !== null) { try { new RegExp(s.applicabilityRules.stemPattern, 'u'); } catch { out.add('STEM_PATTERN_IS_NOT_A_REGULAR_EXPRESSION'); } }
  const needsOptions = STRATEGY_TYPES[s.strategyType].needsOptions;
  if (needsOptions && ctx.items.some((i) => !i.hasOptions)) out.add('TYPE_NEEDS_OPTIONS_THE_ITEMS_DO_NOT_HAVE');
  if (needsOptions !== (s.answerChoiceDependency === 'REQUIRED')) out.add('OPTION_DEPENDENCY_DISAGREES_WITH_THE_TYPE');
  if (s.eliminationRules.length > 0 && ctx.items.some((i) => !i.hasOptions)) out.add('ELIMINATION_RULES_WITHOUT_OPTIONS');
  if (s.skipThresholdSeconds <= s.targetTimeSeconds) out.add('SKIP_THRESHOLD_NOT_AFTER_THE_TARGET');
  const pace = officialSecondsPerItem(ctx.official);
  // a time says where it comes from, and the claim is checked
  const check = (seconds: number, provenance: TimingProvenance): void => {
    if (provenance === 'OFFICIAL_DERIVED' && seconds !== pace) out.add('OFFICIAL_DERIVED_TIME_IS_NOT_THE_OFFICIAL_PACE');
    if (provenance === 'STUDYUS_CALIBRATED' && (s.timingProvenance.sampleSize ?? 0) < MIN_CALIBRATION_SAMPLE) out.add('CALIBRATED_TIME_WITHOUT_ENOUGH_OBSERVATIONS');
    if (provenance === 'STUDYUS_HEURISTIC' && (seconds < pace * 0.4 || seconds > pace * 3)) out.add('HEURISTIC_TIME_FAR_FROM_THE_OFFICIAL_PACE');
  };
  check(s.targetTimeSeconds, s.timingProvenance.target);
  check(s.skipThresholdSeconds, s.timingProvenance.skipThreshold);
  // advice is about the METHOD: a family never states "the answer is ..." for anything it is shown with
  if (/(respuesta|answer|resultado)( correct[ao])?( es|:| is)\s*-?\d/.test(flat(adviceOf(s)))) out.add('STRATEGY_REVEALS_AN_ANSWER');
  if (s.strategyType === 'NO_RELIABLE_SHORTCUT' && SHORTCUT_PROMISE.test(flat([s.strategyTitle, ...s.fastPath].join(' ')).replace(NEGATED_SHORTCUT, ''))) out.add('NO_SHORTCUT_PROMISES_A_SHORTCUT');
  const human = s.strategyCertificationState === 'HUMAN_CERTIFIED';
  if (human && !s.certification.humanDecisionId) out.add('HUMAN_STATE_WITHOUT_A_RECORDED_DECISION');
  if (!human && (s.certification.humanDecisionId !== null || !/^policy:/.test(s.certification.decidedBy))) out.add('AUTOMATED_DECISION_ATTRIBUTED_TO_A_PERSON');
  return [...out];
}

/** What an item says about itself, for strategy resolution. */
export interface StrategyTarget { systemId: string; componentId: string; constructFamilyId: string; constructFamilyVersion: string; language: string; stem: string; hasOptions: boolean }
const applies = (s: SpeedStrategy, t: StrategyTarget): boolean => {
  const a = s.applicabilityRules;
  if (a.systemId !== t.systemId || a.componentId !== t.componentId || a.constructFamilyId !== t.constructFamilyId || a.constructFamilyVersion !== t.constructFamilyVersion || s.language !== t.language) return false;
  if (STRATEGY_TYPES[s.strategyType].needsOptions && !t.hasOptions) return false;
  return a.stemPattern === null || new RegExp(a.stemPattern, 'u').test(t.stem);
};
/**
 * The deliverable strategy an item inherits. Exactly one must apply: none = the item has no strategy; several = the
 * registry is ambiguous for it, and then it has none either (an item never gets "one of" its strategies).
 */
export function resolveStrategy(item: StrategyTarget, strategies: readonly SpeedStrategy[]): SpeedStrategy | null {
  const found = strategies.filter((s) => DELIVERABLE_STRATEGY_STATES.includes(s.strategyCertificationState) && applies(s, item));
  // of each strategy, its newest deliverable version
  const latest = found.filter((s) => !found.some((o) => o.strategyId === s.strategyId && o.strategyVersion > s.strategyVersion));
  return latest.length === 1 ? latest[0] : null;
}
/** What an item inherits, stated: the exact family, version, digest, applicability and certification it rests on. */
export interface InheritedStrategy { strategyId: string; strategyFamily: string; strategyVersion: number; strategyType: StrategyType; strategyDigest: string; familyCertificationState: StrategyCertificationState; itemCertificationState: 'INHERITED_DETERMINISTIC'; applicability: SpeedStrategy['applicabilityRules'] }
export const inheritedStrategyOf = (s: SpeedStrategy): InheritedStrategy => ({ strategyId: s.strategyId, strategyFamily: s.strategyFamily, strategyVersion: s.strategyVersion, strategyType: s.strategyType, strategyDigest: s.strategyDigest, familyCertificationState: s.strategyCertificationState, itemCertificationState: 'INHERITED_DETERMINISTIC', applicability: s.applicabilityRules });

export function strategyCoverage(items: readonly StrategyTarget[], strategies: readonly SpeedStrategy[]): { items: number; withStrategy: number; fraction: number; byType: Partial<Record<StrategyType, number>> } {
  const byType: Partial<Record<StrategyType, number>> = {};
  let withStrategy = 0;
  for (const i of items) { const s = resolveStrategy(i, strategies); if (s) { withStrategy += 1; byType[s.strategyType] = (byType[s.strategyType] ?? 0) + 1; } }
  return { items: items.length, withStrategy, fraction: items.length === 0 ? 0 : withStrategy / items.length, byType };
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

export interface TimedResponse { itemId: string; seconds: number; answered: boolean; correct: boolean; assisted: boolean; targetSeconds: number; skipThresholdSeconds: number }
export type TimeVerdict = 'FAST_AND_RIGHT' | 'ON_PACE_AND_RIGHT' | 'RIGHT_BUT_SLOW' | 'RUSHED_AND_WRONG' | 'WRONG_ON_PACE' | 'STUCK_PAST_THE_SKIP_POINT' | 'NOT_ANSWERED';
export function timeVerdict(r: Omit<TimedResponse, 'itemId' | 'assisted'>): TimeVerdict {
  if (!r.answered) return r.seconds > r.skipThresholdSeconds ? 'STUCK_PAST_THE_SKIP_POINT' : 'NOT_ANSWERED';
  if (r.seconds > r.skipThresholdSeconds && !r.correct) return 'STUCK_PAST_THE_SKIP_POINT';
  if (r.correct) return r.seconds <= r.targetSeconds * 0.6 ? 'FAST_AND_RIGHT' : r.seconds <= r.targetSeconds ? 'ON_PACE_AND_RIGHT' : 'RIGHT_BUT_SLOW';
  return r.seconds <= r.targetSeconds * 0.5 ? 'RUSHED_AND_WRONG' : 'WRONG_ON_PACE';
}
/** The time review of an attempt: per response and in total. Seconds over the target are what a strategy can win back. */
export function timeReview(responses: readonly TimedResponse[]): { perItem: { itemId: string; verdict: TimeVerdict; seconds: number; targetSeconds: number; deltaSeconds: number; assisted: boolean }[]; totalSeconds: number; targetSeconds: number; secondsOverTarget: number; secondsPastSkipPoint: number; verdicts: Partial<Record<TimeVerdict, number>>; assisted: number; onPace: boolean } {
  const perItem = responses.map((r) => ({ itemId: r.itemId, verdict: timeVerdict(r), seconds: r.seconds, targetSeconds: r.targetSeconds, deltaSeconds: r.seconds - r.targetSeconds, assisted: r.assisted }));
  const verdicts: Partial<Record<TimeVerdict, number>> = {};
  for (const p of perItem) verdicts[p.verdict] = (verdicts[p.verdict] ?? 0) + 1;
  const totalSeconds = responses.reduce((n, r) => n + r.seconds, 0); const targetSeconds = responses.reduce((n, r) => n + r.targetSeconds, 0);
  return { perItem, totalSeconds, targetSeconds, secondsOverTarget: perItem.reduce((n, p) => n + Math.max(0, p.deltaSeconds), 0), secondsPastSkipPoint: responses.reduce((n, r) => n + Math.max(0, r.seconds - r.skipThresholdSeconds), 0), verdicts, assisted: responses.filter((r) => r.assisted).length, onPace: totalSeconds <= targetSeconds };
}
