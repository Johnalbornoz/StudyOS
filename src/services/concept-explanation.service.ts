import { query } from '@/lib/db';
import { retrieveContext } from './rag.service';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { parseAIJson } from '@/lib/ai-json';
import { generateInteractiveFormula, InteractiveFormula } from './interactive-formula.service';
import { executeAI, getPrompt } from '@/lib/ai';
import { callModel } from '@/lib/ai/adapters/call-model';
import { resolveModels } from '@/lib/ai/model-routing';
import { budgetFor, fitContextChunks } from '@/lib/ai/token-budgets';

export interface ConceptExplanation {
  summary: string;
  sections: { heading: string; body: string }[];
  examples: string[];
  /**
   * LX-4P-PERF-R1D: OPTIONAL enrichment. NOT produced on the MODEL
   * critical path -- present only once the separate
   * `GET /api/concepts/[id]/interactive-formula` request has generated
   * and cached it. Absent otherwise; the UI renders MODEL without it.
   */
  interactiveFormula?: InteractiveFormula;
  /**
   * LX-4P-PERF-R1D: eligibility flags carried so the deferred
   * interactive-formula request never has to re-run `concept.explanation`
   * to decide whether a widget is even applicable (R6).
   */
  hasFormula?: boolean;
  formulaHint?: string;
}

/**
 * Returns the parsed explanation, or null if `raw` isn't valid
 * structured JSON -- e.g. a response truncated by max_tokens before
 * it finished, or content cached before this structured format
 * existed. Callers must not fall back to displaying `raw` directly:
 * it's either mid-sentence garbage or an unrelated legacy format,
 * never something a student should see rendered as prose.
 */
function tryParseExplanation(raw: string): ConceptExplanation | null {
  try {
    const parsed = parseAIJson(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.summary === 'string' && Array.isArray(parsed.sections)) {
      return {
        summary: parsed.summary,
        sections: parsed.sections
          .filter((s: any) => s && typeof s.heading === 'string' && typeof s.body === 'string')
          .map((s: any) => ({ heading: s.heading, body: s.body })),
        examples: Array.isArray(parsed.examples) ? parsed.examples.filter((e: any) => typeof e === 'string') : [],
        interactiveFormula: parsed.interactiveFormula ?? undefined,
        hasFormula: parsed.hasFormula === true ? true : undefined,
        formulaHint: typeof parsed.formulaHint === 'string' ? parsed.formulaHint : undefined,
      };
    }
  } catch {
    // handled below
  }
  return null;
}

export async function getConceptExplanation(
  studentId: string,
  conceptId: string,
  language: string = 'en'
): Promise<ConceptExplanation> {
  const conceptResult = await query(
    `SELECT c.subject_id, s.student_id, s.name AS subject_name, cl.label
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
     WHERE c.id = $1`,
    [conceptId, language]
  );
  const concept = conceptResult.rows[0];
  if (!concept) {
    throw new Error('CONCEPT_NOT_FOUND');
  }
  if (concept.student_id !== studentId) {
    throw new Error('FORBIDDEN');
  }

  const cached = await query(
    `SELECT content FROM concept_explanations WHERE concept_id = $1 AND language = $2`,
    [conceptId, language]
  );
  if ((cached.rowCount ?? 0) > 0) {
    const parsedCached = tryParseExplanation(cached.rows[0].content);
    if (parsedCached) {
      return parsedCached;
    }
    // Corrupt or pre-restructure cache (e.g. a response truncated by
    // max_tokens before this fix) -- delete it and regenerate below
    // rather than serving broken content forever.
    await query(`DELETE FROM concept_explanations WHERE concept_id = $1 AND language = $2`, [conceptId, language]);
  }

  const conceptLabel = concept.label || 'this concept';

  const context = await retrieveContext(studentId, concept.subject_id, { conceptId, limit: 5 }).catch(
    () => ({ chunks: [] as any[] })
  );
  // LX-4P-PERF-R1C C13: bounded RAG reuse -- truncate to the
  // concept_explanation context budget before folding into the prompt.
  const contextChunks = fitContextChunks(context.chunks, budgetFor('concept_explanation').maxContextChars).map(
    (c: any) => c.text
  );

  const languageName = LOCALE_FULL_NAME[language] || language;

  const systemPrompt = `You are an expert tutor explaining one specific concept to a student so they can confidently take a quiz on it afterward.

Concept: "${conceptLabel}" (from the subject "${concept.subject_name}")

${
  contextChunks.length > 0
    ? `Relevant material from the student's own content:\n${contextChunks
        .map((c: string, i: number) => `[${i + 1}] ${c}`)
        .join('\n\n')}\n\nGround your explanation in this material.`
    : `No specific study material was found for this concept -- explain it using your general knowledge.`
}

Write everything in ${languageName}. Output ONLY a JSON object, no markdown fences, no other text, with this exact shape:
{
  "summary": "one or two sentences capturing the core idea",
  "sections": [
    { "heading": "short heading for this part", "body": "a clear paragraph -- what it is, why it matters, or how it works" }
  ],
  "examples": ["one concrete example", "a second concrete example if it helps"],
  "hasFormula": true or false -- whether this concept centers on one clean, well-known numeric formula (physics, chemistry, math) that a student could plug numbers into,
  "formulaHint": "if hasFormula is true, a short plain description of the formula/relationship, e.g. 'centripetal force F = mv^2/r'; otherwise an empty string"
}

Use 2 to 4 "sections", each covering one distinct angle of the concept (e.g. definition, why it matters, how it's applied, a common point of confusion) -- whichever genuinely fits this concept, not a fixed template. Keep each section body to 2-4 sentences. Keep it focused on this concept only.`;

  const registeredPrompt = getPrompt('concept.explanation');
  // LX-4P-PERF-R1C C9: MODEL/explanation content -> OpenAI Luna primary.
  const route = resolveModels(registeredPrompt.capability);
  const budget = budgetFor('concept_explanation');
  const { result } = await executeAI({
    capability: registeredPrompt.capability,
    risk: 'LOW_RISK', // cached, student-facing content; doesn't affect mastery/correctness
    provider: route.provider,
    model: route.primary,
    promptId: registeredPrompt.id,
    promptVersion: registeredPrompt.version,
    call: (signal) =>
      callModel(
        {
          provider: route.provider,
          model: route.primary,
          maxTokens: budget.maxOutputTokens,
          reasoningEffort: budget.reasoningEffort,
          system: systemPrompt,
          user: `Explain "${conceptLabel}" to me.`,
        },
        signal
      ),
    validate: (raw) => {
      const explanation = tryParseExplanation(raw.text);
      if (!explanation) return { valid: false, errors: ['EXPLANATION_PARSE_FAILED'] };
      return { valid: true, value: { explanation, rawText: raw.text } };
    },
  });
  const { explanation, rawText } = result;

  // LX-4P-PERF-R1D R3: the interactive-formula widget is OPTIONAL
  // enrichment and must NEVER block MODEL. We do NOT call
  // generateInteractiveFormula here (a ~3 s AI call that used to sit
  // serially between the ready explanation and the endpoint response,
  // and was not even rendered on the MODEL surface). Instead we persist
  // the eligibility flag + hint, and the widget is generated on demand
  // by `getInteractiveFormula` via its own client request lifecycle
  // (`GET /api/concepts/[id]/interactive-formula`), after MODEL is
  // already renderable.
  try {
    const parsedRaw = parseAIJson(rawText);
    explanation.hasFormula = parsedRaw?.hasFormula === true ? true : undefined;
    explanation.formulaHint =
      explanation.hasFormula && typeof parsedRaw?.formulaHint === 'string' ? parsedRaw.formulaHint : undefined;
  } catch {
    // No formula metadata available -- proceed without the widget.
  }

  await query(
    `INSERT INTO concept_explanations (concept_id, language, content) VALUES ($1, $2, $3)
     ON CONFLICT (concept_id, language) DO UPDATE SET content = EXCLUDED.content, created_at = NOW()`,
    [conceptId, language, JSON.stringify(explanation)]
  );

  return explanation;
}

