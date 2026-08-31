import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';
import { callOpenAIChat, callOpenAIEmbedding } from '@/lib/ai/adapters/openai';
import { AIExecutionError } from '@/lib/ai/errors';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('callAnthropicMessages', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  });
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends the exact request shape (model/max_tokens/system/messages, x-api-key + anthropic-version headers)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'hello' }] }));
    global.fetch = fetchMock as any;

    await callAnthropicMessages(
      { model: 'claude-sonnet-5', maxTokens: 123, system: 'sys', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('test-anthropic-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ model: 'claude-sonnet-5', max_tokens: 123, system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('extracts the text content block', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ content: [{ type: 'tool_use' }, { type: 'text', text: 'the answer' }] })
    ) as any;
    const result = await callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 10, messages: [] }, new AbortController().signal);
    expect(result.text).toBe('the answer');
  });

  it('throws CONFIGURATION_ERROR when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = vi.fn() as any;
    await expect(callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 10, messages: [] }, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps a 429 response to RATE_LIMIT', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'slow down' }, false, 429)) as any;
    await expect(callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 10, messages: [] }, new AbortController().signal)).rejects.toMatchObject({
      code: 'RATE_LIMIT',
    });
  });

  it('maps a 401 response to CONFIGURATION_ERROR', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad key' }, false, 401)) as any;
    await expect(callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 10, messages: [] }, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });
  });

  it('maps a generic 500 response to PROVIDER_ERROR', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'oops' }, false, 500)) as any;
    await expect(callAnthropicMessages({ model: 'claude-sonnet-5', maxTokens: 10, messages: [] }, new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });
});

describe('callOpenAIChat / callOpenAIEmbedding', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });
  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends Bearer auth and the response_format flag when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));
    global.fetch = fetchMock as any;

    await callOpenAIChat({ model: 'gpt-5.6', responseFormatJson: true, messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers['Authorization']).toBe('Bearer test-openai-key');
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('extracts choices[0].message.content', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'reply text' } }] })) as any;
    const result = await callOpenAIChat({ model: 'gpt-5.6', messages: [] }, new AbortController().signal);
    expect(result.text).toBe('reply text');
  });

  it('throws CONFIGURATION_ERROR when OPENAI_API_KEY is unset', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(callOpenAIChat({ model: 'gpt-5.6', messages: [] }, new AbortController().signal)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    await expect(callOpenAIEmbedding({ model: 'text-embedding-3-small', input: 'x' }, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });
  });

  it('extracts the embedding vector', async () => {
    const vector = [0.1, 0.2, 0.3];
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: vector }] })) as any;
    const result = await callOpenAIEmbedding({ model: 'text-embedding-3-small', input: 'x' }, new AbortController().signal);
    expect(result.embedding).toEqual(vector);
  });

  it('throws INVALID_RESPONSE when the embedding field is missing/malformed', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{}] })) as any;
    await expect(callOpenAIEmbedding({ model: 'text-embedding-3-small', input: 'x' }, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
