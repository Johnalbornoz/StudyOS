/**
 * LX-8R2 -- PROFESSIONAL MATH RESPONSE EXPERIENCE.
 *
 * Source-contract tests (same style as lx8r1-multimodal-authority-
 * repair.test.ts): this codebase's quiz surface has no jsdom/RTL
 * rendering harness (vitest.config.mts runs environment: 'node'), so
 * component-level behavior is verified by asserting the actual wiring
 * in the built source, plus full behavioral coverage of every pure
 * function (MathSpeechParser has its own dedicated 49-test file;
 * MathResponse contract has its own dedicated file). This file covers
 * R1 (STT/interpretation separation), R4 (SSR safety), R6 (no raw
 * LaTeX exposure), R7 (voice pipeline), R8 (response-contract
 * integration, never both boxes unnecessarily), R11 (mobile), R13
 * (accessibility), R14 (language architecture), R15 (observability),
 * and R16 (the FAIL/PASS quality bar itself).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const QUIZ_PAGE_SRC = strip(read('src/app/dashboard/quiz/page.tsx'));
const EDITOR_SRC = strip(read('src/components/MathExpressionEditor.tsx'));
const COMPOSER_SRC = strip(read('src/components/UnifiedResponseComposer.tsx'));
const VOICE_INPUT_SRC = strip(read('src/app/dashboard/MathVoiceInput.tsx'));
const PARSER_SRC = strip(read('src/lib/lx/math-speech-parser.ts'));
const CONTRACT_SRC = strip(read('src/lib/lx/math-response-contract.ts'));
const DOC_SRC = strip(read('src/lib/lx/response-document.ts'));
const OBS_SRC = strip(read('src/lib/lx/multimodal-observability.ts'));
const PACKAGE_JSON = JSON.parse(read('package.json'));

/**
 * LX-8R2-R1/LX-8R3: MathExpressionEditor/MathVoiceInput are no longer
 * imported directly by any page -- they are implementation details
 * owned by `UnifiedResponseComposer` (LX-8R3's ONE canonical response
 * surface, which retired LX-8R2-R1's `MathResponseComposer` -- see
 * tests/unit/lx8r2-r1-universal-math-surface.test.ts for the full
 * extraction/migration coverage, since updated in place for the
 * unified surface). The assertions below are updated in place to read
 * from the CURRENT architecture rather than re-describe a retired one.
 */

/* ================================================================ *
 * R16 -- the quality bar itself: this is NOT still a textarea plus   *
 * symbol insertion for math answers.                                 *
 * ================================================================ */
describe('LX-8R2 R16 -- quality bar: the math answer surface is a real structured editor, not a textarea+symbols', () => {
  it('MathExpressionEditor renders a <math-field> custom element, never a <textarea>', () => {
    expect(EDITOR_SRC).toMatch(/document\.createElement\('math-field'\)/);
    expect(EDITOR_SRC).not.toMatch(/<textarea/);
  });

  it('the quiz page uses UnifiedResponseComposer (not the retired MathAnswerEditor) for the text-answer surface, math-enabled via isMathCapableContext (LX-8R4: a pure subject/domain capability signal, no kind parameter)', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/<UnifiedResponseComposer/);
    expect(QUIZ_PAGE_SRC).toMatch(/mathEnabled=\{isMathCapableContext\(subjectName\)\}/);
  });

  it('toolbar buttons manipulate the editor MODEL via structured LaTeX templates (insert), never plain string concatenation into a value prop', () => {
    expect(EDITOR_SRC).toMatch(/fieldRef\.current\?\.insert\(button\.insertLatex/);
    expect(EDITOR_SRC).not.toMatch(/insertText/); // that was MathAnswerEditor's plain-text convention; the structured editor never uses it
  });
});

/* ================================================================ *
 * R1 -- STT (transcription) and math interpretation are separate     *
 * stages; STT is never asked to solve math, and the raw transcript   *
 * never becomes the answer directly for a math question.             *
 * ================================================================ */
