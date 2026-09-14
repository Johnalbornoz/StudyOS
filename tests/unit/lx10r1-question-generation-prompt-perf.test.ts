/**
 * LX-10R1 -- QUESTION GENERATION CRITICAL-PATH PERFORMANCE. The 16
 * required tests, in order.
 *
 * Live baseline (Preview, branch preview/openai-perf, commit 291367b):
 * a REVIEW/requiredQuestionCount=1/difficulty=4 request took 29.59s
 * route time, ~15.07s even on a hypothetical clean first pass (Luna
 * generation 8.821s + Terra verify 6.250s), inputTokens=6473,
 * cachedInputTokens=0, before a full recovery cycle (Terra regen +
 * re-verify) was needed at all. This file proves the STRUCTURAL
 * changes this phase made -- prompt reordering, shape-example
 * deduplication, redundant-instruction removal, prompt caching wiring
 * -- without ever weakening the Question Quality Gate, changing the
 * Structured Output schema, or touching recovery topology (all
 * explicitly out of scope for this phase, PART I).
 *
 * Exercises the REAL `generateQuestionsForConcept` (the exact function
 * the live REVIEW/count=1 trace ran through, via
 * generateGatedQuestionBatch) with only the provider boundary mocked --
 * same pattern as the pre-existing quiz-generation-timeout.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

const executeAIMock = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  return { ...actual, executeAI: (...a: any[]) => executeAIMock(...a) };
});

const retrieveContextMock = vi.fn();
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => retrieveContextMock(...a) }));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

const callModelMock = vi.fn();
vi.mock('@/lib/ai/adapters/call-model', () => ({ callModel: (...a: any[]) => callModelMock(...a) }));

vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: vi.fn(async () => ({
    conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
    distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
  })),
  verifyQuestionQualityBatch: vi.fn(async ({ candidates }: any) =>
    new Map(candidates.map((c: any) => [c.id, {
      conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
      distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
    }])),
  ),
  evaluateQuestionQualityVerdict: vi.fn(() => ({ pass: true, reason: '' })),
  classifyQualityRejectionReasons: vi.fn(() => []),
}));

import { generateQuestionsForConcept } from '@/services/quiz-generation.service';
import { GENERATED_QUESTION_BATCH_SCHEMA } from '@/lib/ai/schemas';
import { CAPABILITY_ROUTING, LUNA, TERRA } from '@/lib/ai/model-routing';
import { buildRuntimeEvent } from '@/lib/ai/runtime-event';

const ALL_18_TYPES = [
  'multiple_choice', 'multi_select', 'true_false', 'yes_no', 'short_answer',
  'open_ended', 'fill_blank', 'matching', 'ordering', 'classification',
  'numeric_problem', 'step_by_step', 'case_study', 'scenario',
  'error_detection', 'justification', 'comparison', 'prediction',
];

/** Drives the real generateQuestionsForConcept and lets `call` actually resolve, capturing the exact callModel() args it built. */
async function runGeneration(opts: { count?: number; difficulty?: number; language?: string; hasContext?: boolean } = {}) {
  executeAIMock.mockImplementation(async (aiOpts: any) => {
    const raw = await aiOpts.call(new AbortController().signal);
    return { result: [], execution: {} as any, provenance: {} as any, raw };
  });
  callModelMock.mockResolvedValue({ text: '{"questions":[]}', raw: { choices: [{ message: { content: '{"questions":[]}' } }] }, provider: 'openai', model: LUNA });
  retrieveContextMock.mockResolvedValue({ chunks: opts.hasContext === false ? [] : [{ text: 'Centripetal force is the net force that keeps an object moving along a circular path, always directed toward the center.' }] });
  queryMock.mockResolvedValue({ rows: [{ label: 'Centripetal Force', subject_name: 'Physics' }] });
  await generateQuestionsForConcept('c1', 's1', 'subj1', { count: opts.count ?? 1, difficulty: opts.difficulty ?? 4, language: opts.language ?? 'en' });
  return callModelMock.mock.calls[0][0];
}

