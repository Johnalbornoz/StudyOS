/**
 * LX-4P-R2 -- SAME-ITEM QUESTION LOCALIZATION.
 *
 * A mid-attempt question-language change now TRANSLATES the current
 * item in place (preferred), and only falls back to the LX-4P-R1
 * explicit restart when a safe translation can't be produced.
 *
 * `reconcileLocalization` is pure and unit-tested directly; the client,
 * route and service wiring are source/contract-checked (no live
 * component/DB harness). Runtime behaviour is HARNESS-verified in the
 * LX-4P-R2 report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';
import {
  reconcileLocalization,
  LOCALIZABLE_ANSWER_FORMATS,
} from '@/services/question-localization.service';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const ROUTE = read('src/app/api/quizzes/localize-question/route.ts');
const SERVICE = read('src/services/question-localization.service.ts');
const TEACH = read('src/app/dashboard/quiz/TeachingIntro.tsx');
const HELP = read('src/app/dashboard/quiz/ContextualHelp.tsx');
const GENROUTE = read('src/app/api/quizzes/generate-and-take/route.ts');

const numericMC: GeneratedQuestion = {
  id: 'q-1',
  conceptId: 'c-1',
  type: 'multiple_choice',
  answerFormat: 'single_choice',
  question: 'A 0.50 kg ball on a 1.2 m string moves at 4.0 m/s. What is the centripetal force?',
  options: [
    { id: 'A', text: '6.7 N' },
    { id: 'B', text: '2.4 N' },
    { id: 'C', text: '1.7 N' },
    { id: 'D', text: '13.3 N' },
  ],
  correctAnswer: 'A',
  explanation: 'F = m v^2 / r = 0.50 * 16 / 1.2',
  difficulty: 3,
  cognitiveLevel: 'APPLICATION',
  expectedReasoningType: 'PROCEDURAL',
};

/* ---------- R3/R4: reconcileLocalization keeps the item identical ---------- */
describe('LX-4P-R2 R3/R4 -- reconcileLocalization preserves the pedagogical item', () => {
  it('a faithful translation keeps id / type / correctAnswer / difficulty / reasoning / option ids', () => {
    const r = reconcileLocalization(numericMC, {
      question: 'Una pelota de 0.50 kg en una cuerda de 1.2 m se mueve a 4.0 m/s. ¿Cuál es la fuerza centrípeta?',
      options: [
        { id: 'A', text: '6.7 N' },
        { id: 'B', text: '2.4 N' },
        { id: 'C', text: '1.7 N' },
        { id: 'D', text: '13.3 N' },
      ],
      explanation: 'F = m v^2 / r = 0.50 * 16 / 1.2',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.question.id).toBe('q-1');
    expect(r.question.type).toBe('multiple_choice');
    expect(r.question.correctAnswer).toBe('A');
    expect(r.question.difficulty).toBe(3);
    expect(r.question.expectedReasoningType).toBe('PROCEDURAL');
    expect(r.question.cognitiveLevel).toBe('APPLICATION');
    expect(r.question.options?.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(r.question.question).toContain('centrípeta');
  });

  it('rejects a translation that drops or changes a number (NUMERIC_DRIFT)', () => {
    const r = reconcileLocalization(numericMC, {
      question: 'Una pelota de 0.5 kg en una cuerda de 1.2 m se mueve a 4 m/s. ¿Fuerza centrípeta?',
      options: numericMC.options,
      explanation: numericMC.explanation,
    });
    expect(r).toEqual({ ok: false, reason: 'NUMERIC_DRIFT' });
  });

  it('rejects a translation that adds, drops or renames an option (OPTION_DRIFT)', () => {
    const missing = reconcileLocalization(numericMC, {
      question: numericMC.question,
      options: [
        { id: 'A', text: '6.7 N' },
        { id: 'B', text: '2.4 N' },
        { id: 'C', text: '1.7 N' },
      ],
      explanation: numericMC.explanation,
    });
    expect(missing).toEqual({ ok: false, reason: 'OPTION_DRIFT' });

    const renamed = reconcileLocalization(numericMC, {
      question: numericMC.question,
      options: [
        { id: 'A', text: '6.7 N' },
        { id: 'B', text: '2.4 N' },
        { id: 'C', text: '1.7 N' },
        { id: 'Z', text: '13.3 N' },
      ],
      explanation: numericMC.explanation,
    });
    expect(renamed).toEqual({ ok: false, reason: 'OPTION_DRIFT' });
  });

  it('rejects an empty stem (EMPTY_TEXT)', () => {
    expect(reconcileLocalization(numericMC, { question: '   ' })).toEqual({ ok: false, reason: 'EMPTY_TEXT' });
  });

  it('rejects a translation that mangles a formula (FORMULA_DRIFT)', () => {
    const r = reconcileLocalization(
      { ...numericMC, options: undefined, answerFormat: 'text', type: 'numeric_problem' },
      { question: 'Calcula la fuerza con F = m v / r para 0.50 kg, 1.2 m, 4.0 m/s.' },
    );
    expect(r).toEqual({ ok: false, reason: 'FORMULA_DRIFT' });
  });

  it('only choice / free-text formats are eligible -- matching/ordering/classification fall back', () => {
    expect([...LOCALIZABLE_ANSWER_FORMATS].sort()).toEqual(['multi_choice', 'single_choice', 'text']);
    for (const fmt of ['matching', 'ordering', 'classification'] as const) {
      expect(LOCALIZABLE_ANSWER_FORMATS.has(fmt)).toBe(false);
    }
  });
});

/* ---------- service: TRANSLATE-ONLY, never generation ---------- */
describe('LX-4P-R2 -- the localization service never regenerates', () => {
  it('uses a dedicated prompt id, not quiz.question_generation', () => {
    expect(SERVICE).toMatch(/getPrompt\('quiz\.question_localization'\)/);
    expect(SERVICE).not.toMatch(/quiz\.question_generation/);
  });
  it('the prompt is TRANSLATE-ONLY and forbids new examples / difficulty changes / number changes', () => {
    expect(SERVICE).toMatch(/You TRANSLATE an existing exam question/);
    expect(SERVICE).toMatch(/Preserve every number EXACTLY/);
    expect(SERVICE).toMatch(/Preserve every formula/);
    expect(SERVICE).toMatch(/do NOT invent a new example/i);
    expect(SERVICE).toMatch(/do NOT simplify/i);
  });
  it('rebuilds the question from the ORIGINAL structural fields, discarding the AI ids/answer/difficulty', () => {
    // reconcile spreads the original and overrides only display text
    expect(SERVICE).toMatch(/\.\.\.original,\s*\n\s*question: ai\.question/);
    // options are rebuilt id-by-id off the ORIGINAL, never taken from the AI
    expect(SERVICE).toMatch(/for \(const o of original\.options\)/);
    expect(SERVICE).toMatch(/rebuilt\.push\(\{ id: o\.id, text \}\)/);
  });
  it('writes no evidence / mastery / session row', () => {
    for (const src of [SERVICE, ROUTE]) {
      expect(src).not.toMatch(/updateMastery|learning_evidence|storeQuiz|INSERT INTO|UPDATE quiz_sessions/);
    }
  });
});

/* ---------- route security + no mutation ---------- */
describe('LX-4P-R2 -- /api/quizzes/localize-question is guarded and read-only', () => {
  it('verifies auth, student access, and session ownership from the stored session', () => {
    expect(ROUTE).toMatch(/verifyAuth\(\)/);
    expect(ROUTE).toMatch(/verifyStudentAccess\(authContext\.userId, v\.studentId/);
    expect(ROUTE).toMatch(/getQuizSession\(v\.quizId\)/);
    expect(ROUTE).toMatch(/session\.studentId !== v\.studentId/);
    expect(ROUTE).toMatch(/session\.questions\[v\.questionIndex\]/);
  });
  it('accepts only supported locales and a bounded question index', () => {
    expect(ROUTE).toMatch(/targetLanguage: z\.enum\(LOCALES/);
    expect(ROUTE).toMatch(/questionIndex: z\.number\(\)\.int\(\)\.min\(0\)/);
    expect(ROUTE).toMatch(/isLocale\(v\.targetLanguage\)/);
  });
  it('takes the canonical question from the server, never a client-supplied object', () => {
    expect(ROUTE).toMatch(/const original = session\.questions\[v\.questionIndex\]/);
    expect(ROUTE).not.toMatch(/body\.question|req\.question|v\.question\b/);
  });
  it('fast-paths (no AI) when already in the target language', () => {
    expect(ROUTE).toMatch(/session\.language === v\.targetLanguage/);
  });
});

/* ---------- client: preserve the active attempt ---------- */
describe('LX-4P-R2 -- a successful localization preserves the whole attempt', () => {
  it('changeQuizLanguage tries same-item localization for an active question', () => {
    expect(QUIZ).toMatch(/void attemptSameItemLocalization\(next\)/);
  });
  it('attemptSameItemLocalization swaps only questions[current] -- never quizId/index/answers/teaching', () => {
    const fn = QUIZ.slice(QUIZ.indexOf('async function attemptSameItemLocalization('), QUIZ.indexOf('function changeQuizLanguage('));
    expect(fn).toMatch(/setQuestions\(\(qs\) => qs\.map\(\(q, i\) => \(i === current \? localized : q\)\)\)/);
    expect(fn).toMatch(/setQuizLanguage\(next\)/);
    expect(fn).not.toMatch(/setQuizId\(|setCurrent\(|setAnswers\(|setTeachingExperience\(|setTeachingStage\(|generateQuiz\(/);
  });
  it('it POSTs the current option order so choices do not reshuffle', () => {
    expect(QUIZ).toMatch(/optionOrder = cur\?\.options\?\.map\(\(o\) => o\.id\)/);
    expect(QUIZ).toMatch(/\/api\/quizzes\/localize-question/);
  });
  it('a failed localization falls back to the LX-4P-R1 restart dialog (R15 copy)', () => {
    const fn = QUIZ.slice(QUIZ.indexOf('async function attemptSameItemLocalization('), QUIZ.indexOf('function changeQuizLanguage('));
    expect(fn).toMatch(/setLocalizeFailedFallback\(true\)/);
    expect(fn).toMatch(/setPendingLanguageSwitch\(next\)/);
    expect(QUIZ).toMatch(/quiz\.langSwitch\.cantLocalizeTitle/);
    expect(QUIZ).toMatch(/quiz\.langSwitch\.cantLocalizeBody/);
    expect(QUIZ).toMatch(/quiz\.langSwitch\.startNewActivity/);
  });
  it('switching BACK to the generated language restores the stored original', () => {
    expect(QUIZ).toMatch(/originalQuestionsRef\.current\[current\]/);
    expect(QUIZ).toMatch(/quizLanguage === sessionOriginalLanguage/);
  });
  it('the learner draft is not touched: no answer/choice reset in the localization path', () => {
    const fn = QUIZ.slice(QUIZ.indexOf('async function attemptSameItemLocalization('), QUIZ.indexOf('function confirmPendingLanguageSwitch('));
    expect(fn).not.toMatch(/setSingleChoice\(|setMultiChoice\(|setTextAnswer\(|setAnswers\(/);
  });
  it('the learner free-text answer is never sent for translation', () => {
    // the localize call sends only quizId + index + target + optionOrder
    expect(QUIZ).toMatch(/JSON\.stringify\(\{ studentId, quizId, questionIndex: idx, targetLanguage: target, optionOrder \}\)/);
    expect(QUIZ).not.toMatch(/translate.*textAnswer|textAnswer.*translate/i);
  });
});

/* ---------- R11: teaching loop is not re-entered ---------- */
describe('LX-4P-R2 R11 -- MODEL/GUIDE completion survives a question-language change', () => {
  it('the localization path never resets teaching state', () => {
    const region = QUIZ.slice(QUIZ.indexOf('const localizeQuestionAt'), QUIZ.indexOf('function confirmPendingLanguageSwitch('));
    expect(region).not.toMatch(/setTeachingExperience\(|setTeachingStage\(/);
  });
  it('teach-first stage still falls back to explicit restart (no in-place localization there)', () => {
    expect(QUIZ).toMatch(/if \(teachingStage === 'teaching'\) \{\s*[\s\S]*?setPendingLanguageSwitch\(next\);/);
  });
});

/* ---------- R20 (supersedes R13): the whole active surface follows the activity language ---------- */
describe('LX-4P-PERF-R1 R20 -- the active learning surface (chrome + content) follows the activity/question language', () => {
  it('TeachingIntro + GuidedPractice drive every t[...] chrome string off `locale` (the activity language), not a UI-locale prop', () => {
    expect(TEACH).toMatch(/const t = getMessages\(locale\)/);
    expect(TEACH).not.toMatch(/getMessages\(uiLocale\)|uiLocale:/);
    expect(TEACH).toMatch(/\/api\/concepts\/\$\{conceptId\}\/explanation\?studentId=\$\{studentId\}&language=\$\{locale\}/);
    // LX-4P-PERF-R1E: GUIDE's request body no longer carries quizId; mode
    // is the canonical QuizMode, language is still the activity language.
    expect(TEACH).toMatch(/body: JSON\.stringify\(\{ studentId, conceptId, mode: quizMode, language: locale \}\)/);
    // GuidedPractice sub-component too
    expect(TEACH).toMatch(/function GuidedPractice\(\{[\s\S]*?const t = getMessages\(locale\)/);
  });
  it('ContextualHelp menu chrome AND help content both follow the activity language', () => {
    expect(HELP).toMatch(/const t = getMessages\(locale\)/);
    expect(HELP).not.toMatch(/uiLocale/);
    expect(HELP).toMatch(/body: JSON\.stringify\(\{ studentId, quizId, questionIndex, action, language: locale \}\)/);
  });
  it('the quiz page passes the activity language (quizLanguage) as the single `locale` prop', () => {
    // LX-4P-PERF-R1E-R1: exitHref now sits between locale and onDone.
    expect(QUIZ).toMatch(/<TeachingIntro[\s\S]*?locale=\{quizLanguage\}[\s\S]*?exitHref=[\s\S]*?onDone=/);
    expect(QUIZ).toMatch(/<ContextualHelp[^>]*locale=\{quizLanguage\} \/>/);
    expect(QUIZ).not.toMatch(/uiLocale=\{locale\}/);
  });
});

/* ---------- evidence + shared transform ---------- */
describe('LX-4P-R2 -- evidence integrity + client transform reuse', () => {
  it('the submit path is unchanged: grading still runs on the stored session questions/language', () => {
    expect(GENROUTE).toMatch(/const cachedQuestions = quizSession\.questions/);
    expect(GENROUTE).toMatch(/const language = quizSession\.language/);
  });
  it('toClientQuestion is shared so a localized question reshapes exactly like the original', () => {
    expect(GENROUTE).toMatch(/import \{ shuffleArray, toClientQuestion \} from '@\/lib\/quiz\/client-question'/);
    expect(ROUTE).toMatch(/import \{ toClientQuestion \} from '@\/lib\/quiz\/client-question'/);
    const CLIENTQ = read('src/lib/quiz/client-question.ts');
    expect(CLIENTQ).toMatch(/optionOrder/); // preserves on-screen order for localization
  });
});

/* ---------- i18n ---------- */
describe('LX-4P-R2 i18n -- fallback copy resolves in every locale', () => {
  const KEYS = [
    'quiz.langSwitch.cantLocalizeTitle',
    'quiz.langSwitch.cantLocalizeBody',
    'quiz.langSwitch.startNewActivity',
  ];
  it('present, non-empty, {lang} placeholder intact in the body', () => {
    for (const loc of LOCALES) {
      for (const k of KEYS) {
        const v = MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]];
        expect(typeof v === 'string' && v.length > 0, `${loc}:${k}`).toBe(true);
      }
      expect(MESSAGES[loc]['quiz.langSwitch.cantLocalizeBody' as keyof (typeof MESSAGES)[typeof loc]]).toContain('{lang}');
    }
  });
});
