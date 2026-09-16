/**
 * LX-4K / LX-4I -- Focus Mode chrome + canonical-flow configurator removal.
 * Source-content tests (no component harness in this repo); runtime
 * behaviour verified in a browser / faithful harness (see the LX-4 report).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const SHELL = read('src/app/dashboard/LearnerShell.tsx');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const ROUTE = read('src/app/api/quizzes/generate-and-take/route.ts');
const CSS = read('src/app/globals.css');

describe('LX-4K Focus Mode -- the shell collapses on active-learning routes', () => {
  it('declares the active-learning route prefixes', () => {
    expect(SHELL).toMatch(/FOCUS_MODE_PREFIXES/);
    for (const p of ['/dashboard/quiz', '/dashboard/remediation', '/dashboard/cognitive/explain', '/dashboard/cognitive/transfer']) {
      expect(SHELL).toContain(`'${p}'`);
    }
  });

  it('renders the minimal focus chrome (Exit + logo, no nav) on those routes', () => {
    expect(SHELL).toMatch(/const inFocusMode = chrome === 'minimal' \|\| FOCUS_MODE_PREFIXES\.some/);
    const focusBranch = SHELL.slice(SHELL.indexOf('if (inFocusMode)'), SHELL.indexOf('return (\n    <div className="lx-shell">'));
    expect(focusBranch).toMatch(/lx-focusbar/);
    expect(focusBranch).toMatch(/lx-exit/);
    expect(focusBranch).toMatch(/exitLabel/);
    // no persistent navigation in the focus branch
    expect(focusBranch).not.toMatch(/<NavList/);
    expect(focusBranch).not.toMatch(/<Footer/);
    expect(focusBranch).not.toMatch(/lx-sidebar/);
  });

  it('the focus chrome has an accessible, keyboard-reachable exit', () => {
    // LX-5J: exit prefers the recorded activity origin (Concept Mission) over the default.
    expect(SHELL).toMatch(/<Link href=\{originExitHref \?\? exitHref\} className="lx-exit" aria-label=\{exitLabel\}/);
    expect(CSS).toMatch(/\.lx-exit:focus-visible/);
  });

  it('exitLabel resolves in every locale', () => {
    for (const loc of LOCALES) expect(MESSAGES[loc]['nav.exitActivity']).toBeTruthy();
  });
});

describe('LX-4I -- the learner does not configure a canonical Practice/Prove activity', () => {
  it('a canonical flow (concept + single-concept mode) is detected and skips the setup form', () => {
    expect(QUIZ).toMatch(/const isCanonicalFlow =/);
    expect(QUIZ).toMatch(/if \(phase === 'setup' && isCanonicalFlow\)/);
    expect(QUIZ).toMatch(/autoStartedRef/);
  });

  it('the learner question-count is NOT sent for a canonical flow (route uses its own execution count)', () => {
    expect(QUIZ).toMatch(/\.\.\.\(isCanonicalFlow \? \{\} : \{ maxQuestions \}\)/);
  });

  it('legacy/manual multi-concept setup is preserved as a compatibility seam', () => {
    // the setup form + slider still exist for the non-canonical path
    expect(QUIZ).toMatch(/if \(phase === 'setup'\) \{/);
    expect(QUIZ).toMatch(/type="range"/);
    expect(QUIZ).toMatch(/setup=1/); // explicit opt-in still honoured
  });
});

describe('LX-4J -- evidence difficulty is the actual generated difficulty, not a constant', () => {
  it('the hardcoded `difficulty: 3` evidence write is gone', () => {
    // CANON-R5R1A: `aggregateEvidenceDifficulty(bucket.questionDifficulties)`
    // is now assigned to a named `actualDifficulty` const one line above
    // `const evidence: LearningEvidence` (reused by the new
    // contract-compliance check), rather than being called inline inside
    // the evidence object literal -- the underlying source of truth is
    // unchanged, only where the call site is.
    const declIdx = ROUTE.indexOf('const actualDifficulty = aggregateEvidenceDifficulty(bucket.questionDifficulties)');
    expect(declIdx).toBeGreaterThan(-1);
    const at = ROUTE.indexOf('const evidence: LearningEvidence');
    expect(at).toBeGreaterThan(declIdx);
    const evidenceBlock = ROUTE.slice(at, at + 500);
    expect(evidenceBlock).not.toMatch(/difficulty: 3\b/);
    expect(evidenceBlock).toMatch(/difficulty: actualDifficulty/);
    // and no other `difficulty: 3` evidence write anywhere -- only the
    // generation-input compat default `validated.difficulty || 3` may remain
    for (const m of ROUTE.match(/difficulty: 3\b/g) ?? []) expect(m).toBeUndefined();
  });

  it('per-question difficulty is actually collected into the bucket', () => {
    expect(ROUTE).toMatch(/bucket\.questionDifficulties\.push\(question\.difficulty\)/);
  });

  it('LX-9R3-R1: resolveTargetDifficulty is now the real, canonical authority -- still no raw masteryScore band mapping', () => {
    const diffContract = read('src/lib/lx/difficulty-contract.ts');
    expect(diffContract).toMatch(/export function resolveTargetDifficulty\(context: TargetDifficultyContext\)/);
    // The policy is keyed off the existing MasteryState classification
    // and critical-misconception count -- never a raw masteryScore band.
    expect(diffContract).not.toMatch(/masteryScore.*[<>]=?\s*\d+/);
  });

  it('the homepage still does not claim StudyUS "adjusts difficulty"', () => {
    const messages = read('src/lib/i18n/messages.ts');
    const section4 = messages.match(/'marketing\.section4Body':[^\n]*/g) ?? [];
    for (const line of section4) {
      expect(line.toLowerCase()).not.toMatch(/adjust\w* (the )?difficulty|ajusta\w* .*dificultad|passt .*schwierigkeit|ajuste.*difficult|ajusta.*dificuldade/);
    }
  });
});

