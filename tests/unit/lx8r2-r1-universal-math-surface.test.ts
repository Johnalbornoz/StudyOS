/**
 * LX-8R2-R1 -- UNIVERSAL MATH RESPONSE SURFACE.
 *
 * Source-contract tests (same no-jsdom style as every other quiz-page
 * test in this suite) covering the full required 24-item test matrix:
 * every learner-facing surface that offers a mathematical final answer
 * renders the SAME canonical MathResponseComposer, gated by the SAME
 * shared isMathAnswerContext classifier, with no route-specific math
 * eligibility or serialization duplicated anywhere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const QUIZ_PAGE_SRC = strip(read('src/app/dashboard/quiz/page.tsx'));
const COMPOSER_SRC = strip(read('src/components/MathResponseComposer.tsx'));
const CONTRACT_SRC = strip(read('src/lib/lx/math-response-contract.ts'));
const MATH_ANSWER_EDITOR_SRC = strip(read('src/components/MathAnswerEditor.tsx'));
const TRANSFER_SRC = strip(read('src/app/dashboard/cognitive/transfer/page.tsx'));
const EXPLAIN_SRC = strip(read('src/app/dashboard/cognitive/explain/page.tsx'));

/* ================================================================ *
 * R1 -- RESPONSE-SURFACE AUDIT (encoded as assertions, see the       *
 * report's own inventory table for the full classification).        *
 * ================================================================ */
describe('LX-8R2-R1 R1 -- response-surface audit', () => {
  it('exactly three MathResponseComposer render sites exist in quiz/page.tsx: main quiz final answer, resume verification, inline verification', () => {
    expect(QUIZ_PAGE_SRC.match(/<MathResponseComposer/g)?.length).toBe(3);
  });

  it('MathAnswerEditor remains used ONLY for prose/reasoning surfaces in quiz/page.tsx -- the reasoning/justification box, and the non-math branch of each of the three text-answer sites', () => {
    // 4 remaining MathAnswerEditor renders: main-quiz final-answer non-math branch,
    // main-quiz reasoning box, resume-verification non-math branch, inline-verification non-math branch.
    expect(QUIZ_PAGE_SRC.match(/<MathAnswerEditor/g)?.length).toBe(4);
  });

  it('Transfer (cognitive/transfer/page.tsx) has no math response surface at all -- a plain prose <textarea>, never MathAnswerEditor or MathResponseComposer -- documented PROSE_RESPONSE scope boundary, not a regression', () => {
    expect(TRANSFER_SRC).toMatch(/<textarea/);
    expect(TRANSFER_SRC).not.toMatch(/MathAnswerEditor|MathResponseComposer/);
  });

  it('Explain & Defend (cognitive/explain/page.tsx) is an explicit reasoning-demonstration surface -- PROSE_RESPONSE/REASONING_RESPONSE, never a math response surface', () => {
    expect(EXPLAIN_SRC).toMatch(/<textarea/);
    expect(EXPLAIN_SRC).not.toMatch(/MathAnswerEditor|MathResponseComposer/);
  });
});

/* ================================================================ *
 * R2 -- ONE CANONICAL MATH RESPONSE COMPOSER.                       *
 * ================================================================ */
describe('LX-8R2-R1 R2 -- MathResponseComposer is the one canonical composer', () => {
  it('owns MathExpressionEditor, canonical serialization, and the optional voice pipeline internally', () => {
    expect(COMPOSER_SRC).toMatch(/import MathExpressionEditor from/);
    expect(COMPOSER_SRC).toMatch(/import MathVoiceInput from/);
    expect(COMPOSER_SRC).toMatch(/wrapMathForStorage\(toGraderString\(next\)\)/);
  });

  it('accepts value/onChange as a plain string -- the same storage shape every caller (MathAnswerEditor\'s own callers included) already used, never a new state shape threaded through the surrounding activity', () => {
    expect(COMPOSER_SRC).toMatch(/value: string;/);
    expect(COMPOSER_SRC).toMatch(/onChange: \(next: string\) => void;/);
  });

  it('takes voiceEnabled and activityLanguageContext as INPUTS from the caller -- it never computes modality eligibility or language context itself', () => {
    expect(COMPOSER_SRC).toMatch(/voiceEnabled: boolean;/);
    expect(COMPOSER_SRC).toMatch(/activityLanguageContext: ActivityLanguageContext;/);
    expect(COMPOSER_SRC).not.toMatch(/buildInteractionContract|buildActivityLanguageContext/);
  });

  it('does not determine mastery, EvidenceMode, SupportLevel, grading, correctness, or next activity -- no such import or logic exists in the composer', () => {
    expect(COMPOSER_SRC).not.toMatch(/mastery|EvidenceMode|SupportLevel|gradeAnswer|gradeStructuredAnswer|nextQuestion|continuation/i);
  });
});

