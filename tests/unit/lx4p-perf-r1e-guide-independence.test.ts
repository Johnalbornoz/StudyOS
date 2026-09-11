/**
 * LX-4P-PERF-R1E -- GUIDE must not depend on question generation.
 *
 * Live incident: generate-and-take returned 500, quizId never existed,
 * GuidedPractice waited on quizId forever -> the learner was stuck on
 * "Preparing the teaching..." indefinitely after completing MODEL.
 *
 * Behavioural route tests (GUIDE resolves from canonical context, no
 * quizId required, permission integrity preserved) + source-contract
 * checks (client never waits on quizId for GUIDE, distinct observability,
 * MODEL/GUIDE ordering, question-generation background architecture,
 * PERF-R1D MODEL TTFI, evidence untouched).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const getQuizSessionMock = vi.fn();
vi.mock('@/services/quiz-persistence.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/quiz-persistence.service')>();
  return { ...actual, getQuizSession: (...a: any[]) => getQuizSessionMock(...a) };
});

const generateGuidedPracticeMock = vi.fn();
vi.mock('@/services/teaching-content.service', () => ({
  generateGuidedPractice: (...a: any[]) => generateGuidedPracticeMock(...a),
}));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ query: (...a: any[]) => queryMock(...a) }));

import { POST } from '@/app/api/learning/guided-practice/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const CONCEPT_ID = '22222222-2222-4222-8222-222222222222';
const GUIDED = { problem: 'p', steps: [{ prompt: 'x', expectedAnswer: 'y', why: 'z' }], closing: 'c', isFallback: false };

function makeRequest(body: any) {
  return { json: async () => body } as any;
}
function conceptRow(overrides: Partial<Record<string, any>> = {}) {
  return { subject_id: 'subj1', student_id: STUDENT_ID, ...overrides };
}
function labelRow() {
  return { label: 'Centripetal force', subject_name: 'Physics' };
}
function session(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'quiz-1', studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: 'subj1', conceptIds: [CONCEPT_ID],
    quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE',
    questions: [], language: 'en', createdAt: new Date(), expiresAt: new Date(), status: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  getQuizSessionMock.mockReset();
  generateGuidedPracticeMock.mockReset().mockResolvedValue(GUIDED);
  queryMock.mockReset();
});

/* ============================================================== *
 * R1/R2 -- GUIDE resolves without quizId, from canonical context. *
 * ============================================================== */
describe('R1E R1/R2 -- guided-practice resolves from conceptId + mode, no quizId required', () => {
  it('conceptId + mode (topic_practice) -> generates, no quiz session ever looked up', async () => {
    queryMock.mockResolvedValueOnce({ rows: [conceptRow()] }).mockResolvedValueOnce({ rows: [labelRow()] });
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, mode: 'topic_practice', language: 'es' }));
    const body = await res.json();
    expect(body.data.guidedPractice).toEqual(GUIDED);
    expect(getQuizSessionMock).not.toHaveBeenCalled();
    expect(generateGuidedPracticeMock).toHaveBeenCalledWith(STUDENT_ID, 'subj1', CONCEPT_ID, 'Centripetal force', 'Physics', 'es');
  });

  it('conceptId + mode (review) also generates -- PRACTICE evidence mode', async () => {
    queryMock.mockResolvedValueOnce({ rows: [conceptRow()] }).mockResolvedValueOnce({ rows: [labelRow()] });
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, mode: 'review', language: 'en' }));
    const body = await res.json();
    expect(body.data.guidedPractice).toEqual(GUIDED);
  });

  it('a missing mode defaults safely to topic_practice, never crashes, never widens permission beyond PRACTICE', async () => {
    queryMock.mockResolvedValueOnce({ rows: [conceptRow()] }).mockResolvedValueOnce({ rows: [labelRow()] });
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, language: 'en' }));
    expect(res.status ?? 200).not.toBe(500);
    expect(generateGuidedPracticeMock).toHaveBeenCalled();
  });

  it('an unrecognized mode string falls back to topic_practice rather than erroring', async () => {
    queryMock.mockResolvedValueOnce({ rows: [conceptRow()] }).mockResolvedValueOnce({ rows: [labelRow()] });
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, mode: 'not-a-real-mode', language: 'en' }));
    expect(res.status ?? 200).not.toBe(500);
  });

  it('neither quizId nor conceptId -> INVALID_INPUT, no AI call', async () => {
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, language: 'en' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID_INPUT');
    expect(generateGuidedPracticeMock).not.toHaveBeenCalled();
  });

  it('quizId path is preserved unchanged for back-compat', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    queryMock.mockResolvedValueOnce({ rows: [labelRow()] });
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', language: 'en' }));
    const body = await res.json();
    expect(body.data.guidedPractice).toEqual(GUIDED);
    expect(generateGuidedPracticeMock).toHaveBeenCalledWith(STUDENT_ID, 'subj1', CONCEPT_ID, 'Centripetal force', 'Physics', 'en');
  });
});

