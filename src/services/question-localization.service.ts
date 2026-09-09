/**
 * LX-4P-R2 -- SAME-ITEM QUESTION LOCALIZATION.
 *
 * Produce a translated *presentation* of an EXISTING generated question
 * -- never a new question. This is not question generation: it reuses a
 * dedicated TRANSLATE-ONLY prompt (`quiz.question_localization`), and
 * every field that carries pedagogical meaning is copied verbatim from
 * the stored original. The AI's job is only the display text; its
 * output for ids / numbers / correctAnswer / difficulty is validated
 * against the original and then discarded in favour of the original's
 * own values.
 *
 * If the translation cannot be proven semantically identical, this
 * returns `{ ok: false }` and the caller falls back to the LX-4P-R1
 * explicit-restart dialog. It never partially mutates a question.
 */
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { executeAI, getPrompt } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';
import { parseAIJson } from '@/lib/ai-json';
import type { GeneratedQuestion, AnswerFormat } from '@/services/quiz-generation.service';

/**
 * Answer formats where a text translation provably cannot disturb the
 * attempt: the learner's answer is either an option id (choice) or
 * free text they authored themselves. matching / ordering /
 * classification work off shuffled label text on the client, so an
 * in-place translation would strand an in-progress arrangement -- those
 * fall back to the explicit restart instead.
 */
export const LOCALIZABLE_ANSWER_FORMATS: ReadonlySet<AnswerFormat> = new Set<AnswerFormat>([
  'single_choice',
  'multi_choice',
  'text',
]);

export type LocalizeFailReason =
  | 'UNSUPPORTED_FORMAT'
  | 'PROVIDER_ERROR'
  | 'PARSE_ERROR'
  | 'NUMERIC_DRIFT'
  | 'FORMULA_DRIFT'
  | 'OPTION_DRIFT'
  | 'EMPTY_TEXT';

export type LocalizeResult =
  | { ok: true; question: GeneratedQuestion }
  | { ok: false; reason: LocalizeFailReason };

/** Every standalone number token (int, decimal, with optional sign/exponent). */
function numericTokens(s: string): string[] {
  return (s.match(/-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?/g) ?? []).map((t) => t.replace(',', '.'));
}

/**
 * "Math-ish" spans that must survive translation byte-for-byte: LaTeX
 * ($...$, \(...\), \[...\]), and inline symbol/operator runs (=, ^, _,
 * Greek, √ ≤ ≥ × · ± ∑ ∫ π, unit-ish slashes like m/s). Deliberately
 * broad -- a false positive only makes the check stricter.
 */
function formulaTokens(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\$[^$]+\$|\\\([^)]*\\\)|\\\[[^\]]*\\\]/g)) out.push(m[0]);
  for (const m of s.matchAll(/[A-Za-z0-9)\]]\s*[=^_]\s*[A-Za-z0-9(√]/g)) out.push(m[0].replace(/\s+/g, ''));
  for (const m of s.matchAll(/[√≤≥×·±∑∫πΩµ°]|\b\d+\s*\/\s*\d+\b/g)) out.push(m[0].replace(/\s+/g, ''));
  return out;
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

/**
 * Every localizable text field of a question, concatenated -- the unit
 * the numeric/formula invariants are checked over (translation may move
 * a number between the stem and an option, but never add/drop one).
 */
function localizableText(q: Pick<GeneratedQuestion, 'question' | 'options' | 'explanation' | 'visualAid'>): string {
  return [
    q.question,
    ...(q.options?.map((o) => o.text) ?? []),
    q.explanation ?? '',
    q.visualAid?.caption ?? '',
  ].join('');
}

interface AiLocalized {
  question: string;
  options?: { id: string; text: string }[];
  explanation?: string;
  caption?: string;
}

function buildPrompt(q: GeneratedQuestion, targetName: string): { system: string; user: string } {
  const system = `You TRANSLATE an existing exam question into ${targetName}. You are NOT writing a new question.

ABSOLUTE RULES -- a violation means your output is discarded:
- Preserve every number EXACTLY (same digits, same decimals, same order of magnitude). Do not round, convert, or restate.
- Preserve every formula, equation, variable name and symbol EXACTLY, including any $...$ / \\( \\) LaTeX -- copy it verbatim.
- Preserve every unit EXACTLY (kg stays kg, m/s stays m/s).
- Preserve the answer's meaning EXACTLY. Do not change what counts as correct.
- Keep the SAME option ids and the SAME number of options. Translate only each option's text.
- Keep the SAME question type, context, scenario and difficulty. Do NOT simplify, do NOT make it harder, do NOT invent a new example, do NOT add or remove information.
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

/**
 * Validate the AI translation against the original and, if it holds,
 * rebuild the localized question from the ORIGINAL's structural fields +
 * the AI's text. The returned object shares the original's id,
 * conceptId, type, answerFormat, correctAnswer, option ids, difficulty,
 * cognitiveLevel, expectedReasoningType, questionIntent, everything
 * except display text.
 */
export function reconcileLocalization(original: GeneratedQuestion, ai: AiLocalized): LocalizeResult {
  if (!ai || typeof ai.question !== 'string' || ai.question.trim().length === 0) {
    return { ok: false, reason: 'EMPTY_TEXT' };
  }

  // Options: exact same id set, all non-empty text.
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

  // Numeric + formula invariants over all localizable text combined.
  const beforeText = localizableText(original);
  const afterText = localizableText(localized);
  if (!multisetEqual(numericTokens(beforeText), numericTokens(afterText))) {
    return { ok: false, reason: 'NUMERIC_DRIFT' };
  }
  if (!multisetEqual(formulaTokens(beforeText), formulaTokens(afterText))) {
    return { ok: false, reason: 'FORMULA_DRIFT' };
  }

  return { ok: true, question: localized };
}

export async function localizeGeneratedQuestion(input: {
  question: GeneratedQuestion;
  targetLanguage: string;
  context?: { studentId?: string; subjectId?: string };
}): Promise<LocalizeResult> {
  const { question, targetLanguage, context } = input;

  if (!LOCALIZABLE_ANSWER_FORMATS.has(question.answerFormat)) {
    return { ok: false, reason: 'UNSUPPORTED_FORMAT' };
  }

  const targetName = LOCALE_FULL_NAME[targetLanguage] || targetLanguage;
  const { system, user } = buildPrompt(question, targetName);
  const prompt = getPrompt('quiz.question_localization');

  let ai: AiLocalized;
  try {
    const { result } = await executeAI<{ text: string }, AiLocalized>({
      capability: prompt.capability,
      // Consequence: display representation only -- the graded question,
      // correctAnswer, difficulty and evidence contract are all taken
      // from the stored original, never from this call.
      risk: 'MEDIUM_RISK',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: { ...context, conceptId: question.conceptId, sourceComponent: 'question-localization.service.ts:localizeGeneratedQuestion' },
      call: (signal) =>
        callAnthropicMessages(
          { model: 'claude-sonnet-5', maxTokens: 2000, system, messages: [{ role: 'user', content: user }] },
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

  return reconcileLocalization(question, ai);
}
