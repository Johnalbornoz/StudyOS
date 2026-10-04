/**
 * Track B -- route-level security for the new/changed exam routes, plus
 * source guards pinning the Exam Core / Learning Engine boundary:
 *   - the exam core never writes cognition (only updateMastery, per response);
 *   - a result never becomes evidence;
 *   - no route trusts a client-supplied question, answer key, student or
 *     version identity;
 *   - no exam-family branching inside the core (verticals are configuration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));
const isAdminEmailMock = vi.fn();
vi.mock('@/services/admin.service', () => ({ isAdminEmail: (...a: any[]) => isAdminEmailMock(...a) }));
const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock(), checkRateLimit: () => true }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: async () => ({ id: 'actor-1' }) }));
const canAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canAccessLearner: (...a: any[]) => canAccessLearnerMock(...a), isOwner: async () => true }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));

const svc = {
  getNextSimulationItem: vi.fn(),
  submitSimulationItemAnswer: vi.fn(),
  skipUnavailableSimulationItem: vi.fn(),
  saveSimulationItemDraft: vi.fn(),
  endSimulationBreak: vi.fn(),
};
vi.mock('@/lib/simulation/item-resolution.service', () => {
  class E extends Error {}
  return {
    getNextSimulationItem: (...a: any[]) => svc.getNextSimulationItem(...a),
    submitSimulationItemAnswer: (...a: any[]) => svc.submitSimulationItemAnswer(...a),
    skipUnavailableSimulationItem: (...a: any[]) => svc.skipUnavailableSimulationItem(...a),
    saveSimulationItemDraft: (...a: any[]) => svc.saveSimulationItemDraft(...a),
    endSimulationBreak: (...a: any[]) => svc.endSimulationBreak(...a),
    SimulationItemAccessDeniedError: E,
    SimulationItemNotFoundError: E,
    SimulationItemNotActiveError: E,
    SimulationItemNoPendingItemError: E,
    SimulationNavigationError: E,
    SimulationInvalidResponseError: E,
  };
});
const getSimulationAttemptMock = vi.fn();
vi.mock('@/lib/simulation/attempt.service', () => ({ getSimulationAttempt: (...a: any[]) => getSimulationAttemptMock(...a) }));
const getAttemptResultViewMock = vi.fn();
vi.mock('@/lib/exam-core/result-view.service', () => ({ getAttemptResultView: (...a: any[]) => getAttemptResultViewMock(...a) }));
const applyMock = vi.fn();
vi.mock('@/lib/exam-core/apply-vertical-config.service', () => ({ applyExamVerticalConfig: (...a: any[]) => applyMock(...a), VerticalConfigError: class extends Error {} }));
const invalidateMock = vi.fn();
vi.mock('@/lib/exam-core/results.service', () => ({ invalidateAttemptResult: (...a: any[]) => invalidateMock(...a) }));

import { GET as nextItemGET, POST as nextItemPOST } from '@/app/api/simulation/attempts/[id]/next-item/route';
import { GET as resultGET } from '@/app/api/simulation/attempts/[id]/result/route';
import { POST as verticalsPOST, GET as verticalsGET } from '@/app/api/admin/assessment/verticals/route';
import { POST as invalidatePOST } from '@/app/api/admin/assessment/attempt-results/invalidate/route';

const ID = '11111111-1111-4111-8111-111111111111';
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const jsonReq = (body: unknown, url = `http://x/api/simulation/attempts/${ID}/next-item`) => ({ url, json: async () => body }) as any;

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: null });
  canAccessLearnerMock.mockReset().mockResolvedValue(true);
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-1' });
  currentUserMock.mockReset().mockResolvedValue({ emailAddresses: [{ emailAddress: 'student@x.test' }] });
  isAdminEmailMock.mockReset().mockReturnValue(false);
  Object.values(svc).forEach((m) => m.mockReset().mockResolvedValue({ ok: true }));
  getSimulationAttemptMock.mockReset().mockResolvedValue({ id: ID, studentId: 'student-b' });
  getAttemptResultViewMock.mockReset().mockResolvedValue({ result: { id: 'r' }, lifecycle: 'SCORED' });
  applyMock.mockReset();
  invalidateMock.mockReset();
});

describe('next-item: the body is strict -- answer only', () => {
  it.each([
    ['a client-supplied question', { action: 'submit', studentAnswer: 'A', question: { correctAnswer: 'A' } }],
    ['a client-supplied answer key', { action: 'submit', studentAnswer: 'A', correctAnswer: 'A' }],
    ['a spoofed student id', { action: 'submit', studentAnswer: 'A', studentId: ID }],
    ['a spoofed exam version id', { action: 'submit', studentAnswer: 'A', examVersionId: ID }],
    ['an unknown action', { action: 'grade', studentAnswer: 'A' }],
  ])('rejects %s (400) and never reaches the service', async (_name, body) => {
    const res: any = await nextItemPOST(jsonReq(body), params());
    expect(res.status).toBe(400);
    expect(svc.submitSimulationItemAnswer).not.toHaveBeenCalled();
  });

  it('accepts an answer string + item position + idempotency key, and passes ONLY those (plus the resolved actor)', async () => {
    const res: any = await nextItemPOST(jsonReq({ action: 'submit', studentAnswer: 'B', idempotencyKey: 'k', targetIndex: 2 }), params());
    expect(res.status).toBe(200);
    expect(svc.submitSimulationItemAnswer).toHaveBeenCalledWith('actor-1', ID, 'B', 'k', 2);
  });

  it('autosave requires a position and never grades', async () => {
    expect((await nextItemPOST(jsonReq({ action: 'autosave', studentAnswer: 'B' }), params())).status).toBe(400);
    await nextItemPOST(jsonReq({ action: 'autosave', studentAnswer: 'B', targetIndex: 0 }), params());
    expect(svc.saveSimulationItemDraft).toHaveBeenCalledWith('actor-1', ID, 0, 'B');
    expect(svc.submitSimulationItemAnswer).not.toHaveBeenCalled();
  });

  it('GET validates the requested position and requires a session', async () => {
    expect((await nextItemGET(jsonReq(null, `http://x/a?index=abc`), params())).status).toBe(400);
    expect((await nextItemGET(jsonReq(null, `http://x/a?index=-1`), params())).status).toBe(400);
    await nextItemGET(jsonReq(null, `http://x/a?index=3`), params());
    expect(svc.getNextSimulationItem).toHaveBeenCalledWith('actor-1', ID, 3);
    verifyAuthMock.mockResolvedValue(null);
    expect((await nextItemGET(jsonReq(null, 'http://x/a'), params())).status).toBe(401);
    expect((await nextItemPOST(jsonReq({ action: 'submit', studentAnswer: 'A' }), params())).status).toBe(401);
  });
});

describe('result route: authorized against the attempt\'s own student', () => {
  it('a non-reader (another student) gets 404 -- existence is never confirmed', async () => {
    canAccessLearnerMock.mockResolvedValue(false);
    const res: any = await resultGET(jsonReq(null), params());
    expect(res.status).toBe(404);
    expect(canAccessLearnerMock).toHaveBeenCalledWith('actor-1', 'student-b', 'LEARNER_PROGRESS_VIEW');
    expect(getAttemptResultViewMock).not.toHaveBeenCalled();
  });
  it('unknown / malformed ids are 404; no session is 401; no result yet is 409', async () => {
    getSimulationAttemptMock.mockResolvedValue(null);
    expect((await resultGET(jsonReq(null), params())).status).toBe(404);
    expect((await resultGET(jsonReq(null), params('../../etc'))).status).toBe(404);
    getSimulationAttemptMock.mockResolvedValue({ id: ID, studentId: 'student-b' });
    getAttemptResultViewMock.mockResolvedValue({ result: null, lifecycle: 'IN_PROGRESS' });
    expect((await resultGET(jsonReq(null), params())).status).toBe(409);
    verifyAuthMock.mockResolvedValue(null);
    expect((await resultGET(jsonReq(null), params())).status).toBe(401);
  });
});

describe('admin exam routes: StudyUs admin only', () => {
  it('a non-admin can neither list/apply vertical configurations nor invalidate a result', async () => {
    expect((await (verticalsGET as any)()).status).toBe(403);
    expect((await verticalsPOST(jsonReq({ key: 'dev-cert.paa', write: true }))).status).toBe(403);
    expect((await invalidatePOST(jsonReq({ examAttemptId: ID, reason: 'cheating' }))).status).toBe(403);
    expect(applyMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
    authMock.mockResolvedValue({ userId: null });
    expect((await verticalsPOST(jsonReq({ key: 'dev-cert.paa' }))).status).toBe(401);
  });
  it('an admin applies as a DRY RUN unless write=true is explicit', async () => {
    isAdminEmailMock.mockReturnValue(true);
    applyMock.mockResolvedValue({ noop: false });
    await verticalsPOST(jsonReq({ key: 'dev-cert.paa' }));
    expect(applyMock.mock.calls[0][1]).toEqual({ write: false });
  });
});

// ---------------- source guards ----------------
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const root = process.cwd();
/** Source without comments: guards are about code, not about prose explaining the rule. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p: string) => strip(readFileSync(join(root, p), 'utf-8'));
const examCoreFiles = walk(join(root, 'src/lib/exam-core')).filter((f) => f.endsWith('.ts'));
const COGNITIVE_TABLES = ['learning_evidence', 'mastery_records', 'concept_knowledge_state', 'concept_memory_state', 'concept_transfer_state', 'misconception', 'validation_cycles', 'student_skill', 'student_competency'];

describe('source guards: the Exam Core never decides cognition', () => {
  it('no exam-core module writes any cognitive table or calls updateMastery', () => {
    for (const f of examCoreFiles) {
      const src = strip(readFileSync(f, 'utf-8'));
      expect(src, f).not.toMatch(/updateMastery/);
      for (const t of COGNITIVE_TABLES) expect(src, `${f} -> ${t}`).not.toMatch(new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+(public\\.)?${t}`, 'i'));
    }
  });
  it('the result path never writes evidence: scoring/results/result-view/complete route have no evidence writer', () => {
    for (const p of ['src/lib/exam-core/results.service.ts', 'src/lib/exam-core/result-view.service.ts', 'src/app/api/simulation/attempts/[id]/complete/route.ts', 'src/app/api/simulation/attempts/[id]/result/route.ts']) {
      expect(read(p), p).not.toMatch(/updateMastery|record-evidence|INSERT INTO learning_evidence/);
    }
  });
  it('evidence is written per response only for a VALID, non-review answer to a server-held item, as non-assisted EXAM_SIMULATION', () => {
    const scoring = read('src/lib/simulation/scoring.service.ts');
    expect(scoring).toMatch(/if \(grade\.status === 'ANSWERED' && grade\.reviewStatus === 'NONE' && params\.learningObjectiveId\)/);
    expect(scoring).toMatch(/sourceType: 'EXAM_SIMULATION'/);
    expect(scoring).toMatch(/aiAssistanceType: 'NONE'/);
    expect(scoring).toMatch(/operationType: 'EXAM_SIMULATION_RESPONSE'/);
  });
  it('no exam-family branching inside the core (verticals are configuration)', () => {
    for (const f of examCoreFiles.filter((p) => !/taxonomy\.ts$|\/verticals\//.test(p))) {
      expect(readFileSync(f, 'utf-8'), f).not.toMatch(/===\s*'(PAA|PISA|IB|CAMBRIDGE|AICE|ICFES)'/);
      expect(readFileSync(f, 'utf-8'), f).not.toMatch(/case\s+'(PAA|PISA|IB|CAMBRIDGE|AICE|ICFES)'/);
    }
  });
  it('the exam runner sends answers only -- never a question, an answer key, a student or a version id', () => {
    const runner = read('src/app/dashboard/exam-prep/attempt/[attemptId]/ItemRunner.tsx');
    const bodies = [...runner.matchAll(/body: JSON\.stringify\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(bodies.length).toBeGreaterThan(2);
    for (const b of bodies) expect(b).not.toMatch(/question|correctAnswer|studentId|examVersionId|explanation/);
  });
  it('item delivery returns only the sanitized client item and checks it for leaks at runtime', () => {
    const svcSrc = read('src/lib/simulation/item-resolution.service.ts');
    expect(svcSrc).toMatch(/question: guardNoLeak\(toExamClientItem\(state\.item!, index\)\)/);
    // the only place the raw server item travels is into the grader
    expect([...svcSrc.matchAll(/question: state\.item\b/g)]).toHaveLength(1);
    expect(svcSrc).toMatch(/recordSimulationItemResponse\(\{[\s\S]{0,400}question: state\.item,/);
  });
  it('attempt API responses never include the server-held navigation state', () => {
    for (const p of ['src/app/api/simulation/attempts/[id]/route.ts', 'src/app/api/simulation/attempts/[id]/pause/route.ts', 'src/app/api/simulation/attempts/[id]/resume/route.ts', 'src/app/api/simulation/attempts/[id]/abandon/route.ts']) {
      expect(read(p), p).toMatch(/navigationState: _hidden/);
    }
  });
});
