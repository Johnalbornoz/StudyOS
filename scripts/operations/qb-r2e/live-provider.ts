/**
 * QB-R2E -- the LIVE transport (the only file of the lane that opens a network connection).
 *
 * Same provider, model and endpoint as QB-R2D -- the ones the repository routes for question generation -- and the
 * same bypass, stated again: this is a direct HTTPS call, so the repository's AI gateway and its database-backed
 * governance ledger see nothing of it. The lane's own ledger file is the record.
 *
 * NEW: STRICT SCHEMA MODE, requested the way the repository's own adapter requests it
 * (`src/lib/ai/adapters/openai.ts`): `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`.
 * The schema is the one the harness derives its parser from.
 *
 * An HTTP 4xx is a REJECTED REQUEST (authentication, model, parameters or schema), not a failed attempt: it is
 * raised as such so that the run can stop and be declared void.
 */
import type { CallUsage } from '../qb-r2d/budget';
import { R2E_REASONING_EFFORT, RequestRejectedError, type R2eTransport } from './budget';

const CHAT_COMPLETIONS_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const redact = (text: string): string => text.replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');

export interface R2eLiveTransportOptions { model: string; apiKey: string; jsonSchema: { name: string; schema: Record<string, unknown> }; timeoutMs?: number; fetchImpl?: typeof fetch }

/** The body of one request. Pure, so that a test can pin the request shape without a network. */
export function r2eRequestBody(o: Pick<R2eLiveTransportOptions, 'model' | 'jsonSchema'>, request: { system: string; user: string; maxOutputTokens: number }): Record<string, unknown> {
  return {
    model: o.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
    response_format: { type: 'json_schema', json_schema: { name: o.jsonSchema.name, strict: true, schema: o.jsonSchema.schema } },
    max_completion_tokens: request.maxOutputTokens, reasoning_effort: R2E_REASONING_EFFORT,
  };
}

export function createR2eLiveTransport(o: R2eLiveTransportOptions): R2eTransport {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    providerId: 'live:openai:chat-completions',
    model: o.model,
    async complete(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 180_000);
      try {
        const response = await doFetch(CHAT_COMPLETIONS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}` }, body: JSON.stringify(r2eRequestBody(o, request)), signal: controller.signal });
        if (!response.ok) {
          const body = redact(await response.text().catch(() => '')).slice(0, 240);
          if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new RequestRejectedError(response.status, body);
          throw new Error(`PROVIDER_HTTP_${response.status}: ${body}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await response.json();
        const choice = data?.choices?.[0];
        const u = data?.usage;
        const usage: CallUsage | null = u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
          ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, reasoningTokens: typeof u.completion_tokens_details?.reasoning_tokens === 'number' ? u.completion_tokens_details.reasoning_tokens : null, cachedInputTokens: typeof u.prompt_tokens_details?.cached_tokens === 'number' ? u.prompt_tokens_details.cached_tokens : null }
          : null;
        // a strict-schema refusal arrives as `message.refusal` with no content: it is recorded as an empty, malformed answer
        return { rawText: typeof choice?.message?.content === 'string' ? choice.message.content : '', usage, servedModel: typeof data?.model === 'string' ? data.model : null, responseId: typeof data?.id === 'string' ? data.id : null, finishReason: typeof choice?.message?.refusal === 'string' ? 'refusal' : typeof choice?.finish_reason === 'string' ? choice.finish_reason : null };
      } catch (e) {
        if (e instanceof RequestRejectedError) throw e;
        throw new Error(redact((e as Error).message));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
