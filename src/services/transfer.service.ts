/**
 * Transfer Engine (Phase 2): can the student apply a concept somewhere
 * new, not just in the surface context they practiced it in? Transfer
 * is tracked as its own dimension, deliberately never merged into
 * Mastery -- "knows it here" and "can use it elsewhere" are different
 * claims (see computeTransferScore).
 */

import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { executeAI, validateJson, getPrompt, type AIProvenance } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';

export type TransferDistance = 'NEAR' | 'MID' | 'FAR';

export interface TransferActivity {
  distance: TransferDistance;
  context: string; // short label for the new context, e.g. "Car taking a turn"
  prompt: string;
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
    promptVersion: prompt.version,
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

export interface TransferEvidenceRow {
  transferDistance: TransferDistance;
  result: 'correct' | 'partial' | 'incorrect';
  assisted: boolean;
  timestamp: string | Date;
}

const DISTANCE_WEIGHT: Record<TransferDistance, number> = { NEAR: 0.7, MID: 1.0, FAR: 1.3 };
const RESULT_VALUE: Record<TransferEvidenceRow['result'], number> = { correct: 100, partial: 50, incorrect: 0 };

/**
 * Deterministic, null-safe (never 0 with no evidence). Averages
 * distance-weighted, assistance-discounted results over the last 10
 * transfer attempts -- a MID/FAR success counts for more than a NEAR
 * one, and an assisted success counts for less than an independent one,
 * without needing a separate Independent-Transfer dimension yet.
 */
export function computeTransferScore(rows: TransferEvidenceRow[]): number | null {
  if (rows.length === 0) return null;
  const recent = [...rows]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  let weightedSum = 0;
  let weightTotal = 0;
  for (const row of recent) {
    const weight = DISTANCE_WEIGHT[row.transferDistance] * (row.assisted ? 0.6 : 1.0);
    weightedSum += RESULT_VALUE[row.result] * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return null;
  return Math.round(weightedSum / weightTotal);
}

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
  const systemPrompt = `Grade whether a student correctly applied "${conceptLabel}" to this new context.

Question: ${prompt}
Student's answer: ${studentResponse}

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
export async function getTransferScore(studentId: string, conceptId: string): Promise<number | null> {
  const result = await db.query(
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