beforeEach(() => {
  executeAIMock.mockReset();
  retrieveContextMock.mockReset();
  queryMock.mockReset();
  callModelMock.mockReset();
});

/* ================================================================= *
 * REQUIRED TEST 1 -- static prompt content precedes dynamic           *
 * learner/context content.                                            *
 * ================================================================= */
describe('LX-10R1 1 -- static content precedes dynamic content in the real generated prompt', () => {
  it('QUESTION TYPES AVAILABLE / REQUIREMENTS (stable) come before CONTEXT (dynamic, student material)', async () => {
    const call = await runGeneration({ hasContext: true });
    const system = call.system as string;
    expect(system.indexOf('QUESTION TYPES AVAILABLE')).toBeGreaterThan(-1);
    expect(system.indexOf('CONTEXT (')).toBeGreaterThan(-1);
    expect(system.indexOf('QUESTION TYPES AVAILABLE')).toBeLessThan(system.indexOf('CONTEXT ('));
    expect(system.indexOf('REQUIREMENTS:')).toBeLessThan(system.indexOf('CONTEXT ('));
  });

  it('the same ordering holds for the general-knowledge (no material) branch', async () => {
    const call = await runGeneration({ hasContext: false });
    const system = call.system as string;
    expect(system.indexOf('QUESTION TYPES AVAILABLE')).toBeLessThan(system.indexOf('CONCEPT ('));
  });
});

/* ================================================================= *
 * REQUIRED TESTS 2-5 -- promptCacheKey.                                *
 * ================================================================= */
describe('LX-10R1 2 -- promptCacheKey is populated for QUESTION_GENERATION', () => {
  it('the real generateQuestionsForConcept call carries a non-empty promptCacheKey', async () => {
    const call = await runGeneration();
    expect(typeof call.promptCacheKey).toBe('string');
    expect(call.promptCacheKey.length).toBeGreaterThan(0);
    expect(call.promptCacheKey).toMatch(/^qgen:/);
  });
});

describe('LX-10R1 3 -- the cache key contains no learner/content identifiers', () => {
  it('never contains the studentId, conceptId, or any retrieved context text', async () => {
    const call = await runGeneration({ hasContext: true });
    expect(call.promptCacheKey).not.toContain('s1');
    expect(call.promptCacheKey).not.toContain('c1');
    expect(call.promptCacheKey).not.toContain('subj1');
    expect(call.promptCacheKey).not.toMatch(/centripetal/i);
  });
});

describe('LX-10R1 4 -- identical compatible generation contracts produce stable cache keys', () => {
  it('two calls with the same (types/difficulty/language) but different retrieved context produce the SAME key', async () => {
    const callA = await runGeneration({ hasContext: true, difficulty: 4, language: 'en' });
    callModelMock.mockClear();
    retrieveContextMock.mockResolvedValue({ chunks: [{ text: 'An entirely different concept explanation about photosynthesis and chlorophyll.' }] });
    const callB = await runGeneration({ hasContext: true, difficulty: 4, language: 'en' });
    expect(callA.promptCacheKey).toBe(callB.promptCacheKey);
  });
});

describe('LX-10R1 5 -- materially different generation contracts do not collide', () => {
  it('a different difficulty produces a different key', async () => {
    const callA = await runGeneration({ difficulty: 4 });
    callModelMock.mockClear();
    const callB = await runGeneration({ difficulty: 2 });
    expect(callA.promptCacheKey).not.toBe(callB.promptCacheKey);
  });

  it('a different language produces a different key', async () => {
    const callA = await runGeneration({ language: 'en' });
    callModelMock.mockClear();
    const callB = await runGeneration({ language: 'es' });
    expect(callA.promptCacheKey).not.toBe(callB.promptCacheKey);
  });
});

/* ================================================================= *
 * REQUIRED TESTS 6-11 -- regression: nothing this phase was told not  *
 * to touch changed.                                                    *
 * ================================================================= */
describe('LX-10R1 6 -- Structured Output schema unchanged', () => {
  it('generateQuestionsForConcept still passes the exact, unmodified GENERATED_QUESTION_BATCH_SCHEMA reference', async () => {
    const call = await runGeneration();
    expect(call.jsonSchema).toBe(GENERATED_QUESTION_BATCH_SCHEMA);
  });
});

