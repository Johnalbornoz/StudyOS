/**
 * LEARN_CHECK immediate feedback is NON-REVEALING: correct / almost /
 * incorrect, why the answer does not work and a conceptual direction, plus a
 * progressive scaffold -- never the answer key. Only the final review shows
 * the full solution. These tests fail if immediate feedback contains the
 * correct answer or reproduces the answer key (MC and open response).
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
import { revealsAnswer, stripAnswerReveals } from '@/lib/quiz/feedback-leak-guard';
import { NextRequest } from 'next/server';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

// The reported case: a polar-coordinates statement question.
const MC = {
  id: 'q0', type: 'multiple_choice', answerFormat: 'single_choice', difficulty: 2,
  question: 'Which statement about polar coordinates is true?',
  options: [
    { id: 'a', text: 'Every point has exactly one polar representation.' },
    { id: 'b', text: '(r, θ) and (r, θ + 2π) represent the same point.' },
    { id: 'c', text: 'r can never be zero.' },
  ],
  correctAnswer: 'b',
  explanation: 'Adding a full turn 2π to the angle returns to the same direction, so (r, θ) and (r, θ + 2π) represent the same point.',
};
const OPEN = {
  id: 'q1', type: 'short_answer', answerFormat: 'text', difficulty: 2,
  question: 'Why is the polar representation of a point not unique?',
  correctAnswer: 'Because adding multiples of 2π to the angle gives the same point',
  explanation: 'Angles that differ by a multiple of 2π point in the same direction, so the same point has infinitely many polar representations.',
};

function session(over: Record<string, unknown> = {}): any {
  return {
    id: 'quiz-1', studentId: STUDENT, subjectId: 'sub-1', quizMode: 'canonical_learn_check', activityType: 'LEARN_CHECK',
    evidenceMode: 'PRACTICE', language: 'en', status: 'active', expiresAt: new Date(Date.now() + 3600_000), questions: [MC, OPEN], ...over,
  };
}
const req = (body: unknown) => new NextRequest('https://dev.test/api/quizzes/session/quiz-1/check', { method: 'POST', body: JSON.stringify(body) });
const params = { params: Promise.resolve({ quizId: 'quiz-1' }) };
const check = async (questionIndex: number, answer: string) => (await (await POST(req({ studentId: STUDENT, questionIndex, answer }), params)).json()).data;

/** Every learner-visible text of an immediate-feedback response. */
const visibleTexts = (data: any): string[] => [data.feedback, data.direction, ...(data.scaffold ?? [])].filter(Boolean);

function expectNoLeak(data: any, q: typeof MC | typeof OPEN) {
  expect(data).not.toHaveProperty('keyIdea');
  expect(data).not.toHaveProperty('explanation');
  expect(data).not.toHaveProperty('correctAnswer');
  const all = JSON.stringify(data);
  expect(all).not.toContain(q.explanation);
  for (const text of visibleTexts(data)) expect(revealsAnswer(text, q)).toBe(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyAuth.mockResolvedValue({ userId: 'clerk_1', email: 'a@example.com', role: 'student' });
  h.rate.mockReturnValue(true);
  h.actor.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });
  h.isOwner.mockResolvedValue(true);
  h.entitled.mockResolvedValue(true);
  h.getQuizSession.mockResolvedValue(session());
});

describe('leak guard (pure)', () => {
  it('flags the reported reveal: "The correct statement is that (r, θ) and (r, θ + 2π) represent the same point."', () => {
    expect(revealsAnswer('The correct statement is that (r, θ) and (r, θ + 2π) represent the same point.', MC)).toBe(true);
  });

  it('flags the correct option text, its letter and generic reveal phrasing (EN/ES)', () => {
    expect(revealsAnswer('Remember: (r, θ) and (r, θ + 2π) represent the same point.', MC)).toBe(true);
    expect(revealsAnswer('Option B is the one you want.', MC)).toBe(true);
    expect(revealsAnswer('La respuesta correcta es la segunda.', MC)).toBe(true);
    expect(revealsAnswer('The answer is the second one.', MC)).toBe(true);
    expect(revealsAnswer('Your answer should be about full turns.', MC)).toBe(true);
  });

  it('flags the open answer key verbatim, as a near-paraphrase, and a reproduction of the stored solution', () => {
    expect(revealsAnswer('Because adding multiples of 2π to the angle gives the same point', OPEN)).toBe(true);
    expect(revealsAnswer('Adding 2π multiples to an angle gives you the same point again.', OPEN)).toBe(true);
    expect(revealsAnswer('Angles differing by a multiple of 2π point in the same direction, so a point has infinitely many polar representations.', OPEN)).toBe(true);
  });

  it('keeps non-revealing guidance', () => {
    const why = 'Your choice assumes each point has a single description. Think about what happens to a direction after a full rotation.';
    expect(revealsAnswer(why, MC)).toBe(false);
    expect(stripAnswerReveals(why, MC)).toBe(why);
    expect(revealsAnswer('You described r correctly, but not what the angle can do.', OPEN)).toBe(false);
  });

  it('strips only the revealing sentence', () => {
    const mixed = 'Your choice ignores rotations. The correct statement is that (r, θ) and (r, θ + 2π) represent the same point.';
    expect(stripAnswerReveals(mixed, MC)).toBe('Your choice ignores rotations.');
    expect(stripAnswerReveals('The answer is B.', MC)).toBeNull();
  });
});

