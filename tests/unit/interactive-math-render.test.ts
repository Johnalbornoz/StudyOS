/**
 * Interactive formulas never show LaTeX source to the learner: the live
 * calculation is typeset by the same certified renderer as the base formula
 * (SafeMath), placeholders inside LaTeX groups keep the LaTeX valid, and a
 * formula that cannot be parsed falls back to readable text.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('katex/dist/katex.min.css', () => ({}));

import InteractiveFormulaWidget from '@/app/dashboard/subjects/[id]/InteractiveFormulaWidget';
import SafeMath from '@/components/SafeMath';
import MathText from '@/components/MathText';
import { latexToReadableText, renderLatexSafe } from '@/lib/math/safe-latex';
import { substituteLatexTemplate, formatResult, plainMathLabel } from '@/lib/math/interactive-formula-template';
import type { InteractiveFormula } from '@/services/interactive-formula.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

/** What a sighted learner sees: markup minus the sr-only accessible text. */
const visibleText = (html: string) =>
  html
    .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
/** Any LaTeX markup that must never reach the learner. */
const LATEX_MARKUP = /\\[a-zA-Z]+|\\[,;!]|\{\{|\}\}|\\frac|\\text/;

// "Regla de tres compuesta": X = 20 × (6/4) × (3/2) = 45 unidades
const REGLA_DE_TRES: InteractiveFormula = {
  latexTemplate: 'X = a \\times \\dfrac{b}{c} \\times \\dfrac{d}{e}',
  latexSubstitutionTemplate: 'X = {{a}} \\times \\frac{{{b}}}{{{c}}} \\times \\frac{{{d}}}{{{e}}} = {{result}}\\,\\text{unidades}',
  resultExpression: 'a * (b / c) * (d / e)',
  resultSymbol: 'X',
  resultUnit: 'unidades',
  variables: [
    { symbol: 'a', label: 'Cantidad conocida (a)', unit: 'unidades', min: 1, max: 100, step: 1, default: 20 },
    { symbol: 'b', label: 'Obreros nuevos (b)', unit: 'obreros', min: 1, max: 20, step: 1, default: 6 },
    { symbol: 'c', label: 'Obreros iniciales (c)', unit: 'obreros', min: 1, max: 20, step: 1, default: 4 },
    { symbol: 'd', label: 'Días nuevos (d)', unit: 'días', min: 1, max: 20, step: 1, default: 3 },
    { symbol: 'e', label: 'Días iniciales (e)', unit: 'días', min: 1, max: 20, step: 1, default: 2 },
  ],
};

const renderWidget = (data: InteractiveFormula) => renderToStaticMarkup(createElement(InteractiveFormulaWidget, { locale: 'es', data }));
const section = (html: string, testid: string) => {
  const attr = html.indexOf(`data-testid="${testid}"`);
  expect(attr).toBeGreaterThan(-1);
  const start = html.indexOf('>', attr) + 1;
  return html.slice(start, html.indexOf('data-testid=', start + 20) > 0 ? html.indexOf('data-testid=', start + 20) : undefined);
};

describe('initial formula (Regla de tres compuesta)', () => {
  const html = renderWidget(REGLA_DE_TRES);

  it('base and live formulas are both typeset (no KaTeX error, no fallback)', () => {
    expect(html).not.toContain('katex-error');
    expect(section(html, 'formula-base')).toContain('data-math="rendered"');
    expect(section(html, 'formula-live')).toContain('data-math="rendered"');
  });

  it('the live calculation carries the plugged-in values and the result; accessible text reads X = 20 × (6/4) × (3/2) = 45 unidades', () => {
    expect(html).toContain('<span class="sr-only">X = 20 × (6/4) × (3/2) = 45 unidades</span>');
  });

  it('shows "Resultado: 45 unidades" below', () => {
    expect(visibleText(section(html, 'formula-result')).replace(/\s+/g, ' ').trim()).toBe('Resultado: 45 unidades');
  });

  it('no LaTeX markup is visible anywhere in the widget', () => {
    expect(visibleText(html)).not.toMatch(LATEX_MARKUP);
  });
});

