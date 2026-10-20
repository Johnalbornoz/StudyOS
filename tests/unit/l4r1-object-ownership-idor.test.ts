/**
 * L4-R1 -- two confirmed IDORs, closed.
 *
 *  - GET /api/assessments/upcoming?subjectId= (and the same sink in
 *    GET /api/exam-readiness/score) handed a client subject id to the
 *    assessment calendar without checking the caller owns that subject.
 *  - POST /api/cognitive/transfer/submit completed a client-named remediation
 *    step without checking it belongs to the caller.
 *
 * The REAL guards (src/lib/auth.ts) and the REAL assessment service run here
 * against an in-memory database, so "foreign state not mutated" is asserted on
 * the statements actually issued, not on a mock of the guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: vi.fn().mockResolvedValue(null), clerkClient: vi.fn() }));

const ME = { clerk: 'clerk-me', student: '11111111-1111-4111-8111-111111111111' };
const OTHER_STUDENT = '99999999-9999-4999-8999-999999999999';
const MY_SUBJECT = '22222222-2222-4222-8222-222222222222';
const FOREIGN_SUBJECT = '77777777-7777-4777-8777-777777777777';
const MISSING_SUBJECT = '00000000-0000-4000-8000-000000000000';
const MY_STEP = '44444444-4444-4444-8444-444444444444';
const FOREIGN_STEP = '55555555-5555-4555-8555-555555555555';
const MISSING_STEP = '66666666-6666-4666-8666-666666666666';
const CONCEPT = '33333333-3333-4333-8333-333333333333';

const tables = {
  students: [{ id: ME.student, clerk_id: ME.clerk }, { id: OTHER_STUDENT, clerk_id: 'clerk-other' }],
  subjects: [{ id: MY_SUBJECT, student_id: ME.student }, { id: FOREIGN_SUBJECT, student_id: OTHER_STUDENT }],
  steps: [{ id: MY_STEP, student_id: ME.student }, { id: FOREIGN_STEP, student_id: OTHER_STUDENT }],
};
const log: Array<{ sql: string; params: any[] }> = [];
const UUID = /^[0-9a-f-]{36}$/i;
async function query(sql: string, params: any[] = []) {
  log.push({ sql, params });
  // L10 SF-1/SF-2: the ownership guard now also requires an ACTIVE account and STUDENT role, in the same query.
  if (/FROM students s\s+JOIN users u[\s\S]*u\.clerk_id = \$1 AND s\.id = \$2/.test(sql)) {
    return { rows: tables.students.filter((s) => s.clerk_id === params[0] && s.id === params[1]), rowCount: tables.students.filter((s) => s.clerk_id === params[0] && s.id === params[1]).length };
  }
  if (/FROM subjects\s+WHERE id = \$1 AND student_id = \$2/.test(sql)) {
    if (!UUID.test(String(params[0]))) throw new Error('invalid input syntax for type uuid');
    return { rows: tables.subjects.filter((s) => s.id === params[0] && s.student_id === params[1]) };
  }
  if (/FROM remediation_steps rs JOIN remediation_paths rp/.test(sql)) {
    return { rows: tables.steps.filter((s) => s.id === params[0] && s.student_id === params[1]) };
  }
  return { rows: [], rowCount: 0 };
}
vi.mock('@/lib/db', () => ({ db: { query: (sql: string, params?: any[]) => query(sql, params), connect: async () => ({ query: (sql: string, params?: any[]) => (/pg_try_advisory_xact_lock/.test(sql) ? Promise.resolve({ rows: [{ locked: true }] }) : query(sql, params)), release: () => {} }) } }));

/** Statements that touch the assessment calendar of a given subject id (read or write). */
const calendarStatementsFor = (subjectId: string) => log.filter((q) => /assessment_(occurrences|schedule_rules)/.test(q.sql) && q.params.includes(subjectId));
const writes = () => log.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql));

