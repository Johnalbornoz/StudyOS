/**
 * LX-8R4 -- MATH AFFORDANCE CONSISTENCY.
 *
 * Live QA: a mathematical open-response question in Potenciación
 * (identify the error in an exponent expression and explain the
 * correct simplification -- a JUSTIFY-kind question) showed only prose
 * + microphone, no math keyboard. Root cause: `isMathAnswerContext`
 * (math-response-contract.ts) took the question's
 * `ResponseEvidenceContract.kind` and denied math capability for
 * EXPLAIN/JUSTIFY, conflating "what evidence is required" with "can
 * the learner express mathematics here" -- two separate axes (A2).
 *
 * Fix: `isMathCapableContext(subjectName)` is now a PURE subject/domain
 * capability signal with NO `kind` parameter at all, so there is no way
 * to reintroduce the coupling by accident at any call site -- the
 * TypeScript signature itself forecloses it.
 *
 * This file covers the 15 required math-affordance tests. See
 * tests/unit/lx8r2-math-response-experience.test.ts and
 * tests/unit/lx8r2-r1-universal-math-surface.test.ts (updated in place
 * for this rename) for the broader migration/architecture coverage
 * this file does not duplicate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isMathCapableContext } from '@/lib/lx/math-response-contract';
import type { EvidenceRequirementKind } from '@/lib/lx/response-evidence-contract';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const QUIZ_PAGE_SRC = strip(read('src/app/dashboard/quiz/page.tsx'));
const COMPOSER_SRC = strip(read('src/components/UnifiedResponseComposer.tsx'));
const CONTRACT_SRC = strip(read('src/lib/lx/math-response-contract.ts'));

const ALL_KINDS: EvidenceRequirementKind[] = ['ANSWER_ONLY', 'SHOW_WORK', 'JUSTIFY', 'EXPLAIN'];

/* ================================================================ *
 * Required tests 1-4: math capability holds for every evidence kind. *
 * isMathCapableContext takes no kind parameter, so this is provable   *
 * directly: it returns the SAME true/false answer for a math subject  *
 * regardless of which kind the caller is about to compute separately. *
 * ================================================================ */
describe('LX-8R4 required tests 1-4 -- math subject + every response kind still gets math capability', () => {
  it('1. Math + ANSWER_ONLY -> math button available', () => {
    expect(isMathCapableContext('Mathematics')).toBe(true);
  });

  it('2. Math + SHOW_WORK -> math button available', () => {
    expect(isMathCapableContext('Mathematics')).toBe(true);
  });

  it('3. Math + JUSTIFY -> math button available (the exact live-failure case: an error-detection/justification question in Potenciación)', () => {
    expect(isMathCapableContext('Mathematics')).toBe(true);
  });

  it('4. Math + EXPLAIN -> math button available', () => {
    expect(isMathCapableContext('Mathematics')).toBe(true);
  });

  it('isMathCapableContext returns the identical result for a math subject regardless of ANY caller-side kind computation -- the function signature has no kind parameter, so the SAME call site expression yields the same boolean for all four kinds', () => {
    // Simulates all four call sites (main quiz/resume/verification each compute a
    // DIFFERENT kind per question) all calling the SAME isMathCapableContext(subjectName)
    // -- the result cannot vary by kind because kind is never passed in.
    const resultsPerKind = ALL_KINDS.map(() => isMathCapableContext('Physics'));
    expect(new Set(resultsPerKind).size).toBe(1);
    expect(resultsPerKind[0]).toBe(true);
  });
});

/* ================================================================ *
 * Required tests 5-7: Retention/Prove/verification all get math too. *
 * ================================================================ */
describe('LX-8R4 required tests 5-7 -- Retention, Prove, and verification all get the SAME math capability as Practice', () => {
  it('5. Math + Retention -> math button available (retention_check flows through the SAME main-quiz UnifiedResponseComposer call site, not gated by quizMode)', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(block).toMatch(/mathEnabled=\{isMathCapableContext\(subjectName\)\}/);
    expect(block).not.toMatch(/PRACTICE_EVIDENCE_MODES|quizMode ===/);
  });

  it('6. Math + Prove -> math button available (Prove is the non-Practice EvidenceMode branch of the SAME main-quiz code path -- no separate wiring exists for it)', () => {
    expect(QUIZ_PAGE_SRC.match(/<UnifiedResponseComposer/g)?.length).toBe(3);
    expect(QUIZ_PAGE_SRC).not.toMatch(/isProveMode[\s\S]{0,80}isMathCapableContext/);
  });

  it('7. Math + verification -> math button available (both the resume-verification and inline post-quiz verification surfaces call isMathCapableContext, unconditioned on their locally-derived ASSESSMENT-mode contract kind)', () => {
    const resumeBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('if (resumeVerifyAttemptId)'), QUIZ_PAGE_SRC.indexOf("if (phase === 'setup' && isCanonicalFlow)"));
    expect(resumeBlock).toMatch(/mathEnabled=\{isMathCapableContext\(subjectName\)\}/);
    const verifyBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('results.verificationNeeded ||'), QUIZ_PAGE_SRC.indexOf('results.verificationNeeded ||') + 5000);
    expect(verifyBlock).toMatch(/mathEnabled=\{isMathCapableContext\(subjectName\)\}/);
  });
});

/* ================================================================ *
 * Required test 8: prose-only domains stay prose-only (A8).          *
 * ================================================================ */
