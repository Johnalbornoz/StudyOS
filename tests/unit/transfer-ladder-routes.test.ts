/**
 * APPLY routes -- authorization and boundaries of POST /api/learning/apply/start and
 * POST /api/learning/apply/answer. The REAL service runs; only IO (auth, decision, DB store,
 * provider calls, evidence write) is replaced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '44444444-4444-4444-8444-444444444444';
const CONCEPT = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '33333333-3333-4333-8333-333333333333';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: (...a: any[]) => verifyAuthMock(...a),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const decisionMock = vi.fn();
const gateMock = vi.fn();
const ownedMock = vi.fn();
vi.mock('@/lib/pedagogical-decision', () => {
  class CanonicalDecisionUnavailableError extends Error {}
  return {
    CanonicalDecisionUnavailableError,
    isCanonicalEngineV1Enabled: () => gateMock(),
    getCanonicalPedagogicalDecision: (...a: any[]) => decisionMock(...a),
    resolveConceptSubjectForStudent: (...a: any[]) => ownedMock(...a),
  };
});

const licenceMock = vi.fn();
vi.mock('@/lib/entitlements/learning-gate', () => ({ learningLicenceRequiredResponse: (...a: any[]) => licenceMock(...a) }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: async () => 'es' }));
vi.mock('@/lib/observability/operational-log', () => ({ logOperationalWarning: vi.fn() }));

const safetyMock = vi.fn();
vi.mock('@/lib/safety/safety-route', () => ({
  studentTextSafetyResponse: (...a: any[]) => safetyMock(...a),
  safetyResponseForError: async () => null,
}));

const generateMock = vi.fn();
vi.mock('@/services/transfer.service', () => ({ generateStructuredTransferActivity: (...a: any[]) => generateMock(...a) }));
vi.mock('@/services/transfer-novelty.service', async (orig) => ({ ...(await orig<any>()), getRecentTransferFingerprints: async () => [] }));
vi.mock('@/services/transfer-task-instance.service', () => ({
  getRecentTransferTaskFingerprints: async () => [],
  persistTransferTaskInstance: async () => undefined,
  resolveKnownConceptIds: async () => [],
}));
const gradeMock = vi.fn();
vi.mock('@/lib/quiz/grade-question', () => ({ gradeQuizAnswer: (...a: any[]) => gradeMock(...a) }));
const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => updateMasteryMock(...a) }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_op: string, h: any) => h }));

// In-memory quiz_sessions substitute for the ladder store.
const rows = new Map<string, any>();
vi.mock('@/services/transfer-ladder-session.store', () => ({
  createDbTransferLadderStore: () => ({
    async create({ id, studentId, conceptId, subjectId, language, state }: any) {
      rows.set(id, { id, studentId, conceptId, subjectId, language, status: 'active', isExpired: false, state: structuredClone(state) });
    },
    async findActive(studentId: string, conceptId: string) {
      for (const r of rows.values()) if (r.studentId === studentId && r.conceptId === conceptId && r.status === 'active') return structuredClone(r);
      return null;
    },
    async load(id: string) {
      return rows.has(id) ? structuredClone(rows.get(id)) : null;
    },
    async save(id: string, state: any, rev: number) {
      const r = rows.get(id);
      if (!r || r.state.revision !== rev) return false;
      r.state = structuredClone(state);
      return true;
    },
    async complete(id: string) {
      rows.get(id).status = 'completed';
    },
    async markExpired(id: string) {
      rows.get(id).status = 'expired';
    },
    async conceptLabel() {
      return 'Concept';
    },
  }),
}));

import { POST as START } from '@/app/api/learning/apply/start/route';
import { POST as ANSWER } from '@/app/api/learning/apply/answer/route';

function req(body: unknown) {
  return { json: async () => body } as any;
}

let gen = 0;
beforeEach(() => {
  rows.clear();
  gen = 0;
  vi.clearAllMocks();
  verifyAuthMock.mockResolvedValue({ userId: 'clerk-1', role: 'STUDENT', email: null });
  verifyStudentAccessMock.mockImplementation(async (_u: string, sid: string) => sid === STUDENT);
  gateMock.mockReturnValue(true);
  decisionMock.mockResolvedValue({ decision: { stage: 'TRANSFER', actionState: 'EXECUTABLE', canonicalRevision: 'rev' } });
  ownedMock.mockResolvedValue({ subjectId: SUBJECT });
  licenceMock.mockResolvedValue(null);
  safetyMock.mockResolvedValue(null);
  generateMock.mockImplementation(async (_l: string, _c: string, level: string) => {
    const i = gen++;
    return {
      distance: level, context: `Ctx ${i}`, prompt: `Prompt ${i} ${'y'.repeat(i + 1)}`,
      noveltyDimensions: level === 'NEAR' ? ['CONTEXT'] : level === 'MID' ? ['REPRESENTATION'] : ['CONSTRAINT'],
      transferModality: 'STRUCTURAL', targetConceptIds: [], contextDomain: `dom-${i}`, generatorPromptVersion: 'v2', modelAnswer: `MA ${i}`,
    };
  });
  gradeMock.mockResolvedValue({ score: 0.9, feedback: 'ok', errorType: null, pedagogical: {}, aiExecution: { aiExecutionId: 'ai' } });
  updateMasteryMock.mockResolvedValue({ oldMastery: 0, newMastery: 1, delta: 1, confidenceScore: 0, eventId: 'e' });
});

const startBody = { studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT };

describe('POST /api/learning/apply/start', () => {
  it('401 without auth, 400 on invalid input, 403 for another learner', async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    expect((await START(req(startBody))).status).toBe(401);
    expect((await START(req({ ...startBody, conceptId: 'nope' }))).status).toBe(400);
    expect((await START(req({ ...startBody, studentId: OTHER }))).status).toBe(403);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('404 when the concept is not the learner\'s or the subject does not match', async () => {
    ownedMock.mockResolvedValueOnce(null);
    expect((await START(req(startBody))).status).toBe(404);
    ownedMock.mockResolvedValueOnce({ subjectId: '55555555-5555-4555-8555-555555555555' });
    expect((await START(req(startBody))).status).toBe(404);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('409 TRANSFER_NOT_AUTHORIZED unless the fresh canonical decision is TRANSFER + EXECUTABLE (zero AI calls)', async () => {
    for (const d of [
      { stage: 'RETAIN', actionState: 'EXECUTABLE' },
      { stage: 'TRANSFER', actionState: 'WAITING' },
      { stage: 'TRANSFER', actionState: 'BLOCKED' },
      { stage: 'CONSOLIDATED', actionState: 'CONSOLIDATED' },
    ]) {
      decisionMock.mockResolvedValueOnce({ decision: { ...d, canonicalRevision: 'r' } });
      const res = await START(req(startBody));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('TRANSFER_NOT_AUTHORIZED');
    }
    gateMock.mockReturnValueOnce(false);
    expect((await START(req(startBody))).status).toBe(409);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('starting requires the learning licence (plainly PAID); an open attempt resumes without a second generation', async () => {
    licenceMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'ENTITLEMENT_REQUIRED' }), { status: 403 }));
    expect((await START(req(startBody))).status).toBe(403);
    expect(generateMock).not.toHaveBeenCalled();

    const ok = await START(req(startBody));
    expect(ok.status).toBe(200);
    const view = (await ok.json()).data;
    expect(view.pending.level).toBe('NEAR');
    expect(JSON.stringify(view)).not.toContain('MA 0'); // no model answer while open

    // resume: same session, same pending challenge, the decision is not re-consulted for an open attempt
    decisionMock.mockResolvedValue({ decision: { stage: 'RETAIN', actionState: 'WAITING', canonicalRevision: 'r' } });
    const resumed = await START(req(startBody));
    expect(resumed.status).toBe(200);
    const again = (await resumed.json()).data;
    expect(again.sessionId).toBe(view.sessionId);
    expect(again.pending.taskId).toBe(view.pending.taskId);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('the client cannot choose a level: an extra "distance" field is ignored, the first challenge is NEAR', async () => {
    const res = await START(req({ ...startBody, distance: 'FAR', level: 'FAR' }));
    expect((await res.json()).data.pending.level).toBe('NEAR');
    expect(generateMock.mock.calls[0][2]).toBe('NEAR');
  });
});

describe('POST /api/learning/apply/answer', () => {
  async function started() {
    return (await (await START(req(startBody))).json()).data;
  }

  it('404 for a session that is not the learner\'s; 403 for another learner id', async () => {
    const v = await started();
    rows.get(v.sessionId).studentId = OTHER;
    expect((await ANSWER(req({ studentId: STUDENT, sessionId: v.sessionId, answer: 'x' }))).status).toBe(404);
    expect((await ANSWER(req({ studentId: OTHER, sessionId: v.sessionId, answer: 'x' }))).status).toBe(403);
    expect(gradeMock).not.toHaveBeenCalled();
  });

  it('the safety gate runs before grading', async () => {
    const v = await started();
    safetyMock.mockResolvedValueOnce(new Response('{}', { status: 422 }));
    expect((await ANSWER(req({ studentId: STUDENT, sessionId: v.sessionId, answer: 'x' }))).status).toBe(422);
    expect(gradeMock).not.toHaveBeenCalled();
  });

  it('grades with the canonical grader in INDEPENDENT mode, moves up on pass, and writes ONE evidence row at the end', async () => {
    let v = await started();
    const levels: string[] = [];
    for (let i = 0; i < 3; i++) {
      levels.push(v.pending.level);
      const res = await ANSWER(req({ studentId: STUDENT, sessionId: v.sessionId, answer: 'answer' }));
      expect(res.status).toBe(200);
      const body = (await res.json()).data;
      expect(body.result.passed).toBe(true);
      v = body.view;
    }
    expect(levels).toEqual(['NEAR', 'MID', 'FAR']);
    expect(v.summary.highestLevelReached).toBe('FAR');
    expect(gradeMock.mock.calls.every((c) => c[3] === 'INDEPENDENT')).toBe(true);
    expect(gradeMock.mock.calls[0][0]).toMatchObject({ answerFormat: 'text', correctAnswer: 'MA 0' });
    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
    expect(updateMasteryMock.mock.calls[0][0].metadata.transferLadder.highestLevelReached).toBe('FAR');
    // completed: a further answer is refused
    expect((await ANSWER(req({ studentId: STUDENT, sessionId: v.sessionId, answer: 'x' }))).status).toBe(409);
  });

  it('410 for an expired attempt, no evidence', async () => {
    const v = await started();
    rows.get(v.sessionId).isExpired = true;
    expect((await ANSWER(req({ studentId: STUDENT, sessionId: v.sessionId, answer: 'x' }))).status).toBe(410);
    expect(updateMasteryMock).not.toHaveBeenCalled();
  });
});
