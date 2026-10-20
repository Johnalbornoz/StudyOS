/**
 * LEARN guided understanding -- route authorization and the server-enforced loop (start/turn), with an
 * in-memory quiz_sessions / learning_evidence and a scripted model. The real provider run is the DEV scenario
 * (scripts/operations/learn-guided-scenario.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  isOwner: vi.fn(),
  subjectOwned: vi.fn(),
  conceptOwned: vi.fn(),
  gate: vi.fn(),
  marker: vi.fn(),
  model: vi.fn(),
  sessions: new Map<string, any>(),
  evidence: [] as any[],
  aiCalls: 0,
}));

vi.mock('@/lib/auth', () => ({ verifyAuth: h.verifyAuth, checkRateLimit: () => true, verifySubjectAccess: h.subjectOwned, verifyConceptsAccess: h.conceptOwned }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: async () => ({ id: 'user-1', status: 'ACTIVE' }) }));
vi.mock('@/lib/authorization', () => ({ isOwner: h.isOwner }));
vi.mock('@/lib/entitlements/learning-gate', () => ({ learningLicenceRequiredResponseForActor: async () => null }));
vi.mock('@/lib/ai/instructional-assistance-guard', () => ({ instructionalAssistanceLockedResponse: async () => null }));
vi.mock('@/lib/safety/safety-route', () => ({ studentTextSafetyResponse: async () => null }));
vi.mock('@/services/subject-generation-context.service', () => ({ resolveLanguageForSubject: async () => 'es' }));
vi.mock('@/lib/pedagogical-decision/feature-gate', () => ({ isCanonicalEngineV1Enabled: h.gate }));
vi.mock('@/lib/pedagogical-decision/v1-practice-launch-marker', () => ({ verifyV1PracticeLaunchMarker: h.marker }));
vi.mock('@/services/rag.service', () => ({ retrieveContext: async () => ({ chunks: [] }) }));
vi.mock('@/lib/quiz/grade-question', () => ({
  gradeQuizAnswer: async (q: any, answer: string) => ({ correct: answer === q.correctAnswer, score: answer === q.correctAnswer ? 1 : 0, feedback: '', pedagogical: undefined }),
}));
vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai')>()),
  executeAI: async () => {
    h.aiCalls += 1;
    return { result: h.model() };
  },
}));

function fakeQuery(sql: string, p: any[] = []): any {
  const s = sql.replace(/\s+/g, ' ');
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [], rowCount: 0 };
  if (/FROM concepts c JOIN subjects s/.test(s)) return { rows: [{ label: 'Fracciones', subject_name: 'Matemáticas' }] };
  if (/FROM misconception_signatures/.test(s)) return { rows: [] };
  const view = (r: any) => ({ ...r, questions: JSON.parse(JSON.stringify(r.questions)), expired: false });
  if (/FROM quiz_sessions WHERE id = \$1 AND student_id = \$2/.test(s)) {
    const r = h.sessions.get(p[0]);
    return { rows: r && r.student_id === p[1] && r.quiz_mode === p[2] ? [view(r)] : [] };
  }
  if (/FROM quiz_sessions WHERE student_id = \$1 AND concept_id = \$2/.test(s)) {
    const r = [...h.sessions.values()].reverse().find((x) => x.student_id === p[0] && x.concept_id === p[1] && x.quiz_mode === p[2] && x.status === 'active');
    return { rows: r ? [view(r)] : [] };
  }
  if (/^INSERT INTO quiz_sessions/.test(s.trim())) {
    h.sessions.set(p[0], { id: p[0], student_id: p[1], concept_id: p[2], subject_id: p[3], questions: JSON.parse(p[4]), language: p[5], quiz_mode: p[7], status: 'active', pedagogical_policy_version: p[8], canonical_revision: p[9], canonical_stage: p[10] });
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE quiz_sessions SET status = 'expired'/.test(s)) return { rows: [], rowCount: 0 };
  if (/UPDATE quiz_sessions SET questions/.test(s)) {
    const r = h.sessions.get(p[0]);
    if (!r || r.status !== 'active' || r.questions.length !== p[3]) return { rows: [], rowCount: 0 };
    r.questions = JSON.parse(p[1]);
    r.status = p[2];
    return { rows: [], rowCount: 1 };
  }
  if (/^INSERT INTO learning_evidence/.test(s.trim())) {
    if (h.evidence.some((e) => e.operation_key === p[12])) return { rows: [] };
    const row = { id: `ev-${h.evidence.length + 1}`, student_id: p[0], concept_id: p[1], source_type: p[2], result: p[3], score_percent: p[10], ai_assistance_type: p[9], activity_type: p[6], metadata: JSON.parse(p[11]), operation_key: p[12] };
    h.evidence.push(row);
    return { rows: [{ id: row.id }] };
  }
  if (/FROM learning_evidence WHERE operation_key = \$1/.test(s)) return { rows: h.evidence.filter((e) => e.operation_key === p[0]).map((e) => ({ id: e.id })) };
  if (/FROM learning_evidence WHERE student_id = \$1 AND concept_id = \$2 AND source_type = \$3/.test(s)) {
    const rows = h.evidence.filter((e) => e.student_id === p[0] && e.concept_id === p[1] && e.source_type === p[2]);
    return { rows: rows.slice(-1).map((e) => ({ metadata: e.metadata })) };
  }
  throw new Error(`unexpected SQL: ${s.slice(0, 120)}`);
}
vi.mock('@/lib/db', () => ({
  db: { query: async (sql: string, p?: any[]) => fakeQuery(sql, p), connect: async () => ({ query: async (sql: string, p?: any[]) => fakeQuery(sql, p), release: () => {} }) },
  query: async (sql: string, p?: any[]) => fakeQuery(sql, p),
}));

import { POST as START } from '@/app/api/learning/guided-understanding/start/route';
import { POST as TURN } from '@/app/api/learning/guided-understanding/turn/route';
import { loadLatestLearnWeaknesses } from '@/services/learn-guided.service';
import { NextRequest } from 'next/server';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '33333333-3333-4333-8333-333333333333';
const CONCEPT = '44444444-4444-4444-8444-444444444444';
const LEARN_MARKER = { pedagogicalPolicyVersion: 'pv', canonicalRevision: 'rev', canonicalStage: 'LEARN', canonicalActivityType: 'LEARN_CHECK', itemCount: null, difficulty: { min: 1, max: 3, target: 2 }, assistanceAllowed: true, independence: false, supportLevel: 'ASSISTED', minimumScorePercent: 80 };
const NEXT = { type: 'multiple_choice', question: '¿Cuál es la fracción equivalente?', options: [{ id: 'A', text: '2/4' }, { id: 'B', text: '3/4' }, { id: 'C', text: '1/3' }, { id: 'D', text: '5/6' }], correctAnswer: 'A', explanation: '1/2 = 2/4', difficulty: 2 };
const output = (over: Record<string, unknown> = {}) => ({
  feedback: { whatWasWrong: 'w', misconception: 'm', reinforcement: 'La idea clave.', extraContext: null },
  weakness: null, misconceptionId: null, closeRecommended: false, closingMessage: null, nextInteraction: NEXT, ...over,
});
const req = (path: string, body: unknown) => new NextRequest(`https://dev.test${path}`, { method: 'POST', body: JSON.stringify(body) });
const start = (body: Record<string, unknown> = {}) => START(req('/api/learning/guided-understanding/start', { studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, ...body }));
const turn = (sessionId: string, answer: string, studentId = STUDENT) => TURN(req('/api/learning/guided-understanding/turn', { studentId, sessionId, answer }));

beforeEach(() => {
  h.sessions.clear();
  h.evidence.length = 0;
  h.aiCalls = 0;
  h.verifyAuth.mockResolvedValue({ userId: 'clerk_1', email: 'a@example.test', role: 'student' });
  h.isOwner.mockResolvedValue(true);
  h.subjectOwned.mockResolvedValue(true);
  h.conceptOwned.mockResolvedValue(true);
  h.gate.mockReturnValue(true);
  h.marker.mockResolvedValue(LEARN_MARKER);
  h.model.mockImplementation(() => output());
});

describe('start: authorization', () => {
  it('401 without a session', async () => {
    h.verifyAuth.mockResolvedValue(null);
    expect((await start()).status).toBe(401);
  });
  it('403 FORBIDDEN when the actor is not this Student -- the canonical decision is never consulted', async () => {
    h.isOwner.mockResolvedValue(false);
    const res = await start();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('FORBIDDEN');
    expect(h.marker).not.toHaveBeenCalled();
  });
  it('403 FORBIDDEN for a concept that is not the Student\'s own', async () => {
    h.conceptOwned.mockResolvedValue(false);
    expect((await (await start()).json()).error).toBe('FORBIDDEN');
  });
  it.each([
    ['the canonical engine gate is off', () => h.gate.mockReturnValue(false)],
    ['the fresh decision is not executable / unavailable', () => h.marker.mockResolvedValue(null)],
    ['the fresh decision is PRACTICE, not LEARN', () => h.marker.mockResolvedValue({ ...LEARN_MARKER, canonicalStage: 'PRACTICE', canonicalActivityType: 'PRACTICE' })],
  ])('403 LEARN_NOT_AUTHORIZED when %s -- no model call, no session', async (_label, arrange) => {
    arrange();
    const res = await start();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('LEARN_NOT_AUTHORIZED');
    expect(h.aiCalls).toBe(0);
    expect(h.sessions.size).toBe(0);
  });
  it('authorized: a session with the first interaction -- never the answer key -- and no evidence', async () => {
    const res = await start();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ interactionNumber: 1, answeredCount: 0, minInteractions: 4, maxInteractions: 7, resumed: false });
    expect(JSON.stringify(data)).not.toContain('1/2 = 2/4');
    expect(data.interaction).not.toHaveProperty('correctAnswer');
    const row = h.sessions.get(data.sessionId);
    expect(row).toMatchObject({ quiz_mode: 'learn_guided', status: 'active', canonical_stage: 'LEARN' });
    expect(h.evidence).toHaveLength(0);
  });
  it('a second start resumes the same session (no second model call)', async () => {
    const a = (await (await start()).json()).data;
    const b = (await (await start()).json()).data;
    expect(b.sessionId).toBe(a.sessionId);
    expect(b.resumed).toBe(true);
    expect(h.aiCalls).toBe(1);
  });
});

describe('turn: the server-enforced loop', () => {
  it('another Student\'s session is NOT_FOUND', async () => {
    const { sessionId } = (await (await start()).json()).data;
    const res = await turn(sessionId, 'A', OTHER);
    expect(res.status).toBe(404);
  });
  it('all correct, the AI recommends closing from the first turn: ignored before 4, closes at 4 (AI), one evidence row', async () => {
    h.model.mockImplementation(() => output({ closeRecommended: true, closingMessage: 'Bien hecho.' }));
    const { sessionId } = (await (await start()).json()).data;
    const results: any[] = [];
    for (let i = 0; i < 4; i++) results.push((await (await turn(sessionId, 'A')).json()).data);
    expect(results.slice(0, 3).every((r) => !r.closed && r.nextInteraction)).toBe(true);
    expect(results[3]).toMatchObject({ closed: true, closedBy: 'AI', answeredCount: 4, nextInteraction: null, closingMessage: 'Bien hecho.' });
    expect(results[0].feedback).toMatchObject({ verdict: 'CORRECT', whatWasWrong: null, misconception: null });
    expect(h.evidence).toHaveLength(1);
    expect(h.evidence[0]).toMatchObject({ source_type: 'LEARN_GUIDED', ai_assistance_type: 'TUTOR_GUIDANCE', operation_key: `LEARN_GUIDED:${sessionId}` });
    expect(h.evidence[0].metadata.learnSession).toEqual({ version: 'learn-guided-v1', interactionCount: 4, closedBy: 'AI', weaknesses: [] });
    expect(h.evidence[0].metadata).toMatchObject({ activityType: 'LEARN_CHECK', evidenceMode: 'PRACTICE', independenceEligible: false });
    // a retried final turn returns the stored outcome, never a second row
    const again = (await (await turn(sessionId, 'A')).json()).data;
    expect(again).toMatchObject({ closed: true, alreadyClosed: true, closedBy: 'AI' });
    expect(h.evidence).toHaveLength(1);
  });
  it('wrong answers extend the session; all wrong -> CAP at 7, weaknesses kept and carried to PRACTICE', async () => {
    h.model.mockImplementation(() => output({ closeRecommended: true, weakness: 'confunde numerador y denominador' }));
    const { sessionId } = (await (await start()).json()).data;
    const results: any[] = [];
    for (let i = 0; i < 7; i++) results.push((await (await turn(sessionId, 'B')).json()).data);
    expect(results.slice(0, 6).every((r) => !r.closed)).toBe(true);
    expect(results[6]).toMatchObject({ closed: true, closedBy: 'CAP', answeredCount: 7, weaknesses: ['confunde numerador y denominador'] });
    expect(results[0].feedback).toMatchObject({ verdict: 'INCORRECT', whatWasWrong: 'w', misconception: 'm', explanation: '1/2 = 2/4' });
    expect(h.evidence).toHaveLength(1);
    expect(h.evidence[0].metadata.learnSession).toMatchObject({ interactionCount: 7, closedBy: 'CAP', weaknesses: ['confunde numerador y denominador'] });
    expect(await loadLatestLearnWeaknesses(STUDENT, CONCEPT)).toEqual(['confunde numerador y denominador']);
    // nothing more after the cap
    expect((await (await turn(sessionId, 'A')).json()).data.alreadyClosed).toBe(true);
  });
  it('the model fails before the cap: 503, nothing persisted, the same answer can be retried', async () => {
    const { sessionId } = (await (await start()).json()).data;
    h.model.mockImplementation(() => {
      throw new Error('provider down');
    });
    const res = await turn(sessionId, 'A');
    expect(res.status).toBe(503);
    expect(h.sessions.get(sessionId).questions).toHaveLength(1);
    h.model.mockImplementation(() => output());
    expect((await turn(sessionId, 'A')).status).toBe(200);
  });
});

describe('the legacy quiz submission never completes a guided session', () => {
  it('generate-and-take refuses quiz_mode learn_guided before grading', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf-8');
    expect(src).toMatch(/quizSession\.quizMode as string\) === LEARN_GUIDED_QUIZ_MODE[\s\S]{0,200}LEARN_GUIDED_SESSION/);
    expect(src.indexOf('LEARN_GUIDED_SESSION')).toBeLessThan(src.indexOf('const config = QUIZ_MODE_CONFIG[quizSession.quizMode]'));
    // and a canonical Practice generation carries the latest LEARN weaknesses
    expect(src).toMatch(/guidance: practiceGuidanceWithLearnWeaknesses\(config\.guidance, learnWeaknesses\)/);
  });
});
