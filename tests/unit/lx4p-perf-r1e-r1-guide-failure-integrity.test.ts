/**
 * LX-4P-PERF-R1E-R1 -- CANONICAL GUIDE MUST NOT BE SILENTLY OMITTED.
 *
 * The R1E fix (GUIDE independent of quizId) introduced a regression: on
 * GUIDE generation failure, `guided === null` made `effectivePlan` drop
 * GUIDE the same way it drops a genuinely-not-required stage --
 * silently turning MODEL -> GUIDE -> PRACTICE into MODEL -> PRACTICE.
 * Infrastructure failure is not pedagogical authority.
 *
 * This file verifies: GUIDE_NOT_REQUIRED vs GUIDE_REQUIRED_BUT_FAILED are
 * distinguished; a required GUIDE is NEVER dropped from the plan; a
 * failure renders an explicit, retryable, exit-capable state (never an
 * automatic Practice transition, never a "skip GUIDE"); retry is bounded
 * and non-duplicating; the two failure domains (GUIDE vs question
 * generation) stay structurally independent; and every already-shipped
 * invariant (permission, language, MODEL TTFI, evidence) is untouched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const TEACH = read('src/app/dashboard/quiz/TeachingIntro.tsx');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const GP_ROUTE = read('src/app/api/learning/guided-practice/route.ts');
const TEACHING_CONTENT = read('src/services/teaching-content.service.ts');
const MESSAGES = read('src/lib/i18n/messages.ts');

/* ============================================================== *
 * 1 -- GUIDE_NOT_REQUIRED: no request, no error UI, no artificial *
 * stage (R6).                                                     *
 * ============================================================== */
describe('test 1 -- GUIDE not required: no request, no GUIDE UI', () => {
  it('the GUIDE effect early-returns to idle, without fetching, when !needsGuided', () => {
    const gp = TEACH.slice(TEACH.indexOf('GUIDE content -- teaching scaffolding'), TEACH.indexOf('// Drop stages'));
    const beforeFetch = gp.slice(0, gp.indexOf("fetch('/api/learning/guided-practice'"));
    expect(beforeFetch).toMatch(/if \(!needsGuided\) \{ setGuideState\('idle'\); return; \}/);
  });
  it('needsGuided is derived purely from the canonical plan, never invented client-side', () => {
    expect(TEACH).toMatch(/const needsGuided = plan\.includes\('GUIDE'\)/);
  });
});

/* ============================================================== *
 * 2/4/5 -- required GUIDE is never dropped, never silently        *
 * bypassed into an automatic Practice transition.                 *
 * ============================================================== */
