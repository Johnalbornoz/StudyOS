import { describe, it, expect } from 'vitest';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

describe('Phase 3 Pre-flight -- question evidence semantics extend GeneratedQuestion without breaking existing shape', () => {
  it('a question with none of the new fields set remains a valid GeneratedQuestion (backward compatible)', () => {
    const q: GeneratedQuestion = {
      id: 'q1',
      conceptId: 'c1',
      type: 'multiple_choice',
      answerFormat: 'single_choice',
      question: 'What is 2+2?',
      options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }],
      correctAnswer: 'b',
      explanation: 'Basic arithmetic.',
      difficulty: 1,
    };
    expect(q.questionIntent).toBeUndefined();
    expect(q.evidenceDimensions).toBeUndefined();
    expect(q.cognitiveLevel).toBeUndefined();
  });

  it('a question can carry the new semantic tags without forcing a schema migration -- they are plain optional fields', () => {
    const q: GeneratedQuestion = {
      id: 'q2',
      conceptId: 'c1',
      type: 'open_ended',
      answerFormat: 'text',
      question: 'Explain why...',
      correctAnswer: 'because...',
      explanation: 'Reasoning check.',
      difficulty: 4,
      questionIntent: 'CHECK_APPLICATION',
      evidenceDimensions: ['application', 'transfer'],
      cognitiveLevel: 'ANALYSIS',
      expectedReasoningType: 'CONCEPTUAL',
      learningObjectiveId: 'lo-123',
    };
    expect(q.questionIntent).toBe('CHECK_APPLICATION');
    expect(q.evidenceDimensions).toEqual(['application', 'transfer']);
  });
});
