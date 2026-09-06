/**
 * STUDYUS PHASE 6 -- CLOSEOUT D3.
 *
 * The Phase 2 required-state boundary (getPhase2MemoryInput) must:
 *   - emit exactly ONE structured operational ERROR when
 *     concept_memory_state is missing, and
 *   - STILL throw MissingConceptMemoryStateError (unchanged fatal
 *     semantics -- the surrounding updateMastery transaction still
 *     rolls back and rethrows).
 * studentId must not appear in the log line.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getPhase2MemoryInput, MissingConceptMemoryStateError } from '@/services/memory-read.service';

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
const saved = { sha: process.env.VERCEL_GIT_COMMIT_SHA, env: process.env.VERCEL_ENV };

beforeEach(() => {
  process.env.VERCEL_GIT_COMMIT_SHA = 'aaaabbbbccccddddeeeeffff0000111122223333';
  process.env.VERCEL_ENV = 'production';
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  saved.sha === undefined ? delete process.env.VERCEL_GIT_COMMIT_SHA : (process.env.VERCEL_GIT_COMMIT_SHA = saved.sha);
  saved.env === undefined ? delete process.env.VERCEL_ENV : (process.env.VERCEL_ENV = saved.env);
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

// A DbExecutor whose concept_memory_state read returns no row.
const emptyClient = { query: vi.fn(async () => ({ rows: [] as unknown[] })) } as any;

describe('Closeout D3 -- MissingConceptMemoryStateError is observable and still fatal', () => {
  it('emits one [ops] ERROR and still throws', async () => {
    await expect(getPhase2MemoryInput(emptyClient, 'stu-secret-42', 'concept-9')).rejects.toBeInstanceOf(
      MissingConceptMemoryStateError,
    );

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toBe('[ops]');
    const line = JSON.parse(errSpy.mock.calls[0][1] as string);
    expect(line).toMatchObject({
      at: 'operational_error',
      severity: 'ERROR',
      subsystem: 'phase6-memory',
      operation: 'getPhase2MemoryInput',
      errorName: 'MissingConceptMemoryStateError',
      conceptId: 'concept-9',
      environment: 'production',
    });
    expect(line.commitSha).toBe('aaaabbbbccccddddeeeeffff0000111122223333');
  });

  it('does not log studentId anywhere in the line', async () => {
    await expect(getPhase2MemoryInput(emptyClient, 'stu-secret-42', 'concept-9')).rejects.toThrow();
    const raw = errSpy.mock.calls[0][1] as string;
    expect(raw).not.toContain('stu-secret-42');
    expect(raw).not.toContain('studentId');
  });

  it('does not double-log (one detection point, one line)', async () => {
    await expect(getPhase2MemoryInput(emptyClient, 's', 'c')).rejects.toThrow();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('when the row DOES exist, nothing is logged and no throw', async () => {
    const okClient = {
      query: vi.fn(async () => ({
        rows: [
          {
            policy_version: 1,
            demonstrated_retention_score: 80,
            retention_evidence_count: 2,
            memory_status: 'DEVELOPING',
            last_successful_retention_at: '2026-09-01T00:00:00.000Z',
          },
        ],
      })),
    } as any;
    const out = await getPhase2MemoryInput(okClient, 's', 'c');
    expect(out.demonstratedRetentionScore).toBe(80);
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
