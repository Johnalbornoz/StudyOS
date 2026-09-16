/**
 * CANON-V2-ARCH-CLEANUP Section 10/11 -- canonical Transfer
 * grading/diagnosis authority.
 */
import { describe, it, expect } from 'vitest';
import { gradeCanonicalTransferAttempt, type CanonicalTransferChallengeGrade } from '@/lib/lx/canonical-transfer-grading';

const challenge = (depth: 'NEAR' | 'CONTEXTUAL' | 'HIGHER', scorePercent: number, errorType: CanonicalTransferChallengeGrade['errorType'] = null): CanonicalTransferChallengeGrade => ({
  depth,
  scorePercent,
  errorType,
  reasoningProvided: true,
});

describe('gradeCanonicalTransferAttempt -- Section 10 (grading)', () => {
  it('PASSES when overall >= 80 AND every individual challenge >= 70', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 90), challenge('CONTEXTUAL', 85), challenge('HIGHER', 75)]);
    expect(result.nearScore).toBe(90);
    expect(result.contextualScore).toBe(85);
    expect(result.higherScore).toBe(75);
    expect(result.overallScore).toBe(Math.round((90 + 85 + 75) / 3));
    expect(result.passed).toBe(true);
    expect(result.diagnostic).toBeNull();
  });

  it('FAILS when overall >= 80 but ONE individual challenge is below 70 -- a single weak challenge is never masked by two strong ones', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 100), challenge('CONTEXTUAL', 100), challenge('HIGHER', 60)]);
    expect(result.overallScore).toBeGreaterThanOrEqual(80);
    expect(result.passed).toBe(false);
    expect(result.diagnostic).not.toBeNull();
  });

  it('FAILS when every individual challenge is >= 70 but the mean overall is below 80', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 72), challenge('CONTEXTUAL', 72), challenge('HIGHER', 72)]);
    expect(result.overallScore).toBe(72);
    expect(result.passed).toBe(false);
  });

  it('each score is persisted independently -- nearScore/contextualScore/higherScore are never collapsed into one number', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 55), challenge('CONTEXTUAL', 95), challenge('HIGHER', 95)]);
    expect(result.nearScore).toBe(55);
    expect(result.contextualScore).toBe(95);
    expect(result.higherScore).toBe(95);
  });
});

describe('gradeCanonicalTransferAttempt -- Section 11 (diagnosis, FAIL only, never inferred from score alone)', () => {
  it('Case B: a weak NEAR challenge WITH a flagged errorType -> RETENTION_WEAKNESS (the underlying skill itself, not the transfer, looks decayed)', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 40, 'CARELESS'), challenge('CONTEXTUAL', 90), challenge('HIGHER', 90)]);
    expect(result.passed).toBe(false);
    expect(result.diagnostic).toBe('RETENTION_WEAKNESS');
  });

  it('a weak NEAR score with NO flagged errorType (borderline, ambiguous) does NOT trigger RETENTION_WEAKNESS -- score alone is never sufficient', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 65, null), challenge('CONTEXTUAL', 90), challenge('HIGHER', 90)]);
    expect(result.diagnostic).not.toBe('RETENTION_WEAKNESS');
  });

  it('Case C: NEAR holds but any challenge shows a PROCEDURAL error -> FOUNDATIONAL_PROCEDURAL_FAILURE', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 90), challenge('CONTEXTUAL', 50, 'PROCEDURAL'), challenge('HIGHER', 90)]);
    expect(result.passed).toBe(false);
    expect(result.diagnostic).toBe('FOUNDATIONAL_PROCEDURAL_FAILURE');
  });

  it('Case A (default): NEAR holds, no procedural breakdown, but CONTEXTUAL/HIGHER still fall short -> APPLICATION_CONTEXT_WEAKNESS', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 95), challenge('CONTEXTUAL', 40, 'CONCEPTUAL'), challenge('HIGHER', 40, 'CONCEPTUAL')]);
    expect(result.passed).toBe(false);
    expect(result.diagnostic).toBe('APPLICATION_CONTEXT_WEAKNESS');
  });

  it('RETENTION_WEAKNESS (Case B) takes precedence over a PROCEDURAL flag elsewhere -- the NEAR check runs first', () => {
    const result = gradeCanonicalTransferAttempt([challenge('NEAR', 30, 'PROCEDURAL'), challenge('CONTEXTUAL', 90), challenge('HIGHER', 90)]);
    expect(result.diagnostic).toBe('RETENTION_WEAKNESS');
  });

  it('CRITICAL_MISCONCEPTION is never a value this module returns -- that case is decided elsewhere (the pre-existing global hasCriticalMisconception signal, checked before transferFailureDiagnostic is ever consulted)', () => {
    const anyFailingCombination = gradeCanonicalTransferAttempt([challenge('NEAR', 0, 'PROCEDURAL'), challenge('CONTEXTUAL', 0, 'PROCEDURAL'), challenge('HIGHER', 0, 'PROCEDURAL')]);
    expect(['APPLICATION_CONTEXT_WEAKNESS', 'RETENTION_WEAKNESS', 'FOUNDATIONAL_PROCEDURAL_FAILURE']).toContain(anyFailingCombination.diagnostic);
  });
});
