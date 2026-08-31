import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/rag.service', () => ({
  retrieveContext: vi.fn().mockResolvedValue({ chunks: [{ id: 'c1', text: 'Sample study material about the concept.', similarity: 1, sourceId: 's1' }] }),
}));

import { generateQuestionVariant, evaluateVariantEquivalence, type GeneratedQuestion } from '@/services/quiz-generation.service';

function sourceQuestion(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    id: 'q-source',
    conceptId: 'c1',
    type: 'numeric_problem',
    answerFormat: 'text',
    question: 'Calculate the centripetal force given m=2kg, v=4m/s, r=1m.',
    correctAnswer: '32 N',
    explanation: 'Fc = mv^2/r',
    difficulty: 3,
    ...overrides,
  };
}

function mockAnthropicResponse(questions: any[]) {
  return {
    ok: true,
    text: async () => '',
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(questions) }] }),
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  // Phase 0E1: the shared AI gateway now fails fast with CONFIGURATION_ERROR
  // when ANTHROPIC_API_KEY is unset, rather than sending a request with a
  // missing key -- this test only cares about the mocked fetch response, so
  // stub a key too.
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
});

describe('Phase 3B -- Question Variant Equivalence Contract', () => {
  it('accepts a variant with the same difficulty -- full confidence, every dimension passes', async () => {
    const source = sourceQuestion();
    (global.fetch as any).mockResolvedValueOnce(
      mockAnthropicResponse([
        {
          type: 'numeric_problem',
          question: 'Calculate the centripetal force given m=3kg, v=5m/s, r=2m.',
          correctAnswer: '37.5 N',
          explanation: 'Fc = mv^2/r',
          difficulty: 3,
        },
      ])
    );

    const result = await generateQuestionVariant(source, 's1', 'subj1', 'en');
    expect(result).not.toBeNull();
    expect(result!.contract.sourceQuestionId).toBe(source.id);
    expect(result!.contract.conceptId).toBe(source.conceptId);
    expect(result!.contract.difficultyBand).toBe('medium');
    expect(result!.contract.equivalent).toBe(true);
    expect(result!.contract.equivalenceConfidence).toBeCloseTo(1.0, 5);
    expect(result!.contract.checks.requiredKnowledge.passed).toBe(true);
  });

  it('accepts a variant within 1 difficulty point -- requiredKnowledge still passes, still fully equivalent', async () => {
    const source = sourceQuestion({ difficulty: 3 });
    (global.fetch as any).mockResolvedValueOnce(
      mockAnthropicResponse([
        { type: 'numeric_problem', question: 'A slightly harder variant.', correctAnswer: '40 N', explanation: 'Fc = mv^2/r', difficulty: 4 },
      ])
    );

    const result = await generateQuestionVariant(source, 's1', 'subj1', 'en');
    expect(result).not.toBeNull();
    expect(result!.contract.equivalent).toBe(true);
    expect(result!.contract.checks.requiredKnowledge.reason).toMatch(/within 1 point/);
  });

  it('rejects (returns null) a variant that drifts too far in difficulty -- never silently accepts a non-equivalent question', async () => {
    const source = sourceQuestion({ difficulty: 2 });
    (global.fetch as any).mockResolvedValueOnce(
      mockAnthropicResponse([
        { type: 'numeric_problem', question: 'A much harder variant.', correctAnswer: '100 N', explanation: 'Fc = mv^2/r', difficulty: 5 },
      ])
    );

    const result = await generateQuestionVariant(source, 's1', 'subj1', 'en');
    expect(result).toBeNull();
  });

  it('falls back safely (returns null) when generation returns nothing', async () => {
    const source = sourceQuestion();
    (global.fetch as any).mockResolvedValueOnce(mockAnthropicResponse([]));

    const result = await generateQuestionVariant(source, 's1', 'subj1', 'en');
    expect(result).toBeNull();
  });

  it('falls back safely (returns null) when the AI call fails -- assessment must not become unavailable', async () => {
    const source = sourceQuestion();
    (global.fetch as any).mockRejectedValueOnce(new Error('network down'));

    const result = await generateQuestionVariant(source, 's1', 'subj1', 'en');
    expect(result).toBeNull();
  });
});

