/**
 * LX-4P-PERF-R1C C5/C6/C7 -- the canonical ~3-question Practice path
 * runs the Luna-first Quality Gate, not the legacy Sonnet batch:
 *
 *   Luna generate -> deterministic Question Quality Contract
 *     -> semantic verification for the not-deterministic ones
 *     -> ACCEPT survivors
 *   nothing survives -> ONE Terra regeneration -> same gates
 *     -> ACCEPT / [] (recoverable, fail-closed)
 *
 * NEVER a third model call. NEVER a Claude fallback.
 *
 * This file whole-module-mocks @/services/quiz-generation.service, so it
 * is separate from lx4p-perf-r1c-openai-rewire.test.ts (which imports
 * that service for real).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  gen: vi.fn(),
  det: vi.fn(),
  verify: vi.fn(),
  evalV: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/services/quiz-generation.service', () => ({
  generateQuestionsForConcept: (...a: any[]) => h.gen(...a),
}));
vi.mock('@/lib/lx/question-quality-contract', () => ({
  checkQuestionQualityDeterministic: (...a: any[]) => h.det(...a),
}));
vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: (...a: any[]) => h.verify(...a),
  evaluateQuestionQualityVerdict: (...a: any[]) => h.evalV(...a),
}));
vi.mock('@/lib/ai/runtime-event', () => ({
  recordRuntimeEvent: (...a: any[]) => h.record(...a),
  buildRuntimeEvent: (b: any) => b,
}));

import { generateGatedPracticeBatch } from '@/services/gated-question-generation.service';

const Q = (id: string) => ({ id, conceptId: 'c1', type: 'multiple_choice', question: id, correctAnswer: 'A', explanation: 'e', difficulty: 3 });

beforeEach(() => {
  h.gen.mockReset();
  h.det.mockReset().mockReturnValue({ status: 'PASS', failures: [] });
  h.verify.mockReset().mockResolvedValue({});
  h.evalV.mockReset().mockReturnValue({ pass: true });
  h.record.mockReset();
});

describe('LX-4P-PERF-R1C C7 -- generateGatedPracticeBatch', () => {
  it('Luna batch clears the gate -> returned as-is, generator called ONCE (no Terra)', async () => {
    h.gen.mockResolvedValueOnce([Q('a'), Q('b'), Q('c')]);
    const out = await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 3, language: 'en' });
    expect(out.map((q) => q.id)).toEqual(['a', 'b', 'c']);
    expect(h.gen).toHaveBeenCalledTimes(1);
  });

  it('Luna wholly rejected by the deterministic gate -> exactly ONE Terra retry, then accepted', async () => {
    h.gen.mockResolvedValueOnce([Q('bad')]).mockResolvedValueOnce([Q('good')]);
    h.det.mockReturnValueOnce({ status: 'FAIL', failures: ['x'] }).mockReturnValue({ status: 'PASS', failures: [] });
    const out = await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });
    expect(out.map((q) => q.id)).toEqual(['good']);
    expect(h.gen).toHaveBeenCalledTimes(2);
    expect(h.gen.mock.calls[1][3]).toMatchObject({ modelOverride: 'gpt-5.6-terra' });
  });

  it('Luna semantic FAIL also escalates to Terra', async () => {
    h.gen.mockResolvedValueOnce([Q('luna')]).mockResolvedValueOnce([Q('terra')]);
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    h.evalV.mockReturnValueOnce({ pass: false }).mockReturnValue({ pass: true });
    const out = await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });
    expect(out.map((q) => q.id)).toEqual(['terra']);
    expect(h.gen).toHaveBeenCalledTimes(2);
  });

  it('Terra also fails -> [] (recoverable), NEVER a third generator call, NEVER a Claude model', async () => {
    h.gen.mockResolvedValue([Q('always-bad')]);
    h.det.mockReturnValue({ status: 'FAIL', failures: ['x'] });
    const out = await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });
    expect(out).toEqual([]);
    expect(h.gen).toHaveBeenCalledTimes(2);
    for (const call of h.gen.mock.calls) {
      const override = call[3]?.modelOverride;
      if (override) expect(override).toBe('gpt-5.6-terra');
    }
  });

  it('a generator throw is caught -> treated as an empty batch, still fails closed (no crash)', async () => {
    h.gen.mockRejectedValue(new Error('provider down'));
    const out = await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 3, language: 'en' });
    expect(out).toEqual([]);
    expect(h.gen).toHaveBeenCalledTimes(2);
  });
});
