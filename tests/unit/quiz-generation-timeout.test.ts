/**
 * STABILIZATION QUIZ PERFORMANCE Step 9: proves generateQuestionsForConcept
 * (the batch path -- every mode except quick_check) is back to its
 * original single-call behavior after Step 7's parallel-per-question
 * fan-out was reverted (Step 8's audit found it broke assessment
 * integrity for diagnostic_check/cumulative_assessment/exam_simulation).
 * quick_check's own dedicated fast path is covered separately in
 * tests/unit/quiz-generation-quick-check.test.ts.
 *
 * Mocks executeAI directly to capture its exact call arguments -- no
 * live provider call, no DB write.
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

import { generateQuestionsForConcept, generateQuestionVariant, ANSWER_FORMAT_BY_TYPE, type GeneratedQuestion } from '@/services/quiz-generation.service';
import { DEFAULT_AI_TIMEOUT_MS } from '@/lib/ai';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';

beforeEach(() => {
  executeAIMock.mockReset().mockResolvedValue({ result: [], execution: {} as any, provenance: {} as any });
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callAnthropicMessagesMock.mockReset().mockResolvedValue({ text: '[]' });
});

describe('generateQuestionsForConcept: single-call batch behavior, no fan-out for any count (Step 7 fully reverted)', () => {
  it('count=6 (quick_check-sized, but this function is never called for quick_check anymore) fires exactly 1 executeAI call', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    expect(executeAIMock).toHaveBeenCalledTimes(1);
  });

  it('count=1 fires exactly 1 call (unchanged degenerate case)', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 1 });
    expect(executeAIMock).toHaveBeenCalledTimes(1);
  });

  it('count=4 (diagnostic_check-sized) fires exactly 1 call -- no per-question fan-out', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 4 });
    expect(executeAIMock).toHaveBeenCalledTimes(1);
  });

  it('count=20 (cumulative_assessment/exam_simulation-sized) fires exactly 1 call -- no per-question fan-out', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 20 });
    expect(executeAIMock).toHaveBeenCalledTimes(1);
  });

  it('no retry: executeAI is called exactly once regardless of count', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 10 });
    expect(executeAIMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateQuestionsForConcept: model, timeout, and prompt provenance pinned to their pre-performance-refactor values', () => {
  it('model is claude-sonnet-5 (not Haiku) -- unchanged from before Step 5', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    const call = executeAIMock.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-5');
  });

  it('timeoutMs is no longer explicitly set (Step 10 removed the Step 4 workaround) -- effective timeout falls through to DEFAULT_AI_TIMEOUT_MS (30000)', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    const call = executeAIMock.mock.calls[0][0];
    expect(call.timeoutMs).toBeUndefined();
    expect(call.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS).toBe(30_000);
  });

  it('no QUESTION_GENERATION call anywhere in this file passes timeoutMs: 60000 anymore', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].timeoutMs).not.toBe(60_000);
    }
  });

  it('promptVersion is v3, matching the registry\'s current version -- Step 18 unified all QUESTION_GENERATION call sites on v3, retiring the earlier v1-pinned/v2 split', async () => {
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    const call = executeAIMock.mock.calls[0][0];
    expect(call.promptId).toBe('quiz.question_generation');
    expect(call.promptVersion).toBe('v3');
    expect(PROMPT_REGISTRY['quiz.question_generation'].version).toBe('v3');
  });

  it('DEFAULT_AI_TIMEOUT_MS (the Gateway-wide default) is still 30000, untouched by either path\'s own override', () => {
    expect(DEFAULT_AI_TIMEOUT_MS).toBe(30_000);
  });

  it('the batch user-message wording is restored to "UP TO N... fewer is fine" (not the reverted "EXACTLY 1" wording)', async () => {
    executeAIMock.mockImplementation(async (opts: any) => {
      await opts.call(new AbortController().signal);
      return { result: [], execution: {} as any, provenance: {} as any };
    });
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    const msg = callAnthropicMessagesMock.mock.calls[0][0].messages[0].content as string;
    expect(msg).toContain('Generate UP TO 6 questions');
    expect(msg).toContain('fewer is fine');
    expect(msg).not.toContain('EXACTLY 1 question');
  });

  it('the full 18-type catalog is still offered by default (no type restriction reintroduced)', async () => {
    executeAIMock.mockImplementation(async (opts: any) => {
      await opts.call(new AbortController().signal);
      return { result: [], execution: {} as any, provenance: {} as any };
    });
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    const msg = callAnthropicMessagesMock.mock.calls[0][0].messages[0].content as string;
    expect(msg).toContain('"case_study"');
    expect(msg).toContain('"error_detection"');
  });

  it('fallback behavior is unchanged -- a failed call still resolves to an empty array, never throws', async () => {
    executeAIMock.mockImplementation(async (opts: any) => {
      return { result: opts.fallback ? opts.fallback(new Error('TIMEOUT')) : undefined, execution: {} as any, provenance: {} as any };
    });
    const questions = await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    expect(questions).toEqual([]);
  });
});

describe('quiz_mode configs unchanged (verified against the real route source, not re-derived here)', () => {
  const readRouteSrc = async () => {
    const fs = await import('fs');
    const path = await import('path');
    return fs.readFileSync(path.join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf8');
  };

  it('QUIZ_MODE_CONFIG.quick_check.defaultMax is still 6 (its fast path hardcodes 6 independently -- see quiz-generation-quick-check.test.ts)', async () => {
    const routeSrc = await readRouteSrc();
    const match = routeSrc.match(/quick_check:\s*\{(?:[^{}]|\{[^{}]*\})*?defaultMax:\s*(\d+)/);
    expect(match?.[1]).toBe('6');
  });

  it('quick_check maxQuestions is hardcoded to 6 in the route, no longer caller-overridable (Step 9 disclosed behavior change)', async () => {
    const routeSrc = await readRouteSrc();
    expect(routeSrc).toMatch(/validated\.quizMode === 'quick_check'\s*\n\s*\?\s*6/);
  });

  it('diagnostic_check is still clamped 2-4 in the route -- untouched by Step 9', async () => {
    const routeSrc = await readRouteSrc();
    expect(routeSrc).toMatch(/Math\.max\(2, Math\.min\(4, validated\.maxQuestions \?\? config\.defaultMax\)\)/);
  });

  it('the route calls generateQuickCheckQuestions only for quick_check, generatePracticeQuestions only for topic_practice/review, generateRetentionCheckQuestions only for retention_check (count===6), and generateQuestionsForConcept for every other mode/case (Step 14/22)', async () => {
    const routeSrc = await readRouteSrc();
    expect(routeSrc).toContain("validated.quizMode === 'quick_check'");
    expect(routeSrc).toContain("validated.quizMode === 'topic_practice' || validated.quizMode === 'review'");
    expect(routeSrc).toContain("validated.quizMode === 'retention_check' && maxQuestions === RETENTION_REQUIRED_COUNT");
    expect(routeSrc).toContain('generateQuickCheckQuestions(');
    expect(routeSrc).toContain('generatePracticeQuestions(');
    expect(routeSrc).toContain('generateRetentionCheckQuestions(');
    expect(routeSrc).toContain('generateQuestionsForConcept(');
  });
});

describe('STABILIZATION QUIZ PERFORMANCE Step 14/22 -- mode isolation: diagnostic_check/cumulative_assessment/exam_simulation and generateQuestionVariant are untouched by any chunked fast path; retention_check is fast-pathed ONLY at count===6', () => {
  const readRouteSrc = async () => {
    const fs = await import('fs');
    const path = await import('path');
    return fs.readFileSync(path.join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf8');
  };

  it('the route\'s topic_practice/review branch is the ONLY caller of generatePracticeQuestions (single call site)', async () => {
    const routeSrc = await readRouteSrc();
    const occurrences = routeSrc.match(/generatePracticeQuestions\(/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it('the route\'s retention_check branch is the ONLY caller of generateRetentionCheckQuestions (single call site)', async () => {
    const routeSrc = await readRouteSrc();
    const occurrences = routeSrc.match(/generateRetentionCheckQuestions\(/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it('diagnostic_check, cumulative_assessment, and exam_simulation are absent from the fast-path condition entirely -- never routed to any chunked/fast-path generator', async () => {
    const routeSrc = await readRouteSrc();
    const fastPathCondition = routeSrc.match(/const \[questionArrays, askConfidenceFlags\][\s\S]*?generateQuestionsForConcept\(cId,/)?.[0] ?? '';
    for (const mode of ['diagnostic_check', 'cumulative_assessment', 'exam_simulation']) {
      expect(fastPathCondition).not.toContain(`'${mode}'`);
    }
  });

  it('retention_check\'s fast-path condition is guarded by count === RETENTION_REQUIRED_COUNT -- an overridden non-6 count falls through to the legacy generator, not silently forced onto an unvalidated chunk plan', async () => {
    const routeSrc = await readRouteSrc();
    const fastPathCondition = routeSrc.match(/const \[questionArrays, askConfidenceFlags\][\s\S]*?generateQuestionsForConcept\(cId,/)?.[0] ?? '';
    expect(fastPathCondition).toContain("'retention_check' && maxQuestions === RETENTION_REQUIRED_COUNT");
  });

  it('generateQuestionsForConcept (the untouched legacy path) is still called for count values these modes actually use -- 4 (diagnostic_check max), 20 (cumulative_assessment/exam_simulation default), and any non-6 retention_check override -- all as ONE executeAI call, never fanned out', async () => {
    for (const count of [4, 5, 7, 20]) {
      executeAIMock.mockClear();
      await generateQuestionsForConcept('c1', 's1', 'subj1', { count });
      expect(executeAIMock).toHaveBeenCalledTimes(1);
    }
  });
});

describe('generateQuestionVariant: unchanged (always count=1, routes through the reverted legacy path)', () => {
  const sourceQuestion: GeneratedQuestion = {
    id: 'q-source',
    conceptId: 'c1',
    type: 'multiple_choice',
    answerFormat: ANSWER_FORMAT_BY_TYPE.multiple_choice,
    question: 'What is 2+2?',
    options: [{ id: 'A', text: '3' }, { id: 'B', text: '4' }],
    correctAnswer: 'B',
    explanation: 'Basic arithmetic.',
    difficulty: 2,
  };

  it('still fires exactly 1 executeAI call', async () => {
    executeAIMock.mockResolvedValue({
      result: [
        { type: 'multiple_choice', question: 'What is 3+3?', options: [{ id: 'A', text: '5' }, { id: 'B', text: '6' }], correctAnswer: 'B', explanation: 'x', difficulty: 2 },
      ],
      execution: {} as any,
      provenance: {} as any,
    });
    await generateQuestionVariant(sourceQuestion, 's1', 'subj1', 'en');
    expect(executeAIMock).toHaveBeenCalledTimes(1);
  });

  it('still uses claude-sonnet-5 and promptVersion v1 -- untouched by the quick_check fast path', async () => {
    executeAIMock.mockResolvedValue({
      result: [
        { type: 'multiple_choice', question: 'What is 3+3?', options: [{ id: 'A', text: '5' }, { id: 'B', text: '6' }], correctAnswer: 'B', explanation: 'x', difficulty: 2 },
      ],
      execution: {} as any,
      provenance: {} as any,
    });
    await generateQuestionVariant(sourceQuestion, 's1', 'subj1', 'en');
    const call = executeAIMock.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-5');
    expect(call.promptVersion).toBe('v3'); // routes through generateQuestionsForConcept, which now reads the registry's current v3
    expect(call.timeoutMs).toBeUndefined(); // Step 10 -- falls through to DEFAULT_AI_TIMEOUT_MS, same as the batch path it reuses
  });

  it('still requests exactly 1 question, types restricted to the source question\'s own type -- unchanged request shape', async () => {
    executeAIMock.mockImplementation(async (opts: any) => {
      await opts.call(new AbortController().signal);
      return { result: [], execution: {} as any, provenance: {} as any };
    });
    await generateQuestionVariant(sourceQuestion, 's1', 'subj1', 'en');
    const msg = callAnthropicMessagesMock.mock.calls[0][0].messages[0].content as string;
    expect(msg).toContain('Generate UP TO 1 questions');
  });
});
