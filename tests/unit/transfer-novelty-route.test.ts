/**
 * Phase 7 -- Steps 7B2 / 7D1 / 7D2: generate/submit route wiring.
 *
 * generate (7B2): bounded regeneration on a recent structural duplicate,
 * then fail-closed 409 with one terminal WARN and no AI calls beyond the
 * cap.
 * generate (7D1): structured candidate, one persisted
 * transfer_task_instances row per served task, raw novelty metadata not
 * leaked to the client, typed 503 on any AI failure.
 * generate (7D2): deterministic server-side novelty certification --
 * novelty_validation_passed is written true ONLY when the certifier
 * passes; an uncertified-but-unique task is still served (persisted
 * false, one WARN); target concepts are resolved in ONE batched query.
 * submit: a DIFFERENT taskId re-submitting a recent duplicate
 * fingerprint is rejected 409 before evaluateTransferResponse/
 * updateMastery; the SAME taskId (idempotent resubmit) is unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

/** 7D1: shape a structured-candidate mock result from just a prompt. */
const candidate = (prompt: string, over: Record<string, unknown> = {}) => ({
  distance: 'MID',
  context: 'c',
  prompt,
  noveltyDimensions: ['STRATEGY'],
  transferModality: 'STRUCTURAL',
  targetConceptIds: [],
  contextDomain: 'sports',
  generatorPromptVersion: 'v2',
  ...over,
});

