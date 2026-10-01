/**
 * Exam V2 -- the mathematical equivalence engine (sections 25, 27, 28, 29).
 *
 * Math is never compared as strings. A student answer (typed text or the
 * LaTeX the MathLive editor emits) is normalized, parsed with mathjs into an
 * AST, and that AST is checked against a STRICT whitelist (numbers, + - * / ^,
 * unary minus, parentheses, a small set of named functions and constants,
 * short variable names) before anything is evaluated -- free text is never
 * evaluated, and there is no arbitrary eval: mathjs compiles only the
 * whitelisted tree.
 *
 * It returns separate verdicts -- mathematical correctness, required-form
 * compliance, unit correctness, significant figures -- and a final judgment,
 * so a formatting difference never turns a correct value into "wrong" and a
 * correct-but-not-in-the-requested-form answer is distinguishable.
 * Anything outside the grammar is UNDECIDABLE (left to the interpretive
 * grader / human review), never guessed.
 */
import { parse, unit as mathUnit, type MathNode, type Unit } from 'mathjs';
import { decimalConventionFor } from '@/lib/grading/math-equivalence';

export type MathKind = 'EXPRESSION' | 'NUMBER' | 'EQUATION' | 'INEQUALITY' | 'INTERVAL';
export type RequiredForm = 'ANY' | 'EXACT' | 'DECIMAL' | 'SIMPLIFIED_FRACTION' | 'FACTORED' | 'EXPANDED' | 'SCIENTIFIC' | 'INTEGER';

export interface MathKey {
  kind: MathKind;
  /** Accepted answers (LaTeX or plain text); any one of them may match. */
  answers: string[];
  requiredForm?: RequiredForm;
  /** Exact number of decimal places required (DECIMAL form). */
  decimalPlaces?: number;
  /** Significant figures required on the final numeric value. */
  significantFigures?: number;
  tolerance?: { absolute?: number; relative?: number };
  units?: { expected: string; required?: boolean; allowConversion?: boolean };
}

export type Correctness = 'EQUIVALENT' | 'NOT_EQUIVALENT' | 'UNDECIDABLE';
export type FormCompliance = 'MET' | 'NOT_MET' | 'NOT_REQUIRED';
export type UnitCorrectness = 'CORRECT' | 'CONVERTED' | 'MISSING' | 'WRONG' | 'NOT_REQUIRED';
export type FinalJudgment = 'CORRECT' | 'PARTIALLY_CORRECT' | 'INCORRECT' | 'UNDECIDABLE';

export interface MathGrade {
  literal: string;
  normalized: string | null;
  latex: string | null;
  ast: unknown;
  mathematicalCorrectness: Correctness;
  formCompliance: FormCompliance;
  unitCorrectness: UnitCorrectness;
  significantFigures: FormCompliance;
  judgment: FinalJudgment;
  reasons: string[];
}

const MAX_LEN = 300;
const ALLOWED_FUNCTIONS = new Set(['sqrt', 'nthRoot', 'cbrt', 'abs', 'exp', 'log', 'log10', 'sin', 'cos', 'tan']);
const CONSTANTS = new Set(['pi', 'e']);
const MAX_VARIABLES = 4;

/* ------------------------------------------------------------------ */
/* Normalization: LaTeX / typed text -> plain infix                     */
/* ------------------------------------------------------------------ */

