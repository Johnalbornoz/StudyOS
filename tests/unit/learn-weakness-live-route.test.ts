/**
 * Requirement §22 -- LIVE_PROMPT path: a verified v1 topic_practice whose delivery needs an emergency live generation
 * (bank / READY inventory short) carries the latest LEARN weaknesses into the generator guidance via the shared
 * accessor, and records `learnWeaknessProvenance` on the session it creates. Route-level, mocked DB, no provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  evidenceRows: [] as any[],
  queries: [] as Array<{ sql: string; params: any[] }>,
  practiceGen: vi.fn(),
  gatedBatch: vi.fn(),
  storeQuiz: vi.fn(),
  deliver: vi.fn(),
  marker: vi.fn(),
}));

function fakeQuery(sql: string, params: any[] = []): any {
  const s = sql.replace(/\s+/g, ' ').trim();
  h.queries.push({ sql: s, params });
  if (/FROM learning_evidence WHERE student_id = \$1 AND concept_id = \$2 AND source_type = \$3/.test(s)) return { rows: h.evidenceRows };
  return { rows: [], rowCount: 0 };
}
vi.mock('@/lib/db', () => ({
  db: { query: async (sql: string, p?: any[]) => fakeQuery(sql, p), connect: async () => ({ query: async (sql: string, p?: any[]) => fakeQuery(sql, p), release: () => {} }) },
  query: async (sql: string, p?: any[]) => fakeQuery(sql, p),
}));
vi.mock('@/lib/auth', () => ({
  verifyAuth: async () => ({ userId: 'clerk-1', role: 'student' }),
  verifyStudentAccess: async () => true,
  verifySubjectAccess: async () => true,
  verifyConceptsAccess: async () => true,
  verifyDiagnosisAccess: async () => true,
  verifyRemediationStepAccess: async () => true,
  checkRateLimit: () => true,
}));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: async () => ({ id: 'user-1', status: 'ACTIVE' }) }));
vi.mock('@/lib/entitlements', () => ({ canUseCapability: async () => true }));
vi.mock('@/lib/pedagogical-decision', async (orig) => ({
  ...(await orig<typeof import('@/lib/pedagogical-decision')>()),
  isCanonicalEngineV1Enabled: () => true,
  verifyV1PracticeLaunchMarker: (...a: any[]) => h.marker(...a),
}));
vi.mock('@/services/activity-delivery.service', () => ({
  buildDeliveryInput: async (p: any) => ({ ...p, contract: { conceptId: p.conceptId, activityType: p.activityType, language: p.language, itemCount: p.itemCount }, academic: {} }),
  deliverCanonicalActivity: (...a: any[]) => h.deliver(...a),
  completeEmergencyDelivery: async () => {},
  logActivityLaunch: () => ({ aiCalls: 0, hotPathAiViolation: false }),
}));
vi.mock('@/services/activity-candidate-generation.service', () => ({ questionGeneratorIdentity: () => ({ provider: null, model: null, promptId: null, promptVersion: 'x', operationId: null }) }));
vi.mock('@/services/subject-generation-context.service', () => ({ getSubjectIBContext: async () => null, resolveLanguageForSubject: async () => 'es' }));
vi.mock('@/services/knowledge-state.service', () => ({
  getActiveMasteryPolicy: async () => { throw new Error('not needed'); },
  getConceptKnowledgeState: async () => null,
}));
vi.mock('@/services/ask-confidence.service', () => ({ computeAskConfidenceFlags: async () => new Map() }));
vi.mock('@/services/quiz-generation.service', async (orig) => ({
  ...(await orig<typeof import('@/services/quiz-generation.service')>()),
  generatePracticeQuestions: (...a: any[]) => h.practiceGen(...a),
}));
vi.mock('@/services/gated-question-generation.service', async (orig) => ({
  ...(await orig<typeof import('@/services/gated-question-generation.service')>()),
  generateGatedQuestionBatch: (...a: any[]) => h.gatedBatch(...a),
}));
vi.mock('@/services/quiz-persistence.service', async (orig) => ({
  ...(await orig<typeof import('@/services/quiz-persistence.service')>()),
  storeQuiz: (...a: any[]) => h.storeQuiz(...a),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/quizzes/generate-and-take/route';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '33333333-3333-4333-8333-333333333333';
const CONCEPT = '44444444-4444-4444-8444-444444444444';
const WEAKNESS = 'confunde numerador y denominador al simplificar fracciones';
const MARKER = {
  pedagogicalPolicyVersion: 'studyus-canonical-v1', canonicalRevision: 'r', canonicalStage: 'PRACTICE', canonicalActivityType: 'PRACTICE',
  itemCount: { min: 3, max: 3, authorized: 3 }, difficulty: { min: 2, max: 4, target: 3 }, assistanceAllowed: true, independence: false, supportLevel: 'ASSISTED', minimumScorePercent: 80,
};
const Q = (id: string, question: string): any => ({ id, conceptId: CONCEPT, type: 'short_answer', answerFormat: 'text', difficulty: 3, question, correctAnswer: 'x', explanation: 'e' });

const post = (body: object) =>
  POST(new NextRequest('http://localhost/api/quizzes/generate-and-take', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
const provenanceWrites = () =>
  h.queries.filter((q) => q.sql.startsWith('UPDATE quiz_sessions SET canonical_activity_contract = canonical_activity_contract ||')).map((q) => ({ quizId: q.params[0], provenance: JSON.parse(q.params[1]) }));

beforeEach(() => {
  h.queries = [];
  h.evidenceRows = [{ id: 'ev-learn-1', metadata: { activityType: 'LEARN_CHECK', learnSession: { version: 'learn-guided-v1', interactionCount: 5, closedBy: 'AI', weaknesses: [WEAKNESS], misconceptionIds: ['mis-frac-1'] } } }];
  h.marker.mockReset().mockResolvedValue(MARKER);
  h.deliver.mockReset().mockResolvedValue({ status: 'EMERGENCY_REQUIRED', lock: { release: async () => {} }, timings: {}, bank: { available: 0, needed: 3 } });
  h.practiceGen.mockReset().mockResolvedValue([
    Q('g1', '¿Qué parte de la fracción es el numerador?'),
    Q('g2', 'Simplifica 6/8 y explica qué ocurre con el numerador y el denominador.'),
    Q('g3', '¿Cuál es el doble de 7?'),
  ]);
  h.gatedBatch.mockReset().mockResolvedValue([Q('d1', 'diag uno'), Q('d2', 'diag dos'), Q('d3', 'diag tres')]);
  h.storeQuiz.mockReset().mockResolvedValue('quiz-live-1');
});

describe('LIVE_PROMPT -- emergency live generation of a canonical Practice', () => {
  it('the LEARN weakness reaches the generator guidance and the session records provenance', async () => {
    const res = await post({ studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, quizMode: 'topic_practice', v1Launch: true, language: 'es' });
    expect(res.status).toBe(200);
    expect(h.practiceGen).toHaveBeenCalledTimes(1);
    const guidance = h.practiceGen.mock.calls[0][3].guidance as string;
    expect(guidance.startsWith(QUIZ_MODE_CONFIG.topic_practice.guidance)).toBe(true);
    expect(guidance).toContain(`- ${WEAKNESS}`);
    // misconception ids are catalog ids, never prompt text
    expect(guidance).not.toContain('mis-frac-1');
    expect(provenanceWrites()).toEqual([
      {
        quizId: 'quiz-live-1',
        provenance: {
          version: 'learn-weakness-provenance-v1', learnEvidenceIds: ['ev-learn-1'], weaknesses: [WEAKNESS], misconceptionIds: ['mis-frac-1'],
          appliedVia: 'LIVE_PROMPT', matchedItemIds: ['g2'],
        },
      },
    ]);
  });

  it('no LEARN session -> guidance byte-identical, no provenance', async () => {
    h.evidenceRows = [];
    const res = await post({ studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, quizMode: 'topic_practice', v1Launch: true, language: 'es' });
    expect(res.status).toBe(200);
    expect(h.practiceGen.mock.calls[0][3].guidance).toBe(QUIZ_MODE_CONFIG.topic_practice.guidance);
    expect(provenanceWrites()).toEqual([]);
  });

  it('a non-Practice mode (diagnostic) never reads the LEARN focus nor receives it', async () => {
    h.marker.mockResolvedValue(null);
    const res = await post({ studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, quizMode: 'diagnostic_check', language: 'es' });
    expect(res.status).toBe(200);
    expect(h.queries.some((q) => /FROM learning_evidence WHERE student_id = \$1 AND concept_id = \$2 AND source_type = \$3/.test(q.sql))).toBe(false);
    expect(JSON.stringify(h.gatedBatch.mock.calls)).not.toContain(WEAKNESS);
    expect(provenanceWrites()).toEqual([]);
  });
});
