/**
 * QUESTION FACTORY CANARY 250 -- making the calls of one phase (no network here: the transport is given; no file IO:
 * the run log writes through the function it was given). FROZEN.
 *
 * For every planned call, in the order given, with at most `concurrency` in flight:
 *   1. the budget is asked BEFORE the call: prior spend + canary spend + worst case of the calls in flight + worst
 *      case of this one must fit the cap (and, for generation, the generation-phase cap);
 *   2. CALL_STARTED is written, then the request leaves, then CALL_FINISHED is written. One call. No retry.
 *
 * STOP RULES, stated before any call is made:
 *   BUDGET STOP      the first call the budget refuses closes itself and EVERY call planned after it as
 *                    NOT_CALLED (BUDGET_STOP), in order. Calls already in flight finish.
 *   REQUEST REJECTED an HTTP 4xx (other than 408 / 429) means the request itself is wrong. The slot is a provider
 *                    failure; no further call is started; the slots not yet called stay NOT_RUN and the operator
 *                    decides whether the run is resumed.
 *   OUTAGE           five transport failures in a row: the same halt, so that an outage does not consume the slots.
 * A slot whose call was made is never called again, whatever happened to it.
 */
import type { R2eTransport } from '../qb-r2e/budget';
import { RequestRejectedError } from '../qb-r2e/budget';
import { assumedCostOf, budgetRefusalFor, CANARY_GENERATION_MAX_OUTPUT_TOKENS, CANARY_REVIEW_MAX_OUTPUT_TOKENS, generationInputTokenUpperBound, generationWorstCaseUsd, reviewInputTokenUpperBound, reviewWorstCaseUsd } from './budget';
import type { Phase, RunLog } from './run-log';

export const CANARY_MAX_CONCURRENCY = 4 as const;
export const CONSECUTIVE_TRANSPORT_FAILURES_THAT_HALT = 5 as const;
export interface PlannedCall { slotId: string; requestHash: string; system: string; user: string }
export interface PhaseRun { started: number; finished: number; closedByBudget: number; halted: null | 'REQUEST_REJECTED' | 'CONSECUTIVE_TRANSPORT_FAILURES'; detail: string | null }

export async function runPhase(p: {
  phase: Exclude<Phase, 'PREFLIGHT'>; plans: readonly PlannedCall[]; log: RunLog; transport: R2eTransport; priorUsd: number; concurrency: number; now: () => string;
  /** null when the answer is well-formed for this phase; a code otherwise. */
  malformedCodeOf: (rawText: string) => string | null;
  caps?: { cumulative: number; generationPhase: number };
  onCall?: (slotId: string, status: string, cumulativeUsd: number) => void;
}): Promise<PhaseRun> {
  if (!Number.isInteger(p.concurrency) || p.concurrency < 1 || p.concurrency > CANARY_MAX_CONCURRENCY) throw new Error(`CONCURRENCY_OUT_OF_RANGE: ${p.concurrency}`);
  const queue = p.plans.filter((x) => p.log.outcomeOf(p.phase, x.slotId).state === 'NOT_RUN');
  const run: PhaseRun = { started: 0, finished: 0, closedByBudget: 0, halted: null, detail: null };
  let next = 0, budgetStopped = false, consecutiveTransportFailures = 0;
  const maxOutputTokens = p.phase === 'GENERATION' ? CANARY_GENERATION_MAX_OUTPUT_TOKENS : CANARY_REVIEW_MAX_OUTPUT_TOKENS;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (run.halted || next >= queue.length) return;
      const plan = queue[next];
      next += 1;
      const characters = plan.system.length + plan.user.length;
      const worstCase = p.phase === 'GENERATION' ? generationWorstCaseUsd(characters) : reviewWorstCaseUsd(characters);
      const committed = p.priorUsd + p.log.spentUsd();
      const refusal = budgetStopped ? 'CUMULATIVE_CAP' : budgetRefusalFor(p.phase, committed, worstCase, p.caps);
      if (budgetStopped || refusal) {
        // the first refusal stops the phase: this call and every one after it is closed, in order
        const detail = budgetStopped ? 'the phase was stopped by the budget at an earlier slot' : `${refusal}: committed ${committed.toFixed(6)} + worst case ${worstCase.toFixed(6)}`;
        budgetStopped = true;
        p.log.closeNotCalled({ phase: p.phase, slotId: plan.slotId, at: p.now(), reason: 'BUDGET_STOP', detail });
        run.closedByBudget += 1;
        continue;
      }
      // from here to the await nothing yields: no other worker can start the same slot, and the log refuses it anyway
      p.log.startCall({ phase: p.phase, slotId: plan.slotId, requestHash: plan.requestHash, at: p.now(), provider: p.transport.providerId, requestedModel: p.transport.model, maxOutputTokens, inputTokenUpperBound: p.phase === 'GENERATION' ? generationInputTokenUpperBound(characters) : reviewInputTokenUpperBound(characters), worstCaseCostUsdAssumed: worstCase });
      run.started += 1;
      let status = 'WELL_FORMED';
      try {
        const r = await p.transport.complete({ system: plan.system, user: plan.user, maxOutputTokens });
        const malformed = p.malformedCodeOf(r.rawText);
        status = malformed ? 'MALFORMED' : 'WELL_FORMED';
        p.log.finishCall({ phase: p.phase, slotId: plan.slotId, requestHash: plan.requestHash, at: p.now(), status: malformed ? 'MALFORMED' : 'WELL_FORMED', detail: malformed, servedModel: r.servedModel, responseId: r.responseId, finishReason: r.finishReason, usage: r.usage, usageSource: r.usage ? 'PROVIDER_USAGE_RESPONSE' : 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdAssumed: r.usage ? assumedCostOf(p.phase, r.usage) : worstCase, rawText: r.rawText });
        consecutiveTransportFailures = 0;
      } catch (e) {
        const rejected = e instanceof RequestRejectedError;
        status = rejected ? 'REQUEST_REJECTED' : 'TRANSPORT_ERROR';
        const detail = (e as Error).message.slice(0, 300);
        // the request may have been billed: an unknown cost is charged at its worst case
        p.log.finishCall({ phase: p.phase, slotId: plan.slotId, requestHash: plan.requestHash, at: p.now(), status: rejected ? 'REQUEST_REJECTED' : 'TRANSPORT_ERROR', detail, servedModel: null, responseId: null, finishReason: null, usage: null, usageSource: 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdAssumed: worstCase, rawText: '' });
        if (rejected) { run.halted = 'REQUEST_REJECTED'; run.detail = detail; }
        else { consecutiveTransportFailures += 1; if (consecutiveTransportFailures >= CONSECUTIVE_TRANSPORT_FAILURES_THAT_HALT && !run.halted) { run.halted = 'CONSECUTIVE_TRANSPORT_FAILURES'; run.detail = detail; } }
      }
      run.finished += 1;
      p.onCall?.(plan.slotId, status, p.priorUsd + p.log.spentUsd());
    }
  };
  await Promise.all(Array.from({ length: Math.min(p.concurrency, Math.max(1, queue.length)) }, () => worker()));
  return run;
}
