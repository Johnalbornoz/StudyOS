/**
 * Mathematical equivalence for grading -- StudyUs grades like a teacher,
 * not like a string comparator. Two answers that denote the same value
 * (or the same equation) are the same answer, whatever their notation:
 *
 *   40 × 8 / 5  ≡  (40·8)/5  ≡  8*40÷5  ≡  \frac{40\times 8}{5}  ≡  64
 *   28,8 ≡ 28.8 · 20/9 ≡ 40/18 · 4/7 = 12/x ≡ 4/12 = 7/x (same solution)
 *
 * Pure and deterministic. Expressions are parsed with mathjs and the parse
 * tree is checked against a strict whitelist (numbers, + - * / ^, unary
 * minus, parentheses, sqrt, ONE variable) before anything is evaluated --
 * free text is never evaluated. Anything outside that grammar is
 * UNDECIDABLE and left to the pedagogical grader, never guessed.
 */
import { parse, type MathNode } from 'mathjs';

export type DecimalConvention = 'comma' | 'point';

/** Locales whose decimal separator is the comma. */
const COMMA_DECIMAL_LOCALES = new Set(['es', 'de', 'fr', 'pt']);

export function decimalConventionFor(language: string | undefined): DecimalConvention {
  return language && COMMA_DECIMAL_LOCALES.has(language) ? 'comma' : 'point';
}

/* ------------------------------------------------------------------ */
/* Units                                                                */
/* ------------------------------------------------------------------ */

type Dimension = 'currency_eur' | 'currency_usd' | 'mass' | 'volume' | 'time' | 'length' | 'percent';
interface UnitDef {
  dimension: Dimension;
  factor: number;
}
const UNITS: Record<string, UnitDef> = {
  '€': { dimension: 'currency_eur', factor: 1 }, eur: { dimension: 'currency_eur', factor: 1 }, euro: { dimension: 'currency_eur', factor: 1 }, euros: { dimension: 'currency_eur', factor: 1 },
  '$': { dimension: 'currency_usd', factor: 1 }, usd: { dimension: 'currency_usd', factor: 1 }, dolar: { dimension: 'currency_usd', factor: 1 }, dolares: { dimension: 'currency_usd', factor: 1 }, dollar: { dimension: 'currency_usd', factor: 1 }, dollars: { dimension: 'currency_usd', factor: 1 },
  mg: { dimension: 'mass', factor: 0.001 }, g: { dimension: 'mass', factor: 1 }, gr: { dimension: 'mass', factor: 1 }, gramos: { dimension: 'mass', factor: 1 }, grams: { dimension: 'mass', factor: 1 }, kg: { dimension: 'mass', factor: 1000 }, kilos: { dimension: 'mass', factor: 1000 }, kilogramos: { dimension: 'mass', factor: 1000 },
  ml: { dimension: 'volume', factor: 1 }, mililitros: { dimension: 'volume', factor: 1 }, millilitres: { dimension: 'volume', factor: 1 }, milliliters: { dimension: 'volume', factor: 1 }, cl: { dimension: 'volume', factor: 10 }, dl: { dimension: 'volume', factor: 100 }, l: { dimension: 'volume', factor: 1000 }, litros: { dimension: 'volume', factor: 1000 }, litres: { dimension: 'volume', factor: 1000 }, liters: { dimension: 'volume', factor: 1000 },
  s: { dimension: 'time', factor: 1 }, seg: { dimension: 'time', factor: 1 }, segundos: { dimension: 'time', factor: 1 }, seconds: { dimension: 'time', factor: 1 }, min: { dimension: 'time', factor: 60 }, minutos: { dimension: 'time', factor: 60 }, minutes: { dimension: 'time', factor: 60 }, h: { dimension: 'time', factor: 3600 }, horas: { dimension: 'time', factor: 3600 }, hours: { dimension: 'time', factor: 3600 },
  mm: { dimension: 'length', factor: 0.001 }, cm: { dimension: 'length', factor: 0.01 }, m: { dimension: 'length', factor: 1 }, metros: { dimension: 'length', factor: 1 }, meters: { dimension: 'length', factor: 1 }, km: { dimension: 'length', factor: 1000 },
  '%': { dimension: 'percent', factor: 1 },
};

