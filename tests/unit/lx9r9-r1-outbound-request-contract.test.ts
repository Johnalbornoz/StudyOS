/**
 * LX-9R9 -- required tests 2, 3, 8: the ACTUAL outbound request
 * `callOpenAIChat` builds for Luna and Terra, using the real request
 * builder with only `fetch` mocked (same pattern as
 * lx9r7-provider-error-classification-contract.test.ts's test 7 --
 * kept in a separate file since this phase also needs a test that
 * proves NO fetch call happens for an unresolvable configuration,
 * which is easiest to isolate on its own).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LUNA, TERRA } from '@/lib/ai/model-routing';

function okJson(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
});

/* ================================================================= *
 * REQUIRED TEST 2 -- actual Luna request uses a supported             *
 * reasoning_effort.                                                   *
 * ================================================================= */

describe('LX-9R9 2 -- the real Luna quick_check-shaped request sends a supported reasoning_effort', () => {
  it("gpt-5.6-luna with question_generation_slot's budget sends reasoning_effort='none', never 'minimal'", async () => {
    const { callOpenAIChat } = await import('@/lib/ai/adapters/openai');
    const { budgetFor } = await import('@/lib/ai/token-budgets');
    (global.fetch as any).mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"questions":[]}' } }] }));
    const budget = budgetFor('question_generation_slot');

    await callOpenAIChat(
      {
        model: LUNA,
        messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'user' }],
        maxTokens: budget.maxOutputTokens,
        reasoningEffort: budget.reasoningEffort,
      },
      new AbortController().signal,
    );

    const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sent.model).toBe(LUNA);
    expect(sent.reasoning_effort).toBe('none');
    expect(sent.reasoning_effort).not.toBe('minimal');
  });
});

/* ================================================================= *
 * REQUIRED TEST 3 -- actual Terra fallback request uses a supported   *
 * reasoning_effort -- PART F, no primary/fallback divergence.         *
 * ================================================================= */

describe('LX-9R9 3 -- the real Terra fallback request (same budget) also sends a supported reasoning_effort', () => {
  it('gpt-5.6-terra with the SAME question_generation_slot budget sends the identical, valid reasoning_effort', async () => {
    const { callOpenAIChat } = await import('@/lib/ai/adapters/openai');
    const { budgetFor } = await import('@/lib/ai/token-budgets');
    (global.fetch as any).mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"questions":[]}' } }] }));
    const budget = budgetFor('question_generation_slot');

    await callOpenAIChat(
      {
        model: TERRA,
        messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'user' }],
        maxTokens: budget.maxOutputTokens,
        reasoningEffort: budget.reasoningEffort,
      },
      new AbortController().signal,
    );

    const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sent.model).toBe(TERRA);
    expect(sent.reasoning_effort).toBe('none');
  });
});

/* ================================================================= *
 * REQUIRED TEST 8 -- no provider call occurs for an unresolvable      *
 * model/effort mismatch.                                              *
 * ================================================================= */

describe('LX-9R9 8 -- an unresolvable reasoning_effort fails BEFORE any provider call', () => {
  it('a nonsense reasoning_effort throws CONFIGURATION_ERROR and fetch is never invoked', async () => {
    const { callOpenAIChat } = await import('@/lib/ai/adapters/openai');
    const { AIExecutionError } = await import('@/lib/ai/errors');

    await expect(
      callOpenAIChat(
        {
          model: LUNA,
          messages: [{ role: 'user', content: 'user' }],
          maxTokens: 100,
          reasoningEffort: 'ultra-deep-think' as any,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('an unregistered model with an explicit effort also fails locally, never reaches fetch', async () => {
    const { callOpenAIChat } = await import('@/lib/ai/adapters/openai');
    await expect(
      callOpenAIChat(
        {
          model: 'gpt-9000-hypothetical',
          messages: [{ role: 'user', content: 'user' }],
          maxTokens: 100,
          reasoningEffort: 'low',
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a NORMALIZED (safe) legacy value still reaches the provider -- only an UNRESOLVABLE one is blocked', async () => {
    const { callOpenAIChat } = await import('@/lib/ai/adapters/openai');
    (global.fetch as any).mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'ok' } }] }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await callOpenAIChat(
        { model: LUNA, messages: [{ role: 'user', content: 'user' }], maxTokens: 100, reasoningEffort: 'minimal' as any },
        new AbortController().signal,
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(sent.reasoning_effort).toBe('none');
      const compatLine = logSpy.mock.calls.find((c) => c[0] === '[ai-model-compat]');
      expect(compatLine).toBeTruthy();
      const payload = JSON.parse(compatLine![1] as string);
      expect(payload).toMatchObject({ model: LUNA, parameter: 'reasoning_effort', requestedValue: 'minimal', effectiveValue: 'none' });
    } finally {
      logSpy.mockRestore();
    }
  });
});
