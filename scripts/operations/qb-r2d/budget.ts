/**
 * QB-R2D -- the spend guard, the ledger and the retry rule of a LIVE generation run (no network in this file).
 *
 * The lane may spend at most USD 20. That is enforced HERE, in code, before every call:
 *
 *     spent so far (guard basis) + worst-case cost of this call (guard basis)  <=  cap      else the call is refused
 *
 * PRICE BASIS. Two price tables are applied to the provider's own usage figures, and both are recorded per call:
 *   GUARD   a deliberately HIGH, ASSUMED price. It is not a quotation; it exists so that the guard errs on the side
 *           of refusing. The cap is enforced on this basis.
 *   REPO    the repository's configured reference price for the model (`src/lib/ai/pricing.ts`), which that file
 *           itself labels "configured, NOT vendor billing truth".
 * Neither is an invoice. The provider's billing is the only truth about money and this lane cannot read it.
 *
 * RETRY RULE. At most ONE retry per prompt, and only when the first answer was a transport failure or was not even
 * well-formed. A well-formed answer whose CONTENT is wrong is a result: it is never retried here. A second attempt
 * at content is an explicit regeneration, with its own unit key, prompt hash and ledger rows.
 *
 * A call whose usage the provider did not report (a transport failure after the request left) is charged at its
 * WORST CASE on the guard basis: an unknown cost is never counted as zero.
 */
import type { GenerationProvider, ProviderResponse, RenderedPrompt } from '@/lib/exam-core/question-bank/production/generator/provider';

export const QB_R2D_SPEND_CAP_USD = 20 as const;

export interface PriceBasis { id: string; label: 'ASSUMED' | 'REPO_CONFIGURED'; source: string; inputPerMillionUsd: number; outputPerMillionUsd: number }
/** Deliberately high. An assumption, labelled as one. */
export const GUARD_PRICE_BASIS: PriceBasis = { id: 'qb-r2d-guard-price', label: 'ASSUMED', source: 'QB-R2D lane assumption, deliberately above the repository\'s configured price of its most expensive routed model; not a vendor quotation', inputPerMillionUsd: 5, outputPerMillionUsd: 30 };

export interface CallUsage { inputTokens: number; outputTokens: number; reasoningTokens: number | null; cachedInputTokens: number | null }
export const costOf = (usage: Pick<CallUsage, 'inputTokens' | 'outputTokens'>, price: PriceBasis): number => (usage.inputTokens / 1_000_000) * price.inputPerMillionUsd + (usage.outputTokens / 1_000_000) * price.outputPerMillionUsd;
/** An upper bound on the input tokens of a text: one token per two characters is far above what any tokenizer gives for prose or JSON. */
export const inputTokenUpperBound = (text: string): number => Math.ceil(text.length / 2);

export type CallOutcome = 'OK' | 'MALFORMED_RESPONSE' | 'TRANSPORT_ERROR' | 'REFUSED_BY_BUDGET';
export interface LedgerEntry {
  seq: number;
  at: string;
  unitKey: string;
  promptHash: string;
  /** 1 = the call; 2 = the one permitted retry after a transport failure or a malformed answer. */
  try: 1 | 2;
  provider: string;
  requestedModel: string;
  servedModel: string | null;
  responseId: string | null;
  maxOutputTokens: number;
  inputTokenUpperBound: number;
  worstCaseCostUsdGuardBasis: number;
  outcome: CallOutcome;
  detail: string | null;
  usage: CallUsage | null;
  usageSource: 'PROVIDER_USAGE_RESPONSE' | 'NOT_REPORTED_CHARGED_AT_WORST_CASE' | 'NO_CALL_MADE';
  costUsdGuardBasis: number;
  costUsdRepoBasis: number | null;
  spentAfterUsdGuardBasis: number;
}

export class BudgetExceededError extends Error {
  constructor(public readonly spentUsd: number, public readonly worstCaseUsd: number, public readonly capUsd: number) {
    super(`BUDGET_WOULD_BE_EXCEEDED: spent ${spentUsd.toFixed(6)} + worst case ${worstCaseUsd.toFixed(6)} > cap ${capUsd}`);
    this.name = 'BudgetExceededError';
  }
}

export class SpendLedger {
  readonly entries: LedgerEntry[];
  constructor(entries: readonly LedgerEntry[] = []) { this.entries = [...entries]; }
  spentUsdGuardBasis(): number { return this.entries.reduce((n, e) => n + e.costUsdGuardBasis, 0); }
  spentUsdRepoBasis(): number | null { return this.entries.some((e) => e.outcome !== 'REFUSED_BY_BUDGET' && e.costUsdRepoBasis === null) ? null : this.entries.reduce((n, e) => n + (e.costUsdRepoBasis ?? 0), 0); }
  calls(): number { return this.entries.filter((e) => e.outcome !== 'REFUSED_BY_BUDGET').length; }
  add(e: Omit<LedgerEntry, 'seq' | 'spentAfterUsdGuardBasis'>): LedgerEntry {
    const entry: LedgerEntry = { ...e, seq: this.entries.length + 1, spentAfterUsdGuardBasis: this.spentUsdGuardBasis() + e.costUsdGuardBasis };
    this.entries.push(entry);
    return entry;
  }
}

/** What actually talks to a model. The live one is in `live-provider.ts`; tests give a fake. */
export interface ModelTransport {
  readonly providerId: string;
  readonly model: string;
  complete(request: { system: string; user: string; maxOutputTokens: number }): Promise<{ rawText: string; usage: CallUsage | null; servedModel: string | null; responseId: string | null; finishReason: string | null }>;
}

