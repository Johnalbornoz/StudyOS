/**
 * Math input toolbar configuration for Quiz open-answer fields.
 *
 * Two kinds of button:
 *
 * - `literal`: a single symbol/operator (π, Δ, →, parentheses, ...).
 *   Inserted as a plain Unicode character directly into the answer's
 *   existing plain-text field at the cursor -- no LaTeX involved, so
 *   an answer using only these stays a perfectly ordinary string,
 *   exactly like every historical answer already is.
 * - `structure`: something with real editable slots (a fraction's
 *   numerator/denominator, a variable exponent, a root). These open a
 *   small MathLive builder pre-seeded with the button's LaTeX template
 *   (MathLive's own `\placeholder{}` command marks each slot, and
 *   Tab/arrow-key navigation between them is native MathLive behavior,
 *   not custom code here); on confirm, the built LaTeX is inserted into
 *   the plain-text field wrapped as `$...$` (see math-text.ts), so only
 *   the actual formula becomes LaTeX -- the surrounding prose the
 *   student is writing never does.
 *
 * `labelKey` points into the i18n message table so every tooltip/
 * aria-label is translated, never hardcoded.
 */

export type MathButtonCategory = 'basic' | 'structures' | 'greek' | 'physics' | 'more';

export interface LiteralMathButton {
  kind: 'literal';
  id: string;
  display: string;
  insertText: string;
  cursorOffset?: number; // where to place the cursor after inserting, relative to the end of insertText (e.g. -1 to land between two parens)
  labelKey: string;
  category: MathButtonCategory;
}

export interface StructureMathButton {
  kind: 'structure';
  id: string;
  display: string;
  latex: string;
  labelKey: string;
  category: MathButtonCategory;
}

export type MathButton = LiteralMathButton | StructureMathButton;

function literal(id: string, display: string, insertText: string, labelKey: string, category: MathButtonCategory, cursorOffset?: number): LiteralMathButton {
  return { kind: 'literal', id, display, insertText, labelKey, category, cursorOffset };
}
function structure(id: string, display: string, latex: string, labelKey: string, category: MathButtonCategory): StructureMathButton {
  return { kind: 'structure', id, display, latex, labelKey, category };
}

export const MATH_BUTTONS: MathButton[] = [
  // Basic operators -- literal Unicode, no LaTeX
  literal('plus', '+', '+', 'mathToolbar.plus', 'basic'),
  literal('minus', '−', '−', 'mathToolbar.minus', 'basic'),
  literal('times', '×', '×', 'mathToolbar.times', 'basic'),
  literal('divide', '÷', '÷', 'mathToolbar.divide', 'basic'),
  literal('equals', '=', '=', 'mathToolbar.equals', 'basic'),
  literal('neq', '≠', '≠', 'mathToolbar.notEquals', 'basic'),
  literal('pm', '±', '±', 'mathToolbar.plusMinus', 'basic'),
  literal('approx', '≈', '≈', 'mathToolbar.approx', 'basic'),
  literal('lt', '<', '<', 'mathToolbar.lessThan', 'basic'),
  literal('gt', '>', '>', 'mathToolbar.greaterThan', 'basic'),
  literal('leq', '≤', '≤', 'mathToolbar.lessOrEqual', 'basic'),
  literal('geq', '≥', '≥', 'mathToolbar.greaterOrEqual', 'basic'),

  // Math structures -- these get the MathLive placeholder-navigable builder
  structure('square', 'x²', '^2', 'mathToolbar.square', 'structures'),
  structure('exponent', 'xⁿ', '^{\\placeholder{}}', 'mathToolbar.exponent', 'structures'),
  structure('subscript', 'xₙ', '_{\\placeholder{}}', 'mathToolbar.subscript', 'structures'),
  structure('fraction', 'a/b', '\\frac{\\placeholder{}}{\\placeholder{}}', 'mathToolbar.fraction', 'structures'),
  structure('sqrt', '√', '\\sqrt{\\placeholder{}}', 'mathToolbar.squareRoot', 'structures'),
  structure('nthroot', 'ⁿ√', '\\sqrt[\\placeholder{}]{\\placeholder{}}', 'mathToolbar.nthRoot', 'structures'),
  literal('parens', '( )', '()', 'mathToolbar.parentheses', 'structures', -1),
  literal('abs', '| |', '||', 'mathToolbar.absoluteValue', 'structures', -1),

  // Greek letters -- literal Unicode
  literal('pi', 'π', 'π', 'mathToolbar.pi', 'greek'),
  literal('theta', 'θ', 'θ', 'mathToolbar.theta', 'greek'),
  literal('alpha', 'α', 'α', 'mathToolbar.alpha', 'greek'),
  literal('beta', 'β', 'β', 'mathToolbar.beta', 'greek'),
  literal('gamma', 'γ', 'γ', 'mathToolbar.gamma', 'greek'),
  literal('lambda', 'λ', 'λ', 'mathToolbar.lambda', 'greek'),
  literal('mu', 'μ', 'μ', 'mathToolbar.mu', 'greek'),
  literal('rho', 'ρ', 'ρ', 'mathToolbar.rho', 'greek'),
  literal('sigma', 'σ', 'σ', 'mathToolbar.sigma', 'greek'),
  literal('phi', 'φ', 'φ', 'mathToolbar.phi', 'greek'),
  literal('omega', 'ω', 'ω', 'mathToolbar.omega', 'greek'),
  literal('Omega', 'Ω', 'Ω', 'mathToolbar.bigOmega', 'greek'),
  literal('Delta', 'Δ', 'Δ', 'mathToolbar.delta', 'greek'),

  // Physics-flavored -- literal Unicode; vector needs a slot (what's under the arrow), so it's a structure
  structure('vector', 'v⃗', '\\vec{\\placeholder{}}', 'mathToolbar.vector', 'physics'),
  literal('arrow', '→', '→', 'mathToolbar.arrow', 'physics'),
  literal('degree', '°', '°', 'mathToolbar.degree', 'physics'),
  literal('cdot', '·', '·', 'mathToolbar.dotProduct', 'physics'),

  // Advanced / less frequent
  structure('sum', '∑', '\\sum_{\\placeholder{}}^{\\placeholder{}}\\placeholder{}', 'mathToolbar.sum', 'more'),
  structure('integral', '∫', '\\int_{\\placeholder{}}^{\\placeholder{}}\\placeholder{}', 'mathToolbar.integral', 'more'),
  literal('infinity', '∞', '∞', 'mathToolbar.infinity', 'more'),
  literal('partial', '∂', '∂', 'mathToolbar.partial', 'more'),
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