describe('LX-4F -- Response Contract reaches the learner and the grader', () => {
  it('the question UI states what a complete response is, before answering', () => {
    expect(QUIZ).toMatch(/deriveResponseEvidenceContract/);
    expect(QUIZ).toMatch(/responseContract\.\$\{responseContract\.kind\}/);
  });

  it('the grader guard is wired into the route in front of the free-text grade', () => {
    expect(ROUTE).toMatch(/import \{ applyResponseContractGuard \}/);
    expect(ROUTE).toMatch(/deriveResponseEvidenceContract\(/);
    expect(ROUTE).toMatch(/applyResponseContractGuard\(contract, gradeResult/);
  });
});

describe('LX-4 i18n -- teaching / active-learning / response-contract keys resolve in every locale', () => {
  const KEYS = [
    'teachingExperience.mode.EXPLAIN', 'teachingExperience.mode.MODEL', 'teachingExperience.mode.GUIDE',
    'teachingExperience.mode.PRACTICE', 'teachingExperience.mode.INDEPENDENT',
    'responseContract.ANSWER_ONLY', 'responseContract.SHOW_WORK', 'responseContract.EXPLAIN', 'responseContract.JUSTIFY',
    'responseContract.label',
    'activeLearning.needHelp', 'activeLearning.tryAgain', 'activeLearning.continue',
    'activeLearning.proveTitle', 'activeLearning.proveBody', 'activeLearning.helpUnavailable',
    'feedback.whatHappened', 'feedback.why', 'feedback.whatToChange', 'feedback.correctReinforce',
    'help.explainDifferently', 'help.showExample', 'help.giveHint', 'help.remindRule', 'help.showFirstStep', 'help.whyWrong',
  ];
  it('every key present and non-empty in all 5 locales', () => {
    for (const loc of LOCALES) {
      for (const k of KEYS) {
        expect(typeof MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]] === 'string' && MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]].length > 0, `${loc}:${k}`).toBe(true);
      }
    }
  });
});
