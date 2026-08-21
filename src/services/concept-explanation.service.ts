import { query } from '@/lib/db';
import { retrieveContext } from './rag.service';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';

export async function getConceptExplanation(
  studentId: string,
  conceptId: string,
  language: string = 'en'
): Promise<string> {
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
    return cached.rows[0].content;
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

Structure your response in ${languageName} as:
1. A short one or two sentence summary.
2. A clear, thorough explanation of the concept -- what it is, why it matters, and how it works.
3. One or two concrete examples.

Keep it focused on this concept only, written to prepare the student to answer quiz questions about it.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Explain "${conceptLabel}" to me.` }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const explanationText = data.content.find((b: any) => b.type === 'text')?.text ?? '';

  await query(
    `INSERT INTO concept_explanations (concept_id, language, content) VALUES ($1, $2, $3)
     ON CONFLICT (concept_id, language) DO UPDATE SET content = EXCLUDED.content, created_at = NOW()`,
    [conceptId, language, explanationText]
  );

  return explanationText;
}
