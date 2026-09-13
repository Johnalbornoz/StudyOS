/**
 * LX-8R3 -- UNIFIED RESPONSE COMPOSER.
 *
 * Source-contract tests (this codebase's established no-jsdom style)
 * for the parts of R1-R16 not already covered by the pure-function
 * suites (response-document.test.ts, math-speech-parser.test.ts,
 * math-response-contract.test.ts) or by the migration-audit suites
 * (lx8r2-math-response-experience.test.ts,
 * lx8r2-r1-universal-math-surface.test.ts): Enter/multiline behavior
 * (R3), the removed redundant toolbar (R4), MathLive as the one math
 * keyboard (R5), the default-text/math-on-demand switch (R6), speech
 * context routing (R9), failed-parse UX preserving content (R13), and
 * the visual-cleanup/no-duplicate-surface requirement (R14).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const COMPOSER_SRC = strip(read('src/components/UnifiedResponseComposer.tsx'));
const RAW_COMPOSER_SRC = read('src/components/UnifiedResponseComposer.tsx');
const EDITOR_SRC = strip(read('src/components/MathExpressionEditor.tsx'));
const TOOLBAR_CONFIG_SRC = strip(read('src/lib/math-expression-toolbar-config.ts'));

/* ================================================================ *
 * R1 -- ONE RESPONSE SURFACE supporting prose, inline/block math,    *
 * multiple lines, paragraphs, voice, math-voice, keyboard editing.   *
 * ================================================================ */
describe('LX-8R3 R1 -- one response surface, not two independent editors', () => {
  it('renders exactly one bordered surface containing the whole block list -- never two separately-bordered boxes', () => {
    expect(COMPOSER_SRC.match(/border: '1px solid var\(--border-default\)'/g)?.length).toBe(2); // the ONE surface + the keyboard-icon button's own border, not a second answer box
  });

  it('supports paragraph blocks (multi-line prose via rows growing with content) and math blocks (structured MathExpressionEditor) in the same block list', () => {
    expect(COMPOSER_SRC).toMatch(/block\.type === 'paragraph'/);
    expect(COMPOSER_SRC).toMatch(/rows=\{Math\.min\(12, Math\.max\(2, block\.text\.split\('\\n'\)\.length \+ 1\)\)\}/);
    expect(COMPOSER_SRC).toMatch(/<MathExpressionEditor/);
  });

  it('offers voice (prose) and math-voice (MathVoiceInput) and keyboard/typed editing -- never fewer than the full set the spec requires', () => {
    expect(COMPOSER_SRC).toMatch(/<VoiceInputButton/);
    expect(COMPOSER_SRC).toMatch(/<MathVoiceInput/);
    expect(COMPOSER_SRC).toMatch(/onChange=\{\(e\) => updateParagraph\(i, e\.target\.value\)\}/);
  });
});

/* ================================================================ *
 * R3 -- ENTER MUST WORK NATURALLY: new block, never submit.          *
 * ================================================================ */
describe('LX-8R3 R3 -- Enter creates the next block; Shift+Enter is a plain line break; Enter never submits', () => {
  it('a bare Enter (no shift) in a paragraph textarea is intercepted (preventDefault) and splits the block at the caret into two paragraph blocks', () => {
    expect(COMPOSER_SRC).toMatch(/if \(e\.key !== 'Enter' \|\| e\.shiftKey\) return;/);
    expect(COMPOSER_SRC).toMatch(/e\.preventDefault\(\);/);
    expect(COMPOSER_SRC).toMatch(/const before = el\.value\.slice\(0, pos\);/);
    expect(COMPOSER_SRC).toMatch(/const after = el\.value\.slice\(pos\);/);
  });

  it('Shift+Enter is explicitly excluded from interception -- falls through to the textarea\'s own default (a line break within the SAME block)', () => {
    const fnSrc = COMPOSER_SRC.slice(COMPOSER_SRC.indexOf('function handleParagraphKeyDown'), COMPOSER_SRC.indexOf('function handleParagraphKeyDown') + 500);
    expect(fnSrc).toMatch(/e\.shiftKey\) return;/);
  });

  it('Enter inside a math block commits it and moves to (or creates) the next block -- via MathExpressionEditor\'s onEnter prop, never a raw keydown handled twice', () => {
    expect(COMPOSER_SRC).toMatch(/onEnter=\{\(\) => handleMathEnter\(i\)\}/);
    expect(COMPOSER_SRC).toMatch(/function handleMathEnter\(index: number\)/);
  });

  it('the composer never calls a submit/next-question handler -- Enter\'s only effect is on the block list (commit/setActiveIndex/pendingFocusRef), submission remains the surrounding page\'s own explicit button', () => {
    expect(COMPOSER_SRC).not.toMatch(/nextQuestion|onSubmit|handleSubmit/);
  });
});

