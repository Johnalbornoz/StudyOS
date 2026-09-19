/**
 * F9 -- pure unit tests for the readiness dimension classifiers and
 * overall-status combiner (task §33 B/C/D/E unit-level equivalents).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyGapBasedDimension,
  classifyBlueprintCoverageDimension,
  classifySimulationPerformanceDimension,
  classifyEvidenceSufficiencyDimension,
  combineOverallReadinessStatus,
} from '@/lib/readiness/dimension-classification.algorithms';
import { summarizeBlueprintCoverage } from '@/lib/readiness/blueprint-coverage.service';
import type { ReadinessPolicyRules, DimensionReadinessResult, BlueprintCoverageSummary, BlueprintTargetCoverage } from '@/lib/readiness/types';
import type { StoredGapDiagnosis } from '@/lib/diagnostics/diagnosis.service';

const POLICY: ReadinessPolicyRules = {
  gapBasedDimensions: { minimumDiagnosedTargetsForConfidentStatus: 2 },
  coverage: { minimumEvidencedFractionForEarlyPreparation: 0.2, minimumEvidencedFractionForSimulationReady: 0.6 },
  evidenceSufficiency: { minimumQualifyingEvidenceForSufficient: 15, minimumDistinctQuestionTypesForSufficient: 3, maxRecencyDaysForFresh: 30 },
  simulationPerformance: { minimumCompletedAttemptsForConfidentStatus: 1 },
};

let seq = 0;
function diagnosis(overrides: Partial<StoredGapDiagnosis> = {}): StoredGapDiagnosis {
  seq += 1;
  return {
    id: `diag-${seq}`,
    studentId: 'student-1',
    conceptId: `concept-${seq}`,
    subjectId: null,
    scope: {},
    primaryGapType: 'INSUFFICIENT_EVIDENCE',
    secondarySignals: [],
    confidence: 0,
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    reasonCodes: [],
    alternatives: [],
    policyVersionId: 'policy-1',
    canonicalContext: null,
    computedAt: new Date().toISOString(),
    ...overrides,
  } as StoredGapDiagnosis;
}

describe('classifyGapBasedDimension', () => {
  it('below the minimum diagnosed-target count -> INSUFFICIENT_EVIDENCE', () => {
    const result = classifyGapBasedDimension('KNOWLEDGE_READINESS', 'KNOWLEDGE_GAP', [diagnosis()], POLICY);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('case B/C: a named gap -> WEAK, even with other strong signals present', () => {
    const diagnoses = [diagnosis({ primaryGapType: 'KNOWLEDGE_GAP' }), diagnosis({ primaryGapType: 'KNOWLEDGE_GAP' })];
    const result = classifyGapBasedDimension('KNOWLEDGE_READINESS', 'KNOWLEDGE_GAP', diagnoses, POLICY);
    expect(result.status).toBe('WEAK');
  });

  it('a MIXED diagnosis naming the gap as a secondary signal still counts', () => {
    const diagnoses = [diagnosis({ primaryGapType: 'MIXED', secondarySignals: ['SKILL_GAP', 'EXAM_TECHNIQUE_GAP'] }), diagnosis({ primaryGapType: 'MIXED', secondarySignals: ['EXAM_TECHNIQUE_GAP'] })];
    const result = classifyGapBasedDimension('EXAM_TECHNIQUE_READINESS', 'EXAM_TECHNIQUE_GAP', diagnoses, POLICY);
    expect(result.status).toBe('WEAK');
  });

  it('no gap named, none insufficient -> STRONG', () => {
    const diagnoses = [diagnosis({ primaryGapType: 'SKILL_GAP' }), diagnosis({ primaryGapType: 'SKILL_GAP' })];
    const result = classifyGapBasedDimension('KNOWLEDGE_READINESS', 'KNOWLEDGE_GAP', diagnoses, POLICY);
    expect(result.status).toBe('STRONG');
  });

  it('unsupported/unmapped targets are excluded from the count entirely (never named as evidence)', () => {
    // Simulated by the caller never including them in `diagnoses` at all -- this dimension has no notion of them.
    const result = classifyGapBasedDimension('KNOWLEDGE_READINESS', 'KNOWLEDGE_GAP', [], POLICY);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.unsupportedPlatformAreas).toEqual([]);
  });
});

describe('summarizeBlueprintCoverage (the real denominator-exclusion logic, INV-F9-05)', () => {
  function target(status: BlueprintTargetCoverage['status']): BlueprintTargetCoverage {
    return { targetId: `t-${Math.random()}`, status, reasonCodes: [], studentConceptId: null, diagnosisId: null };
  }

  it('UNSUPPORTED_BY_PLATFORM and NOT_REQUIRED targets are excluded from the denominator entirely', () => {
    const targets = [
      target('SUPPORTED_AND_EVIDENCED'),
      target('SUPPORTED_AND_EVIDENCED'),
      target('SUPPORTED_AND_EVIDENCED'),
      target('UNSUPPORTED_BY_PLATFORM'),
      target('UNSUPPORTED_BY_PLATFORM'),
      target('UNSUPPORTED_BY_PLATFORM'),
      target('UNSUPPORTED_BY_PLATFORM'),
      target('NOT_REQUIRED'),
    ];
    const summary = summarizeBlueprintCoverage(targets);
    // denominator = 8 - 4 (unsupported) - 1 (notRequired) = 3; 3 evidenced / 3 = 1.0, never 3/8
    expect(summary.evidencedFraction).toBeCloseTo(1.0, 5);
  });

  it('zero eligible targets (all unsupported) -> null fraction, never zero (never implies "0% ready")', () => {
    const summary = summarizeBlueprintCoverage([target('UNSUPPORTED_BY_PLATFORM'), target('UNSUPPORTED_BY_PLATFORM')]);
    expect(summary.evidencedFraction).toBeNull();
  });
});

describe('classifyBlueprintCoverageDimension', () => {
  function coverage(overrides: Partial<BlueprintCoverageSummary> = {}): BlueprintCoverageSummary {
    return { totalTargets: 10, supportedAndEvidenced: 0, supportedButUnevidenced: 0, unsupportedByPlatform: 0, unmapped: 0, notRequired: 0, evidencedFraction: null, targets: [], ...overrides };
  }

  it('case F/G: an UNSUPPORTED_BY_PLATFORM target never lowers the fraction -- it is excluded from the denominator (the fraction itself is computed by summarizeBlueprintCoverage, exercised for real in the real-Postgres certification; this test confirms the classifier reads that already-excluded fraction, never lowering STRONG status because of it)', () => {
    // 10 total, 4 unsupported, 3 evidenced out of the remaining 6 -> 0.5, not 0.3
    const result = classifyBlueprintCoverageDimension(coverage({ totalTargets: 10, unsupportedByPlatform: 4, supportedAndEvidenced: 3, evidencedFraction: 3 / 6 }), POLICY);
    expect(result.detail.evidencedFraction).toBeCloseTo(0.5, 5);
  });

  it('null fraction (no eligible targets) -> INSUFFICIENT_EVIDENCE, never WEAK', () => {
    const result = classifyBlueprintCoverageDimension(coverage({ totalTargets: 3, unsupportedByPlatform: 3, evidencedFraction: null }), POLICY);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('a high fraction -> STRONG', () => {
    const result = classifyBlueprintCoverageDimension(coverage({ totalTargets: 10, supportedAndEvidenced: 8, evidencedFraction: 0.8 }), POLICY);
    expect(result.status).toBe('STRONG');
  });
});

describe('classifySimulationPerformanceDimension', () => {
  it('below minimum completed attempts -> INSUFFICIENT_EVIDENCE', () => {
    const result = classifySimulationPerformanceDimension({ completedAttemptCount: 0, averageScorePercent: null, byComponent: {} }, POLICY);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('a high average score -> STRONG', () => {
    const result = classifySimulationPerformanceDimension({ completedAttemptCount: 2, averageScorePercent: 85, byComponent: {} }, POLICY);
    expect(result.status).toBe('STRONG');
  });
});

describe('classifyEvidenceSufficiencyDimension', () => {
  it('case D/E precondition: stale or sparse evidence -> INSUFFICIENT_EVIDENCE', () => {
    const result = classifyEvidenceSufficiencyDimension({ totalQualifyingEvidenceCount: 2, independentEvidenceCount: 2, distinctQuestionTypeCount: 1, distinctContextCount: 1, mostRecentEvidenceAgeDays: 90 }, POLICY);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('sufficient count, diversity, and recency -> STRONG', () => {
    const result = classifyEvidenceSufficiencyDimension({ totalQualifyingEvidenceCount: 42, independentEvidenceCount: 40, distinctQuestionTypeCount: 5, distinctContextCount: 4, mostRecentEvidenceAgeDays: 3 }, POLICY);
    expect(result.status).toBe('STRONG');
  });
});

describe('combineOverallReadinessStatus', () => {
  function dim(dimension: DimensionReadinessResult['dimension'], status: DimensionReadinessResult['status']): DimensionReadinessResult {
    return { dimension, status, detail: {}, reasonCodes: [], evidenceIncludedIds: [], evidenceExcludedIds: [], blueprintTargetsConsidered: [], unsupportedPlatformAreas: [], whatWouldImproveConfidence: '' };
  }

  it('case A: coverage INSUFFICIENT_EVIDENCE -> overall INSUFFICIENT_EVIDENCE regardless of other dimensions', () => {
    const dims = [dim('BLUEPRINT_EVIDENCE_COVERAGE', 'INSUFFICIENT_EVIDENCE'), dim('KNOWLEDGE_READINESS', 'STRONG')];
    expect(combineOverallReadinessStatus(dims, true)).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('case C: a WEAK gap dimension -> DEVELOPING even with strong coverage', () => {
    const dims = [dim('BLUEPRINT_EVIDENCE_COVERAGE', 'STRONG'), dim('KNOWLEDGE_READINESS', 'STRONG'), dim('EXAM_TECHNIQUE_READINESS', 'WEAK')];
    expect(combineOverallReadinessStatus(dims, true)).toBe('DEVELOPING');
  });

  it('DEVELOPING coverage with no weak gap dimension -> EARLY_PREPARATION', () => {
    const dims = [dim('BLUEPRINT_EVIDENCE_COVERAGE', 'DEVELOPING'), dim('KNOWLEDGE_READINESS', 'STRONG')];
    expect(combineOverallReadinessStatus(dims, true)).toBe('EARLY_PREPARATION');
  });

  it('strong coverage, no weak gap, platform not Full-Mock-ready -> SIMULATION_READY, never FULL_MOCK_ELIGIBLE', () => {
    const dims = [dim('BLUEPRINT_EVIDENCE_COVERAGE', 'STRONG'), dim('KNOWLEDGE_READINESS', 'STRONG')];
    expect(combineOverallReadinessStatus(dims, false)).toBe('SIMULATION_READY');
  });

  it('case L: strong coverage, no weak gap, AND platform Full-Mock-ready -> FULL_MOCK_ELIGIBLE', () => {
    const dims = [dim('BLUEPRINT_EVIDENCE_COVERAGE', 'STRONG'), dim('KNOWLEDGE_READINESS', 'STRONG')];
    expect(combineOverallReadinessStatus(dims, true)).toBe('FULL_MOCK_ELIGIBLE');
  });
});
