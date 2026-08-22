/**
 * Error intelligence: turns individual classified mistakes (see the
 * `errors` table, written from mastery.service.ts and quiz grading)
 * into patterns a student can act on -- "you keep making procedural
 * errors in Algebra" is more useful than a bare wrong/right count.
 *
 * Patterns are always a GROUP BY over `errors`, not a separately
 * maintained table -- there's nothing to keep in sync, and the numbers
 * are always current.
 */

import { db } from '@/lib/db';
import { retrieveContext } from './rag.service';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { parseAIJson } from '@/lib/ai-json';

export type ErrorType = 'CONCEPTUAL' | 'PROCEDURAL' | 'CARELESS' | 'INCOMPLETE' | 'MISREADING';

const ERROR_TYPE_MEANING: Record<string, string> = {
  CONCEPTUAL: 'the student misunderstands what the concept actually means or how it relates to other ideas',
  PROCEDURAL: 'the student understands the concept but applies the steps or method incorrectly',
  CARELESS: 'the student knows the material but makes small execution slips (arithmetic, sign errors, typos)',
  INCOMPLETE: "the student's answer is on the right track but doesn't fully develop or finish the reasoning",
  MISREADING: 'the student misinterprets what the question is actually asking',
};

export interface RecordErrorInput {
  studentId: string;
  conceptId: string;
  subjectId: string;
  errorType: string;
  sourceType: string;
}

export async function recordError(input: RecordErrorInput): Promise<void> {
  await db.query(
    `INSERT INTO errors (student_id, concept_id, subject_id, error_type, source_type) VALUES ($1, $2, $3, $4, $5)`,
    [input.studentId, input.conceptId, input.subjectId, input.errorType, input.sourceType]
  );
}

export interface ErrorPattern {
  errorType: string;
  count: number;
  subjectId: string;
  subjectName: string;
  topConceptId: string;
  topConceptLabel: string;
  topConceptCount: number;
  lastOccurredAt: string;
}

/**
 * Recurring error types for a student (optionally scoped to one
 * subject), most frequent first. Only returns a type once it has
 * recurred at least MIN_OCCURRENCES times within the last
 * RECENCY_WINDOW_DAYS -- a single mistake isn't a pattern, and an old
 * one the student has since fixed shouldn't haunt them forever.
 */
export async function getErrorPatterns(
  studentId: string,
  subjectId?: string,
  preferredLanguage: string = 'en'
): Promise<ErrorPattern[]> {
  const MIN_OCCURRENCES = 2;
  const RECENCY_WINDOW_DAYS = 30;

  let sql = `
    SELECT
      e.error_type,
      e.subject_id,
      s.name AS subject_name,
      COUNT(*) AS total_count,
      MAX(e.created_at) AS last_occurred_at
    FROM errors e
    JOIN subjects s ON s.id = e.subject_id
    WHERE e.student_id = $1 AND e.created_at > NOW() - INTERVAL '${RECENCY_WINDOW_DAYS} days'
  `;
  const params: any[] = [studentId];
  if (subjectId) {
    sql += ` AND e.subject_id = $2`;
    params.push(subjectId);
  }
  sql += `
    GROUP BY e.error_type, e.subject_id, s.name
    HAVING COUNT(*) >= ${MIN_OCCURRENCES}
    ORDER BY total_count DESC
    LIMIT 8
  `;

  const grouped = await db.query(sql, params);

  const patterns: ErrorPattern[] = await Promise.all(
    grouped.rows.map(async (row) => {
      const topConceptResult = await db.query(
        `
        SELECT e.concept_id, cl.label, c.canonical_id, COUNT(*) AS concept_count
        FROM errors e
        JOIN concepts c ON c.id = e.concept_id
        LEFT JOIN LATERAL (
          SELECT label FROM concept_localizations
          WHERE concept_id = c.id
          ORDER BY (language = $3) DESC
          LIMIT 1
        ) cl ON true
        WHERE e.student_id = $1 AND e.subject_id = $2 AND e.error_type = $4
          AND e.created_at > NOW() - INTERVAL '${RECENCY_WINDOW_DAYS} days'
        GROUP BY e.concept_id, cl.label, c.canonical_id
        ORDER BY concept_count DESC
        LIMIT 1
        `,
        [studentId, row.subject_id, preferredLanguage, row.error_type]
      );
      const top = topConceptResult.rows[0];

      return {
        errorType: row.error_type,
        count: Number(row.total_count),
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        topConceptId: top?.concept_id ?? '',
        topConceptLabel: top?.label || top?.canonical_id || '',
        topConceptCount: top ? Number(top.concept_count) : 0,
        lastOccurredAt: row.last_occurred_at,
      };
    })
  );

  return patterns;
}