describe('LX-8R2 R1 -- STT/math-interpretation separation', () => {
  it('VoiceInputButton (the STT layer) is untouched -- it still only ever hands back the transcript it was given, no math parsing inside it', () => {
    const voiceInputButtonSrc = strip(read('src/app/dashboard/VoiceInputButton.tsx'));
    expect(voiceInputButtonSrc).not.toMatch(/parseMathSpeech|latex/i);
  });

  it('MathVoiceInput wraps VoiceInputButton and runs the transcript through parseMathSpeech -- never writes the raw transcript directly into the math answer', () => {
    expect(VOICE_INPUT_SRC).toMatch(/import VoiceInputButton from/);
    expect(VOICE_INPUT_SRC).toMatch(/parseMathSpeech\(transcript, props\.expectedResponseLanguage\)/);
    expect(VOICE_INPUT_SRC).not.toMatch(/onAccept\(createMathResponse\(transcript\)\)/); // never the raw transcript passed straight through as the answer
  });

  it('the math parser file contains no call to any AI/LLM execution primitive -- purely deterministic', () => {
    expect(PARSER_SRC).not.toMatch(/executeAI|callModel|fetch\(/);
  });
});

/* ================================================================ *
 * R4 -- SSR safety.                                                  *
 * ================================================================ */
describe('LX-8R2 R4 -- SSR-safe integration', () => {
  it('the quiz page loads the ONE canonical UnifiedResponseComposer with ssr:false, same pattern as every other browser-only modality control -- it never imports MathExpressionEditor/MathVoiceInput/VoiceInputButton directly for a response surface', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/const UnifiedResponseComposer = dynamic\(\(\) => import\('@\/components\/UnifiedResponseComposer'\), \{ ssr: false \}\)/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/import\(.@\/components\/MathExpressionEditor.\)/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/import\(.*MathVoiceInput.\)/);
  });

  it('MathExpressionEditor never touches document/customElements at module-eval time -- only inside a client effect, guarded by a window check', () => {
    expect(EDITOR_SRC).toMatch(/typeof window === 'undefined'/);
    expect(EDITOR_SRC).toMatch(/useEffect\(/);
  });

  it('mathlive is declared as a real, pinned dependency (not a dev-only or optional one)', () => {
    expect(PACKAGE_JSON.dependencies.mathlive).toBeTruthy();
  });
});

/* ================================================================ *
 * R6 -- learner never forced to read/write raw LaTeX; canonical      *
 * serialization is internal.                                         *
 * ================================================================ */
describe('LX-8R2 R6 -- native typesetting, LaTeX stays internal', () => {
  it('the mathfield element itself renders typography natively -- this codebase adds no custom LaTeX-to-visual rendering logic of its own inside the editor', () => {
    expect(EDITOR_SRC).not.toMatch(/katex\.renderToString/); // that's MathText's job for READ-ONLY display, not this editor
  });

  it('the voice-understood review surface renders the parsed result as real math (MathText), never as a raw LaTeX string dump', () => {
    expect(VOICE_INPUT_SRC).toMatch(/<MathText text=\{`\$\$\{parsed\.latex\}\$`\}/);
  });
});

/* ================================================================ *
 * R7 -- voice-to-math pipeline: review before acceptance, graceful   *
 * degradation on parse failure, no auto-guessing.                    *
 * ================================================================ */
describe('LX-8R2 R7 -- voice-to-math pipeline never silently guesses, always requires explicit acceptance', () => {
  it('a successful parse is shown for review ("StudyUS understood") and requires an explicit accept click before onAccept fires', () => {
    expect(VOICE_INPUT_SRC).toMatch(/mathExpression\.voiceUnderstood/);
    expect(VOICE_INPUT_SRC).toMatch(/function acceptParsed\(\)/);
    expect(VOICE_INPUT_SRC).toMatch(/onClick=\{acceptParsed\}/);
  });

  it('a failed parse shows the raw transcript plus the neutral "could not convert" message -- never an auto-populated guess', () => {
    expect(VOICE_INPUT_SRC).toMatch(/mathExpression\.voiceParseFailedMessage/);
    expect(VOICE_INPUT_SRC).toMatch(/mathExpression\.voiceRawTranscriptLabel/);
  });

  it('props.onAccept is only ever called from acceptParsed -- never from the transcript-accepted handler directly', () => {
    const handlerBody = VOICE_INPUT_SRC.slice(VOICE_INPUT_SRC.indexOf('function handleTranscriptAccepted'), VOICE_INPUT_SRC.indexOf('function acceptParsed'));
    expect(handlerBody).not.toMatch(/props\.onAccept/);
  });
});

/* ================================================================ *
 * R8 -- response-contract integration. LX-8R3 superseded the         *
 * "separate math-answer box + separate reasoning box" design this    *
 * block originally verified: ResponseEvidenceContract.kind now maps  *
 * to the ONE UnifiedResponseComposer's single instruction line       *
 * (responseInstructionKey). LX-8R4 REPAIR: math capability            *
 * (isMathCapableContext) is now a PURE subject/domain signal, no      *
 * longer gated on `kind` at all -- Live QA proved that coupling wrong *
 * (a JUSTIFY-kind math question was silently denied its math          *
 * keyboard). See tests/unit/lx8r4-math-affordance-consistency.test.ts *
 * for the full LX-8R4 required-test coverage; this block is updated   *
 * in place to describe the CURRENT (correct) decoupled behavior.      *
 * ================================================================ */
