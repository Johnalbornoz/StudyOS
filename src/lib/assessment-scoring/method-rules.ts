/**
 * FORM-AWARE METHOD-MARK RULES (pure, no IO). A method mark is earned by a line of working that IS the governed
 * method, in the governed form -- never by a line that is merely algebraically equivalent to the question.
 *
 * Why: equivalence alone awards M1 for copying the given equation (it is "equivalent to" the intermediate it states).
 * These rules read the STRUCTURE of each working line (mathjs syntax tree + exact numeric checks) and classify it:
 *
 *   QUADRATIC_SOLUTION_METHOD    (rubric: "applies a valid method to the equation in standard form")
 *     accepted   QUADRATIC_FORMULA_SUBSTITUTION   x = (P ± Q) / R  with P = -b, Q = sqrt(b^2 - 4ac), R = 2a of THIS
 *                                                 equation (each written as an expression or as its value)
 *                FACTORED_LINEAR_FACTORS          k (x - r1)(x - r2) = 0, a product of linear factors whose zeros are
 *                                                 exactly the roots
 *                COMPLETED_SQUARE                 k (x + h)^2 = m  whose solutions are exactly the roots
 *     rejected   RESTATES_THE_GIVEN_EQUATION      the line is the question's equation (same structure)
 *                EQUIVALENT_BUT_NOT_A_METHOD_FORM an equation equivalent to the question in no governed form
 *                GENERIC_FORMULA_NOT_SUBSTITUTED  the formula with letters a, b, c
 *                FINAL_ANSWER_ONLY                x = r, or a list of the roots
 *                WRONG_SUBSTITUTION / WRONG_FACTORS / WRONG_SQUARE   the form, with values that are not this equation's
 *                NOT_PARSEABLE
 *   REARRANGE_TO_STANDARD_FORM   (rubric: "rearranges to a x^2 + b x + c = 0")
 *     accepted   EXPANDED_STANDARD_FORM           an expanded degree-2 polynomial in x = 0, proportional to the
 *                                                 standard form of THIS equation, that is not the given equation
 *     rejected   RESTATES_THE_GIVEN_EQUATION, NOT_EXPANDED, NOT_EQUAL_TO_ZERO, NOT_THIS_EQUATION, NOT_PARSEABLE
 *
 * A rule is part of the CERTIFIED mark scheme (identity: type + version + parameters + rubric point); nothing here
 * decides which rule a rubric point uses. Answer marks are never implied into method marks by these rules: a correct
 * final answer without working earns its answer marks only.
 */
import { createHash } from 'crypto';
import { parse, type MathNode } from 'mathjs';

export const METHOD_RULE_ENGINE_VERSION = 'method-rules-1';
export type MethodRuleType = 'QUADRATIC_SOLUTION_METHOD' | 'REARRANGE_TO_STANDARD_FORM';
export type AcceptedMethodForm = 'QUADRATIC_FORMULA_SUBSTITUTION' | 'FACTORED_LINEAR_FACTORS' | 'COMPLETED_SQUARE' | 'EXPANDED_STANDARD_FORM';
export type RejectedForm =
  | 'RESTATES_THE_GIVEN_EQUATION' | 'EQUIVALENT_BUT_NOT_A_METHOD_FORM' | 'GENERIC_FORMULA_NOT_SUBSTITUTED' | 'FINAL_ANSWER_ONLY' | 'WRONG_SUBSTITUTION' | 'WRONG_FACTORS'
  | 'WRONG_SQUARE' | 'NOT_EXPANDED' | 'NOT_EQUAL_TO_ZERO' | 'NOT_THIS_EQUATION' | 'NOT_PARSEABLE';