/** LaTeX (MathLive output) to plain infix. Innermost structures first, repeated for nesting. */
export function latexToInfix(input: string): string {
  let s = input.replace(/\$+/g, ' ');
  s = s.replace(/\\left|\\right|\\big|\\Big|\\bigl|\\bigr/g, '');
  s = s.replace(/\\mathrm\{([^{}]*)\}|\\text\{([^{}]*)\}|\\operatorname\{([^{}]*)\}/g, (_m, a, b, c) => ` ${a ?? b ?? c} `);
  // Innermost-first, repeated until stable, so \frac{\sqrt{2}}{2} and nested powers resolve.
  for (let pass = 0; pass < 30; pass++) {
    const before = s;
    s = s.replace(/(\d+)\s*\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/, (_m, w, a, b) => `(${w}+(${a})/(${b}))`);
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/, (_m, a, b) => `((${a})/(${b}))`);
    s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/, (_m, n, a) => `nthRoot((${a}),(${n}))`);
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/, (_m, a) => `sqrt(${a})`);
    s = s.replace(/\^\s*\{([^{}]*)\}/, (_m, a) => `^(${a})`);
    s = s.replace(/_\s*\{([^{}]*)\}/, (_m, a) => `_${String(a).replace(/\W/g, '')}`);
    if (s === before) break;
  }
  s = s.replace(/\\sqrt\s*(\d+|[a-zA-Z])/g, 'sqrt($1)');
  s = s
    .replace(/\\(cdot|times|ast)\b/g, '*')
    .replace(/\\div\b/g, '/')
    .replace(/\\pi\b/g, ' pi ')
    .replace(/\\infty\b/g, ' Infinity ')
    .replace(/\\(le|leq|leqslant)\b/g, '<=')
    .replace(/\\(ge|geq|geqslant)\b/g, '>=')
    .replace(/\\(lt)\b/g, '<')
    .replace(/\\(gt)\b/g, '>')
    .replace(/\\neq?\b/g, '!=')
    .replace(/\\cup\b/g, ' U ')
    .replace(/\\(ln)\b/g, ' log ')
    .replace(/\\(log)\b/g, ' log10 ')
    .replace(/\\(sin|cos|tan|exp)\b/g, ' $1 ')
    .replace(/\\(vert|lvert|rvert|mid)\b/g, '|')
    .replace(/\\(,|;|:|!|quad|qquad| )/g, ' ')
    .replace(/[{}]/g, ' ');
  return s;
}

const SUPERSCRIPTS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

