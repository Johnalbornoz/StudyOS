/**
 * L11 / EN-2 -- unlicensed ("demo") mode is one written definition
 * (src/lib/entitlements/unlicensed-policy.ts, ruling D-8) enforced at one
 * shared point (src/lib/entitlements/learning-gate.ts).
 *
 *  - every PAID route enforces; FREE_IN_DEMO and CONTINUATION routes do not;
 *  - no route enforces without being listed;
 *  - the six routes gated by L11 refuse an unlicensed Student with
 *    403 ENTITLEMENT_REQUIRED before any generation, grading or write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { LEARNING_ROUTE_POLICY, rulesFor } from '@/lib/entitlements/unlicensed-policy';

const API = join(process.cwd(), 'src/app/api');
const ENFORCES = /LEARNING_FULL_ACCESS|learningLicenceRequired\w*\(|entitled:\s*true/;
const source = (route: string) => readFileSync(join(API, route, 'route.ts'), 'utf-8');

function allRoutes(dir = API, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) allRoutes(full, out);
    else if (name === 'route.ts') out.push(dir.slice(API.length + 1));
  }
  return out;
}

describe('the written definition (D-8) and the routes agree', () => {
  it('every listed route exists and is listed once', () => {
    const seen = new Set<string>();
    for (const p of LEARNING_ROUTE_POLICY) {
      expect(existsSync(join(API, p.route, 'route.ts')), p.route).toBe(true);
      expect(seen.has(p.route), `${p.route} listed twice`).toBe(false);
      seen.add(p.route);
    }
  });

  it('every PAID route enforces the learning licence', () => {
    for (const p of rulesFor('PAID')) expect(source(p.route), `${p.route} must enforce`).toMatch(ENFORCES);
  });

  it('every PAID_UNLESS_OPEN_ATTEMPT route enforces through the open-attempt form of the shared gate (D-8c)', () => {
    expect(rulesFor('PAID_UNLESS_OPEN_ATTEMPT').map((p) => p.route).sort()).toEqual(['cognitive/explain/submit', 'cognitive/transfer/submit', 'student/teacher-interventions/[id]/start']);
    for (const p of rulesFor('PAID_UNLESS_OPEN_ATTEMPT')) expect(source(p.route), `${p.route} must enforce unless an open attempt`).toMatch(/learningLicenceRequiredUnlessOpenAttempt(ForActor)?\(/);
  });

  it('D-8(c) never reaches a route that STARTS something: every start / generate route is still plainly PAID', () => {
    const paid = rulesFor('PAID').map((p) => p.route);
    for (const route of ['simulation/attempts', 'exams/instances', 'exams/instances/[id]/start', 'exams/instances/[id]/retake', 'quizzes/generate', 'quizzes/generate-and-take', 'learning/session/start', 'cognitive/explain/generate', 'cognitive/transfer/generate', 'cognitive/remediation/start', 'study-plan/generate', 'tutor/conversations', 'tutor/message', 'quizzes/hint']) {
      expect(paid, route).toContain(route);
      expect(source(route), route).not.toMatch(/UnlessOpenAttempt/);
    }
  });

  it('FREE_IN_DEMO (content setup) and CONTINUATION routes carry no licence check', () => {
    for (const p of [...rulesFor('FREE_IN_DEMO'), ...rulesFor('CONTINUATION')]) expect(source(p.route), `${p.route} must not enforce`).not.toMatch(ENFORCES);
  });

  it('no route enforces the licence without being in the definition', () => {
    const listed = new Set(LEARNING_ROUTE_POLICY.filter((p) => p.rule === 'PAID' || p.rule === 'PAID_UNLESS_OPEN_ATTEMPT' || p.rule === 'REPORTS_ONLY').map((p) => p.route));
    const unlisted = allRoutes().filter((route) => ENFORCES.test(source(route)) && !listed.has(route));
    expect(unlisted).toEqual([]);
  });

  it('D-8(b): the six content-setup routes are exactly the FREE_IN_DEMO set', () => {
    expect(rulesFor('FREE_IN_DEMO').map((p) => p.route).sort()).toEqual(
      ['concepts/suggest', 'content/extract-concepts', 'content/import/analyze', 'content/process', 'content/search', 'content/upload'].sort()
    );
  });

  it('the six L4-10 instructional routes go through the shared gate, after ownership and before any work', () => {
    const order: Array<[string, RegExp, RegExp]> = [
      ['learning/guided-practice', /verifyStudentAccess\(/, /generateGuidedPractice\(/],
      ['concepts/[id]/explanation', /verifyStudentAccess\(/, /getConceptExplanation\(/],
      ['concepts/[id]/interactive-formula', /verifyStudentAccess\(/, /getInteractiveFormula\(/],
      ['learning-debt/error-guidance', /verifyStudentAccess\(/, /getErrorPatternGuidance\(/],
      ['cognitive/transfer/submit', /verifyStudentAccess\(/, /evaluateTransferResponse\(/],
      ['student/teacher-interventions/[id]/start', /getOrCreateCanonicalUser\(/, /startTeacherInterventionExecution\(/],
    ];
    for (const [route, before, after] of order) {
      // Function bodies only: skip the import block.
      const src = source(route);
      const body = src.slice(src.indexOf('async function handle'));
      const gate = body.search(/learningLicenceRequired\w*\(/);
      expect(gate, `${route} calls the shared gate`).toBeGreaterThan(-1);
      expect(body.search(before), `${route}: identity / ownership first`).toBeLessThan(gate);
      expect(gate, `${route}: gate before the work`).toBeLessThan(body.search(after));
    }
  });
});

// ---------------------------------------------------------------------------
// Behaviour: an unlicensed Student on each of the six routes.
// ---------------------------------------------------------------------------

const STUDENT = '11111111-1111-4111-8111-111111111111';
const CONCEPT = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '33333333-3333-4333-8333-333333333333';

vi.mock('@/lib/auth', () => ({
  verifyAuth: vi.fn().mockResolvedValue({ userId: 'clerk-1', email: 's@test.com', role: 'student' }),
  verifyStudentAccess: vi.fn().mockResolvedValue(true),
  verifyRemediationStepAccess: vi.fn().mockResolvedValue(true),
  checkRateLimit: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn().mockResolvedValue({ id: 'actor-1' }) }));
vi.mock('@/lib/authorization', () => ({ isOwner: vi.fn().mockResolvedValue(true) }));
const dbQuery = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQuery(...a) }, query: (...a: any[]) => dbQuery(...a) }));

const canUseCapabilityMock = vi.fn();
vi.mock('@/lib/entitlements', () => ({ canUseCapability: (...a: any[]) => canUseCapabilityMock(...a) }));

const work = {
  guided: vi.fn(),
  explanation: vi.fn(),
  formula: vi.fn(),
  guidance: vi.fn(),
  grade: vi.fn(),
  start: vi.fn(),
  assistanceLock: vi.fn(),
};
vi.mock('@/lib/ai/instructional-assistance-guard', () => ({ instructionalAssistanceLockedResponse: (...a: any[]) => work.assistanceLock(...a) }));
vi.mock('@/services/teaching-content.service', () => ({ generateGuidedPractice: (...a: any[]) => work.guided(...a) }));
vi.mock('@/services/concept-explanation.service', () => ({
  getConceptExplanation: (...a: any[]) => work.explanation(...a),
  getInteractiveFormula: (...a: any[]) => work.formula(...a),
}));
vi.mock('@/services/error-intelligence.service', () => ({ getErrorPatternGuidance: (...a: any[]) => work.guidance(...a) }));
vi.mock('@/services/transfer.service', () => ({ evaluateTransferResponse: (...a: any[]) => work.grade(...a) }));
const loadTransferTaskInstanceMock = vi.fn();
vi.mock('@/services/transfer-task-instance.service', () => ({
  loadTransferTaskInstance: (...a: any[]) => loadTransferTaskInstanceMock(...a),
  // L10 (CR-L11-06) wraps grading in an exclusive, exactly-once claim. The task here is open and
  // unclaimed, so the claim runs the grading step. (Exactly-once itself: l10-r1-l11-dependencies.)
  runTransferSubmissionExclusively: async (_taskId: string, _conceptId: string, gradeAndRecord: () => Promise<unknown>) => ({ outcome: 'COMPLETED', value: await gradeAndRecord() }),
}));
// "The learner behind this account" is resolved by the shared guard (`ownStudentId`). It is mocked at
// its contract, not through the SQL behind it: L10 SF-1/SF-2 changed that SQL and made it answer
// null for a revoked STUDENT role or a non-ACTIVE account.
const ownStudentIdMock = vi.fn();
vi.mock('@/lib/exam-core/route-auth', () => ({ ownStudentId: (...a: any[]) => ownStudentIdMock(...a) }));
const hasStartedExecutionMock = vi.fn();
vi.mock('@/lib/entitlements/open-attempt', () => ({ hasStartedTeacherInterventionExecution: (...a: any[]) => hasStartedExecutionMock(...a) }));
vi.mock('@/lib/student/teacher-intervention-execution.service', () => ({
  startTeacherInterventionExecution: (...a: any[]) => work.start(...a),
  StudentInterventionAccessDeniedError: class extends Error {},
  StudentInterventionNotFoundError: class extends Error {},
  StudentInterventionNotStartableError: class extends Error {},
  StudentInterventionGenerationFailedError: class extends Error {},
}));

import { POST as guidedPOST } from '@/app/api/learning/guided-practice/route';
import { GET as explanationGET } from '@/app/api/concepts/[id]/explanation/route';
import { GET as formulaGET } from '@/app/api/concepts/[id]/interactive-formula/route';
import { GET as guidanceGET } from '@/app/api/learning-debt/error-guidance/route';
import { POST as transferSubmitPOST } from '@/app/api/cognitive/transfer/submit/route';
import { POST as interventionStartPOST } from '@/app/api/student/teacher-interventions/[id]/start/route';
import { learningLicenceRequiredResponse, learningLicenceRequiredResponseForActor } from '@/lib/entitlements/learning-gate';
import { getOrCreateCanonicalUser } from '@/lib/identity';

const json = (body: unknown) => ({ json: async () => body, url: 'https://studyus.test/x', headers: new Headers() }) as any;
const url = (qs: string) => ({ url: `https://studyus.test/x?${qs}`, headers: new Headers() }) as any;
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const calls: Array<[string, () => Promise<Response>]> = [
  ['POST /api/learning/guided-practice', () => guidedPOST(json({ studentId: STUDENT, conceptId: CONCEPT, mode: 'topic_practice', questionText: 'What is 2 + 2?' }))],
  ['GET /api/concepts/[id]/explanation', () => explanationGET(url(`studentId=${STUDENT}`), idParams(CONCEPT))],
  ['GET /api/concepts/[id]/interactive-formula', () => formulaGET(url(`studentId=${STUDENT}`), idParams(CONCEPT))],
  ['GET /api/learning-debt/error-guidance', () => guidanceGET(url(`studentId=${STUDENT}&subjectId=${SUBJECT}&errorType=CONCEPTUAL`))],
  [
    'POST /api/cognitive/transfer/submit',
    () => transferSubmitPOST(json({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, conceptLabel: 'Fractions', prompt: 'A recipe serves four…', studentResponse: 'I would halve it', distance: 'NEAR', language: 'en', transferTaskId: '55555555-5555-4555-8555-555555555555' })),
  ],
  ['POST /api/student/teacher-interventions/[id]/start', () => interventionStartPOST(json({ idempotencyKey: 'k-1' }), idParams('44444444-4444-4444-8444-444444444444'))],
];

beforeEach(() => {
  for (const fn of Object.values(work)) fn.mockReset();
  work.assistanceLock.mockResolvedValue(null);
  dbQuery.mockReset().mockResolvedValue({ rows: [{ id: STUDENT }] });
  canUseCapabilityMock.mockReset().mockResolvedValue(false);
  loadTransferTaskInstanceMock.mockReset().mockResolvedValue(null);
  ownStudentIdMock.mockReset().mockResolvedValue(STUDENT);
  hasStartedExecutionMock.mockReset().mockResolvedValue(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('an unlicensed Student is refused on every D-8(a) route gated by L11', () => {
  it.each(calls)('%s -> 403 ENTITLEMENT_REQUIRED, and no generation, grading or dispatch runs', async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'ENTITLEMENT_REQUIRED' });
    expect(canUseCapabilityMock).toHaveBeenCalledWith('actor-1', STUDENT, 'LEARNING_FULL_ACCESS');
    for (const name of ['guided', 'explanation', 'formula', 'guidance', 'grade', 'start'] as const) expect(work[name], name).not.toHaveBeenCalled();
  });
});

describe('a licensed Student passes the gate', () => {
  it.each(calls)('%s is not refused for entitlement', async (_name, call) => {
    canUseCapabilityMock.mockResolvedValue(true);
    const res = await call().catch(() => null);
    // Past the gate each route runs its own (mocked) work; only the entitlement refusal is asserted here.
    if (res) expect((await res.json().catch(() => ({}))).error).not.toBe('ENTITLEMENT_REQUIRED');
  });

  it('the teacher-assigned start reaches the dispatcher', async () => {
    canUseCapabilityMock.mockResolvedValue(true);
    work.start.mockResolvedValue({ outcome: 'STARTED' });
    const res = await calls[5][1]();
    expect(res.status).toBe(200);
    expect(work.start).toHaveBeenCalledWith('actor-1', '44444444-4444-4444-8444-444444444444', 'k-1');
  });
});

describe('the teacher-assigned start can never skip the licence check', () => {
  it('an actor with no Student account is refused before the dispatcher, licensed or not', async () => {
    canUseCapabilityMock.mockResolvedValue(true);
    ownStudentIdMock.mockResolvedValue(null);
    const res = await calls[5][1]();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    expect(work.start).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Canonical ordering with the shared guards (L10): authorization first, then entitlement.
// ---------------------------------------------------------------------------

describe('ordering: an invalid / revoked identity fails AUTHORIZATION, before entitlement is ever asked', () => {
  it.each(calls.slice(0, 5))('%s: the shared Student guard denies -> 403 FORBIDDEN, not ENTITLEMENT_REQUIRED', async (_name, call) => {
    const { verifyStudentAccess } = await import('@/lib/auth');
    vi.mocked(verifyStudentAccess).mockResolvedValueOnce(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    expect(canUseCapabilityMock).not.toHaveBeenCalled();
    for (const name of ['guided', 'explanation', 'formula', 'guidance', 'grade'] as const) expect(work[name], name).not.toHaveBeenCalled();
  });

  it('teacher-assigned start: a revoked STUDENT role (the guard resolves no learner) -> FORBIDDEN, even with an open attempt and no licence', async () => {
    ownStudentIdMock.mockResolvedValue(null);
    hasStartedExecutionMock.mockResolvedValue(true);
    const res = await calls[5][1]();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    expect(canUseCapabilityMock).not.toHaveBeenCalled();
    expect(hasStartedExecutionMock).not.toHaveBeenCalled();
    expect(work.start).not.toHaveBeenCalled();
  });

  it('a valid active Student with no licence and nothing open -> ENTITLEMENT_REQUIRED (not FORBIDDEN)', async () => {
    const res = await calls[5][1]();
    expect(await res.json()).toEqual({ error: 'ENTITLEMENT_REQUIRED' });
  });
});

// ---------------------------------------------------------------------------
// L11-R1 / D-8(c): an attempt started while licensed may be finished.
// ---------------------------------------------------------------------------

describe('D-8(c): transfer submit', () => {
  const PROMPT = 'A recipe serves four…';
  const submit = (over: Record<string, unknown> = {}) =>
    transferSubmitPOST(json({ studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, conceptLabel: 'Fractions', prompt: PROMPT, studentResponse: 'I would halve it', transferTaskId: '55555555-5555-4555-8555-555555555555', ...over }));
  const instance = async (over: Record<string, unknown> = {}) => {
    const { computeTransferPromptExactHash } = await import('@/lib/transfer-task-identity');
    return { id: '55555555-5555-4555-8555-555555555555', studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, transferDistance: 'NEAR', transferModality: 'TEXT', noveltyDimensions: [], targetConceptIds: [], contextDomain: null, taskFamilyId: 'f', promptFingerprint: 'fp', promptExactHash: computeTransferPromptExactHash(PROMPT), generatorVersion: null, generatorPromptVersion: 'v', noveltyValidationPassed: true, createdAt: '2026-10-01T00:00:00Z', ...over };
  };

  it("unlicensed, the Student's own server-minted task and its exact prompt: the answer is graded (the attempt is finished)", async () => {
    loadTransferTaskInstanceMock.mockResolvedValue(await instance());
    work.grade.mockRejectedValue(new Error('stop after grading was reached'));
    const res = await submit();
    expect(work.grade).toHaveBeenCalledTimes(1);
    expect((await res.json()).error).not.toBe('ENTITLEMENT_REQUIRED');
    expect(canUseCapabilityMock).not.toHaveBeenCalled();
  });

  it('unlicensed, no server task (nothing was started): still 403 ENTITLEMENT_REQUIRED, nothing graded', async () => {
    const res = await submit();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'ENTITLEMENT_REQUIRED' });
    expect(work.grade).not.toHaveBeenCalled();
  });

  it("ownership is not weakened: another Student's task, or a different prompt, is refused before any grading", async () => {
    loadTransferTaskInstanceMock.mockResolvedValue(await instance({ studentId: '99999999-9999-4999-8999-999999999999' }));
    expect((await submit()).status).toBe(409);
    loadTransferTaskInstanceMock.mockResolvedValue(await instance());
    expect((await submit({ prompt: 'A different task the server never generated' })).status).toBe(409);
    expect(work.grade).not.toHaveBeenCalled();
  });
});

describe('D-8(c): teacher-assigned task', () => {
  const start = () => calls[5][1]();

  it('unlicensed, already started (an execution exists for this task and key): "Continue" recovers the same activity', async () => {
    hasStartedExecutionMock.mockResolvedValue(true);
    work.start.mockResolvedValue({ outcome: 'RECOVERED', executionId: 'e-1', executionReference: 'quiz-1' });
    const res = await start();
    expect(res.status).toBe(200);
    expect(hasStartedExecutionMock).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', 'k-1');
    expect(work.start).toHaveBeenCalledWith('actor-1', '44444444-4444-4444-8444-444444444444', 'k-1');
  });

  it('unlicensed, never started: 403 ENTITLEMENT_REQUIRED, the dispatcher (which would generate) never runs', async () => {
    const res = await start();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'ENTITLEMENT_REQUIRED' });
    expect(work.start).not.toHaveBeenCalled();
  });

  it('the dispatcher still decides ownership and validity of a recovered task (completed / expired / not theirs)', async () => {
    hasStartedExecutionMock.mockResolvedValue(true);
    const { StudentInterventionNotStartableError, StudentInterventionAccessDeniedError } = await import('@/lib/student/teacher-intervention-execution.service');
    work.start.mockRejectedValueOnce(new StudentInterventionNotStartableError('COMPLETED'));
    expect((await start()).status).toBe(409);
    work.start.mockRejectedValueOnce(new StudentInterventionAccessDeniedError('not owner'));
    expect((await start()).status).toBe(403);
  });
});

describe('the shared gate fails closed', () => {
  it('licensed -> null; unlicensed -> 403 ENTITLEMENT_REQUIRED', async () => {
    canUseCapabilityMock.mockResolvedValue(true);
    expect(await learningLicenceRequiredResponseForActor('actor-1', STUDENT)).toBeNull();
    canUseCapabilityMock.mockResolvedValue(false);
    expect((await learningLicenceRequiredResponseForActor('actor-1', STUDENT))!.status).toBe(403);
  });
  it('an identity lookup failure refuses instead of letting the request through', async () => {
    canUseCapabilityMock.mockResolvedValue(true);
    vi.mocked(getOrCreateCanonicalUser).mockRejectedValueOnce(new Error('db down'));
    expect((await learningLicenceRequiredResponse({ userId: 'clerk-1', email: null }, STUDENT))!.status).toBe(403);
  });
});