describe('LX-8R2/LX-8R3/LX-8R4 R8 -- reuses the existing ResponseEvidenceContract, no second authority, no second box', () => {
  it('isMathCapableContext takes ONLY subjectName -- kind never gates math capability (LX-8R4 A2)', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/isMathCapableContext\(subjectName\)/);
    expect(QUIZ_PAGE_SRC).toMatch(/responseKind=\{responseContract\.kind\}/);
    expect(CONTRACT_SRC).toMatch(/export function isMathCapableContext\(subjectName: string \| undefined\): boolean \{/);
  });

  it('LX-8R4: no EvidenceRequirementKind is excluded from math capability -- ANSWER_ONLY/SHOW_WORK/JUSTIFY/EXPLAIN all get the SAME math affordance in a math-capable subject', () => {
    const fnSrc = CONTRACT_SRC.slice(CONTRACT_SRC.indexOf('export function isMathCapableContext'), CONTRACT_SRC.indexOf('export function isMathCapableContext') + 300);
    expect(fnSrc).not.toMatch(/kind/);
    expect(fnSrc).toMatch(/return subject === 'mathematics' \|\| subject === 'physics';/);
  });

  it('LX-8R3: there is no longer a separate reasoning box at all -- the old requiresWork||requiresJustification-gated second MathAnswerEditor was retired; SHOW_WORK/JUSTIFY content lives as additional blocks inside the SAME ResponseDocument', () => {
    expect(QUIZ_PAGE_SRC).not.toMatch(/responseContract\.requiresWork \|\| responseContract\.requiresJustification/);
    const textBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(textBlock.match(/<UnifiedResponseComposer/g)?.length).toBe(1); // exactly one response surface, never two
  });

  it('responseInstructionKey (response-evidence-contract.ts) is the ONE mapping from kind to instruction copy -- exhaustively tested in tests/unit/lx1-response-evidence-contract.test.ts', () => {
    expect(COMPOSER_SRC).toMatch(/responseInstructionKey\(responseKind\)/);
  });
});

/* ================================================================ *
 * R9/R10 -- grader compatibility: dedicated file exists (math-       *
 * response-contract.test.ts); here we assert the WIRING uses it.     *
 * ================================================================ */
describe('LX-8R2/LX-8R3 R9/R10 -- the canonical serialization is fed to the grader, never a toolbar/DOM-scraped value', () => {
  it('UnifiedResponseComposer reads each math block\'s output via MathResponse.latex directly (never response.plainText, never a raw DOM read) -- the $-wrapping for the grader happens once, at the DOCUMENT level, in response-document.ts\'s toGraderText, never per-keystroke inside the composer', () => {
    expect(COMPOSER_SRC).toMatch(/updateMath\(i, next\.latex\)/);
    expect(COMPOSER_SRC).toMatch(/updateMath\(activeIndex, response\.latex\)/);
    expect(COMPOSER_SRC).not.toMatch(/\.plainText/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/toGraderString/);
  });

  it('the ONE grader-facing transform is toGraderText (response-document.ts), called exactly once, from encodeCurrentAnswer\'s text case -- never duplicated per page or per component', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/return toGraderText\(deserializeResponseDocument\(textAnswer\)\);/);
    expect(DOC_SRC).toMatch(/export function toGraderText\(doc: ResponseDocument\): string/);
  });

  it('math blocks are wrapped in the SAME $...$ convention MathText already renders, so Review needs zero changes -- wrap/unwrap live once in the shared math-response-contract.ts, reused by response-document.ts, never duplicated per page', () => {
    expect(CONTRACT_SRC).toMatch(/export function wrapMathForStorage\(latex: string\): string \{\s*return latex \? `\$\$\{latex\}\$` : ''/);
    expect(DOC_SRC).toMatch(/wrapMathForStorage\(b\.latex\)/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/function wrapMathForStorage/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/function unwrapMathFromStorage/);
  });
});

/* ================================================================ *
 * R11 -- mobile.                                                    *
 * ================================================================ */
describe('LX-8R2 R11 -- mobile-friendly input', () => {
  it("MathLive's own virtual keyboard is enabled (auto policy) rather than building a separate mobile keyboard", () => {
    expect(EDITOR_SRC).toMatch(/mathVirtualKeyboardPolicy = 'auto'/);
  });

  it('the toolbar stays a single horizontally-scrollable row plus a collapsible "More" panel -- never a full grid rendered unconditionally', () => {
    expect(EDITOR_SRC).toMatch(/overflowX: 'auto'/);
    expect(EDITOR_SRC).toMatch(/showMore/);
  });
});