/** Text normalization shared by expressions and units. Decimal convention follows the Student's language. */
export function normalizeInfix(raw: string, language = 'en'): string {
  // Superscripts BEFORE NFKC (which would silently turn x² into x2).
  const sup = raw.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)/g, (m) => `^(${[...m].map((c) => SUPERSCRIPTS[c] ?? '').join('')})`);
  let s = latexToInfix(sup.normalize('NFKC'));
  s = s
    .replace(/[×✕✖·⋅∙•]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√\s*(\d+(?:\.\d+)?|[a-zA-Z])/g, 'sqrt($1)')
    .replace(/π/g, ' pi ')
    .replace(/∞/g, ' Infinity ')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/∪/g, ' U ');
  // |x| -> abs(x) (non-nested)
  s = s.replace(/\|([^|]+)\|/g, 'abs($1)');
  // Typed mixed number: "2 2/25" -> (2+2/25) (a space between an integer and a fraction is never a product in typed answers).
  s = s.replace(/(^|[^\d.])(\d+)\s+(\d+)\s*\/\s*(\d+)(?![\d.])/g, '$1($2+$3/$4)');
  if (decimalConventionFor(language) === 'comma') {
    // 1.050 -> 1050 (thousands) only when the language writes decimals with a comma; 2,5 -> 2.5
    s = s.replace(/(\d)\.(\d{3})(?!\d)(?![.,]\d)/g, '$1$2').replace(/(\d),(\d)/g, '$1.$2');
  } else {
    s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Safe parse                                                          */
/* ------------------------------------------------------------------ */

export interface SafeExpression {
  node: MathNode;
  variables: string[];
}

export function parseSafe(expr: string): SafeExpression | null {
  // A single-letter variable before "(" is multiplication (x(x-2), n(n+1)) -- never a call: every allowed function name is longer.
  const e = expr.trim().replace(/(^|[^a-zA-Z_])([a-zA-Z])\s*\(/g, '$1$2*(');
  if (!e || e.length > MAX_LEN || !/^[0-9a-zA-Z_+\-*/^().,\s]+$/.test(e)) return null;
  let node: MathNode;
  try {
    node = parse(e);
  } catch {
    return null;
  }
  const variables = new Set<string>();
  let ok = true;
  node.traverse((n: MathNode, _p: string, parent: MathNode | null) => {
    if (!ok) return;
    switch (n.type) {
      case 'ConstantNode':
        if (typeof (n as unknown as { value: unknown }).value !== 'number') ok = false;
        return;
      case 'ParenthesisNode':
        return;
      case 'OperatorNode': {
        const op = (n as unknown as { op: string }).op;
        if (!['+', '-', '*', '/', '^'].includes(op)) ok = false;
        return;
      }
      case 'FunctionNode':
        if (!ALLOWED_FUNCTIONS.has((n as unknown as { fn: { name: string } }).fn.name)) ok = false;
        return;
      case 'SymbolNode': {
        const name = (n as unknown as { name: string }).name;
        if (parent && parent.type === 'FunctionNode' && (parent as unknown as { fn: MathNode }).fn === n) return;
        if (CONSTANTS.has(name)) return;
        if (!/^[a-zA-Z](_?\w{0,3})?$/.test(name) || ALLOWED_FUNCTIONS.has(name)) ok = false;
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

function evaluate(node: MathNode, scope: Record<string, number>): number | null {
  try {
    const r = node.compile().evaluate({ ...scope });
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  } catch {
    return null;
  }
}

function close(a: number, b: number, tol?: { absolute?: number; relative?: number }): boolean {
  const abs = tol?.absolute ?? 0;
  const rel = tol?.relative ?? 1e-9;
  return Math.abs(a - b) <= Math.max(abs, rel * Math.max(1, Math.abs(a), Math.abs(b)), 1e-12);
}

// Deterministic probe points: away from 0/1/integers so coincidences are unlikely.
const PROBES = [0.731, 1.618, 2.414, -0.577, 3.303, -1.913, 0.413, 4.127];

function probeScope(vars: string[], i: number): Record<string, number> {
  return Object.fromEntries(vars.map((v, j) => [v, PROBES[(i + 3 * j) % PROBES.length] + 0.211 * j]));
}

/** Algebraic equivalence by evaluation at independent probe points (domain-safe: skips points where either side is undefined). */
export function expressionsEquivalent(a: SafeExpression, b: SafeExpression, tol?: MathKey['tolerance']): Correctness {
  const vars = [...new Set([...a.variables, ...b.variables])].sort();
  const rounds = vars.length ? PROBES.length : 1;
  let compared = 0;
  for (let i = 0; i < rounds; i++) {
    const scope = probeScope(vars, i);
    const ra = evaluate(a.node, scope);
    const rb = evaluate(b.node, scope);
    if (ra === null || rb === null) continue;
    compared++;
    if (!close(ra, rb, vars.length ? undefined : tol)) return 'NOT_EQUIVALENT';
  }
  return compared >= Math.min(3, rounds) ? 'EQUIVALENT' : 'UNDECIDABLE';
}

/** f = lhs - rhs. Two relations are equivalent when f1 = k·f2 for a constant k (k > 0 for inequalities). */
function proportional(f1: SafeExpression, f2: SafeExpression, positiveOnly: boolean): Correctness {
  const vars = [...new Set([...f1.variables, ...f2.variables])].sort();
  let k: number | null = null;
  let compared = 0;
  for (let i = 0; i < PROBES.length; i++) {
    const scope = probeScope(vars, i);
    const a = evaluate(f1.node, scope);
    const b = evaluate(f2.node, scope);
    if (a === null || b === null) continue;
    if (Math.abs(b) < 1e-12) {
      if (Math.abs(a) > 1e-9) return 'NOT_EQUIVALENT';
      continue;
    }
    const ratio = a / b;
    if (k === null) k = ratio;
    else if (!close(ratio, k)) return 'NOT_EQUIVALENT';
    compared++;
  }
  if (k === null || compared < 3 || Math.abs(k) < 1e-12) return 'UNDECIDABLE';
  if (positiveOnly && k < 0) return 'NOT_EQUIVALENT';
  return 'EQUIVALENT';
}

interface Relation {
  op: '=' | '<' | '<=' | '>' | '>=';
  f: SafeExpression;
}

function parseRelation(text: string): Relation | null {
  const m = text.match(/^(.*?)(<=|>=|=|<|>)(.*)$/);
  if (!m || /(<=|>=|=|<|>)/.test(m[3])) return null;
  const lhs = m[1].trim();
  const rhs = m[3].trim();
  if (!lhs || !rhs) return null;
  // normalize to "f op 0" with f = lhs - rhs, and flip > / >= into < / <= with f = rhs - lhs
  const op = m[2] as Relation['op'];
  const flip = op === '>' || op === '>=';
  const f = parseSafe(flip ? `(${rhs})-(${lhs})` : `(${lhs})-(${rhs})`);
  if (!f) return null;
  return { op: flip ? (op === '>' ? '<' : '<=') : op, f };
}

/* ------------------------------------------------------------------ */
/* Intervals                                                           */
/* ------------------------------------------------------------------ */

interface Interval {
  lo: number;
  hi: number;
  loClosed: boolean;
  hiClosed: boolean;
}

/** Inequality notation of one interval: a<x<b, a<=x<b, x>a, x<=b, a<x, b>=x. */
function inequalityInterval(p: string, num: (t: string) => number | null): Interval | null {
  const t = p.replace(/\s+/g, '');
  const chain = t.match(/^(.+?)(<=|<)([a-zA-Z])(<=|<)(.+)$/);
  if (chain) {
    const lo = num(chain[1]);
    const hi = num(chain[5]);
    return lo === null || hi === null ? null : { lo, hi, loClosed: chain[2] === '<=', hiClosed: chain[4] === '<=' };
  }
  const right = t.match(/^([a-zA-Z])(<=|>=|<|>)(.+)$/);
  const left = t.match(/^(.+?)(<=|>=|<|>)([a-zA-Z])$/);
  if (right) {
    const v = num(right[3]);
    if (v === null) return null;
    return right[2].startsWith('>') ? { lo: v, hi: Infinity, loClosed: right[2] === '>=', hiClosed: false } : { lo: -Infinity, hi: v, loClosed: false, hiClosed: right[2] === '<=' };
  }
  if (left) {
    const v = num(left[1]);
    if (v === null) return null;
    return left[2].startsWith('<') ? { lo: v, hi: Infinity, loClosed: left[2] === '<=', hiClosed: false } : { lo: -Infinity, hi: v, loClosed: false, hiClosed: left[2] === '>=' };
  }
  return null;
}

function parseIntervals(text: string): Interval[] | null {
  const parts = text.split(/\s+(?:U|or|o|ou|oder)\s+/i);
  const out: Interval[] = [];
  const num = (t: string) => {
    const x = t.replace(/\s+/g, '');
    if (/^-?Infinity$/.test(x)) return x.startsWith('-') ? -Infinity : Infinity;
    const e = parseSafe(x);
    return e && e.variables.length === 0 ? evaluate(e.node, {}) : null;
  };
  for (const p of parts) {
    const m = p.trim().match(/^([[(\]])\s*(.+?)\s*[,;]\s*(.+?)\s*([\])[])$/);
    if (!m) {
      const iv = inequalityInterval(p, num);
      if (!iv) return null;
      out.push(iv);
      continue;
    }
    const lo = num(m[2]);
    const hi = num(m[3]);
    if (lo === null || hi === null) return null;
    out.push({ lo, hi, loClosed: m[1] === '[', hiClosed: m[4] === ']' });
  }
  return out.sort((a, b) => a.lo - b.lo);
}

function intervalsEqual(a: Interval[], b: Interval[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    const sameLo = x.lo === y.lo || close(x.lo, y.lo);
    const sameHi = x.hi === y.hi || close(x.hi, y.hi);
    const loC = Number.isFinite(x.lo) ? x.loClosed === y.loClosed : true;
    const hiC = Number.isFinite(x.hi) ? x.hiClosed === y.hiClosed : true;
    return sameLo && sameHi && loC && hiC;
  });
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

/** cm2 / cm² / cm^2 / m·s⁻¹ / km/h -> mathjs unit syntax. */
export function normalizeUnitText(raw: string): string {
  let s = raw.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)/g, (m) => `^${[...m].map((c) => SUPERSCRIPTS[c] ?? '').join('')}`).normalize('NFKC').trim();
  s = s
    .replace(/[−–—]/g, '-')
    .replace(/[·⋅∙×*]/g, ' ')
    .replace(/\^\s*[{(]?\s*(-?\d+)\s*[})]?/g, '^$1')
    .replace(/([a-zA-Zµμ])(-?\d)(?![\d.])/g, '$1^$2') // cm2 -> cm^2, s-1 -> s^-1
    .replace(/[µμ]/g, 'u')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.replace(/ (?!\/)(?<!\/ )/g, ' ').replace(/([a-zA-Z0-9^-]) ([a-zA-Z])/g, '$1 * $2');
}

function toUnit(text: string): Unit | null {
  try {
    return mathUnit(normalizeUnitText(text));
  } catch {
    return null;
  }
}

/** Splits "12.5 cm^2" / "12,5 cm²" / "\\frac{3}{2}\\,\\text{m}" into numeric expression + unit text. */
export function splitValueAndUnit(normalized: string): { expr: string; unit: string | null } {
  const m = normalized.match(/^(.*?[0-9)]?)\s*([a-zA-Zµμ°%][a-zA-Zµμ0-9^\-/ *()]*)$/);
  if (m) {
    const expr = m[1].trim();
    const unitText = m[2].trim();
    if (expr && parseSafe(expr) && toUnit(unitText)) return { expr, unit: unitText };
  }
  return { expr: normalized, unit: null };
}

/* ------------------------------------------------------------------ */
/* Form checks                                                         */
/* ------------------------------------------------------------------ */

function hasDecimalLiteral(text: string): boolean {
  return /\d\.\d/.test(text);
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function stripParens(n: MathNode): MathNode {
  let x = n;
  while (x.type === 'ParenthesisNode') x = (x as unknown as { content: MathNode }).content;
  return x;
}

function isSum(n: MathNode): boolean {
  const x = stripParens(n);
  return x.type === 'OperatorNode' && ['+', '-'].includes((x as unknown as { op: string }).op) && (x as unknown as { args: MathNode[] }).args.length === 2;
}

function formMet(form: RequiredForm, literal: string, node: MathNode): boolean {
  const root = stripParens(node);
  switch (form) {
    case 'ANY':
      return true;
    case 'EXACT':
      return !hasDecimalLiteral(literal);
    case 'INTEGER':
      return root.type === 'ConstantNode' && Number.isInteger((root as unknown as { value: number }).value);
    case 'DECIMAL':
      return /^-?\d+(\.\d+)?$/.test(literal.trim());
    case 'SCIENTIFIC':
      return /^-?[1-9](\.\d+)?\s*\*\s*10\s*\^\s*\(?-?\d+\)?$/.test(literal.replace(/\s+/g, ''));
    case 'SIMPLIFIED_FRACTION': {
      if (root.type === 'ConstantNode') return Number.isInteger((root as unknown as { value: number }).value);
      let x = root;
      let negative = false;
      if (x.type === 'OperatorNode' && (x as unknown as { fn: string }).fn === 'unaryMinus') {
        negative = true;
        x = stripParens((x as unknown as { args: MathNode[] }).args[0]);
      }
      void negative;
      if (x.type !== 'OperatorNode' || (x as unknown as { op: string }).op !== '/') return false;
      const [a, b] = (x as unknown as { args: MathNode[] }).args.map(stripParens);
      if (a.type !== 'ConstantNode' || b.type !== 'ConstantNode') return false;
      const na = (a as unknown as { value: number }).value;
      const nb = (b as unknown as { value: number }).value;
      return Number.isInteger(na) && Number.isInteger(nb) && nb > 1 && gcd(na, nb) === 1;
    }
    case 'FACTORED': {
      const x = root.type === 'OperatorNode' && (root as unknown as { fn: string }).fn === 'unaryMinus' ? stripParens((root as unknown as { args: MathNode[] }).args[0]) : root;
      if (x.type !== 'OperatorNode') return false;
      const op = (x as unknown as { op: string }).op;
      return op === '*' || (op === '^' && isSum((x as unknown as { args: MathNode[] }).args[0]));
    }
    case 'EXPANDED': {
      let ok = true;
      root.traverse((n: MathNode) => {
        if (!ok || n.type !== 'OperatorNode') return;
        const op = (n as unknown as { op: string }).op;
        const args = (n as unknown as { args: MathNode[] }).args ?? [];
        if (op === '*' && args.some(isSum)) ok = false;
        if (op === '^' && args[0] && isSum(args[0])) ok = false;
      });
      return ok;
    }
  }
}

function significantFigures(literal: string): number | null {
  const m = literal.trim().match(/^-?(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const digits = (m[1] + (m[2] ?? '')).replace(/^0+/, '');
  if (!m[2]) return digits.replace(/0+$/, '').length || 1;
  return digits.length || 1;
}

/* ------------------------------------------------------------------ */
/* Grading                                                             */
/* ------------------------------------------------------------------ */

function toJsonAst(node: MathNode): unknown {
  try {
    return JSON.parse(JSON.stringify(node));
  } catch {
    return null;
  }
}

function toLatex(node: MathNode): string | null {
  try {
    return node.toTex({ parenthesis: 'keep' });
  } catch {
    return null;
  }
}

function judge(c: Correctness, form: FormCompliance, units: UnitCorrectness, sf: FormCompliance): FinalJudgment {
  if (c === 'UNDECIDABLE') return 'UNDECIDABLE';
  if (c === 'NOT_EQUIVALENT') return 'INCORRECT';
  if (form === 'NOT_MET' || units === 'MISSING' || units === 'WRONG' || sf === 'NOT_MET') return 'PARTIALLY_CORRECT';
  return 'CORRECT';
}

function gradeAgainst(studentLiteral: string, answer: string, key: MathKey, language: string): MathGrade {
  const reasons: string[] = [];
  const base: Omit<MathGrade, 'mathematicalCorrectness' | 'formCompliance' | 'unitCorrectness' | 'significantFigures' | 'judgment'> = {
    literal: studentLiteral,
    normalized: null,
    latex: null,
    ast: null,
    reasons,
  };
  const normalized = normalizeInfix(studentLiteral, language);
  base.normalized = normalized;
  const expectedNorm = normalizeInfix(answer, 'en');
  const undecidable = (why: string): MathGrade => {
    reasons.push(why);
    return { ...base, mathematicalCorrectness: 'UNDECIDABLE', formCompliance: 'NOT_REQUIRED', unitCorrectness: 'NOT_REQUIRED', significantFigures: 'NOT_REQUIRED', judgment: 'UNDECIDABLE' };
  };

  if (key.kind === 'INTERVAL') {
    const s = parseIntervals(normalized);
    const e = parseIntervals(expectedNorm);
    if (!s || !e) return undecidable('INTERVAL_NOT_PARSED');
    const eq = intervalsEqual(s, e);
    return { ...base, mathematicalCorrectness: eq ? 'EQUIVALENT' : 'NOT_EQUIVALENT', formCompliance: 'NOT_REQUIRED', unitCorrectness: 'NOT_REQUIRED', significantFigures: 'NOT_REQUIRED', judgment: eq ? 'CORRECT' : 'INCORRECT' };
  }

  if (key.kind === 'EQUATION' || key.kind === 'INEQUALITY') {
    const s = parseRelation(normalized);
    const e = parseRelation(expectedNorm);
    if (!s || !e) return undecidable('RELATION_NOT_PARSED');
    base.ast = toJsonAst(s.f.node);
    base.latex = toLatex(s.f.node);
    const strictMismatch = (s.op === '<') !== (e.op === '<') || (s.op === '=') !== (e.op === '=');
    const c = strictMismatch ? 'NOT_EQUIVALENT' : proportional(s.f, e.f, key.kind === 'INEQUALITY');
    if (c === 'UNDECIDABLE') return undecidable('RELATION_UNDECIDABLE');
    return { ...base, mathematicalCorrectness: c, formCompliance: 'NOT_REQUIRED', unitCorrectness: 'NOT_REQUIRED', significantFigures: 'NOT_REQUIRED', judgment: c === 'EQUIVALENT' ? 'CORRECT' : 'INCORRECT' };
  }

  // EXPRESSION / NUMBER, optionally with units
  let studentExpr = normalized;
  let studentUnit: string | null = null;
  let expectedExpr = expectedNorm;
  let expectedUnitText: string | null = key.units?.expected ?? null;
  if (key.units) {
    const sv = splitValueAndUnit(normalized);
    studentExpr = sv.expr;
    studentUnit = sv.unit;
    const ev = splitValueAndUnit(expectedNorm);
    expectedExpr = ev.expr;
    expectedUnitText = expectedUnitText ?? ev.unit;
  }
  const s = parseSafe(studentExpr);
  const e = parseSafe(expectedExpr);
  if (!s) return undecidable('STUDENT_EXPRESSION_NOT_PARSED');
  if (!e) return undecidable('KEY_EXPRESSION_NOT_PARSED');
  base.ast = toJsonAst(s.node);
  base.latex = toLatex(s.node);

  // Units: value correctness is judged in the EXPECTED unit when a conversion is allowed.
  let unitCorrectness: UnitCorrectness = 'NOT_REQUIRED';
  let factor = 1;
  if (key.units && expectedUnitText) {
    const eu = toUnit(expectedUnitText);
    if (!studentUnit) {
      unitCorrectness = key.units.required === false ? 'NOT_REQUIRED' : 'MISSING';
      if (unitCorrectness === 'MISSING') reasons.push('UNIT_MISSING');
    } else {
      const su = toUnit(studentUnit);
      if (!su || !eu || !su.equalBase(eu)) {
        unitCorrectness = 'WRONG';
        reasons.push('UNIT_WRONG_DIMENSION');
      } else {
        const one = su.clone();
        // factor converting a value in the student unit into the expected unit
        factor = mathUnit(1, normalizeUnitText(studentUnit)).toNumber(normalizeUnitText(expectedUnitText));
        void one;
        const same = Math.abs(factor - 1) < 1e-12;
        if (same) unitCorrectness = 'CORRECT';
        else if (key.units.allowConversion) unitCorrectness = 'CONVERTED';
        else {
          unitCorrectness = 'WRONG';
          reasons.push('UNIT_CONVERSION_NOT_ALLOWED');
        }
      }
    }
  }

  let correctness: Correctness;
  if (factor !== 1 && s.variables.length === 0 && e.variables.length === 0) {
    const sv = evaluate(s.node, {});
    const ev = evaluate(e.node, {});
    correctness = sv === null || ev === null ? 'UNDECIDABLE' : close(sv * factor, ev, key.tolerance) ? 'EQUIVALENT' : 'NOT_EQUIVALENT';
  } else {
    correctness = expressionsEquivalent(s, e, key.tolerance);
  }
  // A rounded decimal of an exact value is the same quantity (form decides whether it is acceptable).
  if (correctness === 'NOT_EQUIVALENT' && s.variables.length === 0 && e.variables.length === 0) {
    const sv = evaluate(s.node, {});
    const ev = evaluate(e.node, {});
    const dp = studentExpr.match(/\.(\d+)\s*$/)?.[1].length ?? 0;
    if (sv !== null && ev !== null && dp > 0 && Math.abs(sv * factor - ev) <= 0.5 * 10 ** -dp + 1e-12) {
      correctness = 'EQUIVALENT';
      reasons.push('ROUNDED_VALUE');
    }
  }
  if (correctness === 'UNDECIDABLE') return undecidable('EXPRESSION_UNDECIDABLE');

  const form = key.requiredForm ?? 'ANY';
  let formCompliance: FormCompliance = form === 'ANY' && key.decimalPlaces === undefined ? 'NOT_REQUIRED' : 'MET';
  if (form !== 'ANY' && !formMet(form, studentExpr, s.node)) {
    formCompliance = 'NOT_MET';
    reasons.push(`FORM_${form}_NOT_MET`);
  }
  if (key.decimalPlaces !== undefined) {
    const dp = studentExpr.trim().match(/\.(\d+)$/)?.[1].length ?? 0;
    if (dp !== key.decimalPlaces) {
      formCompliance = 'NOT_MET';
      reasons.push('DECIMAL_PLACES_NOT_MET');
    }
  }
  let sf: FormCompliance = 'NOT_REQUIRED';
  if (key.significantFigures !== undefined) {
    const n = significantFigures(studentExpr);
    sf = n === key.significantFigures ? 'MET' : 'NOT_MET';
    if (sf === 'NOT_MET') reasons.push('SIGNIFICANT_FIGURES_NOT_MET');
  }
  return { ...base, mathematicalCorrectness: correctness, formCompliance, unitCorrectness, significantFigures: sf, judgment: judge(correctness, formCompliance, unitCorrectness, sf) };
}

const RANK: Record<FinalJudgment, number> = { CORRECT: 3, PARTIALLY_CORRECT: 2, UNDECIDABLE: 1, INCORRECT: 0 };

/** Grades against every accepted answer and keeps the best verdict. */
export function gradeMath(studentLiteral: string, key: MathKey, language = 'en'): MathGrade {
  if (typeof studentLiteral !== 'string' || !studentLiteral.trim()) {
    return { literal: studentLiteral ?? '', normalized: null, latex: null, ast: null, mathematicalCorrectness: 'NOT_EQUIVALENT', formCompliance: 'NOT_REQUIRED', unitCorrectness: 'NOT_REQUIRED', significantFigures: 'NOT_REQUIRED', judgment: 'INCORRECT', reasons: ['EMPTY'] };
  }
  let best: MathGrade | null = null;
  for (const answer of key.answers) {
    const g = gradeAgainst(studentLiteral, answer, key, language);
    if (!best || RANK[g.judgment] > RANK[best.judgment]) best = g;
    if (g.judgment === 'CORRECT') break;
  }
  return best!;
}
