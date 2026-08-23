/**
 * Explain & Defend Engine (Phase 2): a correct multiple-choice answer
 * isn't proof of deep understanding. This asks the student to reason
 * about a concept in their own words and grades that reasoning against
 * a structured rubric -- the LLM evaluates against a rubric, it never
 * invents the cognitive verdict from nothing.
 *
 * Reuses learning_evidence (sourceType='EXPLANATION') rather than a
 * parallel evidence system; the rubric result lives in metadata.
 */

import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { retrieveContext } from './rag.service';

export type ExplainActivityType = 'EXPLAIN' | 'JUSTIFY' | 'ERROR_ANALYSIS' | 'PREDICT' | 'COMPARE' | 'TEACH_BACK';

export interface ExplainPrompt {
  activityType: ExplainActivityType;
  prompt: string;
  expectedElements: string[];
}

const ACTIVITY_FRAMING: Record<ExplainActivityType, string> = {
  EXPLAIN: 'Ask the student to explain the concept in their own words, without just restating a formula.',
  JUSTIFY: 'Present a claim about the concept and ask the student to justify whether it is true or false, and why.',
  ERROR_ANALYSIS: 'Present a plausible but flawed statement or worked step about the concept, and ask the student to identify and correct the error.',
  PREDICT: 'Ask the student to predict what would happen to some measurable outcome if one variable changed (e.g. doubled, removed).',
  COMPARE: 'Ask the student to compare this concept to a closely related one and explain how they differ.',
  TEACH_BACK: 'Ask the student to explain the concept as if teaching it to a younger student, in plain language.',
};

/**
 * One open-ended prompt for a concept, grounded in the student's own
 * material when available. Returns the rubric's expected elements
 * alongside the prompt so evaluateExplanation always has something
 * concrete to grade against, not a re-derived rubric per answer.
 */
export async function generateExplainPrompt(
  studentId: string,
  subjectId: string,
  conceptId: string,
  conceptLabel: string,
  activityType: ExplainActivityType,
  language: string = 'en'
): Promise<ExplainPrompt> {
  const context = await retrieveContext(studentId, subjectId, { conceptId, limit: 3 }).catch(() => ({ chunks: [] as any[] }));
  const contextChunks = context.chunks.map((c: any) => c.text);
  const languageName = LOCALE_FULL_NAME[language] || language;

  const systemPrompt = `You write one open-ended reasoning question for a student studying "${conceptLabel}".

${ACTIVITY_FRAMING[activityType]}

${
  contextChunks.length > 0
    ? `Ground it in the student's own material:\n${contextChunks.map((c: string, i: number) => `[${i + 1}] ${c}`).join('\n\n')}`
    : 'No specific study material found -- write a generally sound question using standard knowledge of this concept.'
}

Write the question in ${languageName}. Output ONLY this JSON, no markdown fences, no other text:
{"prompt": "the question, in ${languageName}", "expectedElements": ["short phrase in English naming one idea a strong answer must include", "..."]}

expectedElements should have 3-5 items -- these become the grading rubric, so keep them specific and checkable, not vague ("mentions inward direction" not "understands the concept").`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Write the question.' }],
    }),
  });
  if (!response.ok) throw new Error(`Claude API error: ${response.status} - ${await response.text()}`);
  const data = await response.json();
  const rawText = data.content.find((b: any) => b.type === 'text')?.text ?? '{}';
  const parsed = parseAIJson<{ prompt: string; expectedElements: string[] }>(rawText);
  return { activityType, prompt: parsed.prompt, expectedElements: parsed.expectedElements || [] };
}

export interface RubricResult {
  conceptAccuracy: number; // 0-4
  reasoning: number; // 0-4
  completeness: number; // 0-4
  misconceptionDetected: boolean;
  misconceptionDescription: string | null;
  feedback: string;
}

/** 0-100, weighted equally across the three 0-4 rubric dimensions. Used as this evidence event's scorePercent. */
export function rubricScorePercent(rubric: RubricResult): number {
  return Math.round(((rubric.conceptAccuracy + rubric.reasoning + rubric.completeness) / 12) * 100);
}

/**
 * Structured rubric evaluation of an open response -- the LLM scores
 * against the fixed 0-4 dimensions and expectedElements it's given, it
 * doesn't get to declare "understood" or "not understood" as a free
 * verdict.
 */
export async function evaluateExplanation(
  conceptLabel: string,
  prompt: string,
  expectedElements: string[],
  studentResponse: string,
  language: string = 'en'
): Promise<RubricResult> {
  const languageName = LOCALE_FULL_NAME[language] || language;
  const systemPrompt = `Grade a student's open-ended answer about "${conceptLabel}" using a structured rubric. Do not invent a holistic verdict -- score only the dimensions below.

Question: ${prompt}
Expected elements a strong answer should touch on: ${expectedElements.join('; ')}
Student's answer: ${studentResponse}

Output ONLY this JSON, no markdown fences, no other text:
{
  "conceptAccuracy": 0-4,
  "reasoning": 0-4,
  "completeness": 0-4,
  "misconceptionDetected": true|false,
  "misconceptionDescription": "one sentence in ${languageName}, or null if none",
  "feedback": "2-3 encouraging, specific sentences in ${languageName} on what was right and what to reconsider"
}
0 = missing/wrong, 4 = fully correct and clear, for each 0-4 dimension.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Grade this answer.' }],
    }),
  });
  if (!response.ok) throw new Error(`Claude API error: ${response.status} - ${await response.text()}`);
  const data = await response.json();
  const rawText = data.content.find((b: any) => b.type === 'text')?.text ?? '{}';
  const parsed = parseAIJson<any>(rawText);
  return {
    conceptAccuracy: Math.max(0, Math.min(4, Number(parsed.conceptAccuracy) || 0)),
    reasoning: Math.max(0, Math.min(4, Number(parsed.reasoning) || 0)),
    completeness: Math.max(0, Math.min(4, Number(parsed.completeness) || 0)),
    misconceptionDetected: !!parsed.misconceptionDetected,
    misconceptionDescription: parsed.misconceptionDescription || null,
    feedback: parsed.feedback || '',
  };
}
