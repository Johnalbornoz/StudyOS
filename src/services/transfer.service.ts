/**
 * Transfer Engine (Phase 2): can the student apply a concept somewhere
 * new, not just in the surface context they practiced it in? Transfer
 * is tracked as its own dimension, deliberately never merged into
 * Mastery -- "knows it here" and "can use it elsewhere" are different
 * claims (see computeTransferScore).
 */

import { db, type DbExecutor } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { executeAI, validateJson, getPrompt, type AIProvenance } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';
import { computeTransferScore, type TransferEvidenceRow } from '@/lib/algorithms/transfer-score';

export type TransferDistance = 'NEAR' | 'MID' | 'FAR';

export interface TransferActivity {
  distance: TransferDistance;
  context: string; // short label for the new context, e.g. "Car taking a turn"
  prompt: string;
}

/** Canonical NoveltyDimension values the generator may propose (mirrors src/lib/transfer-policy.ts). */
export const GENERATOR_NOVELTY_DIMENSIONS = [
  'CONTEXT',
  'SURFACE',
  'REPRESENTATION',
  'STRATEGY',
  'CONCEPT_COMBINATION',
  'GOAL_FRAMING',
  'DATA_PRESENTATION',
  'CONSTRAINT',
] as const;
export type GeneratorNoveltyDimension = (typeof GENERATOR_NOVELTY_DIMENSIONS)[number];

/**
 * Phase 7 (7D1): a STRUCTURED transfer candidate. `prompt`/`context`
 * are for the learner; the rest is AI-PROPOSED metadata the server
 * (7D2) is the sole authority to certify. `transferModality` is
 * derived deterministically here (not proposed by the AI).
 */
export interface StructuredTransferCandidate {
  distance: TransferDistance;
  context: string;
  prompt: string;
  noveltyDimensions: GeneratorNoveltyDimension[];
  transferModality: 'STRUCTURAL' | 'REPRESENTATIONAL';
  targetConceptIds: string[];
  contextDomain: string | null;
  generatorPromptVersion: string;
}

/**
 * One application question in a new surface context. FAR transfer is
 * only requested when the caller has reason to believe the student
 * already has the supporting knowledge (this function doesn't gate
 * that itself -- see transfer.service usage in remediation, which only
 * ever requests NEAR/MID, per the brief's explicit caution about FAR
 * introducing concepts the student hasn't learned yet).
 */
export async function generateTransferActivity(
  conceptLabel: string,
  learnedContext: string,
  distance: TransferDistance,
  language: string = 'en'
): Promise<TransferActivity> {
  const languageName = LOCALE_FULL_NAME[language] || language;
  const distanceGuidance: Record<TransferDistance, string> = {
    NEAR: 'a different surface scenario with essentially the same structure as the one the student learned it in',
    MID: 'a different context that requires recognizing the same underlying principle, not just swapping surface details',
    FAR: 'a less obvious application, possibly combined with one other concept the student has already mastered -- never introduce anything the student has not learned',
  };

  const systemPrompt = `Write one application question that tests whether a student can transfer their understanding of "${conceptLabel}" to a new context.

The student originally learned this concept through: ${learnedContext}
Required transfer distance: ${distance} -- ${distanceGuidance[distance]}

Output ONLY this JSON, no markdown fences, no other text:
{"context": "a short label (3-6 words) for the new scenario, in ${languageName}", "prompt": "the actual question, in ${languageName}"}`;

  const prompt = getPrompt('transfer.activity_generation');
  const { result } = await executeAI({
    capability: prompt.capability,
    risk: 'MEDIUM_RISK',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: prompt.id,
    promptVersion: 'v1',
    call: (signal) =>
      callAnthropicMessages(
        { model: 'claude-sonnet-5', maxTokens: 500, system: systemPrompt, messages: [{ role: 'user', content: 'Write the transfer question.' }] },
        signal
      ),
    validate: (raw) =>
      validateJson<{ context: string; prompt: string }>({ text: raw.text || '{}' }, (parsed) => ({
        value: { context: parsed.context, prompt: parsed.prompt },
        errors: [],
      })),
  });
  return { distance, context: result.context, prompt: result.prompt };
}

