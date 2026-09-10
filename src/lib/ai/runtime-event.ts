/**
 * LX-4P-PERF-R1B B12 -- richer AI runtime telemetry.
 *
 * Sits ALONGSIDE `executeAI`'s existing `[ai]` line. Captures token
 * usage (ACTUAL, from parseProviderUsage -- never fabricated), the
 * fallback decision, and the quality-gate verdict for one gated
 * generation. Logged as `[ai-runtime]`; never carries learner content.
 */
import type { AIProvider, AICapability } from './types';
import { estimateCostUSD } from './pricing';

export type QualityGateResult = 'PASS' | 'DETERMINISTIC_FAIL' | 'SEMANTIC_FAIL' | 'REJECTED' | 'NOT_RUN';

export interface AIRuntimeEvent {
  capability: AICapability;
  provider: AIProvider;
  model: string;
  promptId: string;
  promptVersion: string;
  reasoningEffort?: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  qualityGateResult: QualityGateResult;
  /**
   * LX-4P-PERF-R1C-R1 -- how many generated questions this attempt
   * contributed after the Question Quality Gate, and how many it
   * rejected. Present only for gated generation attempts; lets the live
   * benchmark compute first-pass acceptance rate, Terra fallback rate,
   * accepted/generated ratio, and cost per accepted question. Never
   * carries learner content.
   */
  acceptedCount?: number;
  rejectedCount?: number;
  estimatedCostUSD: number | null;
  costComplete: boolean;
}

export function buildRuntimeEvent(
  base: Omit<AIRuntimeEvent, 'estimatedCostUSD' | 'costComplete'>,
): AIRuntimeEvent {
  const cost = estimateCostUSD({
    model: base.model,
    inputTokens: base.inputTokens,
    cachedInputTokens: base.cachedInputTokens,
    outputTokens: base.outputTokens,
  });
  return { ...base, estimatedCostUSD: cost.usd, costComplete: cost.complete };
}

export function recordRuntimeEvent(ev: AIRuntimeEvent): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[ai-runtime]', JSON.stringify(ev));
  } catch {
    /* logging must never throw */
  }
}
