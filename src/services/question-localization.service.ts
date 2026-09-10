/**
 * LX-4P-R2 / R2R1 -- SAME-ITEM QUESTION LOCALIZATION.
 *
 * Produce a translated *presentation* of an EXISTING generated question
 * -- never a new question. Every field that carries pedagogical meaning
 * is copied verbatim from the stored original; the AI only supplies
 * display text.
 *
 * LANGUAGE CONTRACT (R2R1 R5):
 *   sourceLanguage  = the language the canonical item was GENERATED in
 *                     (`quiz_sessions.language`). NEVER changes here.
 *   displayLanguage = the language of the representation currently shown
 *                     to the learner. Same-item localization only ever
 *                     changes THIS.
 *   Canonical grading always uses the stored source item + sourceLanguage.
 *   The semantic verifier compares the candidate against that source item.
 *
 * A localized presentation is used ONLY if it clears, in order and
 * fail-closed (R2R1 R4):
 *   1. structural reconciliation (option-id set, immutable fields),
 *   2. numeric-token integrity,
 *   3. formula-token integrity,
 *   4. unit / scale integrity          (R2R1 R2),
 *   5. an INDEPENDENT semantic-equivalence verification AI call, which
 *      must report equivalent === true AND correctAnswerStillValid ===
 *      true with sufficient confidence  (R2R1 R3).
 * Any failure, error or ambiguity -> `{ ok: false }` and the caller
 * falls back to the LX-4P-R1 explicit-restart dialog. A question is
 * never partially mutated.
 */
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { executeAI, getPrompt } from '@/lib/ai';
import { callModel } from '@/lib/ai/adapters/call-model';
import { resolveModels } from '@/lib/ai/model-routing';
import { budgetFor } from '@/lib/ai/token-budgets';
import { LOCALIZATION_PAYLOAD_SCHEMA, SEMANTIC_VERDICT_SCHEMA } from '@/lib/ai/schemas';
import { parseAIJson } from '@/lib/ai-json';
import type { GeneratedQuestion, AnswerFormat } from '@/services/quiz-generation.service';

/**
 * Answer formats where a text translation provably cannot disturb the
 * attempt: the learner's answer is either an option id (choice) or free
 * text they authored. matching / ordering / classification work off
 * shuffled label text on the client, so an in-place translation would
 * strand an in-progress arrangement -- those fall back to the restart.
 */
export const LOCALIZABLE_ANSWER_FORMATS: ReadonlySet<AnswerFormat> = new Set<AnswerFormat>([
  'single_choice',
  'multi_choice',
  'text',
]);

/** Minimum verifier confidence for a localization to be accepted. */
export const SEMANTIC_VERIFY_MIN_CONFIDENCE = 0.75;

export type LocalizeFailReason =
  | 'UNSUPPORTED_FORMAT'
  | 'PROVIDER_ERROR'
  | 'PARSE_ERROR'
  | 'NUMERIC_DRIFT'
  | 'FORMULA_DRIFT'
  | 'UNIT_DRIFT'
  | 'OPTION_DRIFT'
  | 'EMPTY_TEXT'
  | 'SEMANTIC_VERIFY_ERROR'
  | 'SEMANTIC_MISMATCH'
  | 'SEMANTIC_LOW_CONFIDENCE';

export type LocalizeResult =
  | { ok: true; question: GeneratedQuestion }
  | { ok: false; reason: LocalizeFailReason };

/* ------------------------------------------------------------------ */
/* structural / lexical integrity (pure)                              */
/* ------------------------------------------------------------------ */

/** Every standalone number token (int, decimal, with optional sign/exponent). */
function numericTokens(s: string): string[] {
  return (s.match(/-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?/g) ?? []).map((t) => t.replace(',', '.'));
}

/**
 * "Math-ish" spans that must survive translation byte-for-byte: LaTeX
 * ($...$, \(...\), \[...\]), inline operator runs (=, ^, _), and a set
 * of symbols. Deliberately broad -- a false positive only makes the
 * check stricter.
 */
function formulaTokens(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\$[^$]+\$|\\\([^)]*\\\)|\\\[[^\]]*\\\]/g)) out.push(m[0]);
  for (const m of s.matchAll(/[A-Za-z0-9)\]]\s*[=^_]\s*[A-Za-z0-9(√]/g)) out.push(m[0].replace(/\s+/g, ''));
  for (const m of s.matchAll(/[√≤≥×·±∑∫πΩµ]|\b\d+\s*\/\s*\d+\b/g)) out.push(m[0].replace(/\s+/g, ''));
  return out;
}

