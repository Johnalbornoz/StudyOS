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
  // LX-9R3 D3: applyQuestionQualityGate batches semantic verification
  // when more than one candidate needs it -- this mock must answer
  // BOTH call shapes with equivalent (always-pass) verdicts.
  verifyQuestionQualityBatch: vi.fn(async ({ candidates }: any) =>
    new Map(candidates.map((c: any) => [c.id, {
      conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
      distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
    }]))
  ),
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

/**
 * LX-9R6-R1 C2/C3: most tests below now need each SUCCESSFUL chunk call
 * to deliver its own FULL requested chunkSize -- not just "a" question --
 * so the aggregate published count actually reaches `count` and the
 * new deficit-recovery round never fires as an unplanned side effect of
 * a test fixture that (unlike a real model) always produces exactly one
 * question regardless of what was asked. `distinctFullChunks` builds a
 * call-index-aware mock: each call index `i` in `plan` returns `plan[i]`
 * distinct fake questions (globally unique text across every call), so
 * cross-chunk dedup never accidentally collides two chunks either.
 */
function distinctFullChunks(plan: number[]): (opts: any) => Promise<any> {
  let call = 0;
  return async () => {
    const i = call++;
    const size = plan[i] ?? 1;
    return { result: Array.from({ length: size }, (_, k) => fakeQuestion(i * 100 + k)), execution: {} as any, provenance: {} as any };
  };
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
  it('count=20 fires exactly 5 executeAI calls (valid Luna chunks -> no Terra) and publishes exactly 20', async () => {
    executeAIMock.mockReset().mockImplementation(distinctFullChunks(planChunks(20)));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(executeAIMock).toHaveBeenCalledTimes(5);
    expect(questions).toHaveLength(20); // LX-9R6-R1 C2: every chunk delivered its full share -- no deficit, no recovery call
  });

  it('count=10 fires exactly 3 executeAI calls and publishes exactly 10', async () => {
    executeAIMock.mockReset().mockImplementation(distinctFullChunks(planChunks(10)));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 10 });
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(questions).toHaveLength(10);
  });

  it('count=6 fires exactly 2 executeAI calls and publishes exactly 6', async () => {
    executeAIMock.mockReset().mockImplementation(distinctFullChunks(planChunks(6)));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 6 });
    expect(executeAIMock).toHaveBeenCalledTimes(2);
    expect(questions).toHaveLength(6);
  });

  it('every chunked call uses the QUESTION_GENERATION route model (Luna), promptVersion v3, timeoutMs 30000', async () => {
    executeAIMock.mockReset().mockImplementation(distinctFullChunks(planChunks(20)));
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].model).toBe('gpt-5.6-luna');
      expect(call[0].promptVersion).toBe('v3');
      expect(call[0].timeoutMs).toBe(30_000);
      expect(call[0].promptId).toBe('quiz.question_generation');
    }
  });

  it('the prompt wording sent per chunk is the unmodified legacy "UP TO N... fewer is fine" batch wording, not a rewritten one', async () => {
    let call = 0;
    const plan = planChunks(20);
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const i = call++;
      await opts.call(new AbortController().signal);
      const size = plan[i] ?? 1;
      return { result: Array.from({ length: size }, (_, k) => fakeQuestion(i * 100 + k)), execution: {} as any, provenance: {} as any };
    });
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    expect(messages).toHaveLength(5); // 5 valid Luna chunks, no Terra, no deficit recovery
    for (const msg of messages) {
      expect(msg).toContain('Generate UP TO 4 questions');
      expect(msg).toContain('fewer is fine');
      expect(msg).not.toContain('EXACTLY 1 question');
    }
  });
});

