import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
// Phase 2-R: completeRemediationStep now runs inside a real transaction
// via db.connect() -- the checked-out client's own .query reuses the
// SAME queryMock, so every existing call-count/call-sequence assertion
// in this file keeps working unchanged; the transaction-specific tests
// below just also see the BEGIN/COMMIT/ROLLBACK calls in that sequence.
vi.mock('@/lib/db', () => ({
  db: {
    query: (...args: any[]) => queryMock(...args),
    connect: async () => ({ query: (...args: any[]) => queryMock(...args), release: () => {} }),
  },
}));
vi.mock('@/lib/learner-twin', () => ({ getDecisionContext: vi.fn() }));
vi.mock('@/services/cognitive-diagnosis.service', () => ({ getDiagnosis: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
const recordDecisionEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/audit', () => ({ recordDecisionEvent: (...args: any[]) => recordDecisionEventMock(...args) }));

import { determineRemediationPattern, startRemediation, getActiveRemediations, completeRemediationStep } from '@/services/remediation.service';
import { getDiagnosis } from '@/services/cognitive-diagnosis.service';
import { getDecisionContext } from '@/lib/learner-twin';
import type { LearnerConceptState } from '@/services/learner-model.service';

const mockedGetDiagnosis = vi.mocked(getDiagnosis);
const mockedGetDecisionContext = vi.mocked(getDecisionContext);

beforeEach(() => {
  queryMock.mockReset();
  recordDecisionEventMock.mockClear();
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

/**
 * Phase 2D Step 8 (exactly-once): startRemediation's duplicate-conflict
 * handling and INTERVENTION_STARTED emission.
 */
describe('startRemediation: concurrency-safe duplicate handling + INTERVENTION_STARTED', () => {
  function diagnosisRecord() {
    return { id: 'diag-1', studentId: 'student-1', targetConceptId: 'target-1', candidateConceptId: 'candidate-1', state: 'CONFIRMED' as const, score: 0.8 };
  }

  beforeEach(() => {
    mockedGetDiagnosis.mockReset();
    mockedGetDecisionContext.mockReset();
  });

  it('a genuine new path emits exactly one INTERVENTION_STARTED event', async () => {
    mockedGetDiagnosis.mockResolvedValueOnce(diagnosisRecord());
    queryMock.mockResolvedValueOnce({ rows: [] }); // reuse guard: nothing open
    mockedGetDecisionContext.mockResolvedValueOnce(null);
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-new' }] }); // INSERT INTO remediation_paths
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-new', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'REPAIRING' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-1', step_type: 'LEARN', concept_id: 'candidate-1', sequence: 1, status: 'active', result: null }] });

    await startRemediation('diag-1');

    expect(recordDecisionEventMock).toHaveBeenCalledTimes(1);
    expect(recordDecisionEventMock.mock.calls[0][0]).toMatchObject({ decisionType: 'INTERVENTION_STARTED', sourceEventId: 'path-new' });
  });

  it('the reuse branch (already-open path) emits NO INTERVENTION_STARTED event', async () => {
    mockedGetDiagnosis.mockResolvedValueOnce(diagnosisRecord());
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-abandoned' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-abandoned', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'REPAIRING' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-1', step_type: 'LEARN', concept_id: 'candidate-1', sequence: 1, status: 'active', result: null }] });

    await startRemediation('diag-1');

    expect(recordDecisionEventMock).not.toHaveBeenCalled();
  });

  it('a concurrent INSERT conflict (23505 on the Phase 2D unique index) is caught and returns the winning path instead of throwing', async () => {
    mockedGetDiagnosis.mockResolvedValueOnce(diagnosisRecord());
    queryMock.mockResolvedValueOnce({ rows: [] }); // reuse guard sees nothing open (raced)
    mockedGetDecisionContext.mockResolvedValueOnce(null);
    const conflictErr: any = new Error('duplicate key value violates unique constraint "remediation_paths_open_per_diagnosis_idx"');
    conflictErr.code = '23505';
    conflictErr.constraint = 'remediation_paths_open_per_diagnosis_idx';
    queryMock.mockRejectedValueOnce(conflictErr); // the losing INSERT
    // getActiveRemediationForDiagnosis re-read after the race, now sees the winner's committed row.
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-winner' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-winner', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'REPAIRING' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-1', step_type: 'LEARN', concept_id: 'candidate-1', sequence: 1, status: 'active', result: null }] });

    const result = await startRemediation('diag-1');

    expect(result.id).toBe('path-winner');
    expect(recordDecisionEventMock).not.toHaveBeenCalled(); // this caller lost the race -- it never started anything itself
  });

  it('an unrelated INSERT failure (different constraint, no code 23505) is rethrown, never silently swallowed', async () => {
    mockedGetDiagnosis.mockResolvedValueOnce(diagnosisRecord());
    queryMock.mockResolvedValueOnce({ rows: [] });
    mockedGetDecisionContext.mockResolvedValueOnce(null);
    queryMock.mockRejectedValueOnce(new Error('connection reset'));

    await expect(startRemediation('diag-1')).rejects.toThrow('connection reset');
  });
});

/**
 * Phase 2D Step 8 (exactly-once): completeRemediationStep's replay
 * idempotency.
 */
describe('completeRemediationStep: exactly-once transitions (Phase 2-R: atomic claim, single transaction)', () => {
  it('a transport replay of an already-completed step is a no-op: the atomic claim matches zero rows, no downstream UPDATE, no duplicate INTERVENTION_COMPLETED, no bumped resolved_at', async () => {
    // The atomic claim (`WHERE status = 'active'`) matches zero rows --
    // the step is already 'completed'. No downstream mutation may run.
    queryMock.mockResolvedValueOnce({ rows: [] }); // BEGIN
    queryMock.mockResolvedValueOnce({ rows: [] }); // the atomic claim UPDATE itself -- 0 rows matched
    queryMock.mockResolvedValueOnce({ rows: [{ remediation_path_id: 'path-1' }] }); // STEP_NOT_FOUND check -- the step DOES exist
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-1', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'RESOLVED' }] }); // loadPath: path row
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'completed', result: { success: true } }] }); // loadPath: steps row
    queryMock.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await completeRemediationStep('step-3', { success: true });

    expect(result.state).toBe('RESOLVED');
    expect(queryMock).toHaveBeenCalledTimes(6);
    // Exactly ONE UPDATE-shaped statement ran in total: the atomic claim
    // attempt itself (which matched zero rows) -- never a second,
    // downstream UPDATE against remediation_paths or remediation_steps.
    const updateCalls = queryMock.mock.calls.filter(([sql]) => /^UPDATE/i.test(String(sql)));
    expect(updateCalls).toHaveLength(1);
    expect(String(updateCalls[0][0])).toMatch(/WHERE id = \$1 AND status = 'active'/);
    expect(recordDecisionEventMock).not.toHaveBeenCalled();
  });

  it('the FIRST genuine completion of the last step (success) atomically claims, mutates, and emits exactly one INTERVENTION_COMPLETED', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // BEGIN
    queryMock.mockResolvedValueOnce({ rows: [{ remediation_path_id: 'path-1', step_type: 'SOLO_VERIFY', sequence: 3 }] }); // atomic claim -- 1 row: genuine winner
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'path-1', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'VERIFYING' }],
    }); // loadPath (pre-transition): path row
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'completed', result: { success: true } }],
    }); // loadPath (pre-transition): steps -- this IS the last step, sequence 3 with nothing after it
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE remediation_paths SET state='RESOLVED'
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-1', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'RESOLVED' }] }); // final loadPath: path row
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'completed', result: { success: true } }] }); // final loadPath: steps
    queryMock.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await completeRemediationStep('step-3', { success: true });

    expect(result.state).toBe('RESOLVED');
    expect(String(queryMock.mock.calls[0][0])).toBe('BEGIN');
    expect(String(queryMock.mock.calls[queryMock.mock.calls.length - 1][0])).toBe('COMMIT');
    expect(recordDecisionEventMock).toHaveBeenCalledTimes(1);
    expect(recordDecisionEventMock.mock.calls[0][0]).toMatchObject({ decisionType: 'INTERVENTION_COMPLETED', sourceEventId: 'path-1' });
    // recordDecisionEvent must run INSIDE the transaction -- called with the checked-out client, not the pool default.
    expect(recordDecisionEventMock.mock.calls[0][1]).toBeDefined();
  });

  it('a failed final SOLO_VERIFY reopens the step (status back to active) within the SAME transaction -- the atomic claim does NOT block the next genuine retry', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // BEGIN
    queryMock.mockResolvedValueOnce({ rows: [{ remediation_path_id: 'path-1', step_type: 'SOLO_VERIFY', sequence: 3 }] }); // atomic claim -- 1 row
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'path-1', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'VERIFYING' }],
    });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'completed', result: { success: false } }],
    });
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE remediation_paths SET state='REPAIRING' (not resolved -- failed)
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE remediation_steps SET status='active' (reopen for retry, SAME transaction)
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-1', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'REPAIRING' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'active', result: { success: false } }] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await completeRemediationStep('step-3', { success: false });

    expect(result.state).toBe('REPAIRING');
    expect(recordDecisionEventMock).not.toHaveBeenCalled(); // no INTERVENTION_COMPLETED on a failed verification
    // The reopen UPDATE is present, inside the same committed transaction.
    const reopenCall = queryMock.mock.calls.find(([sql]) => /UPDATE remediation_steps SET status = 'active'/.test(String(sql)));
    expect(reopenCall).toBeTruthy();
    expect(String(queryMock.mock.calls[queryMock.mock.calls.length - 1][0])).toBe('COMMIT');
  });

  it('STEP_NOT_FOUND: a genuinely nonexistent stepId is rejected (and the transaction rolled back), never treated as an already-applied replay', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // BEGIN
    queryMock.mockResolvedValueOnce({ rows: [] }); // atomic claim -- 0 rows (no such step)
    queryMock.mockResolvedValueOnce({ rows: [] }); // existence check -- also empty
    queryMock.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(completeRemediationStep('nonexistent-step', { success: true })).rejects.toThrow('STEP_NOT_FOUND');
    expect(recordDecisionEventMock).not.toHaveBeenCalled();
    expect(String(queryMock.mock.calls[queryMock.mock.calls.length - 1][0])).toBe('ROLLBACK');
  });

  it('a genuine failure AFTER the atomic claim succeeds (a later same-transaction operation) rolls back -- the claim itself is reverted, not left half-applied', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // BEGIN
    queryMock.mockResolvedValueOnce({ rows: [{ remediation_path_id: 'path-1', step_type: 'SOLO_VERIFY', sequence: 3 }] }); // atomic claim succeeds
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-1', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'VERIFYING' }] }); // loadPath pre: path row
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'completed', result: { success: true } }] }); // loadPath pre: steps
    queryMock.mockRejectedValueOnce(new Error('simulated failure after the claim (e.g. a real FK violation on the decision event)')); // UPDATE remediation_paths -- genuinely fails
    queryMock.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(completeRemediationStep('step-3', { success: true })).rejects.toThrow('simulated failure after the claim');

    expect(recordDecisionEventMock).not.toHaveBeenCalled(); // never reached
    expect(String(queryMock.mock.calls[queryMock.mock.calls.length - 1][0])).toBe('ROLLBACK');

    // Retry after the induced condition is fixed: a fresh transaction,
    // same stepId, applies exactly once (the claim UPDATE's own
    // `WHERE status = 'active'` still matches, since the failed
    // transaction's claim was rolled back -- the step is genuinely
    // still 'active' in the database).
    queryMock.mockResolvedValueOnce({ rows: [] }); // BEGIN
    queryMock.mockResolvedValueOnce({ rows: [{ remediation_path_id: 'path-1', step_type: 'SOLO_VERIFY', sequence: 3 }] }); // claim succeeds this time
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-1', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'VERIFYING' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'completed', result: { success: true } }] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE remediation_paths -- succeeds this time
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'path-1', student_id: 'student-1', diagnosis_id: 'diag-1', target_concept_id: 'target-1', root_cause_concept_id: 'candidate-1', pattern: 'LOW_MASTERY', state: 'RESOLVED' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'step-3', step_type: 'SOLO_VERIFY', concept_id: 'candidate-1', sequence: 3, status: 'completed', result: { success: true } }] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const retryResult = await completeRemediationStep('step-3', { success: true });
    expect(retryResult.state).toBe('RESOLVED');
    expect(recordDecisionEventMock).toHaveBeenCalledTimes(1); // exactly once, from the retry -- not from the failed attempt
  });
});
