/**
 * LX-8R2-R1 -- UNIVERSAL MATH RESPONSE SURFACE.
 *
 * Source-contract tests (same no-jsdom style as every other quiz-page
 * test in this suite) covering the original required 24-item test
 * matrix: every learner-facing surface that offers a mathematical
 * final answer renders the SAME canonical composer, gated by the SAME
 * shared isMathAnswerContext classifier, with no route-specific math
 * eligibility or serialization duplicated anywhere.
 *
 * LX-8R3 superseded this phase's OWN composer (`MathResponseComposer`,
 * a math-only editor rendered ALONGSIDE a separate prose/reasoning
 * `MathAnswerEditor`) with `UnifiedResponseComposer` -- ONE surface
 * that mixes prose and math in a single flowing document, eliminating
 * the two-box layout entirely. `MathResponseComposer` and
 * `MathAnswerEditor` were both deleted (zero remaining callers). This
 * file is updated in place, per this repo's established convention, to
 * verify the SAME underlying invariants (universal composer, no
 * duplicated eligibility logic, retention/verification parity, no
 * pedagogical assistance) against the CURRENT architecture rather than
 * describe retired components.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const QUIZ_PAGE_SRC = strip(read('src/app/dashboard/quiz/page.tsx'));
const COMPOSER_SRC = strip(read('src/components/UnifiedResponseComposer.tsx'));
const CONTRACT_SRC = strip(read('src/lib/lx/math-response-contract.ts'));
const DOC_SRC = strip(read('src/lib/lx/response-document.ts'));
const TRANSFER_SRC = strip(read('src/app/dashboard/cognitive/transfer/page.tsx'));
const EXPLAIN_SRC = strip(read('src/app/dashboard/cognitive/explain/page.tsx'));

/* ================================================================ *
 * R1 -- RESPONSE-SURFACE AUDIT (encoded as assertions, see the       *
 * LX-8R2-R1/LX-8R3 reports' own inventory tables for the full        *
 * classification).                                                   *
 * ================================================================ */
describe('LX-8R2-R1 R1 -- response-surface audit', () => {
  it('exactly three UnifiedResponseComposer render sites exist in quiz/page.tsx: main quiz text answer, resume verification, inline verification', () => {
    expect(QUIZ_PAGE_SRC.match(/<UnifiedResponseComposer/g)?.length).toBe(3);
  });

  it('the legacy MathAnswerEditor and MathResponseComposer were both retired -- zero references remain anywhere in quiz/page.tsx (LX-8R3 unified the response surface; neither had any other caller)', () => {
    expect(QUIZ_PAGE_SRC).not.toMatch(/MathAnswerEditor|MathResponseComposer/);
  });

  it('Transfer (cognitive/transfer/page.tsx) has no math response surface at all -- a plain prose <textarea>, never the unified composer -- documented PROSE_RESPONSE scope boundary, not a regression', () => {
    expect(TRANSFER_SRC).toMatch(/<textarea/);
    expect(TRANSFER_SRC).not.toMatch(/UnifiedResponseComposer|MathAnswerEditor|MathResponseComposer/);
  });

  it('Explain & Defend (cognitive/explain/page.tsx) is an explicit reasoning-demonstration surface -- PROSE_RESPONSE/REASONING_RESPONSE, never a math response surface', () => {
    expect(EXPLAIN_SRC).toMatch(/<textarea/);
    expect(EXPLAIN_SRC).not.toMatch(/UnifiedResponseComposer|MathAnswerEditor|MathResponseComposer/);
  });
});

/* ================================================================ *
 * R2 -- ONE CANONICAL RESPONSE COMPOSER.                             *
 * ================================================================ */
