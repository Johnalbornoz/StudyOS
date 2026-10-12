/**
 * Question Factory V5 -- the ONLY file of this lane that opens a network connection or reads a key.
 *
 * Authoring and validation use different providers on purpose: the solver and the judges must not share the
 * author's blind spots. Keys are read from OPENAI_API_KEY and ANTHROPIC_API_KEY only, never logged or stored;
 * provider error text is redacted. The repository's AI gateway is bypassed (it writes to a database): the run's
 * own spend ledger is the record.
 *
 * Nothing here runs unless run.ts was given an authorised budget.
 */
import { createLiveTransport, requireLiveKey, configuredGeneration } from '../qb-r2d/live-provider';
import { costOf, type PriceBasis } from '../qb-r2d/budget';
import { GENERATOR_PRICE_BASIS, REVIEWER_PRICE_BASIS } from '../qb-canary-250/budget';
import { requireReviewerKey } from '../qb-canary-250/reviewer-transport';
import type { ModelCall, ModelReply, ModelRole } from './engine';

export const VALIDATION_MODEL = 'claude-sonnet-5-5' as const;
export const MAX_OUTPUT_TOKENS: Record<ModelRole, number> = { AUTHOR: 3500, SOLVER: 1500, JUDGE: 600 };
/** ASSUMED prices, deliberately high (the bases the earlier lanes fixed). Spend figures are estimates on these. */
export const PRICE: Record<ModelRole, PriceBasis> = { AUTHOR: GENERATOR_PRICE_BASIS, SOLVER: REVIEWER_PRICE_BASIS, JUDGE: REVIEWER_PRICE_BASIS };
export const estimatedUsd = (role: ModelRole, usage: { inputTokens: number; outputTokens: number }): number => costOf(usage, PRICE[role]);
/** Worst case of one call: a prompt of `characters` and a full-length reply. */
export const worstCaseUsd = (role: ModelRole, characters: number): number => costOf({ inputTokens: Math.ceil(characters / 2), outputTokens: MAX_OUTPUT_TOKENS[role] }, PRICE[role]);

const redact = (t: string): string => t.replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, '[REDACTED]').replace(/x-api-key\s*[:=]\s*\S+/gi, 'x-api-key: [REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');

async function anthropic(apiKey: string, system: string, user: string, maxTokens: number): Promise<ModelReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: VALIDATION_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }), signal: controller.signal });
    if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}: ${redact(await response.text().catch(() => '')).slice(0, 240)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text)).join('');
    const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
    return { text, inputTokens: n(data?.usage?.input_tokens) + n(data?.usage?.cache_creation_input_tokens) + n(data?.usage?.cache_read_input_tokens), outputTokens: n(data?.usage?.output_tokens) };
  } catch (e) { throw new Error(redact((e as Error).message)); } finally { clearTimeout(timer); }
}

export function liveModelCall(env: Record<string, string | undefined>): { call: ModelCall; authorModel: string; validationModel: string } {
  const authorModel = configuredGeneration().primaryModel;
  const author = createLiveTransport({ model: authorModel, apiKey: requireLiveKey(env) });
  const validationKey = requireReviewerKey(env);
  const call: ModelCall = async (role, prompt) => {
    if (role !== 'AUTHOR') return anthropic(validationKey, prompt.system, prompt.user, MAX_OUTPUT_TOKENS[role]);
    const r = await author.complete({ system: prompt.system, user: prompt.user, maxOutputTokens: MAX_OUTPUT_TOKENS.AUTHOR });
    return { text: r.rawText, inputTokens: r.usage?.inputTokens ?? Math.ceil((prompt.system.length + prompt.user.length) / 2), outputTokens: r.usage?.outputTokens ?? MAX_OUTPUT_TOKENS.AUTHOR };
  };
  return { call, authorModel, validationModel: VALIDATION_MODEL };
}