const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => updateMasteryMock(...a) }));
vi.mock('@/services/remediation.service', () => ({ completeRemediationStep: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { POST as GENERATE } from '@/app/api/cognitive/transfer/generate/route';
import { POST as SUBMIT } from '@/app/api/cognitive/transfer/submit/route';
import { computeTransferPromptFingerprint, computeTransferPromptExactHash } from '@/lib/transfer-task-identity';

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

/** rows keyed for the transfer_task_instances load (7D3). */
let taskInstanceRows: Record<string, any> = {};
function setTaskInstance(id: string, row: Record<string, any> | null) {
  if (row === null) delete taskInstanceRows[id];
  else taskInstanceRows[id] = row;
}
/** Build a plausible persisted transfer_task_instances row for `prompt`. */
function instanceRow(over: Record<string, any> = {}) {
  return {
    id: TASK_B,
    student_id: STUDENT,
    concept_id: CONCEPT,
    subject_id: SUBJECT,
    transfer_distance: 'MID',
    transfer_modality: 'STRUCTURAL',
    novelty_dimensions: ['STRATEGY'],
    target_concept_ids: [],
    context_domain: 'sports',
    task_family_id: 'fam-1',
    prompt_fingerprint: SEEN_FP,
    prompt_exact_hash: computeTransferPromptExactHash(SEEN_PROMPT),
    generator_version: null,
    generator_prompt_version: 'v2',
    novelty_validation_passed: true,
    created_at: new Date('2026-09-05T00:00:00Z'),
    ...over,
  };
}

/** dbQuery: recent-fingerprints SELECT -> given rows; task-instance load -> map; anything else -> {rows:[]}. */
function withRecentEvidence(rows: any[]) {
  dbQueryMock.mockImplementation(async (sql: string, params?: any[]) => {
    if (typeof sql === 'string' && sql.includes("source_type = 'TRANSFER'") && sql.includes('ORDER BY timestamp DESC')) {
      return { rows };
    }
    if (typeof sql === 'string' && /FROM transfer_task_instances WHERE id = \$1/.test(sql)) {
      const row = params && taskInstanceRows[params[0]];
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  });
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  generateStructuredTransferActivityMock.mockReset();
  evaluateTransferResponseMock.mockReset().mockResolvedValue({ result: 'correct', feedback: 'ok', aiExecution: { aiExecutionId: 'ai-1' } });
  updateMasteryMock.mockReset().mockResolvedValue({ duplicate: false, oldMastery: 10, newMastery: 20, delta: 10 });
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  taskInstanceRows = {};
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

const opsWarns = () => (warnSpy.mock.calls as any[][]).filter((c) => c[0] === '[ops]').map((c) => JSON.parse(c[1] as string));

describe('7B2/7D1 -- generate route', () => {
  it('unseen candidate: 1 AI call, minted id, activityId alias, fingerprint recomputed server-side', async () => {
    withRecentEvidence([]);
    generateStructuredTransferActivityMock.mockResolvedValue(candidate(NEW_PROMPT));
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    expect(res.status ?? 200).toBe(200);
    expect(generateStructuredTransferActivityMock).toHaveBeenCalledTimes(1);
    expect(body.data.transferTaskId).toMatch(UUID_RE);
    expect(body.data.activityId).toBe(body.data.transferTaskId);
    expect(body.data.promptFingerprint).toBe(computeTransferPromptFingerprint(NEW_PROMPT));
    // 7D1: raw server-only novelty metadata is NOT leaked to the client
    expect(body.data).not.toHaveProperty('noveltyDimensions');
    expect(body.data).not.toHaveProperty('transferModality');
    expect(body.data).not.toHaveProperty('taskFamilyId');
    expect(body.data).not.toHaveProperty('promptExactHash');
    expect(opsWarns()).toHaveLength(0);
  });

  it('7D2: a certifiable candidate persists exactly one row with novelty_validation_passed = true, no uncertified WARN', async () => {
    withRecentEvidence([]);
    generateStructuredTransferActivityMock.mockResolvedValue(candidate(NEW_PROMPT)); // MID + STRATEGY, unique
    const res = await GENERATE(req({ studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    const inserts = dbQueryMock.mock.calls.filter((c) => /INSERT INTO transfer_task_instances/i.test(String(c[0])));
    expect(inserts).toHaveLength(1);
    const params = inserts[0][1] as any[];
    expect(params[0]).toBe(body.data.transferTaskId); // id == minted transferTaskId
    expect(params[1]).toBe(STUDENT);
    expect(params[2]).toBe(CONCEPT);
    expect(params[params.length - 1]).toBe(true); // novelty_validation_passed
    expect(generateStructuredTransferActivityMock).toHaveBeenCalledTimes(1);
    expect(opsWarns()).toHaveLength(0);
    // empty targetConceptIds -> no target-resolution query at all
    expect(dbQueryMock.mock.calls.some((c) => /FROM concepts WHERE id = ANY/i.test(String(c[0])))).toBe(false);
  });

  it('7D2: a structurally-unique but non-certifying candidate is still served, persisted false, with one certify WARN', async () => {
    withRecentEvidence([]);
    // MID task that only varies CONTEXT -> DISTANCE_NOVELTY_MISMATCH; both attempts identical
    generateStructuredTransferActivityMock.mockResolvedValue(candidate(NEW_PROMPT, { noveltyDimensions: ['CONTEXT'] }));
    const res = await GENERATE(req({ studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    expect(res.status ?? 200).toBe(200);
    expect(body.data.transferTaskId).toMatch(UUID_RE);
    expect(generateStructuredTransferActivityMock).toHaveBeenCalledTimes(2); // spent the spare call trying to certify
    const inserts = dbQueryMock.mock.calls.filter((c) => /INSERT INTO transfer_task_instances/i.test(String(c[0])));
    expect(inserts).toHaveLength(1);
    expect((inserts[0][1] as any[])[inserts[0][1].length - 1]).toBe(false); // novelty_validation_passed
    const warns = opsWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ subsystem: 'transfer', operation: 'certifyStructuredTransferNovelty', conceptId: CONCEPT });
    const raw = (warnSpy.mock.calls as any[][]).find((c) => c[0] === '[ops]')![1] as string;
    expect(raw).not.toContain(STUDENT);
    expect(raw).not.toContain(NEW_PROMPT);
  });

  it('7D2: target concepts are resolved in ONE batched query; unresolved -> not certified', async () => {
    const TARGET = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && /FROM concepts WHERE id = ANY/i.test(sql)) return { rows: [] }; // none resolve
      return { rows: [] };
    });
    generateStructuredTransferActivityMock.mockResolvedValue(
      candidate(NEW_PROMPT, { distance: 'FAR', noveltyDimensions: ['CONCEPT_COMBINATION'], targetConceptIds: [TARGET] }),
    );
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'FAR' }));
    const body = await res.json();
    expect(res.status ?? 200).toBe(200);
    const conceptResolveCalls = dbQueryMock.mock.calls.filter((c) => /FROM concepts WHERE id = ANY/i.test(String(c[0])));
    expect(conceptResolveCalls.length).toBe(2); // one per AI attempt, never one-per-id
    expect(conceptResolveCalls[0][1]).toEqual([[TARGET]]); // batched: array param
    const inserts = dbQueryMock.mock.calls.filter((c) => /INSERT INTO transfer_task_instances/i.test(String(c[0])));
    expect((inserts[0][1] as any[])[inserts[0][1].length - 1]).toBe(false);
  });

  it('7D2: FAR with a resolvable target concept is certified (persisted true)', async () => {
    const TARGET = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && /FROM concepts WHERE id = ANY/i.test(sql)) return { rows: [{ id: TARGET }] };
      return { rows: [] };
    });
    generateStructuredTransferActivityMock.mockResolvedValue(
      candidate(NEW_PROMPT, { distance: 'FAR', noveltyDimensions: ['CONCEPT_COMBINATION'], targetConceptIds: [TARGET] }),
    );
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'FAR' }));
    await res.json();
    expect(generateStructuredTransferActivityMock).toHaveBeenCalledTimes(1);
    const inserts = dbQueryMock.mock.calls.filter((c) => /INSERT INTO transfer_task_instances/i.test(String(c[0])));
    expect((inserts[0][1] as any[])[inserts[0][1].length - 1]).toBe(true);
  });

  it('first candidate is a recent duplicate -> regenerates once -> serves the unseen 2nd candidate', async () => {
    withRecentEvidence([{ metadata: { promptFingerprint: SEEN_FP, transferTaskId: TASK_A }, timestamp: 't' }]);
    generateStructuredTransferActivityMock
      .mockResolvedValueOnce(candidate(SEEN_PROMPT)) // duplicate
      .mockResolvedValueOnce(candidate(NEW_PROMPT)); // unseen
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    expect(res.status ?? 200).toBe(200);
    expect(generateStructuredTransferActivityMock).toHaveBeenCalledTimes(2);
    expect(body.data.promptFingerprint).toBe(computeTransferPromptFingerprint(NEW_PROMPT));
    expect(opsWarns()).toHaveLength(0); // recovered -> no terminal warn
    expect(dbQueryMock.mock.calls.filter((c) => String(c[0]).includes("source_type = 'TRANSFER'")).length).toBe(1); // one bounded read reused
  });

  it('terminal duplicate: both candidates duplicate -> 409, exactly 2 AI calls, one WARN, no id, no instance row', async () => {
    withRecentEvidence([{ metadata: { promptFingerprint: SEEN_FP, transferTaskId: TASK_A }, timestamp: 't' }]);
    generateStructuredTransferActivityMock.mockResolvedValue(candidate(SEEN_PROMPT));
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe('TRANSFER_TASK_NOT_NOVEL_ENOUGH');
    expect(body.data).toBeUndefined();
    expect(generateStructuredTransferActivityMock).toHaveBeenCalledTimes(2);
    expect(dbQueryMock.mock.calls.some((c) => /INSERT INTO transfer_task_instances/i.test(String(c[0])))).toBe(false);
    const warns = opsWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ subsystem: 'transfer', operation: 'generateStructuredTransferActivity.novelty', conceptId: CONCEPT, count: 2 });
    const raw = (warnSpy.mock.calls as any[][]).find((c) => c[0] === '[ops]')![1] as string;
    expect(raw).not.toContain(STUDENT);
    expect(raw).not.toContain(SEEN_FP);
  });

  it('every AI failure -> 503 TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE, one WARN, no raw 500, no instance row', async () => {
    withRecentEvidence([]);
    generateStructuredTransferActivityMock.mockRejectedValue(new Error('provider timeout'));
    const res = await GENERATE(req({ studentId: STUDENT, conceptId: CONCEPT, conceptLabel: 'X', distance: 'MID' }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toBe('TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE');
    expect(generateStructuredTransferActivityMock).toHaveBeenCalledTimes(1); // no retry loop
    expect(dbQueryMock.mock.calls.some((c) => /INSERT INTO transfer_task_instances/i.test(String(c[0])))).toBe(false);
    const warns = opsWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ subsystem: 'transfer', operation: 'generateStructuredTransferActivity' });
    const raw = (warnSpy.mock.calls as any[][]).find((c) => c[0] === '[ops]')![1] as string;
    expect(raw).not.toContain(STUDENT);
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
    const { res, body } = await submit({ transferTaskId: TASK_B }); // no instance -> bypass scenario
    expect(res.status).toBe(409);
    expect(body.error).toBe('TRANSFER_TASK_DUPLICATE');
    expect(evaluateTransferResponseMock).not.toHaveBeenCalled();
    expect(updateMasteryMock).not.toHaveBeenCalled();
    expect(opsWarns().some((w) => w.operation === 'submitTransferResponse' && w.conceptId === CONCEPT)).toBe(true);
  });

  it('SAME taskId re-submitting its own fingerprint -> not a structural duplicate, proceeds (idempotency preserved)', async () => {
    withRecentEvidence([{ metadata: { promptFingerprint: SEEN_FP, transferTaskId: TASK_A }, timestamp: 't' }]);
    setTaskInstance(TASK_A, instanceRow({ id: TASK_A }));
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

  it('no recent duplicate, no task instance -> legacy path: identity metadata atomic, NOT phase7-certified', async () => {
    withRecentEvidence([]);
    const { res } = await submit({ transferTaskId: TASK_B });
    expect(res.status ?? 200).toBe(200);
    const meta = updateMasteryMock.mock.calls[0][0].metadata;
    expect(meta).toMatchObject({
      transferTaskId: TASK_B,
      promptFingerprint: SEEN_FP,
      sourceConceptId: CONCEPT,
      transferDistance: 'MID', // client value -- no instance to override it
      assisted: false,
    });
    expect(meta).not.toHaveProperty('noveltyValidationPassed');
    expect(meta).not.toHaveProperty('taskFamilyId');
    expect(opsWarns().some((w) => w.operation === 'submitTransferResponse.taskInstanceMissing')).toBe(true);
    expect(dbQueryMock.mock.calls.some((c) => /UPDATE learning_evidence/i.test(String(c[0])))).toBe(false);
  });
});

