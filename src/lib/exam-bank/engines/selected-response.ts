/**
 * Governed SELECTED RESPONSE (pure, no IO). One engine for every exam system: nothing here names one.
 *
 * A selected-response item is a stem, options with opaque ids, ONE keyed option, and for every other option the
 * misconception it was written to reveal. The engine decides whether such an item may be certified
 * (`selectedResponseIssues`), presents it in a shuffled order (`presentOptions`) and scores it by option IDENTITY
 * (`scoreSelectedResponse`), so that no position, order or wording ever carries the answer.
 *
 * Flow: coverage gap -> candidate -> these validators -> certification -> Exam Bank -> runtime. A candidate never
 * reaches a Student from here: this module has no delivery function.
 */
import { createHash } from 'crypto';
import { z } from 'zod';

export const SELECTED_RESPONSE_ENGINE_VERSION = 'selected-response-1';
const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');

export const SelectedResponseOptionSchema = z.object({
  /** Opaque and stable. Never a letter, a position or a hint: scoring and exposure key on it. */
  id: z.string().regex(/^o-[a-f0-9]{8}$/),
  text: z.string().min(1).max(600),
  role: z.enum(['KEY', 'DISTRACTOR']),
  /** DISTRACTOR: the modelled misconception a learner who picks it holds. */
  misconceptionId: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/).nullable(),
  /** Why the option is right (KEY) or attractive and wrong (DISTRACTOR). Server-side; shown only in review. */
  rationale: z.string().min(10).max(600),
});
export type SelectedResponseOption = z.infer<typeof SelectedResponseOptionSchema>;

export const SelectedResponseItemSchema = z.object({
  v: z.literal(1),
  itemId: z.string().min(1).max(120),
  language: z.string().min(2).max(10),
  stem: z.string().min(10).max(4000),
  options: z.array(SelectedResponseOptionSchema).min(3).max(6),
  difficulty: z.number().int().min(1).max(5),
  /** The canonical concept the item is OF, and the blueprint bucket it fills. */
  conceptStableId: z.string().min(1),
  blueprintBucketId: z.string().min(1),
  /** The stimulus the item is read against, by identity, version and digest. null = self-contained. */
  stimulus: z.object({ stimulusId: z.string().min(1), version: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/) }).nullable(),
  rights: z.object({ category: z.string().min(1), basis: z.string().min(10) }),
  lineage: z.object({ source: z.string().min(1), generator: z.string().nullable(), coverageGap: z.string().min(1) }),
  /** The speed strategy that applies to the item, by digest. null = none certified yet. */
  speedStrategyDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
export type SelectedResponseItem = z.infer<typeof SelectedResponseItemSchema>;

/** A stable opaque id for an option, from the item and the option's own text (never from its position or role). */
export const optionIdOf = (itemId: string, text: string): string => `o-${sha([itemId, text.trim()]).slice(0, 8)}`;
export const selectedResponseDigest = (i: SelectedResponseItem): string => sha({ ...i, options: [...i.options].sort((a, b) => a.id.localeCompare(b.id)) });

export interface SelectedResponsePolicy { minOptions: number; maxKeyLengthRatio: number; minDistinctMisconceptions: number; numericSpreadFactor: number }
export const DEFAULT_SELECTED_RESPONSE_POLICY: SelectedResponsePolicy = { minOptions: 4, maxKeyLengthRatio: 1.6, minDistinctMisconceptions: 2, numericSpreadFactor: 20 };

export type SelectedResponseIssue =
  | 'SCHEMA_INVALID' | 'NOT_EXACTLY_ONE_KEY' | 'TOO_FEW_OPTIONS' | 'OPTION_ID_IS_NOT_OF_ITS_TEXT' | 'DUPLICATE_OPTION' | 'DISTRACTOR_WITHOUT_A_MISCONCEPTION' | 'TOO_FEW_DISTINCT_MISCONCEPTIONS'
  | 'KEY_HAS_A_MISCONCEPTION' | 'CATCH_ALL_OPTION' | 'KEY_STANDS_OUT_BY_LENGTH' | 'ABSOLUTE_WORDING_SINGLES_OUT_AN_OPTION' | 'KEY_REPEATS_THE_STEM' | 'NUMERIC_DISTRACTOR_NOT_COMPETITIVE' | 'OPTION_FORMATS_DIFFER';

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9% ./,-]+/g, ' ').replace(/\s+/g, ' ').trim();
const CATCH_ALL = /\b(todas las anteriores|ninguna de las anteriores|all of the above|none of the above|a y b|both a and b)\b/;
const ABSOLUTE = /\b(siempre|nunca|todos|ninguno|unicamente|solamente|always|never|all|none|only)\b/;
const numberOf = (s: string): number | null => { const t = s.trim().replace(/\s/g, '').replace(',', '.'); const f = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(t); if (f) return Number(f[1]) / Number(f[2]); return /^-?\d+(?:\.\d+)?%?$/.test(t) ? Number(t.replace('%', '')) : null; };
const words = (s: string): string[] => norm(s).split(' ').filter((w) => w.length >= 6);