/* ============================================================== *
 * R6 -- AI permission integrity: never enabled outside PRACTICE.  *
 * ============================================================== */
describe('R1E R6 -- GuidedPractice stays denied outside PRACTICE evidence, regardless of path', () => {
  for (const mode of ['quick_check', 'retention_check', 'cumulative_assessment', 'exam_simulation', 'diagnostic_check']) {
    it(`mode=${mode} (not PRACTICE evidence) -> HELP_DISABLED_FOR_MODE, no AI call`, async () => {
      queryMock.mockResolvedValueOnce({ rows: [conceptRow()] });
      const res: any = await POST(makeRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, mode, language: 'en' }));
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.error).toBe('HELP_DISABLED_FOR_MODE');
      expect(generateGuidedPracticeMock).not.toHaveBeenCalled();
    });
  }

  it('an INDEPENDENT/ASSESSMENT quizId session is denied identically to the conceptId+mode path', async () => {
    getQuizSessionMock.mockResolvedValue(session({ evidenceMode: 'ASSESSMENT', quizMode: 'cumulative_assessment' }));
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', language: 'en' }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('HELP_DISABLED_FOR_MODE');
    expect(generateGuidedPracticeMock).not.toHaveBeenCalled();
  });

  it('a foreign concept (different owner) -> FORBIDDEN, no AI call', async () => {
    queryMock.mockResolvedValueOnce({ rows: [conceptRow({ student_id: 'someone-else' })] });
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, mode: 'topic_practice', language: 'en' }));
    expect(res.status).toBe(403);
    expect(generateGuidedPracticeMock).not.toHaveBeenCalled();
  });

  it('a missing concept -> NOT_FOUND, no AI call', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, mode: 'topic_practice', language: 'en' }));
    expect(res.status).toBe(404);
    expect(generateGuidedPracticeMock).not.toHaveBeenCalled();
  });
});

/* ============================================================== *
 * Source-contract: client never waits on quizId; observability;   *
 * MODEL/GUIDE ordering; PERF-R1D unaffected; evidence untouched.  *
 * ============================================================== */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const TEACH = read('src/app/dashboard/quiz/TeachingIntro.tsx');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const GP_ROUTE = read('src/app/api/learning/guided-practice/route.ts');
const TEACHING_CONTENT = read('src/services/teaching-content.service.ts');

describe('R1E R3/R4/R5 -- client: GUIDE fires independently, never blocked by question generation', () => {
  it('the GUIDE effect no longer gates on quizId', () => {
    expect(TEACH).not.toMatch(/if \(!quizId\)/);
    expect(TEACH).toMatch(/if \(!needsGuided\) \{ setGuideState\('idle'\); return; \}/);
  });
  it('the GUIDE request body carries conceptId + the canonical quizMode, not quizId', () => {
    const gp = TEACH.slice(TEACH.indexOf('GUIDE content -- teaching scaffolding'), TEACH.indexOf('// Drop stages'));
    expect(gp).toMatch(/body: JSON\.stringify\(\{ studentId, conceptId, mode: quizMode, language: locale \}\)/);
    expect(gp).toMatch(/\}, \[conceptId, quizMode, locale, guideAttempt\]\);/);
  });
  it('MODEL and GUIDE stay independent state -- guideState is never read by the explanation effect, expLoading never read by the GUIDE effect', () => {
    const explainEffect = TEACH.slice(TEACH.indexOf('// EXPLAIN / MODEL content'), TEACH.indexOf('// LX-4P-PERF-R1D R4'));
    const guideEffect = TEACH.slice(TEACH.indexOf('GUIDE content -- teaching scaffolding'), TEACH.indexOf('// Drop stages'));
    expect(explainEffect).not.toMatch(/guideState|guided\b/);
    expect(guideEffect).not.toMatch(/expLoading|explanation\./);
  });
  it('a still-preparing canonical GUIDE is PENDING, not silently skipped, and never confused with Practice generation state', () => {
    // LX-4P-PERF-R1E-R1: GUIDE keeps its own reserved effectivePlan slot
    // unconditionally -- pending/ready/error render inline inside it --
    // rather than a boolean gating whether GUIDE appears in the plan.
    expect(TEACH).toMatch(/return true; \/\/ GUIDE \(and any other canonical stage\) always kept/);
    expect(TEACH).not.toMatch(/guideState.*genState|genState.*guideState/);
  });
});

