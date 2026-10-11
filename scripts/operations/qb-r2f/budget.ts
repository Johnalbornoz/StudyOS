/**
 * QB-R2F -- the budget of the next run (no network in this file). FROZEN.
 *
 * The cumulative cap of QB-R2D + QB-R2E + QB-R2F on the assumed, deliberately high price basis is the constant below.
 * It is USD 5.00, as the Orchestrator set it. Raising it is the Orchestrator's decision and a change to this file,
 * i.e. it must be made BEFORE the freeze commit.
 *
 * TWO GUARDS.
 *   per call   (QB-R2E's guard, reused unchanged) prior spend + this run's spend + worst case of this call <= cap
 *   whole plan (new) before the FIRST call: prior spend + worst case of all 40 planned calls <= cap. A run whose
 *              worst case does not fit is not started: it could otherwise be cut off half-way by the per-call guard,
 *              and a half-run cannot be evaluated against criteria with a denominator of 20.
 *
 * WORST CASE OF A CALL: output at the cap; input bounded at one token per 2.5 characters (QB-R2E measured about 3.1
 * characters per token on these prompts) of the unit's prompt at its LARGEST: the prompt rendered with what earlier
 * runs make it avoid, plus the most the fresh batch can add to its do-not-reuse lists.
 */
import { costOf, GUARD_PRICE_BASIS, type PriceBasis } from '../qb-r2d/budget';

export const R2F_CUMULATIVE_CAP_USD = 5 as const;
export const R2F_MAX_OUTPUT_TOKENS = 2150 as const;
export const R2F_REASONING_EFFORT = 'low' as const;
export const R2F_MAX_CALLS = 40 as const;
/** The most the fresh batch can add to one prompt: a scenario (at most 160 characters) from each other attempt of both rounds, and a parameter set from each attempt of its own construct (at most six adaptations share a construct, hence twelve). */
export const R2F_MAX_AVOID_GROWTH_CHARACTERS = 39 * (160 + 8) + 12 * 96;
export const r2fInputTokenUpperBound = (promptCharacters: number): number => Math.ceil((promptCharacters + R2F_MAX_AVOID_GROWTH_CHARACTERS) / 2.5);
export const r2fWorstCaseCallUsd = (promptCharacters: number, price: PriceBasis = GUARD_PRICE_BASIS): number => costOf({ inputTokens: r2fInputTokenUpperBound(promptCharacters), outputTokens: R2F_MAX_OUTPUT_TOKENS }, price);

export interface PlanBudget { priorSpendUsd: number; capUsd: number; remainingUsd: number; calls: number; worstCasePlanUsd: number; cumulativeWorstCaseUsd: number; fits: boolean; minimumRequiredCapUsd: number }
/** Does the worst case of the whole plan fit? `basePromptCharacters`: one figure per adaptation, its first-attempt prompt rendered with the earlier runs' lists only. */
export function planBudget(priorSpendUsd: number, basePromptCharacters: readonly number[], capUsd: number = R2F_CUMULATIVE_CAP_USD): PlanBudget {
  // two calls per adaptation at most: the first attempt and the one regeneration
  const worstCasePlanUsd = basePromptCharacters.reduce((n, c) => n + 2 * r2fWorstCaseCallUsd(c), 0);
  const cumulative = priorSpendUsd + worstCasePlanUsd;
  return { priorSpendUsd, capUsd, remainingUsd: capUsd - priorSpendUsd, calls: 2 * basePromptCharacters.length, worstCasePlanUsd, cumulativeWorstCaseUsd: cumulative, fits: cumulative <= capUsd, minimumRequiredCapUsd: Math.ceil(cumulative * 4) / 4 };
}
export class PlanDoesNotFitTheCapError extends Error {
  constructor(public readonly plan: PlanBudget) {
    super(`PLAN_DOES_NOT_FIT_THE_CAP: prior ${plan.priorSpendUsd.toFixed(6)} + worst case of ${plan.calls} calls ${plan.worstCasePlanUsd.toFixed(6)} = ${plan.cumulativeWorstCaseUsd.toFixed(6)} > cap ${plan.capUsd}; minimum required cap ${plan.minimumRequiredCapUsd}`);
    this.name = 'PlanDoesNotFitTheCapError';
  }
}
