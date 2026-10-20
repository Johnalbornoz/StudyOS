/**
 * QB-R2D -- the LIVE model transport (the only file of the lane that opens a network connection).
 *
 * WHAT IT IS. A direct HTTPS call to the provider and model the repository configures for question generation
 * (`src/lib/ai/model-routing.ts`: QUESTION_GENERATION -> the routed primary, with the routed fallback), made with
 * the API key alone.
 *
 * WHAT IT BYPASSES, STATED PLAINLY. The repository's AI gateway (`src/lib/ai/gateway.ts`) records every call in a
 * governance ledger in a DATABASE, and this lane may not touch any database. So this transport does NOT go through
 * the gateway: no governance row, no audit row, no gateway budget is written for these calls. The lane keeps its
 * own complete spend ledger file instead (`spend-ledger.json`). Nothing in `src/` imports this file, and this file
 * imports no database module and no gateway module -- only two pure constants files (routing and price table).
 *
 * THE KEY is read from the process environment, sent in the Authorization header, and nothing else: it is never
 * printed, logged, written to an artifact or put in an error message (provider error bodies are redacted).
 */
import { resolveModels } from '@/lib/ai/model-routing';
import { MODEL_PRICING } from '@/lib/ai/pricing';
import type { CallUsage, ModelTransport, PriceBasis } from './budget';

const CHAT_COMPLETIONS_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const LIVE_KEY_ENVIRONMENT_VARIABLE = 'OPENAI_API_KEY' as const;
/** As the repository's own Question Bank runner calls it for generation: its routed capability and its 'low' practice-generation effort. */
export const LIVE_REASONING_EFFORT = 'low' as const;
export const LIVE_MAX_OUTPUT_TOKENS = 6000 as const;

export interface ConfiguredGeneration { capability: 'QUESTION_GENERATION'; provider: string; primaryModel: string; fallbackModel: string; configuredIn: string }
/** The provider and model the repository configures for question generation. Read, never restated. */
export function configuredGeneration(): ConfiguredGeneration {
  const route = resolveModels('QUESTION_GENERATION');
  return { capability: 'QUESTION_GENERATION', provider: route.provider, primaryModel: route.primary, fallbackModel: route.fallback, configuredIn: 'src/lib/ai/model-routing.ts (CAPABILITY_ROUTING.QUESTION_GENERATION), used by src/lib/exam-core/question-bank/ai-runner.ts' };
}

/** The repository's configured reference price of a model, or null when it configures none. The repository labels this table "NOT vendor billing truth". */
export function repoConfiguredPrice(model: string): PriceBasis | null {
  const p = MODEL_PRICING[model];
  if (!p || (p.inputPerM === 0 && p.outputPerM === 0)) return null;
  return { id: `repo-configured:${model}`, label: 'REPO_CONFIGURED', source: 'src/lib/ai/pricing.ts MODEL_PRICING (configured reference prices; the file states they are not billing-system truth)', inputPerMillionUsd: p.inputPerM, outputPerMillionUsd: p.outputPerM };
}

const redact = (text: string): string => text.replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');

export class LiveProviderBlockedError extends Error {
  constructor(public readonly missing: string) {
    super(`LIVE_PROVIDER_BLOCKED: ${missing}`);
    this.name = 'LiveProviderBlockedError';
  }
}

export interface LiveTransportOptions { model: string; apiKey: string; timeoutMs?: number; fetchImpl?: typeof fetch }

/** One chat completion per call. JSON object mode; the harness, not the provider, enforces the strict response schema. */
export function createLiveTransport(o: LiveTransportOptions): ModelTransport {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    providerId: 'live:openai:chat-completions',
    model: o.model,
    async complete(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 180_000);
      try {
        const response = await doFetch(CHAT_COMPLETIONS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}` },
          body: JSON.stringify({ model: o.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }], response_format: { type: 'json_object' }, max_completion_tokens: request.maxOutputTokens, reasoning_effort: LIVE_REASONING_EFFORT }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`PROVIDER_HTTP_${response.status}: ${redact(body).slice(0, 240)}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await response.json();
        const choice = data?.choices?.[0];
        const u = data?.usage;
        const usage: CallUsage | null = u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
          ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, reasoningTokens: typeof u.completion_tokens_details?.reasoning_tokens === 'number' ? u.completion_tokens_details.reasoning_tokens : null, cachedInputTokens: typeof u.prompt_tokens_details?.cached_tokens === 'number' ? u.prompt_tokens_details.cached_tokens : null }
          : null;
        return { rawText: typeof choice?.message?.content === 'string' ? choice.message.content : '', usage, servedModel: typeof data?.model === 'string' ? data.model : null, responseId: typeof data?.id === 'string' ? data.id : null, finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null };
      } catch (e) {
        throw new Error(redact((e as Error).message));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** The key from the environment, or a named block saying exactly what is missing. The value is returned to the caller and to no one else. */
export function requireLiveKey(env: Record<string, string | undefined> = process.env): string {
  const key = env[LIVE_KEY_ENVIRONMENT_VARIABLE];
  if (!key || key.trim().length < 20) throw new LiveProviderBlockedError(`environment variable ${LIVE_KEY_ENVIRONMENT_VARIABLE} is not set (pass ONLY that variable into the process; never load a whole env file)`);
  return key.trim();
}
