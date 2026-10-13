/**
 * QF V5.1 -- the CERTIFICATION ENVELOPE of a renderer, and the difficulty contract (pure, no IO).
 *
 * A renderer is not certified "in general". What a reviewer certifies is an envelope: this renderer version, for
 * this core version, under these adapters, in these languages and response formats, inside these parameter
 * ranges, with these lever settings per band -- and, per band, the ITEM DIFFICULTY 1..5 its instances carry.
 * An instance inside the envelope inherits the certification; one outside it does not, whatever else is true.
 *
 * DIFFICULTY. The Factory plans in FOUNDATIONAL / STANDARD / CHALLENGE. A Student's runtime knows none of those
 * words: it reads an item difficulty 1..5 and `bandOf()` (1-2 LOW, 3 MEDIUM, 4-5 HIGH). The ONE place a planning
 * band becomes a number is here, in a certified envelope, by a reviewer's decision. The number is stored on the
 * instance, written to the materialised item, and is part of the certification digest: changing the mapping
 * changes the envelope hash, and every certification bound to the old hash stops applying.
 */
import { z } from 'zod';
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { bandOf, type DifficultyBand } from '@/lib/exam-core/question-bank/quality';
import { TASK_DIFFICULTY_BANDS } from '@/lib/exam-core/question-bank/task-families/task-family';
import { ItemInstanceLineageSchema, type ItemInstanceLineage } from './item-instance-lineage';
import { DRAWN_STIMULUS_KINDS, RENDERING_STRATEGIES, type RenderedInstance } from './renderer';

export const RENDERER_ENVELOPE_CONTRACT_VERSION = 1 as const;
export const ITEM_DIFFICULTY_MIN = 1 as const;
export const ITEM_DIFFICULTY_MAX = 5 as const;
const ID = z.string().trim().min(1).max(200);
const TEXT = z.string().trim().min(3).max(700);
const ItemDifficultySchema = z.number().int().min(ITEM_DIFFICULTY_MIN).max(ITEM_DIFFICULTY_MAX);

export const EnvelopeBandSchema = z.strictObject({
  /** The planning band of the specification the renderer is given. Never shown to a Student. */
  planningBand: z.enum(TASK_DIFFICULTY_BANDS),
  /** The item difficulty every instance of this band carries. The reviewer's decision. */
  itemDifficulty: ItemDifficultySchema,
  /** What the band's instances are, lever by lever, in words a reviewer can check against the samples. */
  leverSettings: z.array(TEXT).min(1).max(8),
});
export type EnvelopeBand = z.infer<typeof EnvelopeBandSchema>;

export const RendererEnvelopeSchema = z
  .strictObject({
    v: z.literal(RENDERER_ENVELOPE_CONTRACT_VERSION),
    rendererVersion: ID,
    strategy: z.enum(RENDERING_STRATEGIES),
    construct: ID,
    constructFamilyId: ID,
    constructFamilyVersion: ID,
    /** The adapters under which instances of this envelope may be rendered. */
    adapterIds: z.array(ID).min(1).max(12),
    languages: z.array(z.string().regex(/^[a-z]{2}$/)).min(1).max(6),
    responseFormats: z.array(ID).min(1).max(8),
    /**
     * The command terms this renderer writes. A SUBSET of what an adapter governs: what a renderer can do and what
     * an assessment model allows are two things. Empty = the renderer writes no command term (a plain question).
     */
    commandTerms: z.array(ID).max(40),
    /** The parameter ranges instances stay inside. Never wider than the core's own. */
    parameterRanges: z.array(z.strictObject({ symbol: ID, min: z.number(), max: z.number(), step: z.number().positive().nullable() })).min(1).max(12),
    bands: z.array(EnvelopeBandSchema).min(1).max(TASK_DIFFICULTY_BANDS.length),
    /** Stimulus kinds an instance may carry. Empty = text only. A drawn kind is never listed: nothing draws one. */
    stimulusKinds: z.array(ID).max(6),
    /** What the envelope leaves out on purpose, so that a reviewer approves it knowingly. */
    exclusions: z.array(TEXT).max(8),
  })
  .superRefine((e, ctx) => {
    if (new Set(e.bands.map((b) => b.planningBand)).size !== e.bands.length) ctx.addIssue({ code: 'custom', path: ['bands'], message: 'BAND_LISTED_TWICE' });
    // a harder planning band never carries a lower item difficulty
    const ordered = [...e.bands].sort((x, y) => TASK_DIFFICULTY_BANDS.indexOf(x.planningBand) - TASK_DIFFICULTY_BANDS.indexOf(y.planningBand));
    if (ordered.some((b, i) => i > 0 && b.itemDifficulty < ordered[i - 1].itemDifficulty)) ctx.addIssue({ code: 'custom', path: ['bands'], message: 'DIFFICULTY_DECREASES_AS_THE_BAND_RISES' });
    for (const k of e.stimulusKinds) if (DRAWN_STIMULUS_KINDS.includes(k)) ctx.addIssue({ code: 'custom', path: ['stimulusKinds'], message: `DRAWN_REPRESENTATION_NOT_SUPPORTED: ${k}` });
    if (e.parameterRanges.some((r) => r.max < r.min)) ctx.addIssue({ code: 'custom', path: ['parameterRanges'], message: 'RANGE_ENDS_BEFORE_IT_STARTS' });
  });
