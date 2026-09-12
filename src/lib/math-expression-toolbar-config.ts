/**
 * LX-8R2 R5/R12 -- structured math toolbar configuration for
 * `MathExpressionEditor`. Unlike `math-toolbar-config.ts` (which still
 * powers the plain-text `MathAnswerEditor` used for prose reasoning/
 * justification boxes -- R8 -- and inserts literal Unicode characters),
 * every button here inserts a LaTeX TEMPLATE into the mathfield's
 * structured model via MathLive's own placeholder syntax (`#0`, `#1`,
 * `#@`) -- never plain text into a plain input. A `#0`/`#1` marks an
 * editable placeholder MathLive's `insert()` selects automatically
 * (its default `selectionMode: 'placeholder'`), giving correct cursor
 * placement (numerator first for a fraction, inside the radical for a
 * root, etc.) with no extra code. `#@` means "apply to the selection,
 * or the atom immediately before the cursor" -- MathLive's own
 * convention for how typing `^` or `_` after an existing symbol
 * applies the exponent/subscript to that symbol, reused here for the
 * toolbar buttons so they behave identically to typing the shortcut key.
 *
 * R12: `primary` is the compact always-visible row (fraction, power,
 * root, parentheses, times, divide, equals, pi); `more` is the
 * expandable advanced palette (sum, integral, infinity, Greek letters,
 * inequalities, absolute value, subscript, nth root) -- never six tabs
 * of raw symbols.
 */

export interface MathTemplateButton {
  id: string;
  display: string;
  insertLatex: string;
  labelKey: string;
}

function tpl(id: string, display: string, insertLatex: string, labelKey: string): MathTemplateButton {
  return { id, display, insertLatex, labelKey };
}

export const MATH_PRIMARY_BUTTONS: MathTemplateButton[] = [
  tpl('fraction', 'a/b', '\\frac{#0}{#1}', 'mathToolbar.fraction'),
  tpl('exponent', 'xⁿ', '#@^{#0}', 'mathToolbar.exponent'),
  tpl('sqrt', '√', '\\sqrt{#0}', 'mathToolbar.squareRoot'),
  tpl('parens', '( )', '(#0)', 'mathToolbar.parentheses'),
  tpl('times', '×', '\\times', 'mathToolbar.times'),
  tpl('divide', '÷', '\\div', 'mathToolbar.divide'),
  tpl('equals', '=', '=', 'mathToolbar.equals'),
  tpl('pi', 'π', '\\pi', 'mathToolbar.pi'),
];

export const MATH_MORE_BUTTONS: MathTemplateButton[] = [
  tpl('subscript', 'xₙ', '#@_{#0}', 'mathToolbar.subscript'),
  tpl('nthroot', 'ⁿ√', '\\sqrt[#0]{#1}', 'mathToolbar.nthRoot'),
  tpl('abs', '| |', '\\left|#0\\right|', 'mathToolbar.absoluteValue'),
  tpl('neq', '≠', '\\neq', 'mathToolbar.notEquals'),
  tpl('leq', '≤', '\\leq', 'mathToolbar.lessOrEqual'),
  tpl('geq', '≥', '\\geq', 'mathToolbar.greaterOrEqual'),
  tpl('pm', '±', '\\pm', 'mathToolbar.plusMinus'),
  tpl('sum', '∑', '\\sum_{#0}^{#1}', 'mathToolbar.sum'),
  tpl('integral', '∫', '\\int_{#0}^{#1}', 'mathToolbar.integral'),
  tpl('infinity', '∞', '\\infty', 'mathToolbar.infinity'),
  tpl('theta', 'θ', '\\theta', 'mathToolbar.theta'),
  tpl('alpha', 'α', '\\alpha', 'mathToolbar.alpha'),
  tpl('beta', 'β', '\\beta', 'mathToolbar.beta'),
  tpl('lambda', 'λ', '\\lambda', 'mathToolbar.lambda'),
  tpl('mu', 'μ', '\\mu', 'mathToolbar.mu'),
  tpl('omega', 'ω', '\\omega', 'mathToolbar.omega'),
  tpl('Delta', 'Δ', '\\Delta', 'mathToolbar.delta'),
];
