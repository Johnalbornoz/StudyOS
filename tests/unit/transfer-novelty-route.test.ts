/**
 * Phase 7 -- Step 7B2: generate/submit route anti-memorization wiring.
 *
 * generate: bounded regeneration on a recent structural duplicate, then
 * fail-closed 409 with one terminal WARN and zero AI calls beyond the
 * cap; unseen candidate behaves exactly like 7B1.
 * submit: a DIFFERENT taskId re-submitting a recent duplicate fingerprint
 * is rejected 409 before evaluateTransferResponse/updateMastery; the
 * SAME taskId (idempotent resubmit) is unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const generateTransferActivityMock = vi.fn();
const evaluateTransferResponseMock = vi.fn();
vi.mock('@/services/transfer.service', () => ({
  generateTransferActivity: (...a: any[]) => generateTransferActivityMock(...a),
  evaluateTransferResponse: (...a: any[]) => evaluateTransferResponseMock(...a),
}));

const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => updateMasteryMock(...a) }));
vi.mock('@/services/remediation.service', () => ({ completeRemediationStep: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { POST as GENERATE } from '@/app/api/cognitive/transfer/generate/route';
import { POST as SUBMIT } from '@/app/api/cognitive/transfer/submit/route';
import { computeTransferPromptFingerprint } from '@/lib/transfer-task-identity';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';
const TASK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SEEN_PROMPT = 'A wheel of radius 20 m spins at 4 m/s. Find the centripetal acceleration.';
const SEEN_FP = computeTransferPromptFingerprint(SEEN_PROMPT);
const NEW_PROMPT = 'Explain why a spinning wheel needs an inward force, using an everyday example.';

const req = (body: any) => ({ json: async () => body } as any);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** dbQuery: recent-fingerprints SELECT -> given rows; anything else -> {rows:[]}. */
function withRecentEvidence(rows: any[]) {
  dbQueryMock.mockImplementation(async (sql: string) => {
    if (typeof sql === 'string' && sql.includes("source_type = 'TRANSFER'") && sql.includes('ORDER BY timestamp DESC')) {
      return { rows };
    }
    return { rows: [] };
  });
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  generateTransferActivityMock.mockReset();
  evaluateTransferResponseMock.mockReset().mockResolvedValue({ result: 'correct', feedback: 'ok', aiExecution: { aiExecutionId: 'ai-1' } });
  updateMasteryMock.mockReset().mockResolvedValue({ duplicate: false, oldMastery: 10, newMastery: 20, delta: 10 });
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

const opsWarns = () => (warnSpy.mock.calls as any[][]).filter((c) => c[0] === '[ops]').map((c) => JSON.parse(c[1] as string));

describe('7B2 -- generate route', () => {
  it('unseen candidate: 1 AI call, served exactly like 7B1', async () => {
    withRecentEvidence([]);
    generateTransferActivityMock.mockResolvedValue({ distance: 'MID', context: 'c', prompt: NEW_PROMPT });
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    expect(res.status ?? 200).toBe(200);
    expect(generateTransferActivityMock).toHaveBeenCalledTimes(1);
    expect(body.data.transferTaskId).toMatch(UUID_RE);
    expect(body.data.activityId).toBe(body.data.transferTaskId);
    expect(body.data.promptFingerprint).toBe(computeTransferPromptFingerprint(NEW_PROMPT));
    expect(opsWarns()).toHaveLength(0);
  });

  it('first candidate is a recent duplicate -> regenerates once -> serves the unseen 2nd candidate', async () => {
    withRecentEvidence([{ metadata: { promptFingerprint: SEEN_FP, transferTaskId: TASK_A }, timestamp: 't' }]);
    generateTransferActivityMock
      .mockResolvedValueOnce({ distance: 'MID', context: 'c', prompt: SEEN_PROMPT }) // duplicate
      .mockResolvedValueOnce({ distance: 'MID', context: 'c', prompt: NEW_PROMPT }); // unseen
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    expect(res.status ?? 200).toBe(200);
    expect(generateTransferActivityMock).toHaveBeenCalledTimes(2);
    expect(body.data.promptFingerprint).toBe(computeTransferPromptFingerprint(NEW_PROMPT));
    expect(opsWarns()).toHaveLength(0); // recovered -> no terminal warn
    expect(dbQueryMock.mock.calls.filter((c) => String(c[0]).includes("source_type = 'TRANSFER'")).length).toBe(1); // one bounded read reused
  });

  it('terminal duplicate: both candidates duplicate -> 409, exactly 2 AI calls, one WARN, no id, no evidence', async () => {
    withRecentEvidence([{ metadata: { promptFingerprint: SEEN_FP, transferTaskId: TASK_A }, timestamp: 't' }]);
    generateTransferActivityMock.mockResolvedValue({ distance: 'MID', context: 'c', prompt: SEEN_PROMPT });
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe('TRANSFER_TASK_NOT_NOVEL_ENOUGH');
    expect(body.data).toBeUndefined();
    expect(generateTransferActivityMock).toHaveBeenCalledTimes(2);
    const warns = opsWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ subsystem: 'transfer', operation: 'generateTransferActivity', conceptId: CONCEPT, count: 2 });
    const raw = (warnSpy.mock.calls as any[][]).find((c) => c[0] === '[ops]')![1] as string;
    expect(raw).not.toContain(STUDENT);
    expect(raw).not.toContain(SEEN_FP);
    expect(raw).not.toContain('prompt');
  });
});

