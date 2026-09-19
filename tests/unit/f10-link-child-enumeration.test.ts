/**
 * F10 -- account enumeration fix (task §6, INV-F10 privacy). Before
 * this fix, POST /api/parent/link-child returned a distinct 404
 * NO_STUDENT_FOUND vs 200 success depending on whether the supplied
 * email matched a real student account -- a live oracle. The route
 * must now return the exact same response shape and status in both
 * cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));

const getOrCreateParentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ getOrCreateParentId: (...a: any[]) => getOrCreateParentIdMock(...a) }));

const linkChildByEmailMock = vi.fn();
const unlinkChildMock = vi.fn();
vi.mock('@/services/parent.service', () => ({
  linkChildByEmail: (...a: any[]) => linkChildByEmailMock(...a),
  unlinkChild: (...a: any[]) => unlinkChildMock(...a),
}));

import { POST } from '@/app/api/parent/link-child/route';

function jsonReq(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-parent-1' });
  getOrCreateParentIdMock.mockReset().mockResolvedValue('parent-1');
  linkChildByEmailMock.mockReset();
});

describe('POST /api/parent/link-child -- identical response whether or not the email matches a real student', () => {
  it('matching email: 200, generic message', async () => {
    linkChildByEmailMock.mockResolvedValue({ studentId: 's-1', name: 'Kid', email: 'kid@test.com', status: 'pending' });
    const res: any = await POST(jsonReq({ childEmail: 'kid@test.com' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body).not.toHaveProperty('data');
  });

  it('non-matching email: SAME 200 status and SAME response shape as a match, never a distinguishing 404', async () => {
    linkChildByEmailMock.mockRejectedValue(new Error('NO_STUDENT_FOUND'));
    const res: any = await POST(jsonReq({ childEmail: 'nobody@test.com' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body).not.toHaveProperty('error');
  });

  it('the two responses are byte-for-byte identical', async () => {
    linkChildByEmailMock.mockResolvedValueOnce({ studentId: 's-1', name: 'Kid', email: 'kid@test.com', status: 'pending' });
    const matchRes: any = await POST(jsonReq({ childEmail: 'kid@test.com' }));
    const matchBody = await matchRes.json();

    linkChildByEmailMock.mockRejectedValueOnce(new Error('NO_STUDENT_FOUND'));
    const noMatchRes: any = await POST(jsonReq({ childEmail: 'nobody@test.com' }));
    const noMatchBody = await noMatchRes.json();

    expect(matchRes.status).toBe(noMatchRes.status);
    expect(matchBody).toEqual(noMatchBody);
  });
});
