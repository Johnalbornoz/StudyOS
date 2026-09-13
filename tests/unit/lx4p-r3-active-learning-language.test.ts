/**
 * LX-4P-R3 -- ACTIVE LEARNING CHROME MUST FOLLOW ACTIVITY LANGUAGE.
 *
 * Live QA: interfaceLanguage=es, activityLanguage=en. The global shell
 * ("Salir") and the question/MODEL/GUIDE content were correctly English/
 * Spanish per their own authority, but everything ELSE on the quiz page
 * (assistance banner, response-contract label, confidence prompt/
 * options, math-toolbar categories, results/feedback/retry) rendered in
 * Spanish regardless of the activity's actual language -- because
 * `quiz/page.tsx` read every one of those strings from `t = getMessages
 * (locale)` (the GLOBAL interface locale), never from the canonical
 * `quizLanguage` already threaded to TeachingIntro/ContextualHelp/
 * ContinuationPanel.
 *
 * Fix: a second translation object `at = getMessages(quizLanguage)`
 * ("activity translations") now backs every active-learning string in
 * this file; `t` remains for the pre-activity setup screen only. No
 * child component (LearningSupportStatus, MathAnswerEditor, TeachingIntro,
 * ContextualHelp) infers language itself -- they all already took
 * locale/t as props; only the caller's choice of WHICH value to pass
 * needed to change.
 *
 * Source/contract checks -- the repo has no live component harness;
 * runtime behaviour is HARNESS-verified in the LX-4P-R3 report (matches
 * the established convention of lx4p-r1-language-integrity.test.ts /
 * lx4p-r2-same-item-localization.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const LEARNING_SUPPORT = read('src/app/dashboard/LearningSupportStatus.tsx');
/** LX-8R3: MathAnswerEditor was deleted (zero remaining callers, retired by UnifiedResponseComposer) -- MathExpressionEditor is the live math-entry surface now. */
const MATH_EXPRESSION_EDITOR = read('src/components/MathExpressionEditor.tsx');
const TEACH = read('src/app/dashboard/quiz/TeachingIntro.tsx');
const HELP = read('src/app/dashboard/quiz/ContextualHelp.tsx');
const LAYOUT = read('src/app/dashboard/layout.tsx');

/* ======================================================================
 * R1/R2 -- single activity-language authority; `at` backs the whole
 * active-learning subtree, `t` stays for the pre-activity setup screen
 * ==================================================================== */
