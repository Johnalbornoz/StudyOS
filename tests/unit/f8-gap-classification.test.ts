/**
 * F8 -- pure unit tests for the four deterministic gap classifiers +
 * combiner (task §33 A/D/E/F/G/H at the unit level, task §38 replay).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyKnowledgeGap,
  classifySkillGap,
  classifyTechniqueGap,
  classifySpeedFluencyGap,
  combineDiagnosis,
  classifyAllDimensions,
} from '@/lib/diagnostics/classification.algorithms';
import type { DiagnosticPolicyRules, EvidenceRow } from '@/lib/diagnostics/types';

const POLICY: DiagnosticPolicyRules = {
  knowledge: { minimumIndependentEvidenceCount: 4, minimumDistinctForms: 2, failureRateThreshold: 0.6 },
  skill: { minimumQualifyingEvidenceCount: 3, failureRateThreshold: 0.6 },
  technique: { minimumSimpleFormEvidenceCount: 3, minimumComplexFormEvidenceCount: 3, knowledgeSoundThreshold: 0.7, failureRateThreshold: 0.6 },
  speed: {
    minimumValidTimingSampleCount: 5,
    minimumCorrectnessBaseline: 0.7,
    latencyRatioThreshold: 1.5,
    expectedResponseTimeMsByDifficultyBand: { '1': 30000, '2': 45000, '3': 60000, '4': 90000, '5': 120000 },
  },
  mixedGapPriority: ['KNOWLEDGE_GAP', 'EXAM_TECHNIQUE_GAP', 'SKILL_GAP', 'SPEED_FLUENCY_GAP'],
  confidence: { baseConfidenceAtMinimumEvidence: 0.55, confidenceGainPerExtraEvidenceItem: 0.05 },
};

let seq = 0;
function row(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  seq += 1;
  return {
    id: `evidence-${seq}`,
    result: 'correct',
    aiAssistanceType: 'NONE',
    hintsUsed: 0,
    difficulty: 3,
    scorePercent: 100,
    timestamp: new Date(2026, 0, seq).toISOString(),
    activityType: 'quiz',
    metadata: null,
    ...overrides,
  };
}

describe('classifyKnowledgeGap', () => {
  it('case A: a single wrong answer never supports a diagnosis', () => {
    const result = classifyKnowledgeGap([row({ result: 'incorrect' })], POLICY, []);
    expect(result.supported).toBe(false);
    expect(result.reasonCodes).toContain('BELOW_MINIMUM_EVIDENCE_COUNT');
  });

  it('case B: repeated failures across formats supports Knowledge Gap', () => {
    const evidence = [
      row({ result: 'incorrect', activityType: 'quiz' }),
      row({ result: 'incorrect', activityType: 'explain' }),
      row({ result: 'incorrect', activityType: 'quiz' }),
      row({ result: 'incorrect', activityType: 'explain' }),
    ];
    const result = classifyKnowledgeGap(evidence, POLICY, []);
    expect(result.supported).toBe(true);
    expect(result.reasonCodes).toContain('MULTI_FORMAT_FAILURE_PATTERN');
  });

  it('assisted (non-independent) evidence never counts toward the independent minimum', () => {
    const evidence = [
      row({ result: 'incorrect', aiAssistanceType: 'HINT' }),
      row({ result: 'incorrect', aiAssistanceType: 'HINT' }),
      row({ result: 'incorrect', aiAssistanceType: 'HINT' }),
      row({ result: 'incorrect', aiAssistanceType: 'HINT' }),
    ];
    const result = classifyKnowledgeGap(evidence, POLICY, []);
    expect(result.supported).toBe(false);
    expect(result.reasonCodes).toEqual(['BELOW_MINIMUM_EVIDENCE_COUNT']);
  });

  it('active misconceptions raise confidence and are named in reason codes', () => {
    const evidence = [row({ result: 'incorrect' }), row({ result: 'incorrect' }), row({ result: 'incorrect' }), row({ result: 'incorrect' })];
    const withMisconception = classifyKnowledgeGap(evidence, POLICY, ['sig-1']);
    const without = classifyKnowledgeGap(evidence, POLICY, []);
    expect(withMisconception.reasonCodes).toContain('ACTIVE_MISCONCEPTION_PRESENT');
    expect(withMisconception.confidence).toBeGreaterThan(without.confidence);
  });
});

describe('classifySkillGap', () => {
  it('case D: skill graph existing without qualifying evidence never fabricates a Skill Gap', () => {
    const evidence = [row({ result: 'incorrect' }), row({ result: 'incorrect' }), row({ result: 'incorrect' })]; // no skillIds metadata at all
    const result = classifySkillGap(evidence, POLICY, { skillId: 'skill-1' });
    expect(result.supported).toBe(false);
    expect(result.reasonCodes).toEqual(['NO_QUALIFYING_SKILL_EVIDENCE']);
  });

  it('case E: explicit qualifying skill evidence can support a Skill Gap', () => {
    const evidence = [
      row({ result: 'incorrect', metadata: { skillIds: ['skill-1'] } }),
      row({ result: 'incorrect', metadata: { skillIds: ['skill-1'] } }),
      row({ result: 'incorrect', metadata: { skillIds: ['skill-1'] } }),
    ];
    const result = classifySkillGap(evidence, POLICY, { skillId: 'skill-1' });
    expect(result.supported).toBe(true);
    expect(result.reasonCodes).toContain('QUALIFYING_SKILL_EVIDENCE_FOUND');
  });

  it('no scope.skillId -> NOT_APPLICABLE, never a guess', () => {
    const result = classifySkillGap([row()], POLICY, {});
    expect(result.supported).toBe(false);
    expect(result.reasonCodes).toEqual(['NOT_APPLICABLE']);
  });
});

describe('classifyTechniqueGap', () => {
  it('case C: concept sound on simple forms, repeated failure on complex/command-term forms supports Technique Gap', () => {
    const evidence = [
      row({ result: 'correct', metadata: { reasoningRequirement: 'FACTUAL' } }),
      row({ result: 'correct', metadata: { reasoningRequirement: 'FACTUAL' } }),
      row({ result: 'correct', metadata: { reasoningRequirement: 'PROCEDURAL' } }),
      row({ result: 'incorrect', metadata: { commandTermId: 'term-1', reasoningRequirement: 'METACOGNITIVE' } }),
      row({ result: 'incorrect', metadata: { commandTermId: 'term-1', reasoningRequirement: 'METACOGNITIVE' } }),
      row({ result: 'incorrect', metadata: { commandTermId: 'term-1', reasoningRequirement: 'METACOGNITIVE' } }),
    ];
    const result = classifyTechniqueGap(evidence, POLICY, {});
    expect(result.supported).toBe(true);
    expect(result.reasonCodes).toContain('CONCEPT_SOUND_TECHNIQUE_FAILURE');
  });
});

describe('classifySpeedFluencyGap', () => {
  function timedRow(ms: number, result: 'correct' | 'incorrect' = 'correct', difficulty = 3) {
    return row({ result, difficulty, metadata: { behavior: { responseTimes: [{ responseTimeMs: ms, timingQuality: 'VALID' }] } } });
  }

  it('case F: slow but incorrect (knowledge gap present) never diagnoses pure Speed Gap', () => {
    const evidence = Array.from({ length: 5 }, () => timedRow(150000, 'incorrect'));
    const result = classifySpeedFluencyGap(evidence, POLICY);
    expect(result.supported).toBe(false);
    expect(result.reasonCodes).toContain('KNOWLEDGE_GAP_BLOCKS_SPEED_DIAGNOSIS');
  });

  it('case G: correct independent responses, consistently slow under valid timing supports Speed/Fluency Gap', () => {
    const evidence = Array.from({ length: 5 }, () => timedRow(150000, 'correct')); // 150s vs 60s expected at band 3 -> ratio 2.5
    const result = classifySpeedFluencyGap(evidence, POLICY);
    expect(result.supported).toBe(true);
    expect(result.reasonCodes).toContain('CONSISTENT_LATENCY_ABOVE_EXPECTATION');
  });

  it('case H: timing rule unavailable for the difficulty band blocks the diagnosis', () => {
    const policyNoExpectation: DiagnosticPolicyRules = {
      ...POLICY,
      speed: { ...POLICY.speed, expectedResponseTimeMsByDifficultyBand: { '1': null, '2': null, '3': null, '4': null, '5': null } },
    };
    const evidence = Array.from({ length: 5 }, () => timedRow(150000, 'correct'));
    const result = classifySpeedFluencyGap(evidence, policyNoExpectation);
    expect(result.supported).toBe(false);
    expect(result.reasonCodes).toContain('TIMING_EXPECTATION_UNAVAILABLE');
  });

  it('missing/invalid timing samples are excluded, not treated as zero', () => {
    const evidence = [
      row({ result: 'correct', metadata: { behavior: { responseTimes: [{ responseTimeMs: 100, timingQuality: 'MISSING' }] } } }),
      row({ result: 'correct', metadata: { behavior: { responseTimes: [{ responseTimeMs: 100, timingQuality: 'INVALID' }] } } }),
    ];
    const result = classifySpeedFluencyGap(evidence, POLICY);
    expect(result.supported).toBe(false);
    expect(result.reasonCodes).toContain('TIMING_SAMPLE_INSUFFICIENT');
  });
});

describe('combineDiagnosis', () => {
  it('no supported dimension -> INSUFFICIENT_EVIDENCE, alternatives lists every dimension considered', () => {
    const dims = classifyAllDimensions([row({ result: 'incorrect' })], POLICY, {}, []);
    const diagnosis = combineDiagnosis(dims, POLICY);
    expect(diagnosis.primaryGapType).toBe('INSUFFICIENT_EVIDENCE');
    expect(diagnosis.alternatives).toHaveLength(4);
  });

  it('exactly one supported dimension is promoted directly', () => {
    const evidence = [
      row({ result: 'incorrect', activityType: 'quiz' }),
      row({ result: 'incorrect', activityType: 'explain' }),
      row({ result: 'incorrect', activityType: 'quiz' }),
      row({ result: 'incorrect', activityType: 'explain' }),
    ];
    const dims = classifyAllDimensions(evidence, POLICY, {}, []);
    const diagnosis = combineDiagnosis(dims, POLICY);
    expect(diagnosis.primaryGapType).toBe('KNOWLEDGE_GAP');
    expect(diagnosis.secondarySignals).toEqual([]);
  });

  it('two supported dimensions -> MIXED, confidence is the lower of the two, both listed as secondary signals', () => {
    const knowledgeEvidence = [
      row({ result: 'incorrect', activityType: 'quiz' }),
      row({ result: 'incorrect', activityType: 'explain' }),
      row({ result: 'incorrect', activityType: 'quiz' }),
      row({ result: 'incorrect', activityType: 'explain' }),
    ];
    const skillEvidence = [
      row({ result: 'incorrect', metadata: { skillIds: ['skill-1'] } }),
      row({ result: 'incorrect', metadata: { skillIds: ['skill-1'] } }),
      row({ result: 'incorrect', metadata: { skillIds: ['skill-1'] } }),
    ];
    const dims = classifyAllDimensions([...knowledgeEvidence, ...skillEvidence], POLICY, { skillId: 'skill-1' }, []);
    const diagnosis = combineDiagnosis(dims, POLICY);
    expect(diagnosis.primaryGapType).toBe('MIXED');
    expect(diagnosis.secondarySignals.sort()).toEqual(['KNOWLEDGE_GAP', 'SKILL_GAP'].sort());
    const supported = dims.filter((d) => d.supported);
    expect(diagnosis.confidence).toBe(Math.min(...supported.map((d) => d.confidence)));
  });

  it('task §38 determinism: identical evidence + policy always produces a byte-identical diagnosis', () => {
    const evidence = [
      row({ result: 'incorrect', activityType: 'quiz' }),
      row({ result: 'incorrect', activityType: 'explain' }),
      row({ result: 'incorrect', activityType: 'quiz' }),
      row({ result: 'incorrect', activityType: 'explain' }),
    ];
    const first = combineDiagnosis(classifyAllDimensions(evidence, POLICY, {}, []), POLICY);
    const second = combineDiagnosis(classifyAllDimensions(evidence, POLICY, {}, []), POLICY);
    expect(second).toEqual(first);
  });
});
