/**
 * Cambridge AICE / PISA -- HTTP security of the new routes (owner-only plan,
 * governed results, teacher roster scope, institution scope) and the explorer
 * readiness copy. The real-database flows are in
 * scripts/operations/track-b-aice-pisa-scenarios.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_n: string, h: unknown) => h }));
vi.mock('@/lib/exam-core/route-auth', () => ({ requireActor: vi.fn(), requireOwnerOf: vi.fn(), ownStudentId: vi.fn() }));
vi.mock('@/lib/institution-intelligence', () => {
  class InstitutionIntelligenceAccessDeniedError extends Error {}
  return { InstitutionIntelligenceAccessDeniedError, requireLearnerInInstitution: vi.fn(), requireInstitutionAccess: vi.fn() };
});
vi.mock('@/lib/teacher/read-model.service', () => ({ getTeacherClassRoster: vi.fn() }));
vi.mock('@/lib/exam-core/aice/plan.service', () => {
  class AicePlanError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return { AicePlanError, createPlan: vi.fn(), getPlanView: vi.fn(async () => ({ entries: [] })), addPlanEntry: vi.fn(), updatePlanEntry: vi.fn(), removePlanEntry: vi.fn(), recordResult: vi.fn(async () => ({ id: 'r' })), institutionAiceSummary: vi.fn() };
});
vi.mock('@/lib/exam-core/exam-gaps.service', () => ({ examGapsFor: vi.fn(async () => ({ byConcept: [] })), examGoalsFor: vi.fn(async () => ({ byObjective: [] })), examParticipation: vi.fn(async () => []) }));

import { requireActor, requireOwnerOf, ownStudentId } from '@/lib/exam-core/route-auth';
import { requireLearnerInInstitution, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { getTeacherClassRoster } from '@/lib/teacher/read-model.service';
import { addPlanEntry, updatePlanEntry, recordResult, AicePlanError, getPlanView } from '@/lib/exam-core/aice/plan.service';
import { examGoalsFor, examGapsFor } from '@/lib/exam-core/exam-gaps.service';
import { GET as planGET } from '@/app/api/aice/plan/route';
import { POST as entryPOST } from '@/app/api/aice/plan/entries/route';
import { PATCH as entryPATCH, DELETE as entryDELETE } from '@/app/api/aice/plan/entries/[id]/route';
import { POST as resultPOST } from '@/app/api/aice/results/route';
import { GET as teacherGET } from '@/app/api/teacher/exam-insights/route';
import { readinessKey } from '@/app/dashboard/exams/ExamCatalogBrowser';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const INST = '33333333-3333-4333-8333-333333333333';
const CLASS = '44444444-4444-4444-8444-444444444444';
const req = (method: string, body?: unknown, url = 'http://localhost/api') => new NextRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
  vi.mocked(ownStudentId).mockResolvedValue(STUDENT);
  vi.mocked(requireOwnerOf).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
});

describe('Diploma plan: owner only, server-derived numbers', () => {
  it('an actor with no own Student (Parent / Teacher / Coordinator) gets 404 and never another Student\'s plan', async () => {
    vi.mocked(ownStudentId).mockResolvedValue(null);
    expect((await (planGET as any)()).status).toBe(404);
    expect(getPlanView).not.toHaveBeenCalled();
  });
  it('signed out -> 401', async () => {
    vi.mocked(requireActor).mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHORIZED' } as any);
    expect((await (planGET as any)()).status).toBe(401);
  });
  it('credits, grades or points can never be sent', async () => {
    for (const extra of [{ credits: 2 }, { grade: 'A*' }, { points: 140 }]) {
      const r = await (entryPOST as any)(req('POST', { syllabusCode: '9709', level: 'A', ...extra }));
      expect(r.status).toBe(400);
    }
    expect(addPlanEntry).not.toHaveBeenCalled();
  });
  it('an invalid syllabus code / level / series is rejected before the service', async () => {
    for (const body of [{ syllabusCode: '97A9', level: 'A' }, { syllabusCode: '9709', level: 'A2' }, { syllabusCode: '9709', level: 'AS', expectedSeries: { year: 2027, month: 5 } }]) expect((await (entryPOST as any)(req('POST', body))).status).toBe(400);
  });
  it('the service decides eligibility (group / level / series) and the route maps it to 409', async () => {
    vi.mocked(addPlanEntry).mockRejectedValue(new (AicePlanError as any)('GROUP_NOT_ELIGIBLE'));
    const r = await (entryPOST as any)(req('POST', { syllabusCode: '9709', level: 'A', countedGroup: 'GROUP_3' }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('GROUP_NOT_ELIGIBLE');
  });
  it('another Student\'s entry (or an unknown one) is 404', async () => {
    vi.mocked(updatePlanEntry).mockRejectedValue(new (AicePlanError as any)('NOT_FOUND'));
    expect((await (entryPATCH as any)(req('PATCH', { level: 'AS' }), ctx(ENTRY))).status).toBe(404);
    expect((await (entryDELETE as any)(req('DELETE'), ctx('nope'))).status).toBe(400);
  });
});

describe('Cambridge results: never the Student', () => {
  const body = { institutionId: INST, studentId: STUDENT, syllabusCode: '9709', level: 'A', series: { year: 2027, month: 6 }, grade: 'A*', source: 'OFFICIAL_STATEMENT' };
  it('a Student (or anyone not the coordinator of that Student\'s institution) is 403', async () => {
    vi.mocked(requireLearnerInInstitution).mockRejectedValue(new (InstitutionIntelligenceAccessDeniedError as any)('denied'));
    expect((await (resultPOST as any)(req('POST', body))).status).toBe(403);
    expect(recordResult).not.toHaveBeenCalled();
  });
  it('the coordinator of the Student\'s institution records it; DEV_FIXTURE cannot be sent', async () => {
    vi.mocked(requireLearnerInInstitution).mockResolvedValue(undefined as any);
    expect((await (resultPOST as any)(req('POST', body))).status).toBe(200);
    expect(recordResult).toHaveBeenCalledWith(expect.objectContaining({ studentId: STUDENT, recordedByUserId: 'actor' }));
    expect((await (resultPOST as any)(req('POST', { ...body, source: 'DEV_FIXTURE' }))).status).toBe(400);
  });
});

describe('Teacher exam insights: own roster only', () => {
  it('a Teacher without an assignment for the class is 403 and no data is read', async () => {
    vi.mocked(getTeacherClassRoster).mockRejectedValue(new Error('denied'));
    expect((await (teacherGET as any)(req('GET', undefined, `http://localhost/api/teacher/exam-insights?classId=${CLASS}`))).status).toBe(403);
    expect(examGapsFor).not.toHaveBeenCalled();
  });
  it('the aggregation is limited to the roster Students', async () => {
    vi.mocked(getTeacherClassRoster).mockResolvedValue([{ studentId: STUDENT, name: 'A' }] as any);
    expect((await (teacherGET as any)(req('GET', undefined, `http://localhost/api/teacher/exam-insights?classId=${CLASS}&family=PISA`))).status).toBe(200);
    expect(examGapsFor).toHaveBeenCalledWith([STUDENT], { families: ['PISA'], includePerStudent: true });
    // Objective first: the class's exam goals, for the same roster only.
    expect(examGoalsFor).toHaveBeenCalledWith([STUDENT], { includePerStudent: true });
  });
  it('manipulated ids / families are rejected', async () => {
    expect((await (teacherGET as any)(req('GET', undefined, 'http://localhost/api/teacher/exam-insights?classId=x'))).status).toBe(400);
    expect((await (teacherGET as any)(req('GET', undefined, `http://localhost/api/teacher/exam-insights?classId=${CLASS}&family=pisa;drop`))).status).toBe(400);
  });
});

describe('Explorer readiness copy (never a generic "Próximamente" when the state is known)', () => {
  it.each([
    [{ readiness: 'FULL_MOCK_READY' }, 'fullMock'],
    [{ readiness: 'REDUCED_MOCK_READY' }, 'reducedMock'],
    [{ readiness: 'PRACTICE_READY' }, 'practice'],
    [{ readiness: 'STRUCTURE_READY', bankInProgress: true }, 'bankInProgress'],
    [{ readiness: 'STRUCTURE_READY' }, 'structureOnly'],
    [{ readiness: 'CATALOG_ONLY' }, 'notYet'],
    [{ readiness: 'FULL_MOCK_READY', notExaminable: true }, 'notExaminable'],
  ])('%j -> %s', (n, key) => {
    expect(readinessKey(n as never)).toBe(key);
  });
});
