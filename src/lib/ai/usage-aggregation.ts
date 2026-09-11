/**
 * LX-4P-PERF-R1G -- aggregate REAL usage/cost across every billable
 * provider call that belongs to one logical operation (e.g. a Luna
 * generation call plus every semantic-verification call the Question
 * Quality Gate ran against its output).
 *
 * Centralized through the SAME configured pricing table `estimateCostUSD`
 * already uses (LX-4P-PERF-R1B/R1C-R1) -- cost is computed PER CALL
 * (each may be a different model/price) and the resulting DOLLAR amounts
 * are summed; raw token counts are summed separately for observability.
 * Never fabricates a total when any constituent call's cost is unknown.
 */
import type { ProviderUsage } from './usage';
import { estimateCostUSD } from './pricing';

export interface BillableCallUsage {
  /** The exact model this one provider call used -- cost is priced per call, never averaged across models. */
  model: string;
  usage: ProviderUsage;
}

export interface AggregatedCost {
  /** Sum of inputTokens across every call that reported one; null if none did. */
  totalInputTokens: number | null;
  /** Sum of cachedInputTokens across every call that reported one; null if none did. */
  totalCachedInputTokens: number | null;
  /** Sum of outputTokens across every call that reported one; null if none did. */
  totalOutputTokens: number | null;
  /** How many billable provider calls were aggregated. */
  billableCalls: number;
  /** totalCachedInputTokens / totalInputTokens -- only when both are known and totalInputTokens > 0. Never inferred from latency. */
  cacheHitRatio: number | null;
  /** Sum of each call's OWN estimated cost (each priced against its own model) -- never a single blended rate across models. */
  estimatedCostUSD: number | null;
  /** true ONLY when every constituent call's cost was itself complete (known usage + configured price + internally consistent). */
  costComplete: boolean;
}

const EMPTY: AggregatedCost = {
  totalInputTokens: null,
  totalCachedInputTokens: null,
  totalOutputTokens: null,
  billableCalls: 0,
  cacheHitRatio: null,
  estimatedCostUSD: null,
  costComplete: false,
};

export function aggregateCost(calls: BillableCallUsage[]): AggregatedCost {
  if (calls.length === 0) return { ...EMPTY };

  let totalInput = 0;
  let totalCached = 0;
  let totalOutput = 0;
  let sawInput = false;
  let sawCached = false;
  let sawOutput = false;
  let totalUsd = 0;
  let allComplete = true;

  for (const call of calls) {
    if (call.usage.inputTokens !== null) {
      totalInput += call.usage.inputTokens;
      sawInput = true;
    }
    if (call.usage.cachedInputTokens !== null) {
      totalCached += call.usage.cachedInputTokens;
      sawCached = true;
    }
    if (call.usage.outputTokens !== null) {
      totalOutput += call.usage.outputTokens;
      sawOutput = true;
    }

    const cost = estimateCostUSD({
      model: call.model,
      inputTokens: call.usage.inputTokens,
      cachedInputTokens: call.usage.cachedInputTokens,
      outputTokens: call.usage.outputTokens,
    });
    if (!cost.complete || cost.usd === null) {
      allComplete = false;
    } else {
      totalUsd += cost.usd;
    }
  }

  const totalInputTokens = sawInput ? totalInput : null;
  const totalCachedInputTokens = sawCached ? totalCached : null;
  const totalOutputTokens = sawOutput ? totalOutput : null;
  const cacheHitRatio =
    totalInputTokens !== null && totalInputTokens > 0 && totalCachedInputTokens !== null
      ? totalCachedInputTokens / totalInputTokens
      : null;

  return {
    totalInputTokens,
    totalCachedInputTokens,
    totalOutputTokens,
    billableCalls: calls.length,
    cacheHitRatio,
    estimatedCostUSD: allComplete ? totalUsd : null,
    costComplete: allComplete,
  };
}