export interface ErrorPatternGuidance {
  summary: string;
  sections: { heading: string; body: string }[];
  examples: string[];
}

function coerceGuidance(raw: string): ErrorPatternGuidance {
  try {
    const parsed = parseAIJson(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.summary === 'string' && Array.isArray(parsed.sections)) {
      return {
        summary: parsed.summary,
        sections: parsed.sections
          .filter((s: any) => s && typeof s.heading === 'string' && typeof s.body === 'string')
          .map((s: any) => ({ heading: s.heading, body: s.body })),
        examples: Array.isArray(parsed.examples) ? parsed.examples.filter((e: any) => typeof e === 'string') : [],
      };
    }
  } catch {
    // fall through
  }
  return { summary: raw, sections: [], examples: [] };
}

/**
 * Formative guidance for one recurring error pattern -- NOT a re-teach
 * of the concept from scratch (that's "Aprender más"), but feedback
 * aimed at the specific way the student keeps getting it wrong:
 * what that error type usually means, why it likely shows up here,
 * and 2-3 concrete things to focus on. Generated fresh each time
 * (not persisted) since the underlying pattern shifts as new errors
 * land or get resolved -- caching it would risk showing stale advice.
 */
export async function getErrorPatternGuidance(
  studentId: string,
  subjectId: string,
  subjectName: string,
  errorType: string,
  topConceptId: string,
  topConceptLabel: string,
  occurrences: number,
  language: string = 'en'
): Promise<ErrorPatternGuidance> {
  const context = topConceptId
    ? await retrieveContext(studentId, subjectId, { conceptId: topConceptId, limit: 4 }).catch(() => ({ chunks: [] as any[] }))
    : { chunks: [] as any[] };
  const contextChunks = context.chunks.map((c: any) => c.text);

  const languageName = LOCALE_FULL_NAME[language] || language;
  const errorMeaning = ERROR_TYPE_MEANING[errorType] || 'a recurring mistake pattern';

  const systemPrompt = `You are a formative-feedback tutor. You are not re-explaining a concept from scratch -- you are helping a student understand a PATTERN of mistakes they keep making, so they can fix their understanding, not just retry a quiz.

Student's pattern: in the subject "${subjectName}", they have made ${occurrences} ${errorType} errors in the last 30 days, most concentrated around the concept "${topConceptLabel}".

What ${errorType} generally means: ${errorMeaning}.

${
  contextChunks.length > 0
    ? `Relevant material from the student's own content on "${topConceptLabel}":\n${contextChunks.map((c: string, i: number) => `[${i + 1}] ${c}`).join('\n\n')}`
    : `No specific study material was found for this concept -- reason about it using general knowledge of the subject.`
}

Write everything in ${languageName}. Output ONLY a JSON object, no markdown fences, no other text, with this exact shape:
{
  "summary": "one or two sentences naming, in plain terms, what this pattern of mistakes suggests about the student's current understanding",
  "sections": [
    { "heading": "short heading", "body": "2-4 sentences" }
  ],
  "examples": ["a short example of the kind of mistake this pattern looks like in practice, phrased constructively"]
}

Use 2 to 3 "sections" covering, in this spirit: (1) what is likely going wrong conceptually/procedurally for THIS student on THIS concept -- be specific, not generic advice about the error type in the abstract; (2) what to focus on or reconsider before practicing again. Do not lecture on the whole concept as if from zero -- speak directly to the pattern. Keep it encouraging and constructive, never scolding.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Help me understand this pattern of mistakes.` }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawText = data.content.find((b: any) => b.type === 'text')?.text ?? '{}';
  return coerceGuidance(rawText);
}
