import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));
const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...args: any[]) => getOrCreateCanonicalUserMock(...args) }));
const canAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canAccessLearner: (...args: any[]) => canAccessLearnerMock(...args) }));
const createStudentExamProfileMock = vi.fn();
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({ createStudentExamProfile: (...args: any[]) => createStudentExamProfileMock(...args) }));
const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import { POST } from '@/app/api/exam-profiles/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const DEFINITION_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const validBody = { studentId: STUDENT_ID, examDefinitionId: DEFINITION_ID, examVersionId: VERSION_ID };

function request(body: Record<string, unknown>) {
  return new Request('https://studyus.test/api/exam-profiles', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-student', email: 'student@studyus.test' });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'canonical-user' });
  canAccessLearnerMock.mockReset().mockResolvedValue(true);
  queryMock.mockReset().mockResolvedValue({ rows: [{ id: DEFINITION_ID }] });
  createStudentExamProfileMock.mockReset().mockResolvedValue({ id: '44444444-4444-4444-8444-444444444444', ...validBody });
});

describe('Exam Profile self-service create route', () => {
  it('rejects anonymous callers before catalog or writes', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const response = await POST(request(validBody));
    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(createStudentExamProfileMock).not.toHaveBeenCalled();
  });

  it('rejects a caller without learner access before catalog or writes', async () => {
    canAccessLearnerMock.mockResolvedValue(false);
    const response = await POST(request(validBody));
    expect(response.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
    expect(createStudentExamProfileMock).not.toHaveBeenCalled();
  });

  it('rejects an unavailable, retired, draft, or mismatched selection', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const response = await POST(request(validBody));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'INVALID_EXAM_SELECTION' });
    expect(createStudentExamProfileMock).not.toHaveBeenCalled();
  });

  it('creates an owner-authorized profile from an active definition and published version', async () => {
    const response = await POST(request({ ...validBody, examDate: '2026-11-15' }));
    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(expect.stringMatching(/d\.status = 'ACTIVE'/), [DEFINITION_ID, VERSION_ID]);
    expect(createStudentExamProfileMock).toHaveBeenCalledWith(expect.objectContaining(validBody));
  });
});
