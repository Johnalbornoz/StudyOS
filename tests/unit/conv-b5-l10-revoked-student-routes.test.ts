/**
 * Convergence (B5 x L10) -- the canonical learning-assessment routes follow the shared foundation's
 * Student authorization contract.
 *
 *   POST /api/assessments/learning/start
 *   PUT  /api/assessments/learning/[sessionId]/answers
 *   POST /api/assessments/learning/[sessionId]/complete
 *
 * They resolve the Student through `requireStudentId` (null => 403) and never through
 * `getOrCreateStudentId`, which throws for an account without an ACTIVE Student role. A refused account
 * reaches no start, draft or completion authority. That `requireStudentId` answers null for a revoked
 * role or a non-ACTIVE account is proven against the real guards in l10-r1-revoked-student-http.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const SESSION = '33333333-3333-4333-8333-333333333333';

const h = vi.hoisted(() => ({
  signedIn: true,
  studentRole: 'ACTIVE' as 'ACTIVE' | 'REVOKED',
  start: null as any,
  saveDraft: null as any,
  complete: null as any,
  supply: null as any,
}));

vi.mock('@/lib/auth', () => ({
  verifyAuth: async () => (h.signedIn ? { userId: 'clerk_kid', role: 'student' } : null),
  requireStudentId: async () => (h.studentRole === 'ACTIVE' ? '11111111-1111-4111-8111-111111111111' : null),
}));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: (fn: () => unknown) => void fn() }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: async () => 'es' }));
vi.mock('@/lib/assessment-execution/assessment-start.service', () => ({
  isSnapshotExecutionEnabled: () => true,
  startLearningAssessment: (...a: any[]) => h.start(...a),
}));
vi.mock('@/lib/assessment-execution/assessment-draft.service', () => ({ saveDraftAnswers: (...a: any[]) => h.saveDraft(...a) }));
vi.mock('@/lib/assessment-execution/assessment-completion.service', () => ({ completeLearningAssessment: (...a: any[]) => h.complete(...a) }));
// the Learning AI Engine: in these route tests nothing is short, so it generates nothing
vi.mock('@/lib/assessment-supply/learning-item-supply.service', () => ({ ensureGeneratedSupply: async () => ({ status: 'SUFFICIENT', generated: 0, rounds: 0, unmetCanonicalConceptIds: [] }) }));
vi.mock('@/lib/assessment-experience/assessment-supply.service', () => ({ requestSupplyForSession: (...a: any[]) => h.supply(...a) }));

import { NextRequest } from 'next/server';
import { POST as startPOST } from '@/app/api/assessments/learning/start/route';
import { PUT as answersPUT } from '@/app/api/assessments/learning/[sessionId]/answers/route';
import { POST as completePOST } from '@/app/api/assessments/learning/[sessionId]/complete/route';

const req = (method: string, body: unknown) => new NextRequest('https://app.test/x', { method, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ sessionId: SESSION }) };
const LAUNCH = { origin: 'TODAY', family: 'LEARNING', intent: 'CONCEPT_PRACTICE', depth: 'DEEP', scope: { canonicalConceptIds: [], learnerConceptIds: ['aaaaaaaa-0000-4000-8000-000000000002'] } };
const ANSWERS = { answers: [{ itemKey: 'q1', answer: '42' }] };

const start = () => (startPOST as any)(req('POST', LAUNCH));
const answers = () => (answersPUT as any)(req('PUT', ANSWERS), ctx);
const complete = () => (completePOST as any)(req('POST', ANSWERS), ctx);

beforeEach(() => {
  h.signedIn = true;
  h.studentRole = 'ACTIVE';
  h.start = vi.fn(async () => ({ ok: true, record: { id: SESSION }, snapshotId: 'snap-1', questions: [], resumed: false, executionAuthority: 'SNAPSHOT' }));
  h.saveDraft = vi.fn(async () => ({ ok: true, saved: 1, cleared: 0 }));
  h.complete = vi.fn(async () => ({ ok: true, state: { kind: 'COMPLETED' } }));
  h.supply = vi.fn(async () => undefined);
});

describe('ACTIVE Student: the three routes behave as before', () => {
  it('start reaches the one start authority as the signed-in Student', async () => {
    const res = await start();
    expect(res.status).toBe(200);
    expect((await res.json()).data.sessionId).toBe(SESSION);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.start.mock.calls[0][0].studentId).toBe(STUDENT);
  });

  it('answers in progress are saved for the signed-in Student', async () => {
    const res = await answers();
    expect(res.status).toBe(200);
    expect(h.saveDraft).toHaveBeenCalledWith({ studentId: STUDENT, sessionId: SESSION, answers: ANSWERS.answers });
  });

  it('completion reaches the one completion authority and never requests supply (OE-014)', async () => {
    const res = await complete();
    expect(res.status).toBe(200);
    expect((await res.json()).data.state).toEqual({ kind: 'COMPLETED' });
    expect(h.complete).toHaveBeenCalledWith({ studentId: STUDENT, sessionId: SESSION, answers: ANSWERS.answers });
    expect(h.supply).not.toHaveBeenCalled();
  });

  it('a governed refusal keeps its own status (not 403)', async () => {
    h.start = vi.fn(async () => ({ ok: false, reason: 'NO_ELIGIBLE_CONTENT' }));
    h.saveDraft = vi.fn(async () => ({ ok: false, reason: 'NOT_FOUND' }));
    h.complete = vi.fn(async () => ({ ok: false, reason: 'GRADING_FAILED' }));
    expect((await start()).status).toBe(409);
    expect((await answers()).status).toBe(404);
    expect((await complete()).status).toBe(502);
  });
});

describe('REVOKED Student role: 403 before any assessment or session logic', () => {
  beforeEach(() => {
    h.studentRole = 'REVOKED';
  });

  it('start => 403, the start authority is not called', async () => {
    const res = await start();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    expect(h.start).not.toHaveBeenCalled();
  });

  it('answers => 403, no draft is saved', async () => {
    const res = await answers();
    expect(res.status).toBe(403);
    expect(h.saveDraft).not.toHaveBeenCalled();
  });

  it('complete => 403, nothing is graded and no supply is requested', async () => {
    const res = await complete();
    expect(res.status).toBe(403);
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.supply).not.toHaveBeenCalled();
  });
});

describe('signed out: 401, unchanged', () => {
  it('none of the three routes resolves a Student', async () => {
    h.signedIn = false;
    expect((await start()).status).toBe(401);
    expect((await answers()).status).toBe(401);
    expect((await complete()).status).toBe(401);
  });
});

describe('source: no route calls the throwing resolver', () => {
  for (const rel of ['src/app/api/assessments/learning/start/route.ts', 'src/app/api/assessments/learning/[sessionId]/answers/route.ts', 'src/app/api/assessments/learning/[sessionId]/complete/route.ts']) {
    it(rel, () => {
      const code = readFileSync(join(process.cwd(), rel), 'utf-8');
      expect(code).not.toContain('getOrCreateStudentId');
      expect(code).toMatch(/const studentId = await requireStudentId\(authContext\.userId\);\s*if \(!studentId\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}, \{ status: 403 \}\);/);
    });
  }
});
