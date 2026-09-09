/**
 * LX-4P-R1 -- ACTIVE ATTEMPT LANGUAGE INTEGRITY.
 *
 * Production defect: changing the question-language selector during an
 * active Practice attempt silently called generateQuiz() -> new quizId,
 * new questions[], current reset to 0 (2/2 -> 1/2), drafts wiped.
 *
 * Fix (Option B -- no same-item localization exists today): the question
 * language is latched for the life of the attempt; a mid-attempt change
 * is an explicit "start a new session" the learner confirms. UI language
 * is a separate account setting the selector never touches.
 *
 * Source/contract checks -- the repo has no live component harness;
 * runtime behaviour is HARNESS-verified in the LX-4P-R1 report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const TEACH = read('src/app/dashboard/quiz/TeachingIntro.tsx');
const HELP = read('src/app/dashboard/quiz/ContextualHelp.tsx');

/* ---------- R4: no silent regeneration during an active attempt ---------- */
describe('LX-4P-R1 R4 -- a mid-attempt language change never silently regenerates', () => {
  it('changeQuizLanguage does NOT call generateQuiz/regenerateInLanguage while phase === quiz', () => {
    const fn = QUIZ.slice(QUIZ.indexOf('function changeQuizLanguage('), QUIZ.indexOf('function confirmPendingLanguageSwitch('));
    // an active question: try same-item localization first (LX-4P-R2),
    // never a silent regenerate
    expect(fn).toMatch(/if \(phase === 'quiz'\) \{/);
    expect(fn).toMatch(/void attemptSameItemLocalization\(next\);/);
    // regeneration only on the setup / pre-item path
    expect(fn).not.toMatch(/generateQuiz\(/);
    const activeBranch = fn.slice(fn.indexOf("if (phase === 'quiz')"), fn.indexOf('// Setup / pre-item'));
    expect(activeBranch).not.toMatch(/regenerateInLanguage\(/);
  });

  it('regeneration in a new language is reached ONLY pre-item or after explicit confirm', () => {
    // regenerateInLanguage is the single wrapper that mints a new session for a language change
    expect(QUIZ).toMatch(/async function regenerateInLanguage\(next: Locale\)/);
    expect(QUIZ).toMatch(/await generateQuiz\(studentId, next\)/);
    // pre-item path
    const fn = QUIZ.slice(QUIZ.indexOf('function changeQuizLanguage('), QUIZ.indexOf('function confirmPendingLanguageSwitch('));
    expect(fn).toMatch(/void regenerateInLanguage\(next\);\s*\}\s*$/m);
    // confirmed path
    const confirmFn = QUIZ.slice(QUIZ.indexOf('function confirmPendingLanguageSwitch('), QUIZ.indexOf('function confirmPendingLanguageSwitch(') + 260);
    expect(confirmFn).toMatch(/setPendingLanguageSwitch\(null\)/);
    expect(confirmFn).toMatch(/if \(next\) void regenerateInLanguage\(next\)/);
  });

  it('the restart-fallback dialog is a real modal gated on pendingLanguageSwitch, with cancel + confirm', () => {
    expect(QUIZ).toMatch(/\{pendingLanguageSwitch && \(/);
    const dlg = QUIZ.slice(QUIZ.indexOf('{pendingLanguageSwitch && ('), QUIZ.indexOf('{pendingLanguageSwitch && (') + 1800);
    expect(dlg).toMatch(/role="dialog"/);
    expect(dlg).toMatch(/aria-modal="true"/);
    expect(dlg).toMatch(/quiz\.langSwitch\.title/);
    expect(dlg).toMatch(/onClick=\{cancelPendingLanguageSwitch\}/); // Cancel
    expect(dlg).toMatch(/onClick=\{confirmPendingLanguageSwitch\}/); // Confirm
  });

  it('the <select> is controlled by quizLanguage (snaps back on cancel) and stays labelled', () => {
    expect(QUIZ).toMatch(/value=\{quizLanguage\}[\s\S]*?onChange=\{\(e\) => changeQuizLanguage\(e\.target\.value as Locale\)\}/);
    expect(QUIZ).toMatch(/aria-label=\{t\['quiz\.languagePickerLabel'\]\}/);
  });
});

/* ---------- R3: attempt identity preserved until confirm ---------- */
describe('LX-4P-R1 R3 -- attempt identity (quizId / index / drafts) is untouched by a staged switch', () => {
  it('only generateQuiz mints a new quizId / resets current / clears answers -- and it resets them together', () => {
    const gen = QUIZ.slice(QUIZ.indexOf('const generateQuiz = useCallback('), QUIZ.indexOf('// LX-4K: canonical flow skips the configurator'));
    expect(gen).toMatch(/setQuizId\(genBody\.data\.quizId\)/);
    expect(gen).toMatch(/setQuestions\(genBody\.data\.quiz\.questions\)/);
    // index + answers reset in the same place -> no "index reset while retaining prior answers"
    expect(gen).toMatch(/setCurrent\(0\);\s*\n\s*setAnswers\(\{\}\);/);
  });
  it('no OTHER code path calls setQuizId / setCurrent(0) / setAnswers({}) for a language change', () => {
    const langFns = QUIZ.slice(QUIZ.indexOf('async function regenerateInLanguage'), QUIZ.indexOf('function confirmPendingLanguageSwitch(') + 260);
    expect(langFns).not.toMatch(/setQuizId\(/);
    expect(langFns).not.toMatch(/setCurrent\(/);
    expect(langFns).not.toMatch(/setAnswers\(/);
  });
});

/* ---------- R5: evidence integrity ---------- */
describe('LX-4P-R1 R5 -- evidence cannot mix question batches', () => {
  it('submitQuiz keys evidence to the current session quizId from state', () => {
    const sub = QUIZ.slice(QUIZ.indexOf('async function submitQuiz('), QUIZ.indexOf('async function submitQuiz(') + 1600);
    expect(sub).toMatch(/if \(!studentId \|\| !quizId\) return;/);
    expect(sub).toMatch(/quizId,\s*\n\s*answers: answerList/);
  });
  it('a regenerated session gets a fresh quizId (the old one is abandoned, never co-written)', () => {
    // setQuizId is fed straight from the fresh generate response, so answers
    // submitted after a confirmed switch can only land on the new session.
    expect(QUIZ).toMatch(/setQuizId\(genBody\.data\.quizId\)/);
  });
});

/* ---------- R6 / R2: UI locale vs question language are distinct ---------- */
describe('LX-4P-R1 R6 -- UI locale and question language are separate values', () => {
  it('UI chrome uses `locale` (account setting); question content + help use `quizLanguage`', () => {
    expect(QUIZ).toMatch(/const t = getMessages\(locale\)/);
    expect(QUIZ).toMatch(/const \[locale, setLocale\] = useState<Locale>\('es'\)/);
    expect(QUIZ).toMatch(/const \[quizLanguage, setQuizLanguage\] = useState<Locale>/);
    // the language selector controls quizLanguage, never setLocale
    const region = QUIZ.slice(QUIZ.indexOf('function changeQuizLanguage('), QUIZ.indexOf('function confirmPendingLanguageSwitch(') + 260);
    expect(region).not.toMatch(/setLocale\(/);
    // question + contextual help are driven by quizLanguage
    expect(QUIZ).toMatch(/<ContextualHelp[^>]*locale=\{quizLanguage\}/);
    expect(QUIZ).toMatch(/<TeachingIntro[\s\S]*?locale=\{quizLanguage\}/);
  });
});

/* ---------- R7: teaching loop language consistency ---------- */
describe('LX-4P-R1 R7 -- MODEL / GUIDE content is not regenerated on a UI-locale change', () => {
  it('TeachingIntro content load depends on [conceptId, quizId] -- not on locale alone', () => {
    // the effect that fetches explanation + guided-practice
    const eff = TEACH.slice(TEACH.indexOf('async function load()'), TEACH.indexOf('}, [conceptId, quizId]'));
    expect(eff).toMatch(/\/api\/concepts\/\$\{conceptId\}\/explanation/);
    expect(eff).toMatch(/\/api\/learning\/guided-practice/);
    expect(TEACH).toMatch(/\}, \[conceptId, quizId\]\);/);
    expect(TEACH).not.toMatch(/\}, \[conceptId, quizId, locale\]\)/);
  });
});

/* ---------- R8: contextual help preserves question identity ---------- */
describe('LX-4P-R1 R8 -- contextual help never regenerates the active question', () => {
  it('ContextualHelp only posts { quizId, questionIndex, action, language } -- no question mint', () => {
    expect(HELP).toMatch(/body: JSON\.stringify\(\{ studentId, quizId, questionIndex, action, language: locale \}\)/);
    expect(HELP).not.toMatch(/generate-and-take|setQuestions|generateQuiz/);
  });
});

/* ---------- i18n ---------- */
describe('LX-4P-R1 i18n -- language-switch confirmation keys resolve everywhere', () => {
  const KEYS = ['quiz.langSwitch.title', 'quiz.langSwitch.body', 'quiz.langSwitch.cancel', 'quiz.langSwitch.confirm'];
  it('present, non-empty, and {lang} placeholder intact where expected', () => {
    for (const loc of LOCALES) {
      for (const k of KEYS) {
        const v = MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]];
        expect(typeof v === 'string' && v.length > 0, `${loc}:${k}`).toBe(true);
      }
      expect(MESSAGES[loc]['quiz.langSwitch.body' as keyof (typeof MESSAGES)[typeof loc]]).toContain('{lang}');
      expect(MESSAGES[loc]['quiz.langSwitch.confirm' as keyof (typeof MESSAGES)[typeof loc]]).toContain('{lang}');
    }
  });
});