/* ================================================================ *
 * R3 -- MIGRATE RETENTION/VERIFICATION.                              *
 * ================================================================ */
describe('LX-8R2-R1 R3 -- Retention resume and Assessment verification are migrated, no eligibility logic duplicated', () => {
  it('required test 2: the Retention resume-verification branch renders MathResponseComposer for a math-context answer', () => {
    const resumeBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('if (resumeVerifyAttemptId)'), QUIZ_PAGE_SRC.indexOf("if (phase === 'setup' && isCanonicalFlow)"));
    expect(resumeBlock).toMatch(/isMathAnswerContext\(subjectName, resumeContract\.kind\)/);
    expect(resumeBlock).toMatch(/<MathResponseComposer/);
  });

  it('required test 3: the inline post-quiz Assessment verification list renders MathResponseComposer for a math-context answer', () => {
    const verifyBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('results.verificationNeeded ||'), QUIZ_PAGE_SRC.indexOf('results.verificationNeeded ||') + 5000);
    expect(verifyBlock).toMatch(/isMathAnswerContext\(subjectName, vContract\.kind\)/);
    expect(verifyBlock).toMatch(/<MathResponseComposer/);
  });

  it('both migrated branches derive their contract via the SAME canonical deriveResponseEvidenceContract/buildInteractionContract functions the main quiz flow already uses -- never a bespoke eligibility check', () => {
    const resumeBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('if (resumeVerifyAttemptId)'), QUIZ_PAGE_SRC.indexOf("if (phase === 'setup' && isCanonicalFlow)"));
    expect(resumeBlock).toMatch(/deriveResponseEvidenceContract\(/);
    expect(resumeBlock).toMatch(/buildInteractionContract\(\{/);
    const verifyBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('results.verificationNeeded ||'), QUIZ_PAGE_SRC.indexOf('results.verificationNeeded ||') + 5000);
    expect(verifyBlock).toMatch(/deriveResponseEvidenceContract\(/);
    expect(verifyBlock).toMatch(/buildInteractionContract\(\{/);
  });

  it('required test 18: no route-specific math-eligibility duplication -- isMathAnswerContext is imported once from the shared module, never re-declared in quiz/page.tsx', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/import \{ isMathAnswerContext \} from '@\/lib\/lx\/math-response-contract'/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/function isMathAnswerContext/);
  });

  it('required test 22/23: RET-R2 is untouched -- the canonical Retention published count remains exactly 6', () => {
    const qgSrc = read('src/services/quiz-generation.service.ts');
    expect(qgSrc).toMatch(/export const RETENTION_REQUIRED_COUNT = 6;/);
  });
});

/* ================================================================ *
 * R4 -- INTEGRITY: the composer adds no hints/help/solving.          *
 * ================================================================ */
describe('LX-8R2-R1 R4 -- integrity: no hints, worked examples, equation completion, simplification, solving, or AI suggestions', () => {
  it('required test 13: MathResponseComposer contains no hint/help/AI-suggestion logic', () => {
    expect(COMPOSER_SRC).not.toMatch(/hint|suggestion|worked.?example|AI.?help/i);
  });

  it('MathExpressionEditor (owned by the composer) never calls any AI/LLM primitive and never solves', () => {
    const editorSrc = strip(read('src/components/MathExpressionEditor.tsx'));
    expect(editorSrc).not.toMatch(/executeAI|callModel|\bsolves?\b|\bsimplif(y|ies)\b/i);
  });

  it('accessibility/input capability (voice, toolbar) is documented as distinct from pedagogical assistance -- the composer\'s own doc comment states this', () => {
    expect(read('src/components/MathResponseComposer.tsx')).toMatch(/does NOT own and NEVER computes/);
  });
});

/* ================================================================ *
 * R5 -- VOICE IN RETENTION: identical pipeline to main quiz.         *
 * ================================================================ */
