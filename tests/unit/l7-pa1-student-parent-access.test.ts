/**
 * L7 PA-1 -- the Student's parent-access controls inside the dashboard.
 *
 * The card adds no route. These tests run the three EXISTING routes it calls
 * (real route handlers, real parent.service, real authorization guard) against
 * an in-memory database, and pin what the card relies on:
 *  - the student is always the session's own identity, never a request field;
 *  - a non-Student account and a foreign relationship / invitation are refused;
 *  - after the student revokes, the parent's read API answers 403 on the next request.
 * Plus the card's own pure helpers, copy completeness and mount point.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const PARENT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARENT_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PARENT_1_USER = 'user-parent-1';

interface Relationship { parent_id: string; parent_user_id: string; student_id: string; status: string; full_name: string }
interface Invitation { id: string; student_id: string; invited_email: string; status: string; created_at: Date }

const state = { relationships: [] as Relationship[], invitations: [] as Invitation[], seq: 0 };
const session = { clerkUserId: null as string | null };
/** clerk id -> student id (null = an account with no ACTIVE STUDENT role). */
const STUDENT_BY_CLERK: Record<string, string | null> = { clerk_a: STUDENT_A, clerk_b: STUDENT_B, clerk_parent_1: null };
const USER_BY_CLERK: Record<string, string> = { clerk_parent_1: PARENT_1_USER, clerk_a: 'user-a', clerk_b: 'user-b' };

function fakeQuery(sql: string, params: any[] = []) {
  const rows = (r: any[]) => ({ rows: r, rowCount: r.length });
  if (/UPDATE parent_student_relationships SET status = 'revoked'[\s\S]*student_id = \$1 AND parent_id = \$2 AND status = 'accepted'/.test(sql)) {
    const hit = state.relationships.filter((r) => r.student_id === params[0] && r.parent_id === params[1] && r.status === 'accepted');
    hit.forEach((r) => (r.status = 'revoked'));
    return rows(hit.map((r) => ({ parent_id: r.parent_id })));
  }
  if (/SELECT 1 FROM parent_student_relationships psr\s+JOIN profiles p/.test(sql)) {
    return rows(state.relationships.filter((r) => r.parent_user_id === params[0] && r.student_id === params[1] && r.status === 'accepted').map(() => ({ ok: 1 })));
  }
  if (/SELECT psr\.parent_id, p\.full_name, u\.email, psr\.responded_at/.test(sql)) {
    return rows(state.relationships.filter((r) => r.student_id === params[0] && r.status === 'accepted').map((r) => ({ parent_id: r.parent_id, full_name: r.full_name, email: null, responded_at: null })));
  }
  if (/INSERT INTO parent_invitations/.test(sql)) {
    const existing = state.invitations.find((i) => i.student_id === params[0] && i.invited_email.toLowerCase() === String(params[1]).toLowerCase() && i.status === 'pending');
    if (existing) return rows([existing]);
    const created: Invitation = { id: `00000000-0000-4000-8000-00000000000${++state.seq}`, student_id: params[0], invited_email: params[1], status: 'pending', created_at: new Date(0) };
    state.invitations.push(created);
    return rows([created]);
  }
  if (/FROM parent_invitations WHERE student_id = \$1 AND status != 'revoked'/.test(sql)) {
    return rows(state.invitations.filter((i) => i.student_id === params[0] && i.status !== 'revoked'));
  }
  if (/UPDATE parent_invitations SET status = 'revoked'[\s\S]*WHERE id = \$1 AND student_id = \$2 AND status = 'pending'/.test(sql)) {
    const hit = state.invitations.filter((i) => i.id === params[0] && i.student_id === params[1] && i.status === 'pending');
    hit.forEach((i) => (i.status = 'revoked'));
    return rows(hit.map((i) => ({ id: i.id })));
  }
  return rows([]);
}

vi.mock('@/lib/db', () => {
  const query = async (sql: string, params?: any[]) => fakeQuery(sql, params);
  return { db: { query }, query };
});
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: session.clerkUserId, sessionClaims: {} }) }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  requireStudentId: async (clerkUserId: string) => STUDENT_BY_CLERK[clerkUserId] ?? null,
}));
vi.mock('@/lib/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/identity')>()),
  getOrCreateCanonicalUser: async (clerkUserId: string) => ({ id: USER_BY_CLERK[clerkUserId] }),
}));