// ---- transfer/submit collaborators that are not under test ----
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn().mockResolvedValue({ id: 'actor-me' }) }));
vi.mock('@/lib/entitlements', () => ({ canUseCapability: vi.fn().mockResolvedValue(true) }));
const evaluateTransferResponseMock = vi.fn();
vi.mock('@/services/transfer.service', () => ({ evaluateTransferResponse: (...a: any[]) => evaluateTransferResponseMock(...a) }));
const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => updateMasteryMock(...a) }));
const completeRemediationStepMock = vi.fn();
vi.mock('@/services/remediation.service', () => ({ completeRemediationStep: (...a: any[]) => completeRemediationStepMock(...a) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { GET as upcomingGET } from '@/app/api/assessments/upcoming/route';
import { GET as readinessScoreGET } from '@/app/api/exam-readiness/score/route';
import { POST as transferSubmitPOST } from '@/app/api/cognitive/transfer/submit/route';

beforeEach(() => {
  log.length = 0;
  authMock.mockReset().mockResolvedValue({ userId: ME.clerk, sessionClaims: {} });
  evaluateTransferResponseMock.mockReset().mockResolvedValue({ result: 'correct', feedback: 'ok', aiExecution: { aiExecutionId: 'ai-1' } });
  updateMasteryMock.mockReset().mockResolvedValue({ duplicate: false, oldMastery: 10, newMastery: 20, delta: 10 });
  completeRemediationStepMock.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/assessments/upcoming?subjectId=', () => {
  const get = (subjectId: string, studentId = ME.student) =>
    upcomingGET({ url: `https://studyus.test/api/assessments/upcoming?studentId=${studentId}&subjectId=${subjectId}` } as any) as Promise<any>;

  it('own subject is allowed and the calendar is consulted for it', async () => {
    const res = await get(MY_SUBJECT);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(calendarStatementsFor(MY_SUBJECT).length).toBeGreaterThan(0);
  });

  it('a foreign subject is denied with the same 404 as a nonexistent one', async () => {
    const res = await get(FOREIGN_SUBJECT);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('foreign state is neither read nor mutated: no calendar statement is issued for the foreign subject', async () => {
    await get(FOREIGN_SUBJECT);
    expect(calendarStatementsFor(FOREIGN_SUBJECT)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('a nonexistent or malformed id is safe (404, no calendar access, never a 500)', async () => {
    for (const id of [MISSING_SUBJECT, 'not-a-uuid', "x' OR '1'='1"]) {
      log.length = 0;
      const res = await get(encodeURIComponent(id));
      expect(res.status).toBe(404);
      expect(log.filter((q) => /assessment_/.test(q.sql))).toEqual([]);
    }
  });

  it('claiming another student id is still a 403 before any subject lookup', async () => {
    const res = await get(FOREIGN_SUBJECT, OTHER_STUDENT);
    expect(res.status).toBe(403);
    expect(calendarStatementsFor(FOREIGN_SUBJECT)).toEqual([]);
  });
});

describe('GET /api/exam-readiness/score?subjectId= (same sink)', () => {
  it('a foreign subject is a 404 and its calendar is never touched', async () => {
    const res: any = await readinessScoreGET({ url: `https://studyus.test/api/exam-readiness/score?studentId=${ME.student}&subjectId=${FOREIGN_SUBJECT}` } as any);
    expect(res.status).toBe(404);
    expect(calendarStatementsFor(FOREIGN_SUBJECT)).toEqual([]);
    expect(writes()).toEqual([]);
  });
});

describe('POST /api/cognitive/transfer/submit remediationStepId', () => {
  const submit = async (extra: Record<string, unknown>) =>
    (await transferSubmitPOST({
      json: async () => ({
        studentId: ME.student,
        subjectId: MY_SUBJECT,
        conceptId: CONCEPT,
        conceptLabel: 'Centripetal acceleration',
        prompt: 'A cyclist rounds a bend of radius 30 m at 9 m/s. Find the centripetal acceleration.',
        distance: 'MID',
        studentResponse: 'a = v^2 / r',
        activityId: '88888888-8888-4888-8888-888888888888',
        ...extra,
      }),
    } as any)) as any;

  it('own remediation step is allowed and completed', async () => {
    const res = await submit({ remediationStepId: MY_STEP });
    expect(res.status ?? 200).toBe(200);
    expect(completeRemediationStepMock).toHaveBeenCalledTimes(1);
    expect(completeRemediationStepMock.mock.calls[0][0]).toBe(MY_STEP);
  });

  it('a foreign remediation step is denied (404) before anything is graded', async () => {
    const res = await submit({ remediationStepId: FOREIGN_STEP });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
    expect(evaluateTransferResponseMock).not.toHaveBeenCalled();
  });

  it('foreign state is unchanged: the step is not completed, no mastery is written, no statement writes', async () => {
    await submit({ remediationStepId: FOREIGN_STEP });
    expect(completeRemediationStepMock).not.toHaveBeenCalled();
    expect(updateMasteryMock).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('a nonexistent step id is the same 404', async () => {
    const res = await submit({ remediationStepId: MISSING_STEP });
    expect(res.status).toBe(404);
    expect(completeRemediationStepMock).not.toHaveBeenCalled();
  });

  it('a submission with no remediation step is unaffected', async () => {
    const res = await submit({});
    expect(res.status ?? 200).toBe(200);
    expect(completeRemediationStepMock).not.toHaveBeenCalled();
    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
  });
});