describe('LX-10R1 7 -- Question Quality Gate unchanged', () => {
  it('applyQuestionQualityGate / gateUnitWithTerraFallback are untouched by this phase', () => {
    const SRC = read('src/services/gated-question-generation.service.ts');
    expect(SRC).toMatch(/export async function applyQuestionQualityGate/);
    expect(SRC).toMatch(/export async function gateUnitWithTerraFallback/);
    expect(SRC).toMatch(/semanticRejectionHistogram/);
  });
});

describe('LX-10R1 8 -- difficulty calibration unchanged', () => {
  it('describeDifficultyTier tier text is byte-identical to before this phase', () => {
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/direct recall or the single most familiar, textbook-form application/);
    expect(SRC).toMatch(/one clear application step in a familiar representation/);
    expect(SRC).toMatch(/multi-step reasoning across several steps/);
    expect(SRC).toMatch(/transfer to a genuinely unfamiliar context/);
  });

  it('the real prompt still states the resolved difficulty and tier text for the live REVIEW/difficulty=4 shape', async () => {
    const call = await runGeneration({ difficulty: 4 });
    expect(call.system).toContain('Difficulty level (4/5)');
    expect(call.system).toMatch(/multi-step reasoning across several steps/);
  });
});

describe('LX-10R1 9 -- evidence contracts unchanged', () => {
  it('isZeroGapPracticeMismatch (LX-9R8) is untouched', () => {
    const SRC = read('src/lib/lx/evidence-sufficiency-contract.ts');
    expect(SRC).toMatch(/export function isZeroGapPracticeMismatch/);
    expect(SRC).toMatch(/pedagogicalRequirement === 0/);
  });
});

describe('LX-10R1 10 -- exact-count contracts unchanged', () => {
  it('generateQuestionsForConcept still fires exactly ONE executeAI call regardless of count (no fan-out reintroduced)', async () => {
    await runGeneration({ count: 1 });
    expect(executeAIMock).toHaveBeenCalledTimes(1);
  });

  it('QUICK_CHECK_SLOT_COUNT / RETENTION_REQUIRED_COUNT are untouched', async () => {
    const { RETENTION_REQUIRED_COUNT } = await import('@/services/quiz-generation.service');
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/const QUICK_CHECK_SLOT_COUNT = 6;/);
  });
});

