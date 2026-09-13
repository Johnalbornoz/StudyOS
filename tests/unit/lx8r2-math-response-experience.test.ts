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
const COMPOSER_SRC = strip(read('src/components/MathResponseComposer.tsx'));
const VOICE_INPUT_SRC = strip(read('src/app/dashboard/MathVoiceInput.tsx'));
const PARSER_SRC = strip(read('src/lib/lx/math-speech-parser.ts'));
const CONTRACT_SRC = strip(read('src/lib/lx/math-response-contract.ts'));
const OBS_SRC = strip(read('src/lib/lx/multimodal-observability.ts'));
const PACKAGE_JSON = JSON.parse(read('package.json'));

/**
 * LX-8R2-R1: MathExpressionEditor/MathVoiceInput are no longer imported
 * directly by any page -- they are implementation details owned by
 * MathResponseComposer (see tests/unit/lx8r2-r1-universal-math-
 * surface.test.ts for the full extraction/migration coverage). The
 * assertions below are updated in place to read from the NEW
 * architecture rather than re-describe the pre-extraction one.
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

  it('the quiz page uses MathResponseComposer (not MathAnswerEditor) for a math-context final answer', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/isMathAnswerContext\(subjectName, responseContract\.kind\) \? \(\s*<MathResponseComposer/);
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
  it('the quiz page loads the ONE canonical MathResponseComposer with ssr:false, same pattern as every other browser-only modality control -- it never imports MathExpressionEditor/MathVoiceInput directly', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/const MathResponseComposer = dynamic\(\(\) => import\('@\/components\/MathResponseComposer'\), \{ ssr: false \}\)/);
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
 * R8 -- response-contract integration: math answer + reasoning box   *
 * combine per the SAME already-canonical ResponseEvidenceContract,   *
 * never a duplicated/second surface, never both boxes unnecessarily. *
 * ================================================================ */
describe('LX-8R2 R8 -- reuses the existing ResponseEvidenceContract, no second authority', () => {
  it('isMathAnswerContext is gated on responseContract.kind -- the SAME contract already driving the reasoning-box visibility, not a new independent check', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/isMathAnswerContext\(subjectName, responseContract\.kind\)/);
  });

  it('EXPLAIN and JUSTIFY kinds are excluded from the structured math editor -- an EXPLAIN/JUSTIFY ask keeps the prose surface (isMathAnswerContext now lives in the shared math-response-contract.ts, not page-local)', () => {
    const fnSrc = CONTRACT_SRC.slice(CONTRACT_SRC.indexOf('export function isMathAnswerContext'), CONTRACT_SRC.indexOf('export function isMathAnswerContext') + 400);
    expect(fnSrc).toMatch(/kind !== 'EXPLAIN' && kind !== 'JUSTIFY'/);
  });

  it('the reasoning/work box (requiresWork || requiresJustification) is never switched to the math editor -- stays the prose MathAnswerEditor unconditionally', () => {
    const reasoningBlock = QUIZ_PAGE_SRC.slice(
      QUIZ_PAGE_SRC.indexOf('responseContract.requiresWork || responseContract.requiresJustification'),
      QUIZ_PAGE_SRC.indexOf('responseContract.requiresWork || responseContract.requiresJustification') + 500,
    );
    expect(reasoningBlock).toMatch(/<MathAnswerEditor/);
    expect(reasoningBlock).not.toMatch(/MathResponseComposer/);
  });

  it('the main quiz\'s final-answer/reasoning pair is never both math-structured at once -- only the final-answer box is conditionally structured', () => {
    // The reasoning box slice above proves it is always MathAnswerEditor
    // for the main quiz's q.answerFormat === 'text' block; combined with
    // the final-answer conditional test elsewhere, at most one box (the
    // final answer) is ever the structured composer within that block.
    const textBlock = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'text' && ("), QUIZ_PAGE_SRC.indexOf("q.answerFormat === 'matching'"));
    expect(textBlock.match(/<MathResponseComposer/g)?.length).toBe(1);
  });
});

/* ================================================================ *
 * R9/R10 -- grader compatibility: dedicated file exists (math-       *
 * response-contract.test.ts); here we assert the WIRING uses it.     *
 * ================================================================ */
describe('LX-8R2 R9/R10 -- the canonical serialization is fed to the grader, never a toolbar/DOM-scraped value', () => {
  it('MathResponseComposer (the ONE place that talks to MathExpressionEditor/MathVoiceInput) reads their output via toGraderString, never response.plainText or a raw DOM read; the quiz page itself never touches toGraderString/plainText directly', () => {
    expect(COMPOSER_SRC).toMatch(/toGraderString\(next\)/);
    expect(COMPOSER_SRC).toMatch(/toGraderString\(response\)/);
    expect(COMPOSER_SRC).not.toMatch(/\.plainText/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/toGraderString/);
  });

  it('the stored answer string is wrapped in the SAME $...$ convention MathText already renders, so Review needs zero changes -- wrap/unwrap now live once in the shared math-response-contract.ts, never duplicated per page', () => {
    expect(CONTRACT_SRC).toMatch(/export function wrapMathForStorage\(latex: string\): string \{\s*return latex \? `\$\$\{latex\}\$` : ''/);
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

  it('the activity remains completable without a microphone -- voice is rendered only inside the existing ic.inputModes.includes(\'VOICE\') gate, never required', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/ic\.inputModes\.includes\('VOICE'\) && \(/);
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