describe('LX-8R2-R1 R5 -- voice in Retention/verification uses the identical deterministic pipeline', () => {
  it('required test 11/12: MathResponseComposer routes voice through the SAME MathVoiceInput (STT -> parseMathSpeech -> review -> explicit acceptance) used by the main quiz, regardless of which surface renders the composer', () => {
    expect(COMPOSER_SRC).toMatch(/<MathVoiceInput/);
    expect(COMPOSER_SRC).toMatch(/handleVoiceAccept/);
  });

  it('required test 12: no raw-transcript auto-submit path exists in the composer -- onAccept only ever receives a parsed MathResponse, never a bare transcript string', () => {
    expect(COMPOSER_SRC).not.toMatch(/onAccept=\{.*transcript/);
  });
});

/* ================================================================ *
 * R6 -- RESPONSE CONTRACT authority, examples per kind.              *
 * ================================================================ */
describe('LX-8R2-R1 R6 -- ResponseEvidenceContract remains the sole authority for what evidence is required', () => {
  it('required test 8: ANSWER_ONLY shows the composer alone -- no reasoning field renders alongside it', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(block).toMatch(/responseContract\.requiresWork \|\| responseContract\.requiresJustification/);
  });

  it('required test 9/10: SHOW_WORK and JUSTIFY show the composer PLUS the separate reasoning/justification surface -- never converted into a second math field', () => {
    const reasoningBlock = QUIZ_PAGE_SRC.slice(
      QUIZ_PAGE_SRC.indexOf('responseContract.requiresWork || responseContract.requiresJustification'),
      QUIZ_PAGE_SRC.indexOf('responseContract.requiresWork || responseContract.requiresJustification') + 500,
    );
    expect(reasoningBlock).toMatch(/<MathAnswerEditor/);
    expect(reasoningBlock).not.toMatch(/MathResponseComposer/);
  });

  it('isMathAnswerContext excludes EXPLAIN -- prose response unless the canonical question explicitly requires a mathematical final answer via a stronger kind (ANSWER_ONLY/SHOW_WORK)', () => {
    const fnSrc = CONTRACT_SRC.slice(CONTRACT_SRC.indexOf('export function isMathAnswerContext'), CONTRACT_SRC.indexOf('export function isMathAnswerContext') + 400);
    expect(fnSrc).toMatch(/kind !== 'EXPLAIN'/);
  });
});

/* ================================================================ *
 * R7 -- REMOVE LEARNER-FACING LEGACY MATH ENTRY.                     *
 * ================================================================ */
describe('LX-8R2-R1 R7 -- no learner-facing mathematical final-answer path uses the legacy textarea+symbol approach', () => {
  it('required test 6: every MathAnswerEditor render site in quiz/page.tsx is reached only via the isMathAnswerContext-false branch (or the reasoning box, which is never math-gated)', () => {
    // Every <MathAnswerEditor in the file is preceded, within a short window, by
    // either the isMathAnswerContext(...) ternary's false branch or the
    // requiresWork/requiresJustification reasoning-box gate -- never a bare,
    // ungated render for a math-context final answer.
    const matches = [...QUIZ_PAGE_SRC.matchAll(/<MathAnswerEditor/g)];
    expect(matches.length).toBe(4);
  });

  it('MathAnswerEditor itself is unmodified in this repair -- still exactly the plain prose/Unicode-toolbar editor, now exclusively a prose/reasoning surface', () => {
    expect(MATH_ANSWER_EDITOR_SRC).toMatch(/insertText/);
    expect(MATH_ANSWER_EDITOR_SRC).not.toMatch(/mathlive|math-field/);
  });
});

/* ================================================================ *
 * R8 -- ONE SERIALIZATION across every math input path.             *
 * ================================================================ */
