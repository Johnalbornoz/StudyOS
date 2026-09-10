/**
 * LX-4P-PERF-R1C C3 -- OpenAI Chat Completions adapter contract.
 *
 * Fixture-level tests (no real network): a normal structured response,
 * a strict-schema refusal, a malformed body, provider usage fields
 * (fresh / cached / missing), and the unconfigured-key error. These
 * pin the adapter's INTERNAL contract -- the shape the rest of the
 * runtime relies on -- without asserting anything about live Luna/Terra
 * behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callOpenAIChat } from '@/lib/ai/adapters/openai';
import { callModel } from '@/lib/ai/adapters/call-model';
import { parseProviderUsage } from '@/lib/ai/usage';
import { AIExecutionError } from '@/lib/ai/errors';

const ac = () => new AbortController().signal;

function okJson(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('LX-4P-PERF-R1C C3 -- callOpenAIChat: normal structured response', () => {
  it('returns { text, raw } with the choice content as text', async () => {
    const body = {
      choices: [{ message: { content: '{"questions":[]}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    };
    (global.fetch as any).mockResolvedValueOnce(okJson(body));

    const res = await callOpenAIChat(
      { model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'hi' }], jsonSchema: { name: 'x', schema: { type: 'object' } } },
      ac(),
    );
    expect(res.text).toBe('{"questions":[]}');
    expect(res.raw).toBe(body);
  });

  it('sends strict json_schema + max_completion_tokens + reasoning_effort + prompt_cache_key when asked', async () => {
    (global.fetch as any).mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{}' } }] }));
    await callOpenAIChat(
      {
        model: 'gpt-5.6-luna',
        messages: [{ role: 'user', content: 'hi' }],
        jsonSchema: { name: 'batch', schema: { type: 'object' } },
        maxTokens: 4200,
        reasoningEffort: 'low',
        promptCacheKey: 'quiz.qgen.v3',
      },
      ac(),
    );
    const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sent.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'batch', strict: true, schema: { type: 'object' } } });
    expect(sent.max_completion_tokens).toBe(4200);
    expect(sent.reasoning_effort).toBe('low');
    expect(sent.prompt_cache_key).toBe('quiz.qgen.v3');
  });
});

describe('LX-4P-PERF-R1C C3 -- callOpenAIChat: failure surfaces', () => {
  it('a strict-schema refusal becomes INVALID_RESPONSE, never silent empty text', async () => {
    (global.fetch as any).mockResolvedValueOnce(okJson({ choices: [{ message: { refusal: 'I cannot comply' } }] }));
    await expect(
      callOpenAIChat({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'x' }] }, ac()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('a malformed body (no choices) yields empty text -- the gate/parse layer rejects it downstream', async () => {
    (global.fetch as any).mockResolvedValueOnce(okJson({ not: 'a chat completion' }));
    const res = await callOpenAIChat({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'x' }] }, ac());
    expect(res.text).toBe('');
  });

  it('a non-2xx response throws an AIExecutionError (provider HTTP error)', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'upstream boom' });
    await expect(
      callOpenAIChat({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'x' }] }, ac()),
    ).rejects.toBeInstanceOf(AIExecutionError);
  });

  it('missing OPENAI_API_KEY throws CONFIGURATION_ERROR synchronously -- never a silent fallthrough', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(
      callOpenAIChat({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'x' }] }, ac()),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});

describe('LX-4P-PERF-R1C C3 -- provider usage parsing (provider-neutral telemetry)', () => {
  it('fresh + cached + completion tokens', () => {
    const u = parseProviderUsage('openai', {
      usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens: 250 },
    });
    expect(u).toEqual({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 250 });
  });

  it('no prompt_tokens_details -> cachedInputTokens null, never 0-guessed', () => {
    const u = parseProviderUsage('openai', { usage: { prompt_tokens: 500, completion_tokens: 90 } });
    expect(u.inputTokens).toBe(500);
    expect(u.cachedInputTokens).toBeNull();
    expect(u.outputTokens).toBe(90);
  });

  it('missing usage entirely -> all null', () => {
    const u = parseProviderUsage('openai', { choices: [] });
    expect(u).toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null });
  });
});

describe('LX-4P-PERF-R1C C3 -- callModel dispatch returns a provider-neutral envelope', () => {
  it('OpenAI route: { text, raw, provider, model } with provider === "openai"', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      okJson({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
    );
    const res = await callModel(
      { provider: 'openai', model: 'gpt-5.6-luna', user: 'hello', maxTokens: 100 },
      ac(),
    );
    expect(res).toMatchObject({ text: 'ok', provider: 'openai', model: 'gpt-5.6-luna' });
    expect(res.raw).toBeDefined();
  });
});
