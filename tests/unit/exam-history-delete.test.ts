/**
 * Exam history delete -- service routing (history.service.ts) and the HTTP
 * contract of DELETE /api/exams/attempts/[id] and DELETE /api/exams/instances/[id].
 * The real-database behaviour (result / evidence retention, fresh ids, history
 * visibility) is proven by scripts/operations/track-b-exam-delete-scenarios.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_name: string, h: unknown) => h }));
vi.mock('@/lib/simulation/attempt.service', () => ({ getSimulationAttempt: vi.fn(), abandonSimulationAttempt: vi.fn() }));
vi.mock('@/lib/exam-core/route-auth', () => ({ requireActor: vi.fn(), requireOwnerOf: vi.fn() }));
vi.mock('@/lib/exam-core/exam-instance.service', () => {
  class ExamInstanceError extends Error {
    constructor(public readonly code: string, detail?: string) {
      super(detail ? `${code}: ${detail}` : code);
    }
  }
  return { ExamInstanceError, findInstanceByAttempt: vi.fn(), deleteExamInstance: vi.fn(), getExamInstance: vi.fn(), toInstanceView: vi.fn() };
});

import { db } from '@/lib/db';
import { getSimulationAttempt, abandonSimulationAttempt } from '@/lib/simulation/attempt.service';
import { requireActor, requireOwnerOf } from '@/lib/exam-core/route-auth';
import { findInstanceByAttempt, deleteExamInstance, getExamInstance, ExamInstanceError } from '@/lib/exam-core/exam-instance.service';
import { deleteAttemptFromHistory } from '@/lib/exam-core/history.service';
import { DELETE as deleteAttemptRoute } from '@/app/api/exams/attempts/[id]/route';
import { DELETE as deleteInstanceRoute } from '@/app/api/exams/instances/[id]/route';

const q = db.query as unknown as ReturnType<typeof vi.fn>;
const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ATTEMPT = '33333333-3333-3333-3333-333333333333';
const INSTANCE = '44444444-4444-4444-4444-444444444444';
const attempt = (status: string) => ({ id: ATTEMPT, studentId: OWNER, status, examAttemptId: 'ea' });
const sqls = () => q.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  q.mockResolvedValue({ rows: [] });
});

describe('deleteAttemptFromHistory', () => {
  it('a foreign Student gets NOT_FOUND and nothing is written', async () => {
    vi.mocked(getSimulationAttempt).mockResolvedValue(attempt('COMPLETED') as any);
    await expect(deleteAttemptFromHistory(ATTEMPT, { confirm: true, ownerStudentId: OTHER })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(q).not.toHaveBeenCalled();
    expect(deleteExamInstance).not.toHaveBeenCalled();
  });

  it('an attempt with an exam instance follows the instance contract', async () => {
    vi.mocked(getSimulationAttempt).mockResolvedValue(attempt('COMPLETED') as any);
    vi.mocked(findInstanceByAttempt).mockResolvedValue({ id: INSTANCE, status: 'COMPLETED' } as any);
    vi.mocked(deleteExamInstance).mockResolvedValue({ instance: { status: 'DELETED' }, resultPreserved: true, attemptAbandoned: false } as any);
    const out = await deleteAttemptFromHistory(ATTEMPT, { confirm: true, ownerStudentId: OWNER });
    expect(deleteExamInstance).toHaveBeenCalledWith(INSTANCE, expect.objectContaining({ confirm: true, ownerStudentId: OWNER }));
    expect(out).toEqual({ status: 'DELETED', resultPreserved: true, attemptAbandoned: false, alreadyDeleted: false });
  });

  it('a completed pre-V2 attempt needs confirmation, then is hidden -- never deleted, never abandoned', async () => {
    vi.mocked(getSimulationAttempt).mockResolvedValue(attempt('COMPLETED') as any);
    vi.mocked(findInstanceByAttempt).mockResolvedValue(null);
    q.mockResolvedValue({ rows: [{ hidden_at: null }] });
    await expect(deleteAttemptFromHistory(ATTEMPT, { confirm: false, ownerStudentId: OWNER })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const out = await deleteAttemptFromHistory(ATTEMPT, { confirm: true, ownerStudentId: OWNER });
    expect(out).toMatchObject({ resultPreserved: true, attemptAbandoned: false, alreadyDeleted: false });
    expect(abandonSimulationAttempt).not.toHaveBeenCalled();
    expect(sqls().some((s) => /UPDATE simulation_attempts SET hidden_at = now\(\)/.test(s))).toBe(true);
    expect(sqls().some((s) => /\bDELETE\b/i.test(s))).toBe(false);
  });

  it('an in-progress pre-V2 attempt is cancelled (ABANDONED) and hidden', async () => {
    vi.mocked(getSimulationAttempt).mockResolvedValueOnce(attempt('ACTIVE') as any).mockResolvedValueOnce(attempt('ABANDONED') as any);
    vi.mocked(findInstanceByAttempt).mockResolvedValue(null);
    q.mockResolvedValue({ rows: [{ hidden_at: null }] });
    const out = await deleteAttemptFromHistory(ATTEMPT, { confirm: true, ownerStudentId: OWNER });
    expect(abandonSimulationAttempt).toHaveBeenCalledWith(ATTEMPT);
    expect(out).toMatchObject({ attemptAbandoned: true, resultPreserved: false });
  });

  it('deleting twice is safe: the second call reports alreadyDeleted and writes nothing', async () => {
    vi.mocked(getSimulationAttempt).mockResolvedValue(attempt('COMPLETED') as any);
    vi.mocked(findInstanceByAttempt).mockResolvedValue(null);
    q.mockResolvedValue({ rows: [{ hidden_at: new Date() }] });
    const out = await deleteAttemptFromHistory(ATTEMPT, { confirm: false, ownerStudentId: OWNER });
    expect(out.alreadyDeleted).toBe(true);
    expect(sqls().every((s) => !/^\s*UPDATE/i.test(s))).toBe(true);
  });
});

const req = (body: unknown = { confirm: true }) => new NextRequest('http://localhost/api', { method: 'DELETE', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('DELETE /api/exams/attempts/[id]', () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
  });
  it('rejects a malformed id', async () => {
    expect((await (deleteAttemptRoute as any)(req(), ctx('nope'))).status).toBe(400);
  });
  it('answers 404 for an unknown id', async () => {
    vi.mocked(getSimulationAttempt).mockResolvedValue(null);
    expect((await (deleteAttemptRoute as any)(req(), ctx(ATTEMPT))).status).toBe(404);
  });
  it('answers 404 (not 403) for another Student\'s attempt and never deletes it', async () => {
    vi.mocked(getSimulationAttempt).mockResolvedValue(attempt('COMPLETED') as any);
    vi.mocked(requireOwnerOf).mockResolvedValue({ ok: false, status: 403, error: 'FORBIDDEN' } as any);
    const r = await (deleteAttemptRoute as any)(req(), ctx(ATTEMPT));
    expect(r.status).toBe(404);
    expect(findInstanceByAttempt).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
  });
  it('answers 409 when confirmation is missing', async () => {
    vi.mocked(getSimulationAttempt).mockResolvedValue(attempt('COMPLETED') as any);
    vi.mocked(requireOwnerOf).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
    vi.mocked(findInstanceByAttempt).mockResolvedValue(null);
    q.mockResolvedValue({ rows: [{ hidden_at: null }] });
    const r = await (deleteAttemptRoute as any)(req({}), ctx(ATTEMPT));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('CONFIRMATION_REQUIRED');
  });
  it('rejects unknown body fields', async () => {
    expect((await (deleteAttemptRoute as any)(req({ confirm: true, cascade: true }), ctx(ATTEMPT))).status).toBe(400);
  });
  it('unauthenticated -> 401', async () => {
    vi.mocked(requireActor).mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHORIZED' } as any);
    expect((await (deleteAttemptRoute as any)(req(), ctx(ATTEMPT))).status).toBe(401);
  });
});

describe('DELETE /api/exams/instances/[id]', () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
  });
  it('a repeated delete by the owner is answered 200 DELETED (idempotent)', async () => {
    const deleted = { id: INSTANCE, studentId: OWNER, status: 'DELETED', completedAt: null };
    vi.mocked(getExamInstance).mockResolvedValue(deleted as any);
    vi.mocked(requireOwnerOf).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
    vi.mocked(deleteExamInstance).mockResolvedValue({ instance: deleted, resultPreserved: false, attemptAbandoned: false } as any);
    const r = await (deleteInstanceRoute as any)(req(), ctx(INSTANCE));
    expect(r.status).toBe(200);
    expect((await r.json()).data.status).toBe('DELETED');
  });
  it('another Student\'s instance is 404 and is never passed to the service', async () => {
    vi.mocked(getExamInstance).mockResolvedValue({ id: INSTANCE, studentId: OWNER, status: 'COMPLETED' } as any);
    vi.mocked(requireOwnerOf).mockResolvedValue({ ok: false, status: 403, error: 'FORBIDDEN' } as any);
    expect((await (deleteInstanceRoute as any)(req(), ctx(INSTANCE))).status).toBe(404);
    expect(deleteExamInstance).not.toHaveBeenCalled();
  });
  it('a missing confirmation on a completed instance is 409', async () => {
    vi.mocked(getExamInstance).mockResolvedValue({ id: INSTANCE, studentId: OWNER, status: 'COMPLETED' } as any);
    vi.mocked(requireOwnerOf).mockResolvedValue({ ok: true, actorUserId: 'actor' } as any);
    vi.mocked(deleteExamInstance).mockRejectedValue(new (ExamInstanceError as any)('CONFIRMATION_REQUIRED'));
    expect((await (deleteInstanceRoute as any)(req({}), ctx(INSTANCE))).status).toBe(409);
  });
});