describe('check endpoint -- multiple choice', () => {
  it('incorrect: never returns the explanation/solution, the correct option, or its letter -- even if the hint model leaks', async () => {
    h.hint.mockResolvedValue([
      'The correct statement is that (r, θ) and (r, θ + 2π) represent the same point.',
      'Think about what happens to a direction after a full rotation.',
      'Option B is right.',
      'Ask yourself whether one point can have more than one description.',
    ]);
    const data = await check(0, 'a');
    expect(data.correct).toBe(false);
    expectNoLeak(data, MC);
    expect(data.direction).toBe('Think about what happens to a direction after a full rotation.');
    expect(data.scaffold).toEqual(['Ask yourself whether one point can have more than one description.']);
  });

  it('a hint failure degrades to the safe localized fallback -- never to the solution, never empty', async () => {
    h.hint.mockRejectedValue(new Error('AI down'));
    const data = await check(0, 'c');
    expect(data.correct).toBe(false);
    expect(data.direction).toBeTruthy();
    expect(h.hint).toHaveBeenCalledTimes(2); // regenerated once before falling back
    expectNoLeak(data, MC);
  });

  it('correct: no help is generated', async () => {
    const data = await check(0, 'b');
    expect(data.correct).toBe(true);
    expect(h.hint).not.toHaveBeenCalled();
  });
});

describe('check endpoint -- open response', () => {
  it('removes the grader sentence that states the answer and keeps the "why"', async () => {
    h.gradeAnswer.mockResolvedValue({
      correct: false, score: 0.4, confidence: 0.9, errorType: 'CONCEPTUAL', reasoningValid: false,
      feedback: 'You explained what r is, but not what the angle can do. The correct answer is: because adding multiples of 2π to the angle gives the same point.',
    });
    h.hint.mockResolvedValue(['What happens to a direction after one full rotation?', 'Adding 2π multiples to an angle gives you the same point again.']);
    const data = await check(1, 'Because r can be negative');
    expect(data).toMatchObject({ correct: false, partial: true });
    expect(data.feedback).toBe('You explained what r is, but not what the angle can do.');
    expect(data.direction).toBe('What happens to a direction after one full rotation?');
    expect(data.scaffold).toEqual([]);
    expectNoLeak(data, OPEN);
  });

  it('a grader feedback that only reveals yields no feedback text (the UI shows the generic non-revealing line)', async () => {
    h.gradeAnswer.mockResolvedValue({ correct: false, score: 0, confidence: 0.9, errorType: 'CONCEPTUAL', reasoningValid: false, feedback: 'Because adding multiples of 2π to the angle gives the same point.' });
    h.hint.mockResolvedValue([]);
    const data = await check(1, 'no idea');
    expect(data.feedback).toBeNull();
    expectNoLeak(data, OPEN);
  });
});

describe('policy boundaries', () => {
  it('PROVE / RETAIN / TRANSFER (independent) stay deferred -- unchanged', async () => {
    for (const quizMode of ['canonical_prove', 'canonical_retain', 'canonical_transfer']) {
      h.getQuizSession.mockResolvedValueOnce(session({ evidenceMode: 'INDEPENDENT', quizMode }));
      const res = await POST(req({ studentId: STUDENT, questionIndex: 0, answer: 'a' }), params);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('FEEDBACK_DEFERRED');
    }
    expect(h.hint).not.toHaveBeenCalled();
  });

  it('the check route never reads the stored solution into its response; every text passes the guard', () => {
    const route = read('src/app/api/quizzes/session/[quizId]/check/route.ts');
    expect(route).not.toMatch(/keyIdea/);
    expect(route).not.toMatch(/explanation:\s*question\.explanation\s*[,}]\s*\n\s*\}\s*,?\s*\n\s*\}\);/);
    expect(route).toMatch(/stripAnswerReveals\(grade\.feedback, guardQuestion\)/);
    expect(route).toMatch(/await getSafeQuestionHints\(question, session\.language/);
    expect(read('src/services/safe-hint.service.ts')).toMatch(/list\.map\(\(h\) => stripAnswerReveals\(h, guardQuestion\)\)/);
  });

  it('the UI shows direction + progressive scaffold ("Show the key idea" then "Show another hint"), never a key-idea solution', () => {
    const quiz = read('src/app/dashboard/quiz/page.tsx');
    expect(quiz).not.toMatch(/answerCheck\.keyIdea/);
    expect(quiz).toMatch(/at\['quiz\.feedbackDirection'\]/);
    expect(quiz).toMatch(/\(answerCheck\.scaffold \?\? \[\]\)\.slice\(0, answerCheck\.scaffoldShown \?\? 0\)/);
    expect(quiz).toMatch(/at\['quiz\.keyIdeaShow'\] : at\['quiz\.keyIdeaMore'\]/);
  });
});
