/**
 * F1 -- integration-style tests for the 3 new /api/identity/* routes.
 * Covers: anonymous denial, unsupported role, privilege escalation
 * through the role-select payload, privilege escalation through the
 * workspace-switch payload, and that the acted-upon identity is always
 * the authenticated caller's own (never a client-supplied id).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  getOrCreateStudentId: vi.fn().mockResolvedValue('student-1'),
}));

const getOrCreateCanonicalUserMock = vi.fn();
const assignSelfServiceRoleMock = vi.fn();
const resolveDefaultWorkspaceMock = vi.fn();
const setActiveWorkspaceMock = vi.fn();
const getUserRolesMock = vi.fn();
const resolveAvailableWorkspacesMock = vi.fn();
vi.mock('@/lib/identity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identity')>('@/lib/identity');
  return {
    ...actual,
    getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a),
    assignSelfServiceRole: (...a: any[]) => assignSelfServiceRoleMock(...a),
    resolveDefaultWorkspace: (...a: any[]) => resolveDefaultWorkspaceMock(...a),
    setActiveWorkspace: (...a: any[]) => setActiveWorkspaceMock(...a),
    getUserRoles: (...a: any[]) => getUserRolesMock(...a),
    resolveAvailableWorkspaces: (...a: any[]) => resolveAvailableWorkspacesMock(...a),
  };
});

import { GET as meGET } from '@/app/api/identity/me/route';
import { POST as selectRolePOST } from '@/app/api/identity/roles/select/route';
import { POST as workspacePOST } from '@/app/api/identity/workspace/route';

function req(body: any) {
  return { json: async () => body } as any;
}

const OWN_USER = { id: 'canonical-user-1', clerkId: 'clerk-1', email: 'a@b.com', status: 'ACTIVE' as const, activeWorkspace: null };

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: 'a@b.com', role: 'student' });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue(OWN_USER);
  assignSelfServiceRoleMock.mockReset().mockResolvedValue(undefined);
  resolveDefaultWorkspaceMock.mockReset().mockResolvedValue('STUDENT');
  setActiveWorkspaceMock.mockReset().mockResolvedValue(true);
  getUserRolesMock.mockReset().mockResolvedValue([]);
  resolveAvailableWorkspacesMock.mockReset().mockResolvedValue([]);
});

describe('GET /api/identity/me', () => {
  it('ANON: denied before resolving any identity', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await meGET();
    expect(res.status).toBe(401);
    expect(getOrCreateCanonicalUserMock).not.toHaveBeenCalled();
  });

  it('OWN: resolves the caller\'s own identity from the authenticated session, never a request parameter', async () => {
    const res: any = await meGET();
    expect(res.status ?? 200).toBe(200);
    expect(getOrCreateCanonicalUserMock).toHaveBeenCalledWith('clerk-1', 'a@b.com');
  });
});

describe('POST /api/identity/roles/select', () => {
  it('ANON: denied before any role is assigned', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await selectRolePOST(req({ role: 'STUDENT' }));
    expect(res.status).toBe(401);
    expect(assignSelfServiceRoleMock).not.toHaveBeenCalled();
  });

  it('OWN: a valid self-service role is granted to the caller\'s own resolved identity', async () => {
    const res: any = await selectRolePOST(req({ role: 'PARENT' }));
    expect(res.status ?? 200).toBe(200);
    expect(assignSelfServiceRoleMock).toHaveBeenCalledWith('clerk-1', 'canonical-user-1', 'PARENT');
  });

  it('PRIVILEGE ESCALATION: requesting INSTITUTION_ADMIN is rejected as INVALID_INPUT, never granted', async () => {
    const res: any = await selectRolePOST(req({ role: 'INSTITUTION_ADMIN' }));
    expect(res.status).toBe(400);
    expect(assignSelfServiceRoleMock).not.toHaveBeenCalled();
  });

  it('PRIVILEGE ESCALATION: requesting STUDYUS_ADMIN is rejected as INVALID_INPUT, never granted', async () => {
    const res: any = await selectRolePOST(req({ role: 'STUDYUS_ADMIN' }));
    expect(res.status).toBe(400);
    expect(assignSelfServiceRoleMock).not.toHaveBeenCalled();
  });

  it('UNSUPPORTED ROLE: an arbitrary string is rejected identically to a privileged-role attempt -- no distinguishing error', async () => {
    const escalation: any = await selectRolePOST(req({ role: 'STUDYUS_ADMIN' }));
    const garbage: any = await selectRolePOST(req({ role: 'SUPERUSER' }));
    expect(garbage.status).toBe(400);
    expect(escalation.status).toBe(garbage.status);
  });

  it('METADATA ESCALATION: extra/unexpected fields in the payload (e.g. a forged userId or role array) are ignored -- Zod strips them, only the validated `role` string is ever used', async () => {
    const res: any = await selectRolePOST(
      req({ role: 'STUDENT', userId: 'someone-elses-canonical-id', roles: ['STUDYUS_ADMIN'], metadata: { role: 'STUDYUS_ADMIN' } })
    );
    expect(res.status ?? 200).toBe(200);
    expect(assignSelfServiceRoleMock).toHaveBeenCalledWith('clerk-1', 'canonical-user-1', 'STUDENT');
  });
});

describe('POST /api/identity/workspace', () => {
  it('ANON: denied before any workspace switch is attempted', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await workspacePOST(req({ workspace: 'STUDENT' }));
    expect(res.status).toBe(401);
    expect(setActiveWorkspaceMock).not.toHaveBeenCalled();
  });

  it('FORGED WORKSPACE: an unavailable workspace is denied (fails closed at the service layer)', async () => {
    setActiveWorkspaceMock.mockResolvedValue(false);
    const res: any = await workspacePOST(req({ workspace: 'ADMIN' }));
    expect(res.status).toBe(403);
  });

  it('INVALID WORKSPACE VALUE: a value outside the fixed enum is rejected at the schema, never reaching the service', async () => {
    const res: any = await workspacePOST(req({ workspace: 'SUPERUSER_WORKSPACE' }));
    expect(res.status).toBe(400);
    expect(setActiveWorkspaceMock).not.toHaveBeenCalled();
  });

  it('OWN: an available workspace switch succeeds and acts on the caller\'s own resolved identity', async () => {
    const res: any = await workspacePOST(req({ workspace: 'STUDENT' }));
    expect(res.status ?? 200).toBe(200);
    expect(setActiveWorkspaceMock).toHaveBeenCalledWith('canonical-user-1', 'STUDENT');
  });
});
