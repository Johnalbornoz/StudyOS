import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/services/knowledge-state.service', () => ({ getConceptKnowledgeState: vi.fn() }));

import {
  mapAssessmentConceptCoverage,
  getExternalScoreForConcept,
  detectCalibrationConflict,
  interpretCalibrationConflict,
  getCalibrationConflicts,
} from '@/services/external-assessment.service';
import { getConceptKnowledgeState } from '@/services/knowledge-state.service';

const mockedGetConceptKnowledgeState = vi.mocked(getConceptKnowledgeState);

beforeEach(() => {
  queryMock.mockReset();
  mockedGetConceptKnowledgeState.mockReset();
});

function knowledgeState(overrides: Partial<Record<string, any>> = {}) {
  return {
    studentId: 's1', conceptId: 'c1', subjectId: 'subj1', masteryState: 'PROVISIONAL_MASTERY',
    understandingScore: 90, independenceScore: 85, applicationScore: 80, retentionScore: 80, transferScore: 78,
    activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
    evidenceCount: 5, independentEvidenceCount: 3,
    firstEvidenceAt: null, lastEvidenceAt: null, validationReadiness: 'READY', stateReason: null,
    projectionVersion: 1, masteryPolicyVersion: 1, updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// --- 1, 2, 3, 4. Coverage mapping persistence, partial coverage, confidence preserved --
describe('1, 2, 3 & 4. External assessment coverage can be mapped, persisted, and preserves partial coverage/confidence exactly as given', () => {
  it('mapAssessmentConceptCoverage inserts one row per mapping with the exact weight and confidence supplied', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await mapAssessmentConceptCoverage('occ-1', [
      { conceptId: 'c1', weight: 1.0, mappingConfidence: 0.9 },
      { conceptId: 'c2', weight: 0.3, mappingConfidence: 0.4 }, // partial coverage, low confidence -- must not be normalized/rounded away
    ]);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][1]).toEqual(['occ-1', 'c1', 1.0, 0.9]);
    expect(queryMock.mock.calls[1][1]).toEqual(['occ-1', 'c2', 0.3, 0.4]);
  });

  it('getExternalScoreForConcept returns the exact stored weight/confidence, not a fabricated default', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ assessment_result_id: 'ar-1', percentage: 72, weight: 0.3, mapping_confidence: 0.4 }],
    });
    const external = await getExternalScoreForConcept('s1', 'c2');
    expect(external).toEqual({ externalScore: 72, coverageWeight: 0.3, mappingConfidence: 0.4, assessmentResultId: 'ar-1' });
  });

  it('is null (not a fabricated score) when no assessment has ever been mapped to the concept', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getExternalScoreForConcept('s1', 'unmapped-concept')).toBeNull();
  });
});

// --- 5. External score does not overwrite internal mastery -----------------
describe('5. External evidence never overwrites internal mastery/Knowledge State', () => {
  it('detectCalibrationConflict never issues a write to concept_knowledge_state or mastery_records, even when a conflict is recorded', async () => {
    mockedGetConceptKnowledgeState.mockResolvedValueOnce(knowledgeState({ understandingScore: 95 }) as any);
    queryMock.mockResolvedValueOnce({ rows: [{ assessment_result_id: 'ar-1', percentage: 50, weight: 1.0, mapping_confidence: 0.9 }] });
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'conflict-1', student_id: 's1', concept_id: 'c1', assessment_result_id: 'ar-1',
        internal_score: 95, external_score: 50, mapping_confidence: 0.9, coverage_weight: 1.0,
        conflict_magnitude: 45, possible_interpretations: ['INTERNAL_OVERESTIMATION'], detected_at: '2026-01-01T00:00:00Z',
      }],
    });

    const conflict = await detectCalibrationConflict('s1', 'c1');
    expect(conflict).not.toBeNull();
    for (const call of queryMock.mock.calls) {
      expect(String(call[0])).not.toMatch(/UPDATE concept_knowledge_state|INSERT INTO concept_knowledge_state/i);
      expect(String(call[0])).not.toMatch(/UPDATE mastery_records|INSERT INTO mastery_records/i);
    }
    // The only write this function makes is the conflict record itself.
    expect(String(queryMock.mock.calls[1][0])).toContain('INSERT INTO calibration_conflicts');
  });
});

