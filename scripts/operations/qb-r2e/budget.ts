/**
 * QB-R2E -- the CUMULATIVE spend guard (no network in this file).
 *
 * QB-R2D and QB-R2E together may spend at most USD 5.00 on the assumed, deliberately high price basis. QB-R2D spent
 * 1.550575 of it. Before EVERY call:
 *
 *     R2D spend + R2E spend so far + worst case of this call   <=   5.00        else the call is refused, and not made
 *
 * ONE CALL PER ATTEMPT. There is no retry here of any kind: a call that returns no content, or content that is not
 * well-formed, is a failed attempt. The one regeneration an adaptation may have is a different prompt (attempt 2)
 * and a different call, decided by the pre-registered rule, not by this file.
 *
 * A call whose usage the provider did not report is charged at its worst case: an unknown cost is never zero.
 */
import type { GenerationProvider, ProviderResponse, RenderedPrompt } from '@/lib/exam-core/question-bank/production/generator/provider';
import { costOf, GUARD_PRICE_BASIS, type CallUsage, type PriceBasis } from '../qb-r2d/budget';

export const R2D_R2E_CUMULATIVE_CAP_USD = 5 as const;
export const R2E_MAX_OUTPUT_TOKENS = 2150 as const;
export const R2E_REASONING_EFFORT = 'low' as const;
/** Planned calls: 20 first attempts and at most 20 regenerations. No retries. */
export const R2E_MAX_CALLS = 40 as const;
/** An upper bound on input tokens. QB-R2D measured 3.6 to 3.8 characters per token on prompts of this kind; 2.5 leaves a wide margin. */
export const r2eInputTokenUpperBound = (text: string): number => Math.ceil(text.length / 2.5);
export const worstCaseCallUsd = (promptCharacters: number, price: PriceBasis = GUARD_PRICE_BASIS): number => costOf({ inputTokens: Math.ceil(promptCharacters / 2.5), outputTokens: R2E_MAX_OUTPUT_TOKENS }, price);

export type R2eCallOutcome = 'WELL_FORMED' | 'MALFORMED' | 'TRANSPORT_ERROR' | 'REQUEST_REJECTED' | 'REFUSED_BY_BUDGET';
export interface R2eLedgerEntry {
  seq: number; at: string; unitKey: string; promptHash: string; provider: string; requestedModel: string; servedModel: string | null; responseId: string | null; finishReason: string | null;
  maxOutputTokens: number; inputTokenUpperBound: number; worstCaseCostUsdGuardBasis: number; outcome: R2eCallOutcome; detail: string | null;
  usage: CallUsage | null; usageSource: 'PROVIDER_USAGE_RESPONSE' | 'NOT_REPORTED_CHARGED_AT_WORST_CASE' | 'NO_CALL_MADE';
  costUsdGuardBasis: number; costUsdRepoBasis: number | null; r2eSpentAfterUsdGuardBasis: number; cumulativeAfterUsdGuardBasis: number;
}
export interface R2eRecording { promptHash: string; unitKey: string; status: 'WELL_FORMED' | 'MALFORMED' | 'TRANSPORT_ERROR' | 'REQUEST_REJECTED'; malformedCode: string | null; provider: string; requestedModel: string; servedModel: string | null; responseId: string | null; finishReason: string | null; recordedAt: string; usage: CallUsage | null; rawText: string }

export class CumulativeBudgetExceededError extends Error {
  constructor(public readonly priorUsd: number, public readonly spentUsd: number, public readonly worstCaseUsd: number, public readonly capUsd: number) {
    super(`CUMULATIVE_BUDGET_WOULD_BE_EXCEEDED: R2D ${priorUsd.toFixed(6)} + R2E ${spentUsd.toFixed(6)} + worst case ${worstCaseUsd.toFixed(6)} > cap ${capUsd}`);
    this.name = 'CumulativeBudgetExceededError';
  }
}
/** The provider rejected the request itself (an HTTP 4xx). Not content, and not a failed attempt: the run is void. */
export class RequestRejectedError extends Error {
  constructor(public readonly status: number, detail: string) { super(`REQUEST_REJECTED_HTTP_${status}: ${detail}`); this.name = 'RequestRejectedError'; }
}

export class R2eLedger {
  readonly entries: R2eLedgerEntry[];
  constructor(public readonly priorSpendUsdGuardBasis: number, entries: readonly R2eLedgerEntry[] = []) { this.entries = [...entries]; }
  spentUsdGuardBasis(): number { return this.entries.reduce((n, e) => n + e.costUsdGuardBasis, 0); }
  cumulativeUsdGuardBasis(): number { return this.priorSpendUsdGuardBasis + this.spentUsdGuardBasis(); }
  calls(): number { return this.entries.filter((e) => e.outcome !== 'REFUSED_BY_BUDGET').length; }
  add(e: Omit<R2eLedgerEntry, 'seq' | 'r2eSpentAfterUsdGuardBasis' | 'cumulativeAfterUsdGuardBasis'>): R2eLedgerEntry {
    const spent = this.spentUsdGuardBasis() + e.costUsdGuardBasis;
    const entry: R2eLedgerEntry = { ...e, seq: this.entries.length + 1, r2eSpentAfterUsdGuardBasis: spent, cumulativeAfterUsdGuardBasis: this.priorSpendUsdGuardBasis + spent };
    this.entries.push(entry);
    return entry;
  }
}