/* ================================================================ *
 * R13 -- accessibility.                                             *
 * ================================================================ */
describe('LX-8R2 R13 -- accessibility', () => {
  it('the mathfield carries an aria-label', () => {
    expect(EDITOR_SRC).toMatch(/aria-label', t\['mathExpression\.ariaLabel'\]/);
  });

  it('every toolbar button has both title and aria-label, matching the established MathAnswerEditor accessibility pattern', () => {
    expect(EDITOR_SRC).toMatch(/title=\{t\[b\.labelKey/);
    expect(EDITOR_SRC).toMatch(/aria-label=\{t\[b\.labelKey/);
  });

  it('the activity remains completable without a microphone -- voice is offered only when voiceEnabled (still sourced from the ONE ic.inputModes.includes(\'VOICE\') authority) is true, never required', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/voiceEnabled=\{ic\.inputModes\.includes\('VOICE'\)\}/);
    expect(COMPOSER_SRC).toMatch(/voiceEnabled &&/);
  });
});

/* ================================================================ *
 * R14 -- language architecture: MathSpeechParser is language-        *
 * selected via expectedResponseLanguage, adding German later is a    *
 * GRAMMARS entry, never an editor change.                            *
 * ================================================================ */
describe('LX-8R2 R14 -- language authority and extensibility', () => {
  it('MathVoiceInput selects the parser language from expectedResponseLanguage, never activityLanguage or interface language', () => {
    expect(VOICE_INPUT_SRC).toMatch(/parseMathSpeech\(transcript, props\.expectedResponseLanguage\)/);
    expect(VOICE_INPUT_SRC).not.toMatch(/activityLanguage/);
  });

  it('MathExpressionEditor itself contains no per-language branching -- language only matters to the voice pipeline feeding it, never to the editor/toolbar', () => {
    expect(EDITOR_SRC).not.toMatch(/GRAMMARS|parseMathSpeech/);
  });
});

/* ================================================================ *
 * R15 -- observability: safe events + metadata only.                *
 * ================================================================ */
describe('LX-8R2 R15 -- observability', () => {
  it('all six required MATH_* event labels exist in the InteractionEventLabel union', () => {
    for (const label of ['MATH_EDITOR_READY', 'MATH_VOICE_PARSE_STARTED', 'MATH_VOICE_PARSE_SUCCEEDED', 'MATH_VOICE_PARSE_PARTIAL', 'MATH_VOICE_PARSE_FAILED', 'MATH_RESPONSE_ACCEPTED']) {
      expect(OBS_SRC).toContain(`'${label}'`);
    }
  });

  it('parserResult metadata is a safe enum-shaped field (a reason code), never the transcript or the parsed expression itself', () => {
    expect(OBS_SRC).toMatch(/parserResult\?: string/);
    expect(VOICE_INPUT_SRC).not.toMatch(/parserResult: transcript/);
    expect(VOICE_INPUT_SRC).not.toMatch(/parserResult: result\.latex/);
  });

  it('MathVoiceInput logs MATH_VOICE_PARSE_STARTED/SUCCEEDED/FAILED and MATH_RESPONSE_ACCEPTED with only safe metadata (conceptId/activityType/language/parserResult), never the transcript or latex', () => {
    const logCalls = [...VOICE_INPUT_SRC.matchAll(/logInteraction\('(MATH_[A-Z_]+)',\s*\{([^}]*)\}/g)];
    expect(logCalls.length).toBeGreaterThanOrEqual(4);
    for (const [, label, metaSrc] of logCalls) {
      expect(metaSrc).not.toMatch(/transcript|latex/);
    }
  });

  it('MathExpressionEditor logs MATH_EDITOR_READY exactly once per mount, with safe metadata only', () => {
    expect(EDITOR_SRC).toMatch(/logInteraction\('MATH_EDITOR_READY', \{ conceptId, activityType, language: locale \}\)/);
    expect(EDITOR_SRC).toMatch(/hasLoggedReady\.current = true/);
  });
});

/* ================================================================ *
 * R3 (cross-check) -- the canonical MathResponse contract module     *
 * itself never contains any solving/simplification logic.            *
 * ================================================================ */
describe('LX-8R2 -- contract module purity', () => {
  it('math-response-contract.ts contains no grading, no AI call, no persisted field -- a pure serialization helper', () => {
    expect(CONTRACT_SRC).not.toMatch(/executeAI|callModel|db\.query|INSERT INTO/);
  });
});
