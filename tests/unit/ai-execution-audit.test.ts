/**
 * Phase 0E2 Step 9/10/26: the AI execution audit sink and its
 * integration into executeAI(). Verifies the persistence boundary
 * (AIExecutionAuditSink), the documented failure policy (a failed
 * audit write never breaks the primary AI/domain operation), and that
 * every live execution produces exactly one attempted audit write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeAI } from '@/lib/ai/gateway';
import {
  postgresAIExecutionAuditSink,
  setAIExecutionAuditSink,
  getAIExecutionAuditSink,
  noopAIExecutionAuditSink,
  type AIExecutionAuditEntry,
} from '@/lib/ai/audit';

const baseOpts = {
  capability: 'OTHER' as const,
  risk: 'LOW_RISK' as const,
  provider: 'anthropic' as const,
  model: 'claude-sonnet-5',
  promptId: 'test.prompt',
  promptVersion: 'v1',
};

const originalSink = getAIExecutionAuditSink();
afterEach(() => {
  setAIExecutionAuditSink(originalSink);
  vi.restoreAllMocks();
});

describe('AIExecutionAuditSink wiring', () => {
  it('the default sink in a test environment is the no-op sink (never touches the database)', () => {
    // This session's default was installed at module-load time based on
    // process.env.VITEST -- confirm it resolved to the no-op sink here.
    expect(getAIExecutionAuditSink()).toBe(noopAIExecutionAuditSink);
  });

  it('setAIExecutionAuditSink swaps the active sink, and every executeAI() call routes through it', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    setAIExecutionAuditSink({ record });

    await executeAI({ ...baseOpts, context: { studentId: 's1', conceptId: 'c1' }, call: async () => 'x', validate: (raw) => ({ valid: true, value: raw }) });

    expect(record).toHaveBeenCalledTimes(1);
    const entry: AIExecutionAuditEntry = record.mock.calls[0][0];
    expect(entry.execution.capability).toBe('OTHER');
    expect(entry.execution.success).toBe(true);
    expect(entry.context).toEqual({ studentId: 's1', conceptId: 'c1' });
  });

  it('AI success + audit persistence failure: executeAI() still resolves successfully with the real result (Step 10 failure policy)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Even a sink that violates its own "never throws" contract (see
    // src/lib/ai/audit.ts) must not be able to reach into executeAI()
    // and break the primary result -- the gateway's own try/catch
    // around the sink call (defense in depth) guarantees this.
    setAIExecutionAuditSink({
      record: vi.fn().mockRejectedValue(new Error('audit db unreachable')),
    });

    const outcome = await executeAI({ ...baseOpts, call: async () => 'real-result', validate: (raw) => ({ valid: true, value: raw }) });
    expect(outcome.result).toBe('real-result');
    expect(outcome.execution.success).toBe(true);
    expect(errorSpy).toHaveBeenCalled(); // the failure is observable, never silent
    errorSpy.mockRestore();
  });

  it('documented contract: postgresAIExecutionAuditSink itself never throws, even when db.query rejects', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: vi.fn().mockRejectedValue(new Error('connection refused')) } }));
    vi.resetModules();
    const { postgresAIExecutionAuditSink: sinkUnderTest } = await import('@/lib/ai/audit');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      sinkUnderTest.record({
        execution: {
          executionId: 'exec-1',
          capability: 'OTHER',
          risk: 'LOW_RISK',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          promptId: 'test.prompt',
          promptVersion: 'v1',
          startedAt: new Date().toISOString(),
          durationMs: 10,
          success: true,
          validationStatus: 'PASSED',
          fallbackUsed: false,
        },
      })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    vi.doUnmock('@/lib/db');
    vi.resetModules();
  });

  it('AI success + audit persistence success (via the real sink, mocked db): a row insert is attempted with the right shape', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    vi.resetModules();
    const { postgresAIExecutionAuditSink: sinkUnderTest } = await import('@/lib/ai/audit');

    await sinkUnderTest.record({
      execution: {
        executionId: 'exec-2',
        capability: 'GRADING',
        risk: 'HIGH_RISK',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        promptId: 'quiz.free_text_grading',
        promptVersion: 'v1',
        startedAt: new Date().toISOString(),
        durationMs: 123,
        success: true,
        validationStatus: 'PASSED',
        fallbackUsed: false,
      },
      context: { studentId: 'student-1', conceptId: 'concept-1', sourceComponent: 'quiz-generation.service.ts:gradeAnswer' },
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO ai_execution_events');
    expect(params).toEqual([
      'exec-2',
      'GRADING',
      'HIGH_RISK',
      'anthropic',
      'claude-sonnet-5',
      'quiz.free_text_grading',
      'v1',
      'SUCCESS',
      'PASSED',
      false,
      null,
      123,
      'student-1',
      null,
      'concept-1',
      'quiz-generation.service.ts:gradeAnswer',
      null,
      null,
    ]);
    vi.doUnmock('@/lib/db');
    vi.resetModules();
  });

  it('AI timeout + audit persistence success: the timeout still resolves through the gateway to a thrown AIExecutionFailure, and the sink still receives the failed execution', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    setAIExecutionAuditSink({ record });
    const call = (signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });

    await expect(executeAI({ ...baseOpts, timeoutMs: 30, call, validate: (raw) => ({ valid: true, value: raw }) })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].execution.errorCode).toBe('TIMEOUT');
    expect(record.mock.calls[0][0].execution.success).toBe(false);
  });
});