export interface MethodRule {
  ruleType: MethodRuleType;
  version: 1;
  /** The equation as the question gives it (canonical ASCII, variable x) and its standard form a x^2 + b x + c = 0. */
  givenEquation: string;
  standardForm: { a: number; b: number; c: number };
  /** The roots of THIS equation (the solutions the method must lead to). */
  roots: readonly number[];
  marks: number;
  /** Which rubric point the rule scores, and the digest of that point's certified criterion text. */
  provenance: { rubricIndex: number; rubricCode: string; criterionDigest: string };
}
export const REQUIRED_FORM: Readonly<Record<MethodRuleType, string>> = {
  QUADRATIC_SOLUTION_METHOD: 'a substituted quadratic formula, a product of linear factors equal to 0, or a completed square, for THIS equation',
  REARRANGE_TO_STANDARD_FORM: 'an expanded degree-2 polynomial in x equal to 0, proportional to the standard form of THIS equation',
};
export const ACCEPTED_FORMS: Readonly<Record<MethodRuleType, readonly AcceptedMethodForm[]>> = {
  QUADRATIC_SOLUTION_METHOD: ['QUADRATIC_FORMULA_SUBSTITUTION', 'FACTORED_LINEAR_FACTORS', 'COMPLETED_SQUARE'],
  REARRANGE_TO_STANDARD_FORM: ['EXPANDED_STANDARD_FORM'],
};
export const REJECTED_TRIVIAL_FORMS: Readonly<Record<MethodRuleType, readonly RejectedForm[]>> = {
  QUADRATIC_SOLUTION_METHOD: ['RESTATES_THE_GIVEN_EQUATION', 'EQUIVALENT_BUT_NOT_A_METHOD_FORM', 'GENERIC_FORMULA_NOT_SUBSTITUTED', 'FINAL_ANSWER_ONLY'],
  REARRANGE_TO_STANDARD_FORM: ['RESTATES_THE_GIVEN_EQUATION', 'NOT_EXPANDED', 'NOT_EQUAL_TO_ZERO'],
};
export const criterionDigestOf = (criterion: string): string => createHash('sha256').update(criterion.normalize('NFC')).digest('hex');
export const methodRuleDigest = (r: MethodRule): string => createHash('sha256').update(JSON.stringify([METHOD_RULE_ENGINE_VERSION, r.ruleType, r.version, r.givenEquation, r.standardForm, [...r.roots].sort((x, y) => x - y), r.marks, r.provenance])).digest('hex');

// ------------------------------------------------------------------------------------------------ reading a line
/** LaTeX (MathLive) or plain text -> ASCII mathjs syntax. ± stays as '±' (expanded by the caller). */
export function toAscii(raw: string): string {
  // superscripts first: NFKC would turn "x²" into "x2"
  let s = raw.replace(/²/g, '^2').replace(/³/g, '^3').normalize('NFKC').replace(/[−–]/g, '-').replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/√/g, 'sqrt')
    .replace(/\\left|\\right/g, '').replace(/\\cdot|\\times/g, '*').replace(/\\pm/g, '±').replace(/\+-|\+\/-/g, '±').replace(/\\,|\\;|\\!/g, '').replace(/\\left\(|\\right\)/g, '');
  // \frac{A}{B} and \sqrt{A}, with nested braces
  const group = (str: string, at: number): [string, number] => { let depth = 0; for (let i = at; i < str.length; i++) { if (str[i] === '{') depth++; else if (str[i] === '}') { depth--; if (depth === 0) return [str.slice(at + 1, i), i + 1]; } } throw new Error('braces'); };
  for (let guard = 0; guard < 50 && /\\(d?frac|sqrt)/.test(s); guard++) {
    const m = /\\(d?frac|sqrt)\s*/.exec(s)!;
    const start = m.index; let at = start + m[0].length;
    if (m[1] === 'sqrt') { const [a, end] = group(s, at); s = `${s.slice(0, start)}sqrt(${a})${s.slice(end)}`; }
    else { const [a, e1] = group(s, at); const [b, e2] = group(s, e1); s = `${s.slice(0, start)}((${a})/(${b}))${s.slice(e2)}`; at = e2; }
  }
  return s.replace(/\^\{([^{}]*)\}/g, '^($1)').replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\s+/g, ' ').trim();
}
const symbolsOf = (n: MathNode): Set<string> => { const out = new Set<string>(); n.traverse((x: any) => { if (x.isSymbolNode && !x.isFunctionNode && !['pi', 'e', 'sqrt'].includes(x.name)) out.add(x.name); }); return out; };
const evalAt = (n: MathNode, x: number): number => Number(n.evaluate({ x }));
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const sameSet = (a: readonly number[], b: readonly number[]): boolean => { const x = [...a].sort((p, q) => p - q); const y = [...b].sort((p, q) => p - q); return x.length === y.length && x.every((v, i) => near(v, y[i])); };
const unwrap = (n: any): any => (n?.isParenthesisNode ? unwrap(n.content) : n);
/** The quadratic coefficients of f (degree <= 2 checked at five points), or null. */
function quadraticOf(f: (x: number) => number): { a: number; b: number; c: number } | null {
  try {
    const c = f(0), p1 = f(1), m1 = f(-1);
    const a = (p1 + m1) / 2 - c, b = (p1 - m1) / 2;
    for (const x of [2, -3, 0.5]) if (!near(f(x), a * x * x + b * x + c)) return null;
    return [a, b, c].every(Number.isFinite) ? { a, b, c } : null;
  } catch { return null; }
}
const proportional = (p: { a: number; b: number; c: number }, q: { a: number; b: number; c: number }): boolean => { if (near(q.a, 0)) return false; const k = p.a / q.a; return !near(k, 0) && near(p.b, k * q.b) && near(p.c, k * q.c); };
const isLinear = (n: MathNode): boolean => { const q = quadraticOf((x) => evalAt(n, x)); return !!q && near(q.a, 0) && !near(q.b, 0); };
/** Product factors of a node (implicit or explicit multiplication, through parentheses). */
function factorsOf(n: any): any[] { const u = unwrap(n); if (u?.isOperatorNode && u.op === '*' && u.args.length === 2) return [...factorsOf(u.args[0]), ...factorsOf(u.args[1])]; return [u]; }
const canonicalText = (n: MathNode): string => n.toString({ parenthesis: 'auto', implicit: 'show' }).replace(/\s+/g, '');