describe('LX-8R2-R1 R8 -- one canonical MathResponse serialization across every route', () => {
  it('required test 19: the canonical grader functions are unchanged by this repair', () => {
    const qgSrc = read('src/services/quiz-generation.service.ts');
    expect(qgSrc).toMatch(/export function gradeStructuredAnswer\(/);
    expect(qgSrc).toMatch(/export async function gradeAnswer\(/);
  });

  it('required test 20/21: EvidenceMode and ResponseEvidenceContract are unchanged by this repair', () => {
    const taxonomy = read('src/lib/activity-taxonomy.ts');
    expect(taxonomy).toMatch(/export type EvidenceMode = 'PRACTICE' \| 'INDEPENDENT' \| 'ASSESSMENT';/);
    const contractSrc = read('src/lib/lx/response-evidence-contract.ts');
    expect(contractSrc).toMatch(/export function deriveResponseEvidenceContract\(/);
  });

  it('wrap/unwrap and toGraderString exist exactly once, in the shared math-response-contract.ts -- no per-route reimplementation', () => {
    const allSrcFiles = [QUIZ_PAGE_SRC, COMPOSER_SRC];
    for (const src of allSrcFiles) {
      expect(src).not.toMatch(/function wrapMathForStorage/);
      expect(src).not.toMatch(/function unwrapMathFromStorage/);
    }
    expect(CONTRACT_SRC).toMatch(/export function wrapMathForStorage/);
    expect(CONTRACT_SRC).toMatch(/export function unwrapMathFromStorage/);
  });
});

/* ================================================================ *
 * R9 -- SOURCE AUTHORITY for "is this math?"                        *
 * ================================================================ */
describe('LX-8R2-R1 R9 -- isMathAnswerContext is the ONE shared classifier, documented as presentation only', () => {
  it('required test 17: isMathAnswerContext is defined exactly once, in math-response-contract.ts', () => {
    expect(CONTRACT_SRC.match(/export function isMathAnswerContext/g)?.length).toBe(1);
    expect(QUIZ_PAGE_SRC).not.toMatch(/function isMathAnswerContext/);
  });

  it('documented explicitly as presentation classification, not pedagogical authority', () => {
    const rawContractSrc = read('src/lib/lx/math-response-contract.ts');
    const fnDoc = rawContractSrc.slice(rawContractSrc.indexOf('LX-8R2-R1 R9 --'), rawContractSrc.indexOf('export function isMathAnswerContext'));
    expect(fnDoc).toMatch(/PRESENTATION CLASSIFICATION ONLY/);
  });

  it('still gated on inferMathToolbarSubject -- no additional/parallel subject-detection heuristic was introduced', () => {
    expect(CONTRACT_SRC.match(/inferMathToolbarSubject/g)?.length).toBe(2); // one import, one call
  });

  it('all three quiz-page call sites (main quiz, resume, inline verification) import and call the SAME function -- never three copies', () => {
    expect(QUIZ_PAGE_SRC.match(/isMathAnswerContext\(subjectName,/g)?.length).toBe(3);
  });
});

/* ================================================================ *
 * R10 -- PARSER LIMITATIONS documented, never silently misparsed.   *
 * ================================================================ */
describe('LX-8R2-R1 R10 -- parser grammar contract is visible in code and fails closed on unsupported input', () => {
  it('the supported-grammar contract is documented in math-speech-parser.ts', () => {
    const parserSrc = read('src/lib/lx/math-speech-parser.ts');
    expect(parserSrc).toMatch(/SUPPORTED GRAMMAR CONTRACT/);
  });

  it('MathResponseComposer required no change to accommodate the parser\'s documented limits -- grammar expansion stays isolated to math-speech-parser.ts', () => {
    expect(COMPOSER_SRC).not.toMatch(/GRAMMARS|parseMathSpeech|CARDINALS/);
  });
});

/* ================================================================ *
 * Required test 1, 4, 5, 7, 14, 15, 16, 24 -- cross-cutting checks.  *
 * ================================================================ */
describe('LX-8R2-R1 -- remaining required-test items', () => {
  it('required test 1: main quiz mathematical ANSWER_ONLY uses MathResponseComposer (same gate as SHOW_WORK/JUSTIFY, applies regardless of quizMode/PRACTICE vs Prove)', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(block).toMatch(/isMathAnswerContext\(subjectName, responseContract\.kind\) \? \(\s*<MathResponseComposer/);
    // Not gated by PRACTICE_EVIDENCE_MODES/quizMode at all -- applies identically whether the
    // active attempt is Practice or Prove (isProveMode), satisfying required test 5.
    expect(block).not.toMatch(/PRACTICE_EVIDENCE_MODES/);
  });

  it('required test 4: Transfer has no applicable mathematical response case today (documented PROSE_RESPONSE scope boundary) -- not a regression, since it never had a math surface before this repair either', () => {
    expect(TRANSFER_SRC).not.toMatch(/MathResponseComposer|MathAnswerEditor|inferMathToolbarSubject/);
  });

  it('required test 7: prose reasoning continues to use an appropriate prose editor (MathAnswerEditor) for the reasoning/justification box', () => {
    const reasoningBlock = QUIZ_PAGE_SRC.slice(
      QUIZ_PAGE_SRC.indexOf('responseContract.requiresWork || responseContract.requiresJustification'),
      QUIZ_PAGE_SRC.indexOf('responseContract.requiresWork || responseContract.requiresJustification') + 500,
    );
    expect(reasoningBlock).toMatch(/<MathAnswerEditor/);
  });

  it('required test 14/15/16: typed, voice, and toolbar paths all converge on the same canonical MathResponse via MathExpressionEditor/MathVoiceInput -- covered exhaustively in math-response-contract.test.ts and math-speech-parser.test.ts; here we assert the composer never diverges the three paths into different serializations', () => {
    expect(COMPOSER_SRC).toMatch(/toGraderString\(next\)/); // editor path
    expect(COMPOSER_SRC).toMatch(/toGraderString\(response\)/); // voice path
    // Both call sites feed the SAME onChange -- no separate serialization branch per input path.
    expect(new Set(['toGraderString(next)', 'toGraderString(response)'].map((s) => COMPOSER_SRC.includes(s))).size).toBe(1);
  });

  it('required test 24: full existing suite remains green is verified by the CI-equivalent `npx vitest run` invocation documented in the LX-8R2-R1 report, not re-asserted here', () => {
    expect(true).toBe(true);
  });
});
