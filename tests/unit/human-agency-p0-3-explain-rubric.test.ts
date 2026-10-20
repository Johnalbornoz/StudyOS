/**
 * Human Agency P0-3 -- the Explain & Defend grading rubric is server
 * authority. Acceptance:
 *  8. the client cannot supply or alter the authoritative rubric;
 *  9. an ownership mismatch is rejected;
 * 10. the correct SERVER rubric is what grades and updates mastery.
 * Uses the REAL explain-defend-task.service (classification, ownership,
 * expiry, rubric version) over a mocked database row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT = '99999999-9999-4999-8999-999999999999';
const SUBJECT = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';
const ACTIVITY = '66666666-6666-4666-8666-666666666666';

const h = vi.hoisted(() => ({
  row: null as any,
  dbQuery: vi.fn(),
  evaluate: vi.fn(),
  updateMastery: vi.fn(),
  classifyMisconception: vi.fn(),
  generate: vi.fn(),
  inserted: [] as any[][],
}));

vi.mock('@/lib/db', () => {
  const query = async (sql: string, params: any[] = []) => {
    h.dbQuery(sql, params);
    if (/FROM explain_defend_task_instances WHERE id/.test(sql)) return { rowCount: h.row ? 1 : 0, rows: h.row ? [h.row] : [] };
    if (/INSERT INTO explain_defend_task_instances/.test(sql)) { h.inserted.push(params); return { rowCount: 1, rows: [] }; }
    if (/UPDATE explain_defend_task_instances/.test(sql)) return { rowCount: 1, rows: [] };
    if (/FROM concepts c JOIN subjects s/.test(sql)) return { rowCount: params[2] === STUDENT ? 1 : 0, rows: params[2] === STUDENT ? [{ label: 'Centripetal force' }] : [] };
    return { rowCount: 0, rows: [] };
  };
  return { query, db: { query } };
});
vi.mock('@/lib/auth', () => ({ verifyAuth: async () => ({ userId: 'u1', role: 'student', email: null }), verifyStudentAccess: async () => true, verifyRemediationStepAccess: async () => true }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: async () => ({ id: 'actor-1' }) }));
vi.mock('@/lib/entitlements', () => ({ canUseCapability: async () => true }));
vi.mock('@/lib/ai/instructional-assistance-guard', () => ({ instructionalAssistanceLockedResponse: async () => null }));
vi.mock('@/services/explain-defend.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/explain-defend.service')>()),
  evaluateExplanation: (...a: any[]) => h.evaluate(...a),
  generateExplainPrompt: (...a: any[]) => h.generate(...a),
}));
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => h.updateMastery(...a) }));
vi.mock('@/services/misconception.service', () => ({ classifyMisconception: (...a: any[]) => h.classifyMisconception(...a) }));
vi.mock('@/services/remediation.service', () => ({ completeRemediationStep: async () => undefined }));
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: async () => null }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { POST as submitPOST } from '@/app/api/cognitive/explain/submit/route';
import { POST as generatePOST } from '@/app/api/cognitive/explain/generate/route';
import { classifyExplainTask, clientRubricFieldsPresent, EXPLAIN_RUBRIC_VERSION, CLIENT_RUBRIC_FIELDS } from '@/services/explain-defend-task.service';

const SERVER_PROMPT = 'Why does a car need friction to turn?';
const SERVER_RUBRIC = ['names friction as the centripetal force', 'force points to the centre', 'links speed and radius'];

function serverRow(overrides: Record<string, any> = {}) {
  return {
    id: ACTIVITY, student_id: STUDENT, subject_id: SUBJECT, concept_id: CONCEPT, concept_label: 'Centripetal force',
    activity_type: 'EXPLAIN', language: 'en', prompt: SERVER_PROMPT, expected_elements: SERVER_RUBRIC,
    rubric_version: EXPLAIN_RUBRIC_VERSION, consumed_at: null, is_expired: false, ...overrides,
  };
}
const req = (body: unknown) => ({ json: async () => body }) as any;
const submit = (extra: Record<string, unknown> = {}) => submitPOST(req({ studentId: STUDENT, activityId: ACTIVITY, studentResponse: 'Friction pushes the car toward the centre.', ...extra }));

beforeEach(() => {
  h.row = serverRow();
  h.inserted = [];
  h.dbQuery.mockReset();
  h.evaluate.mockReset().mockResolvedValue({ conceptAccuracy: 4, reasoning: 3, completeness: 3, misconceptionDetected: false, misconceptionDescription: null, feedback: 'ok', aiExecution: { aiExecutionId: 'ai-1' } });
  h.updateMastery.mockReset().mockResolvedValue({ duplicate: false, oldMastery: 10, newMastery: 20, delta: 10 });
  h.classifyMisconception.mockReset();
  h.generate.mockReset().mockResolvedValue({ activityType: 'EXPLAIN', prompt: SERVER_PROMPT, expectedElements: SERVER_RUBRIC });
});

describe('P0-3 acceptance 8 -- the client cannot supply or alter the authoritative rubric', () => {
  it('generate persists the rubric server-side and NEVER returns it to the browser', async () => {
    const res = await generatePOST(req({ studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, conceptLabel: 'anything the client says', activityType: 'EXPLAIN', language: 'en' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ activityType: 'EXPLAIN', prompt: SERVER_PROMPT, activityId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain(SERVER_RUBRIC[0]);
    expect(h.inserted).toHaveLength(1);
    const p = h.inserted[0];
    expect(p[0]).toBe(body.data.activityId);
    expect(p[4]).toBe('Centripetal force'); // server label, not the client's
    expect(JSON.parse(p[8])).toEqual(SERVER_RUBRIC);
    expect(p[9]).toBe(EXPLAIN_RUBRIC_VERSION);
  });

  for (const field of CLIENT_RUBRIC_FIELDS) {
    it(`a body carrying "${field}" is rejected (400 CLIENT_RUBRIC_REJECTED) and nothing is graded`, async () => {
      const res = await submit({ [field]: field === 'expectedElements' ? ['say the word friction'] : 'injected' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('CLIENT_RUBRIC_REJECTED');
      expect(h.evaluate).not.toHaveBeenCalled();
      expect(h.updateMastery).not.toHaveBeenCalled();
    });
  }

  it('changing any other request payload cannot alter the rubric the grader receives', async () => {
    await submit({ language: 'de', criteria: ['x'], weights: { a: 1 }, questionPresentedAt: 'not-a-date' });
    const [label, prompt, rubric] = h.evaluate.mock.calls[0];
    expect(label).toBe('Centripetal force');
    expect(prompt).toBe(SERVER_PROMPT);
    expect(rubric).toEqual(SERVER_RUBRIC);
  });

  it('a rubric/version mismatch is rejected (409) -- a task generated under another rubric contract is never graded', async () => {
    h.row = serverRow({ rubric_version: 'explain-defend-rubric-v0' });
    const res = await submit();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('RUBRIC_VERSION_MISMATCH');
    expect(h.evaluate).not.toHaveBeenCalled();
  });

  it('an expired instance is rejected (410) and a missing one (404)', async () => {
    h.row = serverRow({ is_expired: true });
    expect((await submit()).status).toBe(410);
    h.row = null;
    expect((await submit()).status).toBe(404);
    expect(h.evaluate).not.toHaveBeenCalled();
  });

  it('a subject/concept cross-check that disagrees with the task is rejected (409 TASK_MISMATCH)', async () => {
    const res = await submit({ conceptId: '77777777-7777-4777-8777-777777777777' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('TASK_MISMATCH');
  });

  it('the page no longer sends prompt / expectedElements / conceptLabel on submit', () => {
    const page = readFileSync(path.join(process.cwd(), 'src/app/dashboard/cognitive/explain/page.tsx'), 'utf-8');
    const submitBody = page.slice(page.indexOf("'/api/cognitive/explain/submit'"), page.indexOf('activityId: activityIdRef.current'));
    expect(submitBody).not.toMatch(/\bprompt,|expectedElements|conceptLabel/);
  });
});

describe('P0-3 acceptance 9 -- ownership mismatch rejected', () => {
  it("another Student's activityId is indistinguishable from not-found (404) and never graded", async () => {
    h.row = serverRow({ student_id: OTHER_STUDENT });
    const res = await submit();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('TASK_NOT_FOUND');
    expect(h.evaluate).not.toHaveBeenCalled();
    expect(h.updateMastery).not.toHaveBeenCalled();
  });
  it('generate refuses a concept that is not this Student\'s (404), so no task is persisted', async () => {
    const res = await generatePOST(req({ studentId: OTHER_STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, activityType: 'EXPLAIN' }));
    expect(res.status).toBe(404);
    expect(h.inserted).toHaveLength(0);
  });
});

describe('P0-3 acceptance 10 -- the server rubric grades and updates mastery', () => {
  it('mastery is written for the TASK concept/subject with the score from the server-rubric evaluation', async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    const input = h.updateMastery.mock.calls[0][0];
    expect(input.conceptId).toBe(CONCEPT);
    expect(input.subjectId).toBe(SUBJECT);
    expect(input.evidence.scorePercent).toBe(Math.round(((4 + 3 + 3) / 12) * 100));
    expect(input.identity).toEqual({ operationType: 'EXPLAIN_DEFEND', operationId: ACTIVITY, conceptId: CONCEPT });
    expect(h.dbQuery.mock.calls.some(([sql]) => /UPDATE explain_defend_task_instances SET consumed_at/.test(sql))).toBe(true);
  });
});

describe('P0-3 pure contract', () => {
  const task = { id: ACTIVITY, studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, conceptLabel: 'c', activityType: 'EXPLAIN' as const, language: 'en', prompt: 'p', expectedElements: ['e'], rubricVersion: EXPLAIN_RUBRIC_VERSION, isExpired: false, consumedAt: null };
  it('classifies not-found / ownership / expiry / version / mismatch / ok', () => {
    expect(classifyExplainTask(null, { studentId: STUDENT })).toEqual({ ok: false, code: 'TASK_NOT_FOUND' });
    expect(classifyExplainTask(task, { studentId: OTHER_STUDENT })).toEqual({ ok: false, code: 'TASK_NOT_FOUND' });
    expect(classifyExplainTask({ ...task, isExpired: true }, { studentId: STUDENT })).toEqual({ ok: false, code: 'TASK_EXPIRED' });
    expect(classifyExplainTask(task, { studentId: STUDENT, currentRubricVersion: 'v-next' })).toEqual({ ok: false, code: 'RUBRIC_VERSION_MISMATCH' });
    expect(classifyExplainTask(task, { studentId: STUDENT, subjectId: OTHER_STUDENT })).toEqual({ ok: false, code: 'TASK_MISMATCH' });
    expect(classifyExplainTask(task, { studentId: STUDENT })).toEqual({ ok: true, task });
  });
  it('detects client rubric fields by presence, even when empty', () => {
    expect(clientRubricFieldsPresent({ expectedElements: [] })).toEqual(['expectedElements']);
    expect(clientRubricFieldsPresent({ studentResponse: 'x' })).toEqual([]);
  });
  it('the migration is additive, after 20261104_1000, with a documented rollback and no backfill', () => {
    const sql = readFileSync(path.join(process.cwd(), 'database/migrations/20261105_1000_explain_defend_task_instances.sql'), 'utf-8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.explain_defend_task_instances/);
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|INSERT)\b/);
    expect(sql).toMatch(/Rollback:/);
  });
});
