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
import { requireLiveKey, configuredGeneration } from '../qb-r2d/live-provider';
import { costOf, type PriceBasis } from '../qb-r2d/budget';
import { GENERATOR_PRICE_BASIS, REVIEWER_PRICE_BASIS } from '../qb-canary-250/budget';
import { requireReviewerKey } from '../qb-canary-250/reviewer-transport';
import { REPLY_SCHEMAS, type ReplyKind } from '../../../src/lib/exam-core/question-bank/production/v5/prompts';
import { WORST_CASE_CALLS, type ModelCall, type ModelReply, type ModelRole } from './engine';

export const VALIDATION_MODEL = 'claude-sonnet-5-5' as const;
export const MAX_OUTPUT_TOKENS: Record<ModelRole, number> = { AUTHOR: 6000, SOLVER: 2500, JUDGE: 1500 };
/** ASSUMED prices, deliberately high (the bases the earlier lanes fixed). Spend figures are estimates on these. */
export const PRICE: Record<ModelRole, PriceBasis> = { AUTHOR: GENERATOR_PRICE_BASIS, SOLVER: REVIEWER_PRICE_BASIS, JUDGE: REVIEWER_PRICE_BASIS };
export const estimatedUsd = (role: ModelRole, usage: { inputTokens: number; outputTokens: number }): number => costOf(usage, PRICE[role]);
/** Worst case of one call: a prompt of `characters` and a full-length reply. */
export const worstCaseUsd = (role: ModelRole, characters: number): number => costOf({ inputTokens: Math.ceil(characters / 2), outputTokens: MAX_OUTPUT_TOKENS[role] }, PRICE[role]);

/**
 * The most one specification can cost: two authoring attempts and every validation call of both, each with a
 * full-length reply and an input that carries the longest item the author is allowed to write.
 */
export function specificationReserveUsd(authoringPromptCharacters: number): number {
  // an item is bounded by its schema (stimulus 12,000 characters, prompt 8,000), not by the author's reasoning allowance
  const validationCharacters = 3000 + 14000;
  return WORST_CASE_CALLS.AUTHOR * worstCaseUsd('AUTHOR', authoringPromptCharacters + 400) + WORST_CASE_CALLS.SOLVER * worstCaseUsd('SOLVER', validationCharacters) + WORST_CASE_CALLS.JUDGE * worstCaseUsd('JUDGE', validationCharacters);
}

const redact = (t: string): string => t.replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, '[REDACTED]').replace(/x-api-key\s*[:=]\s*\S+/gi, 'x-api-key: [REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');

async function anthropic(apiKey: string, system: string, user: string, maxTokens: number, kind: ReplyKind): Promise<ModelReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: VALIDATION_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], output_config: { effort: kind === 'SOLVER' ? 'medium' : 'low', format: { type: 'json_schema', schema: REPLY_SCHEMAS[kind] } } }), signal: controller.signal });
    if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}: ${redact(await response.text().catch(() => '')).slice(0, 240)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text)).join('');
    const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
    // a reply cut at the ceiling is a harness fault with a name, not a malformed judgement
    if (data?.stop_reason === 'max_tokens') throw new Error(`REPLY_TRUNCATED_AT_MAX_TOKENS (${kind}, ${n(data?.usage?.output_tokens)} tokens)`);
    if (!text.trim().startsWith('{')) throw new Error(`REPLY_NOT_JSON (${kind}, stop ${String(data?.stop_reason)}): ${redact(text).slice(0, 60)}`);
    return { text, inputTokens: n(data?.usage?.input_tokens) + n(data?.usage?.cache_creation_input_tokens) + n(data?.usage?.cache_read_input_tokens), outputTokens: n(data?.usage?.output_tokens) };
  } catch (e) { throw new Error(redact((e as Error).message)); } finally { clearTimeout(timer); }
}

/** Authoring effort. The earlier lanes used 'low'; the preflight of this run produced an untrue key at that setting. */
export const AUTHOR_REASONING_EFFORT = 'medium' as const;
async function openai(apiKey: string, model: string, system: string, user: string): Promise<ModelReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, max_completion_tokens: MAX_OUTPUT_TOKENS.AUTHOR, reasoning_effort: AUTHOR_REASONING_EFFORT }), signal: controller.signal });
    if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}: ${redact(await response.text().catch(() => '')).slice(0, 240)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('REPLY_TRUNCATED_AT_MAX_TOKENS (ITEM)');
    const n = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);
    // usage missing is charged at the ceiling: the estimate never errs low
    return { text: typeof choice?.message?.content === 'string' ? choice.message.content : '', inputTokens: n(data?.usage?.prompt_tokens, Math.ceil((system.length + user.length) / 2)), outputTokens: n(data?.usage?.completion_tokens, MAX_OUTPUT_TOKENS.AUTHOR) };
  } catch (e) { throw new Error(redact((e as Error).message)); } finally { clearTimeout(timer); }
}

export function liveModelCall(env: Record<string, string | undefined>): { call: ModelCall; authorModel: string; validationModel: string } {
  const authorModel = configuredGeneration().primaryModel;
  const authorKey = requireLiveKey(env);
  const validationKey = requireReviewerKey(env);
  const call: ModelCall = async (role, prompt, kind) => {
    if (role !== 'AUTHOR' && kind !== 'ITEM') return anthropic(validationKey, prompt.system, prompt.user, MAX_OUTPUT_TOKENS[role], kind);
    return openai(authorKey, authorModel, prompt.system, prompt.user);
  };
  return { call, authorModel, validationModel: VALIDATION_MODEL };
}
