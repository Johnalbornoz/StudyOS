/**
 * Human Agency P0-1 -- "AI helps while you learn; when we want to know
 * whether you really know, the help disappears."
 *
 * Acceptance:
 *  1. Tutor blocked during assessment -- certified by
 *     tests/unit/tutor-cross-surface-guard.test.ts (unchanged, still green).
 *  2. Every AI-help route is blocked during the same restricted evidence.
 *  3. Every AI-help route works outside restricted evidence.
 *  4. Another browser tab / parallel session cannot bypass the server guard:
 *     the gate is student-wide (called with studentId ONLY) and ignores the
 *     concept, the session and the client-claimed mode of the request.
 * Plus: fail-closed on a guard lookup failure, and a static coverage check
 * that every instructional-AI route goes through the ONE shared gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';
const OTHER_CONCEPT = '44444444-4444-4444-8444-444444444444';
const DIAGNOSIS = '55555555-5555-4555-8555-555555555555';

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  explanation: vi.fn(),
  formula: vi.fn(),
  guided: vi.fn(),
  safeHints: vi.fn(),
  questionHint: vi.fn(),
  explainPrompt: vi.fn(),
  errorGuidance: vi.fn(),
  teachingContent: vi.fn(),
  grade: vi.fn(),
  getQuizSession: vi.fn(),
}));

vi.mock('@/services/active-evidence-guard.service', () => ({ getActiveRestrictedEvidenceForStudent: (...a: any[]) => h.guard(...a) }));
vi.mock('@/lib/auth', () => ({
  verifyAuth: async () => ({ userId: 'u1', role: 'student', email: null }),
  verifyStudentAccess: async () => true,
  checkRateLimit: () => true,
}));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: async () => ({ id: 'actor-1' }) }));
vi.mock('@/lib/entitlements', () => ({ canUseCapability: async () => true }));
vi.mock('@/lib/authorization', () => ({ canAccessLearner: async () => true, isOwner: async () => true }));
vi.mock('@/lib/db', () => {
  const q = async () => ({ rowCount: 1, rows: [{ subject_id: SUBJECT, student_id: STUDENT, label: 'Fractions', subject_name: 'Math', name: 'Math' }] });
  return { query: q, db: { query: q } };
});
vi.mock('@/services/quiz-persistence.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/quiz-persistence.service')>()),
  getQuizSession: (...a: any[]) => h.getQuizSession(...a),
  recordHintUsed: async () => undefined,
}));
vi.mock('@/services/concept-explanation.service', () => ({
  getConceptExplanation: (...a: any[]) => h.explanation(...a),
  getInteractiveFormula: (...a: any[]) => h.formula(...a),
}));
vi.mock('@/services/teaching-content.service', () => ({ generateGuidedPractice: (...a: any[]) => h.guided(...a) }));
vi.mock('@/services/safe-hint.service', () => ({ getSafeQuestionHints: (...a: any[]) => h.safeHints(...a) }));
vi.mock('@/services/quiz-generation.service', () => ({ generateQuestionHint: (...a: any[]) => h.questionHint(...a) }));
vi.mock('@/lib/quiz/grade-question', () => ({ gradeQuizAnswer: (...a: any[]) => h.grade(...a) }));
vi.mock('@/services/explain-defend.service', () => ({ generateExplainPrompt: (...a: any[]) => h.explainPrompt(...a) }));
vi.mock('@/services/explain-defend-task.service', () => ({ createExplainTask: async () => undefined }));
vi.mock('@/services/error-intelligence.service', () => ({ getErrorPatternGuidance: (...a: any[]) => h.errorGuidance(...a) }));
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: async () => null }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/diagnostics/diagnosis.service', () => ({
  getDiagnosisById: async () => ({ id: DIAGNOSIS, studentId: STUDENT, conceptId: CONCEPT, scope: { learningObjectiveId: null }, primaryGapType: 'CONCEPTUAL' }),
}));
vi.mock('@/lib/teaching/intervention-policy.service', () => ({ getActiveInterventionPolicy: async () => ({ id: 'pol-1', rules: [] }) }));
vi.mock('@/lib/teaching/intervention-selection.service', () => ({ selectIntervention: () => ({ primary: 'EXPLAIN', chain: ['EXPLAIN'], rationale: [] }) }));
vi.mock('@/lib/teaching/framework-context.service', () => ({ resolveFrameworkForObjective: async () => null, resolveFrameworkForStudentExamProfile: async () => null }));
vi.mock('@/lib/teaching/session.service', () => ({ startInterventionSession: async () => ({ id: 'sess-1' }) }));
vi.mock('@/lib/teaching/ai-teaching-contract.service', () => ({
  resolveTeachingContentGenerationContext: async () => ({}),
  generateTeachingContent: (...a: any[]) => h.teachingContent(...a),
}));

import { GET as explanationGET } from '@/app/api/concepts/[id]/explanation/route';
import { GET as formulaGET } from '@/app/api/concepts/[id]/interactive-formula/route';
import { POST as guidedPOST } from '@/app/api/learning/guided-practice/route';
import { POST as contextualPOST } from '@/app/api/learning/contextual-help/route';
import { POST as hintPOST } from '@/app/api/quizzes/hint/route';
import { POST as explainGeneratePOST } from '@/app/api/cognitive/explain/generate/route';
import { POST as interventionsPOST } from '@/app/api/teaching/interventions/route';
import { GET as errorGuidanceGET } from '@/app/api/learning-debt/error-guidance/route';
import { POST as checkPOST } from '@/app/api/quizzes/session/[quizId]/check/route';
import { INSTRUCTIONAL_AI_ROUTES, getInstructionalAssistanceState } from '@/lib/ai/instructional-assistance-guard';

const BLOCKED = { allowed: false, reason: 'ACTIVE_QUIZ_SESSION', activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT', sessionId: 'prove-session-on-another-concept' };
const EXAM = { allowed: false, reason: 'ACTIVE_EXAM_SIMULATION', activityType: 'MOCK_EXAM', evidenceMode: 'ASSESSMENT', sessionId: 'sim-1' };
const VERIFICATION = { allowed: false, reason: 'ACTIVE_VERIFICATION', activityType: 'SOLO_VERIFY', evidenceMode: 'ASSESSMENT', sessionId: null };
const ALLOWED = { allowed: true, reason: 'NO_ACTIVE_RESTRICTED_EVIDENCE', activityType: null, evidenceMode: null, sessionId: null };

const practiceSession = {
  id: 'practice-tab-2', studentId: STUDENT, conceptId: OTHER_CONCEPT, subjectId: SUBJECT, conceptIds: [OTHER_CONCEPT],
  quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE', language: 'en', status: 'active',
  createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000), isExpired: false, hintsUsedQuestions: [],
  questions: [{ id: 'q0', conceptId: OTHER_CONCEPT, type: 'single_choice', answerFormat: 'single_choice', question: 'Q?', options: [{ id: 'a', text: 'A' }], correctAnswer: 'a', explanation: '', difficulty: 3 }],
};

const req = (url: string, body?: unknown) => ({ url, json: async () => body, headers: new Headers() }) as any;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** The 9 Student-facing AI-help routes, each called the way a second tab would call it. */
const ROUTES: Array<{ name: string; call: () => Promise<Response>; ai: () => ReturnType<typeof vi.fn> }> = [
  { name: 'concept explanation', ai: () => h.explanation, call: () => explanationGET(req(`http://x/api/concepts/${OTHER_CONCEPT}/explanation?studentId=${STUDENT}&language=en`), params({ id: OTHER_CONCEPT })) },
  { name: 'interactive formula', ai: () => h.formula, call: () => formulaGET(req(`http://x/api/concepts/${OTHER_CONCEPT}/interactive-formula?studentId=${STUDENT}&language=en`), params({ id: OTHER_CONCEPT })) },
  // conceptId with NO mode -- the audit's lateral path (defaults to topic_practice).
  { name: 'guided practice (no mode)', ai: () => h.guided, call: () => guidedPOST(req('http://x', { studentId: STUDENT, conceptId: OTHER_CONCEPT })) },
  { name: 'contextual help (parallel PRACTICE session)', ai: () => h.explanation, call: () => contextualPOST(req('http://x', { studentId: STUDENT, quizId: 'practice-tab-2', questionIndex: 0, action: 'REMINDER' })) },
  { name: 'quiz hint (parallel PRACTICE session)', ai: () => h.questionHint, call: () => hintPOST(req('http://x', { studentId: STUDENT, quizId: 'practice-tab-2', questionIndex: 0 })) },
  { name: 'explain & defend generate', ai: () => h.explainPrompt, call: () => explainGeneratePOST(req('http://x', { studentId: STUDENT, subjectId: SUBJECT, conceptId: OTHER_CONCEPT, activityType: 'EXPLAIN' })) },
  { name: 'teaching interventions', ai: () => h.teachingContent, call: () => interventionsPOST(req('http://x', { studentId: STUDENT, diagnosisId: DIAGNOSIS, interventionType: 'EXPLAIN' })) },
  { name: 'learning-debt error guidance', ai: () => h.errorGuidance, call: () => errorGuidanceGET(req(`http://x/api/learning-debt/error-guidance?studentId=${STUDENT}&subjectId=${SUBJECT}&errorType=CONCEPTUAL&language=en`)) },
  { name: 'per-question PRACTICE check (AI hints)', ai: () => h.safeHints, call: () => checkPOST(req('http://x', { studentId: STUDENT, questionIndex: 0, answer: 'wrong' }), params({ quizId: 'practice-tab-2' })) },
];

