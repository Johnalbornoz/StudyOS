/**
 * LX-4F -- Response/Evidence Contract runtime grader guard.
 *
 * THE CRITICAL REGRESSION (LX-0 "Expectation Contract Failure"):
 *   a plain numeric final-answer question + a correct final answer +
 *   no work shown  ==>  must NOT be penalised for missing work.
 *
 * `applyResponseContractGuard` makes the LX-1 invariant runtime
 * behaviour: for `kind === 'ANSWER_ONLY'` the grader may only score
 * FINAL_ANSWER; a demonstrably-correct final answer is repaired to a
 * clean pass. SHOW_WORK / EXPLAIN / JUSTIFY are returned unchanged.
 */
import { describe, it, expect } from 'vitest';
import { deriveResponseEvidenceContract } from '@/lib/lx/response-evidence-contract';
import { applyResponseContractGuard, finalAnswersMatch, type GuardableGrade } from '@/lib/lx/response-contract-grading';

const PENALISED: GuardableGrade = {
  correct: false,
  score: 0.5,
  feedback: 'You got the right number but did not show your working.',
  errorType: 'INCOMPLETE',
  reasoningValid: false,
};

describe('LX-4F finalAnswersMatch', () => {
  it('matches trivially equal, case/space/punctuation-insensitive', () => {
    expect(finalAnswersMatch('4', '4')).toBe(true);
    expect(finalAnswersMatch('  Paris.  ', 'paris')).toBe(true);
    expect(finalAnswersMatch('x = 4', '4')).toBe(true);
    expect(finalAnswersMatch('= 4', '4')).toBe(true);
  });
  it('matches numeric equivalents', () => {
    expect(finalAnswersMatch('4.0', '4')).toBe(true);
    expect(finalAnswersMatch('4,0', '4')).toBe(true);
    expect(finalAnswersMatch('+4', '4')).toBe(true);
  });
  it('rejects genuinely different answers', () => {
    expect(finalAnswersMatch('5', '4')).toBe(false);
  });
  it('returns null when it cannot decide deterministically', () => {
    expect(finalAnswersMatch('the derivative is 2x', 'f\'(x) = 2x + 1')).toBeNull();
  });
});

describe('LX-4F applyResponseContractGuard -- ANSWER_ONLY', () => {
  const contract = deriveResponseEvidenceContract({ type: 'numeric_problem', expectedReasoningType: null }, 'PRACTICE');

  it('the contract for a plain numeric problem is ANSWER_ONLY (no METHOD/REASONING axes)', () => {
    expect(contract.kind).toBe('ANSWER_ONLY');
    expect(contract.requiresWork).toBe(false);
    expect(contract.partialCreditDimensions).toEqual(['FINAL_ANSWER']);
  });

  it('a correct final answer with no work is repaired to a clean pass', () => {
    const out = applyResponseContractGuard(contract, PENALISED, { studentAnswer: '4', correctAnswer: '4' });
    expect(out.correct).toBe(true);
    expect(out.score).toBe(1);
    expect(out.errorType).toBeNull();
    expect(out.reasoningValid).toBe(true);
    expect(out.feedback).toBe(PENALISED.feedback); // feedback text preserved
  });

  it('a wrong final answer is left exactly as the grader returned it', () => {
    const wrong: GuardableGrade = { correct: false, score: 0.2, feedback: 'Check your arithmetic.', errorType: 'ARITHMETIC', reasoningValid: false };
    const out = applyResponseContractGuard(contract, wrong, { studentAnswer: '5', correctAnswer: '4' });
    expect(out).toEqual(wrong);
  });

  it('falls back to the grader verdict when it cannot deterministically check the answer', () => {
    const passed: GuardableGrade = { correct: true, score: 1, feedback: 'ok', errorType: null, reasoningValid: true };
    const out = applyResponseContractGuard(contract, passed, { studentAnswer: 'about four', correctAnswer: 'the value is 4' });
    expect(out.correct).toBe(true); // grader said correct, kept
  });
});

describe('LX-4F applyResponseContractGuard -- SHOW_WORK / EXPLAIN / JUSTIFY are never altered', () => {
  it('SHOW_WORK: the grader legitimately scores METHOD -- guard is a no-op', () => {
    const contract = deriveResponseEvidenceContract({ type: 'step_by_step', expectedReasoningType: null }, 'PRACTICE');
    expect(contract.kind).toBe('SHOW_WORK');
    const out = applyResponseContractGuard(contract, PENALISED, { studentAnswer: '4', correctAnswer: '4' });
    expect(out).toEqual(PENALISED);
  });

  it('a numeric_problem tagged PROCEDURAL becomes SHOW_WORK -- guard is a no-op', () => {
    const contract = deriveResponseEvidenceContract({ type: 'numeric_problem', expectedReasoningType: 'PROCEDURAL' }, 'PRACTICE');
    expect(contract.kind).toBe('SHOW_WORK');
    const out = applyResponseContractGuard(contract, PENALISED, { studentAnswer: '4', correctAnswer: '4' });
    expect(out).toEqual(PENALISED);
  });

  it('EXPLAIN / JUSTIFY: reasoning is a permitted axis -- guard is a no-op', () => {
    for (const type of ['open_ended', 'justification'] as const) {
      const contract = deriveResponseEvidenceContract({ type, expectedReasoningType: null }, 'PRACTICE');
      const out = applyResponseContractGuard(contract, PENALISED, { studentAnswer: 'x', correctAnswer: 'x' });
      expect(out).toEqual(PENALISED);
    }
  });
});