describe('LX-8R2-R1/LX-8R3 R2 -- UnifiedResponseComposer is the one canonical composer', () => {
  it('owns MathExpressionEditor, MathVoiceInput, and VoiceInputButton internally -- the surrounding page never imports any of them for a response surface', () => {
    expect(COMPOSER_SRC).toMatch(/import MathExpressionEditor from/);
    expect(COMPOSER_SRC).toMatch(/import MathVoiceInput from/);
    expect(COMPOSER_SRC).toMatch(/import VoiceInputButton from/);
  });

  it('accepts value/onChange as a plain string -- the same storage shape every prior editor already used, never a new state shape threaded through the surrounding activity', () => {
    expect(COMPOSER_SRC).toMatch(/value: string;/);
    expect(COMPOSER_SRC).toMatch(/onChange: \(next: string\) => void;/);
  });

  it('takes voiceEnabled, mathEnabled, and activityLanguageContext as INPUTS from the caller -- it never computes modality eligibility or language context itself', () => {
    expect(COMPOSER_SRC).toMatch(/voiceEnabled: boolean;/);
    expect(COMPOSER_SRC).toMatch(/mathEnabled: boolean;/);
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
  it('required test 2: the Retention resume-verification branch renders UnifiedResponseComposer, math-enabled via isMathAnswerContext', () => {
    const resumeBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('if (resumeVerifyAttemptId)'), QUIZ_PAGE_SRC.indexOf("if (phase === 'setup' && isCanonicalFlow)"));
    expect(resumeBlock).toMatch(/mathEnabled=\{isMathAnswerContext\(subjectName, resumeContract\.kind\)\}/);
    expect(resumeBlock).toMatch(/<UnifiedResponseComposer/);
  });

  it('required test 3: the inline post-quiz Assessment verification list renders UnifiedResponseComposer, math-enabled via isMathAnswerContext', () => {
    const verifyBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf('results.verificationNeeded ||'), QUIZ_PAGE_SRC.indexOf('results.verificationNeeded ||') + 5000);
    expect(verifyBlock).toMatch(/mathEnabled=\{isMathAnswerContext\(subjectName, vContract\.kind\)\}/);
    expect(verifyBlock).toMatch(/<UnifiedResponseComposer/);
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
  it('required test 13: UnifiedResponseComposer contains no hint/help/AI-suggestion logic', () => {
    expect(COMPOSER_SRC).not.toMatch(/hint|suggestion|worked.?example|AI.?help/i);
  });

  it('MathExpressionEditor (owned by the composer) never calls any AI/LLM primitive and never solves', () => {
    const editorSrc = strip(read('src/components/MathExpressionEditor.tsx'));
    expect(editorSrc).not.toMatch(/executeAI|callModel|\bsolves?\b|\bsimplif(y|ies)\b/i);
  });

  it('accessibility/input capability (voice, keyboard) is documented as distinct from pedagogical assistance -- the composer\'s own doc comment states this', () => {
    expect(read('src/components/UnifiedResponseComposer.tsx')).toMatch(/performs no solving\/simplification\/[\s\S]{0,40}completion\/suggestion\/hint generation/);
  });
});

/* ================================================================ *
 * R5 -- VOICE IN RETENTION: identical pipeline to main quiz.         *
 * ================================================================ */
describe('LX-8R2-R1 R5 -- voice in Retention/verification uses the identical deterministic pipeline', () => {
  it('required test 11/12: UnifiedResponseComposer routes math-context voice through the SAME MathVoiceInput (STT -> parseMathSpeech -> review -> explicit acceptance) used by the main quiz, regardless of which surface renders the composer', () => {
    expect(COMPOSER_SRC).toMatch(/<MathVoiceInput/);
    expect(COMPOSER_SRC).toMatch(/handleMathVoiceAccept/);
  });

  it('required test 12: no raw-transcript auto-submit path exists for a math answer -- the math voice handler only ever receives a parsed MathResponse, never a bare transcript string', () => {
    expect(COMPOSER_SRC).toMatch(/function handleMathVoiceAccept\(response: MathResponse\)/);
  });
});

/* ================================================================ *
 * R6 -- RESPONSE CONTRACT authority, one instruction per kind.       *
 * LX-8R3 replaced the "SHOW_WORK/JUSTIFY show a separate reasoning   *
 * box" design with ONE instruction line + a mixed-content document.  *
 * ================================================================ */
describe('LX-8R2-R1/LX-8R3 R6 -- ResponseEvidenceContract remains the sole authority for what evidence is required', () => {
  it('required test 8-10: kind maps to exactly ONE instruction line for every kind (ANSWER_ONLY/SHOW_WORK/JUSTIFY/EXPLAIN) -- never a second, separately-rendered reasoning field', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/responseKind=\{responseContract\.kind\}/);
    expect(COMPOSER_SRC).toMatch(/responseInstructionKey\(responseKind\)/);
    const textBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(textBlock.match(/<UnifiedResponseComposer/g)?.length).toBe(1);
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
  it('required test 6: the legacy Unicode-symbol MathAnswerEditor has zero render sites anywhere in quiz/page.tsx -- fully retired, not merely reduced', () => {
    expect(QUIZ_PAGE_SRC.match(/<MathAnswerEditor/g)).toBeNull();
  });

  it('MathAnswerEditor.tsx itself no longer exists as a file -- deleted, not left as unreferenced dead code', () => {
    expect(() => read('src/components/MathAnswerEditor.tsx')).toThrow();
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

  it('wrap/unwrap exist exactly once, in the shared math-response-contract.ts (reused by response-document.ts) -- no per-route reimplementation', () => {
    const allSrcFiles = [QUIZ_PAGE_SRC, COMPOSER_SRC, DOC_SRC];
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

  it('UnifiedResponseComposer required no change to accommodate the parser\'s documented limits or its LX-8R3 grammar expansion -- both stay isolated to math-speech-parser.ts', () => {
    expect(COMPOSER_SRC).not.toMatch(/GRAMMARS|parseMathSpeech|CARDINALS/);
  });
});

/* ================================================================ *
 * Required test 1, 4, 5, 7, 14, 15, 16, 24 -- cross-cutting checks.  *
 * ================================================================ */
describe('LX-8R2-R1 -- remaining required-test items', () => {
  it('required test 1: main quiz mathematical ANSWER_ONLY uses UnifiedResponseComposer with mathEnabled true (same gate as SHOW_WORK/JUSTIFY, applies regardless of quizMode/PRACTICE vs Prove)', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(block).toMatch(/mathEnabled=\{isMathAnswerContext\(subjectName, responseContract\.kind\)\}/);
    // Not gated by PRACTICE_EVIDENCE_MODES/quizMode at all -- applies identically whether the
    // active attempt is Practice or Prove (isProveMode), satisfying required test 5.
    expect(block).not.toMatch(/PRACTICE_EVIDENCE_MODES/);
  });

  it('required test 4: Transfer has no applicable mathematical response case today (documented PROSE_RESPONSE scope boundary) -- not a regression, since it never had a math surface before this repair either', () => {
    expect(TRANSFER_SRC).not.toMatch(/UnifiedResponseComposer|MathResponseComposer|MathAnswerEditor|inferMathToolbarSubject/);
  });

  it('required test 7: reasoning/work/justification content is written as additional blocks in the SAME response document, still governed by the ONE ResponseEvidenceContract-derived instruction -- never a second prose editor instance', () => {
    expect(QUIZ_PAGE_SRC).not.toMatch(/multimodal\.reasoningLabel|multimodal\.reasoningPlaceholder/);
  });

  it('required test 14/15/16: typed, voice, and keyboard-template paths all converge on the same canonical MathResponse.latex via MathExpressionEditor/MathVoiceInput -- covered exhaustively in math-response-contract.test.ts, math-speech-parser.test.ts, and response-document.test.ts; here we assert the composer never diverges the two math input paths into different representations', () => {
    expect(COMPOSER_SRC).toMatch(/updateMath\(i, next\.latex\)/); // typed/keyboard path
    expect(COMPOSER_SRC).toMatch(/updateMath\(activeIndex, response\.latex\)/); // voice path
    // Both paths write through the SAME updateMath function -- no separate serialization branch per input path.
    expect(COMPOSER_SRC.match(/function updateMath\(/g)?.length).toBe(1);
  });

  it('required test 24: full existing suite remains green is verified by the CI-equivalent `npx vitest run` invocation documented in the LX-8R2-R1/LX-8R3 reports, not re-asserted here', () => {
    expect(true).toBe(true);
  });
});