/**
 * LX-4P-PERF-R1D R3/R6 -- the deferred, optional interactive-formula
 * widget for a concept. Its own request lifecycle, entirely off the
 * MODEL critical path.
 *
 * Eligibility (R6):
 *  - the concept must have a persisted explanation whose `hasFormula`
 *    flag is true. If the explanation isn't generated yet, or the
 *    concept is plain conceptual content (`hasFormula` !== true), this
 *    returns null WITHOUT any AI call.
 * Caching:
 *  - a generated widget is merged back into the persisted explanation
 *    JSON, so it is generated at most once per concept+language
 *    (subsequent calls are a cache read, no AI).
 */
export async function getInteractiveFormula(
  studentId: string,
  conceptId: string,
  language: string = 'en',
): Promise<InteractiveFormula | null> {
  const conceptResult = await query(
    `SELECT c.subject_id, s.student_id, s.name AS subject_name, cl.label
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
     WHERE c.id = $1`,
    [conceptId, language],
  );
  const concept = conceptResult.rows[0];
  if (!concept) throw new Error('CONCEPT_NOT_FOUND');
  if (concept.student_id !== studentId) throw new Error('FORBIDDEN');

  const cached = await query(
    `SELECT content FROM concept_explanations WHERE concept_id = $1 AND language = $2`,
    [conceptId, language],
  );
  const stored = (cached.rowCount ?? 0) > 0 ? tryParseExplanation(cached.rows[0].content) : null;

  // Not eligible: no explanation yet, or the concept has no clean formula.
  if (!stored || stored.hasFormula !== true) return null;
  // Cache hit: already generated once.
  if (stored.interactiveFormula) return stored.interactiveFormula;

  const conceptLabel = concept.label || 'this concept';
  const context = await retrieveContext(studentId, concept.subject_id, { conceptId, limit: 5 }).catch(
    () => ({ chunks: [] as any[] }),
  );
  const contextChunks = fitContextChunks(context.chunks, budgetFor('interactive_formula').maxContextChars).map(
    (c: any) => c.text,
  );

  const formula = await generateInteractiveFormula(
    conceptLabel,
    concept.subject_name,
    stored.formulaHint || '',
    contextChunks,
    language,
  ).catch(() => null);
  if (!formula) return null;

  // Merge into the persisted explanation JSON so it is generated once.
  const merged: ConceptExplanation = { ...stored, interactiveFormula: formula };
  await query(
    `UPDATE concept_explanations SET content = $3 WHERE concept_id = $1 AND language = $2`,
    [conceptId, language, JSON.stringify(merged)],
  ).catch(() => {
    /* cache write is best-effort -- the widget is still returned to this caller */
  });
  return formula;
}