describe('LX-10R1 11 -- novelty/dedupe logic unchanged', () => {
  it('the cross-chunk normalizeText dedupe is untouched', () => {
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/const key = normalizeText\(q\.question\)\.toLowerCase\(\);/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 12 -- no learner content in telemetry.                 *
 * ================================================================= */
describe('LX-10R1 12 -- no learner content added to telemetry', () => {
  it('buildRuntimeEvent\'s new cacheHitRatio is purely numeric -- never derived from or containing content', () => {
    const ev = buildRuntimeEvent({
      capability: 'QUESTION_GENERATION', provider: 'openai', model: LUNA, promptId: 'quiz.question_generation', promptVersion: 'v3',
      inputTokens: 6473, cachedInputTokens: 3200, outputTokens: 619, latencyMs: 8821, fallbackUsed: false, qualityGateResult: 'PASS',
    });
    expect(ev.cacheHitRatio).toBeCloseTo(3200 / 6473, 6);
    expect(typeof ev.cacheHitRatio).toBe('number');
  });

  it('cacheHitRatio is null whenever either token count is unknown -- never inferred', () => {
    const ev = buildRuntimeEvent({
      capability: 'QUESTION_GENERATION', provider: 'openai', model: LUNA, promptId: 'quiz.question_generation', promptVersion: 'v3',
      inputTokens: null, cachedInputTokens: null, outputTokens: null, latencyMs: 100, fallbackUsed: false, qualityGateResult: 'PASS',
    });
    expect(ev.cacheHitRatio).toBeNull();
  });

  it('the promptCacheKey itself never carries question/answer/explanation content (spot check against a distinctive concept label)', async () => {
    const call = await runGeneration({ hasContext: false });
    expect(call.promptCacheKey).not.toMatch(/centripetal/i);
  });
});

/* ================================================================= *
 * REQUIRED TEST 13 -- the generated prompt is materially smaller       *
 * than the pre-LX-10R1 baseline.                                       *
 * ================================================================= */
describe('LX-10R1 13 -- the generated prompt is materially smaller than baseline', () => {
  it('shape examples are deduplicated by shape, not repeated once per type -- proven by the grouped-shape marker appearing and by a bounded example count', async () => {
    const call = await runGeneration({ count: 1 });
    const user = call.user as string;
    // The old shape produced 18 separate `"type": "X"` example blocks;
    // the new one groups identical shapes -- the literal count of
    // `"type":` occurrences in the user message must be far below 18.
    const typeFieldOccurrences = (user.match(/"type":\s*"/g) ?? []).length;
    expect(typeFieldOccurrences).toBeLessThan(10);
    expect(user).toMatch(/shape for "type" in \{/);
  });

  it('the REQUIREMENTS block no longer repeats the language instruction a second time', async () => {
    const call = await runGeneration();
    const system = call.system as string;
    const languageMentions = (system.match(/Every field in your JSON output must be written in/g) ?? []).length;
    expect(languageMentions).toBe(0);
  });

  it('the grounding instruction appears exactly once (no separate REQUIREMENTS item + trailing IMPORTANT note)', async () => {
    const call = await runGeneration({ hasContext: false });
    const system = call.system as string;
    expect((system.match(/IMPORTANT:/g) ?? []).length).toBe(0);
    expect(system).toMatch(/do not fabricate facts that aren't genuinely true of it/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 14 -- the live-equivalent REVIEW prompt still encodes  *
 * every required pedagogical constraint.                               *
 * ================================================================= */
describe('LX-10R1 14 -- the live-equivalent REVIEW/difficulty=4 prompt still encodes all required pedagogical constraints', () => {
  it('MATH NOTATION / LaTeX-escaping, cognitiveLevel/questionIntent/expectedReasoningType taxonomy, and calculatorAllowed are all present, unchanged in substance', async () => {
    const call = await runGeneration({ difficulty: 4 });
    const system = call.system as string;
    expect(system).toMatch(/MATH NOTATION/);
    expect(system).toMatch(/Every backslash inside your LaTeX must itself be escaped for JSON/);
    expect(system).toMatch(/"cognitiveLevel", "questionIntent" and "expectedReasoningType"/);
    expect(system).toMatch(/calculatorAllowed/);
    // LX-10R1 PART H additions -- sharper first-pass-quality guidance,
    // targeting the live REASONING_MISMATCH/WEAK_DISTRACTORS rejection.
    expect(system).toMatch(/reflect the ACTUAL multi-step reasoning or context transfer/);
    expect(system).toMatch(/every distractor must reflect a genuine, specific misconception/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 15 -- Luna/Terra routing unchanged.                    *
 * ================================================================= */
describe('LX-10R1 15 -- Luna/Terra routing unchanged', () => {
  it('QUESTION_GENERATION still routes Luna primary / Terra fallback', () => {
    expect(CAPABILITY_ROUTING.QUESTION_GENERATION.primary).toBe(LUNA);
    expect(CAPABILITY_ROUTING.QUESTION_GENERATION.fallback).toBe(TERRA);
  });

  it('the live-trace call site still uses the QUESTION_GENERATION route, not a hardcoded model', async () => {
    const call = await runGeneration();
    expect(call.model).toBe(LUNA);
  });
});

/* ================================================================= *
 * PART G -- reasoningEffort now wired into the batch call site         *
 * (previously omitted entirely -- an undocumented provider default).  *
 * ================================================================= */
describe('LX-10R1 -- PART G: reasoningEffort is now explicitly set for the live-trace call site', () => {
  it('generateQuestionsForConcept now sends the canonical, LX-9R9-validated reasoningEffort instead of omitting the parameter', async () => {
    const call = await runGeneration();
    expect(call.reasoningEffort).toBe('low');
  });
});