describe('slider updates', () => {
  it('each new value re-typesets the calculation (same pipeline as onChange)', () => {
    for (const scope of [
      { a: 20, b: 6, c: 4, d: 3, e: 2 },
      { a: 10, b: 8, c: 2, d: 5, e: 4 },
      { a: 7, b: 3, c: 9, d: 1, e: 6 },
    ]) {
      const r = scope.a * (scope.b / scope.c) * (scope.d / scope.e);
      const latex = substituteLatexTemplate(REGLA_DE_TRES.latexSubstitutionTemplate, scope, formatResult(r));
      const rendered = renderLatexSafe(latex, true);
      expect(rendered.ok).toBe(true);
      expect(rendered.text).toBe(`X = ${scope.a} × (${scope.b}/${scope.c}) × (${scope.d}/${scope.e}) = ${formatResult(r)} unidades`);
    }
  });

  it('a changed slider state renders through the widget without raw markup', () => {
    const moved = { ...REGLA_DE_TRES, variables: REGLA_DE_TRES.variables.map((v) => (v.symbol === 'b' ? { ...v, default: 8 } : v)) };
    const html = renderWidget(moved);
    expect(html).toContain('X = 20 × (8/4) × (3/2) = 60 unidades');
    expect(visibleText(html)).not.toMatch(LATEX_MARKUP);
  });

  it('regression: placeholders inside LaTeX groups keep braces balanced (the red raw-LaTeX bug)', () => {
    expect(substituteLatexTemplate('\\frac{{{b}}}{{{c}}}', { b: 6, c: 4 })).toBe('\\frac{6}{4}');
    expect(substituteLatexTemplate('\\dfrac{({{m}}\\,\\text{kg})}{{{r}}\\,\\text{m}}', { m: 2, r: 3 })).toBe('\\dfrac{(2\\,\\text{kg})}{3\\,\\text{m}}');
    expect(substituteLatexTemplate('{{v}}^2', { v: -3 })).toBe('(-3)^2');
    expect(substituteLatexTemplate('\\frac{{{nope}}}{2}', {})).toBe('\\frac{?}{2}');
  });
});

describe('\\text{...}, fractions, units and notation', () => {
  it('\\text{...} becomes normal text', () => {
    expect(latexToReadableText('45\\,\\text{unidades}')).toBe('45 unidades');
    expect(visibleText(renderToStaticMarkup(createElement(SafeMath, { latex: '45\\,\\text{unidades}' })))).toContain('unidades');
  });

  it('fractions, parentheses, exponents, roots, greek, sub/superscripts', () => {
    expect(latexToReadableText('\\frac{a+b}{2}')).toBe('((a+b)/2)');
    expect(latexToReadableText('F_c = \\dfrac{m v^2}{r}')).toBe('F_c = ((m v²)/r)');
    expect(latexToReadableText('\\sqrt{x^{2} + y^{2}}')).toBe('√(x² + y²)');
    expect(latexToReadableText('\\sqrt[3]{8}')).toBe('³√(8)');
    expect(latexToReadableText('\\theta + \\pi \\cdot \\Delta t')).toBe('θ + π · Δ t');
    expect(latexToReadableText('x_{1} + x_2')).toBe('x₁ + x₂');
    expect(latexToReadableText('\\left( \\frac{6}{4} \\right)')).toBe('((6/4))');
    for (const src of ['\\frac{a+b}{2}', '\\sqrt[3]{8}', '\\theta^{2}', 'x_{1}', '\\left(\\frac{1}{2}\\right)^{3}']) {
      expect(renderLatexSafe(src).ok).toBe(true);
    }
  });

  it('units/labels/symbols that carry LaTeX are shown as plain text', () => {
    expect(plainMathLabel('\\text{m/s}^2')).toBe('m/s²');
    expect(plainMathLabel('$\\Omega$')).toBe('Ω');
    expect(plainMathLabel('unidades')).toBe('unidades');
    const html = renderWidget({ ...REGLA_DE_TRES, resultUnit: '\\text{m/s}^2' });
    expect(visibleText(section(html, 'formula-result'))).toContain('m/s²');
  });
});