import { GET as getParents } from '@/app/api/student/parents/route';
import { GET as getInvitations, POST as postInvitation, DELETE as deleteInvitation } from '@/app/api/student/parent-invitations/route';
import { POST as postRevoke } from '@/app/api/parent/relationships/revoke/route';
import { GET as getParentOverview } from '@/app/api/parent/learners/[studentId]/overview/route';
import { isActiveParentOf } from '@/lib/authorization';
import { formatSince, looksLikeEmail, openInvitations, PARENT_ACCESS_ROUTES } from '@/app/dashboard/profile/parent-access';
import { PARENT_ACCESS_MESSAGES, getParentAccessMessages } from '@/lib/i18n/parent-access-messages';
import { LOCALES } from '@/lib/i18n/messages';

function req(method: string, body?: unknown) {
  return new Request('http://localhost/api', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as any;
}
const parentOverview = (studentId: string) => getParentOverview(req('GET'), { params: Promise.resolve({ studentId }) });

beforeEach(() => {
  state.seq = 0;
  state.invitations = [];
  state.relationships = [
    { parent_id: PARENT_1, parent_user_id: PARENT_1_USER, student_id: STUDENT_A, status: 'accepted', full_name: 'Paula Madre' },
    { parent_id: PARENT_2, parent_user_id: 'user-parent-2', student_id: STUDENT_B, status: 'accepted', full_name: 'Otro Padre' },
  ];
  session.clerkUserId = 'clerk_a';
});

describe('who-can-see-me -- GET /api/student/parents', () => {
  it('lists only the caller\'s own accepted relationships', async () => {
    const res = await getParents();
    expect(res.status).toBe(200);
    expect((await res.json()).data.parents).toEqual([{ parentId: PARENT_1, name: 'Paula Madre', since: null }]);
  });

  it('401 without a session; 403 for an account that is not a Student', async () => {
    session.clerkUserId = null;
    expect((await getParents()).status).toBe(401);
    session.clerkUserId = 'clerk_parent_1';
    expect((await getParents()).status).toBe(403);
  });
});

describe('invite-a-parent -- /api/student/parent-invitations', () => {
  it('records a pending invitation for the session\'s student, ignoring any studentId in the body', async () => {
    const res = await postInvitation(req('POST', { email: 'mama@example.com', studentId: STUDENT_B }));
    expect(res.status).toBe(200);
    expect(state.invitations).toHaveLength(1);
    expect(state.invitations[0]).toMatchObject({ student_id: STUDENT_A, invited_email: 'mama@example.com', status: 'pending' });

    const list = await (await getInvitations()).json();
    expect(list.data.invitations.map((i: any) => i.invitedEmail)).toEqual(['mama@example.com']);
  });

  it('inviting the same email twice keeps one pending invitation', async () => {
    await postInvitation(req('POST', { email: 'mama@example.com' }));
    await postInvitation(req('POST', { email: 'MAMA@example.com' }));
    expect(state.invitations).toHaveLength(1);
  });

  it('400 for an invalid email; 401 without a session; 403 for a non-Student; nothing is written', async () => {
    expect((await postInvitation(req('POST', { email: 'not-an-email' }))).status).toBe(400);
    session.clerkUserId = null;
    expect((await postInvitation(req('POST', { email: 'mama@example.com' }))).status).toBe(401);
    session.clerkUserId = 'clerk_parent_1';
    expect((await postInvitation(req('POST', { email: 'mama@example.com' }))).status).toBe(403);
    expect((await getInvitations()).status).toBe(403);
    expect(state.invitations).toHaveLength(0);
  });

  it('a student can cancel their own pending invitation, never another student\'s', async () => {
    await postInvitation(req('POST', { email: 'mama@example.com' }));
    const id = state.invitations[0].id;

    session.clerkUserId = 'clerk_b';
    expect((await deleteInvitation(req('DELETE', { invitationId: id }))).status).toBe(404);
    expect(state.invitations[0].status).toBe('pending');

    session.clerkUserId = 'clerk_a';
    expect((await deleteInvitation(req('DELETE', { invitationId: id }))).status).toBe(200);
    expect(state.invitations[0].status).toBe('revoked');
    expect((await (await getInvitations()).json()).data.invitations).toEqual([]);
  });
});

describe('revoke relationship -- POST /api/parent/relationships/revoke', () => {
  it('after the student revokes, the parent read API returns 403 on the next request', async () => {
    expect(await isActiveParentOf(PARENT_1_USER, STUDENT_A)).toBe(true);

    expect((await postRevoke(req('POST', { parentId: PARENT_1 }))).status).toBe(200);
    expect(state.relationships[0].status).toBe('revoked');
    expect((await (await getParents()).json()).data.parents).toEqual([]);

    session.clerkUserId = 'clerk_parent_1';
    expect((await parentOverview(STUDENT_A)).status).toBe(403);
  });

  it('a student cannot revoke a relationship that belongs to another student', async () => {
    const res = await postRevoke(req('POST', { parentId: PARENT_2, studentId: STUDENT_B }));
    expect(res.status).toBe(404);
    expect(state.relationships[1].status).toBe('accepted');
  });

  it('revoking twice is a 404 the second time; 400 for a malformed id; 401 / 403 as the other routes', async () => {
    expect((await postRevoke(req('POST', { parentId: PARENT_1 }))).status).toBe(200);
    expect((await postRevoke(req('POST', { parentId: PARENT_1 }))).status).toBe(404);
    expect((await postRevoke(req('POST', { parentId: 'nope' }))).status).toBe(400);
    session.clerkUserId = null;
    expect((await postRevoke(req('POST', { parentId: PARENT_2 }))).status).toBe(401);
    session.clerkUserId = 'clerk_parent_1';
    expect((await postRevoke(req('POST', { parentId: PARENT_2 }))).status).toBe(403);
    expect(state.relationships[1].status).toBe('accepted');
  });
});

describe('ParentAccessCard helpers', () => {
  it('openInvitations keeps pending and declined, drops accepted and revoked', () => {
    const inv = (status: any) => ({ id: status, invitedEmail: `${status}@example.com`, status });
    expect(openInvitations([inv('pending'), inv('accepted'), inv('declined'), inv('revoked')]).map((i) => i.status)).toEqual(['pending', 'declined']);
  });

  it('looksLikeEmail rejects obvious typos and trims', () => {
    expect(looksLikeEmail('  mama@example.com ')).toBe(true);
    for (const bad of ['', 'mama', 'mama@', 'mama@example', 'ma ma@example.com']) expect(looksLikeEmail(bad)).toBe(false);
  });

  it('formatSince is null-safe and locale-aware', () => {
    expect(formatSince(null, 'es')).toBeNull();
    expect(formatSince('not a date', 'es')).toBeNull();
    expect(formatSince('2026-10-11T12:00:00.000Z', 'en')).toBe('Oct 11, 2026');
  });
});

describe('copy', () => {
  it('every locale has every key, non-empty, with the same placeholders as Spanish', () => {
    const keys = Object.keys(PARENT_ACCESS_MESSAGES.es).sort();
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const locale of LOCALES) {
      const catalog = PARENT_ACCESS_MESSAGES[locale] as Record<string, string>;
      expect(Object.keys(catalog).sort()).toEqual(keys);
      for (const key of keys) {
        expect(catalog[key].trim(), `${locale}:${key}`).not.toBe('');
        expect(placeholders(catalog[key]), `${locale}:${key}`).toEqual(placeholders((PARENT_ACCESS_MESSAGES.es as Record<string, string>)[key]));
      }
    }
  });

  it('falls back to Spanish for an unknown locale', () => {
    expect(getParentAccessMessages('xx')).toBe(PARENT_ACCESS_MESSAGES.es);
    expect(getParentAccessMessages(null)).toBe(PARENT_ACCESS_MESSAGES.es);
    expect(getParentAccessMessages('en')).toBe(PARENT_ACCESS_MESSAGES.en);
  });
});

describe('mount and scope (source guards)', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

  it('the Student profile page mounts the card', () => {
    const page = read('src/app/dashboard/profile/page.tsx');
    expect(page).toMatch(/import ParentAccessCard from '\.\/ParentAccessCard'/);
    expect(page.match(/<ParentAccessCard /g)?.length).toBe(2);
  });

  it('the card talks only to the three existing routes and never sends a student id', () => {
    expect(Object.values(PARENT_ACCESS_ROUTES).sort()).toEqual(['/api/parent/relationships/revoke', '/api/student/parent-invitations', '/api/student/parents']);
    const card = read('src/app/dashboard/profile/ParentAccessCard.tsx');
    expect(card).not.toMatch(/['"`]\/api\//);
    expect(card).not.toMatch(/studentId/);
  });
});