/**
 * Phase 7 (7D1): STRUCTURED transfer generation. The AI writes the
 * task AND proposes its novelty metadata; the server later (7D2)
 * deterministically certifies distance/novelty. `transferModality` is
 * derived here, not proposed. One AI call -- the route owns the
 * bounded attempt budget.
 */
export async function generateStructuredTransferActivity(
  conceptLabel: string,
  learnedContext: string,
  distance: TransferDistance,
  language: string = 'en',
  aiContext?: { studentId?: string; subjectId?: string; conceptId?: string },
): Promise<StructuredTransferCandidate> {
  const languageName = LOCALE_FULL_NAME[language] || language;
  const distanceGuidance: Record<TransferDistance, string> = {
    NEAR: 'a different surface scenario with essentially the same structure as the one the student learned it in',
    MID: 'a different context that requires recognizing the same underlying principle, not just swapping surface details',
    FAR: 'a materially different, less obvious application -- the student must recognize the concept applies; it may combine ONE other concept the student has already mastered, but never introduce anything they have not learned',
  };
  const dimensionMenu = GENERATOR_NOVELTY_DIMENSIONS.join(', ');

  const systemPrompt = `Write ONE application question that tests whether a student can transfer their understanding of "${conceptLabel}" to a new context, then describe how the task differs from ordinary practice.

The student originally learned this concept through: ${learnedContext}
Required transfer distance: ${distance} -- ${distanceGuidance[distance]}

Also return which "novelty dimensions" your task actually varies, choosing ONLY from this fixed list: ${dimensionMenu}
  - CONTEXT / SURFACE: only the setting or wording changed
  - REPRESENTATION: a different representation (equation<->graph<->table<->prose)
  - STRATEGY: a different solution strategy is required
  - DATA_PRESENTATION: the data is given in a materially different form
  - CONCEPT_COMBINATION: the task genuinely requires a second, related concept
  - GOAL_FRAMING: the goal/question type is reframed
  - CONSTRAINT: a new real-world constraint must be handled
For MID your task MUST vary at least one dimension beyond CONTEXT/SURFACE. For FAR it MUST vary at least one of CONCEPT_COMBINATION, GOAL_FRAMING, CONSTRAINT.

Output ONLY this JSON, no markdown fences, no other text:
{"context": "a short label (3-6 words) for the new scenario, in ${languageName}", "prompt": "the actual question, in ${languageName}", "noveltyDimensions": ["..."], "contextDomain": "a 1-3 word domain/topic label in English, or null"}`;

  const registered = getPrompt('transfer.activity_generation');
  const { result } = await executeAI({
    capability: registered.capability,
    risk: 'MEDIUM_RISK',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: registered.id,
    promptVersion: registered.version, // v2
    context: { ...aiContext, sourceComponent: 'transfer.service.ts:generateStructuredTransferActivity' },
    call: (signal) =>
      callAnthropicMessages(
        { model: 'claude-sonnet-5', maxTokens: 700, system: systemPrompt, messages: [{ role: 'user', content: 'Write the structured transfer task.' }] },
        signal,
      ),
    validate: (raw) =>
      validateJson<{ context: string; prompt: string; noveltyDimensions: string[]; contextDomain: string | null }>(
        { text: raw.text || '{}' },
        (parsed) => ({
          value: {
            context: typeof parsed.context === 'string' ? parsed.context : '',
            prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
            noveltyDimensions: Array.isArray(parsed.noveltyDimensions)
              ? parsed.noveltyDimensions.map((d: unknown) => String(d))
              : [],
            contextDomain:
              typeof parsed.contextDomain === 'string' && parsed.contextDomain.trim().length > 0 ? parsed.contextDomain.trim() : null,
          },
          errors: [],
        }),
      ),
  });

  const noveltyDimensions = result.noveltyDimensions
    .map((d) => d.trim().toUpperCase())
    .filter((d): d is GeneratorNoveltyDimension => (GENERATOR_NOVELTY_DIMENSIONS as readonly string[]).includes(d));
  // Deterministic -- never proposed by the AI.
  const transferModality: 'STRUCTURAL' | 'REPRESENTATIONAL' = noveltyDimensions.includes('REPRESENTATION')
    ? 'REPRESENTATIONAL'
    : 'STRUCTURAL';

  return {
    distance,
    context: result.context,
    prompt: result.prompt,
    noveltyDimensions,
    transferModality,
    targetConceptIds: [], // 7D2/7G2 -- server-approved cross-concept ids only
    contextDomain: result.contextDomain,
    generatorPromptVersion: registered.version,
  };
}

