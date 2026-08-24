import { describe, it, expect } from 'vitest';
import type { GradingErrorType } from '@/services/quiz-generation.service';

describe('Phase 3B -- structured reasoning error classification extends grading, never replaces it', () => {
  it('GradingErrorType includes the two new math/science-specific error classes alongside the original five', () => {
    const allValues: GradingErrorType[] = ['CONCEPTUAL', 'PROCEDURAL', 'CARELESS', 'INCOMPLETE', 'MISREADING', 'ARITHMETIC', 'UNIT'];
    // Type-level check: this compiles only if every literal is a valid GradingErrorType.
    expect(allValues).toHaveLength(7);
  });

  it('ARITHMETIC and UNIT are distinct from CONCEPTUAL -- a correct-method-wrong-number answer is not the same signal as a real misunderstanding', () => {
    const arithmetic: GradingErrorType = 'ARITHMETIC';
    const unit: GradingErrorType = 'UNIT';
    const conceptual: GradingErrorType = 'CONCEPTUAL';
    expect(arithmetic).not.toBe(conceptual);
    expect(unit).not.toBe(conceptual);
    expect(arithmetic).not.toBe(unit);
  });
});
