/**
 * LX-4P-PERF-R1C-R1 -- the shared UNIVERSAL Question Quality Gate
 * primitives:
 *   - applyQuestionQualityGate: deterministic contract, then PARALLEL
 *     semantic verdicts, fail-closed, original order preserved.
 *   - gateUnitWithTerraFallback: one narrow Terra regeneration of a
 *     failing unit (EMPTY trigger for partial-tolerant callers, SHORT
 *     for all-or-nothing), never a second, plus an [ai-runtime] event
 *     per attempt carrying accepted/rejected/fallback metadata (R8).
 *
 * Whole-module-mocks the contract / verifier / runtime-event modules, so
 * it is separate from the source-audit file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  det: vi.fn(),
  verify: vi.fn(),
  evalV: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/lib/lx/question-quality-contract', () => ({ checkQuestionQualityDeterministic: (...a: any[]) => h.det(...a) }));
vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: (...a: any[]) => h.verify(...a),
  evaluateQuestionQualityVerdict: (...a: any[]) => h.evalV(...a),
}));
vi.mock('@/lib/ai/runtime-event', () => ({
  recordRuntimeEvent: (...a: any[]) => h.record(...a),
  buildRuntimeEvent: (b: any) => ({ ...b, estimatedCostUSD: null, costComplete: false }),
}));
vi.mock('@/services/quiz-generation.service', () => ({ generateQuestionsForConcept: vi.fn(async () => []) }));

import { applyQuestionQualityGate, gateUnitWithTerraFallback } from '@/services/gated-question-generation.service';

const Q = (id: string): any => ({ id, conceptId: 'c1', type: 'short_answer', answerFormat: 'text', question: id, correctAnswer: 'a', explanation: 'e', difficulty: 3 });

beforeEach(() => {
  h.det.mockReset().mockReturnValue({ status: 'PASS', failures: [] });
  h.verify.mockReset().mockResolvedValue({});
  h.evalV.mockReset().mockReturnValue({ pass: true });
  h.record.mockReset();
});

describe('applyQuestionQualityGate', () => {
  it('drops FAIL, keeps PASS, sends NOT_DETERMINISTICALLY_VERIFIED to the verifier -- order preserved', async () => {
    h.det
      .mockReturnValueOnce({ status: 'PASS', failures: [] })
      .mockReturnValueOnce({ status: 'FAIL', failures: ['x'] })
      .mockReturnValueOnce({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    const res = await applyQuestionQualityGate([Q('a'), Q('b'), Q('c')], { conceptId: 'c1', language: 'en' });
    expect(res.accepted.map((q) => q.id)).toEqual(['a', 'c']);
    expect(res.deterministicRejected).toBe(1);
    expect(h.verify).toHaveBeenCalledTimes(1);
  });

  it('issues the semantic verdicts concurrently (Promise.all), not serially', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    let inFlight = 0;
    let maxInFlight = 0;
    h.verify.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return {};
    });
    await applyQuestionQualityGate([Q('a'), Q('b'), Q('c'), Q('d')], { conceptId: 'c1' });
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('a rejected verdict fails closed -- question dropped, counted semanticRejected', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    h.evalV.mockReturnValueOnce({ pass: false }).mockReturnValue({ pass: true });
    const res = await applyQuestionQualityGate([Q('a'), Q('b')], { conceptId: 'c1' });
    expect(res.accepted.map((q) => q.id)).toEqual(['b']);
    expect(res.semanticRejected).toBe(1);
  });

  it('a verifier throw is caught and fails closed (never accepts on error)', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    h.verify.mockRejectedValue(new Error('provider down'));
    h.evalV.mockReturnValue({ pass: false }); // evaluate(null) -> fail
    const res = await applyQuestionQualityGate([Q('a')], { conceptId: 'c1' });
    expect(res.accepted).toEqual([]);
  });
});

describe('gateUnitWithTerraFallback', () => {
  it("EMPTY trigger: a short-but-nonempty Luna unit is accepted, NO Terra", async () => {
    const terra = vi.fn(async () => [Q('t1'), Q('t2')]);
    const r = await gateUnitWithTerraFallback([Q('l1')], { conceptId: 'c1', targetCount: 4, fallbackWhen: 'EMPTY' }, terra);
    expect(r.accepted.map((q) => q.id)).toEqual(['l1']);
    expect(r.fallbackUsed).toBe(false);
    expect(terra).not.toHaveBeenCalled();
  });

  it("SHORT trigger: a short Luna unit fires exactly ONE Terra regeneration", async () => {
    const terra = vi.fn(async () => [Q('t1'), Q('t2'), Q('t3')]);
    const r = await gateUnitWithTerraFallback([Q('l1')], { conceptId: 'c1', targetCount: 3, fallbackWhen: 'SHORT' }, terra);
    expect(terra).toHaveBeenCalledTimes(1);
    expect(r.accepted.length).toBe(3);
    expect(r.fallbackUsed).toBe(true);
  });

  it('empty Luna + empty Terra -> [] and NEVER a second Terra call', async () => {
    const terra = vi.fn(async () => []);
    const r = await gateUnitWithTerraFallback([], { conceptId: 'c1', targetCount: 3, fallbackWhen: 'EMPTY' }, terra);
    expect(terra).toHaveBeenCalledTimes(1);
    expect(r.accepted).toEqual([]);
  });

  it('caps the merged accepted set at targetCount', async () => {
    const terra = vi.fn(async () => [Q('t1'), Q('t2'), Q('t3'), Q('t4')]);
    const r = await gateUnitWithTerraFallback([], { conceptId: 'c1', targetCount: 2, fallbackWhen: 'EMPTY' }, terra);
    expect(r.accepted.length).toBe(2);
  });

  it('R8: every attempt records a runtime event with model / qualityGateResult / fallbackUsed / acceptedCount / rejectedCount', async () => {
    h.det.mockReturnValueOnce({ status: 'FAIL', failures: ['x'] }).mockReturnValue({ status: 'PASS', failures: [] });
    await gateUnitWithTerraFallback([Q('l1')], { conceptId: 'c1', targetCount: 1, fallbackWhen: 'EMPTY' }, async () => [Q('t1')]);
    expect(h.record).toHaveBeenCalledTimes(2);
    const luna = h.record.mock.calls[0][0];
    const terra = h.record.mock.calls[1][0];
    expect(luna).toMatchObject({ model: 'gpt-5.6-luna', fallbackUsed: false, acceptedCount: 0, rejectedCount: 1, qualityGateResult: 'DETERMINISTIC_FAIL' });
    expect(terra).toMatchObject({ model: 'gpt-5.6-terra', fallbackUsed: true, acceptedCount: 1, rejectedCount: 0 });
    expect(typeof terra.fallbackReason).toBe('string');
  });

  it('valid Luna unit -> exactly ONE runtime event, no Terra event', async () => {
    await gateUnitWithTerraFallback([Q('l1'), Q('l2')], { conceptId: 'c1', targetCount: 2, fallbackWhen: 'SHORT' }, async () => []);
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.record.mock.calls[0][0]).toMatchObject({ model: 'gpt-5.6-luna', fallbackUsed: false, qualityGateResult: 'PASS' });
  });
});