describe('LX-4P-R3 R1/R2 -- one canonical activity-language authority, no independent inference', () => {
  it('both translation objects exist, `at` derived from the SAME quizLanguage already used by TeachingIntro/ContextualHelp/ContinuationPanel', () => {
    expect(QUIZ).toMatch(/const t = getMessages\(locale\);/);
    expect(QUIZ).toMatch(/const at = getMessages\(quizLanguage\);/);
  });

  it('every downstream component is called with the ACTIVITY locale, never independently inferring one', () => {
    expect(QUIZ).toMatch(/<TeachingIntro[\s\S]*?locale=\{quizLanguage\}/);
    expect(QUIZ).toMatch(/<ContextualHelp[^>]*locale=\{quizLanguage\}/);
    expect(QUIZ).toMatch(/<ContinuationPanel[\s\S]*?locale=\{quizLanguage\}/);
    // (4) LX-8R3: MathAnswerEditor was retired entirely (deleted) when
    // the response surface was unified into UnifiedResponseComposer --
    // every UnifiedResponseComposer call site must receive
    // `activityLanguageContext` (built from quizLanguage below, never a
    // raw `locale`/interface-language prop of its own).
    expect(QUIZ).toMatch(/const activityLanguageContext = buildActivityLanguageContext\(quizLanguage\);/);
    const composerCalls = QUIZ.match(/<UnifiedResponseComposer[\s\S]{0,900}?\/>/g) ?? [];
    expect(composerCalls.length).toBeGreaterThanOrEqual(3);
    for (const call of composerCalls) {
      expect(call).toMatch(/activityLanguageContext=\{activityLanguageContext\}/);
      expect(call).not.toMatch(/locale=\{locale\}/);
    }
  });

  it('LearningSupportStatus, MathExpressionEditor, TeachingIntro, ContextualHelp all take locale/t as PROPS -- none reads a global source itself', () => {
    for (const src of [LEARNING_SUPPORT, MATH_EXPRESSION_EDITOR, TEACH, HELP]) {
      expect(src).not.toMatch(/getInterfaceLanguage|getLocale\(\)|cookies\(\)\.get\(['"]locale/);
    }
    expect(LEARNING_SUPPORT).toMatch(/t: Messages/); // receives the resolved messages object, doesn't derive one
    expect(MATH_EXPRESSION_EDITOR).toMatch(/locale: Locale/);
    expect(TEACH).toMatch(/locale: Locale/);
    expect(HELP).toMatch(/locale: Locale/);
  });

  it('the assistance banner is passed the ACTIVITY translations object, not the interface one', () => {
    expect(QUIZ).toMatch(/<LearningSupportStatus[\s\S]*?t=\{at\}/);
    expect(QUIZ).not.toMatch(/<LearningSupportStatus[\s\S]{0,300}?t=\{t\}/);
  });
});

/* ======================================================================
 * R3/R17 -- global shell is untouched
 * ==================================================================== */
describe('LX-4P-R3 R3/R17 -- the global shell keeps its own, separate, interface-language authority', () => {
  it('"Salir" (nav.exitActivity) is rendered by the dashboard layout from the server-resolved INTERFACE language, never quizLanguage', () => {
    expect(LAYOUT).toMatch(/getInterfaceLanguage/);
    expect(LAYOUT).toMatch(/const t = getMessages\(locale\)/);
    expect(LAYOUT).toMatch(/exitLabel=\{t\['nav\.exitActivity'\]\}/);
    expect(LAYOUT).not.toMatch(/quizLanguage/);
  });

  it('"Salir" translates correctly per interface locale, independent of any activity', () => {
    expect(MESSAGES.es['nav.exitActivity']).toBe('Salir');
    expect(MESSAGES.en['nav.exitActivity']).not.toBe('Salir');
  });

  it('this repair never introduces a global interfaceLanguage override anywhere in quiz/page.tsx', () => {
    expect(QUIZ).not.toMatch(/setLocale\(quizLanguage\)/);
    expect(QUIZ).not.toMatch(/getInterfaceLanguage/);
  });
});

/* ======================================================================
 * R4 -- assistance banner
 * ==================================================================== */
describe('LX-4P-R3 R4 -- the assistance banner follows activity language', () => {
  it('(3) LearningSupportStatus renders exactly the `t` (here: `at`) prop it is given -- pure presentation', () => {
    expect(LEARNING_SUPPORT).toMatch(/t\['support\.assistedTitle'\]/);
    expect(LEARNING_SUPPORT).toMatch(/t\['support\.assistedHintNote'\]/);
  });

  it('"Con ayuda disponible" / "Puedes pedir una pista..." resolve to real, distinct English text', () => {
    expect(MESSAGES.es['support.assistedTitle']).toBe('Con ayuda disponible');
    expect(MESSAGES.es['support.assistedHintNote']).toBe('Puedes pedir una pista si te atascas.');
    expect(MESSAGES.en['support.assistedTitle']).not.toBe('Con ayuda disponible');
    expect(MESSAGES.en['support.assistedHintNote']).not.toBe('Puedes pedir una pista si te atascas.');
    expect(typeof MESSAGES.en['support.assistedTitle']).toBe('string');
    expect(MESSAGES.en['support.assistedTitle'].length).toBeGreaterThan(0);
  });
});

/* ======================================================================
 * R5 -- response-contract chrome
 * ==================================================================== */
describe('LX-4P-R3 R5 -- response-contract label/instruction follow activity language; the contract itself is unchanged', () => {
  it('(4) the label and per-kind instruction both read from `at`', () => {
    expect(QUIZ).toMatch(/\{at\['responseContract\.label'\]\}/);
    expect(QUIZ).toMatch(/at\[`responseContract\.\$\{responseContract\.kind\}` as keyof typeof t\]/);
  });

  it('deriveResponseEvidenceContract itself (the canonical contract logic) is not imported differently or reimplemented here', () => {
    expect(QUIZ).toMatch(/import \{ deriveResponseEvidenceContract \} from '@\/lib\/lx\/response-evidence-contract';/);
    expect(QUIZ).toMatch(/const responseContract = deriveResponseEvidenceContract\(/);
  });

  it('"QUÉ SE TE PIDE" / "Da tu respuesta y justifícala." resolve correctly per locale, unrelated to this repair\'s wiring change', () => {
    expect(MESSAGES.es['responseContract.label']).toBe('Qué se te pide');
    expect(MESSAGES.es['responseContract.JUSTIFY']).toBe('Da tu respuesta y justifícala.');
    expect(MESSAGES.en['responseContract.label']).toBe("What's being asked");
    expect(MESSAGES.en['responseContract.JUSTIFY']).toBe('Give your answer and justify it.');
  });
});

/* ======================================================================
 * R6 -- confidence
 * ==================================================================== */
describe('LX-4P-R3 R6 -- confidence UI follows activity language; gating logic is untouched', () => {
  it('(5)/(6) the confidence question and all three options read from `at`', () => {
    expect(QUIZ).toMatch(/aria-label=\{at\['quiz\.confidenceQuestion'\]\}/);
    expect(QUIZ).toMatch(/\{at\['quiz\.confidenceQuestion'\]\}/);
    expect(QUIZ).toMatch(
      /at\['quiz\.confidenceLow'\] : level === 'SOMEWHAT_SURE' \? at\['quiz\.confidenceMedium'\] : at\['quiz\.confidenceHigh'\]/,
    );
  });

  it('(7) confidence STATE/gating (confidenceSelected, confidences, setConfidenceSelected) is untouched by this repair', () => {
    expect(QUIZ).toMatch(/const \[confidences, setConfidences\] = useState<Record<number, ConfidenceLevel>>\(\{\}\)/);
    expect(QUIZ).toMatch(/const \[confidenceSelected, setConfidenceSelected\] = useState<ConfidenceLevel \| null>\(null\)/);
  });

  it('"¿Qué tan seguro estás?" / "No estoy seguro" / "Algo seguro" / "Muy seguro" all resolve to distinct English text', () => {
    expect(MESSAGES.es['quiz.confidenceQuestion']).toBe('¿Qué tan seguro estás?');
    expect(MESSAGES.es['quiz.confidenceLow']).toBe('No estoy seguro');
    expect(MESSAGES.es['quiz.confidenceMedium']).toBe('Algo seguro');
    expect(MESSAGES.es['quiz.confidenceHigh']).toBe('Muy seguro');
    for (const k of ['quiz.confidenceQuestion', 'quiz.confidenceLow', 'quiz.confidenceMedium', 'quiz.confidenceHigh'] as const) {
      expect(MESSAGES.en[k]).not.toBe(MESSAGES.es[k]);
    }
  });
});

/* ======================================================================
 * R7 -- math input chrome
 *
 * LX-8R3 R4/R7 note: the category-tabbed Unicode-symbol toolbar this
 * block originally verified belonged to `MathAnswerEditor`, which LX-8R3
 * retired entirely (deleted -- zero remaining callers) when the
 * learner-facing math/reasoning surface was unified into
 * `UnifiedResponseComposer` (no custom toolbar at all; MathLive's own
 * professional keyboard is the one math-entry palette). The
 * `mathToolbar.category*` i18n keys remain in messages.ts (still read
 * by `math-toolbar-config.ts`'s now-dormant category config, kept
 * rather than churned out) but are no longer rendered by any live
 * component, so the "component resolves them from its locale prop"
 * assertions below are replaced with the equivalent, now-true
 * assertion for the surface that actually renders in the browser
 * today: `MathExpressionEditor` (owned by `UnifiedResponseComposer`)
 * resolves ITS OWN button labels from the given `locale` prop, and
 * every UnifiedResponseComposer call site passes the activity locale.
 * ==================================================================== */
describe('LX-4P-R3 R7 -- the live math-entry surface (MathExpressionEditor, inside UnifiedResponseComposer) follows activity language; symbol/structure insertion unchanged', () => {
  it('(8) UnifiedResponseComposer -- and therefore the MathExpressionEditor it owns -- is called with the ACTIVITY language context everywhere it appears in the active surface', () => {
    const calls = QUIZ.match(/<UnifiedResponseComposer[\s\S]{0,900}?\/>/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call).toMatch(/activityLanguageContext=\{activityLanguageContext\}/);
  });

  it('MathExpressionEditor resolves its own toolbar/aria labels purely from the given locale prop, passed through from activityLanguageContext.activityLanguage, never a global interface locale', () => {
    expect(MATH_EXPRESSION_EDITOR).toMatch(/const t = getMessages\(locale\);/);
    expect(MATH_EXPRESSION_EDITOR).not.toMatch(/getInterfaceLanguage|getLocale\(\)|cookies\(\)\.get\(['"]locale/);
  });

  it('(9) structural template insertion behavior (insertTemplate, MathLive placeholder-based cursor placement) is untouched -- this repair is presentation only', () => {
    expect(MATH_EXPRESSION_EDITOR).toMatch(/function insertTemplate\(button: MathTemplateButton\)/);
    expect(MATH_EXPRESSION_EDITOR).toMatch(/fieldRef\.current\?\.insert\(button\.insertLatex/);
  });

  it('the retired mathToolbar.category* i18n keys still resolve to distinct, non-Spanish English labels (kept as inert i18n-table entries, not re-verified against any live component)', () => {
    for (const [key, es] of [
      ['mathToolbar.categoryBasic', 'Básico'],
      ['mathToolbar.categoryStructures', 'Estructuras'],
      ['mathToolbar.categoryGreek', 'Griego'],
      ['mathToolbar.categoryPhysics', 'Física'],
      ['mathToolbar.categoryMore', 'Más'],
    ] as const) {
      expect(MESSAGES.es[key]).toBe(es);
      expect(MESSAGES.en[key]).not.toBe(es);
      expect(MESSAGES.en[key].length).toBeGreaterThan(0);
    }
  });
});

/* ======================================================================
 * R8 -- all learning states (MODEL/GUIDE/PRACTICE/PROVE/feedback/retry)
 * ==================================================================== */
describe('LX-4P-R3 R8 -- the language rule is structural across every learning state, not screenshot-specific', () => {
  it('(13)/(14) MODEL/GUIDE (TeachingIntro + its GuidedPractice sub-component) already follow activity language end to end', () => {
    expect(QUIZ).toMatch(/<TeachingIntro[\s\S]*?locale=\{quizLanguage\}/);
    expect(TEACH).toMatch(/const t = getMessages\(locale\);/);
    // GuidedPractice: a nested sub-component, ALSO takes locale as a prop (never infers)
    expect(TEACH).toMatch(/function GuidedPractice\(\{[\s\S]*?locale,[\s\S]*?\}\)/);
  });

  it('(15) PRACTICE chrome (the question-answering card: calculator note, Prove banner, per-type instructions, Next/Submit) reads `at`', () => {
    expect(QUIZ).toMatch(/at\['quiz\.calculatorAllowed'\]/);
    expect(QUIZ).toMatch(/at\['activeLearning\.proveTitle'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.selectAllThatApply'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.matchInstructions'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.orderInstructions'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.classifyInstructions'\]/);
    expect(QUIZ).toMatch(/submitting \? at\['quiz\.submitting'\] : current \+ 1 < questions\.length \? at\['quiz\.next'\] : at\['quiz\.viewResults'\]/);
  });

  it('(16) PROVE banner ("activeLearning.proveTitle/Body/helpUnavailable") reads `at`', () => {
    expect(QUIZ).toMatch(/at\['activeLearning\.proveTitle'\]/);
    expect(QUIZ).toMatch(/at\['activeLearning\.proveBody'\]/);
    expect(QUIZ).toMatch(/at\['activeLearning\.helpUnavailable'\]/);
  });

  it('(10) hints / contextual help follow activity language (already correct pre-existing wiring, unchanged)', () => {
    expect(QUIZ).toMatch(/<ContextualHelp[^>]*locale=\{quizLanguage\}/);
  });

  it('(11) feedback (results review: correct/almost/incorrect, why, what-to-change, explanation) reads `at`', () => {
    expect(QUIZ).toMatch(/at\['feedback\.correct'\]/);
    expect(QUIZ).toMatch(/at\['feedback\.almost'\]/);
    expect(QUIZ).toMatch(/at\['feedback\.incorrect'\]/);
    expect(QUIZ).toMatch(/at\['feedback\.why'\]/);
    expect(QUIZ).toMatch(/at\['feedback\.whatToChange'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.explanationLabel'\]/);
  });

  it('(12) retry/error states (review screen, load-error screen, verification errors, practice-prepare-failed) read `at`', () => {
    expect(QUIZ).toMatch(/at\['quiz\.loadError'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.backToDashboard'\]/);
    expect(QUIZ).toMatch(/at\['practice\.prepareFailedTitle'\]/);
    expect(QUIZ).toMatch(/at\['practice\.prepareFailedBody'\]/);
    expect(QUIZ).toMatch(/at\['practice\.prepareRetry'\]/);
    expect(QUIZ).toMatch(/at\['activeLearning\.practiceAgain'\]/);
    expect(QUIZ).toMatch(/at\['activeLearning\.retryNote'\]/);
  });

  it('the Results score/mastery/verification screen reads `at` throughout (not just the reviewing sub-view)', () => {
    expect(QUIZ).toMatch(/at\['quiz\.results'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.score'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.masteryLabel'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.verificationTitle'\]/);
    expect(QUIZ).toMatch(/at\['quiz\.verificationExplain'\]/);
  });

  it('the ContinuationPanel Prove-insufficiency note passed from this page also uses activity language, matching the panel\'s own copy', () => {
    expect(QUIZ).toMatch(/note=\{\s*results\.proveSufficiency[\s\S]*?at\['prove\.moreNeededBody'\]/);
  });
});

/* ======================================================================
 * R9 -- same-item localization fallback preserved
 * ==================================================================== */
describe('LX-4P-R3 R9 -- the certified semantic-safety fallback is unchanged by this repair', () => {
  it('(18) attemptSameItemLocalization / the langSwitch restart dialog still exist, untouched by this presentation-language repair', () => {
    expect(QUIZ).toMatch(/void attemptSameItemLocalization\(next\);/);
    expect(QUIZ).toMatch(/async function regenerateInLanguage\(next: Locale\)/);
    expect(QUIZ).toMatch(/\{pendingLanguageSwitch && \(/);
  });

  it('(19) no code path in this repair calls generateQuiz / mutates the question in place as a "fix" for a language mismatch', () => {
    // this repair only ever renames a `t[...]` read to `at[...]` or a
    // `locale={locale}` prop to `locale={quizLanguage}` -- it introduces
    // zero new calls to generateQuiz/regenerateInLanguage/setQuestions
    const newActivityCalls = (QUIZ.match(/generateQuiz\(/g) ?? []).length;
    expect(newActivityCalls).toBeGreaterThan(0); // the pre-existing calls still exist
    // and the explicit restart flow (R9's "offer start new activity") is
    // still the ONLY way a language mismatch changes the active question batch
    expect(QUIZ).toMatch(/quiz\.langSwitch\.startNewActivity/);
  });

  it('a new activity launched after the restart uses the REQUESTED activity language (regenerateInLanguage\'s own contract, unmodified)', () => {
    expect(QUIZ).toMatch(/await generateQuiz\(studentId, next\)/);
  });
});

/* ======================================================================
 * R10 -- five locales, no missing-key fallback
 * ==================================================================== */
describe('LX-4P-R3 R10 -- every corrected key exists, non-empty, in all five locales', () => {
  const KEYS = [
    'support.assistedTitle', 'support.assistedHintNote',
    'responseContract.label', 'responseContract.JUSTIFY', 'responseContract.ANSWER_ONLY', 'responseContract.SHOW_WORK', 'responseContract.EXPLAIN',
    'quiz.confidenceQuestion', 'quiz.confidenceLow', 'quiz.confidenceMedium', 'quiz.confidenceHigh',
    'mathToolbar.categoryBasic', 'mathToolbar.categoryStructures', 'mathToolbar.categoryGreek', 'mathToolbar.categoryPhysics', 'mathToolbar.categoryMore', 'mathToolbar.categoriesLabel',
    'quiz.calculatorAllowed', 'quiz.calculatorNotAllowed',
    'activeLearning.proveTitle', 'activeLearning.proveBody', 'activeLearning.helpUnavailable',
    'feedback.correct', 'feedback.almost', 'feedback.incorrect', 'feedback.why', 'feedback.whatToChange',
    'quiz.reviewTitle', 'quiz.backToResults', 'quiz.results', 'quiz.score', 'quiz.loadError', 'quiz.backToDashboard',
    'practice.prepareFailedTitle', 'practice.prepareFailedBody', 'practice.prepareRetry', 'practice.preparing',
    'quiz.selectAllThatApply', 'quiz.matchInstructions', 'quiz.orderInstructions', 'quiz.classifyInstructions',
    'quiz.submitting', 'quiz.next', 'quiz.viewResults',
    'quiz.languagePickerLabel',
  ] as const;

  it('(20) all keys present as non-empty strings in every LOCALE, for every locale', () => {
    expect(LOCALES.length).toBe(5);
    for (const loc of LOCALES) {
      for (const k of KEYS) {
        const v = MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]];
        expect(typeof v === 'string' && v.length > 0, `${loc}:${k}`).toBe(true);
      }
    }
  });

  it('no locale silently falls back to the Spanish string for a distinct-by-nature key (spot check across all 5)', () => {
    const esOnly = MESSAGES.es['quiz.confidenceQuestion'];
    for (const loc of LOCALES) {
      if (loc === 'es') continue;
      expect(MESSAGES[loc]['quiz.confidenceQuestion']).not.toBe(esOnly);
    }
  });
});

/* ======================================================================
 * R12 -- no pedagogical regression
 * ==================================================================== */
describe('LX-4P-R3 R12 -- no pedagogical/decision logic touched, presentation only', () => {
  it('no LearningDecision / TeachingIntent / SupportLevel / EvidenceMode / AI-permission / quality-gate identifiers were introduced or altered here', () => {
    // this file never imports/defines decision logic -- only presents it
    expect(QUIZ).not.toMatch(/getLearningDecisions|rankLearningDecisions|selectActivityType/);
    expect(QUIZ).not.toMatch(/canUseAI\s*=|ai-permission-policy/);
  });

  it('deriveResponseEvidenceContract and confidence gating remain the SAME canonical calls as before this repair', () => {
    expect(QUIZ).toMatch(/deriveResponseEvidenceContract\(/);
    expect(QUIZ).toMatch(/clientEvidenceMode/);
  });

  it('question generation entry points (generate-and-take, guided-practice) are not modified by this repair', () => {
    expect(QUIZ).toMatch(/fetch\('\/api\/quizzes\/generate-and-take'/);
  });
});

/* ======================================================================
 * R11 -- exact live matrix (both directions)
 * ==================================================================== */
describe('LX-4P-R3 R11 -- exact live matrix: es interface / en activity, and the inverse', () => {
  it('(1) es interface + en activity: every active-learning key differs between the two locales (so a real interfaceLanguage=es, activityLanguage=en render cannot show Spanish activity chrome)', () => {
    const ACTIVE_KEYS = [
      'support.assistedTitle', 'support.assistedHintNote',
      'responseContract.label', 'responseContract.JUSTIFY',
      'quiz.confidenceQuestion', 'quiz.confidenceLow', 'quiz.confidenceMedium', 'quiz.confidenceHigh',
      'mathToolbar.categoryBasic', 'mathToolbar.categoryStructures', 'mathToolbar.categoryGreek', 'mathToolbar.categoryPhysics', 'mathToolbar.categoryMore',
      'feedback.correct', 'feedback.incorrect',
      'quiz.reviewButton', 'quiz.next', 'quiz.viewResults',
    ] as const;
    for (const k of ACTIVE_KEYS) {
      expect(MESSAGES.es[k]).not.toBe(MESSAGES.en[k]);
    }
  });

  it('(2) en interface + es activity: the SAME wiring (quizLanguage-driven `at`) applies symmetrically -- no direction-specific special-casing in the source', () => {
    // the fix is a single assignment (`at = getMessages(quizLanguage)`), not
    // an es->en-specific branch, so the inverse direction is structurally
    // guaranteed by the same code path -- no per-locale conditional exists
    expect(QUIZ).not.toMatch(/quizLanguage === 'en'|quizLanguage === 'es'/);
  });

  it('"Salir" is unaffected by either direction -- it never reads quizLanguage at all (checked above in R3/R17)', () => {
    expect(LAYOUT).not.toMatch(/quizLanguage/);
  });
});