/**
 * R2R1 R2 -- unit / scale integrity. Two multisets that must match
 * before/after:
 *   a) `<number><unit>` adjacency pairs  -- catches 5 m -> 5 km,
 *      4 m/s -> 4 km/h (the number is unchanged so numericTokens passes,
 *      but the pair changes).
 *   b) bare unit tokens                  -- catches 20 °C -> 20 °F.
 * The check is not about typographic form (" m/s " vs " m·s⁻¹ "): it is
 * about the physical quantity and its scale. No unit conversion is ever
 * performed here.
 */
// Every unit we recognise -- only ever matched immediately after a
// number, so a bare English "A" (article) or "m" (variable) can't be
// mistaken for amperes/metres here.
const UNIT_ANY =
  '(?:km\\/h|m\\/s(?:\\^?2|²)?|rad\\/s|kg\\/m3|g\\/cm3|kg|mg|µg|ug|cm|mm|nm|km|kHz|MHz|GHz|Hz|kPa|MPa|GPa|Pa|kWh|kJ|MJ|kW|MW|mW|kV|mV|mA|µA|nA|kΩ|MΩ|Ω|°C|°F|°K|°|K|mol|rad|min|ms|µs|ns|N·m|Nm|N|J|W|V|A|m|g|s|h|%)';
// Units safe to count when NOT number-adjacent -- excludes single
// letters and other tokens that collide with ordinary prose.
const UNIT_BARE =
  '(?:km\\/h|m\\/s(?:\\^?2|²)?|rad\\/s|kg\\/m3|g\\/cm3|kg|mg|µg|cm|mm|nm|km|kHz|MHz|GHz|Hz|kPa|MPa|GPa|Pa|kWh|kJ|MJ|kW|MW|mW|kV|mV|mA|µA|nA|kΩ|MΩ|Ω|°C|°F|°K|°|mol|rad|min|ms|µs|ns|N·m|Nm|%)';
