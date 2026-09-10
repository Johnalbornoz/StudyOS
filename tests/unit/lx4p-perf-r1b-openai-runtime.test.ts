/**
 * LX-4P-PERF-R1B -- OpenAI quality-gated runtime infrastructure.
 *
 * Everything here runs WITHOUT provider credentials: pure routing /
 * budgets / usage parsing / pricing / the deterministic quality contract,
 * plus the fail-closed pipeline with `executeAI` mocked. Live provider
 * behaviour (Luna/Terra output quality, TTFI, cost) is NOT covered --
 * see the report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CAPABILITY_ROUTING, resolveModels, isAnthropicModel, LUNA, TERRA } from '@/lib/ai/model-routing';
import { TOKEN_BUDGETS, budgetFor, fitContextChunks } from '@/lib/ai/token-budgets';
import { parseProviderUsage } from '@/lib/ai/usage';
import { estimateCostUSD, MODEL_PRICING } from '@/lib/ai/pricing';
import { buildRuntimeEvent } from '@/lib/ai/runtime-event';
import { checkQuestionQualityDeterministic } from '@/lib/lx/question-quality-contract';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

/* ---------- B1: capability routing ---------- */
describe('LX-4P-PERF-R1B B1 -- central capability -> model routing', () => {
  it('every canonical learner-runtime capability routes to OpenAI (never anthropic)', () => {
    for (const [cap, route] of Object.entries(CAPABILITY_ROUTING)) {
      expect(route.provider, cap).toBe('openai');
      expect(isAnthropicModel(route.primary), `${cap}.primary`).toBe(false);
      expect(isAnthropicModel(route.fallback), `${cap}.fallback`).toBe(false);
    }
  });
  it('generation + content -> Luna primary, Terra fallback', () => {
    expect(resolveModels('QUESTION_GENERATION')).toMatchObject({ provider: 'openai', primary: LUNA, fallback: TERRA });
    expect(resolveModels('CONTENT_GENERATION')).toMatchObject({ primary: LUNA, fallback: TERRA });
  });
  it('evaluation / grading -> the stronger model (Terra), not routed to Luna for savings', () => {
    expect(resolveModels('EXPLANATION_EVALUATION').primary).toBe(TERRA);
    expect(resolveModels('GRADING').primary).toBe(TERRA);
    expect(resolveModels('TRANSFER_EVALUATION').primary).toBe(TERRA);
  });
  it('no Sonnet / Claude id appears anywhere in the routing table', () => {
    const json = JSON.stringify(CAPABILITY_ROUTING);
    expect(json).not.toMatch(/claude/i);
    expect(json).not.toMatch(/sonnet/i);
    expect(json).not.toMatch(/haiku/i);
  });
});

/* ---------- B7: token budgets ---------- */
describe('LX-4P-PERF-R1B B7 -- explicit per-capability token budgets', () => {
  it('every named purpose has a bounded output budget', () => {
    for (const [k, b] of Object.entries(TOKEN_BUDGETS)) {
      expect(b.maxOutputTokens, k).toBeGreaterThan(0);
      expect(b.maxOutputTokens, k).toBeLessThanOrEqual(6000);
    }
    expect(budgetFor('contextual_help').maxOutputTokens).toBeLessThanOrEqual(900); // "short"
    expect(budgetFor('semantic_verification').maxContextChars).toBe(0); // verdict only, no RAG
  });
  it('fitContextChunks truncates deterministically and never below one chunk', () => {
    const chunks = [{ text: 'a'.repeat(100) }, { text: 'b'.repeat(100) }, { text: 'c'.repeat(100) }];
    expect(fitContextChunks(chunks, 250)).toHaveLength(2);
    expect(fitContextChunks(chunks, 10)).toHaveLength(1); // never zero
    expect(fitContextChunks(chunks, 0)).toHaveLength(0); // 0 budget = no context (verifier)
  });
});

