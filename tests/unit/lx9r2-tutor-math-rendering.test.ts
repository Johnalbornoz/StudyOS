/**
 * LX-9R2 -- TUTOR MATHEMATICAL RENDERING.
 *
 * Live QA: Tutor responses containing valid mathematical content
 * rendered literal LaTeX source instead of typeset math --
 * `$$\n(a+b)^2=(a+b)(a+b)\n$$` (delimiters on their own lines) and
 * `\((a+b)^2\)` (backslash delimiters) both showed as raw text, because
 * `parseChatBlocks` split messages into lines BEFORE looking for math
 * delimiters (breaking a `$$...$$` block spanning multiple lines) and
 * never recognized `\(...\)`/`\[...\]` at all. `\cdot` and other LaTeX
 * commands render correctly via KaTeX automatically once the
 * surrounding expression is recognized as math -- no separate
 * command-level fix was needed.
 *
 * Fix: `normalizeMathDelimiters` (chat-markdown.ts), a purely
 * deterministic, zero-AI-cost string transform run before line
 * splitting. This file covers the 20 required tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import katex from 'katex';
import { parseInline, parseChatBlocks, normalizeMathDelimiters } from '@/lib/chat-markdown';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function renderMathValue(text: string): string {
  const segs = parseInline(text);
  const mathSeg = segs.find((s) => s.type === 'math');
  expect(mathSeg, `no math segment found in parseInline(${JSON.stringify(text)}) -> ${JSON.stringify(segs)}`).toBeTruthy();
  return katex.renderToString((mathSeg as any).value, { throwOnError: false, displayMode: !!(mathSeg as any).display });
}

/* ================================================================ *
 * 1-2 -- assistant inline / block math renders.                      *
 * ================================================================ */
describe('LX-9R2 required tests 1-2 -- assistant inline and block math render as real math', () => {
  it('1. inline $x^2$ renders as a math segment, not literal text', () => {
    const segs = parseInline('the value $x^2$ here');
    expect(segs.some((s) => s.type === 'math' && s.value === 'x^2' && !s.display)).toBe(true);
  });

  it('2. block $$x^2+1$$ (single line) renders as a display math segment', () => {
    const segs = parseInline('$$x^2+1$$');
    expect(segs).toEqual([{ type: 'math', value: 'x^2+1', display: true }]);
  });
});

/* ================================================================ *
 * 3-4 -- \(...\) and \[...\] render (the live-QA-reported gap).      *
 * ================================================================ */
describe('LX-9R2 required tests 3-4 -- LaTeX-native delimiters render without visible backslash/parens', () => {
  it('3. \\(...\\) normalizes to inline $...$ and renders without visible delimiters', () => {
    const normalized = normalizeMathDelimiters('¿Por qué \\((a+b)^2\\) no es igual a \\(a^2+b^2\\)?');
    expect(normalized).toBe('¿Por qué $(a+b)^2$ no es igual a $a^2+b^2$?');
    const segs = parseInline(normalized);
    expect(segs.some((s) => s.type === 'math' && s.value === '(a+b)^2')).toBe(true);
    expect(segs.some((s) => s.type === 'text' && s.value.includes('\\('))).toBe(false);
  });

  it('4. \\[...\\] normalizes to block $$...$$ and renders without visible delimiters', () => {
    const normalized = normalizeMathDelimiters('\\[x^2 + 1\\]');
    expect(normalized).toBe('$$x^2 + 1$$');
    const segs = parseInline(normalized);
    expect(segs).toEqual([{ type: 'math', value: 'x^2 + 1', display: true }]);
  });
});

/* ================================================================ *
 * 5-6 -- $...$ / $$...$$ (already-canonical forms) still render.     *
 * ================================================================ */
describe('LX-9R2 required tests 5-6 -- the canonical $...$ / $$...$$ forms are untouched', () => {
  it('5. $...$ renders', () => {
    expect(parseInline('inline $a+b$ here')[1]).toEqual({ type: 'math', value: 'a+b' });
  });

  it('6. $$...$$ renders', () => {
    expect(parseInline('$$a+b$$')).toEqual([{ type: 'math', value: 'a+b', display: true }]);
  });

  it('a message using only the canonical convention round-trips through normalizeMathDelimiters unchanged', () => {
    const input = 'Block:\n\n$$a^2+b^2$$\n\nInline $x$ here.';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });
});

/* ================================================================ *
 * 7 -- prose before/after math remains readable (R3: mixed content). *
 * ================================================================ */
