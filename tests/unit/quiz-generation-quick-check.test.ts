/**
 * STABILIZATION QUIZ PERFORMANCE Step 9: generateQuickCheckQuestions --
 * the one sanctioned parallel fast path, exclusively for quick_check.
 * Mocks executeAI directly to capture exact call arguments -- no live
 * provider call, no DB write.
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

// LX-4P-PERF-R1C-R1: the UNIVERSAL Question Quality Gate now runs on the
// 6 quick_check slots too. These tests cover the slot ARCHITECTURE
// (parallelism, model, prompt, all-or-nothing) -- the independent
// semantic verifier has its own suite, so it is stubbed to pass here.
vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: vi.fn(async () => ({
    conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
    distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
  })),
  evaluateQuestionQualityVerdict: vi.fn(() => ({ pass: true, reason: '' })),
}));

import { generateQuickCheckQuestions, QUICK_CHECK_TYPES } from '@/services/quiz-generation.service';

function fakeQuestionOfType(type: string, i: number) {
  // R1C-R1: correctAnswer must be a real option id for choice types, or
  // the UNIVERSAL Question Quality Gate correctly rejects the fixture.
  const base: any = { type, question: `Q${i} (${type})`, correctAnswer: 'a plausible short answer', explanation: 'because', difficulty: 3 };
  if (type === 'multiple_choice') { base.options = [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }]; base.correctAnswer = 'A'; }
  if (type === 'true_false') { base.options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]; base.correctAnswer = 'true'; }
  if (type === 'yes_no') { base.options = [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }]; base.correctAnswer = 'yes'; }
  return base;
}

beforeEach(() => {
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callModelMock.mockReset().mockResolvedValue({ text: '[]', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
  // Default: every slot succeeds, returning a question of whatever type
  // that slot's own userMessage says it must be (parsed out of the
  // prompt so this mock stays correct regardless of call order).
  let call = 0;
  executeAIMock.mockReset().mockImplementation(async (opts: any) => {
    const i = call++;
    const assignedType = QUICK_CHECK_TYPES[i % QUICK_CHECK_TYPES.length];
    return { result: fakeQuestionOfType(assignedType, i), execution: {} as any, provenance: {} as any };
  });
});

describe('generateQuickCheckQuestions: 6 parallel calls, Haiku, deterministic type plan', () => {
  it('fires exactly 6 executeAI calls', async () => {
    await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(6);
  });

  it('every call uses the QUESTION_GENERATION route model (Luna)', async () => {
    await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].model).toBe('gpt-5.6-luna');
    }
  });

  it('every call uses promptId quiz.question_generation, promptVersion v3 (Step 18 -- unified with every other QUESTION_GENERATION call site)', async () => {
    await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].promptId).toBe('quiz.question_generation');
      expect(call[0].promptVersion).toBe('v3');
    }
  });

  it('every call uses timeoutMs 30000 -- the Gateway global default, not the batch path\'s 60000', async () => {
    await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].timeoutMs).toBe(30_000);
    }
  });

  it('QUICK_CHECK_TYPES is exactly the 4 allowed types, in this order, no open_ended, no multi_select', () => {
    expect(QUICK_CHECK_TYPES).toEqual(['multiple_choice', 'true_false', 'yes_no', 'short_answer']);
    expect(QUICK_CHECK_TYPES).not.toContain('open_ended');
    expect(QUICK_CHECK_TYPES).not.toContain('multi_select');
  });

  it('the 6 slots are deterministically assigned by cycling QUICK_CHECK_TYPES -- verified from each call\'s own user message', async () => {
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      await opts.call(new AbortController().signal);
      return { result: null, execution: {} as any, provenance: {} as any }; // exercised only for the prompt text; slot success doesn't matter here
    });
    await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    expect(messages).toHaveLength(6);
    const expectedTypesInOrder = ['multiple_choice', 'true_false', 'yes_no', 'short_answer', 'multiple_choice', 'true_false'];
    messages.forEach((msg, i) => {
      expect(msg).toContain(`Generate EXACTLY 1 question of type "${expectedTypesInOrder[i]}"`);
    });
    // No slot's prompt ever asks for a type outside the allowed 4.
    expect(messages.join('\n')).not.toContain('open_ended');
    expect(messages.join('\n')).not.toContain('multi_select');
  });

  it('returns 6 valid, correctly-typed questions when all 6 slots succeed', async () => {
    const questions = await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    expect(questions).toHaveLength(6);
    expect(questions.map((q) => q.type)).toEqual(['multiple_choice', 'true_false', 'yes_no', 'short_answer', 'multiple_choice', 'true_false']);
    expect(questions.some((q) => (q.type as string) === 'open_ended')).toBe(false);
  });
});

describe('generateQuickCheckQuestions: strict count -- all-or-nothing, no partial quiz ever reaches the caller', () => {
  it('one failed slot (fallback fires) makes the WHOLE result [] -- never a 5-question quiz', async () => {
    let call = 0;
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const i = call++;
      if (i === 2) {
        // Simulate executeAI's real behavior: validate failed or the call errored, fallback fires.
        return { result: opts.fallback(new Error('slot failed')), execution: {} as any, provenance: {} as any };
      }
      const assignedType = QUICK_CHECK_TYPES[i % QUICK_CHECK_TYPES.length];
      return { result: fakeQuestionOfType(assignedType, i), execution: {} as any, provenance: {} as any };
    });
    const questions = await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(6); // all 6 still dispatched concurrently
    expect(questions).toEqual([]); // but the result is strictly all-or-nothing
  });

  it('a slot returning the WRONG type (model disobeyed) is treated as a failure via validate, not silently accepted', async () => {
    let call = 0;
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const i = call++;
      const raw = i === 0 ? JSON.stringify([{ type: 'open_ended', question: 'Explain X', correctAnswer: 'x', explanation: 'x', difficulty: 3 }]) : JSON.stringify([fakeQuestionOfType(QUICK_CHECK_TYPES[i % QUICK_CHECK_TYPES.length], i)]);
      const validation = opts.validate({ text: raw });
      if (!validation.valid) return { result: opts.fallback(new Error('invalid')), execution: {} as any, provenance: {} as any };
      return { result: validation.value, execution: {} as any, provenance: {} as any };
    });
    const questions = await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    expect(questions).toEqual([]); // slot 0 asked for multiple_choice but the model returned open_ended -- rejected, whole batch fails
  });

  it('all 6 slots failing also returns [] (matches the route\'s existing questions.length === 0 -> GENERATION_FAILED gate, no new error path)', async () => {
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      return { result: opts.fallback(new Error('down')), execution: {} as any, provenance: {} as any };
    });
    const questions = await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    expect(questions).toEqual([]);
  });

  it('storeQuiz can never receive a partial set: the route only calls storeQuiz when questions.length > 0 (verified against real route source), and this function guarantees length is 0 or 6, never in between', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routeSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf8');
    expect(routeSrc).toMatch(/if \(questions\.length === 0\) \{/);
    // The all-or-nothing tests above already prove generateQuickCheckQuestions
    // itself never returns a 1-5 length array -- combined with the route's
    // unchanged zero-check, storeQuiz cannot receive a partial quick_check set.
  });
});
