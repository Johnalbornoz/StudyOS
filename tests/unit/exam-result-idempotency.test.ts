/**
 * Phase 2B -- exam-result.service.ts's own two idempotency mechanisms:
 * (1) the assessment_results.submission_token claim (a real exam
 * result may legitimately be corrected/re-entered later, so
 * occurrenceId alone cannot mean "duplicate" -- Step 8's correction),
 * and (2) the per-concept REAL_SCHOOL_EXAM identity threaded into
 * updateMastery (mocked here, exercised for real in
 * evidence-idempotency.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...args: any[]) => updateMasteryMock(...args) }));

const autoResolveDebtMock = vi.fn();
vi.mock('@/services/debt-resolution.service', () => ({ autoResolveDebt: (...args: any[]) => autoResolveDebtMock(...args) }));

import { recordExamResult } from '@/services/exam-result.service';

beforeEach(() => {
  queryMock.mockReset();
  updateMasteryMock.mockReset();
  autoResolveDebtMock.mockReset();
  autoResolveDebtMock.mockResolvedValue(null);
});

describe('recordExamResult -- submissionToken threaded into updateMastery identity', () => {
  it('passes a REAL_SCHOOL_EXAM identity keyed by submissionToken + conceptId when a token is supplied', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ subject_id: 'subj-1', topics: ['concept-x'], exam_readiness: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'result-1', percentage: 80 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'concept-x', canonical_id: 'concept-x', label: 'Concept X' }] });
    updateMasteryMock.mockResolvedValue({ oldMastery: 50, newMastery: 60, delta: 10, confidenceScore: 80, eventId: 'evt-1' });

    await recordExamResult({ occurrenceId: 'occ-1', studentId: 'student-1', score: 8, maxScore: 10, submissionToken: 'tok-1' }, 'es');

    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.identity).toEqual({ operationType: 'REAL_SCHOOL_EXAM', operationId: 'tok-1', conceptId: 'concept-x' });
  });

  it('omits identity entirely when no submissionToken is supplied -- unprotected, exactly pre-Phase-2B behavior', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ subject_id: 'subj-1', topics: ['concept-x'], exam_readiness: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'result-1', percentage: 80 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'concept-x', canonical_id: 'concept-x', label: 'Concept X' }] });
    updateMasteryMock.mockResolvedValue({ oldMastery: 50, newMastery: 60, delta: 10, confidenceScore: 80, eventId: 'evt-1' });

    await recordExamResult({ occurrenceId: 'occ-2', studentId: 'student-1', score: 8, maxScore: 10 }, 'es');

    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.identity).toBeUndefined();
  });
});

describe('recordExamResult -- assessment_results.submission_token claim (Step 8: NOT occurrenceId-based)', () => {
  it('a submission_token conflict on the assessment_results INSERT is treated as an already-recorded duplicate: no new row, no autoResolveDebt call', async () => {
    const conflictErr: any = new Error('duplicate key value violates unique constraint "assessment_results_submission_token_unique_idx"');
    conflictErr.code = '23505';
    conflictErr.constraint = 'assessment_results_submission_token_unique_idx';

    queryMock
      .mockResolvedValueOnce({ rows: [{ subject_id: 'subj-1', topics: ['concept-x'], exam_readiness: null }] }) // assessment_occurrences SELECT
      .mockRejectedValueOnce(conflictErr) // assessment_results INSERT -- conflict
      .mockResolvedValueOnce({ rows: [{ id: 'result-existing' }] }) // fetch the existing row by token
      .mockResolvedValueOnce({ rows: [] }) // assessment_occurrences UPDATE
      .mockResolvedValueOnce({ rows: [] }) // getConceptAttribution
      .mockResolvedValueOnce({ rows: [{ id: 'concept-x', canonical_id: 'concept-x', label: 'Concept X' }] }); // concept labels

    // The per-concept updateMastery call is ALSO independently gated
    // (by REAL_SCHOOL_EXAM::tok-1::concept-x) -- simulating what the
    // real, non-mocked updateMastery would itself report for a replay.
    updateMasteryMock.mockResolvedValue({ oldMastery: 60, newMastery: 60, delta: 0, confidenceScore: 80, eventId: 'evt-1', duplicate: true });

    const outcome = await recordExamResult({ occurrenceId: 'occ-3', studentId: 'student-1', score: 8, maxScore: 10, submissionToken: 'tok-dup' }, 'es');

    expect(outcome.duplicate).toBe(true);
    expect(outcome.resultId).toBe('result-existing');
    // No INSERT INTO assessment_results happened a second time (only
    // ever the one, rejected, attempt above).
    expect(queryMock.mock.calls.filter(([sql]) => /INSERT INTO assessment_results/i.test(sql))).toHaveLength(1);
    // A duplicate concept-level mastery result must not trigger a
    // fresh debt-resolution check either (Phase 2B: side effects of an
    // already-applied operation don't re-run on replay).
    expect(autoResolveDebtMock).not.toHaveBeenCalled();
  });

  it('an unrelated DB error on the assessment_results INSERT still propagates -- only the specific submission_token constraint is treated as ALREADY_APPLIED', async () => {
    const unrelatedErr: any = new Error('connection terminated');
    unrelatedErr.code = '57P01';

    queryMock
      .mockResolvedValueOnce({ rows: [{ subject_id: 'subj-1', topics: [], exam_readiness: null }] })
      .mockRejectedValueOnce(unrelatedErr);

    await expect(
      recordExamResult({ occurrenceId: 'occ-4', studentId: 'student-1', score: 8, maxScore: 10, submissionToken: 'tok-2' }, 'es')
    ).rejects.toThrow('connection terminated');
  });
});
