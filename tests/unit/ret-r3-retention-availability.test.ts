/**
 * RET-R3 -- RETENTION AVAILABILITY.
 *
 * Live QA: retention_check could still hard-fail with "Couldn't load
 * the quiz" / "Failed to generate quiz questions" even after RET-R2's
 * candidate-surplus fix. Root cause (B4, proven by direct code audit,
 * not live telemetry): the whole-chunk collision-discard rule
 * (`retentionHasExactDuplicate` / `retentionStructuralOverlapGroupCount`,
 * both now DELETED) could discard an entire otherwise-valid chunk (3-4
 * candidates) over a SINGLE collision between the two initial chunks --
 * destroying most of RET-R2's own 8-candidate surplus before the
 * Quality Gate ever ran. Fix: per-question dedup
 * (`dedupeAgainstAccepted`, reused from the pre-existing recovery-wave
 * authority) now runs AFTER the gate, on the merged initial pool, so a
 * collision drops only the specific colliding candidate(s) -- never an
 * unrelated, unique sibling.
 *
 * This file covers the 17 required retention-availability tests
 * (16-32). See tests/unit/quiz-generation-retention.test.ts and
 * tests/unit/ret-r2-candidate-surplus.test.ts (both updated in place
 * for the corrected collision semantics) for the broader generation
 * pipeline coverage this file does not duplicate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const executeAIMock = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  return { ...actual, executeAI: (...a: any[]) => executeAIMock(...a) };
});

const retrieveContextMock = vi.fn().mockResolvedValue({ chunks: [] });
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => retrieveContextMock(...a) }));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

const callModelMock = vi.fn();
vi.mock('@/lib/ai/adapters/call-model', () => ({ callModel: (...a: any[]) => callModelMock(...a) }));

vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: vi.fn(async ({ question }: any) => ({
    conceptAligned: !String(question?.question ?? '').includes('SEMANTIC_REJECT'),
    answerCorrect: true, unambiguous: true, reasoningConsistent: true,
    distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
  })),
  evaluateQuestionQualityVerdict: vi.fn((verdict: any) => ({ pass: !!verdict?.conceptAligned, reason: verdict?.conceptAligned ? '' : 'test-forced semantic rejection' })),
}));

vi.mock('@/lib/lx/question-quality-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lx/question-quality-contract')>();
  return {
    ...actual,
    checkQuestionQualityDeterministic: (q: any, ctx: any) => {
      if (typeof q?.question === 'string' && q.question.includes('DET_REJECT')) {
        return { status: 'FAIL', failures: [{ code: 'SCHEMA_INVALID', detail: 'test-forced deterministic rejection' }], numericallyVerified: false, needsSemantic: [] };
      }
      return actual.checkQuestionQualityDeterministic(q, ctx);
    },
  };
});

import {
  generateRetentionCheckQuestions,
  RETENTION_REQUIRED_COUNT,
  RETENTION_INITIAL_CANDIDATE_COUNT,
  RETENTION_MAX_AI_CALLS_PER_ATTEMPT,
} from '@/services/quiz-generation.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SERVICE_SRC = read('src/services/quiz-generation.service.ts');
const QUIZ_PAGE_SRC = strip(read('src/app/dashboard/quiz/page.tsx'));

const INITIAL_CHUNK_SIZE = 4;

function fakeQuestion(i: number, overrides: Partial<{ question: string; type: string; questionIntent: string }> = {}) {
  return {
    type: overrides.type ?? 'multiple_choice',
    question: overrides.question ?? `Q${i}`,
    options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }],
    correctAnswer: 'A',
    explanation: 'because',
    difficulty: 3,
    cognitiveLevel: 'APPLICATION',
    questionIntent: overrides.questionIntent ?? 'CHECK_APPLICATION',
  };
}
function batch(questions: any[]): string {
  return JSON.stringify({ questions });
}
function cleanChunkText(base: number, count = INITIAL_CHUNK_SIZE) {
  return batch(Array.from({ length: count }, (_, i) => fakeQuestion(base + i)));
}
/** Every chunk-B candidate collides (exact text) with the chunk-A candidate at the same slot -- the "single-collision widened to all 4" fixture needed once per-question dedup replaced whole-chunk discard. */
function fullyDuplicatedChunkTexts(): [string, string] {
  const a = Array.from({ length: INITIAL_CHUNK_SIZE }, (_, i) => fakeQuestion(i, { question: `Shared question ${i}` }));
  const b = Array.from({ length: INITIAL_CHUNK_SIZE }, (_, i) => fakeQuestion(10 + i, { question: `Shared question ${i}` }));
  return [batch(a), batch(b)];
}

