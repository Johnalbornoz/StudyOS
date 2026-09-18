/**
 * F7 / task 28/INV-F7-18/adversarial L,M -- the evidence bridge calls
 * F5's real updateMastery() with the EXISTING EXAM_SIMULATION source
 * type, attaches skillIds/competencyIds ONLY when F6's own
 * PUBLISHED-mapping resolution actually names them, and never fabricates
 * Competency evidence from mere framework relevance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => updateMasteryMock(...a) }));

const resolveActivityMetadataForObjectiveMock = vi.fn();
vi.mock('@/lib/curriculum/activity-metadata-bridge.service', () => ({
  resolveActivityMetadataForObjective: (...a: any[]) => resolveActivityMetadataForObjectiveMock(...a),
}));

import { bridgeExamResponseToEvidence } from '@/lib/assessment/evidence-bridge.service';

beforeEach(() => {
  updateMasteryMock.mockReset().mockResolvedValue({ oldMastery: 50, newMastery: 60, delta: 10, confidenceScore: 0.6, learningDebtCreated: false, learningDebtSeverity: 0, eventId: 'evt-1' });
  resolveActivityMetadataForObjectiveMock.mockReset();
});

const BASE_PARAMS = {
  studentId: 's1',
  conceptId: 'c1',
  subjectId: 'subj1',
  learningObjectiveId: 'obj-1',
  result: 'correct' as const,
  difficulty: 3,
  scorePercent: 90,
};

describe('bridgeExamResponseToEvidence -- task 28-L: explicit skill tag can produce F5 Skill Evidence', () => {
  it('attaches skillIds when the objective has a PUBLISHED skill mapping', async () => {
    resolveActivityMetadataForObjectiveMock.mockResolvedValue({
      learningObjectiveId: 'obj-1', canonicalConceptIds: ['concept-1'], skillIds: ['skill-1'], competencyIds: [], structureVersionId: 'sv-1',
    });
    const outcome = await bridgeExamResponseToEvidence(BASE_PARAMS);
    expect(outcome.attachedSkillIds).toEqual(['skill-1']);
    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.metadata).toEqual({ skillIds: ['skill-1'] });
    expect(call.evidence.sourceType).toBe('EXAM_SIMULATION');
  });
});

describe('bridgeExamResponseToEvidence -- task 28-M/INV-F7-18: competency evidence never fabricated from mere relevance', () => {
  it('attaches NO competencyIds when the bridge resolves an empty array', async () => {
    resolveActivityMetadataForObjectiveMock.mockResolvedValue({
      learningObjectiveId: 'obj-1', canonicalConceptIds: ['concept-1'], skillIds: ['skill-1'], competencyIds: [], structureVersionId: 'sv-1',
    });
    const outcome = await bridgeExamResponseToEvidence(BASE_PARAMS);
    expect(outcome.attachedCompetencyIds).toEqual([]);
    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.metadata.competencyIds).toBeUndefined();
  });

  it('attaches competencyIds only when the bridge actually resolves them (a real PUBLISHED competency mapping)', async () => {
    resolveActivityMetadataForObjectiveMock.mockResolvedValue({
      learningObjectiveId: 'obj-1', canonicalConceptIds: ['concept-1'], skillIds: [], competencyIds: ['competency-1'], structureVersionId: 'sv-1',
    });
    const outcome = await bridgeExamResponseToEvidence(BASE_PARAMS);
    expect(outcome.attachedCompetencyIds).toEqual(['competency-1']);
    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.metadata).toEqual({ competencyIds: ['competency-1'] });
  });
});

describe('bridgeExamResponseToEvidence -- unmapped objective (F6 bridge returns null)', () => {
  it('calls updateMastery with no metadata at all when the objective has no PUBLISHED mapping', async () => {
    resolveActivityMetadataForObjectiveMock.mockResolvedValue(null);
    const outcome = await bridgeExamResponseToEvidence(BASE_PARAMS);
    expect(outcome.attachedSkillIds).toEqual([]);
    expect(outcome.attachedCompetencyIds).toEqual([]);
    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.metadata).toBeUndefined();
  });
});
