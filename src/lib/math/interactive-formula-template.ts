import { evaluate } from 'mathjs';
import { latexToReadableText } from '@/lib/math/safe-latex';

/**
 * Placeholder substitution for interactive formulas (`{{symbol}}`,
 * `{{expression}}`, `{{result}}`).
 *
 * LaTeX templates put placeholders inside LaTeX groups, e.g.
 * `\frac{{{a}}}{{{b}}}` or `{{{r}}\,\text{m}}`. The old `\{\{([^}]+)\}\}`
 * matched from the FIRST brace (`{{{a}}` -> expression "{a"), failed to
 * evaluate, dropped the value and left unbalanced braces -- KaTeX then
 * printed the raw source in red. Placeholders are now matched innermost
 * (`\{\{([^{}]+)\}\}`), so the surrounding LaTeX group stays intact.
 */
const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g;

export function formatValue(v: number, step: number): string {
  const decimals = step < 1 ? Math.min(4, (String(step).split('.')[1] || '').length) : 0;
  return v.toFixed(decimals);
}

/** Result display: at most 2 decimals, no trailing zeros (45, 12.5, 0.33). */
export function formatResult(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function evaluatePlaceholder(expr: string, scope: Record<string, number>): number | null {
  try {
    const value = evaluate(expr, scope);
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  } catch {
    return null;
  }
}

/** Fills a LaTeX template. Negative values are parenthesized so `{{v}}^2` stays correct; an unevaluable placeholder becomes `?` (never an empty hole that breaks the LaTeX). */
export function substituteLatexTemplate(template: string, scope: Record<string, number>, resultText?: string): string {
  return template.replace(PLACEHOLDER_RE, (_, raw: string) => {
    const expr = raw.trim();
    if (expr === 'result' && resultText !== undefined) return resultText;
    const value = evaluatePlaceholder(expr, scope);
    if (value === null) return '?';
    return value < 0 ? `(${value})` : String(value);
  });
}

/** Fills an SVG template with plain numbers (attributes only). */
export function substituteSvgTemplate(template: string, scope: Record<string, number>): string {
  return template.replace(PLACEHOLDER_RE, (_, raw: string) => {
    const value = evaluatePlaceholder(raw.trim(), scope);
    return value === null ? '' : String(value);
  });
}

/** Plain-text form of a short label/unit/symbol that may carry LaTeX (`\text{m/s}^2` -> `m/s²`). */
export function plainMathLabel(s: string): string {
  const unwrapped = s.replace(/\$\$?([^$]*)\$\$?/g, '$1');
  return /[\\^_{}]/.test(unwrapped) ? latexToReadableText(unwrapped) : unwrapped;
}