const NUM_UNIT_RE = new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*(${UNIT_ANY})(?![A-Za-zµ0-9])`, 'g');
const BARE_UNIT_RE = new RegExp(`(?<![A-Za-zµ0-9])${UNIT_BARE}(?![A-Za-zµ0-9])`, 'g');

function normUnit(u: string): string {
  return u
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('²', '2')
    .replace('^2', '2')
    .replace('·', '')
    .replace('°k', 'k');
}

/**
 * R2R1 R2 -- physical-quantity / scale invariants:
 *   pairs = every `<number><unit>` adjacency  (catches 5 m -> 5 km,
 *           4 m/s -> 4 km/h -- the number is unchanged so numericTokens
 *           passes, the pair does not),
 *   bare  = every non-ambiguous bare unit      (catches 20 °C -> 20 °F).
 * Typographic form is normalised away; scale is not.
 */
function unitTokens(s: string): { pairs: string[]; bare: string[] } {
  const pairs: string[] = [];
  for (const m of s.matchAll(NUM_UNIT_RE)) pairs.push(`${m[1].replace(',', '.')}::${normUnit(m[2])}`);
  const bare: string[] = [];
  for (const m of s.matchAll(BARE_UNIT_RE)) bare.push(normUnit(m[0]));
  return { pairs, bare };
}

function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const count = new Map<string, number>();
  for (const x of a) count.set(x, (count.get(x) ?? 0) + 1);
  for (const x of b) {
    const n = count.get(x);
    if (!n) return false;
    count.set(x, n - 1);
  }
  return true;
}

/** Every localizable text field of a question, concatenated. */
function localizableText(q: Pick<GeneratedQuestion, 'question' | 'options' | 'explanation' | 'visualAid'>): string {
  return [
    q.question,
    ...(q.options?.map((o) => o.text) ?? []),
    q.explanation ?? '',
    q.visualAid?.caption ?? '',
  ].join('  ⁣  ');
}

interface AiLocalized {
  question: string;
  options?: { id: string; text: string }[];
  explanation?: string;
  caption?: string;
}

/**
 * Structural + lexical reconciliation. Rebuilds the localized question
 * from the ORIGINAL's structural fields + the AI's text, then checks the
 * numeric / formula / unit multiset invariants. Does NOT run the
 * semantic verifier -- that is a separate, independent step in
 * `localizeGeneratedQuestion`.
 */
export function reconcileLocalization(original: GeneratedQuestion, ai: AiLocalized): LocalizeResult {
  if (!ai || typeof ai.question !== 'string' || ai.question.trim().length === 0) {
    return { ok: false, reason: 'EMPTY_TEXT' };
  }

  let localizedOptions = original.options;
  if (original.options?.length) {
    const aiById = new Map((ai.options ?? []).map((o) => [o?.id, o?.text]));
    if (aiById.size !== original.options.length) return { ok: false, reason: 'OPTION_DRIFT' };
    const rebuilt: { id: string; text: string }[] = [];
    for (const o of original.options) {
      const text = aiById.get(o.id);
      if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, reason: 'OPTION_DRIFT' };
      rebuilt.push({ id: o.id, text });
    }
    localizedOptions = rebuilt;
  } else if (ai.options && ai.options.length > 0) {
    return { ok: false, reason: 'OPTION_DRIFT' };
  }

  const localized: GeneratedQuestion = {
    ...original,
    question: ai.question,
    options: localizedOptions,
    explanation: typeof ai.explanation === 'string' && ai.explanation.trim() ? ai.explanation : original.explanation,
    visualAid: original.visualAid
      ? {
          ...original.visualAid,
          caption:
            typeof ai.caption === 'string' && ai.caption.trim() ? ai.caption : original.visualAid.caption,
        }
      : original.visualAid,
  };

  const beforeText = localizableText(original);
  const afterText = localizableText(localized);

  if (!multisetEqual(numericTokens(beforeText), numericTokens(afterText))) {
    return { ok: false, reason: 'NUMERIC_DRIFT' };
  }
  if (!multisetEqual(formulaTokens(beforeText), formulaTokens(afterText))) {
    return { ok: false, reason: 'FORMULA_DRIFT' };
  }
  const bu = unitTokens(beforeText);
  const au = unitTokens(afterText);
  if (!multisetEqual(bu.pairs, au.pairs) || !multisetEqual(bu.bare, au.bare)) {
    return { ok: false, reason: 'UNIT_DRIFT' };
  }

  return { ok: true, question: localized };
}

/* ------------------------------------------------------------------ */
/* R2R1 R3 -- independent semantic-equivalence verification           */
/* ------------------------------------------------------------------ */

export interface SemanticVerdict {
  equivalent: boolean;
  correctAnswerStillValid: boolean;
  semanticDifferences: string[];
  confidence: number;
}

export type VerdictEvaluation = { pass: true } | { pass: false; reason: LocalizeFailReason };

/**
 * Pure interpretation of a verifier verdict against the fail-closed
 * rule (R2R1 R4). Anything other than an unambiguous "equivalent, and
 * the stored answer is still correct, with real confidence" is a
 * rejection.
 */
export function evaluateVerdict(v: SemanticVerdict | null | undefined): VerdictEvaluation {
  if (
    !v ||
    typeof v.equivalent !== 'boolean' ||
    typeof v.correctAnswerStillValid !== 'boolean' ||
    typeof v.confidence !== 'number' ||
    Number.isNaN(v.confidence)
  ) {
    return { pass: false, reason: 'SEMANTIC_VERIFY_ERROR' };
  }
  if (!v.equivalent || !v.correctAnswerStillValid) {
    return { pass: false, reason: 'SEMANTIC_MISMATCH' };
  }
  if (v.confidence < SEMANTIC_VERIFY_MIN_CONFIDENCE) {
    return { pass: false, reason: 'SEMANTIC_LOW_CONFIDENCE' };
  }
  return { pass: true };
}

function buildVerifyPrompt(
  original: GeneratedQuestion,
  candidate: GeneratedQuestion,
  sourceName: string,
  displayName: string,
): { system: string; user: string } {
  const system = `You VERIFY whether a localized exam question still asks exactly the same thing as its canonical source. You do NOT translate, rewrite, improve or fix anything -- you only judge.