/* ------------------------------------------------------------------ */
/* Normalization                                                        */
/* ------------------------------------------------------------------ */

/** Strips LaTeX/markup into plain infix: \frac{a}{b} -> ((a)/(b)), \times/\cdot -> *, \div -> /, \sqrt{a} -> sqrt(a). */
function delatex(s: string): string {
  let out = s.replace(/\$+/g, ' ');
  // \frac / \dfrac / \tfrac, innermost first, repeated for nesting
  const FRAC = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/;
  for (let i = 0; i < 10 && FRAC.test(out); i++) out = out.replace(FRAC, '(($1)/($2))');
  const SQRT = /\\sqrt\s*\{([^{}]*)\}/;
  for (let i = 0; i < 10 && SQRT.test(out); i++) out = out.replace(SQRT, 'sqrt($1)');
  out = out
    .replace(/\\text\s*\{([^{}]*)\}/g, ' $1 ')
    .replace(/\\mathrm\s*\{([^{}]*)\}/g, ' $1 ')
    .replace(/\\(times|cdot|ast)\b/g, '*')
    .replace(/\\div\b/g, '/')
    .replace(/\\(left|right|,|;|!|quad|qquad)/g, ' ')
    .replace(/\\euro\b/g, '€')
    .replace(/[{}]/g, ''); // 28{,}8 -> 28,8
  return out;
}

/**
 * Plain-text math normalization: multiplication signs (× · ⋅ ∙ * and `x`
 * between two numeric operands), division (÷ : /), minus variants, decimal
 * separators by convention, thousands separators. A lone `x` next to
 * anything that is not a numeric operand on BOTH sides stays a variable.
 */
export function normalizeMathText(raw: string, convention: DecimalConvention = 'comma'): string {
  let s = delatex(raw.normalize('NFKC'));
  s = s
    .replace(/[×✕✖·⋅∙•]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/ /g, ' ');
  // `x`/`X` as multiplication only between two numeric operands: 40 x 8, (3)x(2), 5x8
  s = s.replace(/([0-9)])\s*[xX]\s*(?=[0-9(])/g, '$1*');
  // thousands / decimal separators
  if (convention === 'comma') {
    s = s.replace(/(\d)\.(\d{3})(?!\d)(?![.,]\d)/g, '$1$2'); // 1.050 -> 1050 (es thousands)
    s = s.replace(/(\d),(\d)/g, '$1.$2'); // 28,8 -> 28.8
  } else {
    s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); // 1,050 -> 1050 (en thousands)
  }
  return s.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Safe parsing / evaluation                                           */
/* ------------------------------------------------------------------ */

const ALLOWED_FUNCTIONS = new Set(['sqrt']);
const MAX_EXPR_LENGTH = 200;

/** Parses an arithmetic expression (at most one single-letter variable). Returns null when outside the whitelist. */
const MAX_VARIABLES = 3;

/** Parses an arithmetic expression over at most three single-letter variables. Returns null when outside the whitelist. */
export function parseSafeExpressionMulti(expr: string): { node: MathNode; variables: string[] } | null {
  const e = expr.trim();
  if (!e || e.length > MAX_EXPR_LENGTH || !/^[0-9a-zA-Z+\-*/^().\s]+$/.test(e)) return null;
  let node: MathNode;
  try {
    node = parse(e);
  } catch {
    return null;
  }
  const variables = new Set<string>();
  let ok = true;
  node.traverse((n: MathNode, _path: string, parent: MathNode | null) => {
    if (!ok) return;
    switch (n.type) {
      case 'ConstantNode':
        if (typeof (n as unknown as { value: unknown }).value !== 'number') ok = false;
        return;
      case 'ParenthesisNode':
        return;
      case 'OperatorNode':
        if (!['+', '-', '*', '/', '^'].includes((n as unknown as { op: string }).op)) ok = false;
        return;
      case 'FunctionNode':
        if (!ALLOWED_FUNCTIONS.has((n as unknown as { fn: { name: string } }).fn.name)) ok = false;
        return;
      case 'SymbolNode': {
        const name = (n as unknown as { name: string }).name;
        if (parent && parent.type === 'FunctionNode' && (parent as unknown as { fn: MathNode }).fn === n) return;
        if (!/^[a-zA-Z]$/.test(name)) ok = false;
        else variables.add(name);
        if (variables.size > MAX_VARIABLES) ok = false;
        return;
      }
      default:
        ok = false;
    }
  });
  return ok ? { node, variables: [...variables].sort() } : null;
}