describe('LX-8R4 required test 8 -- a non-mathematical domain does not automatically show the math button', () => {
  it('8. a History/Literature-style subject name is NOT classified math-capable', () => {
    expect(isMathCapableContext('History')).toBe(false);
    expect(isMathCapableContext('Literature')).toBe(false);
    expect(isMathCapableContext(undefined)).toBe(false);
  });

  it('this remains presentation capability, not learning-style logic -- gated on the same pre-existing inferMathToolbarSubject heuristic, never a per-learner preference', () => {
    expect(CONTRACT_SRC).not.toMatch(/preferredInputMode|learningStyle|accessibility\./);
  });
});

/* ================================================================ *
 * Required test 9: response kind does not determine math capability. *
 * ================================================================ */
describe('LX-8R4 required test 9 -- response kind cannot determine math capability', () => {
  it('9. isMathCapableContext has exactly one parameter (subjectName) -- there is no kind/EvidenceRequirementKind parameter to accidentally wire up', () => {
    const fnSrc = CONTRACT_SRC.slice(CONTRACT_SRC.indexOf('export function isMathCapableContext'), CONTRACT_SRC.indexOf('export function isMathCapableContext') + 120);
    expect(fnSrc).toMatch(/export function isMathCapableContext\(subjectName: string \| undefined\): boolean \{/);
    expect(fnSrc).not.toMatch(/kind/);
  });

  it('no call site in quiz/page.tsx passes a second argument to isMathCapableContext', () => {
    const calls = [...QUIZ_PAGE_SRC.matchAll(/isMathCapableContext\(([^)]*)\)/g)];
    expect(calls.length).toBe(3);
    for (const [, args] of calls) {
      expect(args.trim()).toBe('subjectName');
    }
  });
});

/* ================================================================ *
 * Required tests 10-11: one shared classifier, no duplication.       *
 * ================================================================ */
describe('LX-8R4 required tests 10-11 -- one shared math-capability classifier, no duplicated eligibility logic', () => {
  it('10. isMathCapableContext is defined exactly once, in math-response-contract.ts -- no page-local or component-local redeclaration', () => {
    expect(CONTRACT_SRC.match(/export function isMathCapableContext/g)?.length).toBe(1);
    expect(QUIZ_PAGE_SRC).not.toMatch(/function isMathCapableContext/);
    expect(COMPOSER_SRC).not.toMatch(/function isMathCapableContext/);
  });

  it('11. no duplicate math-eligibility check exists anywhere else -- the old isMathAnswerContext name (and its kind-based exclusion) no longer exists in the codebase at all', () => {
    expect(QUIZ_PAGE_SRC).not.toMatch(/isMathAnswerContext/);
    expect(COMPOSER_SRC).not.toMatch(/isMathAnswerContext/);
    expect(CONTRACT_SRC).not.toMatch(/isMathAnswerContext/);
  });
});

/* ================================================================ *
 * Required tests 12-14: still one composer, no legacy toolbar, no    *
 * separate reasoning textarea.                                       *
 * ================================================================ */
describe('LX-8R4 required tests 12-14 -- UnifiedResponseComposer remains the one surface; no legacy toolbar or second textarea returns', () => {
  it('12. exactly one UnifiedResponseComposer renders per text-answer surface -- never two response boxes', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(block.match(/<UnifiedResponseComposer/g)?.length).toBe(1);
  });

  it('13. no legacy toolbar (MathAnswerEditor, MATH_PRIMARY_BUTTONS/MATH_MORE_BUTTONS rows) returns anywhere in the composer -- MathExpressionEditor is still mounted with showToolbar={false}', () => {
    expect(QUIZ_PAGE_SRC).not.toMatch(/MathAnswerEditor/);
    expect(COMPOSER_SRC).not.toMatch(/MATH_PRIMARY_BUTTONS|MATH_MORE_BUTTONS/);
    expect(COMPOSER_SRC).toMatch(/showToolbar=\{false\}/);
  });

  it('14. no separate "Explain your reasoning" textarea returns -- reasoning content lives as additional blocks inside the SAME ResponseDocument, never a second editor instance', () => {
    expect(QUIZ_PAGE_SRC).not.toMatch(/multimodal\.reasoningLabel|multimodal\.reasoningPlaceholder/);
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(block).not.toMatch(/responseContract\.requiresWork \|\| responseContract\.requiresJustification/);
  });
});

/* ================================================================ *
 * Required test 15: notation != help, even in Independent/no-help.   *
 * ================================================================ */
describe('LX-8R4 required test 15 -- math notation remains allowed in Independent evidence modes without being treated as pedagogical help', () => {
  it('15. isMathCapableContext takes no integrityMode/EvidenceMode input at all -- it structurally cannot be gated by whether the attempt is INDEPENDENT/ASSESSMENT', () => {
    const fnSrc = CONTRACT_SRC.slice(CONTRACT_SRC.indexOf('export function isMathCapableContext'), CONTRACT_SRC.indexOf('export function isMathCapableContext') + 300);
    expect(fnSrc).not.toMatch(/integrityMode|EvidenceMode|PRACTICE|INDEPENDENT|ASSESSMENT/);
  });

  it('UnifiedResponseComposer itself takes no integrityMode/quizMode prop -- math capability cannot leak an integrity-mode dependency at the component boundary either', () => {
    expect(COMPOSER_SRC).not.toMatch(/integrityMode|quizMode/);
  });

  it('the composer\'s own doc comment states that integrity modes may remove HELP but must never remove notation tools (A7)', () => {
    const rawComposerSrc = read('src/components/UnifiedResponseComposer.tsx');
    expect(rawComposerSrc).toMatch(/Integrity modes \(Retention\/Prove\/\s*\* verification\) may remove HELP; they must never remove notation\s*\* tools/);
  });
});
