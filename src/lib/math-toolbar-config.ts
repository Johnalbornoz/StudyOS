/**
 * Math input toolbar configuration for Quiz open-answer fields.
 *
 * Every button is the same, simple thing: clicking it inserts plain
 * Unicode text at the cursor, exactly like Word's "Insert Symbol" --
 * never LaTeX, never a popup editor, never a special format. An answer
 * built entirely from these buttons is still just an ordinary string
 * (e.g. "F_c = mv²/r"), so it looks like normal text everywhere it's
 * shown -- the textarea itself, Review, Results -- with nothing extra
 * to render.
 *
 * A few buttons (exponent/subscript/root) insert a caret/underscore/
 * radical and let the student keep typing normally right after it
 * (`x^2`, `x_n`, `√x`) rather than trying to fake a real superscript --
 * that's the same plain-text convention students already use when
 * typing math by hand, not a compromise.
 *
 * `labelKey` points into the i18n message table so every tooltip/
 * aria-label is translated, never hardcoded.
 */

export type MathButtonCategory = 'basic' | 'structures' | 'greek' | 'physics' | 'more';

export interface MathButton {
  id: string;
  display: string;
  insertText: string;
  cursorOffset?: number; // where to place the cursor after inserting, relative to the end of insertText (e.g. -1 to land between two parens)
  labelKey: string;
  category: MathButtonCategory;
}

function button(id: string, display: string, insertText: string, labelKey: string, category: MathButtonCategory, cursorOffset?: number): MathButton {
  return { id, display, insertText, labelKey, category, cursorOffset };
}

export const MATH_BUTTONS: MathButton[] = [
  // Basic operators
  button('plus', '+', '+', 'mathToolbar.plus', 'basic'),
  button('minus', '−', '−', 'mathToolbar.minus', 'basic'),
  button('times', '×', '×', 'mathToolbar.times', 'basic'),
  button('divide', '÷', '÷', 'mathToolbar.divide', 'basic'),
  button('equals', '=', '=', 'mathToolbar.equals', 'basic'),
  button('neq', '≠', '≠', 'mathToolbar.notEquals', 'basic'),
  button('pm', '±', '±', 'mathToolbar.plusMinus', 'basic'),
  button('approx', '≈', '≈', 'mathToolbar.approx', 'basic'),
  button('lt', '<', '<', 'mathToolbar.lessThan', 'basic'),
  button('gt', '>', '>', 'mathToolbar.greaterThan', 'basic'),
  button('leq', '≤', '≤', 'mathToolbar.lessOrEqual', 'basic'),
  button('geq', '≥', '≥', 'mathToolbar.greaterOrEqual', 'basic'),

  // Math structures -- plain-text convention, keep typing right after
  button('square', 'x²', '²', 'mathToolbar.square', 'structures'),
  button('exponent', 'xⁿ', '^', 'mathToolbar.exponent', 'structures'),
  button('subscript', 'xₙ', '_', 'mathToolbar.subscript', 'structures'),
  button('fraction', 'a/b', '/', 'mathToolbar.fraction', 'structures'),
  button('sqrt', '√', '√', 'mathToolbar.squareRoot', 'structures'),
  button('nthroot', 'ⁿ√', 'ⁿ√', 'mathToolbar.nthRoot', 'structures'),
  button('parens', '( )', '()', 'mathToolbar.parentheses', 'structures', -1),
  button('abs', '| |', '||', 'mathToolbar.absoluteValue', 'structures', -1),

  // Greek letters
  button('pi', 'π', 'π', 'mathToolbar.pi', 'greek'),
  button('theta', 'θ', 'θ', 'mathToolbar.theta', 'greek'),
  button('alpha', 'α', 'α', 'mathToolbar.alpha', 'greek'),
  button('beta', 'β', 'β', 'mathToolbar.beta', 'greek'),
  button('gamma', 'γ', 'γ', 'mathToolbar.gamma', 'greek'),
  button('lambda', 'λ', 'λ', 'mathToolbar.lambda', 'greek'),
  button('mu', 'μ', 'μ', 'mathToolbar.mu', 'greek'),
  button('rho', 'ρ', 'ρ', 'mathToolbar.rho', 'greek'),
  button('sigma', 'σ', 'σ', 'mathToolbar.sigma', 'greek'),
  button('phi', 'φ', 'φ', 'mathToolbar.phi', 'greek'),
  button('omega', 'ω', 'ω', 'mathToolbar.omega', 'greek'),
  button('Omega', 'Ω', 'Ω', 'mathToolbar.bigOmega', 'greek'),
  button('Delta', 'Δ', 'Δ', 'mathToolbar.delta', 'greek'),

  // Physics-flavored -- vector combines with whatever letter was just typed
  // (U+20D7 combines with the preceding character, e.g. "v" + this -> "v⃗")
  button('vector', 'v⃗', '⃗', 'mathToolbar.vector', 'physics'),
  button('arrow', '→', '→', 'mathToolbar.arrow', 'physics'),
  button('degree', '°', '°', 'mathToolbar.degree', 'physics'),
  button('cdot', '·', '·', 'mathToolbar.dotProduct', 'physics'),

  // Advanced / less frequent
  button('sum', '∑', '∑', 'mathToolbar.sum', 'more'),
  button('integral', '∫', '∫', 'mathToolbar.integral', 'more'),
  button('infinity', '∞', '∞', 'mathToolbar.infinity', 'more'),
  button('partial', '∂', '∂', 'mathToolbar.partial', 'more'),
];

/**
 * Subject-aware prioritization: which buttons surface in the compact
 * "Basic" tab by default for a given subject. Everything remains
 * reachable in its full category tab regardless -- this only changes
 * what's promoted to the front. Chemistry is architecture-ready
 * (arrow/subscript/superscript already exist as general buttons) but
 * has no dedicated chemistry-only button set yet -- deliberately not
 * built out further until real chemistry usage justifies it.
 */
export type MathToolbarSubject = 'physics' | 'mathematics' | 'chemistry' | 'default';

export const mathToolbarConfig: Record<MathToolbarSubject, string[]> = {
  physics: ['Delta', 'theta', 'omega', 'vector', 'degree', 'exponent', 'fraction', 'sqrt'],
  mathematics: ['fraction', 'exponent', 'sqrt', 'pi', 'square', 'sum', 'integral', 'infinity'],
  chemistry: ['subscript', 'exponent', 'arrow', 'cdot'],
  default: ['fraction', 'exponent', 'subscript', 'sqrt', 'square', 'pi', 'theta', 'Delta'],
};

/** Simple v1 heuristic from a subject's display name -- no dedicated subject-taxonomy field exists yet to key off instead. */
export function inferMathToolbarSubject(subjectName: string | null | undefined): MathToolbarSubject {
  const name = (subjectName || '').toLowerCase();
  if (name.includes('phys') || name.includes('físic') || name.includes('fisik')) return 'physics';
  if (name.includes('math') || name.includes('matemát') || name.includes('mathemat')) return 'mathematics';
  if (name.includes('chem') || name.includes('quím') || name.includes('chimi')) return 'chemistry';
  return 'default';
}

export function buttonsForCategory(category: MathButtonCategory): MathButton[] {
  return MATH_BUTTONS.filter((b) => b.category === category);
}

export function priorityButtons(subject: MathToolbarSubject): MathButton[] {
  const ids = mathToolbarConfig[subject];
  return ids.map((id) => MATH_BUTTONS.find((b) => b.id === id)).filter((b): b is MathButton => !!b);
}
