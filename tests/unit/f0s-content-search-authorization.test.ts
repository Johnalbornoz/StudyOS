/**
 * F0-S Finding B -- GET /api/content/search previously trusted the
 * client-supplied `studentId`/`subjectId` query params at face value
 * (a literal `// TODO: Verify authorization` in the route). This
 * suite proves the fix: the caller must actually own `studentId`
 * (verifyStudentAccess) AND `subjectId` must actually belong to that
 * `studentId` (verifySubjectAccess) before any content is searched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
const verifySubjectAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
  verifySubjectAccess: (...a: any[]) => verifySubjectAccessMock(...a),
}));

const retrieveContextMock = vi.fn();
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => retrieveContextMock(...a) }));

const generateEmbeddingMock = vi.fn();
vi.mock('@/services/embedding.service', () => ({ generateEmbedding: (...a: any[]) => generateEmbeddingMock(...a) }));

import { GET } from '@/app/api/content/search/route';

const OWN_STUDENT = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT = '22222222-2222-4222-8222-222222222222';
const OWN_SUBJECT = '33333333-3333-4333-8333-333333333333';

function makeRequest(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return { url: `https://studyus.test/api/content/search?${qs}` } as any;
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-user-1', email: 'a@b.com', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  verifySubjectAccessMock.mockReset().mockResolvedValue(true);
  generateEmbeddingMock.mockReset().mockResolvedValue([0.1, 0.2]);
  retrieveContextMock.mockReset().mockResolvedValue({
    chunks: [{ id: 'chunk-1', text: 'own content', similarity: 0.9, sequenceOrder: 0 }],
    sourceInfo: { id: 'src-1', language: 'en' },
  });
});

describe('F0-S Finding B -- content search authorization', () => {
  it('OWN: an authenticated student searching their own student/subject succeeds', async () => {
    const res: any = await GET(makeRequest({ studentId: OWN_STUDENT, subjectId: OWN_SUBJECT, query: 'photosynthesis' }));
    expect(res.status ?? 200).toBe(200);
    expect(verifyStudentAccessMock).toHaveBeenCalledWith('clerk-user-1', OWN_STUDENT, 'student');
    expect(verifySubjectAccessMock).toHaveBeenCalledWith(OWN_STUDENT, OWN_SUBJECT);
    expect(retrieveContextMock).toHaveBeenCalled();
  });

  it('OTHER STUDENT: a studentId the caller does not own is denied before any content is searched', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await GET(makeRequest({ studentId: OTHER_STUDENT, subjectId: OWN_SUBJECT, query: 'photosynthesis' }));
    expect(res.status).toBe(403);
    expect(retrieveContextMock).not.toHaveBeenCalled();
  });

  it("MANIPULATED subjectId: a subject that does not belong to the caller's studentId is denied, even though the studentId itself is owned", async () => {
    verifySubjectAccessMock.mockResolvedValue(false);
    const res: any = await GET(makeRequest({ studentId: OWN_STUDENT, subjectId: 'someone-elses-subject', query: 'photosynthesis' }));
    expect(res.status).toBe(404);
    expect(retrieveContextMock).not.toHaveBeenCalled();
  });

  it('ANONYMOUS: no authenticated session is denied before any ownership check runs', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await GET(makeRequest({ studentId: OWN_STUDENT, subjectId: OWN_SUBJECT, query: 'photosynthesis' }));
    expect(res.status).toBe(401);
    expect(verifyStudentAccessMock).not.toHaveBeenCalled();
    expect(retrieveContextMock).not.toHaveBeenCalled();
  });

  it('a denied request never returns another learner\'s content in its body', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await GET(makeRequest({ studentId: OTHER_STUDENT, subjectId: OWN_SUBJECT, query: 'photosynthesis' }));
    const body = await res.json();
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/own content/);
  });
});
