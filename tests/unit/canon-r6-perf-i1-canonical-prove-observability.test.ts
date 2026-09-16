/**
 * CANON-R6-PERF-I1 -- CANONICAL PROVE GENERATION OBSERVABILITY.
 *
 * Instrumentation only -- no generation/quality-gate/novelty/fallback
 * BEHAVIOR change. This file verifies two things:
 *
 * 1. REAL, unmocked-logic tests of the new diagnostic fields on
 *    `applyQuestionQualityGate`/`gateUnitWithTerraFallback` and the new
 *    `onInvocationDiagnostics` hook on `generateGatedQuestionBatch`,
 *    using the SAME whole-module-mock pattern already established for
 *    this file's own observability tests (see
 *    lx9r8-r1-quality-gate-observability.test.ts's own doc comment).
 * 2. Source-audit coverage of the route-level wiring (request
 *    correlation, per-phase timers, the single summary event, and its
 *    strict scoping to `canonical_prove` only), following this route's
 *    own established testing convention (see
 *    canon-r5r1-generate-and-take-wiring.test.ts's doc comment) -- a
 *    full HTTP-level invocation would require mocking the entire AI
 *    generation pipeline this phase's firewall explicitly protects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const OBSERVABILITY_SRC = read('src/lib/lx/canonical-prove-generation-observability.ts');

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
vi.mock('@/services/quiz-generation.service', () => ({ generateQuestionsForConcept: (...a: any[]) => h.generate(...a) }));

import { applyQuestionQualityGate, gateUnitWithTerraFallback, generateGatedQuestionBatch } from '@/services/gated-question-generation.service';
import { hashStudentId, logCanonicalProveGenerationSummary } from '@/lib/lx/canonical-prove-generation-observability';

const Q = (id: string, difficulty = 2): any => ({
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
// applyQuestionQualityGate -- new semanticCandidateCount/semanticAccepted fields
// ============================================================
describe('applyQuestionQualityGate -- additive semanticCandidateCount/semanticAccepted', () => {
  it('0 candidates need semantic verification -> both new fields are 0, no semantic call made', async () => {
    h.det.mockReturnValue({ status: 'PASS', failures: [], needsSemantic: [] });
    const result = await applyQuestionQualityGate([Q('a'), Q('b')], { conceptId: 'c1' });
    expect(result.semanticCandidateCount).toBe(0);
    expect(result.semanticAccepted).toBe(0);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.verifyBatch).not.toHaveBeenCalled();
  });

  it('>1 candidates need semantic verification, all pass -> semanticCandidateCount and semanticAccepted both equal the candidate count (one BATCHED call)', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [], needsSemantic: ['x'] });
    h.evalV.mockReturnValue({ pass: true });
    const result = await applyQuestionQualityGate([Q('a'), Q('b'), Q('c')], { conceptId: 'c1' });
    expect(result.semanticCandidateCount).toBe(3);
    expect(result.semanticAccepted).toBe(3);
    expect(result.semanticRejected).toBe(0);
    expect(h.verifyBatch).toHaveBeenCalledTimes(1);
  });

  it('exactly 1 candidate needs semantic verification and is rejected -> semanticCandidateCount 1, semanticAccepted 0', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [], needsSemantic: ['x'] });
    h.evalV.mockReturnValue({ pass: false });
    const result = await applyQuestionQualityGate([Q('a')], { conceptId: 'c1' });
    expect(result.semanticCandidateCount).toBe(1);
    expect(result.semanticAccepted).toBe(0);
    expect(result.semanticRejected).toBe(1);
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.verifyBatch).not.toHaveBeenCalled();
  });
});

// ============================================================
// gateUnitWithTerraFallback -- new fallbackReasonCode/semanticVerificationUsed/semanticCallCount/etc.
// ============================================================
describe('gateUnitWithTerraFallback -- additive fallback/semantic diagnostics', () => {
  it('enough on the first (Luna) pass -> fallbackUsed false, fallbackReasonCode null, semantic fields reflect ONLY g1', async () => {
    h.det.mockReturnValue({ status: 'PASS', failures: [], needsSemantic: [] });
    const luna = [Q('a'), Q('b')];
    const result = await gateUnitWithTerraFallback(
      luna,
      { conceptId: 'c1', targetCount: 2, fallbackWhen: 'SHORT' },
      async () => { throw new Error('must not be called'); },
    );
    expect(result.fallbackUsed).toBe(false);
    expect(result.fallbackReasonCode).toBeNull();
    expect(result.semanticVerificationUsed).toBe(false);
    expect(result.semanticCallCount).toBe(0);
    expect(result.semanticCandidateCount).toBe(0);
    expect(result.semanticAcceptedCount).toBe(0);
    expect(result.semanticRejectedCount).toBe(0);
  });

  it('SHORT fallback fires (Luna under target) -> fallbackReasonCode SHORT, semantic fields SUM g1+g2', async () => {
    h.det
      .mockReturnValueOnce({ status: 'PASS', failures: [], needsSemantic: [] }) // g1: 1 luna candidate, passes deterministically
      .mockReturnValueOnce({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [], needsSemantic: ['x'] }); // g2: 1 terra candidate, needs semantic
    h.evalV.mockReturnValue({ pass: true });
    const luna = [Q('a')]; // only 1, target is 2 -> SHORT
    const terra = [Q('b')];
    const result = await gateUnitWithTerraFallback(
      luna,
      { conceptId: 'c1', targetCount: 2, fallbackWhen: 'SHORT' },
      async () => terra,
    );
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReasonCode).toBe('SHORT');
    // g1 had 0 semantic candidates, g2 had 1 -> aggregate reflects g2 only.
    expect(result.semanticVerificationUsed).toBe(true);
    expect(result.semanticCallCount).toBe(1);
    expect(result.semanticCandidateCount).toBe(1);
    expect(result.semanticAcceptedCount).toBe(1);
    expect(result.semanticRejectedCount).toBe(0);
  });

  it('EMPTY fallback mode reports fallbackReasonCode EMPTY when it fires', async () => {
    h.det.mockReturnValue({ status: 'FAIL', failures: [{ code: 'SCHEMA_INVALID', detail: 'x' }], needsSemantic: [] });
    const result = await gateUnitWithTerraFallback(
      [Q('a')], // will be deterministically rejected -> 0 accepted -> EMPTY triggers
      { conceptId: 'c1', targetCount: 1, fallbackWhen: 'EMPTY' },
      async () => [],
    );
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReasonCode).toBe('EMPTY');
  });

  it('semanticCallCount is 2 when BOTH g1 and g2 each independently need a semantic call', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [], needsSemantic: ['x'] });
    h.evalV.mockReturnValueOnce({ pass: false }).mockReturnValueOnce({ pass: true });
    const result = await gateUnitWithTerraFallback(
      [Q('a')], // needs semantic, gets rejected -> 0 accepted -> SHORT of target 1
      { conceptId: 'c1', targetCount: 1, fallbackWhen: 'SHORT' },
      async () => [Q('b')], // terra candidate also needs semantic, passes
    );
    expect(result.fallbackUsed).toBe(true);
    expect(result.semanticCallCount).toBe(2);
    expect(result.semanticCandidateCount).toBe(2);
  });
});

// ============================================================
// generateGatedQuestionBatch -- onInvocationDiagnostics on every return path
// ============================================================
describe('generateGatedQuestionBatch -- onInvocationDiagnostics fires on every return path, never affects the returned questions', () => {
  it('clean success, no fallback, no semantic verification needed -> generationCalls 1, externalAiCallCount 1', async () => {
    h.det.mockReturnValue({ status: 'PASS', failures: [], needsSemantic: [] });
    h.generate.mockResolvedValue([Q('a'), Q('b')]);
    let diag: any = null;
    const accepted = await generateGatedQuestionBatch('c1', 's1', 'subj1', {
      count: 2,
      onInvocationDiagnostics: (d) => { diag = d; },
    });
    expect(accepted).toHaveLength(2);
    expect(diag).not.toBeNull();
    expect(diag.requestedCount).toBe(2);
    expect(diag.acceptedCount).toBe(2);
    expect(diag.fallbackUsed).toBe(false);
    expect(diag.fallbackReasonCode).toBeNull();
    expect(diag.generationCalls).toBe(1);
    expect(diag.recoveryCalls).toBe(0);
    expect(diag.semanticVerificationUsed).toBe(false);
    expect(diag.semanticCallCount).toBe(0);
    expect(diag.externalAiCallCount).toBe(1);
    expect(diag.insufficientCount).toBe(false);
    expect(typeof diag.operationId).toBe('string');
    expect(typeof diag.durationMs).toBe('number');
  });

  it('semantic verification fires -> externalAiCallCount reflects generation + verification', async () => {
    h.det.mockReturnValue({ status: 'NOT_DETERMINISTICALLY_VERIFIED', failures: [], needsSemantic: ['x'] });
    h.evalV.mockReturnValue({ pass: true });
    h.generate.mockResolvedValue([Q('a'), Q('b')]);
    let diag: any = null;
    await generateGatedQuestionBatch('c1', 's1', 'subj1', {
      count: 2,
      onInvocationDiagnostics: (d) => { diag = d; },
    });
    expect(diag.semanticVerificationUsed).toBe(true);
    expect(diag.semanticCallCount).toBe(1);
    expect(diag.externalAiCallCount).toBe(2); // 1 generation + 1 semantic verify
    expect(diag.fallbackUsed).toBe(false);
  });

  it('Terra fallback fires (Luna short) -> generationCalls 2, recoveryCalls 1, fallbackUsed true', async () => {
    h.det.mockReturnValue({ status: 'PASS', failures: [], needsSemantic: [] });
    h.generate
      .mockResolvedValueOnce([Q('a')]) // Luna: only 1, target 2 -> short
      .mockResolvedValueOnce([Q('b')]); // Terra fallback: 1 more
    let diag: any = null;
    const accepted = await generateGatedQuestionBatch('c1', 's1', 'subj1', {
      count: 2,
      onInvocationDiagnostics: (d) => { diag = d; },
    });
    expect(accepted).toHaveLength(2);
    expect(diag.fallbackUsed).toBe(true);
    expect(diag.fallbackReasonCode).toBe('SHORT');
    expect(diag.generationCalls).toBe(2);
    expect(diag.recoveryCalls).toBe(1);
    expect(diag.externalAiCallCount).toBe(2);
    expect(diag.insufficientCount).toBe(false);
  });

  it('insufficient even after fallback -> onInvocationDiagnostics still fires, with insufficientCount true and the real (short) acceptedCount', async () => {
    h.det.mockReturnValue({ status: 'PASS', failures: [], needsSemantic: [] });
    h.generate.mockResolvedValue([Q('a')]); // both Luna and Terra return only 1, target 2 -- never reaches 2
    let diag: any = null;
    const accepted = await generateGatedQuestionBatch('c1', 's1', 'subj1', {
      count: 2,
      onInvocationDiagnostics: (d) => { diag = d; },
    });
    expect(accepted).toEqual([]); // the function's own existing contract: [] when insufficient
    expect(diag.insufficientCount).toBe(true);
    expect(diag.fallbackUsed).toBe(true);
    expect(diag.acceptedCount).toBeLessThan(2);
  });

  it('non-retryable provider error -> diagnostics report exactly 1 generation call, 0 recovery, insufficientCount true, no fallback/semantic', async () => {
    h.generate.mockImplementation(async (_c: string, _s: string, _sub: string, opts: any) => {
      opts.onNonRetryableError?.('CONFIGURATION_ERROR');
      return [];
    });
    let diag: any = null;
    const accepted = await generateGatedQuestionBatch('c1', 's1', 'subj1', {
      count: 3,
      onInvocationDiagnostics: (d) => { diag = d; },
    });
    expect(accepted).toEqual([]);
    expect(diag.generationCalls).toBe(1);
    expect(diag.recoveryCalls).toBe(0);
    expect(diag.fallbackUsed).toBe(false);
    expect(diag.semanticCallCount).toBe(0);
    expect(diag.externalAiCallCount).toBe(1);
    expect(diag.insufficientCount).toBe(true);
    expect(diag.acceptedCount).toBe(0);
  });

  it('an unexpected synchronous error (outer catch) -> diagnostics still fire, conservatively reporting 0 calls rather than guessing', async () => {
    h.generate.mockResolvedValue([Q('a')]);
    h.det.mockImplementation(() => { throw new Error('boom'); });
    let diag: any = null;
    const accepted = await generateGatedQuestionBatch('c1', 's1', 'subj1', {
      count: 1,
      onInvocationDiagnostics: (d) => { diag = d; },
    });
    expect(accepted).toEqual([]);
    expect(diag).not.toBeNull();
    expect(diag.generationCalls).toBe(0);
    expect(diag.externalAiCallCount).toBe(0);
    expect(diag.insufficientCount).toBe(true);
  });

  it('a caller that does NOT pass onInvocationDiagnostics sees no change at all (optional, purely additive)', async () => {
    h.det.mockReturnValue({ status: 'PASS', failures: [], needsSemantic: [] });
    h.generate.mockResolvedValue([Q('a')]);
    const accepted = await generateGatedQuestionBatch('c1', 's1', 'subj1', { count: 1 });
    expect(accepted).toHaveLength(1);
  });
});

// ============================================================
// hashStudentId
// ============================================================
describe('hashStudentId', () => {
  it('is deterministic', () => {
    expect(hashStudentId('student-1')).toBe(hashStudentId('student-1'));
  });
  it('differs for different students', () => {
    expect(hashStudentId('student-1')).not.toBe(hashStudentId('student-2'));
  });
  it('never returns the raw input', () => {
    expect(hashStudentId('student-1')).not.toBe('student-1');
    expect(hashStudentId('student-1')).not.toContain('student-1');
  });
});

// ============================================================
// logCanonicalProveGenerationSummary
// ============================================================
describe('logCanonicalProveGenerationSummary', () => {
  it('emits exactly one CANONICAL_PROVE_GENERATION_SUMMARY console.log line with the given payload', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const summary: any = { operationId: 'op1', result: 'SUCCESS', finalQuestionCount: 10 };
      logCanonicalProveGenerationSummary(summary);
      const call = logSpy.mock.calls.find((c) => c[0] === 'CANONICAL_PROVE_GENERATION_SUMMARY');
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1] as string)).toEqual(summary);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('never throws, even if logging fails', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('log sink down'); });
    try {
      expect(() => logCanonicalProveGenerationSummary({} as any)).not.toThrow();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('the module never logs question/prompt content -- source audit of the summary interface\'s own field list', () => {
    expect(OBSERVABILITY_SRC).not.toMatch(/questionText|question:|prompt:|correctAnswer/);
  });
});

// ============================================================
// Route wiring -- source audit (per this route's established convention)
// ============================================================
describe('route wiring -- request correlation, per-phase timers, single summary event, scoping', () => {
  it('1. reuses the existing parentOperationId as the request-level correlation id -- no parallel correlation model introduced', () => {
    const idx = ROUTE_SRC.indexOf('const emitCanonicalProveSummary =');
    const slice = ROUTE_SRC.slice(idx, idx + 1200);
    expect(slice).toMatch(/operationId: parentOperationId,/);
    expect(slice).toMatch(/parentOperationId,/);
  });

  it('2. all required route timers exist: canonicalAuthorizationMs, priorHistoryMs, generationPrimaryMs (via the PRIMARY invocation), noveltyFilterMs, novelty_refill_1_ms/2_ms, persistenceMs, totalMs', () => {
    expect(ROUTE_SRC).toMatch(/canonicalAuthorizationMs = Date\.now\(\) - canonicalAuthorizationStartedAt;/);
    expect(ROUTE_SRC).toMatch(/priorHistoryMs = Date\.now\(\) - priorHistoryStartedAt;/);
    expect(ROUTE_SRC).toMatch(/noveltyFilterMs \+= Date\.now\(\) - noveltyFilterStartedAt;/);
    expect(ROUTE_SRC).toMatch(/novelty_refill_1_ms = diag\.durationMs;/);
    expect(ROUTE_SRC).toMatch(/novelty_refill_2_ms = diag\.durationMs;/);
    expect(ROUTE_SRC).toMatch(/persistenceMs = Date\.now\(\) - persistenceStartedAt;/);
    expect(ROUTE_SRC).toMatch(/totalMs: Date\.now\(\) - requestStartedAt,/);
    expect(ROUTE_SRC).toMatch(/generationPrimaryMs: primaryInvocation\?\.durationMs \?\? null,/);
  });

  it('3/4. each generateGatedQuestionBatch invocation site (primary + both refills) threads onInvocationDiagnostics, tagged PRIMARY/NOVELTY_REFILL_1/NOVELTY_REFILL_2', () => {
    expect(ROUTE_SRC).toMatch(/generationInvocations\.push\(\{ invocationType: 'PRIMARY', \.\.\.diag \}\);/);
    expect(ROUTE_SRC).toMatch(/generationInvocations\.push\(\{ invocationType: refillInvocationType, \.\.\.diag \}\);/);
    expect(ROUTE_SRC).toMatch(/const refillInvocationType = attempt === 0 \? 'NOVELTY_REFILL_1' : 'NOVELTY_REFILL_2';/);
  });

  it('2. legacy quick_check does not receive the new canonical-prove summary -- onInvocationDiagnostics is spread ONLY when quizMode === canonical_prove at the primary call site', () => {
    const idx = ROUTE_SRC.indexOf('...(validated.quizMode === \'canonical_prove\'\n                  ? {\n                      onInvocationDiagnostics:');
    expect(idx).toBeGreaterThan(-1);
  });

  it('3. Practice behavior unchanged -- emitCanonicalProveSummary itself is a no-op for any non-canonical_prove quizMode', () => {
    const idx = ROUTE_SRC.indexOf('const emitCanonicalProveSummary =');
    const slice = ROUTE_SRC.slice(idx, idx + 300);
    expect(slice).toMatch(/if \(validated\.quizMode !== 'canonical_prove'\) return;/);
  });

  it('8. exactly one CANONICAL_PROVE_GENERATION_SUMMARY-equivalent emission call site per outcome: SUCCESS (1), INCOMPLETE (2, one per choke-point guard), ERROR (1, in the outer catch)', () => {
    const successCount = (ROUTE_SRC.match(/emitCanonicalProveSummary\('SUCCESS', questions\.length\);/g) ?? []).length;
    const incompleteCount = (ROUTE_SRC.match(/emitCanonicalProveSummary\('INCOMPLETE', questions\.length, 'V1_PROVE_GENERATION_INCOMPLETE'\);/g) ?? []).length;
    const errorCount = (ROUTE_SRC.match(/result: 'ERROR',/g) ?? []).length;
    expect(successCount).toBe(1);
    expect(incompleteCount).toBe(2);
    expect(errorCount).toBe(1);
  });

  it('9. the error path is gated on the RAW (unvalidated) quizMode, never on `validated` (out of scope in the catch block)', () => {
    const idx = ROUTE_SRC.indexOf("if (rawQuizModeForErrorLogging === 'canonical_prove') {");
    expect(idx).toBeGreaterThan(-1);
    const catchIdx = ROUTE_SRC.lastIndexOf('} catch (error: any) {', idx);
    expect(catchIdx).toBeGreaterThan(-1);
    expect(idx - catchIdx).toBeLessThan(1200);
  });

  it('13. no question text is ever included in the summary payload -- source audit of every field passed to logCanonicalProveGenerationSummary', () => {
    const idx = ROUTE_SRC.indexOf('const emitCanonicalProveSummary =');
    const endIdx = ROUTE_SRC.indexOf('// LX-9R6-R1 C2/C4: the ONE choke point', idx);
    const block = ROUTE_SRC.slice(idx, endIdx);
    expect(block).not.toMatch(/questions:\s*questions/);
    expect(block).not.toMatch(/\bquestion\.question\b/);
  });

  it('10. instrumentation is synchronous local timing only -- no new import of a network/telemetry client in the observability module', () => {
    expect(OBSERVABILITY_SRC).not.toMatch(/fetch\(|axios|http\.request|@\/lib\/db/);
  });

  it('12. firewall -- no changes to pedagogical engine, migration, AI routing/provider selection, token budgets, or DB schema anywhere in this diff\'s own files', () => {
    expect(ROUTE_SRC).not.toMatch(/from '@\/lib\/pedagogical-engine'/);
    expect(ROUTE_SRC).not.toMatch(/from '@\/lib\/pedagogical-migration'/);
    expect(OBSERVABILITY_SRC).not.toMatch(/model-routing|token-budgets|CAPABILITY_ROUTING/);
  });
});
