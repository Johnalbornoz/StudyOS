/**
 * LX-9R8 -- required tests 10, 11, 18, 19, 20: the semantic
 * quality-gate's rejection observability (per-candidate log line +
 * aggregate histogram, PART B/B3) and the regression proof that
 * threading operationId/activityType through never changed the
 * exact-count / retry-recovery contracts (PART D preface).
 *
 * Whole-module-mocks the deterministic contract and semantic verifier,
 * same pattern as lx4p-perf-r1c-r1-gate-primitives.test.ts -- separate
 * from lx9r8-zero-gap-action-quality-gate.test.ts, which deliberately
 * runs the REAL (unmocked) pure functions and cannot share a file with
 * mocks of the same modules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  det: vi.fn(),
  verify: vi.fn(),
  verifyBatch: vi.fn(async ({ candidates }: any) => {
    const entries = await Promise.all(
      candidates.map(async (c: any) => [c.id, await h.verify({ question: c.question })] as const),
    );
    return new Map(entries);
  }),
  evalV: vi.fn(),
  classify: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/lib/lx/question-quality-contract', () => ({ checkQuestionQualityDeterministic: (...a: any[]) => h.det(...a) }));
vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: (...a: any[]) => h.verify(...a),
  verifyQuestionQualityBatch: (a: any) => h.verifyBatch(a),
  evaluateQuestionQualityVerdict: (...a: any[]) => h.evalV(...a),
  classifyQualityRejectionReasons: (...a: any[]) => h.classify(...a),
}));
vi.mock('@/lib/ai/runtime-event', () => ({
  recordRuntimeEvent: (...a: any[]) => h.record(...a),
  buildRuntimeEvent: (b: any) => ({ ...b, estimatedCostUSD: null, costComplete: false }),
  buildAggregateRuntimeEvent: (base: any, calls: any[]) => ({ ...base, calls }),
}));
vi.mock('@/services/quiz-generation.service', () => ({ generateQuestionsForConcept: vi.fn(async () => []) }));

import { applyQuestionQualityGate, gateUnitWithTerraFallback } from '@/services/gated-question-generation.service';

const Q = (id: string, difficulty = 2): any => ({
  id, conceptId: 'c1', type: 'short_answer', answerFormat: 'text', question: id,
  correctAnswer: 'a', explanation: 'e', difficulty,
});

beforeEach(() => {
  h.det.mockReset().mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
  h.verify.mockReset().mockResolvedValue({});
  h.evalV.mockReset().mockReturnValue({ pass: true });
  h.classify.mockReset().mockReturnValue([]);
  h.record.mockReset();
});

describe('LX-9R8 10 -- one safe, structured [quality_gate_rejection] line per rejected candidate', () => {
  it('logs operationId/candidateId/activityType/difficulty/verdict/reasonCode -- NEVER question text, correctAnswer, or explanation', async () => {
    h.evalV.mockReturnValue({ pass: false });
    h.classify.mockReturnValue(['AMBIGUOUS']);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await applyQuestionQualityGate([Q('secret-question-text', 2)], {
        conceptId: 'c1', language: 'en', operationId: 'op-1', activityType: 'PRACTICE',
      });
      const rejectionCall = logSpy.mock.calls.find((c) => c[0] === '[quality_gate_rejection]');
      expect(rejectionCall).toBeTruthy();
      const payload = JSON.parse(rejectionCall![1] as string);
      expect(payload).toEqual({
        operationId: 'op-1', candidateId: '0', activityType: 'PRACTICE',
        difficulty: 2, verdict: 'SEMANTIC_FAIL', reasonCode: ['AMBIGUOUS'],
      });
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/secret-question-text/);
      expect(serialized).not.toContain('question');
      expect(serialized).not.toContain('correctAnswer');
      expect(serialized).not.toContain('explanation');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('a missing/malformed verdict logs verdict=VERIFY_ERROR, reasonCode=[VERIFY_ERROR] -- fails closed, never silent', async () => {
    h.verify.mockResolvedValue(null);
    h.evalV.mockReturnValue({ pass: false });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await applyQuestionQualityGate([Q('a')], { conceptId: 'c1', operationId: 'op-2' });
      const rejectionCall = logSpy.mock.calls.find((c) => c[0] === '[quality_gate_rejection]');
      const payload = JSON.parse(rejectionCall![1] as string);
      expect(payload.verdict).toBe('VERIFY_ERROR');
      expect(payload.reasonCode).toEqual(['VERIFY_ERROR']);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('LX-9R8 11 -- the reasonCode carried in the rejection line is the SAME stable taxonomy the histogram tallies', () => {
  it('classifyQualityRejectionReasons is the single source both the log line and the histogram read from', async () => {
    h.evalV.mockReturnValue({ pass: false });
    h.classify.mockReturnValue(['OUT_OF_SCOPE', 'WEAK_DISTRACTORS']);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await applyQuestionQualityGate([Q('a')], { conceptId: 'c1', operationId: 'op-3' });
      const rejectionCall = logSpy.mock.calls.find((c) => c[0] === '[quality_gate_rejection]');
      const payload = JSON.parse(rejectionCall![1] as string);
      expect(payload.reasonCode).toEqual(['OUT_OF_SCOPE', 'WEAK_DISTRACTORS']);
      expect(res.semanticRejectionHistogram.OUT_OF_SCOPE).toBe(1);
      expect(res.semanticRejectionHistogram.WEAK_DISTRACTORS).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('LX-9R8 18 -- the aggregate rejection-reason histogram is observable on every gate call', () => {
  it('every taxonomy code is present (0 when unseen), and the aggregate summary line reports the 4 required counts', async () => {
    // classifyQualityRejectionReasons is invoked twice per rejection
    // (a length check, then the value itself) -- mocked as a pure
    // function of the verdict's own marker, never a call-count sequence,
    // so both invocations for the SAME candidate agree.
    h.verify.mockResolvedValueOnce({ marker: 'A' }).mockResolvedValueOnce({ marker: 'B' }).mockResolvedValueOnce({ marker: 'C' });
    h.evalV.mockImplementation((v: any) => ({ pass: v?.marker === 'B' }));
    h.classify.mockImplementation((v: any) => (v?.marker === 'A' ? ['AMBIGUOUS'] : v?.marker === 'C' ? ['SCENARIO_INAPPROPRIATE'] : []));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await applyQuestionQualityGate([Q('a'), Q('b'), Q('c')], { conceptId: 'c1', operationId: 'op-4', activityType: 'RETENTION_CHECK' });
      expect(res.semanticRejectionHistogram).toEqual({
        OUT_OF_SCOPE: 0, ANSWER_INCORRECT: 0, AMBIGUOUS: 1, REASONING_MISMATCH: 0,
        WEAK_DISTRACTORS: 0, SCENARIO_INAPPROPRIATE: 1, VISUAL_INCONSISTENT: 0,
        LOW_CONFIDENCE: 0, VERIFY_ERROR: 0,
      });
      const summaryCall = logSpy.mock.calls.find((c) => c[0] === '[quality_gate_summary]');
      expect(summaryCall).toBeTruthy();
      const payload = JSON.parse(summaryCall![1] as string);
      expect(payload).toMatchObject({
        operationId: 'op-4', activityType: 'RETENTION_CHECK',
        generatedCandidates: 3, semanticChecked: 3, semanticAccepted: 1, semanticRejected: 2,
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('LX-9R8 19 -- exact-count contract unchanged by the operationId/activityType threading', () => {
  it('gateUnitWithTerraFallback still caps the merged accepted set at targetCount, with req omitting the new optional fields entirely', async () => {
    const terra = vi.fn(async () => [Q('t1'), Q('t2'), Q('t3'), Q('t4')]);
    const r = await gateUnitWithTerraFallback([], { conceptId: 'c1', targetCount: 2, fallbackWhen: 'EMPTY' }, terra);
    expect(r.accepted.length).toBe(2);
    expect(r.insufficientCount).toBe(false);
  });

  it('a genuinely short result after Terra still reports insufficientCount=true, unchanged', async () => {
    const r = await gateUnitWithTerraFallback([], { conceptId: 'c1', targetCount: 5, fallbackWhen: 'EMPTY' }, async () => [Q('t1')]);
    expect(r.accepted.length).toBe(1);
    expect(r.insufficientCount).toBe(true);
  });
});

describe('LX-9R8 20 -- retry/recovery contract unchanged: exactly ONE Terra regeneration, never a second', () => {
  it('a SHORT trigger fires exactly one Terra call, and operationId/activityType are purely additive logging context', async () => {
    const terra = vi.fn(async () => [Q('t1'), Q('t2'), Q('t3')]);
    const r = await gateUnitWithTerraFallback(
      [Q('l1')],
      { conceptId: 'c1', targetCount: 3, fallbackWhen: 'SHORT', operationId: 'op-5', activityType: 'PRACTICE' },
      terra,
    );
    expect(terra).toHaveBeenCalledTimes(1);
    expect(r.fallbackUsed).toBe(true);
    expect(r.accepted.length).toBe(3);
  });
});