// Phase 7 (7C2): the pure scorer moved to
// src/lib/algorithms/transfer-score.ts so the Phase 7 projector calls
// the exact same implementation. Imported above for this module's own
// use (getTransferScore) and re-exported here so this module's public
// surface (and every existing importer/test) is unchanged.
export { computeTransferScore };
export type { TransferEvidenceRow };

/**
 * Grades one transfer response as correct/partial/incorrect with brief
 * feedback -- a simpler rubric than Explain & Defend since the
 * question is "did they apply it right here", not a multi-dimension
 * reasoning trace. HIGH_RISK (Phase 0E1): `result` feeds directly into
 * mastery.service.ts's updateMastery via the caller (see
 * transfer/submit/route.ts) and into computeTransferScore's stored
 * evidence (RESULT_VALUE above).
 */
export async function evaluateTransferResponse(
  conceptLabel: string,
  prompt: string,
  studentResponse: string,
  language: string = 'en',
  /** Phase 0E2 Step 11: optional, purely additive. */
  context?: { studentId?: string; subjectId?: string; conceptId?: string }
): Promise<{ result: 'correct' | 'partial' | 'incorrect'; feedback: string; aiExecution: AIProvenance }> {
  const languageName = LOCALE_FULL_NAME[language] || language;
  // 7D3 (v2): grade the TRANSFER -- did the student APPLY "${conceptLabel}"
  // to this new context and reach a sound result? Merely restating,
  // defining, or recalling the concept without applying it here is NOT
  // "correct" (at most "partial"). Applying the right idea with a minor
  // slip is "partial".
  const systemPrompt = `Grade whether a student correctly APPLIED "${conceptLabel}" to the NEW context in the question below -- not whether they can recall or restate the concept.

Question: ${prompt}
Student's answer: ${studentResponse}

Grading:
- "correct": the student applied the concept to this new context and reached a sound result.
- "partial": the student applied the right idea but with a flawed step, or only partially addressed the new context.
- "incorrect": the student did not apply the concept to the new context (including answers that only restate or define the concept).

Output ONLY this JSON, no markdown fences, no other text:
{"result": "correct" | "partial" | "incorrect", "feedback": "1-2 sentences in ${languageName}"}`;

  const registeredPrompt = getPrompt('transfer.response_evaluation');
  const { result, provenance } = await executeAI({
    capability: registeredPrompt.capability,
    risk: 'HIGH_RISK',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: registeredPrompt.id,
    promptVersion: registeredPrompt.version,
    context: { ...context, sourceComponent: 'transfer.service.ts:evaluateTransferResponse' },
    call: (signal) =>
      callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 300, system: systemPrompt, messages: [{ role: 'user', content: 'Grade this.' }] }, signal),
    validate: (raw) =>
      validateJson<{ result: 'correct' | 'partial' | 'incorrect'; feedback: string }>({ text: raw.text || '{}' }, (parsed) => ({
        value: {
          result: (['correct', 'partial', 'incorrect'].includes(parsed.result) ? parsed.result : 'incorrect') as 'correct' | 'partial' | 'incorrect',
          feedback: parsed.feedback || '',
        },
        errors: [],
      })),
  });
  return { ...result, aiExecution: provenance };
}

/** Reads transfer evidence for a concept straight from learning_evidence's metadata (sourceType='TRANSFER'). */
export async function getTransferScore(studentId: string, conceptId: string, client: DbExecutor = db): Promise<number | null> {
  const result = await client.query(
    `SELECT result, metadata, timestamp FROM learning_evidence
     WHERE student_id = $1 AND concept_id = $2 AND source_type = 'TRANSFER'
     ORDER BY timestamp DESC LIMIT 10`,
    [studentId, conceptId]
  );
  const rows: TransferEvidenceRow[] = result.rows.map((r) => ({
    transferDistance: (r.metadata?.transferDistance as TransferDistance) || 'NEAR',
    result: r.result,
    assisted: !!r.metadata?.assisted,
    timestamp: r.timestamp,
  }));
  return computeTransferScore(rows);
}
