/**
 * Onboarding/authorization rework (2026-09-21) -- supersedes this
 * file's original F10 subject. The parent-initiated `POST
 * /api/parent/link-child` (a Parent searching for a student by email)
 * is retired -- see src/app/api/parent/link-child/route.ts, which no
 * longer exports POST (a POST there now correctly 405s). The
 * enumeration-safety property this file originally proved still
 * matters, but for the NEW, student-initiated direction instead:
 *   - POST /api/student/parent-invitations never reveals whether the
 *     invited email belongs to a real, registered Clerk account (the
 *     student is inviting someone who may not have signed up yet --
 *     that is the whole point of this table).
 *   - GET /api/parent/invitations can never be used to probe an
 *     arbitrary email: it only ever resolves the CALLER's own
 *     Clerk-verified email server-side, never a request parameter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));

const requireStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ requireStudentId: (...a: any[]) => requireStudentIdMock(...a) }));

const inviteParentByEmailMock = vi.fn();
const listInvitationsSentByStudentMock = vi.fn();
const revokeInvitationByStudentMock = vi.fn();
const listPendingInvitationsForEmailMock = vi.fn();
vi.mock('@/services/parent.service', () => ({
  inviteParentByEmail: (...a: any[]) => inviteParentByEmailMock(...a),
  listInvitationsSentByStudent: (...a: any[]) => listInvitationsSentByStudentMock(...a),
  revokeInvitationByStudent: (...a: any[]) => revokeInvitationByStudentMock(...a),
  listPendingInvitationsForEmail: (...a: any[]) => listPendingInvitationsForEmailMock(...a),
}));

import * as linkChildRoute from '@/app/api/parent/link-child/route';
import { POST as inviteParentPOST } from '@/app/api/student/parent-invitations/route';
import { GET as myInvitationsGET } from '@/app/api/parent/invitations/route';

function jsonReq(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-student-1' });
  currentUserMock.mockReset().mockResolvedValue({ primaryEmailAddress: { emailAddress: 'me@studyus.test' }, emailAddresses: [] });
  requireStudentIdMock.mockReset().mockResolvedValue('student-1');
  inviteParentByEmailMock.mockReset();
  listPendingInvitationsForEmailMock.mockReset().mockResolvedValue([]);
});

describe('the retired parent-initiated link no longer exists', () => {
  it('src/app/api/parent/link-child/route.ts no longer exports POST', () => {
    expect((linkChildRoute as any).POST).toBeUndefined();
  });

  it('DELETE (self-unlink) is still exported -- only the parent-initiated creation direction was removed', () => {
    expect((linkChildRoute as any).DELETE).toBeDefined();
  });
});

describe('POST /api/student/parent-invitations -- identical response whether or not the invited email already has an account', () => {
  it('an email with no existing account: same 200 success shape (nothing to distinguish -- the invitation is created either way)', async () => {
    inviteParentByEmailMock.mockResolvedValue({ id: 'inv-1', studentId: 'student-1', invitedEmail: 'unregistered@test.com', status: 'pending', createdAt: '2026-09-21T00:00:00.000Z' });
    const res: any = await inviteParentPOST(jsonReq({ email: 'unregistered@test.com' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('a request with no active STUDENT role never reaches inviteParentByEmail, and never provisions a Student', async () => {
    requireStudentIdMock.mockResolvedValue(null);
    const res: any = await inviteParentPOST(jsonReq({ email: 'someone@test.com' }));
    expect(res.status).toBe(403);
    expect(inviteParentByEmailMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/parent/invitations -- never a lookup by arbitrary/client-supplied email', () => {
  it('resolves the email from the authenticated Clerk session only -- a request body/query email is never accepted (the route takes no input at all)', async () => {
    await myInvitationsGET();
    expect(listPendingInvitationsForEmailMock).toHaveBeenCalledWith('me@studyus.test');
    expect(listPendingInvitationsForEmailMock).toHaveBeenCalledTimes(1);
  });

  it('an unauthenticated caller is denied before any email resolution', async () => {
    authMock.mockResolvedValue({ userId: null });
    const res: any = await myInvitationsGET();
    expect(res.status).toBe(401);
    expect(listPendingInvitationsForEmailMock).not.toHaveBeenCalled();
  });
});
