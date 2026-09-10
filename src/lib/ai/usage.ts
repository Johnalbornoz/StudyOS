/**
 * LX-4P-PERF-R1B B12 -- provider usage parsing.
 *
 * Extracts ACTUAL token counts from a raw provider response. Returns
 * `null` fields when the provider did not report them -- never a
 * fabricated estimate.
 */
import type { AIProvider } from './types';

export interface ProviderUsage {
  inputTokens: number | null;
  /** Portion of inputTokens served from the provider prompt cache. */
  cachedInputTokens: number | null;
  outputTokens: number | null;
}

const EMPTY: ProviderUsage = { inputTokens: null, cachedInputTokens: null, outputTokens: null };

export function parseProviderUsage(provider: AIProvider, raw: unknown): ProviderUsage {
  const r = raw as any;
  if (!r || typeof r !== 'object') return EMPTY;

  if (provider === 'openai') {
    const u = r.usage;
    if (!u) return EMPTY;
    return {
      inputTokens: numOrNull(u.prompt_tokens ?? u.input_tokens),
      cachedInputTokens: numOrNull(u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens),
      outputTokens: numOrNull(u.completion_tokens ?? u.output_tokens),
    };
  }

  // anthropic
  const u = r.usage;
  if (!u) return EMPTY;
  const cacheRead = numOrNull(u.cache_read_input_tokens);
  const baseIn = numOrNull(u.input_tokens);
  return {
    // Anthropic reports fresh input separately from cache reads; total input = both.
    inputTokens: baseIn === null && cacheRead === null ? null : (baseIn ?? 0) + (cacheRead ?? 0),
    cachedInputTokens: cacheRead,
    outputTokens: numOrNull(u.output_tokens),
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