/* ---------- B12: usage parsing (actual, never fabricated) ---------- */
describe('LX-4P-PERF-R1B B12 -- provider usage parsing', () => {
  it('OpenAI: prompt / cached / completion tokens', () => {
    const u = parseProviderUsage('openai', {
      usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 800 } },
    });
    expect(u).toEqual({ inputTokens: 1200, cachedInputTokens: 800, outputTokens: 300 });
  });
  it('Anthropic: fresh + cache-read input summed', () => {
    const u = parseProviderUsage('anthropic', { usage: { input_tokens: 400, cache_read_input_tokens: 600, output_tokens: 150 } });
    expect(u).toEqual({ inputTokens: 1000, cachedInputTokens: 600, outputTokens: 150 });
  });
  it('missing usage -> all null, never a guess', () => {
    expect(parseProviderUsage('openai', {})).toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null });
    expect(parseProviderUsage('openai', null)).toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null });
  });
});

/* ---------- B12: pricing is configured, not billing truth ---------- */
describe('LX-4P-PERF-R1B B12 -- cost estimate', () => {
  it('with the $0 default table the estimate is not "complete" and says so', () => {
    const c = estimateCostUSD({ model: LUNA, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500 });
    expect(c.usd).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.note).toMatch(/configure MODEL_PRICING/);
  });
  it('with no provider usage -> null, not 0', () => {
    const c = estimateCostUSD({ model: LUNA, inputTokens: null, cachedInputTokens: null, outputTokens: null });
    expect(c.usd).toBeNull();
    expect(c.complete).toBe(false);
  });
  it('a configured price yields a real number', () => {
    MODEL_PRICING['test-model'] = { inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 2 };
    const c = estimateCostUSD({ model: 'test-model', inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 500_000 });
    // fresh 800k * $1/M + cached 200k * $0.1/M + out 500k * $2/M
    expect(c.usd).toBeCloseTo(0.8 + 0.02 + 1.0, 6);
    expect(c.complete).toBe(true);
    delete MODEL_PRICING['test-model'];
  });
});

/* ---------- B3/B4: deterministic question quality contract ---------- */
const goodMC: GeneratedQuestion = {
  id: 'q1', conceptId: 'c1', type: 'multiple_choice', answerFormat: 'single_choice',
  question: 'Which is the SI unit of force?',
  options: [{ id: 'A', text: 'newton' }, { id: 'B', text: 'joule' }, { id: 'C', text: 'watt' }, { id: 'D', text: 'pascal' }],
  correctAnswer: 'A', explanation: 'Force is measured in newtons.', difficulty: 2,
  cognitiveLevel: 'RECALL', expectedReasoningType: 'FACTUAL',
};

