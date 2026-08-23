import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));
vi.mock('@/services/concept-graph.service', () => ({
  getPrerequisites: vi.fn(),
  inferPrerequisitesForConcept: vi.fn(),
  confidenceTier: (c: number) => (c >= 0.75 ? 'HIGH' : c >= 0.45 ? 'MEDIUM' : 'LOW'),
}));

import {
  errorTypeRelevance,
  evidenceConfidenceFactor,
  learnerGapFactor,
  recurrenceFactor,
  computeRootCauseScore,
  classifyDiagnosisState,
  evaluateDiagnosticCheck,
} from '@/services/cognitive-diagnosis.service';

describe('errorTypeRelevance', () => {
  it('ranks CONCEPTUAL highest and CARELESS lowest', () => {
    expect(errorTypeRelevance('CONCEPTUAL')).toBe(1.0);
    expect(errorTypeRelevance('CARELESS')).toBeLessThan(errorTypeRelevance('MISREADING'));
    expect(errorTypeRelevance('PROCEDURAL')).toBeGreaterThan(errorTypeRelevance('CARELESS'));
    expect(errorTypeRelevance('INCOMPLETE')).toBeGreaterThan(errorTypeRelevance('PROCEDURAL'));
  });
});

describe('evidenceConfidenceFactor', () => {
  it('orders HIGH > MEDIUM > LOW > no evidence', () => {
    expect(evidenceConfidenceFactor('HIGH')).toBe(1.0);
    expect(evidenceConfidenceFactor('MEDIUM')).toBe(0.6);
    expect(evidenceConfidenceFactor('LOW')).toBe(0.3);
    expect(evidenceConfidenceFactor(null)).toBe(0.15);
  });
});

describe('learnerGapFactor', () => {
  it('is null with no signals at all (insufficient evidence, not zero gap)', () => {
    expect(learnerGapFactor(null, null, null)).toBeNull();
  });

  it('is near 0 when the candidate is strongly known', () => {
    const gap = learnerGapFactor(95, 90, 92);
    expect(gap).not.toBeNull();
    expect(gap as number).toBeLessThan(0.15);
  });

  it('is near 1 when the candidate is weakly known', () => {
    const gap = learnerGapFactor(10, 15, 5);
    expect(gap as number).toBeGreaterThan(0.85);
  });

  it('averages whichever signals are actually available', () => {
    const gap = learnerGapFactor(50, null, null);
    expect(gap).toBeCloseTo(0.5, 5);
  });
});

describe('recurrenceFactor', () => {
  it('is floored at 0.2 for a single occurrence', () => {
    expect(recurrenceFactor(1)).toBeCloseTo(0.333, 2);
    expect(recurrenceFactor(0)).toBe(0.2);
  });

  it('caps at 1 for 3 or more occurrences', () => {
    expect(recurrenceFactor(3)).toBe(1);
    expect(recurrenceFactor(10)).toBe(1);
  });
});

describe('computeRootCauseScore', () => {
  it('multiplies all six factors', () => {
    const score = computeRootCauseScore({
      dependencyStrength: 0.9,
      learnerGap: 0.8,
      errorRelevance: 1.0,
      recurrenceFactor: 1.0,
      evidenceConfidence: 0.6,
      academicRelevance: 1.0,
    });
    expect(score).toBeCloseTo(0.9 * 0.8 * 1.0 * 1.0 * 0.6 * 1.0, 6);
  });

  it('collapses toward zero when the candidate is clearly well understood (low learnerGap)', () => {
    const strongCandidate = computeRootCauseScore({
      dependencyStrength: 0.95,
      learnerGap: 0.05,
      errorRelevance: 1.0,
      recurrenceFactor: 1.0,
      evidenceConfidence: 1.0,
      academicRelevance: 1.0,
    });
    expect(strongCandidate).toBeLessThan(0.1);
  });

  it('a weak graph edge cannot overpower strong learner-gap evidence on its own', () => {
    const weakEdge = computeRootCauseScore({
      dependencyStrength: 0.1,
      learnerGap: 0.95,
      errorRelevance: 1.0,
      recurrenceFactor: 1.0,
      evidenceConfidence: 1.0,
      academicRelevance: 1.0,
    });
    expect(weakEdge).toBeLessThan(0.15);
  });
});

describe('classifyDiagnosisState', () => {
  it('is DIAGNOSIS_REQUIRED whenever there is no candidate evidence, regardless of score', () => {
    expect(classifyDiagnosisState(null, false)).toBe('DIAGNOSIS_REQUIRED');
    expect(classifyDiagnosisState(0.9, false)).toBe('DIAGNOSIS_REQUIRED');
  });

  it('is LIKELY for a strong score with evidence available', () => {
    expect(classifyDiagnosisState(0.7, true)).toBe('LIKELY');
  });

  it('is SUSPECTED for a moderate score', () => {
    expect(classifyDiagnosisState(0.3, true)).toBe('SUSPECTED');
  });

  it('is null (not a real candidate) for a very low score with evidence available', () => {
    expect(classifyDiagnosisState(0.05, true)).toBeNull();
  });
});

describe('evaluateDiagnosticCheck', () => {
  it('confirms the gap on 1/3 (weak performance)', () => {
    expect(evaluateDiagnosticCheck(1, 3)).toBe('CONFIRMED');
  });

  it('confirms the gap on 0/3', () => {
    expect(evaluateDiagnosticCheck(0, 3)).toBe('CONFIRMED');
  });

  it('rejects the hypothesis on 3/3 (strong performance)', () => {
    expect(evaluateDiagnosticCheck(3, 3)).toBe('REJECTED');
  });

  it('is inconclusive on a middling 2/3', () => {
    expect(evaluateDiagnosticCheck(2, 3)).toBe('INCONCLUSIVE');
  });

  it('is inconclusive with zero questions', () => {
    expect(evaluateDiagnosticCheck(0, 0)).toBe('INCONCLUSIVE');
  });
});