/** Why this item may not be certified as selected response. Empty = it may. Every reason is a named, checkable property. */
export function selectedResponseIssues(candidate: unknown, policy: SelectedResponsePolicy = DEFAULT_SELECTED_RESPONSE_POLICY): SelectedResponseIssue[] {
  const parsed = SelectedResponseItemSchema.safeParse(candidate);
  if (!parsed.success) return ['SCHEMA_INVALID'];
  const i = parsed.data;
  const out = new Set<SelectedResponseIssue>();
  const keys = i.options.filter((o) => o.role === 'KEY');
  const distractors = i.options.filter((o) => o.role === 'DISTRACTOR');
  if (keys.length !== 1) out.add('NOT_EXACTLY_ONE_KEY');
  if (i.options.length < policy.minOptions) out.add('TOO_FEW_OPTIONS');
  if (i.options.some((o) => o.id !== optionIdOf(i.itemId, o.text))) out.add('OPTION_ID_IS_NOT_OF_ITS_TEXT');
  if (new Set(i.options.map((o) => norm(o.text))).size !== i.options.length || new Set(i.options.map((o) => o.id)).size !== i.options.length) out.add('DUPLICATE_OPTION');
  // every wrong option is wrong for a modelled reason: that is what makes a distractor diagnostic and competitive
  if (distractors.some((o) => !o.misconceptionId)) out.add('DISTRACTOR_WITHOUT_A_MISCONCEPTION');
  if (new Set(distractors.map((o) => o.misconceptionId).filter(Boolean)).size < Math.min(policy.minDistinctMisconceptions, distractors.length)) out.add('TOO_FEW_DISTINCT_MISCONCEPTIONS');
  if (keys.some((o) => o.misconceptionId !== null)) out.add('KEY_HAS_A_MISCONCEPTION');
  if (i.options.some((o) => CATCH_ALL.test(norm(o.text)))) out.add('CATCH_ALL_OPTION');
  const key = keys[0];
  if (key && distractors.length > 0) {
    // ---- no wording leakage: the key is not the one option that looks different
    const mean = distractors.reduce((n, o) => n + o.text.length, 0) / distractors.length;
    if (key.text.length > mean * policy.maxKeyLengthRatio && key.text.length > Math.max(...distractors.map((o) => o.text.length)) && key.text.length - mean > 12) out.add('KEY_STANDS_OUT_BY_LENGTH');
    const absolute = i.options.filter((o) => ABSOLUTE.test(norm(o.text)));
    if (absolute.length === 1 || (absolute.length === i.options.length - 1 && !ABSOLUTE.test(norm(key.text)))) out.add('ABSOLUTE_WORDING_SINGLES_OUT_AN_OPTION');
    const stemWords = new Set(words(i.stem));
    const echo = (o: SelectedResponseOption) => words(o.text).filter((w) => stemWords.has(w)).length;
    if (echo(key) >= 2 && distractors.every((o) => echo(o) === 0)) out.add('KEY_REPEATS_THE_STEM');
    // ---- numeric options: all of one written form, and no distractor absurdly far from the key
    const nums = i.options.map((o) => numberOf(o.text));
    if (nums.some((x) => x !== null) && nums.some((x) => x === null)) out.add('OPTION_FORMATS_DIFFER');
    const k = numberOf(key.text);
    if (k !== null && nums.every((x) => x !== null)) {
      const scale = Math.max(Math.abs(k), 1);
      if (distractors.some((o) => Math.abs((numberOf(o.text) as number) - k) > scale * policy.numericSpreadFactor)) out.add('NUMERIC_DISTRACTOR_NOT_COMPETITIVE');
    }
  }
  return [...out];
}

