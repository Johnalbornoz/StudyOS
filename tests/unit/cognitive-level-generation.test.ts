/**
 * Phase 3D: cognitive-level/question-intent liveness. Proves
 * generateQuestionsForConcept actually reads cognitiveLevel/questionIntent
 * back from the AI's raw output (previously silently dropped even when
 * present -- Phase 3 Master Implementation audit finding), and that only
 * a known enum value is ever accepted -- a typo, an out-of-set value, or
 * a missing field must degrade to `undefined`, never a fabricated guess.
 * Same mocked end-to-end pattern as ai-high-risk-regression.test.ts:
 * a real fetch mock returning a raw AI response, no live provider call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function anthropicTextResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
    text: async () => text,
  } as Response;
}

const originalFetch = global.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env.ANTHROPIC_API_KEY = originalKey;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('generateQuestionsForConcept -- Phase 3D cognitiveLevel/questionIntent', () => {
  it('reads a known cognitiveLevel and questionIntent through from the raw AI output', async () => {
    vi.doMock('@/services/rag.service', () => ({
      retrieveContext: vi.fn().mockResolvedValue({ chunks: [{ text: 'Newton’s Second Law: F = ma.' }] }),
    }));
    const { generateQuestionsForConcept } = await import('@/services/quiz-generation.service');

    global.fetch = vi.fn().mockResolvedValue(
      anthropicTextResponse(
        JSON.stringify([
          {
            type: 'short_answer',
            question: 'Apply F=ma to find force given m=2kg, a=3m/s^2.',
            correctAnswer: '6N',
            explanation: 'F = 2 * 3 = 6N.',
            difficulty: 3,
            cognitiveLevel: 'APPLICATION',
            questionIntent: 'CHECK_APPLICATION',
          },
        ])
      )
    ) as any;

    const questions = await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 1 });
    expect(questions).toHaveLength(1);
    expect(questions[0].cognitiveLevel).toBe('APPLICATION');
    expect(questions[0].questionIntent).toBe('CHECK_APPLICATION');
  });

  it('drops an unrecognized cognitiveLevel/questionIntent value to undefined instead of fabricating one', async () => {
    vi.doMock('@/services/rag.service', () => ({
      retrieveContext: vi.fn().mockResolvedValue({ chunks: [{ text: 'Newton’s Second Law: F = ma.' }] }),
    }));
    const { generateQuestionsForConcept } = await import('@/services/quiz-generation.service');

    global.fetch = vi.fn().mockResolvedValue(
      anthropicTextResponse(
        JSON.stringify([
          {
            type: 'short_answer',
            question: 'What is F=ma?',
            correctAnswer: 'Newton’s Second Law',
            explanation: 'x',
            difficulty: 2,
            cognitiveLevel: 'MASTERY', // not a real enum value
            questionIntent: 'VERIFICATION', // reserved for the calling context, never AI-generated
          },
        ])
      )
    ) as any;

    const questions = await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 1 });
    expect(questions).toHaveLength(1);
    expect(questions[0].cognitiveLevel).toBeUndefined();
    expect(questions[0].questionIntent).toBeUndefined();
  });

  it('leaves cognitiveLevel/questionIntent undefined when the AI omits them entirely -- never a fabricated default', async () => {
    vi.doMock('@/services/rag.service', () => ({
      retrieveContext: vi.fn().mockResolvedValue({ chunks: [{ text: 'Newton’s Second Law: F = ma.' }] }),
    }));
    const { generateQuestionsForConcept } = await import('@/services/quiz-generation.service');

    global.fetch = vi.fn().mockResolvedValue(
      anthropicTextResponse(
        JSON.stringify([
          { type: 'short_answer', question: 'What is F=ma?', correctAnswer: 'Newton’s Second Law', explanation: 'x', difficulty: 2 },
        ])
      )
    ) as any;

    const questions = await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 1 });
    expect(questions).toHaveLength(1);
    expect(questions[0].cognitiveLevel).toBeUndefined();
    expect(questions[0].questionIntent).toBeUndefined();
  });
});
