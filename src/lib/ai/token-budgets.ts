/**
 * LX-4P-PERF-R1B B7 -- explicit per-capability token / context budgets.
 *
 * Replaces the ad-hoc `Math.min(16000, 900 * n + 1500)` sizing with a
 * declared, bounded envelope per runtime purpose. Structured payloads
 * only -- no conversational slack.
 */
export interface TokenBudget {
  /** Hard cap on generated tokens for this purpose. */
  maxOutputTokens: number;
  /** Soft cap on retrieved-context characters folded into the prompt (bounded truncation, never below academic need). */
  maxContextChars: number;
  /** Optional reasoning-effort hint for providers that accept one. Lowest that passes the quality bar. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export const TOKEN_BUDGETS = {
  /** ~3-question canonical Practice batch. */
  question_generation_practice: { maxOutputTokens: 4200, maxContextChars: 6000, reasoningEffort: 'low' },
  /** One chunk of the >4-question parallel path. */
  question_generation_chunk: { maxOutputTokens: 5100, maxContextChars: 6000, reasoningEffort: 'low' },
  /** quick_check single slot. */
  question_generation_slot: { maxOutputTokens: 2400, maxContextChars: 4000, reasoningEffort: 'minimal' },
  concept_explanation: { maxOutputTokens: 2200, maxContextChars: 6000, reasoningEffort: 'low' },
  guided_practice: { maxOutputTokens: 1600, maxContextChars: 5000, reasoningEffort: 'low' },
  /** LX-4P-PERF-R1D: optional interactive-formula widget enrichment -- off the MODEL critical path, bounded, generated once. */
  interactive_formula: { maxOutputTokens: 1500, maxContextChars: 3000, reasoningEffort: 'low' },
  contextual_help: { maxOutputTokens: 700, maxContextChars: 3000, reasoningEffort: 'minimal' },
  question_localization: { maxOutputTokens: 2000, maxContextChars: 0, reasoningEffort: 'minimal' },
  semantic_verification: { maxOutputTokens: 900, maxContextChars: 0, reasoningEffort: 'low' },
} as const satisfies Record<string, TokenBudget>;

export type TokenBudgetKey = keyof typeof TOKEN_BUDGETS;

export function budgetFor(key: TokenBudgetKey): TokenBudget {
  return TOKEN_BUDGETS[key];
}

/** Bounded, deterministic context truncation to a budget -- keeps whole chunks, never splits mid-chunk, never drops below one chunk. */
export function fitContextChunks(chunks: { text: string }[], maxChars: number): { text: string }[] {
  if (maxChars <= 0) return [];
  const out: { text: string }[] = [];
  let used = 0;
  for (const c of chunks) {
    if (out.length > 0 && used + c.text.length > maxChars) break;
    out.push(c);
    used += c.text.length;
  }
  return out.length > 0 ? out : chunks.slice(0, 1);
}
