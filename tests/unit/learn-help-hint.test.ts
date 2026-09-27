/**
 * LEARN_HELP_HINT -- "Dame una pista" always returns a short, safe,
 * question-specific hint in the activity language, or a safe localized
 * fallback. Never an empty help box, never a stuck loading state, never the
 * answer key, never learning evidence.
 *
 * Root cause (generation): the hint prompt asked for a bare JSON array while
 * OpenAI JSON mode only returns objects; the model answered with an object,
 * the validator coerced it to [] and PASSED, the route answered 200 with
 * `hints: []`, and the UI rendered an empty result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({
  executeAI: vi.fn(),
  callModel: vi.fn(),
  hint: vi.fn(),
  verifyAuth: vi.fn(),
  access: vi.fn(),
  getQuizSession: vi.fn(),
  recordHintUsed: vi.fn(),
  intent: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('@/lib/ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/ai')>()), executeAI: h.executeAI }));
vi.mock('@/lib/ai/adapters/call-model', () => ({ callModel: h.callModel }));
vi.mock('@/lib/db', () => ({ db: { query: h.dbQuery }, query: h.dbQuery }));
vi.mock('@/lib/auth', () => ({ verifyAuth: h.verifyAuth, verifyStudentAccess: h.access }));
vi.mock('@/services/quiz-persistence.service', () => ({ getQuizSession: h.getQuizSession, recordHintUsed: h.recordHintUsed }));
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: h.intent }));

import * as quizGen from '@/services/quiz-generation.service';
import { getSafeQuestionHints, fallbackHints } from '@/services/safe-hint.service';
import { revealsAnswer } from '@/lib/quiz/feedback-leak-guard';
import { getMessages } from '@/lib/i18n/messages';
import { NextRequest } from 'next/server';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const STUDENT = '11111111-1111-4111-8111-111111111111';

// Regla de tres simple
const MC: any = {
  id: 'q0', conceptId: 'c1', type: 'multiple_choice', answerFormat: 'single_choice', difficulty: 2,
  question: 'Si 4 cuadernos cuestan 12 €, ¿cuánto cuestan 7 cuadernos?',
  options: [{ id: 'a', text: '21 €' }, { id: 'b', text: '19 €' }, { id: 'c', text: '28 €' }],
  correctAnswer: 'a',
  explanation: 'Un cuaderno cuesta 12/4 = 3 €, así que 7 cuadernos cuestan 7 × 3 = 21 €.',
};
const OPEN: any = {
  id: 'q1', conceptId: 'c1', type: 'short_answer', answerFormat: 'text', difficulty: 2,
  question: 'Si 4 cuadernos cuestan 12 €, ¿cuánto cuestan 7 cuadernos? Explica tu razonamiento.',
  correctAnswer: 'Cuestan 21 € porque cada cuaderno cuesta 3 €',
  explanation: 'Un cuaderno cuesta 12/4 = 3 €, así que 7 cuadernos cuestan 7 × 3 = 21 €.',
};
const GOOD = ['Primero averigua cuánto cuesta un solo cuaderno.', 'Luego piensa cómo usar ese precio para 7 cuadernos.'];
const noLeak = (hints: string[], q: any) => {
  expect(hints.length).toBeGreaterThan(0);
  for (const x of hints) {
    expect(x.trim()).not.toBe('');
    expect(revealsAnswer(x, q)).toBe(false);
    expect(x).not.toContain(q.explanation);
  }
};

describe('generation: the hint contract is an object under a strict schema; empty is never a silent success', () => {
  let opts: any;
  beforeEach(async () => {
    h.executeAI.mockReset().mockResolvedValue({ result: GOOD });
    h.callModel.mockReset().mockResolvedValue({ text: '{"hints":[]}' });
    await quizGen.generateQuestionHint(MC, 'es');
    opts = h.executeAI.mock.calls[0][0];
  });

  it('asks for {"hints": [...]} and sends a strict JSON schema (not bare-array JSON mode)', async () => {
    await opts.call(new AbortController().signal);
    const cm = h.callModel.mock.calls[0][0];
    expect(cm.system).toMatch(/\{"hints": \["hint one", "hint two"\]\}/);
    expect(cm.system).not.toMatch(/JSON array of strings/);
    expect(cm.jsonSchema).toMatchObject({ name: 'question_hints', schema: { required: ['hints'] } });
    expect(cm.system).toMatch(/Write the hints in Spanish/);
    expect(opts.promptVersion).toBe('v4');
  });

  it('normal: {"hints": [...]} is accepted (and a legacy bare array still is)', () => {
    expect(opts.validate({ text: '{"hints":["a","b"]}' })).toMatchObject({ valid: true, value: ['a', 'b'] });
    expect(opts.validate({ text: '["a"]' })).toMatchObject({ valid: true, value: ['a'] });
  });

  it('regression: the real DEV reply {"error": ...} and empty lists FAIL validation instead of passing as []', () => {
    expect(opts.validate({ text: '{"error":"No puedo proporcionar la respuesta en el formato solicitado"}' }).valid).toBe(false);
    expect(opts.validate({ text: '{"hints":[]}' }).valid).toBe(false);
    expect(opts.validate({ text: '{"hints":["  ", 3]}' }).valid).toBe(false);
  });
});

describe('safe hint pipeline', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy?.mockRestore();
    spy = vi.spyOn(quizGen, 'generateQuestionHint');
  });

  it('normal hint (MC): returned as generated', async () => {
    spy.mockResolvedValue(GOOD);
    const r = await getSafeQuestionHints(MC, 'es', {});
    expect(r).toMatchObject({ hints: GOOD, source: 'ai' });
    noLeak(r.hints, MC);
  });

  it('empty AI reply -> regenerated once', async () => {
    spy.mockResolvedValueOnce([]).mockResolvedValueOnce(GOOD);
    const r = await getSafeQuestionHints(MC, 'es', {});
    expect(r).toMatchObject({ hints: GOOD, source: 'ai_regenerated', discarded: ['EMPTY'] });
  });

  it('hints filtered for revealing the answer -> regenerated, never an empty string', async () => {
    spy
      .mockResolvedValueOnce(['La respuesta correcta es 21 €.', 'Un cuaderno cuesta 12/4 = 3 €, así que 7 cuadernos cuestan 7 × 3 = 21 €.'])
      .mockResolvedValueOnce(GOOD);
    const r = await getSafeQuestionHints(MC, 'es', {});
    expect(r).toMatchObject({ hints: GOOD, source: 'ai_regenerated', discarded: ['ALL_REVEALING'] });
    noLeak(r.hints, MC);
  });

  it('a partly revealing hint degrades to its safe part', async () => {
    spy.mockResolvedValue(['Primero averigua cuánto cuesta un solo cuaderno. La respuesta es 21 €.']);
    const r = await getSafeQuestionHints(MC, 'es', {});
    expect(r.hints).toEqual(['Primero averigua cuánto cuesta un solo cuaderno.']);
  });

  it('always revealing -> safe localized fallback (MC wording)', async () => {
    spy.mockResolvedValue(['La respuesta correcta es la opción A.']);
    const r = await getSafeQuestionHints(MC, 'es', {});
    expect(r.source).toBe('fallback');
    expect(r.hints).toEqual(fallbackHints(MC, 'es'));
    expect(r.hints[1]).toBe(getMessages('es')['help.hintFallbackChoice']);
    noLeak(r.hints, MC);
  });

  it('error -> regenerate -> fallback; never throws', async () => {
    spy.mockRejectedValue(new Error('AI down'));
    const r = await getSafeQuestionHints(OPEN, 'es', {});
    expect(r).toMatchObject({ source: 'fallback', discarded: ['ERROR', 'ERROR'] });
    expect(r.hints[1]).toBe(getMessages('es')['help.hintFallbackOpen']);
    noLeak(r.hints, OPEN);
  });

  it('timeout -> fallback (bounded, never hangs)', async () => {
    spy.mockReturnValue(new Promise(() => {}));
    const r = await getSafeQuestionHints(MC, 'es', {}, undefined, 20);
    expect(r).toMatchObject({ source: 'fallback', discarded: ['TIMEOUT', 'TIMEOUT'] });
  });

  it('open response: the answer key or its paraphrase is never returned', async () => {
    spy.mockResolvedValueOnce(['Cuestan 21 € porque cada cuaderno cuesta 3 €.']).mockResolvedValueOnce(['¿Qué dato te falta para pasar de 4 a 7 cuadernos?']);
    const r = await getSafeQuestionHints(OPEN, 'es', {});
    expect(r.hints).toEqual(['¿Qué dato te falta para pasar de 4 a 7 cuadernos?']);
    noLeak(r.hints, OPEN);
  });

  it('language: generation receives the activity language; the fallback is localized', async () => {
    spy.mockResolvedValue(GOOD);
    await getSafeQuestionHints(MC, 'fr', { studentId: STUDENT });
    expect(spy.mock.calls[0][1]).toBe('fr');
    for (const lang of ['es', 'en', 'fr', 'de', 'pt']) {
      const fb = fallbackHints(MC, lang);
      expect(fb[0]).toBe(getMessages(lang as any)['help.hintFallbackData']);
      expect(fb.every((x) => x && !x.startsWith('help.'))).toBe(true);
    }
    expect(fallbackHints(MC, 'en')[0]).toMatch(/^Reread the question/);
  });
});

describe('contextual-help route (the "Dame una pista" endpoint)', () => {
  let POST: typeof import('@/app/api/learning/contextual-help/route').POST;
  let spy: ReturnType<typeof vi.spyOn>;
  const session = (over: Record<string, unknown> = {}): any => ({
    id: 'quiz-1', studentId: STUDENT, subjectId: 'sub-1', conceptId: 'c1', evidenceMode: 'PRACTICE', language: 'es', questions: [MC, OPEN], ...over,
  });
  const req = (body: Record<string, unknown>) =>
    new NextRequest('https://dev.test/api/learning/contextual-help', { method: 'POST', body: JSON.stringify({ studentId: STUDENT, quizId: 'quiz-1', questionIndex: 0, action: 'HINT', language: 'es', ...body }) });

  beforeEach(async () => {
    ({ POST } = await import('@/app/api/learning/contextual-help/route'));
    vi.clearAllMocks();
    spy?.mockRestore();
    spy = vi.spyOn(quizGen, 'generateQuestionHint');
    h.verifyAuth.mockResolvedValue({ userId: 'clerk_1', role: 'student' });
    h.access.mockResolvedValue(true);
    h.getQuizSession.mockResolvedValue(session());
    h.recordHintUsed.mockResolvedValue(undefined);
    h.intent.mockResolvedValue(null);
  });

  it('MC: 200 with non-empty, non-revealing hints; help usage recorded exactly once', async () => {
    spy.mockResolvedValue(GOOD);
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ action: 'HINT', hints: GOOD, hintSource: 'ai' });
    noLeak(data.hints, MC);
    expect(h.recordHintUsed).toHaveBeenCalledTimes(1);
    expect(h.recordHintUsed).toHaveBeenCalledWith('quiz-1', 0);
  });

  it('open response + AI empty twice: 200 with the safe fallback -- never hints: []', async () => {
    spy.mockResolvedValue([]);
    const { data } = await (await POST(req({ questionIndex: 1 }))).json();
    expect(data.hints.length).toBeGreaterThan(0);
    expect(data.hintSource).toBe('fallback');
    noLeak(data.hints, OPEN);
  });

  it('the hint uses the activity language sent by the client', async () => {
    spy.mockResolvedValue(GOOD);
    await POST(req({ language: 'en' }));
    expect(spy.mock.calls[0][1]).toBe('en');
  });

  it('no duplicate evidence: asking for help writes no learning evidence; the usage mark is an idempotent set', async () => {
    spy.mockResolvedValue(GOOD);
    await POST(req({}));
    await POST(req({}));
    expect(h.dbQuery).not.toHaveBeenCalled();
    const route = read('src/app/api/learning/contextual-help/route.ts');
    expect(route).not.toMatch(/recordError|learning_evidence|INSERT INTO|pedagogical-engine/);
    expect(read('src/services/quiz-persistence.service.ts')).toMatch(/ARRAY\(SELECT DISTINCT unnest\(hints_used_questions \|\| \$2::int\[\]\)\)/);
  });

  it('independent checks (Prove/Retain/Transfer) still get no help', async () => {
    h.getQuizSession.mockResolvedValue(session({ evidenceMode: 'INDEPENDENT' }));
    expect((await POST(req({}))).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('help UI: loading always ends, never an empty box', () => {
  const ui = read('src/app/dashboard/quiz/ContextualHelp.tsx');

  it('loading is cleared in finally, with a client timeout that aborts the request', () => {
    // loading ends through the scoped reducer: every path dispatches SUCCESS or FAILURE, and the timer is cleared
    expect(ui).toMatch(/dispatch\(\{ type: 'SUCCESS', scope, requestId, result: data \}\)/);
    expect(ui).toMatch(/else dispatch\(\{ type: 'FAILURE', scope, requestId \}\);\s*\} finally \{\s*clearTimeout\(timer\);/);
    expect(ui).toMatch(/setTimeout\(\(\) => controller\.abort\(\), HELP_TIMEOUT_MS\)/);
    expect(ui).toMatch(/signal: controller\.signal/);
  });

  it('an empty or failed hint shows the localized fallback below the help options', () => {
    expect(ui).toMatch(/action === 'HINT' && !\(data\.hints && data\.hints\.some\(\(h\) => h\.trim\(\)\)\)/);
    expect(ui).toMatch(/if \(action === 'HINT'\) dispatch\(\{ type: 'SUCCESS', scope, requestId, result: \{ action, hints: \[t\['help\.hintFallbackData'\]\] \} \}\);/);
    // the result renders after the action buttons
    expect(ui.indexOf('al-help-actions')).toBeLessThan(ui.indexOf('data-testid="help-result"'));
  });
});
