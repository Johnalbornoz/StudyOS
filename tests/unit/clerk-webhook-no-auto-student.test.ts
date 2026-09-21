/**
 * Onboarding/authorization rework (2026-09-21) -- proves the specific,
 * explicitly required regression test: "el webhook de Clerk ya no crea
 * automáticamente un estudiante". `user.created` must only ever ensure
 * the bare F1 canonical `users` row -- never a `students` row, never
 * any `user_roles` grant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyMock = vi.fn();
vi.mock('svix', () => ({ Webhook: class { verify = (...a: any[]) => verifyMock(...a); } }));

const headersMock = vi.fn();
vi.mock('next/headers', () => ({ headers: () => headersMock() }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

import { POST } from '@/app/api/webhooks/clerk/route';

function makeRequest(eventType: string, data: any) {
  return { text: async () => JSON.stringify({ type: eventType, data }) } as any;
}

beforeEach(() => {
  process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_fixture_not_a_real_secret';
  headersMock.mockReset().mockReturnValue(
    new Map([
      ['svix-id', 'id-1'],
      ['svix-timestamp', '123'],
      ['svix-signature', 'sig-1'],
    ])
  );
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'user-1' });
});

describe('POST /api/webhooks/clerk -- user.created never provisions a Student', () => {
  it('only calls getOrCreateCanonicalUser -- no students/user_roles provisioning of any kind', async () => {
    const data = { id: 'clerk-new-user-1', email_addresses: [{ email_address: 'new@test.com' }], first_name: 'New', last_name: 'User' };
    verifyMock.mockReturnValue({ type: 'user.created', data });

    const res = await POST(makeRequest('user.created', data));
    expect(res.status).toBe(200);
    expect(getOrCreateCanonicalUserMock).toHaveBeenCalledTimes(1);
    expect(getOrCreateCanonicalUserMock).toHaveBeenCalledWith('clerk-new-user-1', 'new@test.com');
  });

  it('a signup with no email address still only ensures the canonical user, with a null email -- never a placeholder Student email/row', async () => {
    const data = { id: 'clerk-new-user-2', email_addresses: [], first_name: null, last_name: null };
    verifyMock.mockReturnValue({ type: 'user.created', data });

    await POST(makeRequest('user.created', data));
    expect(getOrCreateCanonicalUserMock).toHaveBeenCalledWith('clerk-new-user-2', null);
  });

  it('an unrelated event type never calls getOrCreateCanonicalUser at all', async () => {
    const data = { id: 'clerk-user-3' };
    verifyMock.mockReturnValue({ type: 'user.updated', data });

    const res = await POST(makeRequest('user.updated', data));
    expect(res.status).toBe(200);
    expect(getOrCreateCanonicalUserMock).not.toHaveBeenCalled();
  });

  it('an invalid signature is rejected before any provisioning', async () => {
    verifyMock.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const res = await POST(makeRequest('user.created', { id: 'x' }));
    expect(res.status).toBe(400);
    expect(getOrCreateCanonicalUserMock).not.toHaveBeenCalled();
  });
});
