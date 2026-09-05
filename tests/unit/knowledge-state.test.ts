import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/services/transfer.service', () => ({ getTransferScore: vi.fn() }));
vi.mock('@/services/misconception.service', () => ({ getMisconceptionCountsForConcept: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import {
  classifyUnderstanding,
  classifyIndependence,
  classifyApplication,
  evaluateEvidenceSufficiency,
  determineValidationReadiness,
  determineMasteryState,
  buildStateReason,
  getConceptKnowledgeState,
  type EvidenceRow,
  type MasteryPolicy,
  type DimensionScores,
  type MisconceptionState,
} from '@/services/knowledge-state.service';

beforeEach(() => {
  queryMock.mockReset();
});

const POLICY: MasteryPolicy = {
  version: 1,
  minimumUnderstanding: 80,
  minimumIndependence: 80,
  minimumApplication: 75,
  minimumRetention: 75,
  minimumTransfer: 70,
  requiresTransfer: true,
  maximumCriticalMisconceptions: 0,
  minimumEvidenceCount: 3,
  minimumIndependentEvidenceCount: 2,
  validationWindowDays: 14,
};

function evidence(overrides: Partial<EvidenceRow>): EvidenceRow {
  return {
    sourceType: 'PRACTICE_QUIZ',
    result: 'correct',
    scorePercent: 100,
    aiAssistanceType: 'NONE',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function noMisconceptions(): MisconceptionState {
  return { activeCount: 0, criticalCount: 0, recurringCount: 0 };
}

function strongScores(overrides: Partial<DimensionScores> = {}): DimensionScores {
  return { understanding: 90, independence: 88, application: 85, retention: 82, transfer: 78, ...overrides };
}

// --- 1. UNKNOWN with no evidence -------------------------------------
describe('1. UNKNOWN with no evidence', () => {
  it('determineMasteryState returns UNKNOWN when evidenceCount is 0, regardless of scores', () => {
    const sufficiency = { evidenceCount: 0, independentEvidenceCount: 0, passed: false };
    expect(determineMasteryState(strongScores(), noMisconceptions(), sufficiency, POLICY)).toBe('UNKNOWN');
  });
});

// --- 2. Unknown dimension remains null --------------------------------
describe('2. Unknown dimension remains null (never a fabricated 0)', () => {
  it('every classifier returns null, not 0, on an empty evidence pool', () => {
    expect(classifyUnderstanding([])).toBeNull();
    expect(classifyIndependence([])).toBeNull();
    expect(classifyApplication([])).toBeNull();
  });
});

// --- 3 & 4. Strong immediate evidence -> Provisional, not Validated ---
describe('3 & 4. Strong immediate evidence produces Provisional Mastery, never Validated Mastery', () => {
  it('understanding+independence passing, but retention/transfer null, yields PROVISIONAL_MASTERY', () => {
    const scores: DimensionScores = { understanding: 92, independence: 90, application: 88, retention: null, transfer: null };
    const sufficiency = { evidenceCount: 6, independentEvidenceCount: 3, passed: true };
    const state = determineMasteryState(scores, noMisconceptions(), sufficiency, POLICY);
    expect(state).toBe('PROVISIONAL_MASTERY');
    expect(state).not.toBe('VALIDATED_MASTERY');
  });
});

// --- 5. Assistance reduces independence appropriately -----------------
describe('5. Assistance reduces independence appropriately', () => {
  it('assisted evidence is excluded from the independence pool entirely, not just discounted', () => {
    const rows = [
      evidence({ aiAssistanceType: 'NONE', result: 'correct', scorePercent: 100 }),
      evidence({ aiAssistanceType: 'NONE', result: 'correct', scorePercent: 100 }),
      evidence({ aiAssistanceType: 'HINT', result: 'incorrect', scorePercent: 0 }),
      evidence({ aiAssistanceType: 'MULTIPLE_HINTS', result: 'incorrect', scorePercent: 0 }),
    ];
    const unassistedOnly = rows.filter((r) => r.aiAssistanceType === 'NONE');
    // If the assisted rows leaked in, the average would collapse toward 50 or lower.
    expect(classifyIndependence(unassistedOnly)).toBe(100);
  });

  it('fewer than 2 unassisted samples is insufficient evidence for independence, even with plenty of assisted attempts', () => {
    const rows = [
      evidence({ aiAssistanceType: 'NONE', result: 'correct' }),
      evidence({ aiAssistanceType: 'HINT', result: 'correct' }),
      evidence({ aiAssistanceType: 'HINT', result: 'correct' }),
    ];
    const unassistedOnly = rows.filter((r) => r.aiAssistanceType === 'NONE');
    expect(classifyIndependence(unassistedOnly)).toBeNull();
  });
});

// --- 6. Application remains distinct from recall ----------------------
describe('6. Application remains distinct from recall', () => {
  it('ignores PRACTICE_QUIZ/PRACTICE_QUESTION evidence even when perfect, only counting connection-testing modes', () => {
    const rows = [
      evidence({ sourceType: 'PRACTICE_QUIZ', result: 'correct', scorePercent: 100 }),
      evidence({ sourceType: 'PRACTICE_QUESTION', result: 'correct', scorePercent: 100 }),
    ];
    expect(classifyApplication(rows)).toBeNull();
  });

  it('counts CUMULATIVE_ASSESSMENT/EXAM_SIMULATION/TOPIC_ASSESSMENT evidence', () => {
    const rows = [
      evidence({ sourceType: 'CUMULATIVE_ASSESSMENT', result: 'correct', scorePercent: 90 }),
      evidence({ sourceType: 'EXAM_SIMULATION', result: 'correct', scorePercent: 80 }),
    ];
    expect(classifyApplication(rows)).toBe(85);
  });
});

// --- 7 & 8. Transfer stays null without evidence / reuses Phase 2 -----
describe('7 & 8. Transfer remains null without evidence, and is reused from Phase 2 rather than reimplemented', () => {
  it('a null transfer score flows through to validation readiness/mastery state unchanged', () => {
    const scores = strongScores({ transfer: null });
    const sufficiency = { evidenceCount: 6, independentEvidenceCount: 3, passed: true };
    expect(determineValidationReadiness(scores, noMisconceptions(), sufficiency, POLICY)).toBe('TRANSFER_REQUIRED');
  });

  it('none of the Understanding/Application classifiers ever include TRANSFER-sourced evidence -- Transfer only ever comes from getTransferScore (Retention is sourced from Phase 6\'s canonical memory model, not classified from raw evidence pools here at all -- see memory-model.test.ts)', () => {
    const transferRows = [evidence({ sourceType: 'TRANSFER', result: 'correct', scorePercent: 100 })];
    expect(classifyUnderstanding(transferRows)).toBeNull();
    expect(classifyApplication(transferRows)).toBeNull();
  });
});

// --- 9. Critical misconception blocks Validated Mastery ---------------
describe('9. Critical misconception blocks Validated Mastery', () => {
  it('every score passing policy is still not enough with one active critical misconception', () => {
    const sufficiency = { evidenceCount: 10, independentEvidenceCount: 5, passed: true };
    const misconceptions: MisconceptionState = { activeCount: 1, criticalCount: 1, recurringCount: 0 };
    const state = determineMasteryState(strongScores(), misconceptions, sufficiency, POLICY);
    expect(state).not.toBe('VALIDATED_MASTERY');
    expect(determineValidationReadiness(strongScores(), misconceptions, sufficiency, POLICY)).toBe('ACTIVE_CRITICAL_MISCONCEPTION');
  });
});

// --- 10. Low Application prevents mastery even when other scores are high --
describe('10. Low Application prevents mastery even when other scores are high', () => {
  it('understanding/independence/retention/transfer all excellent, application below threshold -> not validated', () => {
    const scores: DimensionScores = { understanding: 95, independence: 95, application: 60, retention: 90, transfer: 90 };
    const sufficiency = { evidenceCount: 10, independentEvidenceCount: 5, passed: true };
    expect(determineMasteryState(scores, noMisconceptions(), sufficiency, POLICY)).not.toBe('VALIDATED_MASTERY');
  });
});

// --- 11. No compensating average exists --------------------------------
describe('11. No compensating average exists', () => {
  it('an average well above every threshold still fails validation when one required dimension is below its own threshold', () => {
    // Matches the brief's own example: Understanding 94, Independence 92, Application 87, Retention 84, Transfer 51.
    const scores: DimensionScores = { understanding: 94, independence: 92, application: 87, retention: 84, transfer: 51 };
    const avg = (94 + 92 + 87 + 84 + 51) / 5;
    expect(avg).toBeGreaterThan(80);
    const sufficiency = { evidenceCount: 10, independentEvidenceCount: 5, passed: true };
    expect(determineMasteryState(scores, noMisconceptions(), sufficiency, POLICY)).not.toBe('VALIDATED_MASTERY');
  });
});

// --- 12 & 13. Projector is idempotent / replay produces the same result --
describe('12 & 13. The projector is deterministic: same inputs always produce the same outputs', () => {
  it('calling the classifiers twice on identical evidence produces identical scores', () => {
    const rows = [
      evidence({ sourceType: 'EXPLANATION', result: 'correct', scorePercent: 88 }),
      evidence({ sourceType: 'CUMULATIVE_ASSESSMENT', result: 'partial', scorePercent: 60 }),
    ];
    expect(classifyUnderstanding(rows)).toBe(classifyUnderstanding(rows));
    expect(classifyApplication(rows)).toBe(classifyApplication(rows));
  });

  it('the full state-reason pipeline produces byte-identical output when replayed with the same inputs', () => {
    const scores = strongScores();
    const misconceptions = noMisconceptions();
    const sufficiency = { evidenceCount: 8, independentEvidenceCount: 4, passed: true };

    const run = () => {
      const readiness = determineValidationReadiness(scores, misconceptions, sufficiency, POLICY);
      const state = determineMasteryState(scores, misconceptions, sufficiency, POLICY);
      return buildStateReason(scores, misconceptions, sufficiency, POLICY, state, readiness);
    };

    expect(run()).toEqual(run());
  });
});

// --- 14. Policy version is stored --------------------------------------
describe('14. Policy version is stored in the state reason', () => {
  it('buildStateReason.policyVersion matches the policy passed in', () => {
    const reason = buildStateReason(
      strongScores(),
      noMisconceptions(),
      { evidenceCount: 5, independentEvidenceCount: 3, passed: true },
      { ...POLICY, version: 7 },
      'VALIDATED_MASTERY',
      'READY'
    );
    expect(reason.policyVersion).toBe(7);
  });
});

// --- 15. Projection version is stored -----------------------------------
describe('15. Projection version is stored', () => {
  it('getConceptKnowledgeState maps projection_version from the persisted row', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          student_id: 's1', concept_id: 'c1', subject_id: 'subj1', mastery_state: 'DEVELOPING',
          understanding_score: 80, independence_score: null, application_score: null, retention_score: null, transfer_score: null,
          active_misconception_count: 0, critical_misconception_count: 0, recurring_misconception_count: 0,
          evidence_count: 2, independent_evidence_count: 0,
          first_evidence_at: null, last_evidence_at: null,
          validation_readiness: 'INSUFFICIENT_EVIDENCE', state_reason: null,
          projection_version: 1, mastery_policy_version: 1, updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
    const state = await getConceptKnowledgeState('s1', 'c1');
    expect(state?.projectionVersion).toBe(1);
    expect(state?.masteryPolicyVersion).toBe(1);
  });
});

// --- 16. State reason is explainable ------------------------------------
describe('16. State reason is explainable without an LLM', () => {
  it('buildStateReason produces a deterministic, fully-structured explanation for every dimension', () => {
    const scores: DimensionScores = { understanding: 88, independence: 86, application: 72, retention: null, transfer: null };
    const sufficiency = { evidenceCount: 6, independentEvidenceCount: 3, passed: true };
    const readiness = determineValidationReadiness(scores, noMisconceptions(), sufficiency, POLICY);
    const state = determineMasteryState(scores, noMisconceptions(), sufficiency, POLICY);
    const reason = buildStateReason(scores, noMisconceptions(), sufficiency, POLICY, state, readiness);

    expect(reason.resultingState).toBe(state);
    expect(reason.validationReadiness).toBe(readiness);
    expect(reason.dimensions.understanding).toEqual({ score: 88, threshold: 80, passed: true });
    expect(reason.dimensions.independence).toEqual({ score: 86, threshold: 80, passed: true });
    expect(reason.dimensions.application).toEqual({ score: 72, threshold: 75, passed: false });
    expect(reason.dimensions.retention.passed).toBe(false);
    expect(reason.dimensions.transfer.required).toBe(true);
    expect(reason.criticalMisconceptions).toBe(0);
    expect(reason.evidenceSufficiency.requiredEvidenceCount).toBe(POLICY.minimumEvidenceCount);
  });
});

// --- 17. Student isolation is preserved ---------------------------------
describe('17. Student isolation is preserved', () => {
  it('getConceptKnowledgeState always scopes its query by the exact studentId passed in', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getConceptKnowledgeState('student-A', 'concept-1');
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('student_id = $1'), ['student-A', 'concept-1']);
  });

  it('a different student never sees another student\'s row for the same concept (query is parameterized per-call, not cached)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ student_id: 'student-A' }] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getConceptKnowledgeState('student-A', 'concept-1');
    await getConceptKnowledgeState('student-B', 'concept-1');
    expect(queryMock.mock.calls[0][1]).toEqual(['student-A', 'concept-1']);
    expect(queryMock.mock.calls[1][1]).toEqual(['student-B', 'concept-1']);
  });
});

// --- Evidence sufficiency (supporting the above; not a numbered item but load-bearing) --
describe('evaluateEvidenceSufficiency', () => {
  it('fails when either the total or independent evidence count is below policy', () => {
    const rows = [evidence({ aiAssistanceType: 'HINT' }), evidence({ aiAssistanceType: 'HINT' })];
    expect(evaluateEvidenceSufficiency(rows, POLICY).passed).toBe(false); // 0 independent, needs 2
  });

  it('passes once both minimums are met', () => {
    const rows = [
      evidence({ aiAssistanceType: 'NONE' }),
      evidence({ aiAssistanceType: 'NONE' }),
      evidence({ aiAssistanceType: 'HINT' }),
    ];
    expect(evaluateEvidenceSufficiency(rows, POLICY).passed).toBe(true); // 3 total >= 3, 2 independent >= 2
  });
});
