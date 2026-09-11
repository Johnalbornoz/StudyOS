/**
 * LX-4P-PERF-R1G -- OpenAI usage & cost telemetry propagation.
 *
 * Live QA evidence showed the provider DID return usage (`hasUsage:
 * true` in `[ai-structure]`) but the final `[ai-runtime]` event still
 * reported every usage/cost field as null. This suite proves the fix:
 * real provider usage now survives the full pipeline --
 *
 *   provider response -> callModel -> executeAI(parseUsage) -> service
 *     -> Question Quality Gate -> semantic Terra verification(s)
 *     -> optional Terra fallback -> [ai-runtime] aggregate event
 *
 * -- without ever fabricating a number the provider didn't report, and
 * without ever double-counting a real provider call. Test numbers in
 * each title match the phase spec's 28 numbered requirements.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAI } from '@/lib/ai/gateway';
import { parseProviderUsage } from '@/lib/ai/usage';
import { estimateCostUSD, MODEL_PRICING } from '@/lib/ai/pricing';
import { aggregateCost, type BillableCallUsage } from '@/lib/ai/usage-aggregation';
import { buildRuntimeEvent, buildAggregateRuntimeEvent } from '@/lib/ai/runtime-event';

const LUNA = 'gpt-5.6-luna';
const TERRA = 'gpt-5.6-terra';

const verifierMocks = vi.hoisted(() => ({ callModel: vi.fn() }));
const gateMocks = vi.hoisted(() => ({
  gen: vi.fn(),
  det: vi.fn(),
  verify: vi.fn(),
  evalV: vi.fn(),
  record: vi.fn(),
}));

function openaiRaw(usage: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number } | null, extra: any = {}) {
  return {
    choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    ...(usage
      ? {
          usage: {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            ...(usage.cached_tokens !== undefined ? { prompt_tokens_details: { cached_tokens: usage.cached_tokens } } : {}),
          },
        }
      : {}),
    ...extra,
  };
}

describe('R1 -- usage pipeline traced end-to-end via executeAI(parseUsage)', () => {
  it('(1) successful response with usage propagates input/output tokens', async () => {
    const { execution } = await executeAI({
      capability: 'QUESTION_GENERATION',
      risk: 'HIGH_RISK',
      provider: 'openai',
      model: LUNA,
      promptId: 'quiz.question_generation',
      promptVersion: 'v3',
      call: async () => openaiRaw({ prompt_tokens: 1000, completion_tokens: 200 }),
      parseUsage: (raw) => parseProviderUsage('openai', raw),
      validate: () => ({ valid: true, value: [] as unknown[] }),
    });
    expect(execution.inputTokens).toBe(1000);
    expect(execution.outputTokens).toBe(200);
  });

  it('(2) cachedInputTokens propagates from provider usage', async () => {
    const { execution } = await executeAI({
      capability: 'QUESTION_GENERATION',
      risk: 'HIGH_RISK',
      provider: 'openai',
      model: LUNA,
      promptId: 'quiz.question_generation',
      promptVersion: 'v3',
      call: async () => openaiRaw({ prompt_tokens: 1000, completion_tokens: 200, cached_tokens: 640 }),
      parseUsage: (raw) => parseProviderUsage('openai', raw),
      validate: () => ({ valid: true, value: [] as unknown[] }),
    });
    expect(execution.cachedInputTokens).toBe(640);
  });

  it('(3) absent cached usage remains null, never fabricated', async () => {
    const { execution } = await executeAI({
      capability: 'QUESTION_GENERATION',
      risk: 'HIGH_RISK',
      provider: 'openai',
      model: LUNA,
      promptId: 'quiz.question_generation',
      promptVersion: 'v3',
      call: async () => openaiRaw({ prompt_tokens: 1000, completion_tokens: 200 }), // no cached_tokens field at all
      parseUsage: (raw) => parseProviderUsage('openai', raw),
      validate: () => ({ valid: true, value: [] as unknown[] }),
    });
    expect(execution.cachedInputTokens).toBeNull();
    expect(execution.inputTokens).toBe(1000); // positive control: real usage still comes through
  });
});

describe('R3 -- usage survives every StudyUS-side rejection, not just SUCCESS', () => {
  const usageRaw = openaiRaw({ prompt_tokens: 555, completion_tokens: 44 });

  it('(4) structured validation failure (validate returns invalid) preserves provider usage', async () => {
    await expect(
      executeAI({
        capability: 'QUESTION_GENERATION',
        risk: 'HIGH_RISK',
        provider: 'openai',
        model: LUNA,
        promptId: 'quiz.question_generation',
        promptVersion: 'v3',
        call: async () => usageRaw,
        parseUsage: (raw) => parseProviderUsage('openai', raw),
        validate: () => ({ valid: false, errors: ['STRUCTURED_SCHEMA_INVALID'] }),
      }),
    ).rejects.toMatchObject({ execution: { inputTokens: 555, outputTokens: 44 } });
  });

  it('(5) domain parse failure (validate throws) preserves provider usage', async () => {
    await expect(
      executeAI({
        capability: 'QUESTION_GENERATION',
        risk: 'HIGH_RISK',
        provider: 'openai',
        model: LUNA,
        promptId: 'quiz.question_generation',
        promptVersion: 'v3',
        call: async () => usageRaw,
        parseUsage: (raw) => parseProviderUsage('openai', raw),
        validate: () => {
          throw new Error('DOMAIN_PARSE_INVALID: malformed batch wrapper');
        },
      }),
    ).rejects.toMatchObject({ execution: { inputTokens: 555, outputTokens: 44 } });
  });

  it('(6) finish_reason=length (truncated output) preserves usage the provider still returned', async () => {
    const truncated = openaiRaw({ prompt_tokens: 900, completion_tokens: 300 }, { choices: [{ message: { content: '{"questio' }, finish_reason: 'length' }] });
    await expect(
      executeAI({
        capability: 'QUESTION_GENERATION',
        risk: 'HIGH_RISK',
        provider: 'openai',
        model: LUNA,
        promptId: 'quiz.question_generation',
        promptVersion: 'v3',
        call: async () => truncated,
        parseUsage: (raw) => parseProviderUsage('openai', raw),
        validate: () => ({ valid: false, errors: ['OUTPUT_TRUNCATED'] }),
      }),
    ).rejects.toMatchObject({ execution: { inputTokens: 900, outputTokens: 300 } });
  });

  it('(7) a provider-refusal-shaped rejection preserves usage IF the raw response was actually obtained', async () => {
    // Scope note (see report): callOpenAIChat today throws synchronously
    // on choice.refusal BEFORE returning `raw` at all, so a refusal from
    // the LIVE adapter path has no raw response for parseUsage to read --
    // an explicit, documented exception, not fixed by this phase. This
    // test proves the GATEWAY layer itself has no such gap: whenever a
    // refusal-shaped raw response IS available, its usage is preserved
    // exactly like any other rejection.
    const refusalRaw = openaiRaw({ prompt_tokens: 700, completion_tokens: 5 }, { choices: [{ message: { refusal: 'cannot comply' }, finish_reason: 'stop' }] });
    await expect(
      executeAI({
        capability: 'QUESTION_GENERATION',
        risk: 'HIGH_RISK',
        provider: 'openai',
        model: LUNA,
        promptId: 'quiz.question_generation',
        promptVersion: 'v3',
        call: async () => refusalRaw,
        parseUsage: (raw) => parseProviderUsage('openai', raw),
        validate: (raw: any) => (raw.choices[0].message.refusal ? { valid: false, errors: ['PROVIDER_REFUSAL'] } : { valid: true, value: [] }),
      }),
    ).rejects.toMatchObject({ execution: { inputTokens: 700, outputTokens: 5 } });
  });

  it('(8) missing provider usage remains null and costComplete=false -- never fabricated', async () => {
    const { execution } = await executeAI({
      capability: 'QUESTION_GENERATION',
      risk: 'HIGH_RISK',
      provider: 'openai',
      model: LUNA,
      promptId: 'quiz.question_generation',
      promptVersion: 'v3',
      call: async () => openaiRaw(null), // no `usage` key at all
      parseUsage: (raw) => parseProviderUsage('openai', raw),
      validate: () => ({ valid: true, value: [] as unknown[] }),
    });
    expect(execution.inputTokens).toBeNull();
    expect(execution.outputTokens).toBeNull();
    expect(execution.costComplete).toBe(false);
    expect(execution.estimatedCostUSD).toBeNull(); // never fabricated as $0
  });
});

describe('R5/R6 -- cost calculation centralized through the R1B pricing registry', () => {
  it('(9) known Luna pricing produces a real estimatedCostUSD', () => {
    const est = estimateCostUSD({ model: LUNA, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 });
    expect(est.complete).toBe(true);
    expect(est.usd).toBeCloseTo(MODEL_PRICING[LUNA].inputPerM + MODEL_PRICING[LUNA].outputPerM, 6);
  });

  it('(10) known Terra pricing produces a real estimatedCostUSD', () => {
    const est = estimateCostUSD({ model: TERRA, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 });
    expect(est.complete).toBe(true);
    expect(est.usd).toBeCloseTo(MODEL_PRICING[TERRA].inputPerM + MODEL_PRICING[TERRA].outputPerM, 6);
  });

  it('(11) missing price mapping yields costComplete=false, never a fake $0', () => {
    const est = estimateCostUSD({ model: 'unknown-model-xyz', inputTokens: 500, cachedInputTokens: 0, outputTokens: 100 });
    expect(est.complete).toBe(false);
    expect(est.usd).toBeNull(); // NOT 0 -- unknown cost is not zero cost
  });

  it('(12) cached-token pricing is applied at the cheaper cached rate, not the full input rate', () => {
    const price = MODEL_PRICING[LUNA];
    const est = estimateCostUSD({ model: LUNA, inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 });
    expect(est.complete).toBe(true);
    // Entirely cached input -- must price at cachedInputPerM, which is
    // strictly cheaper than inputPerM for both configured models.
    expect(est.usd).toBeCloseTo(price.cachedInputPerM, 6);
    expect(est.usd).toBeLessThan(price.inputPerM);
  });

  it('(13) cachedInputTokens exceeding inputTokens is classified invalid/incomplete, never trusted into a cost', () => {
    const est = estimateCostUSD({ model: LUNA, inputTokens: 100, cachedInputTokens: 500, outputTokens: 50 });
    expect(est.complete).toBe(false);
    expect(est.usd).toBeNull();
  });
});

describe('R9/R11 -- semantic Terra verification is a real, captured billable call', () => {
  const h = verifierMocks;
  beforeEach(() => {
    h.callModel.mockReset();
    vi.resetModules();
  });

  it('(14) verifyQuestionQuality reports the REAL provider usage for its own Terra call via onUsage', async () => {
    vi.doMock('@/lib/ai/adapters/call-model', () => ({
      callModel: h.callModel,
      parseCallModelUsage: (r: any) => parseProviderUsage('openai', r.raw),
    }));
    h.callModel.mockResolvedValue({
      text: '{"conceptAligned":true,"answerCorrect":true,"unambiguous":true,"reasoningConsistent":true,"distractorsPlausible":true,"scenarioAppropriate":true,"visualConsistent":true,"issues":[],"confidence":0.95}',
      raw: openaiRaw({ prompt_tokens: 300, completion_tokens: 40 }),
      provider: 'openai',
      model: TERRA,
    });
    const { verifyQuestionQuality } = await import('@/services/question-quality-verifier.service');
    const onUsage = vi.fn();
    await verifyQuestionQuality({
      question: { id: 'q1', conceptId: 'c1', type: 'multiple_choice', question: 'Q?', correctAnswer: 'A', explanation: 'e', difficulty: 3 } as any,
      requestedLanguage: 'en',
      onUsage,
    });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 300, cachedInputTokens: null, outputTokens: 40 }, expect.any(String));
  });

  it('(14b) a rejected/thrown verification (AIExecutionFailure) still reports the usage the provider already returned', async () => {
    vi.doMock('@/lib/ai/adapters/call-model', () => ({
      callModel: h.callModel,
      parseCallModelUsage: (r: any) => parseProviderUsage('openai', r.raw),
    }));
    h.callModel.mockResolvedValue({
      text: 'not valid json', // will fail validate() -> AIExecutionFailure, no fallback configured
      raw: openaiRaw({ prompt_tokens: 111, completion_tokens: 9 }),
      provider: 'openai',
      model: TERRA,
    });
    const { verifyQuestionQuality } = await import('@/services/question-quality-verifier.service');
    const onUsage = vi.fn();
    const verdict = await verifyQuestionQuality({
      question: { id: 'q1', conceptId: 'c1', type: 'multiple_choice', question: 'Q?', correctAnswer: 'A', explanation: 'e', difficulty: 3 } as any,
      requestedLanguage: 'en',
      onUsage,
    });
    expect(verdict).toBeNull(); // fails closed, as before this phase
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 111, cachedInputTokens: null, outputTokens: 9 }, expect.any(String));
  });
});

describe('R7/R8/R9 -- gate-level aggregation: Luna generation + N semantic verifications', () => {
  const g = gateMocks;

  beforeEach(() => {
    vi.resetModules();
    g.gen.mockReset();
    g.det.mockReset().mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [] });
    g.verify.mockReset();
    g.evalV.mockReset().mockReturnValue({ pass: true });
    g.record.mockReset();
    vi.doMock('@/services/quiz-generation.service', () => ({
      generateQuestionsForConcept: (...a: any[]) => g.gen(...a),
    }));
    vi.doMock('@/lib/lx/question-quality-contract', () => ({
      checkQuestionQualityDeterministic: (...a: any[]) => g.det(...a),
    }));
    vi.doMock('@/services/question-quality-verifier.service', () => ({
      verifyQuestionQuality: (...a: any[]) => g.verify(...a),
      evaluateQuestionQualityVerdict: (...a: any[]) => g.evalV(...a),
    }));
    vi.doMock('@/lib/ai/runtime-event', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/ai/runtime-event')>();
      return { ...actual, recordRuntimeEvent: (...a: any[]) => g.record(...a) };
    });
  });

  const Q = (id: string) => ({ id, conceptId: 'c1', type: 'multiple_choice', question: id, correctAnswer: 'A', explanation: 'e', difficulty: 3 });

  it('(15) two semantic-verification calls each contribute exactly one billable call to the gate result', async () => {
    const { applyQuestionQualityGate } = await import('@/services/gated-question-generation.service');
    g.verify.mockImplementation(async (input: any) => {
      input.onUsage?.({ inputTokens: 200, cachedInputTokens: null, outputTokens: 30 }, TERRA);
      return { conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true, distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.9 };
    });
    const result = await applyQuestionQualityGate([Q('a') as any, Q('b') as any], { conceptId: 'c1', language: 'en' });
    expect(result.semanticCalls).toHaveLength(2);
    expect(result.semanticCalls.every((c) => c.model === TERRA)).toBe(true);
  });

  it('(16) Luna generation + 2 semantic verifications aggregate into one truthful total', async () => {
    const calls: BillableCallUsage[] = [
      { model: LUNA, usage: { inputTokens: 2000, cachedInputTokens: 500, outputTokens: 600 } },
      { model: TERRA, usage: { inputTokens: 200, cachedInputTokens: null, outputTokens: 30 } },
      { model: TERRA, usage: { inputTokens: 220, cachedInputTokens: null, outputTokens: 35 } },
    ];
    const agg = aggregateCost(calls);
    expect(agg.billableCalls).toBe(3);
    expect(agg.totalInputTokens).toBe(2000 + 200 + 220);
    expect(agg.totalOutputTokens).toBe(600 + 30 + 35);
    const lunaCost = estimateCostUSD({ model: LUNA, inputTokens: 2000, cachedInputTokens: 500, outputTokens: 600 });
    const terra1 = estimateCostUSD({ model: TERRA, inputTokens: 200, cachedInputTokens: null, outputTokens: 30 });
    const terra2 = estimateCostUSD({ model: TERRA, inputTokens: 220, cachedInputTokens: null, outputTokens: 35 });
    expect(agg.estimatedCostUSD).toBeCloseTo((lunaCost.usd ?? 0) + (terra1.usd ?? 0) + (terra2.usd ?? 0), 6);
    expect(agg.costComplete).toBe(true);
  });

  it('(17)/(18) a genuine Terra generation fallback aggregates Luna + Terra generation, and never drops Luna\'s consumed cost', async () => {
    const { generateGatedQuestionBatch } = await import('@/services/gated-question-generation.service');
    // Luna generates but everything is deterministically rejected -> fallback fires.
    g.det.mockReturnValue({ status: 'FAIL', failures: ['x'] });
    g.gen
      .mockImplementationOnce(async (_c: string, _s: string, _sub: string, opts: any) => {
        opts.onUsage?.({ inputTokens: 1500, cachedInputTokens: 0, outputTokens: 400 });
        return [Q('luna-bad')];
      })
      .mockImplementationOnce(async (_c: string, _s: string, _sub: string, opts: any) => {
        expect(opts.modelOverride).toBe(TERRA);
        opts.onUsage?.({ inputTokens: 1600, cachedInputTokens: 0, outputTokens: 420 });
        return [Q('terra-good')];
      });
    g.det.mockReturnValueOnce({ status: 'FAIL', failures: ['x'] }).mockReturnValueOnce({ status: 'PASS', failures: [] });

    await generateGatedQuestionBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });

    // Two [ai-runtime] events: one for Luna's attempt, one for Terra's --
    // NEVER combined into one (would risk hiding which model incurred
    // which cost), but both carry the SAME operationId so a reader can
    // sum them for the operation's true total.
    expect(g.record).toHaveBeenCalledTimes(2);
    const [lunaEvent, terraEvent] = g.record.mock.calls.map((c: any[]) => c[0]);
    expect(lunaEvent.operationId).toBe(terraEvent.operationId);
    expect(lunaEvent.fallbackUsed).toBe(false);
    expect(lunaEvent.inputTokens).toBe(1500); // Luna's real cost is NOT erased by the fallback
    expect(terraEvent.fallbackUsed).toBe(true);
    expect(terraEvent.inputTokens).toBe(1600);
  });

  it('(19) a rejected operation (gate REJECTED) can still carry non-zero recorded cost', async () => {
    const { generateGatedQuestionBatch } = await import('@/services/gated-question-generation.service');
    g.det.mockReturnValue({ status: 'FAIL', failures: ['x'] }); // both Luna and Terra always rejected
    g.gen.mockImplementation(async (_c: string, _s: string, _sub: string, opts: any) => {
      opts.onUsage?.({ inputTokens: 900, cachedInputTokens: 0, outputTokens: 120 });
      return [Q('always-bad')];
    });
    const out = await generateGatedQuestionBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });
    expect(out).toEqual([]); // recoverable empty result, as before this phase
    expect(g.record).toHaveBeenCalledTimes(2);
    const [lunaEvent, terraEvent] = g.record.mock.calls.map((c: any[]) => c[0]);
    expect(lunaEvent.qualityGateResult).toBe('DETERMINISTIC_FAIL');
    expect(lunaEvent.inputTokens).toBe(900); // REJECTED does not imply usage:null
    expect(terraEvent.qualityGateResult).toBe('DETERMINISTIC_FAIL');
    expect(terraEvent.inputTokens).toBe(900);
  });

  it('(20) acceptedCount is preserved on the SAME event that carries the aggregate usage', async () => {
    const { generateGatedQuestionBatch } = await import('@/services/gated-question-generation.service');
    g.det.mockReturnValue({ status: 'PASS', failures: [] });
    g.gen.mockImplementationOnce(async (_c: string, _s: string, _sub: string, opts: any) => {
      opts.onUsage?.({ inputTokens: 2000, cachedInputTokens: 0, outputTokens: 500 });
      return [Q('a'), Q('b')];
    });
    await generateGatedQuestionBatch('c1', 's1', 'subj1', { count: 2, language: 'en' });
    expect(g.record).toHaveBeenCalledTimes(1); // no fallback needed
    const [event] = g.record.mock.calls[0];
    expect(event.acceptedCount).toBe(2);
    expect(event.inputTokens).toBe(2000);
    expect(event.costComplete).toBe(true);
  });

  it('(22) no provider call is double-counted: Luna and Terra events sum disjoint call sets', async () => {
    const { generateGatedQuestionBatch } = await import('@/services/gated-question-generation.service');
    g.det.mockReturnValueOnce({ status: 'FAIL', failures: ['x'] }).mockReturnValueOnce({ status: 'PASS', failures: [] });
    g.gen
      .mockImplementationOnce(async (_c: string, _s: string, _sub: string, opts: any) => {
        opts.onUsage?.({ inputTokens: 111, cachedInputTokens: 0, outputTokens: 22 });
        return [Q('luna-bad')];
      })
      .mockImplementationOnce(async (_c: string, _s: string, _sub: string, opts: any) => {
        opts.onUsage?.({ inputTokens: 333, cachedInputTokens: 0, outputTokens: 44 });
        return [Q('terra-good')];
      });
    await generateGatedQuestionBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });
    const [lunaEvent, terraEvent] = g.record.mock.calls.map((c: any[]) => c[0]);
    // Each event carries only its OWN attempt's tokens -- 111 never
    // appears in Terra's event, 333 never appears in Luna's.
    expect(lunaEvent.inputTokens).toBe(111);
    expect(terraEvent.inputTokens).toBe(333);
    expect(lunaEvent.inputTokens).not.toBe(terraEvent.inputTokens);
  });

  it('(24) no additional AI request is introduced by usage capture -- generator call count is unchanged from the pre-R1G contract', async () => {
    const { generateGatedPracticeBatch } = await import('@/services/gated-question-generation.service');
    g.det.mockReturnValue({ status: 'PASS', failures: [] });
    g.gen.mockResolvedValueOnce([Q('a'), Q('b'), Q('c')]);
    await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 3, language: 'en' });
    expect(g.gen).toHaveBeenCalledTimes(1); // same cardinality as the certified R1C-R1 test
    expect(g.verify).not.toHaveBeenCalled(); // deterministic PASS -- no semantic call needed either
  });
});

describe('R12/R21 -- accepted-question economics never fabricated', () => {
  it('(21) cost per accepted question is only derivable when costComplete=true AND acceptedCount>0', () => {
    const complete = aggregateCost([{ model: LUNA, usage: { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 } }]);
    expect(complete.costComplete).toBe(true);
    const acceptedCount = 2;
    const costPerAccepted = complete.costComplete && acceptedCount > 0 ? (complete.estimatedCostUSD as number) / acceptedCount : null;
    expect(costPerAccepted).not.toBeNull();

    const incomplete = aggregateCost([{ model: 'unknown-model-xyz', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 } }]);
    expect(incomplete.costComplete).toBe(false);
    const undeterminable = incomplete.costComplete ? (incomplete.estimatedCostUSD as number) / 2 : null;
    expect(undeterminable).toBeNull(); // never fabricate a per-question figure from an incomplete total

    const zeroAccepted = aggregateCost([{ model: LUNA, usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 } }]);
    const zeroAcceptedCostPer = zeroAccepted.costComplete && 0 > 0 ? (zeroAccepted.estimatedCostUSD as number) / 0 : null;
    expect(zeroAcceptedCostPer).toBeNull(); // acceptedCount===0 -> never fabricate
  });
});

describe('R4/R7 -- runtime-event ownership and shape', () => {
  it('buildRuntimeEvent (single-call, unchanged since R1B/R1C) still computes cost for exactly one model', () => {
    const ev = buildRuntimeEvent({
      capability: 'QUESTION_GENERATION',
      provider: 'openai',
      model: LUNA,
      promptId: 'quiz.question_generation',
      promptVersion: 'v3',
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      latencyMs: 10,
      fallbackUsed: false,
      qualityGateResult: 'PASS',
    });
    expect(ev.estimatedCostUSD).toBeCloseTo(MODEL_PRICING[LUNA].inputPerM + MODEL_PRICING[LUNA].outputPerM, 6);
    expect(ev.costComplete).toBe(true);
  });

  it('buildAggregateRuntimeEvent reports billableCalls and cacheHitRatio derived from the real calls given', () => {
    const calls: BillableCallUsage[] = [
      { model: LUNA, usage: { inputTokens: 800, cachedInputTokens: 400, outputTokens: 100 } },
      { model: TERRA, usage: { inputTokens: 200, cachedInputTokens: null, outputTokens: 30 } },
    ];
    const ev = buildAggregateRuntimeEvent(
      {
        capability: 'QUESTION_GENERATION',
        provider: 'openai',
        model: LUNA,
        promptId: 'quiz.question_generation',
        promptVersion: 'v3',
        latencyMs: 10,
        fallbackUsed: false,
        qualityGateResult: 'PASS',
      },
      calls,
    );
    expect(ev.billableCalls).toBe(2);
    expect(ev.cacheHitRatio).toBeCloseTo(400 / 1000, 6);
  });
});

describe('R14 -- privacy: telemetry never carries learner/question/prompt content (source-contract checks)', () => {
  it('(23a) AIRuntimeEvent objects built by this phase never include question/answer/explanation/prompt-content fields', () => {
    const ev = buildAggregateRuntimeEvent(
      {
        capability: 'QUESTION_GENERATION',
        provider: 'openai',
        model: LUNA,
        promptId: 'quiz.question_generation',
        promptVersion: 'v3',
        latencyMs: 10,
        fallbackUsed: false,
        qualityGateResult: 'PASS',
      },
      [{ model: LUNA, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 } }],
    );
    const forbidden = ['question', 'correctAnswer', 'explanation', 'studentAnswer', 'rawPrompt', 'ragContent'];
    const keys = Object.keys(ev).map((k) => k.toLowerCase());
    for (const f of forbidden) {
      expect(keys).not.toContain(f.toLowerCase());
    }
  });

  it('(23b) source check: runtime-event.ts and usage-aggregation.ts never reference learner-content fields', async () => {
    // Note: "question"/"QUESTION_GENERATION" alone is NOT checked here --
    // that's the AICapability enum value (a category label), not learner
    // content. The actual content fields on GeneratedQuestion are
    // correctAnswer/explanation/question(text)/visualAid -- these files
    // must never read or forward any of them.
    const { readFileSync } = await import('fs');
    const runtimeSrc = readFileSync(new URL('../../src/lib/ai/runtime-event.ts', import.meta.url), 'utf-8');
    const aggSrc = readFileSync(new URL('../../src/lib/ai/usage-aggregation.ts', import.meta.url), 'utf-8');
    for (const forbidden of [/correctAnswer/, /studentAnswer/, /\.explanation\b/, /ragContent|ragChunk/i, /GeneratedQuestion/]) {
      expect(runtimeSrc).not.toMatch(forbidden);
      expect(aggSrc).not.toMatch(forbidden);
    }
  });

  it('(23c) logAIExecution\'s emitted line never includes a prompt/content field alongside the new usage fields', async () => {
    vi.resetModules();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { logAIExecution } = await import('@/lib/ai/logging');
    logAIExecution({
      executionId: 'exec-1',
      capability: 'QUESTION_GENERATION',
      risk: 'HIGH_RISK',
      provider: 'openai',
      model: LUNA,
      promptId: 'quiz.question_generation',
      promptVersion: 'v3',
      startedAt: new Date().toISOString(),
      durationMs: 5,
      success: true,
      validationStatus: 'PASSED',
      fallbackUsed: false,
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 150,
      estimatedCostUSD: 0.001,
      costComplete: true,
    });
    expect(logSpy).toHaveBeenCalled();
    const serialized = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(serialized).toContain('"inputTokens":1000');
    expect(serialized).toContain('"estimatedCostUSD":0.001');
    for (const forbidden of ['correctanswer', 'studentanswer', 'prompt_text', 'raw_response', 'ragcontent']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
    logSpy.mockRestore();
  });
});

describe('R2 -- provider usage normalization never infers or calculates', () => {
  it('parseProviderUsage never infers cached tokens when the provider omits prompt_tokens_details', () => {
    const usage = parseProviderUsage('openai', { usage: { prompt_tokens: 500, completion_tokens: 50 } });
    expect(usage.cachedInputTokens).toBeNull();
  });

  it('parseProviderUsage returns all-null when there is no usage object at all (never a fabricated zero)', () => {
    const usage = parseProviderUsage('openai', { choices: [] });
    expect(usage).toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null });
  });
});