export interface R2eTransport {
  readonly providerId: string;
  readonly model: string;
  /** Throws RequestRejectedError on an HTTP 4xx, any other error on a transport failure. */
  complete(request: { system: string; user: string; maxOutputTokens: number }): Promise<{ rawText: string; usage: CallUsage | null; servedModel: string | null; responseId: string | null; finishReason: string | null }>;
}
export interface R2eProviderOptions {
  transport: R2eTransport; ledger: R2eLedger; capUsd: number; guardPrice: PriceBasis; repoPrice: PriceBasis | null; maxOutputTokens: number; maxCalls: number;
  malformedCodeOf: (rawText: string) => string | null; unitKeyOf: (prompt: RenderedPrompt) => string; now: () => string;
  onRecording?: (r: R2eRecording) => void; onLedger?: (e: R2eLedgerEntry) => void;
}

/** One guarded call per prompt. Never retries. */
export class CumulativeBudgetProvider implements GenerationProvider {
  readonly id: string;
  readonly model: string;
  constructor(private readonly o: R2eProviderOptions) { this.id = o.transport.providerId; this.model = o.transport.model; }

  async generate(prompt: RenderedPrompt): Promise<ProviderResponse> {
    const p = prompt.prompt as { system: string; instruction: unknown };
    const user = JSON.stringify(p.instruction);
    const unitKey = this.o.unitKeyOf(prompt);
    const upperBound = r2eInputTokenUpperBound(p.system + user);
    const worstCase = costOf({ inputTokens: upperBound, outputTokens: this.o.maxOutputTokens }, this.o.guardPrice);
    const base = { at: this.o.now(), unitKey, promptHash: prompt.promptHash, provider: this.id, requestedModel: this.model, maxOutputTokens: this.o.maxOutputTokens, inputTokenUpperBound: upperBound, worstCaseCostUsdGuardBasis: worstCase };
    const record = (e: Omit<R2eLedgerEntry, 'seq' | 'r2eSpentAfterUsdGuardBasis' | 'cumulativeAfterUsdGuardBasis'>) => { const entry = this.o.ledger.add(e); this.o.onLedger?.(entry); };
    if (this.o.ledger.cumulativeUsdGuardBasis() + worstCase > this.o.capUsd || this.o.ledger.calls() >= this.o.maxCalls) {
      record({ ...base, servedModel: null, responseId: null, finishReason: null, outcome: 'REFUSED_BY_BUDGET', detail: this.o.ledger.calls() >= this.o.maxCalls ? `the plan allows ${this.o.maxCalls} calls` : `cumulative ${this.o.ledger.cumulativeUsdGuardBasis()} + worst case ${worstCase} > cap ${this.o.capUsd}`, usage: null, usageSource: 'NO_CALL_MADE', costUsdGuardBasis: 0, costUsdRepoBasis: 0 });
      throw new CumulativeBudgetExceededError(this.o.ledger.priorSpendUsdGuardBasis, this.o.ledger.spentUsdGuardBasis(), worstCase, this.o.capUsd);
    }
    try {
      const r = await this.o.transport.complete({ system: p.system, user, maxOutputTokens: this.o.maxOutputTokens });
      const malformed = this.o.malformedCodeOf(r.rawText);
      record({ ...base, servedModel: r.servedModel, responseId: r.responseId, finishReason: r.finishReason, outcome: malformed ? 'MALFORMED' : 'WELL_FORMED', detail: malformed, usage: r.usage, usageSource: r.usage ? 'PROVIDER_USAGE_RESPONSE' : 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdGuardBasis: r.usage ? costOf(r.usage, this.o.guardPrice) : worstCase, costUsdRepoBasis: r.usage && this.o.repoPrice ? costOf(r.usage, this.o.repoPrice) : null });
      this.o.onRecording?.({ promptHash: prompt.promptHash, unitKey, status: malformed ? 'MALFORMED' : 'WELL_FORMED', malformedCode: malformed, provider: this.id, requestedModel: this.model, servedModel: r.servedModel, responseId: r.responseId, finishReason: r.finishReason, recordedAt: base.at, usage: r.usage, rawText: r.rawText });
      return { providerId: this.id, model: this.model, promptHash: prompt.promptHash, rawText: r.rawText };
    } catch (e) {
      const rejected = e instanceof RequestRejectedError;
      const detail = (e as Error).message.slice(0, 300);
      // the request may have been billed: an unknown cost is charged at its worst case
      record({ ...base, servedModel: null, responseId: null, finishReason: null, outcome: rejected ? 'REQUEST_REJECTED' : 'TRANSPORT_ERROR', detail, usage: null, usageSource: 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdGuardBasis: worstCase, costUsdRepoBasis: null });
      this.o.onRecording?.({ promptHash: prompt.promptHash, unitKey, status: rejected ? 'REQUEST_REJECTED' : 'TRANSPORT_ERROR', malformedCode: null, provider: this.id, requestedModel: this.model, servedModel: null, responseId: null, finishReason: null, recordedAt: base.at, usage: null, rawText: '' });
      throw e;
    }
  }
}