describe('LX-9R2 required test 7 -- prose before/after math remains intact in one message', () => {
  it('the exact reported shape: prose, a multi-line $$...$$ block, more prose -- all three sections parse correctly', () => {
    const input = [
      'Aplicando la propiedad distributiva:',
      '',
      '$$',
      '(a+b)^2 = a^2 + 2ab + b^2',
      '$$',
      '',
      'El término 2ab es el que faltaba.',
    ].join('\n');
    const blocks = parseChatBlocks(input);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(blocks[0]).toMatchObject({ lines: [[{ type: 'text', value: 'Aplicando la propiedad distributiva:' }]] });
    const mathBlock = blocks[1] as any;
    expect(mathBlock.lines[0].some((s: any) => s.type === 'math' && s.display && s.value === '(a+b)^2 = a^2 + 2ab + b^2')).toBe(true);
    expect(blocks[2]).toMatchObject({ lines: [[{ type: 'text', value: 'El término 2ab es el que faltaba.' }]] });
  });
});

/* ================================================================ *
 * 8 -- bold/bullets remain intact (pre-existing, must not regress).  *
 * ================================================================ */
describe('LX-9R2 required test 8 -- bold/bullets remain intact', () => {
  it('bold and an ordered list still parse exactly as before this fix', () => {
    expect(parseInline('this is **bold** text')).toEqual([
      { type: 'text', value: 'this is ' },
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' text' },
    ]);
    const blocks = parseChatBlocks('1. First\n2. Second');
    expect(blocks).toEqual([{ type: 'list', ordered: true, items: [[{ type: 'text', value: 'First' }], [{ type: 'text', value: 'Second' }]] }]);
  });
});

/* ================================================================ *
 * 9-10 -- learner (user) message rendering (R4).                     *
 * ================================================================ */
describe('LX-9R2 required tests 9-10 -- learner-authored math renders; learner prose stays intact', () => {
  it('9. a learner message with \\(...\\) renders inline math cleanly, matching the exact reported example', () => {
    const input = '¿Por qué \\((a+b)^2\\) no es igual a \\(a^2+b^2\\)?';
    const blocks = parseChatBlocks(input);
    expect(blocks).toHaveLength(1);
    const line = (blocks[0] as any).lines[0];
    const mathSegs = line.filter((s: any) => s.type === 'math');
    expect(mathSegs.map((s: any) => s.value)).toEqual(['(a+b)^2', 'a^2+b^2']);
    // no raw backslash-paren delimiter survives as visible text anywhere in the line.
    expect(line.some((s: any) => s.type === 'text' && /\\[()]/.test(s.value))).toBe(false);
  });

  it('10. ordinary prose with no math in a learner message is preserved verbatim', () => {
    const blocks = parseChatBlocks('no entiendo este tema para nada');
    expect(blocks).toEqual([{ type: 'paragraph', lines: [[{ type: 'text', value: 'no entiendo este tema para nada' }]] }]);
  });

  it('ChatMessage renders both roles through the identical parseChatBlocks path -- TutorChat.tsx source contract', () => {
    const src = strip(read('src/app/dashboard/tutor/TutorChat.tsx'));
    const matches = src.match(/<ChatMessage content=\{m\.content\} \/>/g);
    expect(matches?.length).toBe(1); // one render call site, used for every message regardless of m.role
  });
});

/* ================================================================ *
 * 11-13 -- \cdot / exponents / fractions render structurally via     *
 * KaTeX, once the surrounding expression is recognized as math.      *
 * ================================================================ */
describe('LX-9R2 required tests 11-13 -- \\cdot, exponents, and fractions render as real math structure (KaTeX), not literal commands', () => {
  // KaTeX's output legitimately embeds the raw source inside an
  // accessibility <annotation encoding="application/x-tex"> block (for
  // screen readers/copy-paste) -- that is correct, expected KaTeX
  // behavior, not the literal-text leak this repair fixes. These tests
  // instead assert the VISUALLY RENDERED katex-html span contains the
  // real structural markup (operator glyph / vlist / mfrac).
  function visualHtml(html: string): string {
    const start = html.indexOf('class="katex-html"');
    return html.slice(start);
  }

  it('11. \\cdot inside a recognized math span renders as a multiplication operator glyph in the visual output, never the literal command as text', () => {
    const html = visualHtml(renderMathValue('$a \\cdot b$'));
    expect(html).not.toMatch(/\\cdot/);
    expect(html).toContain('⋅');
  });

  it('11b. \\cdot inside a \\(...\\)-delimited span (the exact live-QA report) also renders correctly once normalized', () => {
    const normalized = normalizeMathDelimiters('\\(a \\cdot b\\)');
    const html = visualHtml(renderMathValue(normalized));
    expect(html).not.toMatch(/\\cdot/);
    expect(html).toContain('⋅');
  });

  it('12. exponents render as a structural superscript (KaTeX vlist) in the visual output, not the literal caret', () => {
    const html = visualHtml(renderMathValue('$x^2$'));
    expect(html).not.toMatch(/x\^2/);
    expect(html).toMatch(/vlist/);
  });

  it('13. fractions render as structural KaTeX fraction markup in the visual output, not the literal \\frac command', () => {
    const html = visualHtml(renderMathValue('$\\frac{a}{b}$'));
    expect(html).not.toMatch(/\\frac/);
    expect(html).toContain('mfrac');
  });
});