export interface LiveRecording { promptHash: string; unitKey: string; try: 1 | 2; status: 'WELL_FORMED' | 'MALFORMED'; malformedCode: string | null; provider: string; requestedModel: string; servedModel: string | null; responseId: string | null; finishReason: string | null; recordedAt: string; usage: CallUsage | null; rawText: string }

export interface BudgetedProviderOptions {
  transport: ModelTransport;
  ledger: SpendLedger;
  capUsd: number;
  guardPrice: PriceBasis;
  repoPrice: PriceBasis | null;
  maxOutputTokens: number;
  /** The harness's own strict parse: null when the text is well-formed, the named error code otherwise. Decides the one retry. */
  malformedCodeOf: (rawText: string) => string | null;
  /** The unit a prompt belongs to, for the ledger. */
  unitKeyOf: (prompt: RenderedPrompt) => string;
  now: () => string;
  onRecording?: (r: LiveRecording) => void;
  onLedger?: (e: LedgerEntry) => void;
}

/** A GenerationProvider that spends: every call passes the budget guard first and is written to the ledger after. */
export class BudgetedLiveProvider implements GenerationProvider {
  readonly id: string;
  readonly model: string;
  constructor(private readonly o: BudgetedProviderOptions) {
    this.id = o.transport.providerId;
    this.model = o.transport.model;
  }

  /** Refuses, and writes the refusal to the ledger, when this call could take the spend past the cap. */
  private authorize(unitKey: string, promptHash: string, attempt: 1 | 2, upperBound: number): number {
    const worstCase = costOf({ inputTokens: upperBound, outputTokens: this.o.maxOutputTokens }, this.o.guardPrice);
    const spent = this.o.ledger.spentUsdGuardBasis();
    if (spent + worstCase > this.o.capUsd) {
      const refused = this.o.ledger.add({ at: this.o.now(), unitKey, promptHash, try: attempt, provider: this.id, requestedModel: this.model, servedModel: null, responseId: null, maxOutputTokens: this.o.maxOutputTokens, inputTokenUpperBound: upperBound, worstCaseCostUsdGuardBasis: worstCase, outcome: 'REFUSED_BY_BUDGET', detail: `spent ${spent} + worst case ${worstCase} > cap ${this.o.capUsd}`, usage: null, usageSource: 'NO_CALL_MADE', costUsdGuardBasis: 0, costUsdRepoBasis: 0 });
      this.o.onLedger?.(refused);
      throw new BudgetExceededError(spent, worstCase, this.o.capUsd);
    }
    return worstCase;
  }

  async generate(prompt: RenderedPrompt): Promise<ProviderResponse> {
    const p = prompt.prompt as { system: string; instruction: unknown };
    const user = JSON.stringify(p.instruction);
    const unitKey = this.o.unitKeyOf(prompt);
    const upperBound = inputTokenUpperBound(p.system + user);
    let last: { rawText: string } | null = null;
    let lastError: Error | null = null;
    for (const attempt of [1, 2] as const) {
      const worstCase = this.authorize(unitKey, prompt.promptHash, attempt, upperBound);
      const base = { at: this.o.now(), unitKey, promptHash: prompt.promptHash, try: attempt, provider: this.id, requestedModel: this.model, maxOutputTokens: this.o.maxOutputTokens, inputTokenUpperBound: upperBound, worstCaseCostUsdGuardBasis: worstCase };
      try {
        const r = await this.o.transport.complete({ system: p.system, user, maxOutputTokens: this.o.maxOutputTokens });
        const malformed = this.o.malformedCodeOf(r.rawText);
        const guardCost = r.usage ? costOf(r.usage, this.o.guardPrice) : worstCase;
        const entry = this.o.ledger.add({ ...base, servedModel: r.servedModel, responseId: r.responseId, outcome: malformed ? 'MALFORMED_RESPONSE' : 'OK', detail: malformed, usage: r.usage, usageSource: r.usage ? 'PROVIDER_USAGE_RESPONSE' : 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdGuardBasis: guardCost, costUsdRepoBasis: r.usage && this.o.repoPrice ? costOf(r.usage, this.o.repoPrice) : null });
        this.o.onLedger?.(entry);
        this.o.onRecording?.({ promptHash: prompt.promptHash, unitKey, try: attempt, status: malformed ? 'MALFORMED' : 'WELL_FORMED', malformedCode: malformed, provider: this.id, requestedModel: this.model, servedModel: r.servedModel, responseId: r.responseId, finishReason: r.finishReason, recordedAt: base.at, usage: r.usage, rawText: r.rawText });
        last = { rawText: r.rawText };
        lastError = null;
        if (!malformed) break;
      } catch (e) {
        if (e instanceof BudgetExceededError) throw e;
        // the request may have been billed: an unknown cost is charged at its worst case
        const failed = this.o.ledger.add({ ...base, servedModel: null, responseId: null, outcome: 'TRANSPORT_ERROR', detail: (e as Error).message.slice(0, 300), usage: null, usageSource: 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdGuardBasis: worstCase, costUsdRepoBasis: null });
        this.o.onLedger?.(failed);
        lastError = e as Error;
      }
    }
    if (last === null) throw lastError ?? new Error('LIVE_PROVIDER_GAVE_NO_ANSWER');
    // a malformed second answer is handed to the harness as it is: the harness refuses it by name, and that refusal is the result
    return { providerId: this.id, model: this.model, promptHash: prompt.promptHash, rawText: last.rawText };
  }
}
