import { randomUUID } from 'crypto';
import type { AICapability, AIRiskLevel, AIProvider, AIExecutionMetadata, AIExecutionOutcome, AIValidationResult, AIExecutionContext } from './types';
import { AIExecutionError, normalizeProviderError } from './errors';
import { logAIExecution } from './logging';
import { getAIExecutionAuditSink } from './audit';

/** No AI call in StudyUs waits forever (Step 7) -- 30s covers every current call's observed shape, including large batch generations. */
export const DEFAULT_AI_TIMEOUT_MS = 30_000;

export interface ExecuteAIOptions<TRaw, TResult> {
  capability: AICapability;
  risk: AIRiskLevel;
  provider: AIProvider;
  model: string;
  promptId: string;
  promptVersion: string;
  /** Defaults to DEFAULT_AI_TIMEOUT_MS. Bounded -- never indefinite. */
  timeoutMs?: number;
  /**
   * Optional domain context (student/subject/concept/source) for this
   * execution (Step 11) -- purely additive, never required. Persisted
   * alongside the execution record when the audit sink is active.
   */
  context?: AIExecutionContext;
  /** Performs the actual provider call. Must respect the given AbortSignal. */
  call: (signal: AbortSignal) => Promise<TRaw>;
  /** Parses + validates the raw provider response into a typed domain result. Never optional -- HIGH_RISK outputs cannot bypass this (Step 11). */
  validate: (raw: TRaw) => AIValidationResult<TResult>;
  /**
   * Optional, explicit fallback value computed from the normalized
   * error. When provided, a failure resolves to this value instead of
   * throwing (fallbackUsed: true in the returned execution metadata).
   * Existing call sites that already had a safe fallback (e.g. "return
   * null on parse failure") pass one here to preserve that exact
   * behavior; call sites that previously let the error propagate pass
   * none, and the AIExecutionError is thrown as before.
   */
  fallback?: (error: AIExecutionError) => TResult;
}

/** Error thrown by executeAI on failure with no fallback configured. Carries the execution metadata that was recorded before the throw. */
export class AIExecutionFailure extends AIExecutionError {
  readonly execution: AIExecutionMetadata;
  constructor(inner: AIExecutionError, execution: AIExecutionMetadata) {
    super(inner.code, inner.message);
    this.name = 'AIExecutionFailure';
    this.execution = execution;
  }
}

/**
 * The one execution path every AI provider call in StudyUs goes
 * through (Step 3-11). Produces a unique execution id, bounds the call
 * with a timeout, normalizes provider errors, always validates the
 * response before handing back a typed result, and logs safe,
 * structured execution metadata -- on both success and failure.
 *
 * This function makes no pedagogical decisions. It has no notion of
 * mastery, grading thresholds, or correctness -- it only gets a typed,
 * validated result from a provider to the caller's own deterministic
 * business logic (Step 11).
 */
export async function executeAI<TRaw, TResult>(opts: ExecuteAIOptions<TRaw, TResult>): Promise<AIExecutionOutcome<TResult>> {
  const executionId = randomUUID();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const baseMeta = {
    executionId,
    capability: opts.capability,
    risk: opts.risk,
    provider: opts.provider,
    model: opts.model,
    promptId: opts.promptId,
    promptVersion: opts.promptVersion,
    startedAt,
  };
  const finish = (partial: Pick<AIExecutionMetadata, 'success' | 'validationStatus' | 'fallbackUsed' | 'errorCode'>): AIExecutionMetadata => ({
    ...baseMeta,
    durationMs: Date.now() - startedAtMs,
    ...partial,
  });
  const provenanceFor = (): AIExecutionOutcome<TResult>['provenance'] => ({
    aiExecutionId: executionId,
    aiProvider: opts.provider,
    aiModel: opts.model,
    aiPromptId: opts.promptId,
    aiPromptVersion: opts.promptVersion,
  });

  /**
   * Logs and persists one execution's metadata (Step 9/10). Awaited so
   * a caller inspecting the audit trail right after executeAI()
   * resolves can rely on the write having been attempted. The
   * well-behaved sink (src/lib/ai/audit.ts's postgresAIExecutionAuditSink)
   * already never throws -- this try/catch is defense in depth so that
   * even a misbehaving custom sink (e.g. a test double) can never break
   * or delay-fail the primary AI/domain operation. A successful AI
   * execution is NEVER lost because the audit database is unavailable.
   */
  const emit = async (execution: AIExecutionMetadata): Promise<AIExecutionMetadata> => {
    logAIExecution(execution);
    try {
      await getAIExecutionAuditSink().record({ execution, context: opts.context });
    } catch (err) {
      console.error('[ai-audit] audit sink threw -- ignored, primary operation unaffected', {
        executionId: execution.executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return execution;
  };

  /** Resolves a failure to either a fallback outcome or a thrown AIExecutionFailure -- the one place both failure branches converge. */
  const resolveFailure = async (
    aiErr: AIExecutionError,
    validationStatus: AIExecutionMetadata['validationStatus']
  ): Promise<AIExecutionOutcome<TResult>> => {
    if (opts.fallback) {
      const execution = await emit(finish({ success: false, validationStatus, fallbackUsed: true, errorCode: aiErr.code }));
      return { result: opts.fallback(aiErr), execution, provenance: provenanceFor() };
    }
    const execution = await emit(finish({ success: false, validationStatus, fallbackUsed: false, errorCode: aiErr.code }));
    throw new AIExecutionFailure(aiErr, execution);
  };

  let raw: TRaw;
  try {
    raw = await opts.call(controller.signal);
  } catch (err) {
    clearTimeout(timer);
    return resolveFailure(normalizeProviderError(err, controller.signal.aborted), 'NOT_APPLICABLE');
  }
  clearTimeout(timer);

  let validation: AIValidationResult<TResult>;
  try {
    validation = opts.validate(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return resolveFailure(new AIExecutionError('INVALID_RESPONSE', `Failed to parse/validate ${opts.capability} response: ${message}`), 'FAILED');
  }

  if (!validation.valid) {
    return resolveFailure(
      new AIExecutionError('VALIDATION_ERROR', `Validation failed for ${opts.capability}: ${(validation.errors ?? []).join('; ') || 'unknown reason'}`),
      'FAILED'
    );
  }

  const execution = await emit(finish({ success: true, validationStatus: 'PASSED', fallbackUsed: false }));
  return { result: validation.value as TResult, execution, provenance: provenanceFor() };
}
