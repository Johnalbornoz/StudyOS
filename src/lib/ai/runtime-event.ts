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
import { aggregateCost, type BillableCallUsage } from './usage-aggregation';

export type { BillableCallUsage };

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
  /**
   * LX-4P-PERF-R1G -- present when this event AGGREGATES more than one
   * billable provider call (built via `buildAggregateRuntimeEvent`):
   * how many real provider calls were summed into `inputTokens` /
   * `cachedInputTokens` / `outputTokens` / `estimatedCostUSD`. Absent
   * (or 1) for a plain single-call event built via `buildRuntimeEvent`.
   */
  billableCalls?: number;
  /** cachedInputTokens / inputTokens -- present only when both are known and inputTokens > 0. Never inferred from latency. */
  cacheHitRatio?: number | null;
  /**
   * LX-4P-PERF-R1G R8 -- correlates this event to every OTHER event/log
   * line belonging to the same logical operation (e.g. a Luna attempt's
   * event, a Terra fallback attempt's event, and each constituent [ai]
   * per-call log all share one operationId). Never derived from learner
   * content -- a fresh opaque id per operation.
   */
  operationId?: string;
}

/**
 * A single-call runtime event (unchanged since R1B/R1C) -- computes cost
 * for exactly ONE model from the raw token counts given.
 */
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

/**
 * LX-4P-PERF-R1G -- an OPERATION-level runtime event: `calls` lists
 * every billable provider call that belongs to this one attempt (e.g. a
 * Luna generation call PLUS every semantic-verification call the
 * Quality Gate ran against its output). Each call is priced against its
 * OWN model (never a blended rate); token counts are summed for
 * observability; `estimatedCostUSD` is the sum of each call's own
 * dollar estimate, `costComplete` only when every one of them was
 * itself complete. Never counts the same provider call twice -- callers
 * must pass each real execution's usage exactly once.
 */
export function buildAggregateRuntimeEvent(
  base: Omit<AIRuntimeEvent, 'estimatedCostUSD' | 'costComplete' | 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'billableCalls' | 'cacheHitRatio'>,
  calls: BillableCallUsage[],
): AIRuntimeEvent {
  const agg = aggregateCost(calls);
  return {
    ...base,
    inputTokens: agg.totalInputTokens,
    cachedInputTokens: agg.totalCachedInputTokens,
    outputTokens: agg.totalOutputTokens,
    billableCalls: agg.billableCalls,
    cacheHitRatio: agg.cacheHitRatio,
    estimatedCostUSD: agg.estimatedCostUSD,
    costComplete: agg.costComplete,
  };
}

export function recordRuntimeEvent(ev: AIRuntimeEvent): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[ai-runtime]', JSON.stringify(ev));
  } catch {
    /* logging must never throw */
  }
}
