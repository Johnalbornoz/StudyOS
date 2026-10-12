/**
 * QUESTION FACTORY CANARY 250 -- the LIVE transport of the AI reviewer (the only file of the canary, with the
 * generator's transport of QB-R2E, that opens a network connection).
 *
 * A direct HTTPS call to the reviewer's provider: the repository's AI gateway and its database-backed governance
 * ledger see nothing of it. The canary's run log is the record. The key is read by the run script from
 * ANTHROPIC_API_KEY only and is never logged, stored or echoed: provider error text is redacted before it is kept.
 *
 * Strict structured output is requested with `output_config.format` (a JSON schema); the harness parses the answer
 * strictly whatever the provider did. An HTTP 4xx (other than 408 / 429) is a REJECTED REQUEST.
 */
import type { CallUsage } from '../qb-r2d/budget';
import { RequestRejectedError, type R2eTransport } from '../qb-r2e/budget';
import { REVIEW_PROVIDER_JSON_SCHEMA, REVIEWER_RUN_PARAMETERS } from './reviewer';

const MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const REVIEWER_KEY_ENVIRONMENT_VARIABLE = 'ANTHROPIC_API_KEY' as const;
const redact = (text: string): string => text.replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, '[REDACTED]').replace(/x-api-key\s*[:=]\s*\S+/gi, 'x-api-key: [REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');

/** The body of one request. Pure, so that a test can pin the request shape without a network. */
export function reviewerRequestBody(request: { system: string; user: string; maxOutputTokens: number }): Record<string, unknown> {
  return {
    model: REVIEWER_RUN_PARAMETERS.model, max_tokens: request.maxOutputTokens, system: request.system, messages: [{ role: 'user', content: request.user }],
    thinking: REVIEWER_RUN_PARAMETERS.thinking, output_config: { effort: REVIEWER_RUN_PARAMETERS.effort, format: { type: 'json_schema', schema: REVIEW_PROVIDER_JSON_SCHEMA } },
  };
}
/** The key from the environment, or a named block. The value is returned to the caller and to no one else. */
export function requireReviewerKey(env: Record<string, string | undefined> = process.env): string {
  const key = env[REVIEWER_KEY_ENVIRONMENT_VARIABLE];
  if (!key || key.trim().length < 20) throw new Error(`LIVE_REVIEWER_BLOCKED: environment variable ${REVIEWER_KEY_ENVIRONMENT_VARIABLE} is not set (pass ONLY that variable into the process; never load a whole env file)`);
  return key.trim();
}
export function createReviewerLiveTransport(o: { apiKey: string; timeoutMs?: number; fetchImpl?: typeof fetch }): R2eTransport {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    providerId: 'live:anthropic:messages',
    model: REVIEWER_RUN_PARAMETERS.model,
    async complete(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 180_000);
      try {
        const response = await doFetch(MESSAGES_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': REVIEWER_RUN_PARAMETERS.apiVersion }, body: JSON.stringify(reviewerRequestBody(request)), signal: controller.signal });
        if (!response.ok) {
          const body = redact(await response.text().catch(() => '')).slice(0, 240);
          if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new RequestRejectedError(response.status, body);
          throw new Error(`PROVIDER_HTTP_${response.status}: ${body}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await response.json();
        const blocks: unknown[] = Array.isArray(data?.content) ? data.content : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawText = blocks.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text as string).join('');
        const u = data?.usage;
        const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
        // cache reads and writes are counted as input at the full assumed price: the assumption never errs low
        const usage: CallUsage | null = u && typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number' ? { inputTokens: u.input_tokens + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), outputTokens: u.output_tokens, reasoningTokens: null, cachedInputTokens: n(u.cache_read_input_tokens) } : null;
        return { rawText, usage, servedModel: typeof data?.model === 'string' ? data.model : null, responseId: typeof data?.id === 'string' ? data.id : null, finishReason: typeof data?.stop_reason === 'string' ? data.stop_reason : null };
      } catch (e) {
        if (e instanceof RequestRejectedError) throw e;
        throw new Error(redact((e as Error).message));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
