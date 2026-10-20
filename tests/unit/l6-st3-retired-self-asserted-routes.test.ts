/**
 * L6 ST-3 -- the two self-asserted mastery routes are retired.
 *
 *   POST /api/learning/record-evidence          (client-asserted result / sourceType / weight)
 *   POST /api/learning-debt/check-and-resolve   (client-asserted mastery / retention / risk)
 *
 * The owner could change their own learner state by asserting the numbers.
 * Both now answer 404 to the owner and never reach the mastery writer or the
 * debt resolver. A caller who is not the Student still gets 401 / 403 first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

const OWNER = { clerk: 'clerk_owner', student: '11111111-1111-4111-8111-111111111111' };
const OTHER = { clerk: 'clerk_other', student: '22222222-2222-4222-8222-222222222222' };
const CONCEPT = 'aaaaaaaa-0000-4000-8000-000000000002';
const SUBJECT = 'aaaaaaaa-0000-4000-8000-000000000001';

const h = vi.hoisted(() => ({
  clerk: null as string | null,
  role: undefined as string | undefined,
  sql: [] as string[],
  updateMastery: null as any,
  checkAndResolveDebt: null as any,
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: h.clerk, sessionClaims: h.role ? { role: h.role } : {} }),
}));
vi.mock('@/lib/db', () => {
  const students: Record<string, string> = { clerk_owner: '11111111-1111-4111-8111-111111111111', clerk_other: '22222222-2222-4222-8222-222222222222' };
  const q = async (sql: string, p: any[] = []) => {
    h.sql.push(sql);
    // the ownership guard's read: the L6 form, and the shared foundation's form (joined to users, ACTIVE Student role)
    if (/FROM students(?: s)?[\s\S]*WHERE (?:u\.)?clerk_id = \$1 AND (?:s\.)?id = \$2/.test(sql)) {
      const ok = students[p[0]] === p[1];
      return { rows: ok ? [{ ok: 1 }] : [], rowCount: ok ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { db: { query: q }, query: q };
});
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => h.updateMastery(...a) }));
vi.mock('@/services/learning-debt.service', () => ({ checkAndResolveDebt: (...a: any[]) => h.checkAndResolveDebt(...a) }));

import { POST as recordEvidence } from '@/app/api/learning/record-evidence/route';
import { POST as checkAndResolve } from '@/app/api/learning-debt/check-and-resolve/route';

const post = (body: unknown) => new NextRequest('https://dev.test/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

const evidence = (studentId: string, over: Record<string, unknown> = {}) => ({
  studentId, conceptId: CONCEPT, subjectId: SUBJECT, result: 'correct', difficulty: 5,
  sourceType: 'ANYTHING_I_LIKE', confidenceWeight: 1, idempotencyKey: `l6-st3-${Math.random()}`, ...over,
});
const debtCheck = (studentId: string) => ({ studentId, conceptId: CONCEPT, currentMastery: 100, daysSinceLastSuccess: 0, forgettingRisk: 0 });

const isWrite = (sql: string) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql);

beforeEach(() => {
  h.clerk = OWNER.clerk;
  h.role = undefined;
  h.sql = [];
  h.updateMastery = vi.fn(async () => ({ oldMastery: 0, newMastery: 100, delta: 100, confidenceScore: 1, learningDebtCreated: false }));
  h.checkAndResolveDebt = vi.fn(async () => ({ id: 'debt', status: 'RESOLVED' }));
});

describe('POST /api/learning/record-evidence', () => {
  it('the owner asserting "correct" with an arbitrary sourceType changes nothing: 404, mastery writer not called, no write issued', async () => {
    const res = await recordEvidence(post(evidence(OWNER.student)));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('ENDPOINT_RETIRED');
    expect(h.updateMastery).not.toHaveBeenCalled();
    expect(h.sql.filter(isWrite)).toEqual([]);
  });

  it('a sourceType from the old documented set is refused the same way', async () => {
    for (const sourceType of ['PRACTICE_QUIZ', 'PRACTICE_QUESTION', 'TOPIC_ASSESSMENT']) {
      expect((await recordEvidence(post(evidence(OWNER.student, { sourceType })))).status).toBe(404);
    }
    expect(h.updateMastery).not.toHaveBeenCalled();
  });

  it('negative authorization is unchanged: no session 401, another Student 403, a teacher / parent / admin session role 403', async () => {
    h.clerk = null;
    expect((await recordEvidence(post(evidence(OWNER.student)))).status).toBe(401);
    h.clerk = OTHER.clerk;
    expect((await recordEvidence(post(evidence(OWNER.student)))).status).toBe(403);
    // a session-claim role grants nothing: only the owning Student gets past the guard
    for (const role of ['teacher', 'parent', 'admin']) {
      h.role = role;
      expect((await recordEvidence(post(evidence(OWNER.student)))).status, role).toBe(403);
    }
    expect(h.updateMastery).not.toHaveBeenCalled();
  });

  it('a malformed body is 400, never 500', async () => {
    expect((await recordEvidence(post('not json'))).status).toBe(400);
    expect((await recordEvidence(post({ studentId: 'not-a-uuid' }))).status).toBe(400);
  });
});

describe('POST /api/learning-debt/check-and-resolve', () => {
  it('the owner asserting mastery 100 / risk 0 resolves nothing: 404, resolver not called, no write issued', async () => {
    const res = await checkAndResolve(post(debtCheck(OWNER.student)));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('ENDPOINT_RETIRED');
    expect(h.checkAndResolveDebt).not.toHaveBeenCalled();
    expect(h.sql.filter(isWrite)).toEqual([]);
  });

  it('negative authorization is unchanged: no session 401, another Student 403, a teacher / parent / admin session role 403', async () => {
    h.clerk = null;
    expect((await checkAndResolve(post(debtCheck(OWNER.student)))).status).toBe(401);
    h.clerk = OTHER.clerk;
    expect((await checkAndResolve(post(debtCheck(OWNER.student)))).status).toBe(403);
    for (const role of ['teacher', 'parent', 'admin']) {
      h.role = role;
      expect((await checkAndResolve(post(debtCheck(OWNER.student)))).status, role).toBe(403);
    }
    expect(h.checkAndResolveDebt).not.toHaveBeenCalled();
  });

  it('a malformed body is 400, never 500', async () => {
    expect((await checkAndResolve(post('not json'))).status).toBe(400);
    expect((await checkAndResolve(post({ conceptId: CONCEPT }))).status).toBe(400);
  });
});

describe('source guards', () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('neither retired route imports a learner-state writer', () => {
    for (const f of ['src/app/api/learning/record-evidence/route.ts', 'src/app/api/learning-debt/check-and-resolve/route.ts']) {
      const code = stripComments(read(f));
      expect(code, f).not.toMatch(/@\/services\/|updateMastery|checkAndResolveDebt|@\/lib\/db/);
      expect(code, f).toMatch(/verifyStudentAccess\(authContext\.userId/);
    }
  });

  it('no client code calls either route', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/[\\/]api[\\/]/.test(p)) {
          if (/api\/learning\/record-evidence|api\/learning-debt\/check-and-resolve/.test(stripComments(readFileSync(p, 'utf-8')))) hits.push(p);
        }
      }
    };
    walk(join(process.cwd(), 'src/app'));
    walk(join(process.cwd(), 'src/components'));
    expect(hits).toEqual([]);
  });
});
