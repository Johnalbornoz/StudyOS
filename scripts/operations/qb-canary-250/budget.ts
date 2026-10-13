/**
 * QUESTION FACTORY CANARY 250 -- spend: the assumed price bases, the bounds, the cap and the projection (pure). FROZEN.
 *
 * ONE CUMULATIVE CAP for everything: QB-R2D + QB-R2E (already spent) + every generator call + every reviewer call
 * of the canary may not exceed USD 30.00 on the ASSUMED basis. Before EVERY call, of either kind:
 *
 *     prior spend + canary spend so far + worst case of calls in flight + worst case of this call   <=   30.00
 *
 * else the call is not made and the slot is closed NOT_CALLED_BUDGET_STOP. There is no regeneration and no retry.
 *
 * THE PRICES ARE ASSUMPTIONS, labelled as such. They are not invoices and not quotations.
 *   generator   USD 5 / 30 per million tokens in / out -- the basis QB-R2D and QB-R2E were guarded on. The
 *               repository's configured price for that model is 0.2 / 1.2, so this basis is about 25 times higher.
 *   reviewer    USD 5 / 30 per million tokens in / out as well: the floor the orchestrator set. The repository's
 *               price table does not price the reviewer model (its Claude rows are zero), so it suggests nothing
 *               higher. BE AWARE: unlike the generator's, this basis is NOT many times the reviewer's real price.
 *               The reviewer's vendor list price is of the same order as the assumption, so the assumed reviewer
 *               spend is close to real money, where the assumed generator spend is mostly margin.
 * A call whose usage was not reported, and a call that was started and never recorded, is charged at its worst case.
 */
import { costOf, GUARD_PRICE_BASIS, type CallUsage, type PriceBasis } from '../qb-r2d/budget';

export const CANARY_CUMULATIVE_CAP_USD = 30 as const;
/**
 * Generation may take the cumulative spend up to this and no further, so that a generation phase that costs more
 * than projected cannot leave the reviewer with nothing. (The whole cap still applies to every call.)
 */
export const CANARY_GENERATION_PHASE_CAP_USD = 19 as const;
export const GENERATOR_PRICE_BASIS: PriceBasis = GUARD_PRICE_BASIS;
export const REVIEWER_PRICE_BASIS: PriceBasis = { id: 'qb-canary-250-reviewer-assumed-price', label: 'ASSUMED', source: 'Canary assumption: the floor set by the orchestrator (the generator\'s assumed basis). The repository price table does not price this model. Not a vendor quotation and not an invoice; close to, not far above, the vendor list price.', inputPerMillionUsd: 5, outputPerMillionUsd: 30 };

export const CANARY_GENERATION_MAX_OUTPUT_TOKENS = 2150 as const;
/** The reviewer runs with thinking off: what it writes is the structured answer. */
export const CANARY_REVIEW_MAX_OUTPUT_TOKENS = 1600 as const;
/** Upper bounds on input tokens. Generator: as in QB-R2E (measured 3.6 to 3.8 characters per token). Reviewer: another tokenizer, unmeasured here, so a wider margin. */
export const generationInputTokenUpperBound = (characters: number): number => Math.ceil(characters / 2.5);
export const reviewInputTokenUpperBound = (characters: number): number => Math.ceil(characters / 2);
export const generationWorstCaseUsd = (promptCharacters: number): number => costOf({ inputTokens: generationInputTokenUpperBound(promptCharacters), outputTokens: CANARY_GENERATION_MAX_OUTPUT_TOKENS }, GENERATOR_PRICE_BASIS);
export const reviewWorstCaseUsd = (promptCharacters: number): number => costOf({ inputTokens: reviewInputTokenUpperBound(promptCharacters), outputTokens: CANARY_REVIEW_MAX_OUTPUT_TOKENS }, REVIEWER_PRICE_BASIS);
export const assumedCostOf = (phase: 'GENERATION' | 'REVIEW' | 'PREFLIGHT', usage: Pick<CallUsage, 'inputTokens' | 'outputTokens'>): number => costOf(usage, phase === 'GENERATION' ? GENERATOR_PRICE_BASIS : REVIEWER_PRICE_BASIS);

export type BudgetRefusal = 'CUMULATIVE_CAP' | 'GENERATION_PHASE_CAP';
/** PURE. May a call of this worst case be started now? `committedUsd` is prior spend + canary spend + worst case of calls in flight. */
export function budgetRefusalFor(phase: 'GENERATION' | 'REVIEW' | 'PREFLIGHT', committedUsd: number, worstCaseUsd: number, caps: { cumulative: number; generationPhase: number } = { cumulative: CANARY_CUMULATIVE_CAP_USD, generationPhase: CANARY_GENERATION_PHASE_CAP_USD }): BudgetRefusal | null {
  if (committedUsd + worstCaseUsd > caps.cumulative + 1e-12) return 'CUMULATIVE_CAP';
  if (phase === 'GENERATION' && committedUsd + worstCaseUsd > caps.generationPhase + 1e-12) return 'GENERATION_PHASE_CAP';
  return null;
}