export interface LineVerdict { line: string; form: AcceptedMethodForm | null; rejected: RejectedForm | null }
export interface MethodRuleResult { ruleType: MethodRuleType; version: 1; awarded: number; marks: number; evidence: LineVerdict | null; lines: LineVerdict[]; ruleDigest: string }

function parseEquation(ascii: string): { lhs: MathNode; rhs: MathNode } | null {
  const sides = ascii.split('=');
  if (sides.length !== 2 || !sides[0].trim() || !sides[1].trim()) return null;
  try { return { lhs: parse(sides[0]), rhs: parse(sides[1]) }; } catch { return null; }
}

function classifyQuadratic(rule: MethodRule, ascii: string, given: { lhs: MathNode; rhs: MathNode } | null): LineVerdict['form'] | RejectedForm {
  const { a, b, c } = rule.standardForm;
  // 1. a formula line: "x = (P ± Q)/R" or "(P ± Q)/R"
  if (ascii.includes('±')) {
    const rhsText = ascii.includes('=') ? ascii.slice(ascii.indexOf('=') + 1) : ascii;
    if (ascii.includes('=') && !/^\s*x\s*$/.test(ascii.slice(0, ascii.indexOf('=')))) return 'EQUIVALENT_BUT_NOT_A_METHOD_FORM';
    let plus: MathNode, minus: MathNode;
    try { plus = parse(rhsText.replace(/±/g, '+')); minus = parse(rhsText.replace(/±/g, '-')); } catch { return 'NOT_PARSEABLE'; }
    const syms = symbolsOf(plus);
    if ([...syms].some((s) => ['a', 'b', 'c'].includes(s))) return 'GENERIC_FORMULA_NOT_SUBSTITUTED';
    if (syms.size > 0) return 'NOT_PARSEABLE';
    // structure: a quotient whose numerator is P ± Q and whose denominator is 2a
    const u: any = unwrap(plus);
    if (!(u?.isOperatorNode && u.op === '/')) return 'WRONG_SUBSTITUTION';
    const num: any = unwrap(u.args[0]); const den = Number(unwrap(u.args[1]).evaluate());
    if (!(num?.isOperatorNode && num.op === '+' && num.args.length === 2)) return 'WRONG_SUBSTITUTION';
    const P = Number(num.args[0].evaluate()); const Q = Number(num.args[1].evaluate());
    const disc = b * b - 4 * a * c;
    if (!(disc >= 0 && near(P, -b) && near(Q, Math.sqrt(disc)) && near(den, 2 * a))) return 'WRONG_SUBSTITUTION';
    const values = [Number(plus.evaluate()), Number(minus.evaluate())];
    return sameSet([...new Set(values.map((v) => Math.round(v * 1e9) / 1e9))], rule.roots) || (rule.roots.length === 1 && values.every((v) => near(v, rule.roots[0]))) ? 'QUADRATIC_FORMULA_SUBSTITUTION' : 'WRONG_SUBSTITUTION';
  }
  const eq = parseEquation(ascii);
  if (!eq) return 'NOT_PARSEABLE';
  const syms = new Set([...symbolsOf(eq.lhs), ...symbolsOf(eq.rhs)]);
  if ([...syms].some((s) => ['a', 'b', 'c'].includes(s))) return 'GENERIC_FORMULA_NOT_SUBSTITUTED';
  if ([...syms].some((s) => s !== 'x')) return 'NOT_PARSEABLE';
  if (given && canonicalText(eq.lhs) === canonicalText(given.lhs) && canonicalText(eq.rhs) === canonicalText(given.rhs)) return 'RESTATES_THE_GIVEN_EQUATION';
  const lhs: any = unwrap(eq.lhs); const rhs: any = unwrap(eq.rhs);
  // final answer only: x = number
  if (lhs?.isSymbolNode && lhs.name === 'x' && symbolsOf(eq.rhs).size === 0) return 'FINAL_ANSWER_ONLY';
  let f: (x: number) => number;
  try { f = (x) => evalAt(eq.lhs, x) - evalAt(eq.rhs, x); f(0.37); } catch { return 'NOT_PARSEABLE'; }
  const poly = quadraticOf(f);
  const sameEquation = !!poly && proportional(poly, rule.standardForm);
  // 2. factored: product of >= 2 factors, at least two linear in x, = 0
  const zero = symbolsOf(eq.rhs).size === 0 && near(Number(eq.rhs.evaluate()), 0);
  const factors = factorsOf(lhs);
  const linear = factors.filter((fa) => symbolsOf(fa).has('x'));
  if (zero && factors.length >= 2 && linear.length >= 2 && linear.every((fa) => isLinear(fa)) && factors.filter((fa) => !symbolsOf(fa).has('x')).every((fa) => !near(Number(fa.evaluate()), 0))) {
    const zeros = linear.map((fa) => { const q = quadraticOf((x) => evalAt(fa, x))!; return -q.c / q.b; });
    return sameSet([...new Set(zeros.map((z) => Math.round(z * 1e9) / 1e9))], rule.roots) && sameEquation ? 'FACTORED_LINEAR_FACTORS' : 'WRONG_FACTORS';
  }
  // 3. completed square: k (x + h)^2 = m (m a number)
  const sq = factorsOf(lhs).find((fa: any) => fa?.isOperatorNode && fa.op === '^' && Number(unwrap(fa.args[1]).evaluate?.() ?? NaN) === 2 && isLinear(fa.args[0]));
  if (sq && symbolsOf(eq.rhs).size === 0 && factorsOf(lhs).filter((fa) => fa !== sq).every((fa) => symbolsOf(fa).size === 0)) return sameEquation ? 'COMPLETED_SQUARE' : 'WRONG_SQUARE';
  return sameEquation ? 'EQUIVALENT_BUT_NOT_A_METHOD_FORM' : 'NOT_PARSEABLE';
}