async function submit(extra: Record<string, unknown>) {
  const res = await SUBMIT(
    req({ studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, conceptLabel: 'X', prompt: SEEN_PROMPT, distance: 'MID', studentResponse: 'a=v^2/r', ...extra }),
  );
  return { res, body: await res.json() };
}

describe('7B2 -- submit route bypass guard', () => {
  it('different taskId re-submitting a recent duplicate fingerprint -> 409 before grading/mastery', async () => {
    withRecentEvidence([{ metadata: { promptFingerprint: SEEN_FP, transferTaskId: TASK_A }, timestamp: 't' }]);
    const { res, body } = await submit({ transferTaskId: TASK_B });
    expect(res.status).toBe(409);
    expect(body.error).toBe('TRANSFER_TASK_DUPLICATE');
    expect(evaluateTransferResponseMock).not.toHaveBeenCalled();
    expect(updateMasteryMock).not.toHaveBeenCalled();
    expect(opsWarns()).toHaveLength(1);
    expect(opsWarns()[0]).toMatchObject({ subsystem: 'transfer', operation: 'submitTransferResponse', conceptId: CONCEPT });
  });

  it('SAME taskId re-submitting its own fingerprint -> not a structural duplicate, proceeds (idempotency preserved)', async () => {
    withRecentEvidence([{ metadata: { promptFingerprint: SEEN_FP, transferTaskId: TASK_A }, timestamp: 't' }]);
    const { res } = await submit({ transferTaskId: TASK_A });
    expect(res.status ?? 200).toBe(200);
    expect(evaluateTransferResponseMock).toHaveBeenCalledTimes(1);
    expect(updateMasteryMock.mock.calls[0][0].identity.operationId).toBe(TASK_A);
  });

  it('legacy recent rows without a fingerprint -> not rejected, proceeds', async () => {
    withRecentEvidence([{ metadata: { transferDistance: 'NEAR' }, timestamp: 't' }, { metadata: null, timestamp: 't0' }]);
    const { res } = await submit({ transferTaskId: TASK_B });
    expect(res.status ?? 200).toBe(200);
    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
  });

  it('no recent duplicate -> proceeds and still stamps identity metadata (7B1 behavior intact)', async () => {
    withRecentEvidence([]);
    const { res } = await submit({ transferTaskId: TASK_B });
    expect(res.status ?? 200).toBe(200);
    const mergeCall = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('UPDATE learning_evidence'));
    const meta = JSON.parse(mergeCall![1][2] as string);
    expect(meta).toMatchObject({ transferTaskId: TASK_B, promptFingerprint: SEEN_FP, sourceConceptId: CONCEPT, transferDistance: 'MID', assisted: false });
  });
});