// --- 6. Strong agreement reinforces calibration (no conflict logged) -------
describe('6. Strong agreement between internal and external evidence is not logged as a conflict', () => {
  it('returns null when internal and external scores are close', async () => {
    mockedGetConceptKnowledgeState.mockResolvedValueOnce(knowledgeState({ understandingScore: 85 }) as any);
    queryMock.mockResolvedValueOnce({ rows: [{ assessment_result_id: 'ar-1', percentage: 80, weight: 1.0, mapping_confidence: 0.9 }] });

    const conflict = await detectCalibrationConflict('s1', 'c1');
    expect(conflict).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1); // only the read -- no INSERT into calibration_conflicts
  });
});

// --- 7. Significant conflict creates a calibration signal ------------------
describe('7. A significant disagreement creates a real calibration signal', () => {
  it('records a conflict with the correct magnitude and internal/external scores', async () => {
    mockedGetConceptKnowledgeState.mockResolvedValueOnce(knowledgeState({ understandingScore: 92, transferScore: 40 }) as any);
    queryMock.mockResolvedValueOnce({ rows: [{ assessment_result_id: 'ar-1', percentage: 55, weight: 1.0, mapping_confidence: 0.9 }] });
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'conflict-1', student_id: 's1', concept_id: 'c1', assessment_result_id: 'ar-1',
        internal_score: 92, external_score: 55, mapping_confidence: 0.9, coverage_weight: 1.0,
        conflict_magnitude: 37, possible_interpretations: ['INTERNAL_OVERESTIMATION', 'POSSIBLE_TRANSFER_WEAKNESS'], detected_at: '2026-01-01T00:00:00Z',
      }],
    });

    const conflict = await detectCalibrationConflict('s1', 'c1');
    expect(conflict?.conflictMagnitude).toBe(37);
    expect(conflict?.internalScore).toBe(92);
    expect(conflict?.externalScore).toBe(55);
  });
});

// --- 8. Low-confidence mapping is flagged, not silently trusted -------------
describe('8. Low-confidence mapping is flagged as a caveat rather than treated as certain', () => {
  it('interpretCalibrationConflict tags LOW_MAPPING_CONFIDENCE and COVERAGE_MISMATCH before any directional interpretation', () => {
    const tags = interpretCalibrationConflict(90, 50, 0.2, 0.3, null, 70);
    expect(tags[0]).toBe('LOW_MAPPING_CONFIDENCE');
    expect(tags[1]).toBe('COVERAGE_MISMATCH');
    expect(tags).toContain('INTERNAL_OVERESTIMATION');
  });

  it('a high-confidence, full-coverage mapping carries neither caveat tag', () => {
    const tags = interpretCalibrationConflict(90, 50, 0.95, 1.0, null, 70);
    expect(tags).not.toContain('LOW_MAPPING_CONFIDENCE');
    expect(tags).not.toContain('COVERAGE_MISMATCH');
  });

  it('flags POSSIBLE_TRANSFER_WEAKNESS only when real Transfer evidence actually supports that read, not by default', () => {
    const withWeakTransfer = interpretCalibrationConflict(90, 50, 0.9, 1.0, 40, 70);
    expect(withWeakTransfer).toContain('POSSIBLE_TRANSFER_WEAKNESS');
    const withNoTransferEvidence = interpretCalibrationConflict(90, 50, 0.9, 1.0, null, 70);
    expect(withNoTransferEvidence).not.toContain('POSSIBLE_TRANSFER_WEAKNESS');
  });

  it('external scoring higher than internal is tagged the other direction, not as overestimation', () => {
    const tags = interpretCalibrationConflict(50, 90, 0.9, 1.0, null, 70);
    expect(tags).toContain('EXTERNAL_STRONGER_THAN_INTERNAL');
    expect(tags).not.toContain('INTERNAL_OVERESTIMATION');
  });
});

// --- 9. Historical assessment data remains auditable ------------------------
describe('9. Reading external evidence never mutates historical assessment data', () => {
  it('getExternalScoreForConcept issues only a SELECT, never an UPDATE/DELETE', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getExternalScoreForConcept('s1', 'c1');
    expect(String(queryMock.mock.calls[0][0])).toMatch(/^\s*SELECT/i);
  });

  it('getCalibrationConflicts issues only a SELECT', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getCalibrationConflicts('s1');
    expect(String(queryMock.mock.calls[0][0])).toMatch(/^\s*SELECT/i);
  });
});

// --- 10. Student isolation remains intact -----------------------------------
describe('10. Student isolation remains intact', () => {
  it('getCalibrationConflicts scopes its query by the exact studentId passed in', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getCalibrationConflicts('student-A');
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('student_id = $1'), ['student-A']);
  });

  it('getExternalScoreForConcept scopes by both studentId and conceptId', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getExternalScoreForConcept('student-A', 'concept-1');
    expect(queryMock.mock.calls[0][1]).toEqual(['concept-1', 'student-A']);
  });
});