describe('7D3 -- submit route trusted task instance', () => {
  it('loads the instance and writes server-trusted phase7-certified metadata atomically into updateMastery', async () => {
    withRecentEvidence([]);
    setTaskInstance(TASK_B, instanceRow({ transfer_distance: 'FAR', novelty_dimensions: ['CONCEPT_COMBINATION'], task_family_id: 'fam-far' }));
    const { res } = await submit({ transferTaskId: TASK_B, distance: 'NEAR' }); // client LIES: says NEAR
    expect(res.status ?? 200).toBe(200);
    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.metadata).toMatchObject({
      transferDistance: 'FAR', // trusted instance value, NOT the client's 'NEAR'
      noveltyValidationPassed: true,
      noveltyDimensions: ['CONCEPT_COMBINATION'],
      transferModality: 'STRUCTURAL',
      taskFamilyId: 'fam-far',
      promptExactHash: computeTransferPromptExactHash(SEEN_PROMPT),
      contextDomain: 'sports',
    });
    expect(call.evidence.difficulty).toBe(5); // FAR difficulty, from the trusted distance
  });

  it('rejects a prompt that is not byte-identical to the generated one, BEFORE grading or mastery', async () => {
    withRecentEvidence([]);
    setTaskInstance(TASK_B, instanceRow({ prompt_exact_hash: computeTransferPromptExactHash('a completely different prompt') }));
    const { res, body } = await submit({ transferTaskId: TASK_B });
    expect(res.status).toBe(409);
    expect(body.error).toBe('TRANSFER_TASK_PROMPT_MISMATCH');
    expect(evaluateTransferResponseMock).not.toHaveBeenCalled();
    expect(updateMasteryMock).not.toHaveBeenCalled();
    expect(opsWarns().some((w) => w.operation === 'submitTransferResponse.promptExactHash')).toBe(true);
  });

  it('rejects an instance that belongs to a different student/concept', async () => {
    withRecentEvidence([]);
    setTaskInstance(TASK_B, instanceRow({ student_id: '99999999-9999-4999-8999-999999999999' }));
    const { res, body } = await submit({ transferTaskId: TASK_B });
    expect(res.status).toBe(409);
    expect(body.error).toBe('TRANSFER_TASK_MISMATCH');
    expect(updateMasteryMock).not.toHaveBeenCalled();
  });

  it('an uncertified instance (novelty_validation_passed = false) still submits, metadata carries the false flag', async () => {
    withRecentEvidence([]);
    setTaskInstance(TASK_B, instanceRow({ novelty_validation_passed: false }));
    const { res } = await submit({ transferTaskId: TASK_B });
    expect(res.status ?? 200).toBe(200);
    expect(updateMasteryMock.mock.calls[0][0].metadata.noveltyValidationPassed).toBe(false);
  });
});