beforeEach(() => {
  h.guard.mockReset().mockResolvedValue(ALLOWED);
  h.explanation.mockReset().mockResolvedValue({ summary: 's', examples: ['e'], sections: [] });
  h.formula.mockReset().mockResolvedValue(null);
  h.guided.mockReset().mockResolvedValue({ isFallback: false, steps: [{ text: 'step' }] });
  h.safeHints.mockReset().mockResolvedValue({ hints: ['h1', 'h2'], source: 'ai', discarded: 0 });
  h.questionHint.mockReset().mockResolvedValue({ hints: ['h'] });
  h.explainPrompt.mockReset().mockResolvedValue({ activityType: 'EXPLAIN', prompt: 'Explain it', expectedElements: ['a'] });
  h.errorGuidance.mockReset().mockResolvedValue({ text: 'g' });
  h.teachingContent.mockReset().mockResolvedValue({ blocked: false, payload: { x: 1 } });
  h.grade.mockReset().mockResolvedValue({ correct: false, score: 0, feedback: 'not quite', pedagogical: null });
  h.getQuizSession.mockReset().mockResolvedValue(practiceSession);
});

describe('P0-1 acceptance 2 -- every AI-help route is blocked while restricted evidence is collected', () => {
  for (const r of ROUTES) {
    it(`${r.name}: 423 ASSISTANCE_LOCKED and NO AI/help call`, async () => {
      h.guard.mockResolvedValue(BLOCKED);
      const res = await r.call();
      expect(res.status).toBe(423);
      expect((await res.json()).error).toBe('ASSISTANCE_LOCKED');
      expect(r.ai()).not.toHaveBeenCalled();
    });
  }
  it('an open exam simulation and an unresolved verification lock help exactly the same way', async () => {
    for (const state of [EXAM, VERIFICATION]) {
      h.guard.mockResolvedValue(state);
      for (const r of ROUTES) expect((await r.call()).status).toBe(423);
    }
    for (const r of ROUTES) expect(r.ai()).not.toHaveBeenCalled();
  });
});

