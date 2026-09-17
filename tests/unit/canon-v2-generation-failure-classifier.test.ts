/**
 * CANON-V2-PREVIEW-CERT Section 6/7/8 -- classifying a generation
 * shortfall into AI_GENERATION_FAILED / AI_GENERATION_INVALID /
 * AI_VALIDATION_FAILED using real diagnostic data, never a guess.
 */
import { describe, it, expect } from 'vitest';
import { classifyProveRetainGenerationFailure, classifyTransferGenerationFailure } from '@/lib/lx/canonical-generation-failure-classifier';

describe('classifyProveRetainGenerationFailure (Prove/Retain)', () => {
  it('zero candidates ever accepted, no semantic rejections -> AI_GENERATION_FAILED (the provider produced nothing usable)', () => {
    expect(classifyProveRetainGenerationFailure({ totalSemanticRejectedCount: 0, finalQuestionCount: 0, targetCount: 10 })).toBe('AI_GENERATION_FAILED');
  });

  it('some candidates accepted but short of target, no semantic rejections -> AI_GENERATION_INVALID (structural shortfall, e.g. novelty/duplicate filtering)', () => {
    expect(classifyProveRetainGenerationFailure({ totalSemanticRejectedCount: 0, finalQuestionCount: 7, targetCount: 10 })).toBe('AI_GENERATION_INVALID');
  });

  it('any semantic rejection present -> AI_VALIDATION_FAILED, takes priority even when finalQuestionCount is also 0', () => {
    expect(classifyProveRetainGenerationFailure({ totalSemanticRejectedCount: 3, finalQuestionCount: 0, targetCount: 10 })).toBe('AI_VALIDATION_FAILED');
    expect(classifyProveRetainGenerationFailure({ totalSemanticRejectedCount: 1, finalQuestionCount: 8, targetCount: 10 })).toBe('AI_VALIDATION_FAILED');
  });

  it('throws if called on a non-failure (finalQuestionCount already meets targetCount) -- this classifier is only ever meaningful for an actual shortfall', () => {
    expect(() => classifyProveRetainGenerationFailure({ totalSemanticRejectedCount: 0, finalQuestionCount: 10, targetCount: 10 })).toThrow();
  });
});

describe('classifyTransferGenerationFailure (Transfer)', () => {
  it('a challenge that never generated at all (its own AI call produced nothing), no structural issues elsewhere -> AI_GENERATION_FAILED', () => {
    const result = classifyTransferGenerationFailure([
      { generated: true, difficultyInRange: true },
      { generated: false, difficultyInRange: false },
      { generated: true, difficultyInRange: true },
    ]);
    expect(result).toBe('AI_GENERATION_FAILED');
  });

  it('a challenge that DID generate but failed the difficulty-range check -> AI_GENERATION_INVALID (structurally invalid content, not a bare failure)', () => {
    const result = classifyTransferGenerationFailure([
      { generated: true, difficultyInRange: true },
      { generated: true, difficultyInRange: false },
      { generated: true, difficultyInRange: true },
    ]);
    expect(result).toBe('AI_GENERATION_INVALID');
  });

  it('a mix of a bare-failed challenge AND a structurally-invalid one -> AI_GENERATION_INVALID (the more specific signal wins)', () => {
    const result = classifyTransferGenerationFailure([
      { generated: false, difficultyInRange: false },
      { generated: true, difficultyInRange: false },
      { generated: true, difficultyInRange: true },
    ]);
    expect(result).toBe('AI_GENERATION_INVALID');
  });

  it('throws if called on a non-failure (every challenge generated and in range)', () => {
    expect(() =>
      classifyTransferGenerationFailure([
        { generated: true, difficultyInRange: true },
        { generated: true, difficultyInRange: true },
        { generated: true, difficultyInRange: true },
      ]),
    ).toThrow();
  });
});
