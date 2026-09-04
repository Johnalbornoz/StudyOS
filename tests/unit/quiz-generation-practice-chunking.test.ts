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

const callAnthropicMessagesMock = vi.fn();
vi.mock('@/lib/ai/adapters/anthropic', () => ({ callAnthropicMessages: (...a: any[]) => callAnthropicMessagesMock(...a) }));

import { planChunks, MAX_QUESTIONS_PER_CHUNK, generatePracticeQuestions } from '@/services/quiz-generation.service';

beforeEach(() => {
  executeAIMock.mockReset().mockResolvedValue({ result: [], execution: {} as any, provenance: {} as any });
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callAnthropicMessagesMock.mockReset().mockResolvedValue({ text: '[]' });
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

describe('generatePracticeQuestions: count <= 4 delegates to the unmodified legacy single-call path', () => {
  it('count=4 fires exactly 1 executeAI call (no chunking machinery)', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 4 });
    expect(executeAIMock).toHaveBeenCalledTimes(1);
  });

  it('count=4 call uses the legacy model (claude-sonnet-5) and v3 -- proves it truly reused generateQuestionsForConcept, not a parallel Haiku implementation', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 4 });
    const call = executeAIMock.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-5');
    expect(call.promptVersion).toBe('v3');
  });

  it('count=1 also delegates to the single-call path (never a lone chunk)', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 1 });
    expect(executeAIMock).toHaveBeenCalledTimes(1);
    expect(executeAIMock.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });
});

describe('generatePracticeQuestions: count > 4 fans out into chunked Haiku calls', () => {
  it('count=20 fires exactly 5 executeAI calls', async () => {
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

  it('every chunked call uses claude-haiku-4-5-20251001, promptVersion v3, timeoutMs 30000', async () => {
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].model).toBe('claude-haiku-4-5-20251001');
      expect(call[0].promptVersion).toBe('v3');
      expect(call[0].timeoutMs).toBe(30_000);
      expect(call[0].promptId).toBe('quiz.question_generation');
    }
  });

  it('the prompt wording sent per chunk is the unmodified legacy "UP TO N... fewer is fine" batch wording, not a rewritten one', async () => {
    executeAIMock.mockImplementation(async (opts: any) => {
      await opts.call(new AbortController().signal);
      return { result: [], execution: {} as any, provenance: {} as any };
    });
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    const messages = callAnthropicMessagesMock.mock.calls.map((c) => c[0].messages[0].content as string);
    expect(messages).toHaveLength(5);
    for (const msg of messages) {
      expect(msg).toContain('Generate UP TO 4 questions');
      expect(msg).toContain('fewer is fine');
      expect(msg).not.toContain('EXACTLY 1 question');
    }
  });
});

describe('generatePracticeQuestions: PRACTICE partial-failure semantics -- never all-or-nothing', () => {
  it('one failed chunk (fallback fires) still returns the other chunks\' valid questions', async () => {
    let call = 0;
    executeAIMock.mockImplementation(async (opts: any) => {
      const i = call++;
      if (i === 2) return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any };
      return { result: [fakeQuestion(i)], execution: {} as any, provenance: {} as any };
    });
    const questions = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 }); // 5 chunks, 1 fails
    expect(executeAIMock).toHaveBeenCalledTimes(5);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThan(5); // fewer chunks succeeded than the 5 planned -- proves partial delivery, not all-or-nothing
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
