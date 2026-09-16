/**
 * CANON-V2-ARCH-CLEANUP Section 8/9 -- THE CANONICAL RETAIN GENERATION
 * SERVICE.
 *
 * `generateCanonicalRetainQuestions` mirrors `canonical-prove-generation.service.ts`'s
 * own orchestration exactly (concurrent chunks -> exact-duplicate
 * novelty filter -> at most one bounded aggregate recovery -> exactly
 * `targetCount` or a short result), but checks novelty against a
 * BROADER base -- Practice + Prove + any earlier Retain, never Practice
 * alone -- since RETAIN's frozen contract requires items the learner has
 * never seen in ANY prior canonical activity.
 *
 * `generateConcurrentChunkedBatch`/`generateBoundedRecoveryBatch` are
 * mocked directly (they are independently tested against the real AI
 * stack in canon-r6-perf-r1-concurrent-chunking.test.ts) -- this file
 * tests only this service's OWN orchestration: which functions it
 * calls, with what count, against which novelty base, and how it
 * degrades on a shortfall. `filterExactDuplicates` is the real, pure
 * implementation (no mock needed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  chunked: vi.fn(),
  recovery: vi.fn(),
  priorFingerprints: vi.fn(),
}));

vi.mock('@/services/gated-question-generation.service', () => ({
  generateConcurrentChunkedBatch: (...a: any[]) => h.chunked(...a),
  generateBoundedRecoveryBatch: (...a: any[]) => h.recovery(...a),
}));
vi.mock('@/services/quiz-persistence.service', () => ({
  loadPriorCanonicalQuestionFingerprintsForRetain: (...a: any[]) => h.priorFingerprints(...a),
}));

import { generateCanonicalRetainQuestions } from '@/services/canonical-retain-generation.service';

const Q = (id: string, conceptId = 'c1'): any => ({
  id, conceptId, type: 'short_answer', answerFormat: 'text', question: `question ${id}`,
  correctAnswer: 'a', explanation: 'e', difficulty: 3,
});

const baseParams = {
  conceptId: 'c1',
  studentId: 's1',
  subjectId: 'subj1',
  targetCount: 10,
  difficulty: 3,
  guidance: 'g',
  language: 'en',
  visualAidRate: 0,
  ibContext: null,
  activityType: 'RETENTION_CHECK',
  quizMode: 'canonical_retain',
  parentOperationId: 'op1',
};

beforeEach(() => {
  h.chunked.mockReset();
  h.recovery.mockReset();
  h.priorFingerprints.mockReset().mockResolvedValue(new Set<string>());
});

describe('generateCanonicalRetainQuestions', () => {
  it('requests exactly targetCount (10) from generateConcurrentChunkedBatch -- never the legacy fixed 6', async () => {
    h.chunked.mockResolvedValue({
      accepted: Array.from({ length: 10 }, (_, i) => Q(`q${i}`)),
      chunkPlan: [5, 5],
      chunkDiagnostics: [{ externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false }, { externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false }],
    });
    const result = await generateCanonicalRetainQuestions(baseParams);
    expect(h.chunked).toHaveBeenCalledTimes(1);
    expect(h.chunked.mock.calls[0][3]).toMatchObject({ count: 10, difficulty: 3, activityType: 'RETENTION_CHECK', quizMode: 'canonical_retain' });
    expect(result.finalQuestionCount).toBe(10);
    expect(h.recovery).not.toHaveBeenCalled();
  });

  it('checks novelty against the BROADER Practice+Prove+Retain fingerprint base, not the Prove-only one', async () => {
    h.chunked.mockResolvedValue({ accepted: Array.from({ length: 10 }, (_, i) => Q(`q${i}`)), chunkPlan: [10], chunkDiagnostics: [{ externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false }] });
    await generateCanonicalRetainQuestions(baseParams);
    expect(h.priorFingerprints).toHaveBeenCalledWith('s1', 'c1');
  });

  it('rejects a chunk candidate that exactly duplicates a prior canonical question (Practice/Prove/Retain) and triggers bounded recovery for the shortfall', async () => {
    h.priorFingerprints.mockResolvedValue(new Set(['duplicate question']));
    h.chunked.mockResolvedValue({
      accepted: [{ ...Q('dup'), question: 'Duplicate Question' }, ...Array.from({ length: 8 }, (_, i) => Q(`ok${i}`))],
      chunkPlan: [9],
      chunkDiagnostics: [{ externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false }],
    });
    h.recovery.mockResolvedValue({
      accepted: [Q('recovered')],
      diagnostics: { externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false },
    });
    const result = await generateCanonicalRetainQuestions(baseParams);
    expect(result.rejectedExactDuplicateCount).toBe(1);
    expect(h.recovery).toHaveBeenCalledTimes(1);
    expect(result.finalQuestionCount).toBe(9);
    expect(result.aggregateRecoveryUsed).toBe(true);
  });

  it('never throws on a shortfall -- returns a result with finalQuestionCount < targetCount instead (caller decides fail-closed behavior)', async () => {
    h.chunked.mockResolvedValue({ accepted: Array.from({ length: 3 }, (_, i) => Q(`q${i}`)), chunkPlan: [3], chunkDiagnostics: [{ externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false }] });
    h.recovery.mockResolvedValue({ accepted: [], diagnostics: { externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false } });
    const result = await generateCanonicalRetainQuestions(baseParams);
    expect(result.finalQuestionCount).toBe(3);
    expect(result.finalQuestionCount).toBeLessThan(baseParams.targetCount);
  });

  it('at most one aggregate recovery round is ever attempted, matching the Prove precedent exactly', async () => {
    h.chunked.mockResolvedValue({ accepted: Array.from({ length: 5 }, (_, i) => Q(`q${i}`)), chunkPlan: [5], chunkDiagnostics: [{ externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false }] });
    h.recovery.mockResolvedValue({ accepted: Array.from({ length: 2 }, (_, i) => Q(`r${i}`)), diagnostics: { externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false } });
    const result = await generateCanonicalRetainQuestions(baseParams);
    expect(h.recovery).toHaveBeenCalledTimes(1);
    expect(result.finalQuestionCount).toBe(7);
  });
});
