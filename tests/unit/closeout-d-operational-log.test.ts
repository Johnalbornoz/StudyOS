/**
 * STUDYUS PHASE 6 -- CLOSEOUT D1 (operational logger).
 *
 * Proves the structured operational logger is safe to point at
 * production platform logs: allowlisted context only, no studentId, no
 * PII, secrets scrubbed, runtime SHA/env attached, one call == one
 * line, never throws, no stack in the payload.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logOperationalError, logOperationalWarning } from '@/lib/observability/operational-log';

const ENV_KEYS = ['VERCEL_GIT_COMMIT_SHA', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_AUTHOR_DATE'] as const;
const savedEnv: Record<string, string | undefined> = {};

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.VERCEL_GIT_COMMIT_SHA = 'deadbeefcafe1234deadbeefcafe1234deadbeef';
  process.env.VERCEL_ENV = 'production';
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

/** Extract the JSON object from a `console.error/warn('[ops]', '<json>')` call. */
function parseLine(spy: ReturnType<typeof vi.spyOn>, callIndex = 0): any {
  const call = spy.mock.calls[callIndex];
  expect(call, 'expected a logger call').toBeTruthy();
  expect(call[0]).toBe('[ops]');
  return JSON.parse(call[1] as string);
}

describe('Closeout D1 -- log shape & channel', () => {
  it('A. ERROR goes to console.error with the [ops] tag', () => {
    logOperationalError({ subsystem: 'phase6-memory', operation: 'getPhase2MemoryInput', error: new Error('x') });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    const line = parseLine(errSpy);
    expect(line.at).toBe('operational_error');
    expect(line.severity).toBe('ERROR');
    expect(line.subsystem).toBe('phase6-memory');
    expect(line.operation).toBe('getPhase2MemoryInput');
  });

  it('B. WARN goes to console.warn with the [ops] tag', () => {
    logOperationalWarning({ subsystem: 'phase4-orchestrator', operation: 'loadLearningSignals' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
    const line = parseLine(warnSpy);
    expect(line.at).toBe('operational_warning');
    expect(line.severity).toBe('WARN');
  });

  it('C. the payload after [ops] is valid JSON', () => {
    logOperationalWarning({ subsystem: 's', operation: 'o', error: new Error('boom') });
    expect(() => JSON.parse(warnSpy.mock.calls[0][1] as string)).not.toThrow();
  });

  it('D. runtime commitSha + environment are attached from the deployment-version source', () => {
    logOperationalError({ subsystem: 's', operation: 'o', error: new Error('e') });
    const line = parseLine(errSpy);
    expect(line.commitSha).toBe('deadbeefcafe1234deadbeefcafe1234deadbeef');
    expect(line.environment).toBe('production');
  });

  it('L. one invocation == exactly one line', () => {
    logOperationalWarning({ subsystem: 's', operation: 'o', error: new Error('e'), context: { failedSource: 'x' } });
    expect(warnSpy.mock.calls.length + errSpy.mock.calls.length).toBe(1);
  });
});

describe('Closeout D1 -- context allowlist', () => {
  it('E. unknown context keys are dropped', () => {
    logOperationalWarning({
      subsystem: 's',
      operation: 'o',
      context: { failedSource: 'getActiveDebts', somethingRandom: 'nope', metadata: { a: 1 } } as any,
    });
    const line = parseLine(warnSpy);
    expect(line.failedSource).toBe('getActiveDebts');
    expect(line).not.toHaveProperty('somethingRandom');
    expect(line).not.toHaveProperty('metadata');
  });

  it('F. studentId is never serialized even if passed in context', () => {
    logOperationalError({
      subsystem: 's',
      operation: 'o',
      error: new Error('e'),
      context: { studentId: 'stu-abc-123', conceptId: 'c-1' } as any,
    });
    const raw = errSpy.mock.calls[0][1] as string;
    expect(raw).not.toContain('stu-abc-123');
    expect(raw).not.toContain('studentId');
    expect(parseLine(errSpy).conceptId).toBe('c-1');
  });

  it('G. email is never serialized', () => {
    logOperationalWarning({ subsystem: 's', operation: 'o', context: { email: 'a@b.com' } as any });
    expect(warnSpy.mock.calls[0][1] as string).not.toContain('a@b.com');
  });

  it('H. answer / prompt / requestBody are never serialized', () => {
    logOperationalWarning({
      subsystem: 's',
      operation: 'o',
      context: { answer: 'the answer is 42', prompt: 'SYSTEM PROMPT', requestBody: '{secret:1}' } as any,
    });
    const raw = warnSpy.mock.calls[0][1] as string;
    expect(raw).not.toContain('the answer is 42');
    expect(raw).not.toContain('SYSTEM PROMPT');
    expect(raw).not.toContain('{secret:1}');
  });

  it('allowed context passes through: route, failedSource, conceptId, subjectId, activityType, count, conceptIds', () => {
    logOperationalWarning({
      subsystem: 's',
      operation: 'o',
      context: {
        route: '/dashboard/today',
        failedSource: 'getActiveDebts',
        conceptId: 'c-1',
        subjectId: 's-1',
        activityType: 'RETENTION_CHECK',
        count: 3,
        conceptIds: ['c-1', 'c-2', 'c-3'],
      },
    });
    const line = parseLine(warnSpy);
    expect(line).toMatchObject({
      route: '/dashboard/today',
      failedSource: 'getActiveDebts',
      conceptId: 'c-1',
      subjectId: 's-1',
      activityType: 'RETENTION_CHECK',
      count: 3,
      conceptIds: ['c-1', 'c-2', 'c-3'],
    });
  });
});

describe('Closeout D1 -- secret scrubbing (fake sentinels only)', () => {
  const cases: Array<[string, string]> = [
    ['postgres URL', 'connect ECONNREFUSED postgres://appuser:s3cr3tpw@db.internal:5432/studyus now'],
    ['postgresql URL', 'FATAL postgresql://u:p@host/db'],
    ['anthropic-style key', 'auth failed for sk-ant-api03-AAAAABBBBBCCCCCDDDDD'],
    ['clerk secret', 'invalid sk_live_ZZZZZZZZZZZZZZZZ token'],
    ['bearer token', 'Authorization: Bearer abcdef123456.ghijkl'],
    ['jwt-ish', 'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpart'],
    ['assignment', 'DB_PASSWORD=supersecret123 in env'],
  ];
  for (const [label, message] of cases) {
    it(`redacts ${label}`, () => {
      logOperationalError({ subsystem: 's', operation: 'o', error: new Error(message) });
      const raw = errSpy.mock.calls[0][1] as string;
      expect(raw).toContain('[redacted]');
      expect(raw).not.toMatch(/s3cr3tpw|sk-ant-api03-AAAAABBBBBCCCCCDDDDD|sk_live_ZZZZZZZZZZZZZZZZ|abcdef123456\.ghijkl|payloadpart|supersecret123/);
    });
  }
});

describe('Closeout D1 -- error handling of the error itself', () => {
  it('K. errorMessage is bounded and no stack trace is serialized', () => {
    const big = new Error('E'.repeat(5000));
    logOperationalError({ subsystem: 's', operation: 'o', error: big });
    const line = parseLine(errSpy);
    expect(typeof line.errorMessage).toBe('string');
    expect(line.errorMessage.length).toBeLessThanOrEqual(320);
    expect(line).not.toHaveProperty('stack');
    expect(errSpy.mock.calls[0][1] as string).not.toContain('operational-log.ts');
  });

  it('errorName is captured, Error object is not spread', () => {
    class MissingConceptMemoryStateError extends Error {
      constructor() {
        super('MISSING_CONCEPT_MEMORY_STATE: ...');
        this.name = 'MissingConceptMemoryStateError';
      }
    }
    logOperationalError({ subsystem: 'phase6-memory', operation: 'getPhase2MemoryInput', error: new MissingConceptMemoryStateError() });
    const line = parseLine(errSpy);
    expect(line.errorName).toBe('MissingConceptMemoryStateError');
  });

  it('J. logger never throws, even on a hostile error / circular context', () => {
    const circular: any = {};
    circular.self = circular;
    const hostile = { get message() { throw new Error('nope'); } } as unknown as Error;
    expect(() => logOperationalError({ subsystem: 's', operation: 'o', error: hostile, context: circular })).not.toThrow();
    expect(() => logOperationalWarning({ subsystem: 's', operation: 'o', error: undefined })).not.toThrow();
  });

  it('omits errorMessage/errorName entirely when no error is given', () => {
    logOperationalWarning({ subsystem: 's', operation: 'o', context: { count: 0 } });
    const line = parseLine(warnSpy);
    expect(line).not.toHaveProperty('errorName');
    expect(line).not.toHaveProperty('errorMessage');
  });
});