function classifyStandardForm(rule: MethodRule, ascii: string, given: { lhs: MathNode; rhs: MathNode } | null): LineVerdict['form'] | RejectedForm {
  const eq = parseEquation(ascii);
  if (!eq) return 'NOT_PARSEABLE';
  if ([...symbolsOf(eq.lhs), ...symbolsOf(eq.rhs)].some((s) => s !== 'x')) return 'NOT_PARSEABLE';
  if (given && canonicalText(eq.lhs) === canonicalText(given.lhs) && canonicalText(eq.rhs) === canonicalText(given.rhs)) return 'RESTATES_THE_GIVEN_EQUATION';
  if (!(symbolsOf(eq.rhs).size === 0 && near(Number(eq.rhs.evaluate()), 0))) return 'NOT_EQUAL_TO_ZERO';
  // expanded: a sum of monomials -- no product or power of an x-containing sum
  let expanded = true;
  eq.lhs.traverse((n: any) => {
    if (n.isOperatorNode && n.op === '*' && n.args.filter((x: any) => symbolsOf(x).has('x')).length > 1) expanded = false;
    if (n.isOperatorNode && n.op === '*' && n.args.some((x: any) => { const u = unwrap(x); return symbolsOf(u).has('x') && u.isOperatorNode && (u.op === '+' || u.op === '-') && u.args.length === 2; })) expanded = false;
    if (n.isOperatorNode && n.op === '^' && !unwrap(n.args[0]).isSymbolNode) expanded = false;
  });
  if (!expanded) return 'NOT_EXPANDED';
  const poly = quadraticOf((x) => evalAt(eq.lhs, x));
  return poly && !near(poly.a, 0) && proportional(poly, rule.standardForm) ? 'EXPANDED_STANDARD_FORM' : 'NOT_THIS_EQUATION';
}

/** Score one rule against the Student's working (lines separated by newlines or ';'). Deterministic. */
export function evaluateMethodRule(rule: MethodRule, working: string): MethodRuleResult {
  let given: { lhs: MathNode; rhs: MathNode } | null = null;
  try { given = parseEquation(toAscii(rule.givenEquation)); } catch { given = null; }
  const lines = String(working ?? '').split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean).slice(0, 60);
  const verdicts: LineVerdict[] = lines.map((line) => {
    let ascii: string;
    try { ascii = toAscii(line); } catch { return { line, form: null, rejected: 'NOT_PARSEABLE' as RejectedForm }; }
    let out: LineVerdict['form'] | RejectedForm;
    try { out = rule.ruleType === 'QUADRATIC_SOLUTION_METHOD' ? classifyQuadratic(rule, ascii, given) : classifyStandardForm(rule, ascii, given); } catch { out = 'NOT_PARSEABLE'; }
    return (ACCEPTED_FORMS[rule.ruleType] as readonly string[]).includes(out as string) ? { line, form: out as AcceptedMethodForm, rejected: null } : { line, form: null, rejected: out as RejectedForm };
  });
  const evidence = verdicts.find((x) => x.form !== null) ?? null;
  return { ruleType: rule.ruleType, version: 1, awarded: evidence ? rule.marks : 0, marks: rule.marks, evidence, lines: verdicts, ruleDigest: methodRuleDigest(rule) };
}