export type RendererEnvelope = z.infer<typeof RendererEnvelopeSchema>;

/** The identity of an envelope. A certification names this hash; any change to the envelope is another hash. */
export const envelopeHashOf = (envelope: RendererEnvelope): string => sha256OfCanonicalJson(envelope);

/** The Student-facing bands an envelope can supply, through `bandOf()` alone. */
export function studentBandsOf(envelope: Pick<RendererEnvelope, 'bands'>): DifficultyBand[] {
  const out = new Set<DifficultyBand>();
  for (const b of envelope.bands) { const band = bandOf(b.itemDifficulty); if (band) out.add(band); }
  return (['LOW', 'MEDIUM', 'HIGH'] as const).filter((b) => out.has(b));
}

/** Envelope ranges that reach outside the core's own ranges. A certified envelope has none. */
export function rangesOutsideTheCore(envelope: Pick<RendererEnvelope, 'parameterRanges'>, coreRanges: readonly { symbol: string; min: number; max: number }[]): string[] {
  return envelope.parameterRanges.flatMap((r) => {
    const core = coreRanges.find((c) => c.symbol === r.symbol);
    return !core ? [`${r.symbol}: the core declares no such parameter`] : r.min < core.min || r.max > core.max ? [`${r.symbol}: ${r.min}..${r.max} is outside ${core.min}..${core.max}`] : [];
  });
}

/**
 * What a strategy says about one of its own parameter sets: which lever settings of the band it misses. The
 * envelope module knows no construct; each strategy supplies this for its own.
 */
export type BandConformance = (planningBand: string, parameterSet: Readonly<Record<string, number | string>>) => string[];

export interface EnvelopeContext { adapterId: string; language: string; responseFormat: string; planningBand: string; /** The command term of the specification; null when the adapter uses none. */ commandTerm: string | null }
export type EnvelopeIssueCode =
  | 'RENDERER_VERSION_IS_NOT_THE_ENVELOPES' | 'CORE_IS_NOT_THE_ENVELOPES' | 'ADAPTER_OUTSIDE_THE_ENVELOPE' | 'LANGUAGE_OUTSIDE_THE_ENVELOPE' | 'FORMAT_OUTSIDE_THE_ENVELOPE' | 'BAND_OUTSIDE_THE_ENVELOPE'
  | 'COMMAND_TERM_OUTSIDE_THE_ENVELOPE' | 'PARAMETER_OUTSIDE_THE_ENVELOPE' | 'PARAMETER_SET_IS_NOT_OF_ITS_BAND' | 'REPRESENTATION_OUTSIDE_THE_ENVELOPE' | 'STRATEGY_IS_NOT_THE_ENVELOPES';
export interface EnvelopeIssue { code: EnvelopeIssueCode; detail: string }

