import { query } from '@/lib/db';
import { retrieveContext } from './rag.service';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { parseAIJson } from '@/lib/ai-json';
import { generateInteractiveFormula, InteractiveFormula } from './interactive-formula.service';

export interface ConceptExplanation {
  summary: string;
  sections: { heading: string; body: string }[];
  examples: string[];
  interactiveFormula?: InteractiveFormula;
}

function coerceExplanation(raw: string): ConceptExplanation {
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
      };
    }
  } catch {
    // Falls through to the plain-text shim below -- covers explanations
    // cached before this structured format existed.
  }
  return { summary: raw, sections: [], examples: [] };
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
    return coerceExplanation(cached.rows[0].content);
  }

  const conceptLabel = concept.label || 'this concept';

  const context = await retrieveContext(studentId, concept.subject_id, { conceptId, limit: 5 }).catch(
    () => ({ chunks: [] as any[] })
  );
  const contextChunks = context.chunks.map((c: any) => c.text);

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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 1400,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Explain "${conceptLabel}" to me.` }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawText = data.content.find((b: any) => b.type === 'text')?.text ?? '{}';
  const explanation = coerceExplanation(rawText);

  let hasFormula = false;
  let formulaHint = '';
  try {
    const parsedRaw = parseAIJson(rawText);
    hasFormula = parsedRaw?.hasFormula === true;
    formulaHint = typeof parsedRaw?.formulaHint === 'string' ? parsedRaw.formulaHint : '';
  } catch {
    // No formula metadata available -- proceed without the widget.
  }

  if (hasFormula) {
    const formula = await generateInteractiveFormula(
      conceptLabel,
      concept.subject_name,
      formulaHint,
      contextChunks,
      language
    );
    if (formula) {
      explanation.interactiveFormula = formula;
    }
  }

  await query(
    `INSERT INTO concept_explanations (concept_id, language, content) VALUES ($1, $2, $3)
     ON CONFLICT (concept_id, language) DO UPDATE SET content = EXCLUDED.content, created_at = NOW()`,
    [conceptId, language, JSON.stringify(explanation)]
  );

  return explanation;
}