/* ================================================================ *
 * R4 -- REMOVE REDUNDANT CUSTOM TOOLBAR.                             *
 * ================================================================ */
describe('LX-8R3 R4 -- the redundant StudyUS math-symbol toolbar is removed from the unified surface', () => {
  it('MathExpressionEditor is always mounted with showToolbar={false} inside the composer -- no custom button row renders here', () => {
    expect(COMPOSER_SRC).toMatch(/showToolbar=\{false\}/);
  });

  it('the composer never imports MATH_PRIMARY_BUTTONS/MATH_MORE_BUTTONS -- it does not maintain a second math-symbol palette of its own', () => {
    expect(COMPOSER_SRC).not.toMatch(/MATH_PRIMARY_BUTTONS|MATH_MORE_BUTTONS|math-expression-toolbar-config/);
  });

  it('the ONE retained custom control is the keyboard icon itself, which inserts/opens a math block -- justified individually (R4: "only retain custom controls if they provide functionality MathLive cannot") since MathLive has no built-in way to ask a HOST PAGE to insert a new math field at a document position', () => {
    expect(COMPOSER_SRC).toMatch(/function handleMathKeyboardClick/);
    // the toolbar-config module (still used by MathExpressionEditor when showToolbar=true elsewhere -- it is not, currently, anywhere) is not re-imported here
    expect(TOOLBAR_CONFIG_SRC).not.toMatch(/UnifiedResponseComposer/);
  });
});

/* ================================================================ *
 * R5 -- ONE MATH KEYBOARD: MathLive's own, never a second, weaker    *
 * version.                                                           *
 * ================================================================ */
describe('LX-8R3 R5 -- MathLive\'s own virtual keyboard is the one math-entry palette', () => {
  it('the keyboard icon opens MathLive\'s own global virtual keyboard (window.mathVirtualKeyboard.show), never a custom-built one', () => {
    expect(COMPOSER_SRC).toMatch(/mathVirtualKeyboard\?\: \{ show: \(opts\?\: Record<string, unknown>\) => void \}/);
    expect(COMPOSER_SRC).toMatch(/vk\?\.show\(\{ animate: true \}\);/);
  });

  it('MathExpressionEditor (owned by the composer) still enables mathVirtualKeyboardPolicy auto, so MathLive\'s keyboard remains available on touch focus even before the icon is clicked', () => {
    expect(EDITOR_SRC).toMatch(/mathVirtualKeyboardPolicy = 'auto'/);
  });
});

/* ================================================================ *
 * R6 -- SWITCHING BETWEEN TEXT AND MATH feels natural, no visible    *
 * "TEXT MODE / MATH MODE" enterprise control.                        *
 * ================================================================ */