describe('invalid LaTeX -> readable fallback, never the source', () => {
  const INVALID = ['\\frac{6}{', 'X = \\frac{}{4} \\times }{', '\\unknowncommand{3} = 45\\,\\text{unidades}', '\\text{unclosed'];

  it.each(INVALID)('%s', (src) => {
    const r = renderLatexSafe(src, true);
    expect(r.ok).toBe(false);
    const html = renderToStaticMarkup(createElement(SafeMath, { latex: src, display: true }));
    expect(html).toContain('data-math="fallback"');
    expect(html).not.toContain('katex-error');
    expect(visibleText(html)).not.toMatch(LATEX_MARKUP);
    expect(visibleText(html).trim().length).toBeGreaterThan(0);
  });

  it('a broken live template in the widget still shows readable text', () => {
    const html = renderWidget({ ...REGLA_DE_TRES, latexSubstitutionTemplate: 'X = {{a}} \\times \\frac{{{b}}}{ = {{result}}\\,\\text{unidades}' });
    expect(html).not.toContain('katex-error');
    expect(visibleText(html)).not.toMatch(LATEX_MARKUP);
    expect(visibleText(section(html, 'formula-live'))).toContain('45 unidades');
  });

  it('MathText (quiz/explanations) uses the same safe renderer', () => {
    const html = renderToStaticMarkup(createElement(MathText, { text: 'Calcula $\\frac{6}{$ ahora' }));
    expect(html).not.toContain('katex-error');
    expect(visibleText(html)).not.toMatch(LATEX_MARKUP);
  });
});

describe('audit: every interactive formula surface shares the fixed component', () => {
  it('the widget renders math only through SafeMath -- no own KaTeX call, no LaTeX via dangerouslySetInnerHTML', () => {
    const src = read('src/app/dashboard/subjects/[id]/InteractiveFormulaWidget.tsx');
    expect(src).not.toMatch(/from 'katex'/);
    expect(src).toMatch(/<SafeMath latex=\{data\.latexTemplate\} display \/>/);
    expect(src).toMatch(/<SafeMath latex=\{substitutedLatex\} display \/>/);
    // the only innerHTML left is the diagram SVG (not LaTeX)
    expect(src.match(/dangerouslySetInnerHTML/g)).toHaveLength(1);
    expect(src).toMatch(/dangerouslySetInnerHTML=\{\{ __html: diagramSvg \}\}/);
  });

  it('SafeMath injects only compiled KaTeX output (throwOnError, no trust, no MathML source annotation)', () => {
    const safe = read('src/lib/math/safe-latex.ts');
    expect(safe).toMatch(/throwOnError: true, trust: false, strict: 'ignore', output: 'html'/);
    expect(read('src/components/SafeMath.tsx')).toMatch(/dangerouslySetInnerHTML=\{\{ __html: r\.html \}\}/);
    expect(renderLatexSafe('\\frac{1}{2}').ok && (renderLatexSafe('\\frac{1}{2}') as any).html).not.toContain('application/x-tex');
  });

  it('both callers (concept explanation and the quiz teaching intro) use the one widget', () => {
    expect(read('src/app/dashboard/subjects/[id]/ConceptExplanationPanel.tsx')).toMatch(/<InteractiveFormulaWidget /);
    expect(read('src/app/dashboard/quiz/TeachingIntro.tsx')).toMatch(/import InteractiveFormulaWidget from '@\/app\/dashboard\/subjects\/\[id\]\/InteractiveFormulaWidget'/);
  });
});
