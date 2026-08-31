import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAI, AIExecutionFailure, DEFAULT_AI_TIMEOUT_MS } from '@/lib/ai/gateway';

const baseOpts = {
  capability: 'OTHER' as const,
  risk: 'LOW_RISK' as const,
  provider: 'anthropic' as const,
  model: 'claude-sonnet-5',
  promptId: 'test.prompt',
  promptVersion: 'v1',
};

describe('executeAI', () => {
  it('generates a unique execution id per call', async () => {
    const a = await executeAI({ ...baseOpts, call: async () => 'x', validate: (raw) => ({ valid: true, value: raw }) });
    const b = await executeAI({ ...baseOpts, call: async () => 'x', validate: (raw) => ({ valid: true, value: raw }) });
    expect(a.execution.executionId).not.toBe(b.execution.executionId);
    expect(a.execution.executionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('populates execution metadata (capability/provider/model/promptId/promptVersion/timing/status)', async () => {
    const { execution } = await executeAI({ ...baseOpts, call: async () => 'x', validate: (raw) => ({ valid: true, value: raw }) });
    expect(execution.capability).toBe('OTHER');
    expect(execution.risk).toBe('LOW_RISK');
    expect(execution.provider).toBe('anthropic');
    expect(execution.model).toBe('claude-sonnet-5');
    expect(execution.promptId).toBe('test.prompt');
    expect(execution.promptVersion).toBe('v1');
    expect(execution.success).toBe(true);
    expect(execution.validationStatus).toBe('PASSED');
    expect(execution.fallbackUsed).toBe(false);
    expect(typeof execution.durationMs).toBe('number');
    expect(execution.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(execution.startedAt).toString()).not.toBe('Invalid Date');
  });

  it('returns provenance matching the execution', async () => {
    const { execution, provenance } = await executeAI({ ...baseOpts, call: async () => 'x', validate: (raw) => ({ valid: true, value: raw }) });
    expect(provenance).toEqual({
      aiExecutionId: execution.executionId,
      aiProvider: 'anthropic',
      aiModel: 'claude-sonnet-5',
      aiPromptId: 'test.prompt',
      aiPromptVersion: 'v1',
    });
  });

  it('never returns an unvalidated raw value -- validate always runs before result is produced', async () => {
    const validate = vi.fn((raw: string) => ({ valid: true, value: raw.toUpperCase() }));
    const { result } = await executeAI({ ...baseOpts, call: async () => 'raw-text', validate });
    expect(validate).toHaveBeenCalledWith('raw-text');
    expect(result).toBe('RAW-TEXT'); // only the validated/transformed value is ever returned
  });

  it('rejects an invalid structured response instead of passing it through', async () => {
    await expect(
      executeAI({ ...baseOpts, call: async () => ({ bogus: true }), validate: () => ({ valid: false, errors: ['missing required field'] }) })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('normalizes a thrown provider error to PROVIDER_ERROR', async () => {
    await expect(
      executeAI({
        ...baseOpts,
        call: async () => {
          throw new Error('ECONNRESET');
        },
        validate: (raw) => ({ valid: true, value: raw }),
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', message: expect.stringContaining('ECONNRESET') });
  });

  it('normalizes a validator exception (e.g. JSON.parse throwing) to INVALID_RESPONSE', async () => {
    await expect(
      executeAI({
        ...baseOpts,
        call: async () => 'not json',
        validate: (raw) => {
          JSON.parse(raw as string); // throws
          return { valid: true, value: raw };
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('times out a call that never resolves, with a bounded (non-default) timeout', async () => {
    const call = (signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const start = Date.now();
    await expect(executeAI({ ...baseOpts, timeoutMs: 50, call, validate: (raw) => ({ valid: true, value: raw }) })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(Date.now() - start).toBeLessThan(DEFAULT_AI_TIMEOUT_MS); // proves the short timeoutMs was honored, not the 30s default
  });

  it('throws AIExecutionFailure carrying the recorded execution metadata when no fallback is configured', async () => {
    try {
      await executeAI({
        ...baseOpts,
        call: async () => {
          throw new Error('boom');
        },
        validate: (raw) => ({ valid: true, value: raw }),
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AIExecutionFailure);
      const failure = err as AIExecutionFailure;
      expect(failure.execution.success).toBe(false);
      expect(failure.execution.fallbackUsed).toBe(false);
      expect(failure.execution.errorCode).toBe('PROVIDER_ERROR');
    }
  });

  it('resolves to the fallback value (not a throw) when fallback is configured, and marks fallbackUsed', async () => {
    const { result, execution } = await executeAI({
      ...baseOpts,
      call: async () => {
        throw new Error('boom');
      },
      validate: (raw) => ({ valid: true, value: raw }),
      fallback: (err) => `fallback-for-${err.code}`,
    });
    expect(result).toBe('fallback-for-PROVIDER_ERROR');
    expect(execution.success).toBe(false);
    expect(execution.fallbackUsed).toBe(true);
    expect(execution.errorCode).toBe('PROVIDER_ERROR');
  });

  it('a validation failure with fallback configured also resolves via fallback', async () => {
    const { result, execution } = await executeAI({
      ...baseOpts,
      call: async () => 'x',
      validate: () => ({ valid: false, errors: ['bad shape'] }),
      fallback: () => 'safe-default',
    });
    expect(result).toBe('safe-default');
    expect(execution.fallbackUsed).toBe(true);
    expect(execution.validationStatus).toBe('FAILED');
  });

  it('logs structured execution metadata without ever including raw prompt/response content or credentials', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await executeAI({
        ...baseOpts,
        call: async () => 'THE SECRET STUDENT ANSWER TEXT sk-ANTHROPIC-FAKE-KEY-1234',
        validate: (raw) => ({ valid: true, value: (raw as string).length }),
      });
      expect(logSpy).toHaveBeenCalled();
      const loggedArgs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(loggedArgs).not.toContain('THE SECRET STUDENT ANSWER TEXT');
      expect(loggedArgs).not.toContain('sk-ANTHROPIC-FAKE-KEY-1234');
      expect(loggedArgs).toContain('"executionId"');
      expect(loggedArgs).toContain('"capability"');
    } finally {
      logSpy.mockRestore();
    }
  });
});
