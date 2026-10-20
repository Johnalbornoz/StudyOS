/**
 * L11-R1 / D-8(c) -- an attempt legitimately STARTED while the licence was
 * valid may be reopened, answered, completed and graded after the licence
 * ends. It never allows a new attempt, restarting a completed one, another
 * instructional session, or new paid activity; the attempt's own validity
 * rules and every ownership check still apply.
 *
 * (Transfer submit and the teacher-assigned start are covered in
 * l11-unlicensed-policy.test.ts, which already mocks those routes.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({
  isOwner: vi.fn(),
  entitled: vi.fn(),
  getQuizSession: vi.fn(),
  gradeQuizAnswer: vi.fn(),
  loadExplainTask: vi.fn(),
  evaluateExplanation: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  verifyAuth: vi.fn().mockResolvedValue({ userId: 'clerk-1', email: 's@test.com', role: 'student' }),
  verifyStudentAccess: vi.fn().mockResolvedValue(true),
  verifyRemediationStepAccess: vi.fn().mockResolvedValue(true),
  checkRateLimit: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn().mockResolvedValue({ id: 'actor-1' }) }));
vi.mock('@/lib/authorization', () => ({ isOwner: h.isOwner }));
// The Student has NO licence in this whole file.
vi.mock('@/lib/entitlements', () => ({ canUseCapability: h.entitled }));
vi.mock('@/lib/db', () => ({ db: { query: h.dbQuery }, query: h.dbQuery }));
vi.mock('@/lib/ai/instructional-assistance-guard', () => ({ instructionalAssistanceLockedResponse: async () => null }));
vi.mock('@/lib/safety/safety-route', () => ({ studentTextSafetyResponse: async () => null }));
vi.mock('@/services/quiz-persistence.service', () => ({ getQuizSession: h.getQuizSession }));
vi.mock('@/lib/quiz/grade-question', () => ({ gradeQuizAnswer: h.gradeQuizAnswer }));
vi.mock('@/services/safe-hint.service', () => ({ getSafeQuestionHints: vi.fn().mockResolvedValue({ hints: [] }) }));
vi.mock('@/services/explain-defend-task.service', () => ({
  clientRubricFieldsPresent: () => [],
  loadExplainTaskForSubmission: h.loadExplainTask,
  markExplainTaskConsumed: vi.fn(),
}));
vi.mock('@/services/explain-defend.service', () => ({ evaluateExplanation: h.evaluateExplanation, rubricScorePercent: () => 80 }));

import { POST as checkPOST } from '@/app/api/quizzes/session/[quizId]/check/route';
import { POST as explainSubmitPOST } from '@/app/api/cognitive/explain/submit/route';
import { hasStartedTeacherInterventionExecution } from '@/lib/entitlements/open-attempt';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const ACTIVITY = '66666666-6666-4666-8666-666666666666';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const json = (body: unknown) => ({ json: async () => body, url: 'https://studyus.test/x', headers: new Headers() }) as any;

const session = (over: Record<string, unknown> = {}) => ({
  id: 'quiz-1', studentId: STUDENT, subjectId: 'sub-1', conceptId: null, evidenceMode: 'PRACTICE', language: 'en', status: 'active',
  expiresAt: new Date(Date.now() + 3_600_000),
  questions: [{ id: 'q0', answerFormat: 'single_choice', correctAnswer: 'a', options: [{ id: 'a', text: 'x' }], explanation: 'because' }],
  ...over,
});
const task = (over: Record<string, unknown> = {}) => ({
  id: ACTIVITY, studentId: STUDENT, subjectId: 'sub-1', conceptId: 'c-1', conceptLabel: 'Fractions', activityType: 'EXPLAIN', language: 'en',
  prompt: 'Explain…', expectedElements: [], rubricVersion: 'v', isExpired: false, consumedAt: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.isOwner.mockResolvedValue(true);
  h.entitled.mockResolvedValue(false);
  h.getQuizSession.mockResolvedValue(session());
  h.gradeQuizAnswer.mockResolvedValue({ correct: true, score: 1, feedback: 'ok' });
  h.loadExplainTask.mockResolvedValue({ ok: true, task: task() });
  h.evaluateExplanation.mockRejectedValue(new Error('stop: grading was reached'));
  h.dbQuery.mockResolvedValue({ rows: [] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('answering inside an open quiz (POST /api/quizzes/session/[quizId]/check)', () => {
  const check = () => checkPOST(json({ studentId: STUDENT, questionIndex: 0, answer: 'a' }), { params: Promise.resolve({ quizId: 'quiz-1' }) });

  it('unlicensed, open session: the remaining answer is graded', async () => {
    const res = await check();
    expect(res.status).toBe(200);
    expect(h.gradeQuizAnswer).toHaveBeenCalledTimes(1);
  });

  it('a COMPLETED quiz cannot be reopened through it', async () => {
    h.getQuizSession.mockResolvedValue(session({ status: 'completed' }));
    const res = await check();
    expect(res.status).toBe(409);
    expect(h.gradeQuizAnswer).not.toHaveBeenCalled();
  });

  it("the session's own expiry is respected", async () => {
    h.getQuizSession.mockResolvedValue(session({ expiresAt: new Date(Date.now() - 1000) }));
    expect((await check()).status).toBe(409);
    expect(h.gradeQuizAnswer).not.toHaveBeenCalled();
  });

  it('ownership is not weakened: not the owner -> 403; a session of another Student -> 404', async () => {
    h.isOwner.mockResolvedValueOnce(false);
    expect((await check()).status).toBe(403);
    h.getQuizSession.mockResolvedValue(session({ studentId: '99999999-9999-4999-8999-999999999999' }));
    expect((await check()).status).toBe(404);
    expect(h.gradeQuizAnswer).not.toHaveBeenCalled();
  });

  it('the route cannot start anything: it creates no session and calls no generator', () => {
    const src = read('src/app/api/quizzes/session/[quizId]/check/route.ts');
    expect(src).not.toMatch(/storeQuiz|generateQuestionsForConcept|generate-and-take/);
    expect(src).toMatch(/session\.status !== 'active' \|\| new Date\(session\.expiresAt\)\.getTime\(\) < Date\.now\(\)/);
  });
});

describe('finishing an Explain task (POST /api/cognitive/explain/submit)', () => {
  const submit = () => explainSubmitPOST(json({ studentId: STUDENT, studentResponse: 'Because the denominators differ…', activityId: ACTIVITY }));
  const refusedForLicence = async (res: Response) => {
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'ENTITLEMENT_REQUIRED' });
    expect(h.evaluateExplanation).not.toHaveBeenCalled();
  };

  it("unlicensed, the Student's own task, not expired, not yet answered: it is graded", async () => {
    await submit();
    expect(h.evaluateExplanation).toHaveBeenCalledTimes(1);
    expect(h.entitled).not.toHaveBeenCalled();
  });

  it('a task that was already answered is not a second attempt: licence required', async () => {
    h.loadExplainTask.mockResolvedValue({ ok: true, task: task({ consumedAt: new Date() }) });
    await refusedForLicence(await submit());
  });

  it("the task's own expiry is respected: an expired task is not continued", async () => {
    h.loadExplainTask.mockResolvedValue({ ok: false, code: 'TASK_EXPIRED' });
    await refusedForLicence(await submit());
  });

  it("no such task, or another Student's task (the loader answers TASK_NOT_FOUND): licence required, nothing revealed", async () => {
    h.loadExplainTask.mockResolvedValue({ ok: false, code: 'TASK_NOT_FOUND' });
    await refusedForLicence(await submit());
  });

  it('a licensed Student is unaffected: task errors keep their own status', async () => {
    h.entitled.mockResolvedValue(true);
    h.loadExplainTask.mockResolvedValue({ ok: false, code: 'TASK_EXPIRED' });
    expect((await submit()).status).toBe(410);
  });
});

describe('routes that only ever act on an existing attempt keep their own guards', () => {
  it('simulation/attempts/[id]/next-item leaves access to the attempt service and maps its denial to 403', () => {
    expect(read('src/app/api/simulation/attempts/[id]/next-item/route.ts')).toMatch(/SimulationItemAccessDeniedError\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}, \{ status: 403 \}\)/);
  });

  it.each(['pause', 'resume', 'complete', 'abandon', 'result'])('simulation/attempts/[id]/%s loads the attempt and checks the actor against its Student', (name) => {
    const src = read(`src/app/api/simulation/attempts/[id]/${name}/route.ts`);
    expect(src).toMatch(/getSimulationAttempt\(/);
    // The guard helper differs by route and by base: `canAccessLearner` / `isOwner`, or -- after
    // L10 SF-4 -- `resolveLearnerReadScope` on the result route. Each binds the actor to the
    // attempt's own Student.
    expect(src).toMatch(/(canAccessLearner|isOwner|resolveLearnerReadScope)\(actor\.id, attempt\.studentId/);
  });

  it('a paused attempt idle beyond its expiry is never resumed', () => {
    expect(read('src/app/api/simulation/attempts/[id]/resume/route.ts')).toMatch(/expireSimulationAttemptIfInactive\(attempt\)\) return NextResponse\.json\(\{ error: 'ATTEMPT_EXPIRED' \}/);
  });
});

describe('hasStartedTeacherInterventionExecution', () => {
  it('true only for an existing execution of that task and key; any error reads as not started', async () => {
    h.dbQuery.mockResolvedValueOnce({ rows: [{}] });
    expect(await hasStartedTeacherInterventionExecution('i-1', 'k-1')).toBe(true);
    expect(h.dbQuery).toHaveBeenLastCalledWith(expect.stringMatching(/teacher_intervention_id = \$1 AND idempotency_key = \$2/), ['i-1', 'k-1']);
    h.dbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await hasStartedTeacherInterventionExecution('i-1', 'k-2')).toBe(false);
    h.dbQuery.mockRejectedValueOnce(new Error('db down'));
    expect(await hasStartedTeacherInterventionExecution('i-1', 'k-1')).toBe(false);
  });
});
