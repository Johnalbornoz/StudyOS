import type { AIExecutionMetadata } from './types';

/**
 * Safe structured logging around the AI gateway (Step 17). Only ever
 * emits the fields on AIExecutionMetadata -- executionId, capability,
 * provider, model, promptId, promptVersion, durationMs, success,
 * validationStatus, fallbackUsed, errorCode. Never the student's name,
 * email, raw prompt, raw response, or any credential.
 *
 * Raw prompt/response content can optionally be inspected in local
 * development ONLY, and only when explicitly opted into via
 * STUDYUS_AI_DEBUG_RAW=1 -- never enabled by default, never in
 * production (see logAIDebugRaw below).
 */
export function logAIExecution(execution: AIExecutionMetadata): void {
  const line = {
    at: 'ai_execution',
    executionId: execution.executionId,
    capability: execution.capability,
    risk: execution.risk,
    provider: execution.provider,
    model: execution.model,
    promptId: execution.promptId,
    promptVersion: execution.promptVersion,
    durationMs: execution.durationMs,
    success: execution.success,
    validationStatus: execution.validationStatus,
    fallbackUsed: execution.fallbackUsed,
    ...(execution.errorCode ? { errorCode: execution.errorCode } : {}),
  };
  if (execution.success) {
    console.log('[ai]', JSON.stringify(line));
  } else {
    console.warn('[ai]', JSON.stringify(line));
  }
}

/**
 * Explicit, opt-in-only debug hook for raw prompt/response content
 * during local development. Requires STUDYUS_AI_DEBUG_RAW=1 in the
 * environment -- absent by default in every environment, including
 * local dev. Never call this with anything that isn't already meant
 * to be inspectable (it still never logs credentials).
 */
export function logAIDebugRaw(executionId: string, label: string, content: string): void {
  if (process.env.STUDYUS_AI_DEBUG_RAW !== '1') return;
  console.debug('[ai:debug-raw]', executionId, label, content);
}
