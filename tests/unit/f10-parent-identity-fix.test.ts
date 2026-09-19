/**
 * F10 -- BUG #1 fix: getOrCreateParentId previously created a
 * `profiles` row with `user_id` left NULL, which meant F2's own
 * canonical `isActiveParentOf`/`canAccessLearner` (which require
 * `profiles.user_id = actorUserId`) could never match a real parent
 * relationship. This test proves both the create path and the
 * self-repair path now populate `profiles.user_id` from the F1
 * canonical `users` identity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), currentUser: (...a: any[]) => currentUserMock(...a) }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity/canonical-user.service', () => ({
  getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a),
}));

import { getOrCreateParentId } from '@/lib/auth';

const CLERK_ID = 'clerk-parent-1';

beforeEach(() => {
  queryMock.mockReset();
  currentUserMock.mockReset().mockResolvedValue({ firstName: 'Jane', lastName: 'Doe', primaryEmailAddress: { emailAddress: 'jane@test.com' } });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'canonical-user-1' });
});

describe('getOrCreateParentId -- new parent: profiles.user_id is populated on creation', () => {
  it('inserts the profiles row with user_id set to the canonical users.id', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // no existing profile
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1' }] }); // insert

    const profileId = await getOrCreateParentId(CLERK_ID);

    expect(profileId).toBe('profile-1');
    expect(getOrCreateCanonicalUserMock).toHaveBeenCalledWith(CLERK_ID, 'jane@test.com');
    const insertCall = queryMock.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO profiles/);
    expect(insertCall[0]).toMatch(/user_id/);
    expect(insertCall[1]).toEqual(['Jane Doe', CLERK_ID, 'canonical-user-1']);
  });
});

describe('getOrCreateParentId -- existing parent created before this fix: self-repairs a NULL user_id', () => {
  it('backfills user_id when it is currently NULL, mirroring ensureProfileRows self-repair', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1', user_id: null, clerk_id: CLERK_ID }] }) // existing profile, no user_id
      .mockResolvedValueOnce({ rows: [] }); // backfill UPDATE

    const profileId = await getOrCreateParentId(CLERK_ID);

    expect(profileId).toBe('profile-1');
    expect(getOrCreateCanonicalUserMock).toHaveBeenCalledWith(CLERK_ID);
    const updateCall = queryMock.mock.calls[1];
    expect(updateCall[0]).toMatch(/UPDATE profiles SET user_id = \$1/);
    expect(updateCall[0]).toMatch(/user_id IS NULL/);
    expect(updateCall[1]).toEqual(['canonical-user-1', 'profile-1']);
  });

  it('does not re-resolve or re-write user_id when it is already set (no unnecessary write on every login)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'profile-1', user_id: 'canonical-user-1', clerk_id: CLERK_ID }] });

    const profileId = await getOrCreateParentId(CLERK_ID);

    expect(profileId).toBe('profile-1');
    expect(getOrCreateCanonicalUserMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