/** Single-variable form (equations, final values). */
export function parseSafeExpression(expr: string): { node: MathNode; variable: string | null } | null {
  const p = parseSafeExpressionMulti(expr);
  if (!p || p.variables.length > 1) return null;
  return { node: p.node, variable: p.variables[0] ?? null };
}

function evalAt(node: MathNode, variable: string | null, value?: number): number | null {
  try {
    const scope: Record<string, number> = variable && value !== undefined ? { [variable]: value } : {};
    const r = node.compile().evaluate(scope);
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  } catch {
    return null;
  }
}

/** Numeric value of a variable-free expression, or null. */
export function evaluateExpression(expr: string): number | null {
  const p = parseSafeExpression(expr);
  if (!p || p.variable) return null;
  return evalAt(p.node, null);
}

/* ------------------------------------------------------------------ */
/* Final values with units                                             */
/* ------------------------------------------------------------------ */

export interface MathValue {
  value: number;
  /** Canonical unit key, or null when none was written. */
  unit: string | null;
  /** Decimal places the author wrote (for rounding tolerance). */
  decimals: number;
}

const UNIT_TOKEN = /(€|\$|%|[a-záéíóúñ]+)\.?$/i;

function splitUnit(segment: string): { expr: string; unit: string | null } {
  const t = segment.trim().replace(/[.;:]+$/, '');
  const m = t.match(UNIT_TOKEN);
  if (m) {
    const key = m[1].toLowerCase();
    if (UNITS[key]) return { expr: t.slice(0, m.index).trim(), unit: key };
    // a counted noun ("144 piezas", "8 cuadernos") is not a physical unit: dropped, value kept
    if (key.length >= 2) return { expr: t.slice(0, m.index).trim(), unit: null };
  }
  const lead = t.match(/^(€|\$)\s*(.*)$/);
  if (lead) return { expr: lead[2], unit: lead[1] };
  return { expr: t, unit: null };
}

function decimalsOf(expr: string): number {
  const m = expr.match(/\.(\d+)\s*$/);
  return m ? m[1].length : 0;
}

/**
 * The final value an answer commits to: the last evaluable right-hand side
 * of an `=` chain ("x = 40*8/5 = 64 €" -> 64 €), or the whole text when it
 * is a single expression ("8*40÷5" -> 64). Null when there is no single
 * numeric commitment (e.g. prose, or an equation left unsolved).
 */