describe('R1E R8 -- observability: GUIDE_* marks distinct from QUESTION_GEN_* marks', () => {
  it('TeachingIntro emits GUIDE_REQUEST_STARTED / GUIDE_READY / GUIDE_FAILED', () => {
    expect(TEACH).toContain("'GUIDE_REQUEST_STARTED'");
    expect(TEACH).toContain("'GUIDE_READY'");
    expect(TEACH).toContain("'GUIDE_FAILED'");
    expect(TEACH).not.toContain('QUESTION_GEN_');
  });
  it('the quiz page emits QUESTION_GEN_STARTED / QUESTION_GEN_READY / QUESTION_GEN_FAILED', () => {
    expect(QUIZ).toContain("'QUESTION_GEN_STARTED'");
    expect(QUIZ).toContain("'QUESTION_GEN_READY'");
    expect(QUIZ).toContain("'QUESTION_GEN_FAILED'");
  });
  it('no learner content is logged in any of these marks (only label/t/conceptId)', () => {
    const perfLines = [...TEACH.matchAll(/console\.log\('\[perf\]', JSON\.stringify\(\{([^}]*)\}\)\)/g)].map((m) => m[1]);
    for (const line of perfLines) {
      expect(line).toMatch(/^[\s\S]*label:[\s\S]*t:[\s\S]*conceptId,?\s*$/);
    }
  });
});

describe('R1E test 13 -- PERF-R1D MODEL TTFI observability is unchanged', () => {
  it('EXPLANATION_READY / MODEL_RENDERED marks are still present and unrelated to GUIDE', () => {
    expect(TEACH).toContain("'EXPLANATION_READY'");
    expect(TEACH).toContain("'MODEL_RENDERED'");
  });
  it('existing T0..T6 journey marks are untouched', () => {
    for (const m of ['T0_start', 'T1_teachingintent_ready', 'T4_gen_start', 'T5_gen_ready', 'T6_first_practice_question']) {
      expect(QUIZ).toContain(`'${m}'`);
    }
  });
});

describe('R1E test 14 -- question-generation background architecture is untouched', () => {
  it('wave B is still the background generate-and-take call, unchanged shape', () => {
    expect(QUIZ).toMatch(/wave B -- question generation, in the background/);
    expect(QUIZ).toMatch(/const genP = fetch\('\/api\/quizzes\/generate-and-take'/);
  });
  it('a question-generation failure still only sets genState to error -- it does not touch TeachingIntro/GUIDE state', () => {
    const applyGen = QUIZ.slice(QUIZ.indexOf('const applyGen = genP'), QUIZ.indexOf('tiP.then'));
    expect(applyGen).toMatch(/setGenState\('error'\)/);
    expect(applyGen).not.toMatch(/setGuided|setGpLoading|setTeachingExperience/);
  });
});

describe('R1E test 15 -- evidence / mastery untouched', () => {
  it('teaching-content.service still writes no evidence and picks no concept/activity/support', () => {
    expect(TEACHING_CONTENT).not.toMatch(/updateMastery|learning_evidence|recordEvidence|applyEvidence/);
    expect(TEACHING_CONTENT).not.toMatch(/computeSupportLevel|selectActivityType|LearningDecision|isProveRequired/);
  });
  it('the guided-practice route touches no evidence-writing surface', () => {
    expect(GP_ROUTE).not.toMatch(/updateMastery|learning_evidence|recordEvidence/i);
  });
  it('Practice-assistance policy (canUseAI) is the SAME gate for both resolution paths -- not weakened', () => {
    expect(GP_ROUTE).toMatch(/canUseAI\(\{ evidenceMode, feature: 'EXPLAIN' \}\)/);
  });
});