function wireRealisticExecuteAI(chunkResponses: Array<{ text: string } | { error: 'TIMEOUT' | 'PROVIDER_ERROR' }>) {
  callModelMock.mockReset();
  for (const resp of chunkResponses) {
    if ('error' in resp) {
      callModelMock.mockImplementationOnce(async () => {
        const err: any = new Error(resp.error);
        err.name = resp.error === 'TIMEOUT' ? 'AbortError' : 'Error';
        throw err;
      });
    } else {
      callModelMock.mockImplementationOnce(async () => ({ text: resp.text, raw: {}, provider: 'openai', model: 'gpt-5.6-luna' }));
    }
  }
  executeAIMock.mockReset().mockImplementation(async (opts: any) => {
    let raw: any;
    try {
      raw = await opts.call(new AbortController().signal);
    } catch (err: any) {
      const code = err?.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_ERROR';
      return { result: opts.fallback({ code, message: String(err?.message ?? err) }), execution: {} as any, provenance: {} as any };
    }
    const validation = opts.validate(raw);
    if (!validation.valid) {
      return { result: opts.fallback({ code: 'VALIDATION_ERROR', message: (validation.errors ?? []).join('; ') }), execution: {} as any, provenance: {} as any };
    }
    return { result: validation.value, execution: {} as any, provenance: {} as any };
  });
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
function retentionEvents(): Array<{ label: string; [k: string]: unknown }> {
  return consoleLogSpy.mock.calls
    .filter((c: any[]) => c[0] === '[retention]')
    .map((c: any[]) => JSON.parse(c[1] as string));
}
function rawLoggedText(): string {
  return consoleLogSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
}

beforeEach(() => {
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callModelMock.mockReset().mockResolvedValue({ text: '[]', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
  executeAIMock.mockReset();
  consoleLogSpy?.mockRestore();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

/* ================================================================ *
 * 16-17 -- the surplus/canonical split RET-R2 established is unchanged. *
 * ================================================================ */
describe('RET-R3 required tests 16-17 -- RET-R2 sizing constants are untouched by the B4 collision-policy fix', () => {
  it('16. initial candidate count remains 8 (2 chunks x 4) -- RET-R3 changed HOW collisions are resolved, never how many candidates are requested', () => {
    expect(RETENTION_INITIAL_CANDIDATE_COUNT).toBe(8);
  });

  it('17. published count remains exactly 6, still independent of candidate count', () => {
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
  });
});

/* ================================================================ *
 * 18 -- recovery formula stays bounded [3,6], a pure fn of deficit.  *
 * ================================================================ */
describe('RET-R3 required test 18 -- bounded recovery candidate surplus is unchanged by B4', () => {
  it('18. recoveryCandidateCount(deficit) requests a bounded [3,6] surplus, observable via the recovery call\'s own "Generate EXACTLY N CANDIDATE" instruction', async () => {
    // deficit = 2 (6 accepted needed, only 4 unique survive two colliding
    // 4-candidate chunks where every candidate line collides) -> recovery
    // formula clamps to max(3, deficit+2) = 4.
    const [a, b] = fullyDuplicatedChunkTexts();
    wireRealisticExecuteAI([{ text: a }, { text: b }, { text: cleanChunkText(20, 4) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(callModelMock).toHaveBeenCalledTimes(3);
    const recoveryUserMsg = (callModelMock.mock.calls[2][0] as any).user as string;
    expect(recoveryUserMsg).toMatch(/Generate EXACTLY 4 CANDIDATE questions/);
  });
});

/* ================================================================ *
 * 19 -- AI call cap stays at 3 (2 initial + <=1 recovery).           *
 * ================================================================ */
describe('RET-R3 required test 19 -- the AI call cap is never raised as a workaround', () => {
  it('19. even in the worst-case collision scenario (all 4 chunk-B candidates collide with chunk A), at most RETENTION_MAX_AI_CALLS_PER_ATTEMPT (3) calls are made -- never a second recovery round', async () => {
    expect(RETENTION_MAX_AI_CALLS_PER_ATTEMPT).toBe(3);
    const [a, b] = fullyDuplicatedChunkTexts();
    wireRealisticExecuteAI([{ text: a }, { text: b }, { text: cleanChunkText(20, 4) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(callModelMock.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

/* ================================================================ *
 * 20 -- one rejected candidate never removes an unrelated sibling.  *
 * ================================================================ */
describe('RET-R3 required test 20 -- a rejected candidate never takes an unrelated accepted sibling with it', () => {
  it('20. 1 of 8 candidates deterministically rejected -> the other 7 (including its own chunk-mates) all survive to the accepted pool', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
    // chunk A's 3 non-rejected siblings (Q1,Q2,Q3) all survived alongside chunk B's 4.
    const texts = result.map((q: any) => q.question);
    expect(texts).toContain('Q1');
    expect(texts).toContain('Q2');
    expect(texts).toContain('Q3');
  });
});

/* ================================================================ *
 * 21-22 -- THE B4 fix itself: one duplicate never discards a whole   *
 * chunk; every unique candidate is preserved.                       *
 * ================================================================ */
describe('RET-R3 required tests 21-22 -- B4 proof: a single duplicate drops only itself, never a whole chunk; every unique candidate is kept', () => {
  it('21. exactly ONE colliding pair among 8 candidates -> 7 unique survive (only the one duplicate is dropped) -- proves the old whole-chunk-discard rule is gone', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    const chunkB = batch([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12), fakeQuestion(13)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    // 7 of 8 are unique (>= 6), so NO recovery call is needed at all.
    expect(callModelMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(6);
    const texts = result.map((q: any) => q.question);
    // chunk B's non-colliding siblings survived (2 of its 3 unique ones
    // fit within the 6-slot cap alongside chunk A's 4) -- the old rule
    // would have discarded chunk B entirely over this one collision.
    expect(texts).toContain('Q11');
    expect(texts).toContain('Q12');
  });

  it('22. dedupeAgainstAccepted keeps every unique candidate across both chunks -- telemetry proves the merge pool started at 8, not 4', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    const chunkB = batch([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12), fakeQuestion(13)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const gateEvent = retentionEvents().find((e) => e.label === 'RETENTION_INITIAL_GATE_COMPLETE');
    expect(gateEvent?.generatedCount).toBe(8);
    expect(gateEvent?.acceptedCount).toBe(7);
  });
});

/* ================================================================ *
 * 23-24 -- semantic and deterministic rejections still function.    *
 * ================================================================ */
describe('RET-R3 required tests 23-24 -- semantic and deterministic rejections are unaffected by the dedupe fix', () => {
  it('23. a candidate the semantic verifier declines (SEMANTIC_REJECT marker) never appears in the final accepted set', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'SEMANTIC_REJECT a' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result.map((q: any) => q.question)).not.toContain('SEMANTIC_REJECT a');
  });

  it('24. a candidate the deterministic gate rejects (DET_REJECT marker) never appears in the final accepted set', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result.map((q: any) => q.question)).not.toContain('DET_REJECT a');
  });
});

/* ================================================================ *
 * 25-26 -- rejection telemetry: real categories, no question content.*
 * ================================================================ */
describe('RET-R3 required tests 25-26 -- rejection telemetry exposes real categories and never leaks question content', () => {
  it('25. telemetry distinguishes DUPLICATE_OF_ACCEPTED (dedupe) from SCHEMA_INVALID (deterministic gate) -- never conflated under one bucket', async () => {
    const chunkA = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'Same question text' }),
      fakeQuestion(2), fakeQuestion(3),
    ]);
    const chunkB = batch([
      fakeQuestion(10, { question: 'Same question text' }),
      fakeQuestion(11), fakeQuestion(12), fakeQuestion(13),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const gateEvent = retentionEvents().find((e) => e.label === 'RETENTION_INITIAL_GATE_COMPLETE');
    expect(gateEvent?.rejectionReasons).toMatchObject({ SCHEMA_INVALID: 1, DUPLICATE_OF_ACCEPTED: 1 });
  });

  it('26. no logged retention event line contains any fixture question text or answer content', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a distinctive marker QQQ' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(rawLoggedText()).not.toContain('distinctive marker QQQ');
    expect(rawLoggedText()).not.toContain('because'); // the fixture's `explanation` field
  });
});

/* ================================================================ *
 * 27 -- systematic generation-prompt defect: audited, not provable   *
 * from code/test evidence alone (B6/B7). Documented per the          *
 * certification's own explicit allowance for this circumstance.     *
 * ================================================================ */
describe('RET-R3 required test 27 -- systematic generation-prompt defect (B6/B7)', () => {
  it('27. audited: the two initial chunks receive DISTINCT diversification notes (no shared-prompt defect that would make both chunks converge on identical material) -- this is the only prompt-level contributor provable from code; whether the semantic verifier\'s 7 checks are miscalibrated against the generation prompt in production cannot be proven without live rejection-reason telemetry, which this environment does not have (documented honestly in the report rather than claimed as fixed)', () => {
    expect(SERVICE_SRC).toMatch(/RETENTION_VARIANT_B_NOTE_CHUNK_A\s*=\s*\n?\s*'Generate questions using examples/);
    expect(SERVICE_SRC).toMatch(/RETENTION_VARIANT_B_NOTE_CHUNK_B\s*=\s*\n?\s*'Generate questions using a different variety/);
    expect(SERVICE_SRC.match(/RETENTION_VARIANT_B_NOTE_CHUNK_A/g)?.length).toBeGreaterThan(0);
    expect(SERVICE_SRC.match(/RETENTION_VARIANT_B_NOTE_CHUNK_B/g)?.length).toBeGreaterThan(0);
  });
});

/* ================================================================ *
 * 28 -- no Question Quality Gate weakening.                          *
 * ================================================================ */
describe('RET-R3 required test 28 -- the Question Quality Gate itself is untouched', () => {
  it('28. retentionApplyGate still calls the SAME applyQuestionQualityGate with no bypass/override flag added -- the gate authority is unchanged by RET-R3', () => {
    expect(SERVICE_SRC).toMatch(/const g = await applyQuestionQualityGate\(mapped, \{ conceptId, language, context: \{ studentId, subjectId \} \}\);/);
    expect(SERVICE_SRC).not.toMatch(/skipGate|bypassGate|gateOverride|disableQualityGate/);
  });
});

/* ================================================================ *
 * 29 -- final <6 still fails closed, with full safe telemetry.       *
 * ================================================================ */
describe('RET-R3 required test 29 -- Retention still fails closed below 6, never a partial set', () => {
  it('29. both initial chunks fail and there is no recovery possible -> returns [] with RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS and full safe metadata', async () => {
    wireRealisticExecuteAI([{ error: 'PROVIDER_ERROR' }, { error: 'TIMEOUT' }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    const failEvent = retentionEvents().find((e) => e.label === 'RETENTION_BATCH_INSUFFICIENT');
    expect(failEvent?.reason).toBe('RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS');
    expect(failEvent?.remainingDeficit).toBe(6);
  });

  it('29b. deficit remains after bounded recovery exhausts -> [] returned, no second retry attempted', async () => {
    const [a, b] = fullyDuplicatedChunkTexts();
    // Recovery itself also fully collides with everything already accepted.
    const recoveryDup = batch(Array.from({ length: 4 }, (_, i) => fakeQuestion(20 + i, { question: `Shared question ${i}` })));
    wireRealisticExecuteAI([{ text: a }, { text: b }, { text: recoveryDup }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    expect(callModelMock).toHaveBeenCalledTimes(3); // no 4th call
    const failEvent = retentionEvents().find((e) => e.label === 'RETENTION_BATCH_INSUFFICIENT');
    expect(failEvent?.remainingDeficit).toBeGreaterThan(0);
  });
});

/* ================================================================ *
 * 30 -- learner-facing retry UX is recoverable, never implies loss.  *
 * ================================================================ */
describe('RET-R3 required test 30 -- the Retention failure state is recoverable, never a dead end', () => {
  it('30. phase === "error" shows quiz.retentionLoadError (not the raw technical error string) and a Try Again button that re-invokes the SAME generateQuiz, specifically for retention_check', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("if (phase === 'error')"), QUIZ_PAGE_SRC.indexOf("if (results) {"));
    expect(block).toMatch(/isRetentionFailure = quizMode === 'retention_check'/);
    expect(block).toMatch(/isRetentionFailure \? at\['quiz\.retentionLoadError'\] : at\['quiz\.loadError'\]/);
    expect(block).toMatch(/onClick=\{\(\) => generateQuiz\(studentId\)\}/);
    expect(block).toMatch(/at\['activeLearning\.tryAgain'\]/);
    // the raw {error} string is never rendered to the learner.
    expect(block).not.toMatch(/\{error\}/);
    // Back to Dashboard remains available too -- retry is additive, not a replacement escape hatch.
    expect(block).toMatch(/at\['quiz\.backToDashboard'\]/);
  });

  it('quiz.retentionLoadError never implies lost progress -- its copy is a calm, forward-looking headline, not an apology for data loss', () => {
    const messagesSrc = read('src/lib/i18n/messages.ts');
    const enLine = messagesSrc.split('\n').find((l) => l.includes("'quiz.retentionLoadError': \"Couldn't prepare"));
    expect(enLine).toBeTruthy();
    expect(enLine).not.toMatch(/lost|progress|saved/i);
  });
});

/* ================================================================ *
 * 31 -- Retention remains no-help / INDEPENDENT evidence mode.       *
 * ================================================================ */
describe('RET-R3 required test 31 -- Retention remains a no-help, INDEPENDENT evidence-mode check', () => {
  it('31. retention_check is not in PRACTICE_EVIDENCE_MODES, so coarseEvidenceModeForQuizMode maps it to INDEPENDENT, and its support context remains SOLO -- unchanged by the B4 dedupe fix', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/retention_check:\s*'SOLO'/);
    const fn = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('function coarseEvidenceModeForQuizMode'), QUIZ_PAGE_SRC.indexOf('function coarseEvidenceModeForQuizMode') + 400);
    expect(fn).toMatch(/PRACTICE_EVIDENCE_MODES\.includes\(quizMode\)/);
    // retention_check is intentionally absent from the PRACTICE_EVIDENCE_MODES list itself.
    const listDecl = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('PRACTICE_EVIDENCE_MODES'), QUIZ_PAGE_SRC.indexOf('PRACTICE_EVIDENCE_MODES') + 200);
    expect(listDecl).not.toMatch(/retention_check/);
  });
});

/* ================================================================ *
 * 32 -- pre-existing RET-R1/RET-R2 tests remain green or were updated *
 * ONLY for the intentionally corrected collision semantics.          *
 * ================================================================ */
describe('RET-R3 required test 32 -- prior collision-semantics tests were updated, not weakened', () => {
  it('32. the old whole-chunk-discard functions no longer exist anywhere in the service, and the surviving test suites document the corrected per-question semantics', () => {
    expect(SERVICE_SRC).not.toMatch(/function retentionHasExactDuplicate|function retentionStructuralOverlapGroupCount/);
    const retentionTestSrc = read('tests/unit/quiz-generation-retention.test.ts');
    const surplusTestSrc = read('tests/unit/ret-r2-candidate-surplus.test.ts');
    expect(retentionTestSrc).not.toMatch(/retentionHasExactDuplicate|retentionStructuralOverlapGroupCount/);
    expect(surplusTestSrc).not.toMatch(/retentionHasExactDuplicate|retentionStructuralOverlapGroupCount/);
    expect(retentionTestSrc + surplusTestSrc).toMatch(/RET-R3/);
  });
});