export function extractFinalValue(raw: string, convention: DecimalConvention = 'comma'): MathValue | null {
  const text = normalizeMathText(raw, convention);
  // a single solved-for equation ("5x = 320", "x/8 = 18/5") commits to its solution
  const eqParts = text.split('=');
  if (eqParts.length === 2 && /[a-zA-Z]/.test(eqParts[0]) && parseSafeExpression(eqParts[0].trim())?.variable) {
    const { unit } = splitUnit(eqParts[1]);
    const solved = solveEquation(`${eqParts[0]}=${splitUnit(eqParts[1]).expr}`, 'point');
    if (solved && !/^\s*[a-zA-Z]\s*$/.test(eqParts[0])) return { value: solved.value, unit, decimals: 0 };
  }
  // candidate segments: every "=" chain inside the text, rightmost first
  const segments = text.split('=').map((s) => s.trim()).filter(Boolean);
  const candidates = segments.length > 1 ? [...segments].reverse() : [text];
  for (const cand of candidates) {
    // take the trailing math-looking run of the segment (after any words)
    const runs = cand.match(/[0-9(][0-9+\-*/^().\s]*(?:\s*(?:€|\$|%|[a-záéíóúñ]+\.?))?/gi) ?? [];
    for (const run of runs.reverse()) {
      const { expr, unit } = splitUnit(run);
      const value = evaluateExpression(expr);
      if (value !== null) return { value, unit, decimals: decimalsOf(expr) };
    }
  }
  return null;
}

export type UnitStatus = 'MATCH' | 'CONVERTED' | 'MISSING' | 'MISMATCH' | 'NONE';

function compareUnits(a: string | null, b: string | null): { status: UnitStatus; factor: number } {
  if (!a && !b) return { status: 'NONE', factor: 1 };
  if (!a || !b) return { status: 'MISSING', factor: 1 };
  const ua = UNITS[a];
  const ub = UNITS[b];
  if (!ua || !ub) return a === b ? { status: 'MATCH', factor: 1 } : { status: 'MISMATCH', factor: 1 };
  if (ua.dimension !== ub.dimension) return { status: 'MISMATCH', factor: 1 };
  return { status: ua.factor === ub.factor ? 'MATCH' : 'CONVERTED', factor: ua.factor / ub.factor };
}

/** Equal within float noise, or within the rounding the student visibly applied (28,8 vs 28.7999; 2,33 vs 7/3). */
export function numbersEquivalent(student: number, expected: number, studentDecimals = 0): boolean {
  // the tolerance the Question Quality Gate already certifies for numeric answers (tryRecomputeNumeric)
  const tol = Math.max(1e-6, Math.abs(expected) * 1e-4);
  if (Math.abs(student - expected) <= tol) return true;
  if (studentDecimals > 0) return Math.abs(student - expected) <= 0.5 * 10 ** -studentDecimals + tol;
  return false;
}

export type EquivalenceStatus = 'EQUIVALENT' | 'DIFFERENT' | 'UNDECIDABLE';

export interface ValueEquivalence {
  status: EquivalenceStatus;
  student: MathValue | null;
  expected: MathValue | null;
  unitStatus: UnitStatus;
}

/** Are the final values of two answers the same quantity? Notation never matters; a different dimension does. */
export function finalValuesEquivalent(studentRaw: string, expectedRaw: string, convention: DecimalConvention = 'comma'): ValueEquivalence {
  const expected = extractFinalValue(expectedRaw, convention);
  const student = extractFinalValue(studentRaw, convention);
  if (!expected || !student) return { status: 'UNDECIDABLE', student, expected, unitStatus: 'NONE' };
  const units = compareUnits(student.unit, expected.unit);
  if (units.status === 'MISMATCH') return { status: 'DIFFERENT', student, expected, unitStatus: 'MISMATCH' };
  const same = numbersEquivalent(student.value * units.factor, expected.value, student.decimals);
  return { status: same ? 'EQUIVALENT' : 'DIFFERENT', student, expected, unitStatus: units.status };
}

/** A single number with an optional unit / counted noun ("64", "28,8 €", "1050 mL") -- no operators, no `=`. */
export function isBareValue(raw: string, language?: string): boolean {
  const text = normalizeMathText(raw, decimalConventionFor(language));
  const { expr } = splitUnit(text);
  return /^[-+]?\d+(\.\d+)?$/.test(expr.trim());
}

/* ------------------------------------------------------------------ */
/* Expressions and equations                                           */
/* ------------------------------------------------------------------ */

const PROBES = [-3.7, -1.3, 0.6, 1.9, 2.8, 4.4, 7.1];

/** Algebraic equivalence of two expressions (commutativity, factoring, equivalent fractions...), by evaluation at probe points. */
export function expressionsEquivalent(a: string, b: string, convention: DecimalConvention = 'comma'): EquivalenceStatus {
  const pa = parseSafeExpressionMulti(normalizeMathText(a, convention));
  const pb = parseSafeExpressionMulti(normalizeMathText(b, convention));
  if (!pa || !pb) return 'UNDECIDABLE';
  const vars = [...new Set([...pa.variables, ...pb.variables])].sort();
  if (vars.length > MAX_VARIABLES) return 'UNDECIDABLE';
  const evalScope = (node: MathNode, scope: Record<string, number>) => {
    try {
      const r = node.compile().evaluate({ ...scope });
      return typeof r === 'number' && Number.isFinite(r) ? r : null;
    } catch {
      return null;
    }
  };
  let compared = 0;
  const rounds = vars.length ? PROBES.length : 1;
  for (let i = 0; i < rounds; i++) {
    // a different probe per variable, so a*b+c vs c+b*a is checked at genuinely independent points
    const scope = Object.fromEntries(vars.map((v, j) => [v, PROBES[(i + 2 * j) % PROBES.length] + j * 0.37]));
    const ra = evalScope(pa.node, scope);
    const rb = evalScope(pb.node, scope);
    if (ra === null || rb === null) continue;
    compared++;
    if (!numbersEquivalent(ra, rb)) return 'DIFFERENT';
  }
  return compared > 0 ? 'EQUIVALENT' : 'UNDECIDABLE';
}

/** The solution of a single-variable equation `lhs = rhs` (secant method from several starts, verified). */
export function solveEquation(equation: string, convention: DecimalConvention = 'comma'): { variable: string; value: number } | null {
  const norm = normalizeMathText(equation, convention);
  const parts = norm.split('=');
  if (parts.length !== 2) return null;
  const pl = parseSafeExpression(parts[0]);
  const pr = parseSafeExpression(parts[1]);
  if (!pl || !pr) return null;
  const variable = pl.variable ?? pr.variable;
  if (!variable || (pl.variable && pr.variable && pl.variable !== pr.variable)) return null;
  const f = (x: number) => {
    const l = evalAt(pl.node, pl.variable, x);
    const r = evalAt(pr.node, pr.variable, x);
    return l === null || r === null ? null : l - r;
  };
  for (const start of [1, 10, 100, -10, 0.5, 1000]) {
    let x0 = start;
    let x1 = start * 1.1 + 0.1;
    for (let i = 0; i < 80; i++) {
      const f0 = f(x0);
      const f1 = f(x1);
      if (f0 === null || f1 === null || f1 === f0) break;
      const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
      if (!Number.isFinite(x2)) break;
      x0 = x1;
      x1 = x2;
      if (Math.abs(x1 - x0) < 1e-12 * Math.max(1, Math.abs(x1))) break;
    }
    const fx = f(x1);
    if (fx !== null && Math.abs(fx) < 1e-7 * Math.max(1, Math.abs(x1))) return { variable, value: x1 };
  }
  return null;
}

/** Two single-variable equations (e.g. proportions) are equivalent when they have the same solution. */
export function equationsEquivalent(a: string, b: string, convention: DecimalConvention = 'comma'): EquivalenceStatus {
  const sa = solveEquation(a, convention);
  const sb = solveEquation(b, convention);
  if (!sa || !sb) return 'UNDECIDABLE';
  return numbersEquivalent(sa.value, sb.value) ? 'EQUIVALENT' : 'DIFFERENT';
}

/** Splits normalized text into math-only segments: words (2+ letters, except sqrt) and clause punctuation are separators. */
function mathSegments(text: string): string[] {
  return text
    .replace(/(?<![a-z])(?!sqrt\b)[a-záéíóúñ]{2,}/gi, '|')
    .replace(/[,;:!?¿¡]/g, '|')
    .split('|')
    .map((seg) => seg.trim().replace(/^[.\s]+|[.\s]+$/g, ''))
    .filter((seg) => /\d|[a-zA-Z]/.test(seg));
}

/** Every solvable single-variable equation (proportions included) written inside a text. */
export function extractEquations(raw: string, convention: DecimalConvention = 'comma'): string[] {
  const found: string[] = [];
  for (const seg of mathSegments(normalizeMathText(raw, convention))) {
    const parts = seg.split('=').map((p) => p.trim()).filter(Boolean);
    for (let i = 0; i + 1 < parts.length; i++) {
      const eq = `${parts[i]}=${parts[i + 1]}`;
      if (solveEquation(eq, 'point')) found.push(eq);
    }
  }
  return found;
}
