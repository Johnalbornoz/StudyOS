import type { AIExecutionMetadata } from './types';

/**
 * Safe structured logging around the AI gateway (Step 17). Only ever
 * emits the fields on AIExecutionMetadata -- executionId, capability,
 * provider, model, promptId, promptVersion, durationMs, success,
 * validationStatus, fallbackUsed, errorCode, and (LX-4P-PERF-R1G) REAL
 * provider token usage + estimated cost, when the call site opted in.
 * Never the student's name, email, raw prompt, raw response, or any
 * credential.
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
    // LX-9R7 PART A: present only when this execution failed with a
    // provider HTTP error -- same safe fields as `[ai-provider-error]`,
    // duplicated here so a single `[ai]` line is sufficient to see both
    // the execution outcome and why it failed, without a second lookup.
    ...(execution.providerHttpStatus !== undefined ? { providerHttpStatus: execution.providerHttpStatus } : {}),
    ...(execution.providerErrorType !== undefined ? { providerErrorType: execution.providerErrorType } : {}),
    ...(execution.providerErrorCode !== undefined ? { providerErrorCode: execution.providerErrorCode } : {}),
    ...(execution.providerErrorParam !== undefined ? { providerErrorParam: execution.providerErrorParam } : {}),
    ...(execution.providerErrorMessage !== undefined ? { providerErrorMessage: execution.providerErrorMessage } : {}),
    // LX-4P-PERF-R1G: present only when the call site supplied
    // `parseUsage` -- shape/number fields only, never fabricated.
    ...(execution.inputTokens !== undefined ? { inputTokens: execution.inputTokens } : {}),
    ...(execution.cachedInputTokens !== undefined ? { cachedInputTokens: execution.cachedInputTokens } : {}),
    ...(execution.outputTokens !== undefined ? { outputTokens: execution.outputTokens } : {}),
    ...(execution.estimatedCostUSD !== undefined ? { estimatedCostUSD: execution.estimatedCostUSD } : {}),
    ...(execution.costComplete !== undefined ? { costComplete: execution.costComplete } : {}),
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

/**
 * LX-9R7 PART A -- one dedicated, safe, structured line for a provider
 * HTTP error, distinct from the always-emitted `[ai]` execution summary
 * so a 400/401/403/etc. is trivially greppable on its own. Only ever
 * emits the provider's OWN error envelope fields (never the API key,
 * never authorization headers, never StudyUS's own prompt/question
 * content, never student PII) plus the same execution-identity fields
 * `[ai]` already carries.
 */
export function logAIProviderError(meta: {
  operationId: string;
  capability: string;
  model: string;
  status: number;
  providerErrorType: string | null;
  providerErrorCode: string | null;
  providerErrorParam: string | null;
  providerErrorMessage: string | null;
}): void {
  console.warn('[ai-provider-error]', JSON.stringify(meta));
}
