/**
 * F15 Workstream A/B -- deterministic tests for
 * item-resolution.service.ts, the new wiring that resolves IVG-F14-01.
 * Covers: ownership enforcement (IDOR), active-status enforcement,
 * idempotent re-fetch of a pending item (no silent question swap on
 * refresh/resume), unavailable-item handling (never fabricates a
 * question), skip-without-grading, and that grading is delegated
 * verbatim to the real recordSimulationItemResponse (never
 * re-implemented here).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const isOwnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ isOwner: (...args: any[]) => isOwnerMock(...args) }));

const getSimulationAttemptMock = vi.fn();
vi.mock('@/lib/simulation/attempt.service', () => ({ getSimulationAttempt: (...args: any[]) => getSimulationAttemptMock(...args) }));

const getSimulationPlanByIdMock = vi.fn();
vi.mock('@/lib/simulation/plan.service', () => ({ getSimulationPlanById: (...args: any[]) => getSimulationPlanByIdMock(...args) }));

const getObjectiveTargetMock = vi.fn();
vi.mock('@/lib/assessment/blueprint.service', () => ({ getObjectiveTarget: (...args: any[]) => getObjectiveTargetMock(...args) }));

const resolveActivityMetadataForObjectiveMock = vi.fn();
vi.mock('@/lib/curriculum/activity-metadata-bridge.service', () => ({
  resolveActivityMetadataForObjective: (...args: any[]) => resolveActivityMetadataForObjectiveMock(...args),
}));

const resolveStudentConceptForCanonicalConceptMock = vi.fn();
vi.mock('@/lib/readiness/student-concept-resolution.service', () => ({
  resolveStudentConceptForCanonicalConcept: (...args: any[]) => resolveStudentConceptForCanonicalConceptMock(...args),
}));

const generatePracticeQuestionsMock = vi.fn();
vi.mock('@/services/quiz-generation.service', () => ({ generatePracticeQuestions: (...args: any[]) => generatePracticeQuestionsMock(...args) }));

const recordSimulationItemResponseMock = vi.fn();
vi.mock('@/lib/simulation/scoring.service', () => ({ recordSimulationItemResponse: (...args: any[]) => recordSimulationItemResponseMock(...args) }));

import {
  getNextSimulationItem,
  submitSimulationItemAnswer,
  skipUnavailableSimulationItem,
  SimulationItemAccessDeniedError,
  SimulationItemNotFoundError,
  SimulationItemNotActiveError,
  SimulationItemNoPendingItemError,
} from '@/lib/simulation/item-resolution.service';

const BASE_ATTEMPT = {
  id: 'attempt-1',
  examAttemptId: 'exam-attempt-1',
  studentId: 'student-1',
  examProfileId: 'profile-1',
  examVersionId: 'version-1',
  simulationType: 'TOPIC_EXAM' as const,
  simulationPlanId: 'plan-1',
  readinessSnapshotId: null,
  timingMode: 'UNTIMED' as const,
  pauseAllowed: true,
  status: 'ACTIVE' as const,
  pausedAt: null,
  resumedAt: null,
  elapsedSecondsAtPause: null,
  navigationState: {} as Record<string, unknown>,
  language: 'en',
  timezone: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const BASE_PLAN = {
  id: 'plan-1',
  studentId: 'student-1',
  examVersionId: 'version-1',
  blueprintId: 'blueprint-1',
  simulationType: 'TOPIC_EXAM' as const,
  readinessSnapshotId: null,
  selectedTargets: [
    { blueprintObjectiveTargetId: 'target-1', assessmentComponentId: 'component-1', questionType: null, difficultyRange: { min: 2, max: 4 }, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
    { blueprintObjectiveTargetId: 'target-2', assessmentComponentId: 'component-2', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
  ],
  timingAllocation: { mode: 'UNTIMED' as const, totalSeconds: null },
  toolRules: {},
  scoringConfiguration: { scoringModelId: null },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SAMPLE_QUESTION = {
  id: 'q1', conceptId: 'concept-1', type: 'multiple_choice', answerFormat: 'single_choice' as const,
  question: 'What is 2+2?', options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }],
  correctAnswer: 'b', explanation: '4 is correct', difficulty: 3,
};

describe('getNextSimulationItem (IDOR + active-status + idempotent generation)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    isOwnerMock.mockReset();
    getSimulationAttemptMock.mockReset();
    getSimulationPlanByIdMock.mockReset();
    getObjectiveTargetMock.mockReset();
    resolveActivityMetadataForObjectiveMock.mockReset();
    resolveStudentConceptForCanonicalConceptMock.mockReset();
    generatePracticeQuestionsMock.mockReset();
  });

  it('throws SimulationItemNotFoundError when the attempt does not exist', async () => {
    getSimulationAttemptMock.mockResolvedValue(null);
    await expect(getNextSimulationItem('actor-A', 'nonexistent')).rejects.toBeInstanceOf(SimulationItemNotFoundError);
  });

  it('IDOR: throws SimulationItemAccessDeniedError when the actor does not own the attempt (Student A cannot fetch Student B session)', async () => {
    getSimulationAttemptMock.mockResolvedValue(BASE_ATTEMPT);
    isOwnerMock.mockResolvedValue(false);
    await expect(getNextSimulationItem('actor-B-not-owner', 'attempt-1')).rejects.toBeInstanceOf(SimulationItemAccessDeniedError);
  });

  it('throws SimulationItemNotActiveError when the attempt is PAUSED/COMPLETED/ABANDONED', async () => {
    getSimulationAttemptMock.mockResolvedValue({ ...BASE_ATTEMPT, status: 'PAUSED' });
    isOwnerMock.mockResolvedValue(true);
    await expect(getNextSimulationItem('actor-owner', 'attempt-1')).rejects.toBeInstanceOf(SimulationItemNotActiveError);
  });

  it('generates a real item via the concept-resolution bridge and persists it to navigation_state', async () => {
    getSimulationAttemptMock.mockResolvedValue(BASE_ATTEMPT);
    isOwnerMock.mockResolvedValue(true);
    getSimulationPlanByIdMock.mockResolvedValue(BASE_PLAN);
    getObjectiveTargetMock.mockResolvedValue({ id: 'target-1', blueprintId: 'blueprint-1', learningObjectiveId: 'objective-1', assessmentComponentId: 'component-1', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null });
    resolveActivityMetadataForObjectiveMock.mockResolvedValue({ learningObjectiveId: 'objective-1', canonicalConceptIds: ['canonical-1'], skillIds: [], competencyIds: [], structureVersionId: 'struct-1' });
    resolveStudentConceptForCanonicalConceptMock.mockResolvedValue('student-concept-1');
    queryMock.mockResolvedValueOnce({ rows: [{ subject_id: 'subject-1' }] }); // concepts.subject_id lookup
    generatePracticeQuestionsMock.mockResolvedValue([SAMPLE_QUESTION]);
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE simulation_attempts

    const result = await getNextSimulationItem('actor-owner', 'attempt-1');

    expect(result.outcome).toBe('ITEM_READY');
    if (result.outcome === 'ITEM_READY') {
      expect(result.question.question).toBe('What is 2+2?');
      // toClientQuestion strips the answer key -- never sent to the client.
      expect((result.question as any).correctAnswer).toBeUndefined();
    }
    expect(generatePracticeQuestionsMock).toHaveBeenCalledWith('student-concept-1', 'student-1', 'subject-1', expect.objectContaining({ count: 1 }));
    const updateCall = queryMock.mock.calls.find((c) => String(c[0]).includes('UPDATE simulation_attempts'));
    expect(updateCall).toBeTruthy();
  });

  it('returns the SAME pending question on a repeated fetch for the same target index (idempotent -- a refresh never swaps the question)', async () => {
    getSimulationAttemptMock.mockResolvedValue({
      ...BASE_ATTEMPT,
      navigationState: { currentTargetIndex: 0, pendingQuestion: SAMPLE_QUESTION, pendingQuestionTargetIndex: 0 },
    });
    isOwnerMock.mockResolvedValue(true);
    getSimulationPlanByIdMock.mockResolvedValue(BASE_PLAN);

    const result = await getNextSimulationItem('actor-owner', 'attempt-1');

    expect(result.outcome).toBe('ITEM_READY');
    expect(generatePracticeQuestionsMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns ITEM_UNAVAILABLE (never a fabricated question) when the student has no matched concept yet', async () => {
    getSimulationAttemptMock.mockResolvedValue(BASE_ATTEMPT);
    isOwnerMock.mockResolvedValue(true);
    getSimulationPlanByIdMock.mockResolvedValue(BASE_PLAN);
    getObjectiveTargetMock.mockResolvedValue({ id: 'target-1', blueprintId: 'blueprint-1', learningObjectiveId: 'objective-1', assessmentComponentId: 'component-1', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null });
    resolveActivityMetadataForObjectiveMock.mockResolvedValue({ learningObjectiveId: 'objective-1', canonicalConceptIds: ['canonical-1'], skillIds: [], competencyIds: [], structureVersionId: 'struct-1' });
    resolveStudentConceptForCanonicalConceptMock.mockResolvedValue(null);

    const result = await getNextSimulationItem('actor-owner', 'attempt-1');

    expect(result).toEqual({ outcome: 'ITEM_UNAVAILABLE', targetIndex: 0, totalTargets: 2, reason: 'CONCEPT_NOT_MATCHED' });
    expect(generatePracticeQuestionsMock).not.toHaveBeenCalled();
  });

  it('returns COMPLETE when every target has already been visited', async () => {
    getSimulationAttemptMock.mockResolvedValue({ ...BASE_ATTEMPT, navigationState: { currentTargetIndex: 2 } });
    isOwnerMock.mockResolvedValue(true);
    getSimulationPlanByIdMock.mockResolvedValue(BASE_PLAN);

    const result = await getNextSimulationItem('actor-owner', 'attempt-1');
    expect(result).toEqual({ outcome: 'COMPLETE' });
  });
});

describe('submitSimulationItemAnswer (grading delegated verbatim, never re-implemented)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    isOwnerMock.mockReset();
    getSimulationAttemptMock.mockReset();
    getSimulationPlanByIdMock.mockReset();
    recordSimulationItemResponseMock.mockReset();
  });

  it('IDOR: throws SimulationItemAccessDeniedError for a non-owning actor (Student A cannot submit into Student B session)', async () => {
    getSimulationAttemptMock.mockResolvedValue(BASE_ATTEMPT);
    isOwnerMock.mockResolvedValue(false);
    await expect(submitSimulationItemAnswer('actor-B', 'attempt-1', 'b')).rejects.toBeInstanceOf(SimulationItemAccessDeniedError);
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
  });

  it('throws SimulationItemNoPendingItemError when no item was fetched first', async () => {
    getSimulationAttemptMock.mockResolvedValue(BASE_ATTEMPT);
    isOwnerMock.mockResolvedValue(true);
    getSimulationPlanByIdMock.mockResolvedValue(BASE_PLAN);
    await expect(submitSimulationItemAnswer('actor-owner', 'attempt-1', 'b')).rejects.toBeInstanceOf(SimulationItemNoPendingItemError);
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
  });

  it('delegates grading to the real recordSimulationItemResponse with the SERVER-held question, never a client-supplied one, and advances the index', async () => {
    getSimulationAttemptMock.mockResolvedValue({
      ...BASE_ATTEMPT,
      navigationState: {
        currentTargetIndex: 0,
        pendingQuestion: SAMPLE_QUESTION,
        pendingQuestionTargetIndex: 0,
        pendingObjectiveContext: { assessmentComponentId: 'component-1', learningObjectiveId: 'objective-1', commandTermId: null },
      },
    });
    isOwnerMock.mockResolvedValue(true);
    getSimulationPlanByIdMock.mockResolvedValue(BASE_PLAN);
    recordSimulationItemResponseMock.mockResolvedValue({ responseId: 'resp-1', evaluation: { rawResponse: 'b', score: 1, maxScore: 1, criteriaBreakdown: null, feedback: 'Correct!', evaluationModelVersion: null, provenance: null }, evidenceWritten: true, duplicate: false });
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE simulation_attempts

    const result = await submitSimulationItemAnswer('actor-owner', 'attempt-1', 'b', 'idem-1');

    expect(recordSimulationItemResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({ examAttemptId: 'exam-attempt-1', studentId: 'student-1', question: SAMPLE_QUESTION, studentAnswer: 'b', assessmentComponentId: 'component-1' })
    );
    expect(result.done).toBe(false); // 2 targets total, only target 0 answered
    expect(result.evaluation.score).toBe(1);
  });
});

describe('skipUnavailableSimulationItem (advances without grading -- never a fabricated correct/incorrect)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    isOwnerMock.mockReset();
    getSimulationAttemptMock.mockReset();
    getSimulationPlanByIdMock.mockReset();
    recordSimulationItemResponseMock.mockReset();
  });

  it('advances the target index and writes no evidence via recordSimulationItemResponse', async () => {
    getSimulationAttemptMock.mockResolvedValue({ ...BASE_ATTEMPT, navigationState: { currentTargetIndex: 0 } });
    isOwnerMock.mockResolvedValue(true);
    getSimulationPlanByIdMock.mockResolvedValue(BASE_PLAN);
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await skipUnavailableSimulationItem('actor-owner', 'attempt-1');

    expect(result).toEqual({ done: false, targetIndex: 0, totalTargets: 2 });
    expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
  });
});