/** Is this rendered instance inside the envelope? Every way it is not is returned; an empty list is the only "yes". */
export function instanceEnvelopeIssues(envelope: RendererEnvelope, instance: Pick<RenderedInstance, 'strategy' | 'learner' | 'parameterSet' | 'lineage'>, ctx: EnvelopeContext, conformance: BandConformance): EnvelopeIssue[] {
  const issues: EnvelopeIssue[] = [];
  const add = (code: EnvelopeIssueCode, detail: string) => issues.push({ code, detail });
  const l = instance.lineage;
  if (l.rendererVersion !== envelope.rendererVersion) add('RENDERER_VERSION_IS_NOT_THE_ENVELOPES', `${l.rendererVersion} / ${envelope.rendererVersion}`);
  if (instance.strategy !== envelope.strategy) add('STRATEGY_IS_NOT_THE_ENVELOPES', `${instance.strategy} / ${envelope.strategy}`);
  if (l.constructFamilyId !== envelope.constructFamilyId || l.constructFamilyVersion !== envelope.constructFamilyVersion) add('CORE_IS_NOT_THE_ENVELOPES', `${l.constructFamilyId}@${l.constructFamilyVersion}`);
  if (!envelope.adapterIds.includes(ctx.adapterId) || l.assessmentAdapterId !== ctx.adapterId) add('ADAPTER_OUTSIDE_THE_ENVELOPE', ctx.adapterId);
  if (!envelope.languages.includes(ctx.language) || instance.learner.language !== ctx.language) add('LANGUAGE_OUTSIDE_THE_ENVELOPE', ctx.language);
  if (!envelope.responseFormats.includes(ctx.responseFormat) || instance.learner.itemType !== ctx.responseFormat) add('FORMAT_OUTSIDE_THE_ENVELOPE', ctx.responseFormat);
  if (!envelope.bands.some((b) => b.planningBand === ctx.planningBand)) add('BAND_OUTSIDE_THE_ENVELOPE', ctx.planningBand);
  if (ctx.commandTerm !== null && !envelope.commandTerms.includes(ctx.commandTerm)) add('COMMAND_TERM_OUTSIDE_THE_ENVELOPE', ctx.commandTerm);
  if (instance.learner.stimulus !== null && envelope.stimulusKinds.length === 0) add('REPRESENTATION_OUTSIDE_THE_ENVELOPE', 'the envelope is text only; the instance carries a stimulus');
  for (const r of envelope.parameterRanges) {
    const value = instance.parameterSet[r.symbol];
    if (typeof value !== 'number' || value < r.min || value > r.max) add('PARAMETER_OUTSIDE_THE_ENVELOPE', `${r.symbol} = ${String(value)} (${r.min}..${r.max})`);
    else if (r.step !== null && Math.abs((value - r.min) / r.step - Math.round((value - r.min) / r.step)) > 1e-9) add('PARAMETER_OUTSIDE_THE_ENVELOPE', `${r.symbol} = ${value} is off the step ${r.step}`);
  }
  for (const miss of conformance(ctx.planningBand, instance.parameterSet)) add('PARAMETER_SET_IS_NOT_OF_ITS_BAND', miss);
  return issues;
}

/** The item difficulty an instance of this band carries. null = the envelope does not cover the band: no difficulty, no delivery. */
export const itemDifficultyOf = (envelope: Pick<RendererEnvelope, 'bands'>, planningBand: string): number | null => envelope.bands.find((b) => b.planningBand === planningBand)?.itemDifficulty ?? null;

/**
 * The lineage a deliverable instance carries: the V5.1 lineage plus what certification by inheritance needs --
 * the numeric difficulty, the envelope it was rendered inside, and the hash of what the learner is given and of
 * how the response is judged. `digest` covers all of it: an instance whose difficulty, envelope, wording, key or
 * rubric differs is another instance.
 */
export const CertifiedInstanceLineageSchema = z.strictObject({
  lineage: ItemInstanceLineageSchema,
  itemDifficulty: ItemDifficultySchema,
  envelopeHash: z.string().regex(/^[a-f0-9]{64}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type CertifiedInstanceLineage = z.infer<typeof CertifiedInstanceLineageSchema>;

export const instanceContentHashOf = (instance: Pick<RenderedInstance, 'learner' | 'key' | 'rubric' | 'responsePolicy'>): string => sha256OfCanonicalJson({ learner: instance.learner, key: instance.key, rubric: instance.rubric, responsePolicy: instance.responsePolicy });
const digestOf = (x: { lineage: ItemInstanceLineage; itemDifficulty: number; envelopeHash: string; contentHash: string }): string => sha256OfCanonicalJson({ lineage: x.lineage, itemDifficulty: x.itemDifficulty, envelopeHash: x.envelopeHash, contentHash: x.contentHash });

export type CertifiedLineageResult = { ok: true; value: CertifiedInstanceLineage } | { ok: false; code: 'BAND_OUTSIDE_THE_ENVELOPE' | 'LINEAGE_INCOMPLETE'; detail: string };
export function certifiedInstanceLineageOf(envelope: RendererEnvelope, instance: Pick<RenderedInstance, 'learner' | 'key' | 'rubric' | 'responsePolicy' | 'lineage'>, planningBand: string): CertifiedLineageResult {
  const itemDifficulty = itemDifficultyOf(envelope, planningBand);
  if (itemDifficulty === null) return { ok: false, code: 'BAND_OUTSIDE_THE_ENVELOPE', detail: planningBand };
  const head = { lineage: instance.lineage, itemDifficulty, envelopeHash: envelopeHashOf(envelope), contentHash: instanceContentHashOf(instance) };
  const parsed = CertifiedInstanceLineageSchema.safeParse({ ...head, digest: digestOf(head) });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'LINEAGE_INCOMPLETE', detail: parsed.error.issues.map((i) => i.path.join('.')).join(', ') };
}
/** Has a stored lineage been altered since its digest was taken (a difficulty edited, an envelope swapped)? */
export const certifiedLineageIntact = (x: CertifiedInstanceLineage): boolean => x.digest === digestOf(x);