describe('P0-1 acceptance 3 -- outside restricted evidence the same routes work as before', () => {
  for (const r of ROUTES) {
    it(`${r.name}: not locked, reaches its help service`, async () => {
      const res = await r.call();
      expect(res.status).not.toBe(423);
      expect(r.ai()).toHaveBeenCalled();
    });
  }
});

describe('P0-1 acceptance 4 -- a second tab / parallel session cannot bypass the server guard', () => {
  it('the gate is student-wide: every route asks it with studentId ONLY (no concept, session or mode can scope it)', async () => {
    for (const r of ROUTES) {
      h.guard.mockClear();
      await r.call();
      expect(h.guard).toHaveBeenCalledTimes(1);
      expect(h.guard.mock.calls[0]).toEqual([STUDENT]);
    }
  });
  it('a request about a DIFFERENT concept than the one under Prove, from a PRACTICE session opened in another tab, is still locked', async () => {
    h.guard.mockResolvedValue(BLOCKED);
    const res = await contextualPOST(req('http://x', { studentId: STUDENT, quizId: 'practice-tab-2', questionIndex: 0, action: 'EXAMPLE' }));
    expect(res.status).toBe(423);
  });
  it('client-claimed PRACTICE mode does not reopen guided practice', async () => {
    h.guard.mockResolvedValue(BLOCKED);
    const res = await guidedPOST(req('http://x', { studentId: STUDENT, conceptId: CONCEPT, mode: 'topic_practice' }));
    expect(res.status).toBe(423);
    expect(h.guided).not.toHaveBeenCalled();
  });
});

describe('P0-1 fail-closed', () => {
  it('a guard lookup failure locks help (GUARD_LOOKUP_FAILED), never "unchecked"', async () => {
    h.guard.mockRejectedValue(new Error('db down'));
    expect(await getInstructionalAssistanceState(STUDENT)).toEqual({ allowed: false, reason: 'GUARD_LOOKUP_FAILED' });
    for (const r of ROUTES) expect((await r.call()).status).toBe(423);
  });
});

describe('P0-1 one shared gate, no per-route policy', () => {
  const ROOT = process.cwd();
  const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf-8');
  it('every listed route calls instructionalAssistanceLockedResponse', () => {
    expect(INSTRUCTIONAL_AI_ROUTES.length).toBe(9);
    for (const p of INSTRUCTIONAL_AI_ROUTES) expect(read(p)).toMatch(/await instructionalAssistanceLockedResponse\(/);
  });
  it('no other API route imports an instructional-help service without the gate (Tutor routes use the same guard inside tutor.service / context-pack)', () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : f === 'route.ts' && files.push(path.relative(ROOT, p)); });
    walk(path.join(ROOT, 'src/app/api'));
    const HELP = /concept-explanation\.service|teaching-content\.service|safe-hint\.service|generateQuestionHint|getErrorPatternGuidance|generateExplainPrompt|generateTeachingContent/;
    const offenders = files.filter((f) => HELP.test(read(f)) && !(INSTRUCTIONAL_AI_ROUTES as readonly string[]).includes(f));
    expect(offenders).toEqual([]);
    expect(read('src/services/tutor.service.ts')).toMatch(/getActiveRestrictedEvidenceForStudent\(studentId\)/);
  });
});
