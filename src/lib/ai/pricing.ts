/**
 * LX-4P-PERF-R1B B12 -- configured price table (NOT vendor billing truth).
 *
 * `estimateCostUSD` = ACTUAL token usage (from parseProviderUsage) x this
 * CONFIGURED table. It is an estimate for internal KPIs, clearly not an
 * invoice. Update the table when prices are confirmed.
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M cached input tokens (usually a fraction of inputPerM). */
  cachedInputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
}

/**
 * CONFIGURED REFERENCE PRICES (LX-4P-PERF-R1C C15) -- USD per 1M tokens.
 * These are a configured table, NOT billing-system truth. `estimateCostUSD`
 * = provider-reported token usage x this table. Update when prices change.
 * `0` for a model means "not configured" -> the estimate for it reads $0
 * with `complete: false`, never a guess.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  'gpt-5.6-luna': { inputPerM: 0.2, cachedInputPerM: 0.02, outputPerM: 1.2 },
  'gpt-5.6-terra': { inputPerM: 2.0, cachedInputPerM: 0.2, outputPerM: 12.0 },
  'claude-sonnet-5': { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 },
  'claude-haiku-4-5-20251001': { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 },
};

export interface CostInputs {
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}

export interface CostEstimate {
  usd: number | null;
  /** true when every needed usage figure was present AND the model has a non-zero configured price. */
  complete: boolean;
  note: string;
}

export function estimateCostUSD(i: CostInputs): CostEstimate {
  const price = MODEL_PRICING[i.model];
  if (!price) return { usd: null, note: `no configured price for ${i.model}`, complete: false };
  if (i.inputTokens === null && i.outputTokens === null) {
    return { usd: null, note: 'no provider usage reported', complete: false };
  }
  const cached = i.cachedInputTokens ?? 0;
  const freshInput = Math.max(0, (i.inputTokens ?? 0) - cached);
  const usd =
    (freshInput / 1_000_000) * price.inputPerM +
    (cached / 1_000_000) * price.cachedInputPerM +
    ((i.outputTokens ?? 0) / 1_000_000) * price.outputPerM;
  const priced = price.inputPerM > 0 || price.outputPerM > 0;
  return {
    usd,
    complete: priced && i.inputTokens !== null && i.outputTokens !== null,
    note: priced ? 'estimate from configured price table' : 'price table has $0 for this model -- configure MODEL_PRICING',
  };
}
