/**
 * Phase 7 -- Step 7G1: derived deep-learning metrics (pure).
 */
import { describe, it, expect } from 'vitest';
import { deriveDeepLearningProfile, type DeepLearningInput } from '@/lib/transfer-deep-learning';

const base: DeepLearningInput = {
  transferDepth: 'NONE',
  nearTransferSuccessCount: 0,
  midTransferSuccessCount: 0,
  farTransferSuccessCount: 0,
  distinctNoveltyDimensionsOk: [],
  demonstratedTransferScore: null,
};

describe('7G1 -- deriveDeepLearningProfile', () => {
  it('an empty transfer state -> every metric 0, overall 0', () => {
    expect(deriveDeepLearningProfile(base)).toEqual({
      recognition: 0, generalization: 0, connection: 0, adaptation: 0, justification: 0, overall: 0,
    });
  });

  it('recognition scales with total qualified successes, capped at 3', () => {
    expect(deriveDeepLearningProfile({ ...base, nearTransferSuccessCount: 1 }).recognition).toBe(1);
    expect(deriveDeepLearningProfile({ ...base, nearTransferSuccessCount: 2 }).recognition).toBe(2);
    expect(deriveDeepLearningProfile({ ...base, nearTransferSuccessCount: 9 }).recognition).toBe(3);
  });

  it('generalization mirrors demonstrated transfer depth', () => {
    expect(deriveDeepLearningProfile({ ...base, transferDepth: 'NEAR_DEMONSTRATED' }).generalization).toBe(1);
    expect(deriveDeepLearningProfile({ ...base, transferDepth: 'GENERALIZED' }).generalization).toBe(2);
    expect(deriveDeepLearningProfile({ ...base, transferDepth: 'ROBUST' }).generalization).toBe(3);
  });

  it('connection needs CONCEPT_COMBINATION novelty and grows with FAR successes', () => {
    expect(deriveDeepLearningProfile({ ...base, distinctNoveltyDimensionsOk: ['STRATEGY'] }).connection).toBe(0);
    expect(deriveDeepLearningProfile({ ...base, distinctNoveltyDimensionsOk: ['CONCEPT_COMBINATION'] }).connection).toBe(1);
    expect(
      deriveDeepLearningProfile({ ...base, distinctNoveltyDimensionsOk: ['CONCEPT_COMBINATION'], farTransferSuccessCount: 2 }).connection,
    ).toBe(3);
  });

  it('adaptation needs a strategy/representation/data-presentation novelty', () => {
    expect(deriveDeepLearningProfile({ ...base, distinctNoveltyDimensionsOk: ['CONTEXT'] }).adaptation).toBe(0);
    expect(
      deriveDeepLearningProfile({ ...base, distinctNoveltyDimensionsOk: ['STRATEGY', 'REPRESENTATION'], midTransferSuccessCount: 1 }).adaptation,
    ).toBe(3);
  });

  it('justification is proxied from the demonstrated transfer score', () => {
    expect(deriveDeepLearningProfile({ ...base, demonstratedTransferScore: 90 }).justification).toBe(3);
    expect(deriveDeepLearningProfile({ ...base, demonstratedTransferScore: 65 }).justification).toBe(2);
    expect(deriveDeepLearningProfile({ ...base, demonstratedTransferScore: 45 }).justification).toBe(1);
    expect(deriveDeepLearningProfile({ ...base, demonstratedTransferScore: 20 }).justification).toBe(0);
  });

  it('overall is the weakest strand', () => {
    const strong = deriveDeepLearningProfile({
      transferDepth: 'ROBUST',
      nearTransferSuccessCount: 3, midTransferSuccessCount: 2, farTransferSuccessCount: 2,
      distinctNoveltyDimensionsOk: ['CONCEPT_COMBINATION', 'STRATEGY', 'REPRESENTATION'],
      demonstratedTransferScore: 95,
    });
    expect(strong.overall).toBe(3);
    const uneven = deriveDeepLearningProfile({
      transferDepth: 'ROBUST',
      nearTransferSuccessCount: 3, midTransferSuccessCount: 2, farTransferSuccessCount: 2,
      distinctNoveltyDimensionsOk: ['STRATEGY'], // no CONCEPT_COMBINATION -> connection 0
      demonstratedTransferScore: 95,
    });
    expect(uneven.connection).toBe(0);
    expect(uneven.overall).toBe(0);
  });

  it('is deterministic', () => {
    const input = { ...base, transferDepth: 'GENERALIZED' as const, midTransferSuccessCount: 2, distinctNoveltyDimensionsOk: ['STRATEGY' as const], demonstratedTransferScore: 70 };
    const a = deriveDeepLearningProfile(input);
    for (let i = 0; i < 50; i++) expect(deriveDeepLearningProfile(input)).toEqual(a);
  });
});
