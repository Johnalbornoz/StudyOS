/**
 * Onboarding/authorization rework (2026-09-21) -- the parent's own
 * accept/decline side of the student-initiated invitation flow.
 * Negative-authorization focus: a caller can never accept an
 * invitation addressed to a different email, and accepting never
 * grants access to anyone but the invited email's own real caller.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
const dbConnectMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: (...a: any[]) => dbConnectMock(...a) } }));

import { acceptParentInvitation, declineParentInvitation } from '@/services/parent.service';

function makeClient(rowsSequence: any[]) {
  let i = 0;
  return {
    query: vi.fn(async (..._args: any[]) => rowsSequence[i++] ?? { rows: [] }),
    release: vi.fn(),
  };
}

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [{ name: 'Kid', email: 'kid@test.com' }] });
  dbConnectMock.mockReset();
});

describe('acceptParentInvitation -- fails closed unless the invitation truly belongs to the caller\'s verified email', () => {
  it('accepts and creates the REAL parent_student_relationships row when the invitation matches the verified email', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: 'inv-1', student_id: 'student-1', invited_email: 'parent@test.com' }] }, // SELECT ... FOR UPDATE
      { rows: [] }, // INSERT relationship
      { rows: [] }, // UPDATE invitation
      { rows: [] }, // COMMIT
    ]);
    dbConnectMock.mockResolvedValue(client);

    const ok = await acceptParentInvitation('inv-1', 'parent-profile-1', 'PARENT@test.com'); // case-insensitive match
    expect(ok).toBe(true);
    const relationshipInsert = client.query.mock.calls[2][0];
    expect(relationshipInsert).toMatch(/INSERT INTO parent_student_relationships/);
    expect(relationshipInsert).toMatch(/'accepted'/);
  });

  it('DENIES and writes nothing when the invitation is addressed to a DIFFERENT email than the caller\'s verified one', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: 'inv-1', student_id: 'student-1', invited_email: 'real-parent@test.com' }] },
      { rows: [] }, // ROLLBACK
    ]);
    dbConnectMock.mockResolvedValue(client);

    const ok = await acceptParentInvitation('inv-1', 'attacker-profile-1', 'attacker@test.com');
    expect(ok).toBe(false);
    // Only BEGIN, the SELECT, and ROLLBACK -- never an INSERT into parent_student_relationships.
    expect(client.query).toHaveBeenCalledTimes(3);
    for (const call of client.query.mock.calls) {
      expect(String(call[0])).not.toMatch(/INSERT INTO parent_student_relationships/);
    }
  });

  it('DENIES when the invitation is not (or no longer) pending', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT ... WHERE status = 'pending' -- no match (already accepted/declined/revoked)
      { rows: [] }, // ROLLBACK
    ]);
    dbConnectMock.mockResolvedValue(client);

    const ok = await acceptParentInvitation('inv-1', 'parent-profile-1', 'parent@test.com');
    expect(ok).toBe(false);
  });
});

describe('declineParentInvitation -- never creates a relationship', () => {
  it('declines only when the email matches, and never touches parent_student_relationships', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'inv-1' }], rowCount: 1 });
    const ok = await declineParentInvitation('inv-1', 'parent@test.com');
    expect(ok).toBe(true);
    expect(dbQueryMock.mock.calls[0][0]).not.toMatch(/parent_student_relationships/);
  });

  it('returns false for a non-matching email or non-pending invitation', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const ok = await declineParentInvitation('inv-1', 'wrong@test.com');
    expect(ok).toBe(false);
  });
});
