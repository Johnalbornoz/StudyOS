/**
 * Phase 0E1 Step 20/21: regression coverage for every HIGH_RISK AI call
 * site migrated onto the shared gateway. Proves the exact pre-existing
 * business contract (grading thresholds, fallback tiers, misconception
 * classification semantics, transfer/explanation scoring) survived the
 * migration -- not just "a function returns something". No live
 * provider calls: every provider response is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function anthropicTextResponse(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
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

describe('gradeAnswer (quiz.free_text_grading) -- HIGH_RISK end-to-end mocked flow', () => {
  it('domain call -> gateway -> mocked provider -> parse -> validate -> typed result: a well-formed grade passes through with clamped bounds intact', async () => {
    const { gradeAnswer } = await import('@/services/quiz-generation.service');
    global.fetch = vi.fn().mockResolvedValue(
      anthropicTextResponse(
        JSON.stringify({ correct: true, score: 1, feedback: 'Nicely done.', confidence: 0.95, errorType: null, reasoningValid: true })
      )
    ) as any;

    const question = { type: 'short_answer', question: 'What is 2+2?', correctAnswer: '4' } as any;
    const grade = await gradeAnswer(question, '4', 'en');

    expect(grade.correct).toBe(true);
    expect(grade.score).toBe(1);
    expect(grade.confidence).toBe(0.95);
    expect(grade.errorType).toBeNull();
    expect(grade.reasoningValid).toBe(true);
    expect(grade.aiExecution.aiPromptId).toBe('quiz.free_text_grading');
    expect(grade.aiExecution.aiProvider).toBe('anthropic');
  });

  it('grading threshold unchanged: score/confidence are clamped into [0,1] exactly as before', async () => {
    const { gradeAnswer } = await import('@/services/quiz-generation.service');
    global.fetch = vi.fn().mockResolvedValue(
      anthropicTextResponse(JSON.stringify({ correct: false, score: 1.7, confidence: -0.2, feedback: 'x', errorType: 'CONCEPTUAL' }))
    ) as any;
    const grade = await gradeAnswer({ type: 'short_answer', question: 'q', correctAnswer: 'a' } as any, 'b', 'en');
    expect(grade.score).toBe(1); // clamp(1.7, 0, 1)
    expect(grade.confidence).toBe(0); // clamp(-0.2, 0, 1)
  });

  it('fallback tier 1 preserved: a parse failure falls back to exact string-match grading, not a thrown error', async () => {
    const { gradeAnswer } = await import('@/services/quiz-generation.service');
    global.fetch = vi.fn().mockResolvedValue(anthropicTextResponse('not valid json at all')) as any;

    const question = { type: 'short_answer', question: 'q', correctAnswer: 'Paris' } as any;
    const matchGrade = await gradeAnswer(question, 'paris', 'en'); // case/whitespace-insensitive match, same as before
    expect(matchGrade.correct).toBe(true);
    expect(matchGrade.score).toBe(1);
    expect(matchGrade.confidence).toBe(0.5);
    expect(matchGrade.feedback).toBe('Please review the explanation above.');

    const noMatchGrade = await gradeAnswer(question, 'London', 'en');
    expect(noMatchGrade.correct).toBe(false);
    expect(noMatchGrade.score).toBe(0);
  });

  it('fallback tier 2 preserved: a transport/provider failure falls back to the zero-score "please try again" grade, not a thrown error', async () => {
    const { gradeAnswer } = await import('@/services/quiz-generation.service');
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;

    const grade = await gradeAnswer({ type: 'short_answer', question: 'q', correctAnswer: 'a' } as any, 'b', 'en');
    expect(grade.correct).toBe(false);
    expect(grade.score).toBe(0);
    expect(grade.confidence).toBe(0);
    expect(grade.feedback).toBe('Error grading answer. Please try again.');
  });

  it('reasoningValid defaults to `correct` when the provider omits it, same as before', async () => {
    const { gradeAnswer } = await import('@/services/quiz-generation.service');
    global.fetch = vi.fn().mockResolvedValue(anthropicTextResponse(JSON.stringify({ correct: true, score: 1 }))) as any;
    const grade = await gradeAnswer({ type: 'short_answer', question: 'q', correctAnswer: 'a' } as any, 'a', 'en');
    expect(grade.reasoningValid).toBe(true);
  });
});

describe('evaluateTransferResponse (transfer.response_evaluation) -- HIGH_RISK', () => {
  it('transfer scoring unchanged: an invalid/unexpected result value fails closed to "incorrect", never silently "correct"', async () => {
    const { evaluateTransferResponse } = await import('@/services/transfer.service');
    global.fetch = vi.fn().mockResolvedValue(anthropicTextResponse(JSON.stringify({ result: 'not-a-real-value', feedback: 'x' }))) as any;
    const graded = await evaluateTransferResponse('Newton’s Second Law', 'prompt', 'response', 'en');
    expect(graded.result).toBe('incorrect');
  });

  it('a well-formed result passes through unchanged, with provenance attached', async () => {
    const { evaluateTransferResponse } = await import('@/services/transfer.service');
    global.fetch = vi.fn().mockResolvedValue(anthropicTextResponse(JSON.stringify({ result: 'partial', feedback: 'Close.' }))) as any;
    const graded = await evaluateTransferResponse('Concept', 'prompt', 'response', 'en');
    expect(graded.result).toBe('partial');
    expect(graded.feedback).toBe('Close.');
    expect(graded.aiExecution.aiPromptId).toBe('transfer.response_evaluation');
  });

  it('a provider failure propagates (no fallback existed for this call before Phase 0E1)', async () => {
    const { evaluateTransferResponse } = await import('@/services/transfer.service');
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as any;
    await expect(evaluateTransferResponse('Concept', 'prompt', 'response', 'en')).rejects.toThrow();
  });
});

describe('evaluateExplanation (explain.rubric_evaluation) -- HIGH_RISK', () => {
  it('rubric dimensions unchanged: each 0-4 dimension is clamped into [0,4] exactly as before', async () => {
    const { evaluateExplanation } = await import('@/services/explain-defend.service');
    global.fetch = vi.fn().mockResolvedValue(
      anthropicTextResponse(
        JSON.stringify({ conceptAccuracy: 9, reasoning: -3, completeness: 2.5, misconceptionDetected: true, misconceptionDescription: 'x', feedback: 'y' })
      )
    ) as any;
    const rubric = await evaluateExplanation('Concept', 'prompt', ['a', 'b'], 'response', 'en');
    expect(rubric.conceptAccuracy).toBe(4); // clamp(9, 0, 4)
    expect(rubric.reasoning).toBe(0); // clamp(-3, 0, 4)
    expect(rubric.completeness).toBe(2.5);
    expect(rubric.misconceptionDetected).toBe(true);
    expect(rubric.aiExecution.aiPromptId).toBe('explain.rubric_evaluation');
  });
});

describe('classifyMisconception (misconception.classification) -- HIGH_RISK', () => {
  it('a null/absent misconceptionCode resolves to "no misconception" (null), not an error', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
    vi.doMock('@/lib/analytics', () => ({ track: vi.fn() }));
    const { classifyMisconception } = await import('@/services/misconception.service');
    global.fetch = vi.fn().mockResolvedValue(anthropicTextResponse(JSON.stringify({ misconceptionCode: null }))) as any;

    const result = await classifyMisconception('concept-1', 'Newton’s Second Law', 'q', 'wrong', 'right', 'en');
    expect(result).toBeNull();
  });

  it('a parse failure resolves to null (preserved fallback), not a thrown error', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
    vi.doMock('@/lib/analytics', () => ({ track: vi.fn() }));
    const { classifyMisconception } = await import('@/services/misconception.service');
    global.fetch = vi.fn().mockResolvedValue(anthropicTextResponse('not json')) as any;

    const result = await classifyMisconception('concept-1', 'Concept', 'q', 'wrong', 'right', 'en');
    expect(result).toBeNull();
  });

  it('a transport/provider failure propagates (preserved -- the original fetch was uncaught for this path)', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
    vi.doMock('@/lib/analytics', () => ({ track: vi.fn() }));
    const { classifyMisconception } = await import('@/services/misconception.service');
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;

    await expect(classifyMisconception('concept-1', 'Concept', 'q', 'wrong', 'right', 'en')).rejects.toThrow();
  });

  it('prefers matching an existing signature over minting a new one, and carries provenance', async () => {
    const existingSignature = {
      id: 'sig-1',
      concept_id: 'concept-1',
      misconception_code: 'SIGN_ERROR',
      description: 'Forgets the sign',
      canonical_explanation: null,
      is_critical: false,
    };
    const query = vi.fn().mockResolvedValue({ rows: [existingSignature] });
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    vi.doMock('@/lib/analytics', () => ({ track: vi.fn() }));
    const { classifyMisconception } = await import('@/services/misconception.service');
    global.fetch = vi.fn().mockResolvedValue(
      anthropicTextResponse(JSON.stringify({ misconceptionCode: 'SIGN_ERROR', description: 'x', matchedExisting: true, isCritical: false }))
    ) as any;

    const result = await classifyMisconception('concept-1', 'Concept', 'q', 'wrong', 'right', 'en');
    expect(result).not.toBeNull();
    expect(result!.isNew).toBe(false);
    expect(result!.signature.id).toBe('sig-1');
    expect(result!.aiExecution.aiPromptId).toBe('misconception.classification');
  });
});
