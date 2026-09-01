import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/learner-twin', () => ({ getDecisionContext: vi.fn() }));
vi.mock('@/services/cognitive-diagnosis.service', () => ({ getDiagnosis: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { determineRemediationPattern, startRemediation, getActiveRemediations } from '@/services/remediation.service';
import { getDiagnosis } from '@/services/cognitive-diagnosis.service';
import { getDecisionContext } from '@/lib/learner-twin';
import type { LearnerConceptState } from '@/services/learner-model.service';

const mockedGetDiagnosis = vi.mocked(getDiagnosis);
const mockedGetDecisionContext = vi.mocked(getDecisionContext);

beforeEach(() => {
  queryMock.mockReset();
});

function state(overrides: Partial<LearnerConceptState>): LearnerConceptState {
  return {
    masteryScore: 80,
    retention: 80,
    independentMastery: 80,
    evidenceStrength: 'HIGH',
    confidence: 80,
    confidenceCalibration: { score: 90, label: 'WELL_CALIBRATED', samples: 5 },
    ...overrides,
  };
}

describe('determineRemediationPattern', () => {
  it('is LOW_MASTERY with no evidence at all (treat as needing the full rebuild)', () => {
    expect(determineRemediationPattern(null)).toBe('LOW_MASTERY');
  });

  it('is LOW_MASTERY when mastery itself is weak', () => {
    expect(determineRemediationPattern(state({ masteryScore: 35 }))).toBe('LOW_MASTERY');
  });

  it('is OVERCONFIDENT when confidence calibration says so, even with decent mastery', () => {
    expect(
      determineRemediationPattern(state({ masteryScore: 70, confidenceCalibration: { score: 20, label: 'OVERCONFIDENT', samples: 5 } }))
    ).toBe('OVERCONFIDENT');
  });

  it('is LOW_RETENTION when mastery is fine but retention has decayed', () => {
    expect(determineRemediationPattern(state({ masteryScore: 75, retention: 30 }))).toBe('LOW_RETENTION');
  });

  it('is LOW_INDEPENDENCE when independent mastery lags well behind mastery', () => {
    expect(determineRemediationPattern(state({ masteryScore: 80, retention: 80, independentMastery: 40 }))).toBe('LOW_INDEPENDENCE');
  });

  it('is DEFAULT when every signal looks healthy', () => {
    expect(determineRemediationPattern(state({}))).toBe('DEFAULT');
  });

  it('mastery gap wins over other signals when multiple could apply', () => {
    expect(
      determineRemediationPattern(
        state({ masteryScore: 30, retention: 20, independentMastery: 10, confidenceCalibration: { score: 10, label: 'OVERCONFIDENT', samples: 5 } })
      )
    ).toBe('LOW_MASTERY');
  });
});

/**
 * Phase 2 closure gate, remediation abandonment edge case: a student
 * can start a remediation and never return to it. Phase 2 intentionally
 * has no time-based expiry (that's Phase 2.2's Knowledge Validation
 * territory) -- so an abandoned path just sits in REPAIRING/VERIFYING
 * indefinitely. What Phase 2 *does* need to guarantee, pinned below:
 * calling startRemediation again for the same diagnosis is idempotent
 * (no duplicate path), and restarting after a path reaches a terminal
 * state is still possible and deterministic.
 */
describe('startRemediation idempotency (abandonment edge case)', () => {
  function diagnosisRecord() {
    return {
      id: 'diag-1',
      studentId: 'student-1',
      targetConceptId: 'target-1',
      candidateConceptId: 'candidate-1',
      state: 'CONFIRMED' as const,
      score: 0.8,
    };
  }

  beforeEach(() => {
    mockedGetDiagnosis.mockReset();
    mockedGetDecisionContext.mockReset();
  });

  it('reuses an already-open (including abandoned REPAIRING/VERIFYING) path instead of creating a duplicate', async () => {
    mockedGetDiagnosis.mockResolvedValueOnce(diagnosisRecord());
    // getActiveRemediationForDiagnosis's guard query finds the abandoned path.
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-abandoned' }] });
    // loadPath(path-abandoned): the path row itself, still REPAIRING weeks later.
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'path-abandoned',
          student_id: 'student-1',
          diagnosis_id: 'diag-1',
          target_concept_id: 'target-1',
          root_cause_concept_id: 'candidate-1',
          pattern: 'LOW_MASTERY',
          state: 'REPAIRING',
        },
      ],
    });
    // loadPath(path-abandoned): its steps -- first one still 'active', never touched again.
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 'step-1', step_type: 'LEARN', concept_id: 'candidate-1', sequence: 1, status: 'active', result: null },
        { id: 'step-2', step_type: 'GUIDED_PRACTICE', concept_id: 'candidate-1', sequence: 2, status: 'pending', result: null },
        { id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'pending', result: null },
      ],
    });

    const result = await startRemediation('diag-1');

    expect(result.id).toBe('path-abandoned');
    expect(result.state).toBe('REPAIRING');
    // Exactly the 3 SELECT calls above -- no INSERT INTO remediation_paths, no new steps created.
    expect(queryMock).toHaveBeenCalledTimes(3);
    for (const call of queryMock.mock.calls) {
      expect(String(call[0])).not.toMatch(/INSERT INTO remediation_paths/i);
      expect(String(call[0])).not.toMatch(/INSERT INTO remediation_steps/i);
    }
    // getDecisionContext/determineRemediationPattern are only needed to build a *new* path -- never called on the reuse path.
    expect(mockedGetDecisionContext).not.toHaveBeenCalled();
  });

  it("the reuse guard's query only matches non-terminal states, so restarting after RESOLVED/REJECTED is still possible", async () => {
    mockedGetDiagnosis.mockResolvedValueOnce(diagnosisRecord());
    queryMock.mockResolvedValueOnce({ rows: [] }); // no non-terminal path exists (prior one already RESOLVED)
    mockedGetDecisionContext.mockResolvedValueOnce(null); // no evidence -> LOW_MASTERY pattern
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-new' }] }); // INSERT INTO remediation_paths
    queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT step 1 (LEARN)
    queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT step 2 (GUIDED_PRACTICE)
    queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT step 3 (SOLO_VERIFY)
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'path-new',
          student_id: 'student-1',
          diagnosis_id: 'diag-1',
          target_concept_id: 'target-1',
          root_cause_concept_id: 'candidate-1',
          pattern: 'LOW_MASTERY',
          state: 'REPAIRING',
        },
      ],
    }); // loadPath: path row
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'step-1', step_type: 'LEARN', concept_id: 'candidate-1', sequence: 1, status: 'active', result: null }],
    }); // loadPath: steps row (partial, fine for this assertion)

    const result = await startRemediation('diag-1');

    expect(result.id).toBe('path-new');
    // The very first query is the reuse guard; assert its state list is exactly the three non-terminal states.
    const guardQuery = String(queryMock.mock.calls[0][0]);
    expect(guardQuery).toMatch(/'CONFIRMED', 'REPAIRING', 'VERIFYING'/);
    expect(guardQuery).not.toMatch(/RESOLVED/);
    expect(guardQuery).not.toMatch(/REJECTED/);
  });

  it('getActiveRemediations has no time-based cutoff -- an abandoned path never silently drops off Today/Improve', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-abandoned' }] });
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'path-abandoned',
          student_id: 'student-1',
          diagnosis_id: 'diag-1',
          target_concept_id: 'target-1',
          root_cause_concept_id: 'candidate-1',
          pattern: 'LOW_MASTERY',
          state: 'REPAIRING',
        },
      ],
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const active = await getActiveRemediations('student-1');

    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('path-abandoned');
    const listQuery = String(queryMock.mock.calls[0][0]);
    expect(listQuery).not.toMatch(/started_at\s*[<>]/i);
    expect(listQuery).not.toMatch(/INTERVAL/i);
    expect(listQuery).not.toMatch(/NOW\(\)\s*[-+]/i);
  });
});