/** The options in the order one presentation shows them: a deterministic shuffle of the seed (an attempt, a position). No role, no rationale. */
export function presentOptions(item: SelectedResponseItem, seed: string): { id: string; text: string }[] {
  return [...item.options].sort((a, b) => sha([seed, a.id]).localeCompare(sha([seed, b.id]))).map((o) => ({ id: o.id, text: o.text }));
}

/** Scored by option IDENTITY: the same selection scores the same whatever order it was shown in. An id that is not of the item is not an answer. */
export function scoreSelectedResponse(item: SelectedResponseItem, selectedOptionId: string | null): { answered: boolean; correct: boolean; fraction: 0 | 1; misconceptionId: string | null } {
  const chosen = item.options.find((o) => o.id === selectedOptionId);
  if (!chosen) return { answered: false, correct: false, fraction: 0, misconceptionId: null };
  return { answered: true, correct: chosen.role === 'KEY', fraction: chosen.role === 'KEY' ? 1 : 0, misconceptionId: chosen.misconceptionId };
}

/** Across a set of items and the seeds they will be shown with: how often the key lands on each position. A form whose key favours a position leaks it. */
export function keyPositionCounts(items: readonly SelectedResponseItem[], seedOf: (item: SelectedResponseItem) => string): number[] {
  const counts: number[] = [];
  for (const i of items) { const at = presentOptions(i, seedOf(i)).findIndex((o) => i.options.find((x) => x.id === o.id)?.role === 'KEY'); counts[at] = (counts[at] ?? 0) + 1; }
  return Array.from(counts, (n) => n ?? 0);
}

/** The delivery fields of a certified selected-response item, in the shape the Exam Core delivers and scores (by option id). */
export function selectedResponseBankFields(item: SelectedResponseItem): { type: 'multiple_choice'; answerFormat: 'single_choice'; question: string; options: { id: string; text: string }[]; correctAnswer: string; distractorRationale: Record<string, string>; distractorMisconceptions: Record<string, string> } {
  const issues = selectedResponseIssues(item);
  if (issues.length > 0) throw new Error(`SELECTED_RESPONSE_NOT_CERTIFIABLE: ${issues.join(', ')}`);
  const stored = [...item.options].sort((a, b) => a.id.localeCompare(b.id));
  const distractors = stored.filter((o) => o.role === 'DISTRACTOR');
  return {
    type: 'multiple_choice', answerFormat: 'single_choice', question: item.stem,
    // stored in id order (never key-first); every presentation shuffles it again
    options: stored.map((o) => ({ id: o.id, text: o.text })), correctAnswer: stored.find((o) => o.role === 'KEY')!.id,
    distractorRationale: Object.fromEntries(distractors.map((o) => [o.id, o.rationale.slice(0, 400)])),
    distractorMisconceptions: Object.fromEntries(distractors.map((o) => [o.id, o.misconceptionId!])),
  };
}
