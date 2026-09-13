/**
 * LX-9R3 D3/D4 -- required tests 23 and 27: the deterministic gate must
 * never let a rejectable candidate reach the (expensive) semantic
 * verifier, and batching a semantic-verification pass down to ONE
 * Terra call must materially reduce provider-call count vs. one call
 * per candidate. Mocks @/services/question-quality-verifier.service
 * (same hoisted-handler pattern as
 * tests/unit/lx4p-perf-r1c-r1-gate-primitives.test.ts) so these tests
 * observe CALL COUNTS against the REAL applyQuestionQualityGate, not
 * verdict content -- verdict-content correctness (1:1 id mapping,
 * fail-closed on a malformed/missing verdict) is covered separately in
 * tests/unit/lx9r3-semantic-batch-verifier.test.ts against the REAL
 * verifyQuestionQualityBatch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ det: vi.fn(), verify: vi.fn(), verifyBatch: vi.fn(), evalV: vi.fn() }));

vi.mock('@/lib/lx/question-quality-contract', () => ({ checkQuestionQualityDeterministic: (...a: any[]) => h.det(...a) }));
vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: (...a: any[]) => h.verify(...a),
  verifyQuestionQualityBatch: (a: any) => h.verifyBatch(a),
  evaluateQuestionQualityVerdict: (...a: any[]) => h.evalV(...a),
}));
vi.mock('@/services/quiz-generation.service', () => ({ generateQuestionsForConcept: vi.fn(async () => []) }));

import { applyQuestionQualityGate } from '@/services/gated-question-generation.service';

const Q = (id: string): any => ({ id, conceptId: 'c1', type: 'short_answer', answerFormat: 'text', question: id, correctAnswer: 'a', explanation: 'e', difficulty: 3 });

beforeEach(() => {
  h.det.mockReset().mockReturnValue({ status: 'PASS', failures: [] });
  h.verify.mockReset().mockResolvedValue({});
  h.verifyBatch.mockReset().mockResolvedValue(new Map());
  h.evalV.mockReset().mockReturnValue({ pass: true });
});

describe('LX-9R3 performance 23 -- a deterministic rejection never reaches the semantic verifier', () => {
  it('8 candidates, ALL deterministically FAIL -> neither the single nor the batched semantic verifier is ever called', async () => {
    h.det.mockReturnValue({ status: 'FAIL', failures: ['x'] });
    const qs = Array.from({ length: 8 }, (_, i) => Q(`q${i}`));
    const res = await applyQuestionQualityGate(qs, { conceptId: 'c1', language: 'en' });
    expect(res.accepted).toEqual([]);
    expect(res.deterministicRejected).toBe(8);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.verifyBatch).not.toHaveBeenCalled();
  });

  it('a mix of FAIL/PASS/NOT_DETERMINISTICALLY_VERIFIED only ever sends the NOT_DETERMINISTICALLY_VERIFIED ones onward', async () => {
    h.det
      .mockReturnValueOnce({ status: 'FAIL', failures: ['x'] })
      .mockReturnValueOnce({ status: 'PASS', failures: [] })
      .mockReturnValueOnce({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] })
      .mockReturnValueOnce({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    h.verifyBatch.mockResolvedValue(new Map([['0', { conceptAligned: true }], ['1', { conceptAligned: true }]]));
    h.evalV.mockReturnValue({ pass: true });
    const res = await applyQuestionQualityGate([Q('fail'), Q('pass'), Q('a'), Q('b')], { conceptId: 'c1' });
    expect(h.verifyBatch).toHaveBeenCalledTimes(1);
    const sentCandidates = h.verifyBatch.mock.calls[0][0].candidates.map((c: any) => c.question.id);
    expect(sentCandidates).toEqual(['a', 'b']); // never 'fail' (deterministically rejected) or 'pass' (already accepted)
  });
});

describe('LX-9R3 performance 27 -- provider-call count is materially reduced by batching', () => {
  it('8 candidates all needing semantic verification -> exactly ONE verifyQuestionQualityBatch call, never 8 separate verifyQuestionQuality calls', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    const qs = Array.from({ length: 8 }, (_, i) => Q(`q${i}`));
    h.verifyBatch.mockResolvedValue(new Map(qs.map((_, i) => [String(i), { conceptAligned: true }])));
    h.evalV.mockReturnValue({ pass: true });
    const res = await applyQuestionQualityGate(qs, { conceptId: 'c1' });
    expect(h.verifyBatch).toHaveBeenCalledTimes(1); // 1 provider call instead of 8
    expect(h.verify).not.toHaveBeenCalled();
    expect(res.accepted).toHaveLength(8);
  });

  it('exactly one candidate needing semantic verification still uses the single-candidate call (no batch-prompt overhead for the trivial case)', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    h.verify.mockResolvedValue({ conceptAligned: true });
    h.evalV.mockReturnValue({ pass: true });
    const res = await applyQuestionQualityGate([Q('only')], { conceptId: 'c1' });
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.verifyBatch).not.toHaveBeenCalled();
    expect(res.accepted).toHaveLength(1);
  });
});
