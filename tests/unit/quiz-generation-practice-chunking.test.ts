/**
 * STABILIZATION QUIZ PERFORMANCE Step 14: planChunks + the topic_practice/
 * review chunked fast path (generatePracticeQuestions). Mocks executeAI
 * directly to capture exact call arguments -- no live provider call, no
 * DB write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// LX-4P-PERF-R1C-R1: the UNIVERSAL Question Quality Gate runs on every
// generated batch/chunk. These tests are about the chunking ARCHITECTURE
// (parallelism, call count, prompt wording, dedup, partial tolerance) --
// the independent semantic verifier has its own suite, so it is stubbed
// to a passing verdict here.
vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: vi.fn(async () => ({
    conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
    distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
  })),
  evaluateQuestionQualityVerdict: vi.fn(() => ({ pass: true, reason: '' })),
}));

import { planChunks, MAX_QUESTIONS_PER_CHUNK, generatePracticeQuestions } from '@/services/quiz-generation.service';

beforeEach(() => {
  // Default: every chunk returns one structurally valid question -> it
  // clears the gate, so no Terra fallback fires (REQUIRED TEST 3).
  executeAIMock.mockReset().mockResolvedValue({ result: [fakeQuestion(0)], execution: {} as any, provenance: {} as any });
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callModelMock.mockReset().mockResolvedValue({ text: '[]', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
});

function fakeQuestion(i: number, question?: string) {
  return { type: 'multiple_choice', question: question ?? `Q${i}`, options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctAnswer: 'A', explanation: 'because', difficulty: 3 };
}

describe('planChunks: pure, deterministic balanced planner', () => {
  it('MAX_QUESTIONS_PER_CHUNK is 4', () => {
    expect(MAX_QUESTIONS_PER_CHUNK).toBe(4);
  });

  const cases: Array<[number, number[]]> = [
    [1, [1]],
    [2, [2]],
    [3, [3]],
    [4, [4]],
    [5, [3, 2]],
    [6, [3, 3]],
    [10, [4, 3, 3]],
    [20, [4, 4, 4, 4, 4]],
  ];
  for (const [n, expected] of cases) {
    it(`planChunks(${n}) === ${JSON.stringify(expected)}`, () => {
      expect(planChunks(n)).toEqual(expected);
    });
  }

  it('every plan sums to the requested count', () => {
    for (let n = 1; n <= 20; n++) {
      expect(planChunks(n).reduce((s, x) => s + x, 0)).toBe(n);
    }
  });

  it('no chunk in any plan ever exceeds MAX_QUESTIONS_PER_CHUNK', () => {
    for (let n = 1; n <= 20; n++) {
      for (const c of planChunks(n)) expect(c).toBeLessThanOrEqual(MAX_QUESTIONS_PER_CHUNK);
    }
  });
});

describe('generatePracticeQuestions: count <= 4 goes through the Luna-first Quality Gate (no chunking machinery)', () => {
  // LX-4P-PERF-R1C C7: the small-count canonical path no longer bare-delegates
  // to a single generator call -- it runs generateGatedPracticeBatch (Luna
  // generate -> quality gate -> one Terra fallback). With the mocked
  // executeAI returning [] every time, that is: 1 Luna generate + 1 Terra
  // generate (the gate has nothing to verify), then a recoverable [].
  it('count=4: the first generate call is a single Luna call at v3 (not a Haiku chunk fan-out)', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 4 });
    const call = executeAIMock.mock.calls[0][0];
    expect(call.capability).toBe('QUESTION_GENERATION');
    expect(call.model).toBe('gpt-5.6-luna');
    expect(call.promptVersion).toBe('v3');
    // at most 2 QUESTION_GENERATION calls (Luna + one Terra fallback) -- never a 5x chunk fan-out
    const genCalls = executeAIMock.mock.calls.filter((c) => c[0].capability === 'QUESTION_GENERATION');
    expect(genCalls.length).toBeLessThanOrEqual(2);
  });

  it('count=4: the fallback generate call, when it happens, is Terra -- never a Claude model', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 4 });
    const genCalls = executeAIMock.mock.calls.filter((c) => c[0].capability === 'QUESTION_GENERATION');
    for (const c of genCalls) expect(['gpt-5.6-luna', 'gpt-5.6-terra']).toContain(c[0].model);
  });

  it('count=1 also goes through the gated path (never a lone chunk), first call = Luna', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 1 });
    expect(executeAIMock.mock.calls[0][0].model).toBe('gpt-5.6-luna');
  });
});

describe('generatePracticeQuestions: count > 4 fans out into gated parallel Luna chunks', () => {
  it('count=20 fires exactly 5 executeAI calls (valid Luna chunks -> no Terra)', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(executeAIMock).toHaveBeenCalledTimes(5);
  });

  it('count=10 fires exactly 3 executeAI calls', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 10 });
    expect(executeAIMock).toHaveBeenCalledTimes(3);
  });

  it('count=6 fires exactly 2 executeAI calls', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 6 });
    expect(executeAIMock).toHaveBeenCalledTimes(2);
  });

  it('every chunked call uses the QUESTION_GENERATION route model (Luna), promptVersion v3, timeoutMs 30000', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].model).toBe('gpt-5.6-luna');
      expect(call[0].promptVersion).toBe('v3');
      expect(call[0].timeoutMs).toBe(30_000);
      expect(call[0].promptId).toBe('quiz.question_generation');
    }
  });

  it('the prompt wording sent per chunk is the unmodified legacy "UP TO N... fewer is fine" batch wording, not a rewritten one', async () => {
    executeAIMock.mockImplementation(async (opts: any) => {
      await opts.call(new AbortController().signal);
      return { result: [fakeQuestion(0)], execution: {} as any, provenance: {} as any };
    });
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    expect(messages).toHaveLength(5); // 5 valid Luna chunks, no Terra
    for (const msg of messages) {
      expect(msg).toContain('Generate UP TO 4 questions');
      expect(msg).toContain('fewer is fine');
      expect(msg).not.toContain('EXACTLY 1 question');
    }
  });
});

describe('generatePracticeQuestions: count > 4 -- the UNIVERSAL Question Quality Gate on each parallel chunk (R1C-R1)', () => {
  it('every chunk is gated; a chunk whose Luna output is empty fires ONE Terra regeneration of THAT chunk only', async () => {
    let call = 0;
    executeAIMock.mockImplementation(async () => {
      const i = call++;
      // chunk index 2's Luna call (the 3rd) yields nothing; its Terra
      // retry (fires last, call index 5) recovers it.
      if (i === 2) return { result: [], execution: {} as any, provenance: {} as any };
      return { result: [fakeQuestion(i)], execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    // 5 Luna + exactly 1 Terra (only the empty chunk) -- never a whole-batch Terra rerun.
    expect(executeAIMock).toHaveBeenCalledTimes(6);
    const models = executeAIMock.mock.calls.map((c) => c[0].model);
    expect(models.filter((m) => m === 'gpt-5.6-luna')).toHaveLength(5);
    expect(models.filter((m) => m === 'gpt-5.6-terra')).toHaveLength(1);
    expect(questions.length).toBeGreaterThan(0);
  });

  it('valid Luna chunks -> NO Terra call at all', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(executeAIMock.mock.calls.every((c) => c[0].model === 'gpt-5.6-luna')).toBe(true);
  });

  it('a Terra chunk that still fails the gate -> its invalid questions never reach the learner (PRACTICE stays partial-tolerant, never [])', async () => {
    let call = 0;
    executeAIMock.mockImplementation(async (opts: any) => {
      const i = call++;
      if (i === 2) return { result: [], execution: {} as any, provenance: {} as any }; // chunk 2 Luna empty
      if (i === 5) return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }; // chunk 2 Terra also empty
      return { result: [fakeQuestion(i)], execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions.length).toBeGreaterThan(0); // the 4 healthy chunks still delivered
    expect(questions.length).toBeLessThan(5); // chunk 2 contributed nothing -- partial, not all-or-nothing
  });
});

describe('generatePracticeQuestions: PRACTICE partial-failure semantics -- never all-or-nothing', () => {
  it('one failed chunk whose Terra retry succeeds -> full delivery, exactly one extra (Terra) call', async () => {
    let call = 0;
    executeAIMock.mockImplementation(async (opts: any) => {
      const i = call++;
      if (i === 2) return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any };
      return { result: [fakeQuestion(i)], execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 }); // 5 chunks, 1 fails, its Terra recovers
    expect(executeAIMock).toHaveBeenCalledTimes(6); // 5 Luna + 1 Terra (only the failed chunk)
    expect(questions.length).toBe(5);
  });

  it('all chunks failing returns [] (same GENERATION_FAILED signal every other path uses)', async () => {
    executeAIMock.mockImplementation(async (opts: any) => ({ result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions).toEqual([]);
  });

  it('merged result never exceeds requestedCount even if chunks over-deliver', async () => {
    let call = 0;
    executeAIMock.mockImplementation(async () => {
      const base = call++ * 10;
      // Each "4-question" chunk maliciously returns 6 -- still must be capped at the requested total.
      return { result: Array.from({ length: 6 }, (_, i) => fakeQuestion(base + i)), execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions.length).toBeLessThanOrEqual(20);
  });
});

describe('generatePracticeQuestions: deterministic cross-chunk duplicate removal', () => {
  it('two chunks returning the exact same question text keep only one copy', async () => {
    let call = 0;
    executeAIMock.mockImplementation(async () => {
      const i = call++;
      // chunk 0 and chunk 1 both produce "What is a fraction?" -- everything else distinct.
      const q = i < 2 ? fakeQuestion(i, 'What is a fraction?') : fakeQuestion(i);
      return { result: [q], execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 }); // 5 chunks x 1 question each in this mock
    const texts = questions.map((q) => q.question);
    expect(texts.filter((t) => t === 'What is a fraction?')).toHaveLength(1);
    expect(questions.length).toBe(4); // 5 produced, 1 removed as a duplicate
  });

  it('duplicates differing only by whitespace/case are still caught (normalizeText + case-fold)', async () => {
    let call = 0;
    executeAIMock.mockImplementation(async () => {
      const i = call++;
      const q = i === 0 ? fakeQuestion(i, 'What   is a Fraction?') : i === 1 ? fakeQuestion(i, 'what is a fraction?') : fakeQuestion(i);
      return { result: [q], execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions.length).toBe(4); // one of the two near-identical (whitespace/case only) texts removed
  });

  it('a result where every chunk returns the same text keeps exactly one surviving copy (dedup keeps the first occurrence, not zero)', async () => {
    executeAIMock.mockImplementation(async () => ({ result: [fakeQuestion(0, 'Same question every time')], execution: {} as any, provenance: {} as any }));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe('Same question every time');
  });

  it('a fully empty merged result (every chunk failed) still returns [] -- dedup never turns a real failure into a false success', async () => {
    executeAIMock.mockImplementation(async (opts: any) => ({ result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions).toEqual([]);
  });
});