/** What the projection assumes, each number with where it comes from. */
export const PROJECTION_ASSUMPTIONS = {
  generationCharactersPerInputToken: { value: 3.7, source: 'MEASURED: QB-R2D and QB-R2E ledgers, same provider and prompt kind (3.6 to 3.8)' },
  generationOutputTokensPerCall: { value: 1308, source: 'MEASURED: mean of the 26 QB-R2E calls (largest 1,675), reasoning tokens included' },
  generationCandidateRate: { value: 0.85, source: 'MEASURED on 20 adaptations only: 22 candidates from 26 calls in QB-R2E. A reviewer call is made for candidates only.' },
  reviewCharactersPerInputToken: { value: 2.8, source: 'ASSUMED, NOT MEASURED: the reviewer model\'s tokenizer is another one; its vendor says it uses up to about 1.35 times the tokens of earlier tokenizers' },
  reviewOutputTokensPerCall: { value: 800, source: 'ASSUMED, NOT MEASURED: a structured answer of ten short reasons and a worked solution of at most 120 words, thinking off. The reviewer has never been called; this is the least certain number of the projection.' },
} as const;
export interface Projection {
  priorUsd: number; capUsd: number;
  generation: { calls: number; promptCharacters: { min: number; max: number; mean: number }; expectedUsd: number; worstCaseUsd: number };
  review: { expectedCalls: number; maxCalls: number; promptCharacters: { min: number; max: number; mean: number; measuredOn: string }; expectedUsd: number; worstCaseUsd: number };
  expectedCumulativeUsd: number; worstCaseCumulativeUsd: number; expectedHeadroomUsd: number; expectedFits: boolean; worstCaseFits: boolean;
  reviewsAffordableAtWorstCaseAfterExpectedGeneration: number;
}
const stats = (xs: readonly number[]) => ({ min: Math.min(...xs), max: Math.max(...xs), mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) });
export function projectSpend(p: { priorUsd: number; generationPromptCharacters: readonly number[]; reviewPromptCharacters: readonly number[]; reviewMeasuredOn: string; capUsd?: number }): Projection {
  const A = PROJECTION_ASSUMPTIONS;
  const cap = p.capUsd ?? CANARY_CUMULATIVE_CAP_USD;
  const generationExpected = p.generationPromptCharacters.reduce((n, c) => n + costOf({ inputTokens: c / A.generationCharactersPerInputToken.value, outputTokens: A.generationOutputTokensPerCall.value }, GENERATOR_PRICE_BASIS), 0);
  const generationWorst = p.generationPromptCharacters.reduce((n, c) => n + generationWorstCaseUsd(c), 0);
  const r = stats(p.reviewPromptCharacters);
  const reviewExpectedOne = costOf({ inputTokens: r.mean / A.reviewCharactersPerInputToken.value, outputTokens: A.reviewOutputTokensPerCall.value }, REVIEWER_PRICE_BASIS);
  const reviewWorstOne = reviewWorstCaseUsd(r.max);
  const maxCalls = p.generationPromptCharacters.length;
  const expectedCalls = Math.round(maxCalls * A.generationCandidateRate.value);
  const expectedCumulative = p.priorUsd + generationExpected + expectedCalls * reviewExpectedOne;
  const worstCumulative = p.priorUsd + generationWorst + maxCalls * reviewWorstOne;
  return {
    priorUsd: p.priorUsd, capUsd: cap,
    generation: { calls: maxCalls, promptCharacters: stats(p.generationPromptCharacters), expectedUsd: generationExpected, worstCaseUsd: generationWorst },
    review: { expectedCalls, maxCalls, promptCharacters: { ...r, measuredOn: p.reviewMeasuredOn }, expectedUsd: expectedCalls * reviewExpectedOne, worstCaseUsd: maxCalls * reviewWorstOne },
    expectedCumulativeUsd: expectedCumulative, worstCaseCumulativeUsd: worstCumulative, expectedHeadroomUsd: cap - expectedCumulative, expectedFits: expectedCumulative <= cap, worstCaseFits: worstCumulative <= cap,
    reviewsAffordableAtWorstCaseAfterExpectedGeneration: Math.max(0, Math.floor((cap - p.priorUsd - generationExpected) / reviewWorstOne)),
  };
}