/* ================================================================ *
 * 14 -- no raw LaTeX delimiter is ever left visible for a supported  *
 * form, across every combination this file exercises.                *
 * ================================================================ */
describe('LX-9R2 required test 14 -- no raw LaTeX delimiter leaks to the learner for any supported form', () => {
  it('the exact live-QA reported message renders with zero literal $, \\(, \\), \\[, \\] characters left as text', () => {
    const input = [
      'Aplicando la propiedad distributiva obtenemos:',
      '',
      '$$',
      '(a+b)^2=(a+b)(a+b)',
      '$$',
      '',
      'y usando \\(a \\cdot b\\) como paso intermedio.',
    ].join('\n');
    const blocks = parseChatBlocks(input);
    for (const block of blocks) {
      if (block.type !== 'paragraph') continue;
      for (const line of block.lines) {
        for (const seg of line) {
          if (seg.type === 'text') {
            expect(seg.value).not.toMatch(/\$|\\\(|\\\)|\\\[|\\\]/);
          }
        }
      }
    }
  });
});

/* ================================================================ *
 * 15 -- no new AI call introduced.                                   *
 * ================================================================ */
describe('LX-9R2 required test 15 -- zero AI calls added by this repair', () => {
  it('chat-markdown.ts imports nothing AI-related -- pure string transforms only', () => {
    const src = read('src/lib/chat-markdown.ts');
    expect(src).not.toMatch(/executeAI|callModel|from '@\/lib\/ai/);
  });

  it('ChatMessage.tsx makes no network/AI call -- katex.renderToString is synchronous and local', () => {
    const src = strip(read('src/components/ChatMessage.tsx'));
    expect(src).not.toMatch(/fetch\(|executeAI|await /);
  });
});

/* ================================================================ *
 * 16-18 -- Tutor routing/telemetry/fallback unchanged.                *
 * ================================================================ */
describe('LX-9R2 required tests 16-18 -- Tutor model routing, telemetry, and fallback are untouched by this presentation-only fix', () => {
  const TUTOR_SRC = read('src/services/tutor.service.ts');
  const TUTOR_SRC_STRIPPED = strip(TUTOR_SRC);

  it('16. tutor.service.ts still routes via resolveModels(prompt.capability) -- unchanged from LX-9', () => {
    expect(TUTOR_SRC).toMatch(/const route = resolveModels\(prompt\.capability\)/);
    expect(TUTOR_SRC_STRIPPED).not.toMatch(/claude-sonnet-5/); // stripped of comments -- only real code would count as a regression
  });

  it('17. tutor.service.ts still calls parseUsage/recordRuntimeEvent/operationId telemetry -- unchanged from LX-9', () => {
    expect(TUTOR_SRC).toMatch(/parseUsage: parseCallModelUsage/);
    expect(TUTOR_SRC).toMatch(/recordRuntimeEvent\(/);
    expect(TUTOR_SRC).toMatch(/operationId/);
  });

  it('18. tutor.service.ts still has exactly one catch block (one bounded Terra fallback), never a second retry/third attempt -- unchanged from LX-9', () => {
    expect(TUTOR_SRC.match(/\} catch \(err\) \{/g)?.length).toBe(1);
    expect(TUTOR_SRC).toMatch(/if \(!\(err instanceof AIExecutionFailure\)\) throw err;/);
    // exactly 2 executeAI attempts total (the try block's Luna call, the catch block's Terra call) -- never a 3rd.
    expect(TUTOR_SRC.match(/await executeAI\(\{/g)?.length).toBe(2);
  });
});

/* ================================================================ *
 * 19 -- no unsafe raw HTML path introduced.                          *
 * ================================================================ */
describe('LX-9R2 required test 19 -- no new unsafe HTML path was introduced', () => {
  it('the ONLY dangerouslySetInnerHTML in ChatMessage.tsx feeds katex.renderToString output (the same already-trusted pattern MathText.tsx uses), never raw model/user text', () => {
    const src = strip(read('src/components/ChatMessage.tsx'));
    const occurrences = src.match(/dangerouslySetInnerHTML/g) ?? [];
    expect(occurrences.length).toBe(1);
    const idx = src.indexOf('dangerouslySetInnerHTML');
    expect(src.slice(idx, idx + 200)).toMatch(/__html:\s*katex\.renderToString\(/);
  });

  it('KaTeX is not passed trust:true (KaTeX default trust:false is left in place, matching MathText.tsx)', () => {
    const src = read('src/components/ChatMessage.tsx');
    expect(src).not.toMatch(/trust:\s*true/);
  });
});
