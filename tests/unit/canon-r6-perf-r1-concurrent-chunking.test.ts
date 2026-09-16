/**
 * CANON-R6-PERF-R1 -- CONCURRENT CHUNKING FOR CANONICAL PROVE.
 *
 * CANON-R6-PERF-I1's own live summary confirmed the observed ~48-64s
 * canonical_prove latency was ONE monolithic exact-10
 * generateGatedQuestionBatch invocation's own serial Luna -> semantic-
 * verify -> Terra-SHORT-fallback -> semantic-verify chain (never a
 * novelty refill -- Path A, confirmed). This phase replaces that single
 * invocation with N concurrent, smaller chunks
 * (`generateConcurrentChunkedBatch`) plus at most ONE bounded aggregate
 * recovery round (`generateBoundedRecoveryBatch`), reusing the SAME
 * `planChunks`/`gateUnitWithTerraFallback` primitives
 * `generatePracticeQuestions`'s own >4-question chunked path has used
 * since LX-4P-PERF-R1C-R1.
 *
 * Functional tests use the SAME whole-module-mock pattern already
 * established for this generation service's own observability tests
 * (see lx9r8-r1-quality-gate-observability.test.ts's doc comment).
 * Route-level wiring is audited via source, following this route's own
 * established testing convention (see
 * canon-r5r1-generate-and-take-wiring.test.ts's doc comment).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const GATED_SRC = read('src/services/gated-question-generation.service.ts');
// CANON-R6-PERF-R2: the orchestration (chunk generation call site,
// novelty filtering, recovery sizing) this file originally audited
// inside ROUTE_SRC was extracted into this shared service.
const GENERATION_SERVICE_SRC = read('src/services/canonical-prove-generation.service.ts');

// ============================================================
// Whole-module mocks -- same pattern as lx9r8-r1-quality-gate-observability.test.ts
// ============================================================
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
  generate: vi.fn(),
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
vi.mock('@/services/quiz-generation.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-generation.service')>('@/services/quiz-generation.service');
  return { ...actual, generateQuestionsForConcept: (...a: any[]) => h.generate(...a) };
});

import { generateConcurrentChunkedBatch, generateBoundedRecoveryBatch } from '@/services/gated-question-generation.service';
import { planChunks, MAX_QUESTIONS_PER_CHUNK } from '@/services/quiz-generation.service';
import { filterExactDuplicates } from '@/lib/lx/exact-duplicate-novelty';

const Q = (id: string, difficulty = 3): any => ({
  id, conceptId: 'c1', type: 'short_answer', answerFormat: 'text', question: id,
  correctAnswer: 'a', explanation: 'e', difficulty,
});

beforeEach(() => {
  h.det.mockReset().mockReturnValue({ status: 'PASS', failures: [], needsSemantic: [] });
  h.verify.mockReset().mockResolvedValue({});
  h.verifyBatch.mockClear();
  h.evalV.mockReset().mockReturnValue({ pass: true });
  h.classify.mockReset().mockReturnValue([]);
  h.record.mockReset();
  h.generate.mockReset().mockResolvedValue([]);
});

// ============================================================
// 1/3 -- chunk plan
// ============================================================
describe('1/3 -- chunk plan for a 10-item target', () => {
  it('planChunks(10) produces a balanced plan that sums to exactly 10, reusing the existing planner (never a hardcoded Prove-only array)', () => {
    const plan = planChunks(10);
    expect(plan.reduce((a, b) => a + b, 0)).toBe(10);
    expect(plan.length).toBeGreaterThan(1); // genuinely chunked, not one monolithic unit
    expect(plan.every((size) => size <= MAX_QUESTIONS_PER_CHUNK)).toBe(true);
  });

  it('generateConcurrentChunkedBatch requests exactly planChunks(count) chunks, one generateQuestionsForConcept call per chunk (no EMPTY-fallback fires since each chunk\'s Luna output is non-empty)', async () => {
    h.generate.mockResolvedValue([Q('a')]);
    const result = await generateConcurrentChunkedBatch('c1', 's1', 'subj1', { count: 10 });
    expect(result.chunkPlan).toEqual(planChunks(10));
    expect(h.generate).toHaveBeenCalledTimes(result.chunkPlan.length);
  });
});

// ============================================================
// 2 -- concurrency (structural)
// ============================================================
describe('2 -- initial chunks execute concurrently, never serially', () => {
  it('generateConcurrentChunkedBatch fires every chunk\'s generateQuestionsForConcept call BEFORE any of them resolves -- Promise.all(chunkPlan.map(...)), not a for-loop', () => {
    const idx = GATED_SRC.indexOf('const chunkResults = await Promise.all(');
    expect(idx).toBeGreaterThan(-1);
    const slice = GATED_SRC.slice(idx, idx + 200);
    expect(slice).toMatch(/chunkPlan\.map\(async \(chunkSize\)/);
  });

  it('functionally: all chunk-generation calls are issued before the first one\'s result is consumed', async () => {
    const callOrder: number[] = [];
    let resolveFirst: (() => void) | null = null;
    const firstGate = new Promise<void>((resolve) => { resolveFirst = resolve; });
    h.generate.mockImplementation(async (...args: any[]) => {
      callOrder.push(callOrder.length);
      if (callOrder.length === planChunks(10).length) resolveFirst?.();
      await firstGate; // every call waits for ALL to have started before any returns
      return [Q('a')]; // non-empty, so the per-chunk EMPTY-fallback never fires a second call
    });
    await generateConcurrentChunkedBatch('c1', 's1', 'subj1', { count: 10 });
    expect(callOrder.length).toBe(planChunks(10).length);
  });
});

// ============================================================
// 4/9(part) -- canonical difficulty, never client-adapted per chunk
// ============================================================
describe('4 -- every chunk uses the SAME canonical difficulty target, never independently adapted', () => {
  it('all chunk-level generateQuestionsForConcept calls receive the identical difficulty passed to generateConcurrentChunkedBatch', async () => {
    h.generate.mockResolvedValue([]);
    await generateConcurrentChunkedBatch('c1', 's1', 'subj1', { count: 10, difficulty: 3 });
    const difficulties = h.generate.mock.calls.map((call: any[]) => call[3]?.difficulty);
    expect(difficulties.every((d) => d === 3)).toBe(true);
  });

  it('route.ts passes v1EffectiveDifficulty (never a per-chunk-recomputed value) into generateCanonicalProveQuestions, which forwards it unchanged to generateConcurrentChunkedBatch', () => {
    const idx = ROUTE_SRC.indexOf('const proveGen = await generateCanonicalProveQuestions({');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/difficulty: v1EffectiveDifficulty \?\? validated\.difficulty \?\? resolvedDifficulty\?\.level \?\? 3,/);
    expect(GENERATION_SERVICE_SRC).toMatch(/difficulty: params\.difficulty,\s*\n\s*types: ALL_QUESTION_TYPES,/);
  });
});

// ============================================================
// 6 -- cross-chunk duplicates removed
// ============================================================
describe('6 -- exact-text duplicates across concurrent chunks are removed (AI-free, local)', () => {
  it('two chunks producing the identical question text -- only the first survives in the aggregate', async () => {
    h.generate
      .mockResolvedValueOnce([Q('Same question?')])
      .mockResolvedValueOnce([Q('Same question?')])
      .mockResolvedValueOnce([Q('Different question?')]);
    const result = await generateConcurrentChunkedBatch('c1', 's1', 'subj1', { count: 10 });
    const texts = result.accepted.map((q: any) => q.question);
    expect(texts.filter((t) => t === 'Same question?').length).toBe(1);
    expect(texts).toContain('Different question?');
  });
});

// ============================================================
// 17 -- Quality Gate retained (semantic verification not bypassed)
// ============================================================
describe('17 -- the Quality Gate (deterministic + semantic) is retained for both chunks and recovery -- never bypassed for speed', () => {
  it('generateConcurrentChunkedBatch runs the semantic verifier for a candidate needing it', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [], needsSemantic: ['x'] });
    h.evalV.mockReturnValue({ pass: true });
    h.generate.mockResolvedValue([Q('a')]);
    const result = await generateConcurrentChunkedBatch('c1', 's1', 'subj1', { count: 4 });
    expect(h.verify).toHaveBeenCalled();
    expect(result.chunkDiagnostics.some((d) => d.semanticVerificationUsed)).toBe(true);
  });

  it('generateBoundedRecoveryBatch also runs the semantic verifier for a candidate needing it -- the recovery round is not a bypass', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [], needsSemantic: ['x'] });
    h.evalV.mockReturnValue({ pass: true });
    h.generate.mockResolvedValue([Q('a')]);
    const result = await generateBoundedRecoveryBatch('c1', 's1', 'subj1', { count: 2 });
    expect(h.verify).toHaveBeenCalled();
    expect(result.diagnostics.semanticVerificationUsed).toBe(true);
  });
});

// ============================================================
// 18 -- no speculative Terra call
// ============================================================
describe('18 -- no speculative parallel Terra call was added -- Terra only fires when the existing conditional fallback logic decides it must', () => {
  it('when every chunk\'s Luna output is non-empty, generateQuestionsForConcept is called exactly once per chunk (no unconditional second/Terra call)', async () => {
    h.generate.mockResolvedValue([Q('a')]); // EMPTY-fallback never fires since output isn't empty
    const result = await generateConcurrentChunkedBatch('c1', 's1', 'subj1', { count: 10 });
    expect(h.generate).toHaveBeenCalledTimes(result.chunkPlan.length);
    expect(result.chunkDiagnostics.every((d) => !d.fallbackUsed)).toBe(true);
  });

  it('source audit: no Promise.all pairing a Luna and Terra call unconditionally anywhere in the new functions', () => {
    const idx = GATED_SRC.indexOf('export async function generateConcurrentChunkedBatch');
    const endIdx = GATED_SRC.indexOf('export async function generateBoundedRecoveryBatch');
    const block = GATED_SRC.slice(idx, endIdx);
    expect(block).not.toMatch(/Promise\.all\(\[[\s\S]*generateQuestionsForConcept[\s\S]*generateQuestionsForConcept/);
  });
});

// ============================================================
// 13 -- recovery duplicates rejected
// ============================================================
describe('13 -- recovery survivors that duplicate an already-accepted (or prior-Practice) question are rejected, never appended unfiltered', () => {
  it('filterExactDuplicates rejects a recovery candidate matching an already-accumulated fingerprint', () => {
    const already = new Set(['same question?']);
    const result = filterExactDuplicates([Q('Same question?'), Q('New one?')], already);
    expect(result.accepted.map((q: any) => q.question)).toEqual(['New one?']);
    expect(result.rejectedCount).toBe(1);
  });
});

// ============================================================
// 5/8/9/10/19/22 -- route-level wiring (source audit)
// ============================================================
describe('5 -- prior Practice history is loaded ONCE per request, never per chunk', () => {
  it('loadPriorPracticeQuestionFingerprints appears exactly once inside the shared generation service (CANON-R6-PERF-R2 moved the whole novelty+recovery orchestration out of route.ts)', () => {
    const occurrences = (GENERATION_SERVICE_SRC.match(/loadPriorPracticeQuestionFingerprints\(/g) ?? []).length;
    expect(occurrences).toBe(1);
    // called AFTER the concurrent chunk round, not once per chunk --
    // the chunk generation itself never references it.
    const chunkIdx = GENERATION_SERVICE_SRC.indexOf('const chunked = await generateConcurrentChunkedBatch(');
    const loadIdx = GENERATION_SERVICE_SRC.indexOf('loadPriorPracticeQuestionFingerprints(');
    expect(loadIdx).toBeGreaterThan(chunkIdx);
  });

  it('route.ts itself no longer references loadPriorPracticeQuestionFingerprints directly -- it delegates entirely to the shared service (cold path) or to revalidatePreparedActivity (cache-hit path, CANON-R6-PERF-R2)', () => {
    expect(ROUTE_SRC).not.toMatch(/loadPriorPracticeQuestionFingerprints/);
  });
});

describe('8 -- accepted >= target after the initial novelty filter skips the aggregate recovery entirely', () => {
  it('the recovery block is gated on `if (accepted.length < params.targetCount)` -- structurally unreachable when the initial pass already met the target', () => {
    const idx = GENERATION_SERVICE_SRC.indexOf('if (accepted.length < params.targetCount) {');
    expect(idx).toBeGreaterThan(-1);
    const recoveryCallIdx = GENERATION_SERVICE_SRC.indexOf('generateBoundedRecoveryBatch(', idx);
    expect(recoveryCallIdx).toBeGreaterThan(idx);
    expect(recoveryCallIdx).toBeLessThan(idx + 2000);
  });
});

describe('9/10 -- recovery sizing formula (deliberately reuses generatePracticeQuestions\'s own proven surplus formula rather than a bare deficit)', () => {
  it('a deficit of 1 (accepted 9 of 10) requests 2 (deficit + 1, well under the 2x-per-chunk-max cap)', () => {
    const deficit = 10 - 9;
    const recoveryRequestedCount = Math.min(MAX_QUESTIONS_PER_CHUNK * 2, deficit + 1);
    expect(recoveryRequestedCount).toBe(2);
  });

  it('a deficit of 3 (accepted 7 of 10) requests 4 (deficit + 1)', () => {
    const deficit = 10 - 7;
    const recoveryRequestedCount = Math.min(MAX_QUESTIONS_PER_CHUNK * 2, deficit + 1);
    expect(recoveryRequestedCount).toBe(4);
  });

  it('a large deficit is capped at 2x the per-chunk max, never unbounded', () => {
    const deficit = 10;
    const recoveryRequestedCount = Math.min(MAX_QUESTIONS_PER_CHUNK * 2, deficit + 1);
    expect(recoveryRequestedCount).toBe(MAX_QUESTIONS_PER_CHUNK * 2);
  });

  it('source audit: the shared generation service\'s own formula matches exactly (CANON-R6-PERF-R2 -- extracted from route.ts, used identically by the live and background pre-generation paths)', () => {
    expect(GENERATION_SERVICE_SRC).toMatch(/const recoveryRequestedCount = Math\.min\(MAX_QUESTIONS_PER_CHUNK \* 2, deficit \+ 1\);/);
  });
});

describe('19 -- v1 marker construction and persistence call are unchanged by this phase', () => {
  it('v1MarkerToPersist / storeQuiz wiring is byte-identical to CANON-R6R1', () => {
    expect(ROUTE_SRC).toMatch(/const v1MarkerToPersist: QuizSessionV1Marker \| null = v1Marker\s*\n\s*\? \{ \.\.\.v1Marker, novelty: noveltyDiagnostics \}\s*\n\s*: null;/);
    expect(ROUTE_SRC).toMatch(/const quizId = await storeQuiz\(/);
  });
});

describe('22 -- canonical Results / submission behavior is untouched -- this phase affects generation latency only', () => {
  it('handleSubmitQuiz\'s own canonicalResults re-fetch gate is unchanged', () => {
    expect(ROUTE_SRC).toMatch(/quizSession\.v1Marker && authorizedResult\?\.v1Qualifies && quizSession\.conceptId/);
  });

  it('no new reference to generateConcurrentChunkedBatch/generateBoundedRecoveryBatch exists anywhere in handleSubmitQuiz', () => {
    const submitIdx = ROUTE_SRC.indexOf('async function handleSubmitQuiz');
    expect(submitIdx).toBeGreaterThan(-1);
    const submitBlock = ROUTE_SRC.slice(submitIdx);
    expect(submitBlock).not.toMatch(/generateConcurrentChunkedBatch|generateBoundedRecoveryBatch/);
  });
});

// ============================================================
// 16/12 -- no recursive/unbounded recovery
// ============================================================
describe('12/16 -- call-count safety: one initial concurrent round, at most one aggregate recovery round, never recursive', () => {
  it('generateConcurrentChunkedBatch contains exactly ONE generation round -- no loop that calls generateQuestionsForConcept/gateUnitWithTerraFallback repeatedly (its own for-loops only iterate over ALREADY-FETCHED chunk results for cross-chunk dedup, never re-generate)', () => {
    const idx = GATED_SRC.indexOf('export async function generateConcurrentChunkedBatch');
    const endIdx = GATED_SRC.indexOf('export async function generateBoundedRecoveryBatch');
    const block = GATED_SRC.slice(idx, endIdx);
    const generateCallSites = (block.match(/generateQuestionsForConcept\(/g) ?? []).length;
    // exactly 2: the chunk's own Luna call + its own conditional Terra
    // fallback call (inside gateUnitWithTerraFallback's regenerate
    // callback) -- both INSIDE the single Promise.all, neither inside a
    // retry loop.
    expect(generateCallSites).toBe(2);
    // the dedup for-loops exist (iterating chunkResults/chunkAccepted,
    // already-resolved data) but never wrap a generation call.
    const dedupForLoopIdx = block.indexOf('for (const { accepted: chunkAccepted } of chunkResults)');
    expect(dedupForLoopIdx).toBeGreaterThan(-1);
    const dedupBlock = block.slice(dedupForLoopIdx);
    expect(dedupBlock).not.toMatch(/generateQuestionsForConcept|gateUnitWithTerraFallback/);
  });

  it('generateBoundedRecoveryBatch makes exactly one generation call and one gate pass, no internal fallback', () => {
    const idx = GATED_SRC.indexOf('export async function generateBoundedRecoveryBatch');
    const block = GATED_SRC.slice(idx);
    expect(block).not.toMatch(/gateUnitWithTerraFallback/);
    const generateCalls = (block.match(/generateQuestionsForConcept\(/g) ?? []).length;
    expect(generateCalls).toBe(1);
  });
});

// ============================================================
// Legacy firewall
// ============================================================
describe('legacy firewall -- quick_check/topic_practice/review/cumulative_assessment/exam_simulation/diagnostic_check are untouched', () => {
  it('quick_check retains its fixed defaultMax: 6', () => {
    expect(ROUTE_SRC).toMatch(/defaultMax: 6,/);
  });

  it('the generic multi-concept branch (cumulative_assessment/exam_simulation/diagnostic_check/retention_check override) still calls generateGatedQuestionBatch, unchanged', () => {
    const canonicalProveIdx = ROUTE_SRC.indexOf("validated.quizMode === 'canonical_prove'\n        ?");
    const genericIdx = ROUTE_SRC.indexOf('Promise.all(', canonicalProveIdx);
    const slice = ROUTE_SRC.slice(genericIdx, genericIdx + 2500);
    expect(slice).toMatch(/return generateGatedQuestionBatch\(cId, validated\.studentId, validated\.subjectId, \{/);
  });

  it('no changes anywhere to src/lib/pedagogical-engine, src/lib/ai routing, or DB schema (this test file\'s own scope)', () => {
    expect(ROUTE_SRC).not.toMatch(/from '@\/lib\/pedagogical-engine'/);
    expect(GATED_SRC).not.toMatch(/from '@\/lib\/pedagogical-engine'/);
  });
});
