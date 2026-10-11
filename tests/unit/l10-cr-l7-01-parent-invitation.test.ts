/**
 * CR-L7-01 (Orchestrator) -- the Student's parent-invitation path refuses
 *   1. the Student's own email;
 *   2. an email that already has accepted, current access to that Student;
 * and never creates a duplicate relationship or a duplicate active invitation.
 * Plus L10 SF-7 (L4-07): a stale invitation never revives an ended relationship; invitations expire.
 *
 * A small relational fixture stands behind the real service and the real route. The same cases run
 * against a real Postgres in scripts/l10-ephemeral-db-test.sh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { h, w } = vi.hoisted(() => ({
  h: { clerk: 'clerk_student', notify: null as any, audit: null as any },
  w: { invitations: [] as any[], relationships: [] as any[], seq: 0, now: Date.parse('2026-10-11T12:00:00Z') },
}));

const STUDENT = 'stu-1';
const PARENT_PROFILE = 'parent-profile-1';
const DAY = 86_400_000;

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.clerk }), currentUser: async () => null }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_: string, fn: any) => fn }));
vi.mock('@/lib/auth', () => ({ requireStudentId: async () => 'stu-1' }));
vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: (...a: any[]) => h.notify(...a) }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: (...a: any[]) => h.audit(...a) }));
vi.mock('@/services/mastery.service', () => ({ getStudentMastery: vi.fn(async () => []) }));
vi.mock('@/services/learning-debt.service', () => ({ getActiveDebts: vi.fn(async () => []) }));
vi.mock('@/services/assessment.service', () => ({ getUpcomingForStudent: vi.fn(async () => []) }));
vi.mock('@/lib/db', () => {
  const student = { id: 'stu-1', email: 'Kid@School.test', userEmail: 'kid@school.test', name: 'Kid' };
  const parents: Record<string, { email: string; userId: string; parentRole: boolean }> = {
    'parent-profile-1': { email: 'Mum@Home.test', userId: 'user-mum', parentRole: true },
  };
  const norm = (e: string) => e.trim().toLowerCase();
  const query = async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    // --- CR-L7-01 refusals
    if (/FROM students s LEFT JOIN users u ON u\.id = s\.user_id WHERE s\.id = \$1 AND \(lower\(btrim\(s\.email\)\) = \$2 OR lower\(btrim\(u\.email\)\) = \$2\)/.test(s)) {
      return { rows: p[0] === student.id && [norm(student.email), norm(student.userEmail)].includes(p[1]) ? [{ ok: 1 }] : [] };
    }
    if (/FROM parent_student_relationships psr JOIN profiles p ON p\.id = psr\.parent_id JOIN users u ON u\.id = p\.user_id WHERE psr\.student_id = \$1 AND psr\.status = 'accepted' AND lower\(btrim\(u\.email\)\) = \$2/.test(s)) {
      return { rows: w.relationships.some((r) => r.student_id === p[0] && r.status === 'accepted' && norm(parents[r.parent_id]?.email ?? '') === p[1]) ? [{ ok: 1 }] : [] };
    }
    // --- invitations
    if (/^UPDATE parent_invitations SET status = 'expired'.*WHERE student_id = \$1 AND status = 'pending' AND expires_at <= NOW\(\)/.test(s)) {
      for (const i of w.invitations) if (i.student_id === p[0] && i.status === 'pending' && i.expires_at <= w.now) i.status = 'expired';
      return { rows: [] };
    }
    if (/^INSERT INTO parent_invitations/.test(s)) {
      expect(s).toMatch(/ON CONFLICT \(student_id, lower\(invited_email\)\) WHERE status = 'pending' DO NOTHING/);
      if (w.invitations.some((i) => i.student_id === p[0] && norm(i.invited_email) === norm(p[1]) && i.status === 'pending')) return { rows: [] };
      const row = { id: `inv-${++w.seq}`, student_id: p[0], invited_email: p[1], status: 'pending', created_at: w.now, expires_at: w.now + Number(p[2]) * DAY };
      w.invitations.push(row);
      return { rows: [row] };
    }
    if (/^SELECT id, student_id, invited_email, status, created_at, expires_at FROM parent_invitations WHERE student_id = \$1 AND lower\(invited_email\) = \$2 AND status = 'pending'/.test(s)) {
      return { rows: w.invitations.filter((i) => i.student_id === p[0] && norm(i.invited_email) === p[1] && i.status === 'pending') };
    }
    if (/^SELECT id, student_id, invited_email, created_at, \(expires_at <= NOW\(\)\) AS expired FROM parent_invitations WHERE id = \$1 AND status = 'pending' FOR UPDATE/.test(s)) {
      return { rows: w.invitations.filter((i) => i.id === p[0] && i.status === 'pending').map((i) => ({ ...i, expired: i.expires_at <= w.now })) };
    }
    if (/^UPDATE parent_invitations SET status = '(expired|revoked|accepted)', responded_at = NOW\(\) WHERE id = \$1/.test(s)) {
      const i = w.invitations.find((x) => x.id === p[0]);
      if (i) i.status = /status = '(\w+)'/.exec(s)![1];
      return { rows: [] };
    }
    if (/^UPDATE parent_invitations pi SET status = 'revoked'.*FROM profiles p JOIN users u/.test(s)) {
      const email = norm(parents[p[1]]?.email ?? '');
      for (const i of w.invitations) if (i.student_id === p[0] && i.status === 'pending' && norm(i.invited_email) === email) i.status = 'revoked';
      return { rows: [] };
    }
    // --- relationships
    if (/^SELECT status, responded_at, ended_by_user_id FROM parent_student_relationships WHERE parent_id = \$1 AND student_id = \$2 FOR UPDATE/.test(s)) {
      return { rows: w.relationships.filter((r) => r.parent_id === p[0] && r.student_id === p[1]) };
    }
    if (/^INSERT INTO parent_student_relationships \(parent_id, student_id, status\) VALUES \(\$1, \$2, 'accepted'\)/.test(s)) {
      const r = w.relationships.find((x) => x.parent_id === p[0] && x.student_id === p[1]);
      if (r) Object.assign(r, { status: 'accepted', responded_at: w.now });
      else w.relationships.push({ parent_id: p[0], student_id: p[1], status: 'accepted', responded_at: w.now, ended_by_user_id: null });
      return { rows: [] };
    }
    if (/^UPDATE parent_student_relationships SET status = 'revoked', responded_at = NOW\(\) WHERE student_id = \$1 AND parent_id = \$2 AND status = 'accepted'/.test(s)) {
      const r = w.relationships.find((x) => x.student_id === p[0] && x.parent_id === p[1] && x.status === 'accepted');
      if (r) Object.assign(r, { status: 'revoked', responded_at: w.now });
      return { rows: r ? [{ parent_id: p[1] }] : [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE parent_student_relationships SET status = 'revoked', responded_at = NOW\(\), ended_by_user_id = \$3, ended_reason = \$4/.test(s)) {
      const r = w.relationships.find((x) => x.parent_id === p[0] && x.student_id === p[1] && ['accepted', 'pending'].includes(x.status));
      if (r) Object.assign(r, { status: 'revoked', responded_at: w.now, ended_by_user_id: p[2], ended_reason: p[3] });
      return { rows: r ? [{ status: 'revoked' }] : [], rowCount: r ? 1 : 0 };
    }
    // --- notification lookups
    if (/FROM users u JOIN user_roles r ON r\.user_id = u\.id AND r\.role = 'PARENT'/.test(s)) {
      const hit = Object.values(parents).find((x) => norm(x.email) === p[0] && x.parentRole);
      return { rows: hit ? [{ id: hit.userId }] : [] };
    }
    if (/FROM students WHERE id = \$1/.test(s)) return { rows: [{ name: student.name, email: student.email }] };
    if (/^INSERT INTO notifications/.test(s)) return { rows: [] };
    throw new Error(`unexpected SQL in fixture: ${s.slice(0, 140)}`);
  };
  return { db: { query, connect: async () => ({ query, release: () => {} }) } };
});

import { NextRequest } from 'next/server';
import { POST as invitePOST } from '@/app/api/student/parent-invitations/route';
import {
  inviteParentByEmail,
  acceptParentInvitation,
  revokeRelationshipByStudent,
  endParentRelationshipByAdmin,
  normalizeInvitedEmail,
  ParentInvitationRefusedError,
  ParentRelationshipNotFoundError,
  PARENT_INVITATION_TTL_DAYS,
} from '@/services/parent.service';

const post = (email: string) => invitePOST(new NextRequest('https://t.test/api/student/parent-invitations', { method: 'POST', body: JSON.stringify({ email }) }));
const pending = () => w.invitations.filter((i) => i.status === 'pending');

beforeEach(() => {
  w.invitations.length = 0;
  w.relationships.length = 0;
  w.seq = 0;
  w.now = Date.parse('2026-10-11T12:00:00Z');
  h.notify = vi.fn(async () => 'n-1');
  h.audit = vi.fn(async () => undefined);
});

describe('CR-L7-01: own email => refused', () => {
  it('409 OWN_EMAIL, nothing written, nobody notified', async () => {
    const res: any = await post('kid@school.test');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('OWN_EMAIL');
    expect(w.invitations).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('compared in the canonical normalized form: case and surrounding spaces do not get around it', async () => {
    expect(normalizeInvitedEmail('  Kid@School.TEST ')).toBe('kid@school.test');
    await expect(inviteParentByEmail(STUDENT, '  KID@school.TEST ')).rejects.toMatchObject({ code: 'OWN_EMAIL' });
    await expect(inviteParentByEmail(STUDENT, 'Kid@School.test')).rejects.toBeInstanceOf(ParentInvitationRefusedError);
    expect(w.invitations).toEqual([]);
  });
});

describe('CR-L7-01: already-active parent email => refused', () => {
  beforeEach(() => {
    w.relationships.push({ parent_id: PARENT_PROFILE, student_id: STUDENT, status: 'accepted', responded_at: w.now - DAY, ended_by_user_id: null });
  });

  it('409 ALREADY_LINKED, nothing written', async () => {
    const res: any = await post('mum@home.test');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ALREADY_LINKED');
    expect(w.invitations).toEqual([]);
    expect(w.relationships).toHaveLength(1); // no duplicate relationship
  });

  it('a parent whose access was revoked is NOT "already linked": the Student may invite them again', async () => {
    w.relationships[0].status = 'revoked';
    const res: any = await post('mum@home.test');
    expect(res.status).toBe(200);
    expect(pending()).toHaveLength(1);
  });
});

describe('CR-L7-01: existing pending invitation => deterministic, no duplicate', () => {
  it('the same invitation is returned (alreadyPending), one row, one notification', async () => {
    const first: any = await (await post('Mum@Home.test') as any).json();
    const second: any = await (await post('mum@home.TEST') as any).json();
    expect(first.data.alreadyPending).toBe(false);
    expect(second.data.alreadyPending).toBe(true);
    expect(second.data.invitation.id).toBe(first.data.invitation.id);
    expect(w.invitations).toHaveLength(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('the stored address is normalized', async () => {
    await inviteParentByEmail(STUDENT, '  Aunt@Family.TEST ');
    expect(w.invitations[0].invited_email).toBe('aunt@family.test');
    const again = await inviteParentByEmail(STUDENT, 'aunt@family.test');
    expect([again.created, w.invitations.length]).toEqual([false, 1]);
  });
});

describe('CR-L7-01: unrelated valid email => existing flow preserved', () => {
  it('200, a pending invitation with an expiry; the response shape the Student UI already reads', async () => {
    const res: any = await post('aunt@family.test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.invitation).toMatchObject({ studentId: STUDENT, invitedEmail: 'aunt@family.test', status: 'pending' });
    expect(body.data.invitation.created).toBeUndefined(); // internal flag, not part of the invitation
    expect(w.invitations[0].expires_at - w.invitations[0].created_at).toBe(PARENT_INVITATION_TTL_DAYS * DAY);
  });

  it('an invitee with no StudyUs Parent account is not notified, and the response does not say whether one exists', async () => {
    const a: any = await (await post('aunt@family.test') as any).json();
    const b: any = await (await post('mum@home.test') as any).json();
    expect(h.notify).toHaveBeenCalledTimes(1); // only the existing Parent account
    expect(Object.keys(a.data).sort()).toEqual(Object.keys(b.data).sort());
    expect(a.data.alreadyPending).toBe(b.data.alreadyPending);
  });

  it('the invited Parent can accept it: one accepted relationship, the invitation closed', async () => {
    const { id } = await inviteParentByEmail(STUDENT, 'mum@home.test');
    expect(await acceptParentInvitation(id, PARENT_PROFILE, 'Mum@Home.test')).toBe(true);
    expect(w.relationships).toEqual([expect.objectContaining({ parent_id: PARENT_PROFILE, student_id: STUDENT, status: 'accepted' })]);
    expect(w.invitations[0].status).toBe('accepted');
  });
});

describe('SF-7 (L4-07): a stale invitation never re-grants access', () => {
  it('student invites, parent links, student revokes, parent accepts the OLD invitation => refused', async () => {
    const old = await inviteParentByEmail(STUDENT, 'mum@home.test'); // sent first, never answered
    w.now += DAY;
    w.relationships.push({ parent_id: PARENT_PROFILE, student_id: STUDENT, status: 'accepted', responded_at: w.now, ended_by_user_id: null }); // linked by the other direction
    w.now += DAY;
    expect(await revokeRelationshipByStudent(STUDENT, PARENT_PROFILE)).toBe(true);
    expect(w.invitations[0].status).toBe('revoked'); // the revoke cancelled it
    expect(await acceptParentInvitation(old.id, PARENT_PROFILE, 'mum@home.test')).toBe(false);
    expect(w.relationships[0].status).toBe('revoked');
  });

  it('even an invitation left pending is refused when it predates the revocation, and is closed', async () => {
    const old = await inviteParentByEmail(STUDENT, 'mum@home.test');
    w.now += DAY;
    w.relationships.push({ parent_id: PARENT_PROFILE, student_id: STUDENT, status: 'revoked', responded_at: w.now, ended_by_user_id: null });
    expect(await acceptParentInvitation(old.id, PARENT_PROFILE, 'mum@home.test')).toBe(false);
    expect(w.relationships[0].status).toBe('revoked');
    expect(w.invitations[0].status).toBe('revoked');
  });

  it('an invitation the Student sends AFTER the revocation is honoured (new consent)', async () => {
    w.relationships.push({ parent_id: PARENT_PROFILE, student_id: STUDENT, status: 'revoked', responded_at: w.now, ended_by_user_id: null });
    w.now += DAY;
    const fresh = await inviteParentByEmail(STUDENT, 'mum@home.test');
    expect(await acceptParentInvitation(fresh.id, PARENT_PROFILE, 'mum@home.test')).toBe(true);
    expect(w.relationships[0].status).toBe('accepted');
  });

  it('an invitation past its expiry is refused, marked expired, and frees the slot for a new one', async () => {
    const old = await inviteParentByEmail(STUDENT, 'mum@home.test');
    w.now += (PARENT_INVITATION_TTL_DAYS + 1) * DAY;
    expect(await acceptParentInvitation(old.id, PARENT_PROFILE, 'mum@home.test')).toBe(false);
    expect(w.invitations[0].status).toBe('expired');
    expect(w.relationships).toEqual([]);
    const again = await inviteParentByEmail(STUDENT, 'mum@home.test');
    expect([again.created, again.id === old.id]).toEqual([true, false]);
  });

  it('an invitation addressed to another email is never accepted', async () => {
    const inv = await inviteParentByEmail(STUDENT, 'aunt@family.test');
    expect(await acceptParentInvitation(inv.id, PARENT_PROFILE, 'mum@home.test')).toBe(false);
    expect(w.relationships).toEqual([]);
  });
});

describe('SF-7: a platform administrator can end a relationship, audited', () => {
  it('ends it, closes pending invitations to that parent, writes the audit row', async () => {
    w.relationships.push({ parent_id: PARENT_PROFILE, student_id: STUDENT, status: 'accepted', responded_at: w.now, ended_by_user_id: null });
    await endParentRelationshipByAdmin('admin-1', PARENT_PROFILE, STUDENT, 'safeguarding');
    expect(w.relationships[0]).toMatchObject({ status: 'revoked', ended_by_user_id: 'admin-1', ended_reason: 'safeguarding' });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'admin-1', action: 'PARENT_RELATIONSHIP_ENDED', reason: 'safeguarding' }));
  });

  it('a relationship an administrator ended is never revived by an invitation', async () => {
    w.relationships.push({ parent_id: PARENT_PROFILE, student_id: STUDENT, status: 'revoked', responded_at: w.now - DAY, ended_by_user_id: 'admin-1' });
    const inv = await inviteParentByEmail(STUDENT, 'mum@home.test');
    expect(await acceptParentInvitation(inv.id, PARENT_PROFILE, 'mum@home.test')).toBe(false);
    expect(w.relationships[0].status).toBe('revoked');
  });

  it('nothing to end => ParentRelationshipNotFoundError, no audit row', async () => {
    await expect(endParentRelationshipByAdmin('admin-1', PARENT_PROFILE, STUDENT, 'x')).rejects.toBeInstanceOf(ParentRelationshipNotFoundError);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