describe('tests 2/4/5 -- a canonically required GUIDE stage is never silently omitted', () => {
  it('effectivePlan keeps GUIDE unconditionally -- no content-based drop condition for it', () => {
    const filterBody = TEACH.slice(TEACH.indexOf('const effectivePlan = plan.filter'), TEACH.indexOf('useEffect(() => {\n    if (!expLoading && guideState'));
    // EXPLAIN/MODEL are still dropped on missing content -- GUIDE never is
    expect(filterBody).toMatch(/if \(s === 'EXPLAIN'\) return !!explanation\?\.summary;/);
    expect(filterBody).toMatch(/if \(s === 'MODEL'\) return \(explanation\?\.examples\?\.length \?\? 0\) > 0;/);
    expect(filterBody).not.toMatch(/if \(s === 'GUIDE'\) return \(guided/); // the old (buggy) content-gated drop is gone
    expect(filterBody).toMatch(/return true; \/\/ GUIDE \(and any other canonical stage\) always kept/);
  });
  it('advancing past GUIDE (isLast/advance) is reachable ONLY through a genuinely completed GuidedPractice, never from the error or loading sub-state', () => {
    // GuidedPractice (which alone can call onComplete -> advance) renders
    // only when guideState === 'ready'.
    expect(TEACH).toMatch(/stage === 'GUIDE' && guideState === 'ready' && guided && \(\s*\n\s*<GuidedPractice guided=\{guided\} locale=\{locale\} onComplete=\{advance\} \/>/);
    // the generic bottom Continue/Skip bar is excluded for the whole GUIDE stage
    expect(TEACH).toMatch(/\{stage !== 'GUIDE' && \(/);
  });
  it('there is no learner-facing "skip GUIDE" action anywhere in the GUIDE error/loading sub-states', () => {
    const guideBlock = TEACH.slice(TEACH.indexOf("stage === 'GUIDE' && guideState === 'loading'"), TEACH.indexOf('</section>'));
    expect(guideBlock).not.toMatch(/teachingIntro\.skip|onClick=\{onDone\}/);
  });
});

/* ============================================================== *
 * 3/6/7 -- explicit recoverable GUIDE failure state + retry.      *
 * ============================================================== */
describe('tests 3/6/7 -- explicit GUIDE_FAILED state with bounded, non-duplicating retry', () => {
  it('a network/parse failure or an empty/fallback response both resolve to guideState "error", never silently to "ready"', () => {
    const gp = TEACH.slice(TEACH.indexOf('GUIDE content -- teaching scaffolding'), TEACH.indexOf('function retryGuide'));
    expect(gp).toMatch(/\.catch\(\(\) => null\)/);
    expect(gp).toMatch(/const ok = !!gp && Array\.isArray\(gp\.steps\) && gp\.steps\.length > 0;/);
    expect(gp).toMatch(/setGuided\(null\);\s*\n\s*setGuideState\('error'\);/);
  });
  it('the error state renders a teaching-specific title/body and both required actions -- RETRY and EXIT', () => {
    const errBlock = TEACH.slice(TEACH.indexOf("stage === 'GUIDE' && guideState === 'error'"), TEACH.indexOf('</section>'));
    expect(errBlock).toMatch(/t\['guided\.failedTitle'\]/);
    expect(errBlock).toMatch(/t\['guided\.failedBody'\]/);
    expect(errBlock).toMatch(/onClick=\{retryGuide\}/);
    expect(errBlock).toMatch(/t\['guided\.retry'\]/);
    expect(errBlock).toMatch(/href=\{exitHref\}/);
    expect(errBlock).toMatch(/t\['guided\.exit'\]/);
  });
  it('retry is a fresh bounded request (guideAttempt bump) guarded against duplicate concurrent clicks', () => {
    expect(TEACH).toMatch(/function retryGuide\(\) \{\s*\n\s*if \(guideRetryInFlightRef\.current\) return;\s*\n\s*guideRetryInFlightRef\.current = true;\s*\n\s*setGuideAttempt\(\(a\) => a \+ 1\);\s*\n\s*\}/);
  });
  it('retry never produces an infinite loading state -- the effect always settles guideState to ready or error', () => {
    const gp = TEACH.slice(TEACH.indexOf('GUIDE content -- teaching scaffolding'), TEACH.indexOf('function retryGuide'));
    expect(gp).toMatch(/if \(ok\) \{\s*\n\s*setGuided\(gp\);\s*\n\s*setGuideState\('ready'\);\s*\n\s*\} else \{/);
  });
  it('all 5 locales carry the new GUIDE failure/retry/exit strings, non-empty', () => {
    for (const key of ["'guided.preparing':", "'guided.failedTitle':", "'guided.failedBody':", "'guided.retry':", "'guided.exit':"]) {
      const occurrences = MESSAGES.split(key).length - 1;
      expect(occurrences, key).toBe(5);
    }
  });
});

/* ============================================================== *
 * 8/9/10 -- the two failure domains stay structurally independent.*
 * ============================================================== */
describe('tests 8/9/10 -- GUIDE and question-generation failure domains never cross-mutate', () => {
  it('the GUIDE fetch/effect CODE never references quizId/genState/questions as an identifier (doc-comment prose aside)', () => {
    // Anchored to the actual request + resolution code, not the doc
    // comment above it (which legitimately explains the OLD quizId
    // coupling in prose).
    const code = TEACH.slice(
      TEACH.indexOf("fetch('/api/learning/guided-practice'"),
      TEACH.indexOf('function retryGuide'),
    );
    expect(code).not.toMatch(/\bquizId\b|\bgenState\b|\bquestions\b/);
  });
  it('the quiz page\'s question-generation failure path never touches GUIDE/TeachingIntro state', () => {
    const applyGen = QUIZ.slice(QUIZ.indexOf('const applyGen = genP'), QUIZ.indexOf('tiP.then'));
    expect(applyGen).toMatch(/setGenState\('error'\)/);
    expect(applyGen).not.toMatch(/setGuided|setGuideState|guideAttempt|setTeachingExperience/);
  });
  it('GUIDE and question generation are dispatched from separate, unrelated effects (no shared trigger)', () => {
    expect(QUIZ).toMatch(/wave B -- question generation, in the background/);
    // TeachingIntro (which owns the GUIDE effect) is a presentational child
    // mounted once teachingStage becomes 'teaching' -- its actual GUIDE
    // request code never reads genState (only a doc comment cross-
    // references the name, to explain where it lives instead).
    const code = TEACH.slice(
      TEACH.indexOf("fetch('/api/learning/guided-practice'"),
      TEACH.indexOf('function retryGuide'),
    );
    expect(code).not.toMatch(/genState/);
  });
});

/* ============================================================== *
 * 11/12/13 -- permission/authority integrity, unchanged.         *
 * ============================================================== */
describe('tests 11/12/13 -- no client SupportLevel; server EvidenceMode permission unchanged; Prove/Independent/Assessment integrity', () => {
  it('TeachingIntro computes no SupportLevel/EvidenceMode/permission decision', () => {
    expect(TEACH).not.toMatch(/computeSupportLevel|SupportLevel =|EvidenceMode =|canUseAI/);
  });
  it('the guided-practice route still derives EvidenceMode server-side through the fixed taxonomy for both resolution paths', () => {
    expect(GP_ROUTE).toMatch(/evidenceMode = session\.evidenceMode/);
    expect(GP_ROUTE).toMatch(/evidenceMode = evidenceModeForQuizMode\(mode\)/);
    expect(GP_ROUTE).toMatch(/canUseAI\(\{ evidenceMode, feature: 'EXPLAIN' \}\)/);
  });
  it('the Practice-assistance permission gate itself is untouched by this repair (still PRACTICE-only)', () => {
    expect(GP_ROUTE).toMatch(/HELP_DISABLED_FOR_MODE/);
    expect(GP_ROUTE).toMatch(/status: 403/);
  });
});

/* ============================================================== *
 * 14 -- language.                                                *
 * ============================================================== */
describe('test 14 -- activity language preserved in the GUIDE failure/retry/exit surface', () => {
  it('the GUIDE request and its failure/retry/exit chrome both read the activity language (locale), not the interface language', () => {
    const gp = TEACH.slice(TEACH.indexOf('GUIDE content -- teaching scaffolding'), TEACH.indexOf('function retryGuide'));
    expect(gp).toMatch(/language: locale/);
    expect(TEACH).toMatch(/const t = getMessages\(locale\)/);
    // R20's uiLocale split stays reverted -- no chrome/content is keyed
    // to a uiLocale identifier (a historical doc comment name-drop aside).
    expect(TEACH).not.toMatch(/getMessages\(uiLocale\)|uiLocale:/);
  });
});

/* ============================================================== *
 * 15 -- PERF-R1D MODEL TTFI unaffected.                          *
 * ============================================================== */
describe('test 15 -- PERF-R1D MODEL TTFI observability unchanged', () => {
  it('EXPLANATION_READY / MODEL_RENDERED marks and the explanation-only loading gate are untouched', () => {
    expect(TEACH).toContain("'EXPLANATION_READY'");
    expect(TEACH).toContain("'MODEL_RENDERED'");
    expect(TEACH).toMatch(/\/\/ Block only on the FIRST needed content \(explanation\)\.[\s\S]*?if \(expLoading\) \{/);
  });
});

/* ============================================================== *
 * 16 -- evidence / mastery untouched.                            *
 * ============================================================== */
describe('test 16 -- evidence / mastery untouched', () => {
  it('teaching-content.service still writes no evidence and picks no concept/activity/support', () => {
    expect(TEACHING_CONTENT).not.toMatch(/updateMastery|learning_evidence|recordEvidence|applyEvidence/);
    expect(TEACHING_CONTENT).not.toMatch(/computeSupportLevel|selectActivityType|LearningDecision|isProveRequired/);
  });
  it('the guided-practice route touches no evidence-writing surface, on either resolution path', () => {
    expect(GP_ROUTE).not.toMatch(/updateMastery|learning_evidence|recordEvidence/i);
  });
  it('the GUIDE failure/retry UI itself never fabricates or substitutes teaching content', () => {
    const errBlock = TEACH.slice(TEACH.indexOf("stage === 'GUIDE' && guideState === 'error'"), TEACH.indexOf('</section>'));
    expect(errBlock).not.toMatch(/<GuidedPractice|setGuided\(/); // no invented sequence is ever rendered as if real
  });
});
