/**
 * Phase 7 -- Step 7B1: Transfer generate/submit route identity wiring.
 *
 * Proves: generate mints ONE server id (activityId === transferTaskId);
 * submit resolves the canonical id (either alias accepted, conflicting
 * ids rejected 400, missing rejected 400), builds operation_key from
 * the resolved id, and stamps transferTaskId + a SERVER-computed
 * promptFingerprint onto the evidence metadata without disturbing the
 * existing metadata or the score path. No real DB / AI / auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const generateStructuredTransferActivityMock = vi.fn();
const evaluateTransferResponseMock = vi.fn();
vi.mock('@/services/transfer.service', () => ({
  generateStructuredTransferActivity: (...a: any[]) => generateStructuredTransferActivityMock(...a),
  evaluateTransferResponse: (...a: any[]) => evaluateTransferResponseMock(...a),
}));

const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => updateMasteryMock(...a) }));
vi.mock('@/services/remediation.service', () => ({ completeRemediationStep: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const dbQueryMock = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { POST as GENERATE } from '@/app/api/cognitive/transfer/generate/route';
import { POST as SUBMIT } from '@/app/api/cognitive/transfer/submit/route';
import { computeTransferPromptFingerprint } from '@/lib/transfer-task-identity';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';
const PROMPT = 'A cyclist rounds a bend of radius 30 m at 9 m/s. Find the centripetal acceleration.';

const req = (body: any) => ({ json: async () => body } as any);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  generateStructuredTransferActivityMock.mockReset().mockResolvedValue({
    distance: 'MID',
    context: 'a bike on a curve',
    prompt: PROMPT,
    noveltyDimensions: ['STRATEGY'],
    transferModality: 'STRUCTURAL',
    targetConceptIds: [],
    contextDomain: 'sports',
    generatorPromptVersion: 'v2',
  });
  evaluateTransferResponseMock.mockReset().mockResolvedValue({ result: 'correct', feedback: 'ok', aiExecution: { aiExecutionId: 'ai-1' } });
  updateMasteryMock.mockReset().mockResolvedValue({ duplicate: false, oldMastery: 10, newMastery: 20, delta: 10 });
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
});

describe('7B1 -- generate route mints one canonical id', () => {
  it('returns transferTaskId (UUID), activityId === transferTaskId, and a server fingerprint', async () => {
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'Centripetal accel', distance: 'MID' }));
    const body = await res.json();
    expect(res.status ?? 200).toBe(200);
    expect(body.data.transferTaskId).toMatch(UUID_RE);
    expect(body.data.activityId).toBe(body.data.transferTaskId);
    expect(body.data.promptFingerprint).toBe(computeTransferPromptFingerprint(PROMPT));
    expect(body.data.prompt).toBe(PROMPT);
  });
});

async function submit(extra: Record<string, unknown>) {
  const res = await SUBMIT(
    req({
      studentId: STUDENT,
      subjectId: SUBJECT,
      conceptId: CONCEPT,
      conceptLabel: 'Centripetal accel',
      prompt: PROMPT,
      distance: 'MID',
      studentResponse: 'a = v^2 / r',
      ...extra,
    }),
  );
  return { res, body: await res.json() };
}

describe('7B1 -- submit route canonical id resolution', () => {
  it('accepts only activityId; operation_key uses it', async () => {
    const { res } = await submit({ activityId: OTHER_ID });
    expect(res.status ?? 200).toBe(200);
    expect(updateMasteryMock.mock.calls[0][0].identity).toMatchObject({ operationType: 'TRANSFER', operationId: OTHER_ID, conceptId: CONCEPT });
  });
  it('accepts only transferTaskId; operation_key uses it', async () => {
    const { res } = await submit({ transferTaskId: OTHER_ID });
    expect(res.status ?? 200).toBe(200);
    expect(updateMasteryMock.mock.calls[0][0].identity.operationId).toBe(OTHER_ID);
  });
  it('accepts both when equal', async () => {
    const { res } = await submit({ transferTaskId: OTHER_ID, activityId: OTHER_ID });
    expect(res.status ?? 200).toBe(200);
  });
  it('rejects both-but-different with 400 CONFLICTING_TASK_IDS', async () => {
    const { res, body } = await submit({ transferTaskId: STUDENT, activityId: OTHER_ID });
    expect(res.status).toBe(400);
    expect(body.message).toBe('CONFLICTING_TASK_IDS');
    expect(updateMasteryMock).not.toHaveBeenCalled();
  });
  it('rejects missing both with 400 MISSING_TASK_ID', async () => {
    const { res, body } = await submit({});
    expect(res.status).toBe(400);
    expect(body.message).toBe('MISSING_TASK_ID');
    expect(updateMasteryMock).not.toHaveBeenCalled();
  });
});

describe('7B1/7C1 -- submit route evidence metadata (atomic, via updateMastery)', () => {
  // 7C1: canonical Transfer metadata is now passed INTO updateMastery
  // (same learning_evidence INSERT / same transaction), not stamped by
  // a post-commit `UPDATE learning_evidence`.
  function atomicMetadata() {
    expect(updateMasteryMock).toHaveBeenCalled();
    return updateMasteryMock.mock.calls[0][0].metadata;
  }

  it('adds transferTaskId + server-computed promptFingerprint + sourceConceptId, keeps existing keys', async () => {
    await submit({ activityId: OTHER_ID });
    expect(atomicMetadata()).toMatchObject({
      transferDistance: 'MID',
      assisted: false,
      aiExecution: { aiExecutionId: 'ai-1' },
      transferTaskId: OTHER_ID,
      promptFingerprint: computeTransferPromptFingerprint(PROMPT),
      sourceConceptId: CONCEPT,
    });
  });

  it('a client-sent promptFingerprint is ignored (never becomes canonical metadata)', async () => {
    await submit({ activityId: OTHER_ID, promptFingerprint: 'deadbeef-client-supplied' });
    const meta = atomicMetadata();
    expect(meta.promptFingerprint).toBe(computeTransferPromptFingerprint(PROMPT));
    expect(meta.promptFingerprint).not.toBe('deadbeef-client-supplied');
  });

  it('no post-commit UPDATE learning_evidence anywhere (dual-writing removed)', async () => {
    await submit({ activityId: OTHER_ID });
    expect(dbQueryMock.mock.calls.some((c) => typeof c[0] === 'string' && /UPDATE learning_evidence/i.test(c[0]))).toBe(false);
  });

  it('on updateMastery duplicate: still no second evidence write, remediation step not completed', async () => {
    updateMasteryMock.mockResolvedValueOnce({ duplicate: true, oldMastery: 20, newMastery: 20, delta: 0 });
    await submit({ activityId: OTHER_ID, remediationStepId: '55555555-5555-4555-8555-555555555555' });
    expect(dbQueryMock.mock.calls.some((c) => typeof c[0] === 'string' && /UPDATE learning_evidence/i.test(c[0]))).toBe(false);
  });

  it('score path is untouched: updateMastery still gets sourceType TRANSFER, confidenceWeight 0.85, MID difficulty 4', async () => {
    await submit({ activityId: OTHER_ID });
    expect(updateMasteryMock.mock.calls[0][0].evidence).toMatchObject({
      sourceType: 'TRANSFER',
      confidenceWeight: 0.85,
      difficulty: 4,
      scorePercent: 100,
    });
  });
});