Check every one of these; ANY difference means not equivalent:
- Is it the same question being asked, about the same scenario/context, with the same requested task?
- Logical polarity: negations preserved? ("NOT correct" must stay "NOT correct", never "correct").
- Comparisons preserved? (greater/less/at least/at most, increase/decrease, more/fewer -- never flipped).
- Quantities and their units preserved? (5 m stays 5 m, not 5 km; 20 °C stays 20 °C, not 20 °F or 293 K).
- Causal and directional relations preserved? (cause vs consequence, clockwise vs counter-clockwise, before vs after).
- Temporal relations preserved?
- Superlatives/quantifiers preserved? (minimum vs maximum, always vs sometimes).
- Each option's MEANING preserved (option ids are fixed; only wording may differ)?
- Given the stored correctAnswer, is that answer STILL correct for the localized question?

Output ONLY this JSON, no markdown fences:
{"equivalent": <bool>, "correctAnswerStillValid": <bool>, "semanticDifferences": ["<short phrase>", ...], "confidence": <0..1>}
"confidence" is how sure you are of this verdict. If you are unsure, say so with a low confidence -- do not guess "equivalent".`;

  const payload = {
    sourceLanguage: sourceName,
    displayLanguage: displayName,
    questionType: original.type,
    correctAnswer: original.correctAnswer,
    optionIds: original.options?.map((o) => o.id) ?? null,
    source: {
      question: original.question,
      options: original.options?.map((o) => ({ id: o.id, text: o.text })) ?? null,
    },
    candidate: {
      question: candidate.question,
      options: candidate.options?.map((o) => ({ id: o.id, text: o.text })) ?? null,
    },
  };
  return {
    system,
    user: `Verify this localization. Return the JSON verdict.\n\n${JSON.stringify(payload, null, 2)}`,
  };
}

export async function verifyLocalizationEquivalence(input: {
  original: GeneratedQuestion;
  candidate: GeneratedQuestion;
  sourceLanguage: string;
  displayLanguage: string;
  context?: { studentId?: string; subjectId?: string };
}): Promise<SemanticVerdict | null> {
  const { original, candidate, sourceLanguage, displayLanguage, context } = input;
  const prompt = getPrompt('quiz.question_localization_verify');
  const { system, user } = buildVerifyPrompt(
    original,
    candidate,
    LOCALE_FULL_NAME[sourceLanguage] || sourceLanguage,
    LOCALE_FULL_NAME[displayLanguage] || displayLanguage,
  );
  // LX-4P-PERF-R1C C11: semantic equivalence -> stronger OpenAI eval model (Terra).
  const vRoute = resolveModels(prompt.capability);
  const vBudget = budgetFor('semantic_verification');
  try {
    const { result } = await executeAI<{ text: string }, SemanticVerdict>({
      capability: prompt.capability,
      // Consequence: this verdict gates whether a localized presentation
      // may stand in for the canonical graded item -- protects evidence.
      risk: 'HIGH_RISK',
      provider: vRoute.provider,
      model: vRoute.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: {
        ...context,
        conceptId: original.conceptId,
        sourceComponent: 'question-localization.service.ts:verifyLocalizationEquivalence',
      },
      call: (signal) =>
        callModel(
          { provider: vRoute.provider, model: vRoute.primary, system, user, maxTokens: vBudget.maxOutputTokens, jsonSchema: SEMANTIC_VERDICT_SCHEMA, reasoningEffort: vBudget.reasoningEffort },
          signal,
        ),
      validate: (raw) => {
        try {
          const p = parseAIJson<SemanticVerdict>(raw.text || '{}');
          if (!p || typeof p.equivalent !== 'boolean' || typeof p.correctAnswerStillValid !== 'boolean') {
            return { valid: false, errors: ['bad verdict shape'] };
          }
          return {
            valid: true,
            value: {
              equivalent: p.equivalent,
              correctAnswerStillValid: p.correctAnswerStillValid,
              semanticDifferences: Array.isArray(p.semanticDifferences) ? p.semanticDifferences.slice(0, 12) : [],
              confidence: typeof p.confidence === 'number' ? p.confidence : 0,
            },
          };
        } catch {
          return { valid: false, errors: ['parse error'] };
        }
      },
    });
    return result;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* translation                                                        */
/* ------------------------------------------------------------------ */

function buildPrompt(q: GeneratedQuestion, targetName: string): { system: string; user: string } {
  const system = `You TRANSLATE an existing exam question into ${targetName}. You are NOT writing a new question.