describe('LX-4P-PERF-R1B B3/B4 -- deterministic quality gate', () => {
  it('a structurally sound MC question passes the deterministic checks (semantic left for distractors)', () => {
    const r = checkQuestionQualityDeterministic(goodMC, { conceptId: 'c1' });
    expect(r.failures).toEqual([]);
    // distractor plausibility still needs a judge -> not a bare PASS
    expect(r.status).toBe('NOT_DETERMINISTICALLY_VERIFIED');
    expect(r.needsSemantic).toContain('distractor plausibility');
  });
  it('missing required field -> FAIL', () => {
    const r = checkQuestionQualityDeterministic({ ...goodMC, correctAnswer: '' }, { conceptId: 'c1' });
    expect(r.status).toBe('FAIL');
    expect(r.failures.map((f) => f.code)).toEqual(expect.arrayContaining(['MISSING_FIELD']));
  });
  it('answer-format mismatch -> FAIL', () => {
    const r = checkQuestionQualityDeterministic({ ...goodMC, answerFormat: 'text' }, { conceptId: 'c1' });
    expect(r.failures.map((f) => f.code)).toContain('ANSWER_FORMAT_MISMATCH');
  });
  it('bad cognitiveLevel / reasoningType / difficulty -> FAIL', () => {
    const r = checkQuestionQualityDeterministic(
      { ...goodMC, cognitiveLevel: 'WISDOM' as any, expectedReasoningType: 'VIBES' as any, difficulty: 9 },
      { conceptId: 'c1' },
    );
    const codes = r.failures.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['COGNITIVE_LEVEL_INVALID', 'REASONING_TYPE_INVALID', 'DIFFICULTY_OUT_OF_RANGE']));
  });
  it('concept mismatch -> FAIL', () => {
    expect(checkQuestionQualityDeterministic(goodMC, { conceptId: 'OTHER' }).failures.map((f) => f.code)).toContain('CONCEPT_MISMATCH');
  });
  it('single_choice with a correctAnswer that is not exactly one valid id -> FAIL', () => {
    expect(checkQuestionQualityDeterministic({ ...goodMC, correctAnswer: 'A,B' }, { conceptId: 'c1' }).failures.map((f) => f.code)).toContain('SINGLE_CHOICE_NOT_EXACTLY_ONE');
    expect(checkQuestionQualityDeterministic({ ...goodMC, correctAnswer: 'Z' }, { conceptId: 'c1' }).failures.map((f) => f.code)).toContain('SINGLE_CHOICE_NOT_EXACTLY_ONE');
  });
  it('duplicate option text -> FAIL', () => {
    const dup = { ...goodMC, options: [{ id: 'A', text: 'newton' }, { id: 'B', text: 'Newton' }, { id: 'C', text: 'watt' }, { id: 'D', text: 'pascal' }] };
    expect(checkQuestionQualityDeterministic(dup, { conceptId: 'c1' }).failures.map((f) => f.code)).toContain('OPTION_TEXT_DUPLICATE');
  });
  it('numeric recompute: MATCH is actually verified, MISMATCH is a FAIL', () => {
    const match: GeneratedQuestion = { id: 'n1', conceptId: 'c1', type: 'numeric_problem', answerFormat: 'text', question: 'Compute 0.5 * 16.', correctAnswer: '8', explanation: '.', difficulty: 2 };
    const rm = checkQuestionQualityDeterministic(match, { conceptId: 'c1' });
    expect(rm.numericallyVerified).toBe(true);
    const bad = { ...match, correctAnswer: '9' };
    expect(checkQuestionQualityDeterministic(bad, { conceptId: 'c1' }).failures.map((f) => f.code)).toContain('NUMERIC_ANSWER_MISMATCH');
  });
  it('B11 visual: unsupported kind / label-value mismatch -> FAIL', () => {
    const badKind = { ...goodMC, visualAid: { kind: 'force_diagram' as any } };
    expect(checkQuestionQualityDeterministic(badKind, { conceptId: 'c1' }).failures.map((f) => f.code)).toContain('VISUAL_UNSUPPORTED');
    const badChart = { ...goodMC, visualAid: { kind: 'chart' as const, chartData: { chartType: 'bar' as const, labels: ['a', 'b'], values: [1] } } };
    expect(checkQuestionQualityDeterministic(badChart, { conceptId: 'c1' }).failures.map((f) => f.code)).toContain('VISUAL_INCONSISTENT');
  });
});

/* ---------- B12: runtime event ---------- */
describe('LX-4P-PERF-R1B B12 -- runtime event carries a cost estimate', () => {
  it('buildRuntimeEvent attaches estimatedCostUSD + costComplete', () => {
    const ev = buildRuntimeEvent({
      capability: 'QUESTION_GENERATION', provider: 'openai', model: LUNA, promptId: 'quiz.question_generation', promptVersion: 'v3',
      inputTokens: 1000, cachedInputTokens: 0, outputTokens: 200, latencyMs: 4200, fallbackUsed: false, qualityGateResult: 'PASS',
    });
    expect(ev).toHaveProperty('estimatedCostUSD');
    expect(ev).toHaveProperty('costComplete', false); // $0 table
  });
});

/* ---------- B5/B6/B11/B24: fail-closed pipeline (executeAI mocked) ---------- */
vi.mock('@/lib/ai/gateway', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, executeAI: vi.fn() };
});
// eslint-disable-next-line import/first
import { executeAI } from '@/lib/ai/gateway';
// eslint-disable-next-line import/first
import { generateWithQualityGate, type GatedGenerationSpec } from '@/lib/ai/quality-runtime';
// eslint-disable-next-line import/first
import { AIExecutionError } from '@/lib/ai/errors';

const baseSpec = (over: Partial<GatedGenerationSpec<{ v: number }>> = {}): GatedGenerationSpec<{ v: number }> => ({
  capability: 'QUESTION_GENERATION',
  risk: 'HIGH_RISK',
  budgetKey: 'question_generation_practice',
  promptId: 'quiz.question_generation',
  promptVersion: 'v3',
  systemPrompt: 'rules + schema',
  buildUserMessage: () => 'make it',
  jsonSchema: { name: 'x', schema: { type: 'object' } },
  parse: (t) => { try { return JSON.parse(t); } catch { return null; } },
  deterministicGate: (v) => ({ pass: v.v > 0, reason: 'v must be > 0' }),
  ...over,
});

