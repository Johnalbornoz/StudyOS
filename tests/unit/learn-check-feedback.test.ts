/**
 * LEARN_CHECK per-question feedback -- an incorrect answer is never a silent
 * advance, feedback never writes evidence, and independent checks stay
 * deferred.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  rate: vi.fn(),
  actor: vi.fn(),
  isOwner: vi.fn(),
  entitled: vi.fn(),
  getQuizSession: vi.fn(),
  gradeAnswer: vi.fn(),
  hint: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ verifyAuth: h.verifyAuth, checkRateLimit: h.rate }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: h.actor }));
vi.mock('@/lib/authorization', () => ({ isOwner: h.isOwner }));
vi.mock('@/lib/entitlements', () => ({ canUseCapability: h.entitled }));
vi.mock('@/services/quiz-persistence.service', () => ({ getQuizSession: h.getQuizSession }));
vi.mock('@/lib/db', () => ({ db: { query: h.dbQuery }, query: h.dbQuery }));
vi.mock('@/services/quiz-generation.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/quiz-generation.service')>()),
  gradeAnswer: h.gradeAnswer,
  generateQuestionHint: h.hint,
}));

import { POST } from '@/app/api/quizzes/session/[quizId]/check/route';
import { getMessages } from '@/lib/i18n/messages';
import { NextRequest } from 'next/server';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

const MC = {
  id: 'q0', type: 'multiple_choice', answerFormat: 'single_choice', difficulty: 2,
  question: 'What do r and θ represent?',
  options: [{ id: 'a', text: 'distance and angle' }, { id: 'b', text: 'horizontal and vertical' }],
  correctAnswer: 'a',
  explanation: 'r is the distance from the pole; θ is the angle from the polar axis.',
};
const OPEN = { id: 'q1', type: 'short_answer', answerFormat: 'text', difficulty: 2, question: 'Define (r, θ).', correctAnswer: 'r distance, θ angle', explanation: 'Distance and angle.' };

function session(over: Record<string, unknown> = {}): any {
  return {
    id: 'quiz-1', studentId: STUDENT, subjectId: 'sub-1', quizMode: 'canonical_learn_check', activityType: 'LEARN_CHECK',
    evidenceMode: 'PRACTICE', language: 'es', status: 'active', expiresAt: new Date(Date.now() + 3600_000), questions: [MC, OPEN], ...over,
  };
}
const req = (body: unknown) => new NextRequest('https://dev.test/api/quizzes/session/quiz-1/check', { method: 'POST', body: JSON.stringify(body) });
const params = { params: Promise.resolve({ quizId: 'quiz-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyAuth.mockResolvedValue({ userId: 'clerk_1', email: 'a@example.com', role: 'student' });
  h.rate.mockReturnValue(true);
  h.actor.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });
  h.isOwner.mockResolvedValue(true);
  h.entitled.mockResolvedValue(true);
  h.getQuizSession.mockResolvedValue(session());
  h.hint.mockResolvedValue(['Think about what each coordinate measures from the pole.', 'Compare with how x and y work.']);
});

describe('per-question feedback for LEARN_CHECK', () => {
  it('incorrect answer -> "incorrect", why, a direction and a scaffold -- never the answer key or the solution', async () => {
    const res = await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'b' }), params);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      correct: false,
      partial: false,
      direction: 'Think about what each coordinate measures from the pole.',
      scaffold: ['Compare with how x and y work.'],
    });
    expect(data).not.toHaveProperty('correctAnswer');
    expect(data).not.toHaveProperty('keyIdea');
    expect(JSON.stringify(data)).not.toContain(MC.explanation);
    // structured formats carry no grader text; the UI shows a short visible "why" that does not reveal the option
    const quiz = read('src/app/dashboard/quiz/page.tsx');
    expect(quiz).toMatch(/!answerCheck\.correct \? \(\s*\/\/[^\n]*\n[^\n]*\n\s*<p[^>]*>\{at\['quiz\.checkIncorrectGeneric'\]\}/);
    expect(getMessages('es')['quiz.checkIncorrectGeneric']).not.toMatch(/\bB\b|horizontal/);
  });

  it('correct answer -> "correct"', async () => {
    const { data } = await (await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'a' }), params)).json();
    expect(data.correct).toBe(true);
  });

  it('open answers use the same AI grader + contract as submission', async () => {
    h.gradeAnswer.mockResolvedValue({ correct: false, score: 0.5, feedback: 'You named r but not θ.', confidence: 0.9, errorType: 'CONCEPTUAL', reasoningValid: false });
    const { data } = await (await POST(req({ studentId: STUDENT, questionIndex: 1, answer: 'r is distance' }), params)).json();
    expect(h.gradeAnswer).toHaveBeenCalledWith(OPEN, 'r is distance', 'es', { studentId: STUDENT, subjectId: 'sub-1' });
    expect(data).toMatchObject({ correct: false, partial: true, feedback: 'You named r but not θ.' });
    expect(h.hint).toHaveBeenCalledTimes(1);
  });

  it('no duplicate evidence: checking writes nothing (no evidence, error, misconception or progression)', async () => {
    await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'b' }), params);
    expect(h.dbQuery).not.toHaveBeenCalled();
    const route = read('src/app/api/quizzes/session/[quizId]/check/route.ts');
    expect(route).not.toMatch(/recordError|learning_evidence|INSERT|UPDATE|pedagogical-engine|misconception\.service/);
  });

  it('errors/misconceptions are persisted only by the final submission, graded by the SAME grader', () => {
    const submit = read('src/app/api/quizzes/generate-and-take/route.ts');
    expect(submit).toMatch(/await gradeQuizAnswer\(question, answer\.answer, language, quizSession\.evidenceMode/);
    expect(submit).toMatch(/import \{ recordError \} from '@\/services\/error-intelligence\.service'/);
    expect(read('src/app/api/quizzes/session/[quizId]/check/route.ts')).toMatch(/await gradeQuizAnswer\(question, body\.answer/);
  });

  it('independent checks (Prove/Retain/Transfer) never get per-question feedback', async () => {
    h.getQuizSession.mockResolvedValue(session({ evidenceMode: 'INDEPENDENT', quizMode: 'canonical_prove' }));
    const res = await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'b' }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('FEEDBACK_DEFERRED');
  });

  it('authorization is unchanged: not owner -> 403, no licence -> 403, inactive session -> 409', async () => {
    h.isOwner.mockResolvedValueOnce(false);
    expect((await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'b' }), params)).status).toBe(403);
    h.entitled.mockResolvedValueOnce(false);
    expect((await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'b' }), params)).status).toBe(403);
    h.getQuizSession.mockResolvedValueOnce(session({ status: 'completed' }));
    expect((await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'b' }), params)).status).toBe(409);
    h.getQuizSession.mockResolvedValueOnce(session({ studentId: '22222222-2222-4222-8222-222222222222' }));
    expect((await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'b' }), params)).status).toBe(404);
  });
});

describe('quiz UI contract', () => {
  const quiz = read('src/app/dashboard/quiz/page.tsx');

  it('LEARN_CHECK asks to check before advancing; the answer is locked once checked (first attempt is recorded)', () => {
    expect(quiz).toMatch(/const perQuestionFeedback = quizMode === 'canonical_learn_check';/);
    expect(quiz).toMatch(/perQuestionFeedback && !answerLocked \? \(\s*<button\s+onClick=\{checkAnswer\}/);
    // UX-3: the same lock (plus: inputs also freeze while a submission is in flight).
    expect(quiz).toMatch(/<fieldset className="ls-answer" disabled=\{answerLocked \|\| answerCheck\?\.status === 'checking' \|\| submitting\}/);
  });

  it('feedback is visible and announced; help is offered on a wrong answer; a failed check never blocks', () => {
    expect(quiz).toMatch(/role="status"\s+aria-live="polite"/);
    expect(quiz).toMatch(/at\['quiz\.checkHelpHint'\]/);
    expect(quiz).toMatch(/at\['quiz\.checkUnavailable'\]/);
  });

  it('continuity is explicit and honest: the next question is the next one in the check (no fake adaptation)', () => {
    expect(quiz).toMatch(/at\['quiz\.checkContinuity'\]/);
    expect(getMessages('es')['quiz.checkContinuity']).not.toMatch(/adapt/i);
    // progression order is unchanged: advancing still goes to current + 1 and submits once at the end
    expect(quiz).toMatch(/setCurrent\(current \+ 1\);\n\s+setAnswerCheck\(null\);/);
    expect(quiz).toMatch(/submitQuiz\(updatedAnswers, updatedConfidences\)/);
  });

  it('LEARN_CHECK is an assisted contract (help never turns it into independent evidence)', () => {
    expect(read('src/lib/pedagogical-decision/canonical-contract-validator.ts')).toMatch(/assisted contract \(PRACTICE\/REINFORCE\/LEARN_CHECK\)/);
  });
});