describe('LX-8R3 R6 -- natural text/math switching, no explicit mode toggle', () => {
  it('the document defaults to a single empty PARAGRAPH block (text mode is default) -- response-document.ts\'s emptyResponseDocument, not a math block', () => {
    const docSrc = strip(read('src/lib/lx/response-document.ts'));
    expect(docSrc).toMatch(/export function emptyResponseDocument\(\): ResponseDocument \{\s*return \{ blocks: \[\{ type: 'paragraph', text: '' \}\] \};/);
  });

  it('there is no "TEXT MODE"/"MATH MODE" label or toggle control anywhere in the composer -- only the keyboard icon and the mic, matching the target visual layout', () => {
    expect(RAW_COMPOSER_SRC).not.toMatch(/text mode|math mode/i);
  });

  it('pressing the math icon again after finishing one math block inserts ANOTHER math block (R6: "press math icon again later -> insert another math block") -- insertBlockAfter is not limited to a single use', () => {
    expect(COMPOSER_SRC).toMatch(/function insertBlockAfter\(index: number, block: ResponseBlock, focusType: 'paragraph' \| 'math'\)/);
    expect(COMPOSER_SRC).not.toMatch(/mathBlockAlreadyInserted|hasInsertedMath/); // no one-shot guard limiting math-block insertion
  });
});

/* ================================================================ *
 * R9 -- SPEECH CONTEXT: one mic, behavior depends on active block.   *
 * ================================================================ */
describe('LX-8R3 R9 -- voice behavior follows the currently active block\'s type, one microphone control', () => {
  it('exactly one voice-rendering ternary exists -- never two separate, simultaneously-visible mic buttons', () => {
    expect(COMPOSER_SRC.match(/<VoiceInputButton|<MathVoiceInput/g)?.length).toBe(2); // one of each possible render, never both at once (mutually exclusive branches of the same ternary)
    expect(COMPOSER_SRC).toMatch(/activeIsMath \? \(\s*<MathVoiceInput/);
  });

  it('activeIsMath is derived from the block CURRENTLY at activeIndex, tracked via each block\'s own onFocus -- never a static/first-block assumption', () => {
    expect(COMPOSER_SRC).toMatch(/const activeBlock = blocks\[activeIndex\];/);
    expect(COMPOSER_SRC).toMatch(/const activeIsMath = mathEnabled && activeBlock\?\.type === 'math';/);
    expect(COMPOSER_SRC).toMatch(/onFocus=\{\(\) => setActiveIndex\(i\)\}/g);
  });

  it('when mathEnabled is false, activeIsMath can never be true regardless of block contents -- R16\'s "operates without math affordance" guarantee extends to voice routing too', () => {
    const fnSrc = COMPOSER_SRC.slice(COMPOSER_SRC.indexOf('const activeIsMath'), COMPOSER_SRC.indexOf('const activeIsMath') + 100);
    expect(fnSrc).toMatch(/mathEnabled &&/);
  });
});

/* ================================================================ *
 * R13 -- FAILED MATH PARSE UX: preserve content, never erase.        *
 * ================================================================ */
describe('LX-8R3 R13 -- a failed math voice parse never erases existing response content', () => {
  it('handleMathVoiceAccept only ever calls updateMath (replacing ONLY the active math block) or insertBlockAfter (adding a new block) -- never a full-document reset/clear', () => {
    const fnSrc = COMPOSER_SRC.slice(COMPOSER_SRC.indexOf('function handleMathVoiceAccept'), COMPOSER_SRC.indexOf('function handleMathVoiceAccept') + 300);
    expect(fnSrc).not.toMatch(/emptyResponseDocument|blocks: \[\]/);
  });

  it('handleProseVoiceAccept only ever appends to or adds a block -- never clears prior blocks', () => {
    const fnSrc = COMPOSER_SRC.slice(COMPOSER_SRC.indexOf('function handleProseVoiceAccept'), COMPOSER_SRC.indexOf('function handleProseVoiceAccept') + 300);
    expect(fnSrc).not.toMatch(/emptyResponseDocument|blocks: \[\]/);
  });

  it('the underlying MathVoiceInput failed-parse surface (unchanged, LX-8R2) never auto-populates a guess and lets the learner retry, per its own dedicated test coverage', () => {
    const voiceInputSrc = strip(read('src/app/dashboard/MathVoiceInput.tsx'));
    expect(voiceInputSrc).toMatch(/mathExpression\.voiceParseFailedMessage/);
  });
});

/* ================================================================ *
 * R14 -- VISUAL CLEANUP: no duplicate toolbar, no second response    *
 * box, no duplicate category palette outside MathLive.               *
 * ================================================================ */
describe('LX-8R3 R14 -- visual cleanup: calmer surface, nothing duplicated', () => {
  it('no "Basic / Structures / Greek" category-tab markup exists in the composer (that belonged to the retired MathAnswerEditor)', () => {
    expect(COMPOSER_SRC).not.toMatch(/categoryBasic|categoryStructures|categoryGreek|categoryPhysics|categoryMore/);
  });

  it('the mic and keyboard controls sit in one row, space-between, matching the target calmer layout ([ mic ... keyboard ])', () => {
    expect(COMPOSER_SRC).toMatch(/justifyContent: 'space-between'/);
  });
});

/* ================================================================ *
 * R16 -- UNIVERSAL SURFACE: reusable with or without math.           *
 * ================================================================ */
describe('LX-8R3 R16 -- the same composer operates prose-only when mathEnabled is false', () => {
  it('the math-keyboard button and any math-voice rendering are both gated on mathEnabled -- entirely absent, not merely disabled, for a prose-only route', () => {
    expect(COMPOSER_SRC).toMatch(/\{mathEnabled && \(/);
  });

  it('no math block can ever be created when mathEnabled is false -- emptyMathBlock is only reachable via handleMathKeyboardClick, itself only rendered behind the mathEnabled gate', () => {
    const clickFnIdx = COMPOSER_SRC.indexOf('function handleMathKeyboardClick');
    expect(COMPOSER_SRC.indexOf('emptyMathBlock()')).toBeGreaterThan(clickFnIdx);
  });
});
