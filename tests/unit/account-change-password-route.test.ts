/**
 * POST /api/account/change-password -- route-level behavior. The
 * service-level guarantees (verify-then-update-then-clear, idempotent
 * replay, no password in audit) are proven in
 * admin-user-management.test.ts; this file proves the route's own
 * responsibilities: session-only identity resolution, rate limiting,
 * input validation, `Cache-Control: no-store` on every response, and
 * that no target id is ever accepted from the request body (so user A
 * can never resolve user B's requirement).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));

const checkRateLimitMock = vi.fn();
vi.mock('@/lib/auth', () => ({ checkRateLimit: (...a: any[]) => checkRateLimitMock(...a) }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const changeOwnPasswordAndClearRequirementMock = vi.fn();
vi.mock('@/services/user-admin.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/user-admin.service')>('@/services/user-admin.service');
  return {
    ...actual,
    changeOwnPasswordAndClearRequirement: (...a: any[]) => changeOwnPasswordAndClearRequirementMock(...a),
  };
});

import { POST } from '@/app/api/account/change-password/route';
import { CurrentPasswordInvalidError, PasswordUpdateFailedError, AccountNotActiveError } from '@/services/user-admin.service';

function request(body: unknown) {
  return new Request('https://studyus.test/api/account/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

const VALID_BODY = { currentPassword: 'temp-pass-1', newPassword: 'NewStrongPass1!', confirmNewPassword: 'NewStrongPass1!' };

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-user-1' });
  checkRateLimitMock.mockReset().mockReturnValue(true);
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });
  changeOwnPasswordAndClearRequirementMock.mockReset().mockResolvedValue(undefined);
});

describe('authentication and identity -- always from the session, never from the request body', () => {
  it('no session -> 401, and the service is never called', async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(401);
    expect(changeOwnPasswordAndClearRequirementMock).not.toHaveBeenCalled();
  });

  it('a request body with an extra userId/targetUserId field is ignored -- the Zod schema has no such field, and the resolved clerkUserId always comes from auth()', async () => {
    await POST(request({ ...VALID_BODY, userId: 'someone-elses-clerk-id', targetUserId: 'someone-elses-canonical-id' }));
    expect(changeOwnPasswordAndClearRequirementMock).toHaveBeenCalledWith('clerk-user-1', 'user-1', 'ACTIVE', 'temp-pass-1', 'NewStrongPass1!');
  });
});

describe('rate limiting', () => {
  it('returns 429 and never calls the service when rate-limited', async () => {
    checkRateLimitMock.mockReturnValue(false);
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(429);
    expect(changeOwnPasswordAndClearRequirementMock).not.toHaveBeenCalled();
  });

  it('is keyed per-user with a strict budget (5/60s), stricter than the 30/60s admin default', async () => {
    await POST(request(VALID_BODY));
    expect(checkRateLimitMock).toHaveBeenCalledWith('clerk-user-1', 'account.change-password', 5, 60);
  });
});

describe('input validation', () => {
  it('rejects a mismatched confirmation -- never calls the service with unconfirmed input', async () => {
    const res = await POST(request({ currentPassword: 'x', newPassword: 'NewStrongPass1!', confirmNewPassword: 'Different1!' }));
    expect(res.status).toBe(400);
    expect(changeOwnPasswordAndClearRequirementMock).not.toHaveBeenCalled();
  });

  it('rejects a new password under 8 characters', async () => {
    const res = await POST(request({ currentPassword: 'x', newPassword: 'short', confirmNewPassword: 'short' }));
    expect(res.status).toBe(400);
    expect(changeOwnPasswordAndClearRequirementMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON gracefully with 400, never a 500', async () => {
    const badRequest = new Request('https://studyus.test/api/account/change-password', { method: 'POST', body: 'not json' }) as any;
    const res = await POST(badRequest);
    expect(res.status).toBe(400);
  });
});

describe('error mapping and generic, safe responses', () => {
  it('CurrentPasswordInvalidError -> 400 CURRENT_PASSWORD_INVALID, no password echoed', async () => {
    changeOwnPasswordAndClearRequirementMock.mockRejectedValue(new CurrentPasswordInvalidError());
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('CURRENT_PASSWORD_INVALID');
    expect(JSON.stringify(body)).not.toMatch(/temp-pass-1|NewStrongPass1!/);
  });

  it('PasswordUpdateFailedError -> 400 PASSWORD_UPDATE_FAILED with Clerk\'s own reason, never the password', async () => {
    changeOwnPasswordAndClearRequirementMock.mockRejectedValue(new PasswordUpdateFailedError('Password too common'));
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PASSWORD_UPDATE_FAILED');
    expect(body.message).toBe('Password too common');
  });

  it('AccountNotActiveError -> 403 ACCOUNT_NOT_ACTIVE', async () => {
    changeOwnPasswordAndClearRequirementMock.mockRejectedValue(new AccountNotActiveError());
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it('a genuine success returns {success:true} and nothing else -- no password, no Clerk internals', async () => {
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });
});

describe('Cache-Control: no-store on every response', () => {
  it.each([
    ['unauthenticated', async () => { authMock.mockResolvedValue({ userId: null }); return POST(request(VALID_BODY)); }],
    ['rate limited', async () => { checkRateLimitMock.mockReturnValue(false); return POST(request(VALID_BODY)); }],
    ['invalid input', async () => POST(request({ currentPassword: 'x', newPassword: 'short', confirmNewPassword: 'short' }))],
    ['current password invalid', async () => { changeOwnPasswordAndClearRequirementMock.mockRejectedValue(new CurrentPasswordInvalidError()); return POST(request(VALID_BODY)); }],
    ['success', async () => POST(request(VALID_BODY))],
  ])('%s response carries Cache-Control: no-store', async (_label, run) => {
    const res = await run();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
