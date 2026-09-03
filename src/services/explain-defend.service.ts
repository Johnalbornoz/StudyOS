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
import { executeAI, validateJson, clamp, getPrompt, type AIProvenance } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';
import { buildTeachingConstraintsBlock, type TeachingGenerationContext } from '@/lib/adaptive-teaching-generation';

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
  language: string = 'en',
  /** Phase 5-R S2/S6/S7: set when this is a REMEDIATION EXPLAIN step and Phase 4 has an active decision for `conceptId` -- shapes misconception/prerequisite targeting and support level. `conceptId` here is always TeachingIntent.conceptId (the Phase-4-selected root cause) when one is supplied -- never a downstream substitute (see S7's own test). */
  generationContext?: TeachingGenerationContext
): Promise<ExplainPrompt> {
  const context = await retrieveContext(studentId, subjectId, { conceptId, limit: 3 }).catch(() => ({ chunks: [] as any[] }));
  const contextChunks = context.chunks.map((c: any) => c.text);
  const languageName = LOCALE_FULL_NAME[language] || language;
  const adaptiveBlock = generationContext ? `\n\n${buildTeachingConstraintsBlock(generationContext)}` : '';

  const systemPrompt = `You write one open-ended reasoning question for a student studying "${conceptLabel}".

${ACTIVITY_FRAMING[activityType]}
${adaptiveBlock}

${
  contextChunks.length > 0
    ? `Ground it in the student's own material:\n${contextChunks.map((c: string, i: number) => `[${i + 1}] ${c}`).join('\n\n')}`
    : 'No specific study material found -- write a generally sound question using standard knowledge of this concept.'
}

Write the question in ${languageName}. Output ONLY this JSON, no markdown fences, no other text:
{"prompt": "the question, in ${languageName}", "expectedElements": ["short phrase in English naming one idea a strong answer must include", "..."]}

expectedElements should have 3-5 items -- these become the grading rubric, so keep them specific and checkable, not vague ("mentions inward direction" not "understands the concept").`;

  const prompt = getPrompt('explain.prompt_generation');
  const { result } = await executeAI({
    capability: prompt.capability,
    risk: 'MEDIUM_RISK',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: prompt.id,
    promptVersion: prompt.version,
    context: { studentId, subjectId, conceptId, sourceComponent: 'explain-defend.service.ts:generateExplainPrompt' },
    call: (signal) =>
      callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 700, system: systemPrompt, messages: [{ role: 'user', content: 'Write the question.' }] }, signal),
    validate: (raw) =>
      validateJson<{ prompt: string; expectedElements: string[] }>({ text: raw.text || '{}' }, (parsed) => ({
        value: { prompt: parsed.prompt, expectedElements: parsed.expectedElements || [] },
        errors: [],
      })),
  });
  return { activityType, prompt: result.prompt, expectedElements: result.expectedElements };
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
export type RubricResultWithProvenance = RubricResult & { aiExecution: AIProvenance };

/** HIGH_RISK (Phase 0E1): feeds mastery.service.ts's updateMastery via the caller, and can trigger misconception classification -- see explain/submit/route.ts. */
export async function evaluateExplanation(
  conceptLabel: string,
  prompt: string,
  expectedElements: string[],
  studentResponse: string,
  language: string = 'en',
  /** Phase 0E2 Step 11: optional, purely additive. */
  context?: { studentId?: string; subjectId?: string; conceptId?: string }
): Promise<RubricResultWithProvenance> {
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

  const registeredPrompt = getPrompt('explain.rubric_evaluation');
  const { result, provenance } = await executeAI({
    capability: registeredPrompt.capability,
    risk: 'HIGH_RISK',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: registeredPrompt.id,
    promptVersion: registeredPrompt.version,
    context: { ...context, sourceComponent: 'explain-defend.service.ts:evaluateExplanation' },
    call: (signal) =>
      callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 600, system: systemPrompt, messages: [{ role: 'user', content: 'Grade this answer.' }] }, signal),
    validate: (raw) =>
      validateJson<RubricResult>({ text: raw.text || '{}' }, (parsed) => ({
        value: {
          conceptAccuracy: clamp(Number(parsed.conceptAccuracy) || 0, 0, 4),
          reasoning: clamp(Number(parsed.reasoning) || 0, 0, 4),
          completeness: clamp(Number(parsed.completeness) || 0, 0, 4),
          misconceptionDetected: !!parsed.misconceptionDetected,
          misconceptionDescription: parsed.misconceptionDescription || null,
          feedback: parsed.feedback || '',
        },
        errors: [],
      })),
  });
  return { ...result, aiExecution: provenance };
}
