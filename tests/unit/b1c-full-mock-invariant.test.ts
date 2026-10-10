/**
 * B1-C -- FULL_MOCK => frozen exam instance (behavioural).
 *
 *   FULL_MOCK without an exam instance      -> rejected by the single start function, before any read or write
 *   Teacher official mock                   -> MOCK exam instance -> FULL_MOCK attempt
 *   Teacher mock with no official form      -> not startable (never downgraded, nothing generated)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const createExamInstanceMock = vi.fn();
const startExamInstanceMock = vi.fn();
const listComponentsMock = vi.fn();
const buildSimulationPlanMock = vi.fn();

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a), connect: async () => ({ query: (...a: any[]) => queryMock(...a), release: () => {} }) } }));
vi.mock('@/lib/simulation/plan.service', () => ({ buildSimulationPlan: (...a: any[]) => buildSimulationPlanMock(...a), TimingConfigurationError: class extends Error {} }));
vi.mock('@/lib/assessment/component.service', () => ({ listComponentsForVersion: (...a: any[]) => listComponentsMock(...a), getComponent: async () => null }));
vi.mock('@/lib/exam-core/exam-instance.service', () => {
  class ExamInstanceError extends Error {
    constructor(public readonly code: string, detail?: string) {
      super(detail ? `${code}: ${detail}` : code);
    }
  }
  return { ExamInstanceError, createExamInstance: (...a: any[]) => createExamInstanceMock(...a), startExamInstance: (...a: any[]) => startExamInstanceMock(...a) };
});
vi.mock('@/services/quiz-generation.service', () => ({ generatePracticeQuestions: vi.fn() }));
vi.mock('@/services/quiz-persistence.service', () => ({ storeQuiz: vi.fn(), getQuizSession: vi.fn() }));
vi.mock('@/services/subject-generation-context.service', () => ({ resolveLanguageForSubject: vi.fn() }));

import { startSimulationAttempt, FullMockRequiresExamInstanceError } from '@/lib/simulation/attempt.service';
import { startOfficialMockForIntervention, StudentInterventionNotStartableError } from '@/lib/student/teacher-intervention-execution.service';
import { ExamInstanceError } from '@/lib/exam-core/exam-instance.service';
import { OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE } from '@/lib/simulation/preparation-simulation';

const base = { studentId: 'stu-1', examProfileId: 'target-1', examVersionId: 'ev-1', timingMode: 'UNTIMED' as const, language: 'es' };

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [] });
  createExamInstanceMock.mockReset();
  startExamInstanceMock.mockReset();
  listComponentsMock.mockReset();
  buildSimulationPlanMock.mockReset();
});

describe('B1-C -- FULL_MOCK without an exam instance is impossible', () => {
  it('startSimulationAttempt rejects a FULL_MOCK with no instance, before touching the database', async () => {
    await expect(startSimulationAttempt({ ...base, simulationType: 'FULL_MOCK' })).rejects.toBeInstanceOf(FullMockRequiresExamInstanceError);
    await expect(startSimulationAttempt({ ...base, simulationType: 'FULL_MOCK' })).rejects.toMatchObject({ code: OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE });
    expect(queryMock).not.toHaveBeenCalled();
    expect(buildSimulationPlanMock).not.toHaveBeenCalled();
  });

  it('an instance id alone is not enough: the frozen form must come with it (and vice versa)', async () => {
    await expect(startSimulationAttempt({ ...base, simulationType: 'FULL_MOCK', examInstanceId: 'inst-1' })).rejects.toBeInstanceOf(FullMockRequiresExamInstanceError);
    await expect(startSimulationAttempt({ ...base, simulationType: 'FULL_MOCK', presetItems: async () => ({}) })).rejects.toBeInstanceOf(FullMockRequiresExamInstanceError);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('with its instance and frozen form, a FULL_MOCK passes the invariant and proceeds to the normal checks', async () => {
    // the next step reads the profile / version: reaching it proves the invariant did not block
    queryMock.mockResolvedValueOnce({ rows: [{ status: 'ARCHIVED' }] });
    await expect(startSimulationAttempt({ ...base, simulationType: 'FULL_MOCK', examInstanceId: 'inst-1', presetItems: async () => ({}) })).rejects.not.toBeInstanceOf(FullMockRequiresExamInstanceError);
    expect(queryMock).toHaveBeenCalled();
  });

  it('preparation simulation types are not affected by the invariant', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ status: 'ARCHIVED' }] });
    for (const simulationType of ['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM'] as const) {
      queryMock.mockResolvedValueOnce({ rows: [{ status: 'ARCHIVED' }] });
      await expect(startSimulationAttempt({ ...base, simulationType })).rejects.not.toBeInstanceOf(FullMockRequiresExamInstanceError);
    }
  });
});

describe('B1-C -- a Teacher-assigned official mock goes through a frozen exam instance', () => {
  const params = { studentId: 'stu-1', examProfileId: 'target-1', examVersionId: 'ev-1' };

  it('teacher official mock -> MOCK exam_instance (all simulation-capable papers) -> FULL_MOCK attempt', async () => {
    listComponentsMock.mockResolvedValue([{ id: 'p1', simulationCapable: true }, { id: 'ia', simulationCapable: false }, { id: 'p2', simulationCapable: true }]);
    createExamInstanceMock.mockResolvedValue({ id: 'inst-1', mode: 'MOCK', status: 'READY' });
    startExamInstanceMock.mockResolvedValue({ id: 'inst-1', status: 'IN_PROGRESS', simulationAttemptId: 'sa-1' });
    expect(await startOfficialMockForIntervention(params)).toBe('sa-1');
    expect(createExamInstanceMock).toHaveBeenCalledWith({ studentId: 'stu-1', examProfileId: 'target-1', examVersionId: 'ev-1', componentIds: ['p1', 'p2'], mode: 'MOCK' });
    expect(startExamInstanceMock).toHaveBeenCalledWith('inst-1', { language: 'en' });
  });

  it('no official form can be frozen -> the assignment is not startable; nothing is generated or downgraded', async () => {
    listComponentsMock.mockResolvedValue([{ id: 'p1', simulationCapable: true }]);
    for (const code of ['FORM_INCOMPLETE', 'NO_ITEMS_FOR_FORM', 'COMPONENT_NOT_MOCKABLE', 'MODE_NOT_AVAILABLE', 'ATTEMPT_IN_PROGRESS']) {
      createExamInstanceMock.mockRejectedValueOnce(new (ExamInstanceError as any)(code));
      const err = await startOfficialMockForIntervention(params).catch((e) => e);
      expect(err).toBeInstanceOf(StudentInterventionNotStartableError);
      expect(String(err.message)).toContain(`official mock not available: ${code}`);
    }
    expect(startExamInstanceMock).not.toHaveBeenCalled();
    expect(buildSimulationPlanMock).not.toHaveBeenCalled();
  });

  it('an unexpected failure is not swallowed as "not startable"', async () => {
    listComponentsMock.mockResolvedValue([{ id: 'p1', simulationCapable: true }]);
    createExamInstanceMock.mockRejectedValueOnce(new Error('db down'));
    await expect(startOfficialMockForIntervention(params)).rejects.toThrow('db down');
  });
});

import { attemptKindLabelKey } from '@/lib/experience/exam-prep';

describe('B1-C -- an attempt is named by what it is, not by its stored type', () => {
  it('an instance attempt is labelled by the instance mode; only a full-fidelity MOCK is a full mock', () => {
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK', instanceFidelity: 'FULL' })).toBe('exv2.mode.MOCK.full');
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK', instanceFidelity: 'REDUCED' })).toBe('exv2.mode.MOCK.reduced');
    // a practice instance is stored as FULL_MOCK and must never be shown as one
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: 'PRACTICE' })).toBe('exv2.mode.PRACTICE');
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: 'CHALLENGE' })).toBe('exv2.mode.CHALLENGE');
  });
  it('an attempt with no instance keeps its own type label (historical attempts are read as before)', () => {
    expect(attemptKindLabelKey({ simulationType: 'MINI_MOCK' })).toBe('ex.type.MINI_MOCK');
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: null })).toBe('ex.type.FULL_MOCK');
  });
});

import { startInterventionExamAttempt } from '@/lib/student/teacher-intervention-execution.service';

describe('B1-C -- Teacher-assigned exam practice: the start path follows what the assessment is', () => {
  it('a Teacher custom preparation assessment is NOT a FULL_MOCK: it never creates an exam instance', async () => {
    // startSimulationAttempt is real here: it reads the profile first; ARCHIVED stops it right after the invariant
    for (const simulationType of ['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM'] as const) {
      queryMock.mockResolvedValueOnce({ rows: [{ status: 'ARCHIVED' }] });
      const err = await startInterventionExamAttempt({ studentId: 'stu-1', examProfileId: 'target-1', examVersionId: 'ev-1', simulationType }).catch((e) => e);
      expect(err).not.toBeInstanceOf(FullMockRequiresExamInstanceError);
    }
    expect(createExamInstanceMock).not.toHaveBeenCalled();
  });

  it('a Teacher full mock always goes through the exam instance, never the direct path', async () => {
    listComponentsMock.mockResolvedValue([{ id: 'p1', simulationCapable: true }]);
    createExamInstanceMock.mockResolvedValue({ id: 'inst-9', mode: 'MOCK', status: 'READY' });
    startExamInstanceMock.mockResolvedValue({ id: 'inst-9', status: 'IN_PROGRESS', simulationAttemptId: 'sa-9' });
    expect(await startInterventionExamAttempt({ studentId: 'stu-1', examProfileId: 'target-1', examVersionId: 'ev-1', simulationType: 'FULL_MOCK' })).toBe('sa-9');
    expect(createExamInstanceMock).toHaveBeenCalledTimes(1);
    // the direct path was never entered
    expect(queryMock).not.toHaveBeenCalled();
  });
});
