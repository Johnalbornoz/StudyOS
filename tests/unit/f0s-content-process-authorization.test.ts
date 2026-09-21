/**
 * F0-S Finding B -- POST /api/content/process previously trusted the
 * client-supplied `contentSourceId` with no ownership check at all (a
 * literal `// TODO: Verify authorization - user owns this content
 * source` in the route). This suite proves the fix: the effective
 * learner is resolved entirely from the authenticated Clerk session
 * (never from the request body, which carries no studentId at all),
 * and `contentSourceId` ownership is verified against that identity
 * before any chunking/embedding work runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));

const requireStudentIdMock = vi.fn();
const verifyContentSourceAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireStudentId: (...a: any[]) => requireStudentIdMock(...a),
  verifyContentSourceAccess: (...a: any[]) => verifyContentSourceAccessMock(...a),
}));

const processContentForChunkingMock = vi.fn();
vi.mock('@/services/content-chunking.service', () => ({
  processContentForChunking: (...a: any[]) => processContentForChunkingMock(...a),
}));

const generateEmbeddingMock = vi.fn();
const storeChunkWithEmbeddingMock = vi.fn();
vi.mock('@/services/embedding.service', () => ({
  generateEmbedding: (...a: any[]) => generateEmbeddingMock(...a),
  storeChunkWithEmbedding: (...a: any[]) => storeChunkWithEmbeddingMock(...a),
}));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { POST } from '@/app/api/content/process/route';

const OWN_STUDENT = '11111111-1111-4111-8111-111111111111';
const OWN_SOURCE = '44444444-4444-4444-8444-444444444444';

function makeRequest(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-user-1' });
  requireStudentIdMock.mockReset().mockResolvedValue(OWN_STUDENT);
  verifyContentSourceAccessMock.mockReset().mockResolvedValue(true);
  processContentForChunkingMock.mockReset().mockReturnValue({
    chunks: [{ content: 'chunk text', metadata: { sequenceOrder: 0 } }],
    totalTokens: 10,
    estimatedReadingTime: 1,
  });
  generateEmbeddingMock.mockReset().mockResolvedValue([0.1, 0.2]);
  storeChunkWithEmbeddingMock.mockReset().mockResolvedValue({ chunkId: 'chunk-1' });
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
});

describe('F0-S Finding B -- content process authorization', () => {
  it('OWN: an authenticated student processing their own content source succeeds', async () => {
    const res: any = await POST(makeRequest({ contentSourceId: OWN_SOURCE, text: 'some extracted text' }));
    expect(res.status ?? 200).toBe(200);
    expect(requireStudentIdMock).toHaveBeenCalledWith('clerk-user-1');
    expect(verifyContentSourceAccessMock).toHaveBeenCalledWith(OWN_STUDENT, OWN_SOURCE);
    expect(processContentForChunkingMock).toHaveBeenCalled();
  });

  it("OTHER STUDENT'S contentSourceId: denied before any chunking/embedding work runs, regardless of what the client sends", async () => {
    verifyContentSourceAccessMock.mockResolvedValue(false);
    const res: any = await POST(makeRequest({ contentSourceId: 'someone-elses-source-id', text: 'some extracted text' }));
    expect(res.status).toBe(404);
    expect(processContentForChunkingMock).not.toHaveBeenCalled();
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
  });

  it('ANONYMOUS: no authenticated session is denied before ownership is even resolved', async () => {
    authMock.mockResolvedValue({ userId: null });
    const res: any = await POST(makeRequest({ contentSourceId: OWN_SOURCE, text: 'some extracted text' }));
    expect(res.status).toBe(401);
    expect(requireStudentIdMock).not.toHaveBeenCalled();
    expect(verifyContentSourceAccessMock).not.toHaveBeenCalled();
  });

  it('NO ACTIVE STUDENT ROLE: denied before ownership is even resolved, never silently provisioned', async () => {
    requireStudentIdMock.mockResolvedValue(null);
    const res: any = await POST(makeRequest({ contentSourceId: OWN_SOURCE, text: 'some extracted text' }));
    expect(res.status).toBe(403);
    expect(verifyContentSourceAccessMock).not.toHaveBeenCalled();
  });

  it('the studentId used for the ownership check is always the server-resolved identity, never anything from the request body', async () => {
    await POST(makeRequest({ contentSourceId: OWN_SOURCE, text: 'x', studentId: 'attacker-supplied-id' } as any));
    expect(requireStudentIdMock).toHaveBeenCalledWith('clerk-user-1');
    expect(verifyContentSourceAccessMock).toHaveBeenCalledWith(OWN_STUDENT, OWN_SOURCE);
    expect(verifyContentSourceAccessMock).not.toHaveBeenCalledWith('attacker-supplied-id', expect.anything());
  });
});