describe('Phase 3B -- evaluateVariantEquivalence: per-dimension checks (pure, independent of generation)', () => {
  it('same concept + same reasoning + equivalent difficulty -> accepted', () => {
    const source = sourceQuestion({ cognitiveLevel: 'APPLICATION', expectedReasoningType: 'PROCEDURAL', learningObjectiveId: 'lo-1' });
    const candidate = sourceQuestion({
      id: 'q-variant', difficulty: 3,
      cognitiveLevel: 'APPLICATION', expectedReasoningType: 'PROCEDURAL', learningObjectiveId: 'lo-1',
    });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(true);
    expect(evaluation.confidence).toBe(1);
  });

  it('wrong concept -> rejected', () => {
    const source = sourceQuestion();
    const candidate = sourceQuestion({ id: 'q-variant', conceptId: 'different-concept' });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(false);
    expect(evaluation.checks.concept.passed).toBe(false);
  });

  it('wrong learning objective -> rejected when the objective is available on the source', () => {
    const source = sourceQuestion({ learningObjectiveId: 'lo-1' });
    const candidate = sourceQuestion({ id: 'q-variant', learningObjectiveId: 'lo-2' });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(false);
    expect(evaluation.checks.learningObjective.passed).toBe(false);
  });

  it('cognitive-level drift -> rejected', () => {
    const source = sourceQuestion({ cognitiveLevel: 'ANALYSIS' });
    const candidate = sourceQuestion({ id: 'q-variant', cognitiveLevel: 'RECALL' });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(false);
    expect(evaluation.checks.cognitiveLevel.passed).toBe(false);
  });

  it('reasoning-type drift -> rejected', () => {
    const source = sourceQuestion({ expectedReasoningType: 'CONCEPTUAL' });
    const candidate = sourceQuestion({ id: 'q-variant', expectedReasoningType: 'FACTUAL' });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(false);
    expect(evaluation.checks.reasoningType.passed).toBe(false);
  });

  it('scoring-intent drift -> rejected (answer format changed)', () => {
    const source = sourceQuestion({ answerFormat: 'text' });
    const candidate = sourceQuestion({ id: 'q-variant', answerFormat: 'single_choice' });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(false);
    expect(evaluation.checks.scoringIntent.passed).toBe(false);
  });

  it('scoring-intent drift -> rejected (questionIntent changed)', () => {
    const source = sourceQuestion({ questionIntent: 'CHECK_UNDERSTANDING' });
    const candidate = sourceQuestion({ id: 'q-variant', questionIntent: 'CHECK_APPLICATION' });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(false);
    expect(evaluation.checks.scoringIntent.passed).toBe(false);
  });

  it('scoring-intent drift -> rejected (evidenceDimensions changed)', () => {
    const source = sourceQuestion({ evidenceDimensions: ['understanding', 'application'] });
    const candidate = sourceQuestion({ id: 'q-variant', evidenceDimensions: ['retention'] });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(false);
    expect(evaluation.checks.scoringIntent.passed).toBe(false);
  });

  it('missing optional source metadata remains backward-compatible -- every optional check passes when the source never set it', () => {
    const source = sourceQuestion(); // no learningObjectiveId/cognitiveLevel/expectedReasoningType/questionIntent/evidenceDimensions
    const candidate = sourceQuestion({ id: 'q-variant' }); // candidate doesn't have them either -- today's real-world case
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(true);
    expect(evaluation.checks.learningObjective.passed).toBe(true);
    expect(evaluation.checks.cognitiveLevel.passed).toBe(true);
    expect(evaluation.checks.reasoningType.passed).toBe(true);
  });

  it('low aggregate equivalence fails safely -- multiple dimensions drifting at once is never rounded up to "close enough"', () => {
    const source = sourceQuestion({ learningObjectiveId: 'lo-1', cognitiveLevel: 'ANALYSIS', expectedReasoningType: 'CONCEPTUAL' });
    const candidate = sourceQuestion({
      id: 'q-variant', conceptId: 'different-concept', type: 'short_answer', answerFormat: 'text', difficulty: 5,
      learningObjectiveId: 'lo-2', cognitiveLevel: 'RECALL', expectedReasoningType: 'FACTUAL',
    });
    const evaluation = evaluateVariantEquivalence(source, candidate);
    expect(evaluation.equivalent).toBe(false);
    expect(evaluation.confidence).toBeLessThan(0.5);
  });
});