ABSOLUTE RULES -- a violation means your output is discarded:
- Preserve every number EXACTLY (same digits, same decimals, same order of magnitude). Do not round, convert, or restate.
- Preserve every formula, equation, variable name and symbol EXACTLY, including any $...$ / \\( \\) LaTeX -- copy it verbatim.
- Preserve every unit and its scale EXACTLY (m stays m, never km; °C stays °C, never °F or K; m/s stays m/s, never km/h). Never convert units.
- Preserve logical polarity EXACTLY: keep every negation ("NOT", "never", "false"), every comparison (greater/less, increase/decrease, at least/at most), every superlative (minimum/maximum), every directional/causal/temporal relation.
- Preserve the answer's meaning EXACTLY. Do not change what counts as correct.
- Keep the SAME option ids and the SAME number of options. Translate only each option's text; keep each option's meaning.
- Keep the SAME question type, context, scenario, requested task and difficulty. Do NOT simplify, do NOT make it harder, do NOT invent a new example, do NOT add or remove information.
- Translate ONLY natural-language text (the prompt/stem, option text, explanation, diagram caption).

Output ONLY this JSON, no markdown fences:
{"question":"<translated stem>","options":[{"id":"<id>","text":"<translated>"}],"explanation":"<translated or omitted>","caption":"<translated or omitted>"}
Omit "options" if the source has none. Omit "explanation"/"caption" if the source has none.`;

  const payload: Record<string, unknown> = { question: q.question };
  if (q.options?.length) payload.options = q.options.map((o) => ({ id: o.id, text: o.text }));
  if (q.explanation) payload.explanation = q.explanation;
  if (q.visualAid?.caption) payload.caption = q.visualAid.caption;
  const user = `Translate this question into ${targetName}. Return the JSON described.\n\n${JSON.stringify(payload, null, 2)}`;
  return { system, user };
}

export async function localizeGeneratedQuestion(input: {
  question: GeneratedQuestion;
  /** Language of the representation to show the learner (NOT the stored session language). */
  displayLanguage: string;
  /** The language the canonical item was generated in (`quiz_sessions.language`) -- unchanged by this call. */
  sourceLanguage: string;
  context?: { studentId?: string; subjectId?: string };
}): Promise<LocalizeResult> {
  const { question, displayLanguage, sourceLanguage, context } = input;

  if (!LOCALIZABLE_ANSWER_FORMATS.has(question.answerFormat)) {
    return { ok: false, reason: 'UNSUPPORTED_FORMAT' };
  }

  const { system, user } = buildPrompt(question, LOCALE_FULL_NAME[displayLanguage] || displayLanguage);
  const prompt = getPrompt('quiz.question_localization');
  // LX-4P-PERF-R1C C11: display-text transform -> OpenAI Luna primary, strict schema.
  const lRoute = resolveModels(prompt.capability);
  const lBudget = budgetFor('question_localization');

  let ai: AiLocalized;
  try {
    const { result } = await executeAI<{ text: string }, AiLocalized>({
      capability: prompt.capability,
      risk: 'MEDIUM_RISK',
      provider: lRoute.provider,
      model: lRoute.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: { ...context, conceptId: question.conceptId, sourceComponent: 'question-localization.service.ts:localizeGeneratedQuestion' },
      call: (signal) =>
        callModel(
          { provider: lRoute.provider, model: lRoute.primary, system, user, maxTokens: lBudget.maxOutputTokens, jsonSchema: LOCALIZATION_PAYLOAD_SCHEMA, reasoningEffort: lBudget.reasoningEffort },
          signal,
        ),
      validate: (raw) => {
        try {
          const parsed = parseAIJson<AiLocalized>(raw.text || '{}');
          if (!parsed || typeof parsed.question !== 'string') {
            return { valid: false, errors: ['missing question'] };
          }
          return { valid: true, value: parsed };
        } catch {
          return { valid: false, errors: ['parse error'] };
        }
      },
    });
    ai = result;
  } catch {
    return { ok: false, reason: 'PROVIDER_ERROR' };
  }

  // 1-4: structural + numeric + formula + unit integrity.
  const structural = reconcileLocalization(question, ai);
  if (!structural.ok) return structural;

  // 5: independent semantic-equivalence verification (fail-closed).
  const verdict = await verifyLocalizationEquivalence({
    original: question,
    candidate: structural.question,
    sourceLanguage,
    displayLanguage,
    context,
  });
  const evaluated = evaluateVerdict(verdict);
  if (!evaluated.pass) return { ok: false, reason: evaluated.reason };

  return { ok: true, question: structural.question };
}