describe('LX-4P-PERF-R1B B5/B6 -- fail-closed Luna -> Terra pipeline', () => {
  beforeEach(() => vi.mocked(executeAI).mockReset());

  it('Luna passes the gate -> accepted, no fallback, no second call', async () => {
    vi.mocked(executeAI).mockResolvedValueOnce({ result: { v: 1 }, execution: {} as any, provenance: {} as any });
    const r = await generateWithQualityGate(baseSpec());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.routing).toMatchObject({ model: LUNA, fallbackUsed: false, qualityGateResult: 'PASS' });
    expect(executeAI).toHaveBeenCalledTimes(1);
  });

  it('Luna fails the deterministic gate -> ONE Terra attempt -> accepted with fallbackReason', async () => {
    vi.mocked(executeAI)
      .mockResolvedValueOnce({ result: { v: 0 }, execution: {} as any, provenance: {} as any }) // Luna: gate fails
      .mockResolvedValueOnce({ result: { v: 5 }, execution: {} as any, provenance: {} as any }); // Terra: ok
    const r = await generateWithQualityGate(baseSpec());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.routing).toMatchObject({ model: TERRA, fallbackUsed: true, qualityGateResult: 'PASS' });
    expect(r.ok && r.routing.fallbackReason).toMatch(/v must be > 0/);
    expect(executeAI).toHaveBeenCalledTimes(2);
  });

  it('Terra also fails -> REJECTED, fail-closed, never a third attempt', async () => {
    vi.mocked(executeAI)
      .mockResolvedValueOnce({ result: { v: 0 }, execution: {} as any, provenance: {} as any })
      .mockResolvedValueOnce({ result: { v: -1 }, execution: {} as any, provenance: {} as any });
    const r = await generateWithQualityGate(baseSpec());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.routing).toMatchObject({ fallbackUsed: true, qualityGateResult: 'REJECTED' });
    expect(executeAI).toHaveBeenCalledTimes(2);
  });

  it('semantic verifier failure escalates to Terra, then fails closed', async () => {
    vi.mocked(executeAI)
      .mockResolvedValueOnce({ result: { v: 1 }, execution: {} as any, provenance: {} as any })
      .mockResolvedValueOnce({ result: { v: 1 }, execution: {} as any, provenance: {} as any });
    const spec = baseSpec({ semanticVerify: async () => ({ pass: false, reason: 'AMBIGUOUS' }) });
    const r = await generateWithQualityGate(spec);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.routing.fallbackReason).toMatch(/AMBIGUOUS/);
  });

  it('a primary provider error escalates to Terra (still openai), then fails closed', async () => {
    vi.mocked(executeAI)
      .mockResolvedValueOnce({ result: { v: 0 }, execution: {} as any, provenance: {} as any }) // Luna gate fail
      .mockResolvedValueOnce({ result: { v: 0 }, execution: {} as any, provenance: {} as any }); // Terra gate fail
    const r = await generateWithQualityGate(baseSpec());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.routing.provider).toBe('openai'); // never anthropic
    expect(executeAI).toHaveBeenCalledTimes(2); // Luna then Terra, no 3rd
  });
});

/* ---------- B24: no silent Anthropic fallback ---------- */
describe('LX-4P-PERF-R1B B24 -- OpenAI is required; failure is explicit, never an Anthropic switch', () => {
  it('the routing table has no path to anthropic for any canonical capability', () => {
    for (const route of Object.values(CAPABILITY_ROUTING)) expect(route.provider).toBe('openai');
  });
  it('callOpenAIChat throws CONFIGURATION_ERROR (not a silent fallthrough) when OPENAI_API_KEY is unset', async () => {
    const { callOpenAIChat } = await import('@/lib/ai/adapters/openai');
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(
        callOpenAIChat({ model: LUNA, messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    } finally {
      if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
    }
  });
  it('the quality runtime never imports an Anthropic adapter', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(process.cwd(), 'src/lib/ai/quality-runtime.ts'), 'utf-8');
    expect(src).not.toMatch(/from '.*adapters\/anthropic'/);
    expect(src).not.toMatch(/callAnthropicMessages/);
    // provider is only ever 'openai' in the pipeline
    expect(src).not.toMatch(/provider: 'anthropic'/);
  });
});
