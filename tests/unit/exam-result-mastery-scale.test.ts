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

describe('recordExamResult -- real-exam mastery recalibration passes mastery_records values through as-is (already 0-100, per the forensic audit)', () => {
  it('does NOT multiply oldMastery/newMastery/delta by 100 -- this is the Phase 3B regression the mastery-contract correction removes', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ subject_id: 'subj-1', topics: ['concept-x'], exam_readiness: null }] }) // assessment_occurrences SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'result-1', percentage: 80 }] }) // assessment_results INSERT
      .mockResolvedValueOnce({ rows: [] }) // assessment_occurrences UPDATE
      .mockResolvedValueOnce({ rows: [] }) // getConceptAttribution: assessment_concept_coverage (empty -> TOPICS_LIST path)
      .mockResolvedValueOnce({ rows: [{ id: 'concept-x', canonical_id: 'concept-x', label: 'Ecuaciones lineales' }] }); // concept labels

    // Real live-DB-shaped values -- mastery_records.mastery_score is
    // already 0-100 (percentage points), not a 0.0-1.0 fraction.
    updateMasteryMock.mockResolvedValue({
      oldMastery: 0,
      newMastery: 0.658199,
      delta: 0.658199,
      confidenceScore: 80,
      eventId: 'evt-1',
    });

    const outcome = await recordExamResult({ occurrenceId: 'occ-1', studentId: 'student-1', score: 8, maxScore: 10 }, 'es');

    // Passed through untouched -- no x100, no rounding at this layer
    // (rounding is a presentation concern, applied only at display time
    // via src/lib/mastery-format.ts).
    expect(outcome.recalibrated).toEqual([
      {
        conceptId: 'concept-x',
        label: 'Ecuaciones lineales',
        previousMastery: 0,
        newMastery: 0.658199,
        delta: 0.658199,
        debtResolved: false,
      },
    ]);
  });

  it('a real-scale value like 1.65 also passes through unmodified, never becoming 165', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ subject_id: 'subj-1', topics: ['concept-x'], exam_readiness: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'result-1', percentage: 80 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'concept-x', canonical_id: 'concept-x', label: 'Ecuaciones lineales' }] });

    updateMasteryMock.mockResolvedValue({
      oldMastery: 0,
      newMastery: 1.65,
      delta: 1.65,
      confidenceScore: 80,
      eventId: 'evt-2',
    });

    const outcome = await recordExamResult({ occurrenceId: 'occ-2', studentId: 'student-1', score: 8, maxScore: 10 }, 'es');
    expect(outcome.recalibrated[0].newMastery).toBe(1.65);
    expect(outcome.recalibrated[0].newMastery).not.toBe(165);
  });
});