describe('generatePracticeQuestions: count > 4 -- the UNIVERSAL Question Quality Gate on each parallel chunk (R1C-R1), then aggregate deficit recovery (LX-9R6-R1 C2/C3)', () => {
  it('every chunk is gated; a chunk whose Luna output is empty fires ONE Terra regeneration of THAT chunk, closing the exact count with no aggregate recovery needed', async () => {
    let call = 0;
    const plan = planChunks(20); // [4,4,4,4,4]
    executeAIMock.mockReset().mockImplementation(async () => {
      const i = call++;
      // chunk index 2's Luna call (the 3rd) yields nothing; its Terra
      // retry (fires last, call index 5) recovers it FULLY (its own chunkSize).
      if (i === 2) return { result: [], execution: {} as any, provenance: {} as any };
      const size = i === 5 ? plan[2] : plan[i];
      return { result: Array.from({ length: size }, (_, k) => fakeQuestion(i * 100 + k)), execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    // 5 Luna + exactly 1 Terra (only the empty chunk) -- never a whole-batch Terra rerun, never an aggregate recovery call too.
    expect(executeAIMock).toHaveBeenCalledTimes(6);
    const models = executeAIMock.mock.calls.map((c) => c[0].model);
    expect(models.filter((m) => m === 'gpt-5.6-luna')).toHaveLength(5);
    expect(models.filter((m) => m === 'gpt-5.6-terra')).toHaveLength(1);
    expect(questions).toHaveLength(20); // LX-9R6-R1 C2: exact count, not merely ">0"
  });

  it('valid Luna chunks -> NO Terra call at all', async () => {
    executeAIMock.mockReset().mockImplementation(distinctFullChunks(planChunks(20)));
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(executeAIMock.mock.calls.every((c) => c[0].model === 'gpt-5.6-luna')).toBe(true);
  });

  it('a chunk whose Luna AND its own per-chunk Terra both come up empty leaves an aggregate deficit that the recovery round then closes exactly', async () => {
    let call = 0;
    const plan = planChunks(20); // [4,4,4,4,4] -- chunk index 2 contributes nothing at all, deficit = 4
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const i = call++;
      if (i === 2) return { result: [], execution: {} as any, provenance: {} as any }; // chunk 2 Luna empty
      if (i === 5) return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }; // chunk 2's own Terra also empty
      if (i === 6) return { result: Array.from({ length: 5 }, (_, k) => fakeQuestion(900 + k)), execution: {} as any, provenance: {} as any }; // the AGGREGATE recovery round (deficit 4 -> recoverySize 5), supplies enough distinct candidates
      return { result: Array.from({ length: plan[i] }, (_, k) => fakeQuestion(i * 100 + k)), execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(executeAIMock).toHaveBeenCalledTimes(7); // 5 Luna + 1 per-chunk Terra (still empty) + 1 aggregate recovery
    expect(questions).toHaveLength(20); // the deficit chunk 2 left behind was fully closed by the ONE aggregate recovery round
  });

  it('a chunk failing entirely AND the aggregate recovery round ALSO failing to close the gap -> generation fails closed ([]), never a shorter-than-requested quiz', async () => {
    let call = 0;
    const plan = planChunks(20);
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const i = call++;
      if (i === 2 || i === 5 || i === 6) return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }; // chunk 2 Luna, its own Terra, AND the aggregate recovery round all fail
      return { result: Array.from({ length: plan[i] }, (_, k) => fakeQuestion(i * 100 + k)), execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions).toEqual([]); // 16 of 20 is still short of the canonical required count -- never published
  });
});

describe('generatePracticeQuestions: exact-count publish contract -- LX-9R6-R1 C2/C3', () => {
  it('one failed chunk whose OWN per-chunk Terra retry succeeds fully -> exact-count delivery, exactly one extra (Terra) call, no aggregate recovery needed', async () => {
    let call = 0;
    const plan = planChunks(20);
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const i = call++;
      if (i === 2) return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any };
      const size = i === 5 ? plan[2] : plan[i];
      return { result: Array.from({ length: size }, (_, k) => fakeQuestion(i * 100 + k)), execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 }); // 5 chunks, 1 fails, its own Terra recovers it fully
    expect(executeAIMock).toHaveBeenCalledTimes(6); // 5 Luna + 1 Terra (only the failed chunk) -- no aggregate recovery call
    expect(questions).toHaveLength(20);
  });

  it('all chunks failing returns [] (same GENERATION_FAILED signal every other path uses)', async () => {
    executeAIMock.mockReset().mockImplementation(async (opts: any) => ({ result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions).toEqual([]);
  });

  it('merged result never exceeds requestedCount even if chunks over-deliver', async () => {
    let call = 0;
    executeAIMock.mockReset().mockImplementation(async () => {
      const base = call++ * 10;
      // Each "4-question" chunk maliciously returns 6 -- still must be capped at the requested total.
      return { result: Array.from({ length: 6 }, (_, i) => fakeQuestion(base + i)), execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions.length).toBeLessThanOrEqual(20);
    expect(questions).toHaveLength(20); // LX-9R6-R1 C2: over-delivery is capped at exactly the required count, not "some number <= 20"
  });

  it('no unbounded recovery loop: at most one aggregate recovery call is ever made, regardless of how large the deficit is', async () => {
    // Every chunk fails outright (deficit = 20), so the aggregate
    // recovery round fires exactly once, requests its own bounded
    // surplus, and -- however that recovery call resolves -- no SECOND
    // recovery round is ever attempted.
    let call = 0;
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const i = call++;
      if (i < 5) return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }; // all 5 initial chunks fail (fallbackWhen EMPTY -> no per-chunk Terra fires, since 'EMPTY' only recovers a fully-empty result... this test forces the aggregate path)
      return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }; // the one aggregate recovery call also fails
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    // 5 Luna (all empty, so each ALSO fires its own per-chunk Terra fallback = +5) + exactly 1 aggregate recovery = 11, never more.
    expect(executeAIMock).toHaveBeenCalledTimes(11);
    expect(questions).toEqual([]);
  });
});

describe('generatePracticeQuestions: deterministic cross-chunk duplicate removal, then aggregate recovery closes whatever deficit dedup left behind (LX-9R6-R1 C2/C3)', () => {
  it('two chunks sharing one exact-duplicate question text still reach the exact requested count -- the duplicate is removed, and the aggregate recovery round closes the resulting 1-question deficit', async () => {
    let call = 0;
    const plan = planChunks(6); // [3, 3]
    executeAIMock.mockReset().mockImplementation(async () => {
      const i = call++;
      if (i === 0) return { result: [fakeQuestion(0, 'What is a fraction?'), fakeQuestion(1), fakeQuestion(2)], execution: {} as any, provenance: {} as any };
      if (i === 1) return { result: [fakeQuestion(10, 'What is a fraction?'), fakeQuestion(11), fakeQuestion(12)], execution: {} as any, provenance: {} as any }; // shares chunk 0's first text
      return { result: [fakeQuestion(99, 'Recovery question')], execution: {} as any, provenance: {} as any }; // aggregate recovery round (i===2), closes the 1-question deficit dedup left
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 6 });
    const texts = questions.map((q) => q.question);
    expect(texts.filter((t) => t === 'What is a fraction?')).toHaveLength(1); // still deduped to one copy
    expect(questions).toHaveLength(6); // LX-9R6-R1 C2: the deficit dedup left behind is closed, never published short
  });

  it('duplicates differing only by whitespace/case are still caught (normalizeText + case-fold), and the resulting deficit is closed the same way', async () => {
    let call = 0;
    executeAIMock.mockReset().mockImplementation(async () => {
      const i = call++;
      if (i === 0) return { result: [fakeQuestion(0, 'What   is a Fraction?'), fakeQuestion(1), fakeQuestion(2)], execution: {} as any, provenance: {} as any };
      if (i === 1) return { result: [fakeQuestion(10, 'what is a fraction?'), fakeQuestion(11), fakeQuestion(12)], execution: {} as any, provenance: {} as any };
      return { result: [fakeQuestion(99, 'Recovery question')], execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 6 });
    const texts = questions.map((q) => q.question.toLowerCase().replace(/\s+/g, ' '));
    expect(texts.filter((t) => t === 'what is a fraction?')).toHaveLength(1); // one of the two near-identical (whitespace/case only) texts removed
    expect(questions).toHaveLength(6);
  });

  it('every chunk returning the SAME text can never reach a count > 1 -- fails closed rather than publishing the single surviving duplicate as a shorter quiz', async () => {
    // LX-9R6-R1: before this phase, a total collapse to one surviving
    // duplicate across every chunk (AND the aggregate recovery round,
    // which sees the exact same fixture) was accepted as "the dedup
    // logic worked, so 1 question is fine." It no longer is: StudyUS
    // decided this activity needs `count` questions, and 1 is not that.
    executeAIMock.mockReset().mockImplementation(async () => ({ result: [fakeQuestion(0, 'Same question every time')], execution: {} as any, provenance: {} as any }));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions).toEqual([]);
  });

  it('a fully empty merged result (every chunk failed) still returns [] -- dedup never turns a real failure into a false success', async () => {
    executeAIMock.mockReset().mockImplementation(async (opts: any) => ({ result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any }));
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    expect(questions).toEqual([]);
  });
});
