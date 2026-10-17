/**
 * P1-03 -- deterministic validity of a CHOICE item before it can reach a learner.
 *
 * A multiple-choice item is only deliverable when its answer key is the
 * mathematically right option and its explanation agrees with that key.
 * Two kinds of checks, both pure and deterministic (no AI):
 *
 *  1. EQUATION / SOLUTION family (checked by substitution, never guessed):
 *     a. "¿En cuál de las ecuaciones x = 3 es una solución?" -- the stem fixes a value and
 *        every option is an equation in that unknown: substitute, count the options it satisfies.
 *     b. "¿Cuál es el valor de x en 5x - 3 = 2x + 12?" -- the stem has one equation and every
 *        option is a value (`x = 5` or `5`): solve, count the options equal to the solution.
 *     Then: no satisfying option -> MCQ_NO_OPTION_SATISFIES; more than one on a single-choice
 *     item -> MCQ_MULTIPLE_OPTIONS_SATISFY; the keyed option(s) differ from the satisfying ones
 *     -> MCQ_KEY_DOES_NOT_SATISFY. A negated stem ("NO es solución") is not checked here.
 *  2. KEY / EXPLANATION consistency (generic, any subject):
 *     - the explanation names an option letter as the answer that is not the key
 *       (EXPLANATION_NAMES_OTHER_OPTION);
 *     - the explanation quotes the keyed option and, in the same clause, says it does not hold
 *       ("2x + 1 = 8, resulta 2·3 + 1 = 7, no 8") (EXPLANATION_REFUTES_KEY).
 *
 * Anything outside these grammars is simply not decided here (never a false rejection by
 * guessing); the existing Quality Gate and semantic verifier still apply.
 */
import { normalizeMathText, parseSafeExpression, solveEquation, numbersEquivalent, evaluateExpression } from '@/lib/grading/math-equivalence';

export type ChoiceItemFailureCode =
  | 'MCQ_NO_OPTION_SATISFIES'
  | 'MCQ_MULTIPLE_OPTIONS_SATISFY'
  | 'MCQ_KEY_DOES_NOT_SATISFY'
  | 'EXPLANATION_NAMES_OTHER_OPTION'
  | 'EXPLANATION_REFUTES_KEY';

export interface ChoiceItemFailure {
  code: ChoiceItemFailureCode;
  detail: string;
}

export interface ChoiceItemLike {
  question?: unknown;
  answerFormat?: unknown;
  correctAnswer?: unknown;
  explanation?: unknown;
  options?: Array<{ id: string; text: string }> | null;
}

export interface ChoiceItemReport {
  ok: boolean;
  failures: ChoiceItemFailure[];
  /** Which deterministic family decided the key (null when none applied). */
  family: 'VALUE_SATISFIES_EQUATION' | 'EQUATION_HAS_VALUE' | null;
  /** Option ids that are mathematically correct (null when not decidable). */
  satisfyingOptionIds: string[] | null;
}

const NEGATED_STEM = /\b(no|not|ninguna|ninguno|never|nunca|nicht|pas|n[aã]o)\b|isn['’]t|aren['’]t/i;
const SOLUTION_STEM = /soluci[oó]n|solution|soluç[aã]o|l[öo]sung|satisf|cumple|verifica|se\s+cumple|holds|true\s+for|es\s+verdadera/i;
const VALUE_STEM = /valor|value|resuelve|resolver|solve|soluci[oó]n|solution|halla|hallar|find|calcula|determina|wert|valeur|r[ée]sous/i;

function norm(s: string): string {
  return normalizeMathText(s, 'point');
}

/** `lhs = rhs` with both sides inside the safe grammar, in at most one variable. */
function parseEquation(text: string): { lhs: ReturnType<typeof parseSafeExpression>; rhs: ReturnType<typeof parseSafeExpression>; variable: string | null } | null {
  const parts = norm(text).replace(/[.;:]+$/, '').split('=');
  if (parts.length !== 2) return null;
  const lhs = parseSafeExpression(parts[0]);
  const rhs = parseSafeExpression(parts[1]);
  if (!lhs || !rhs) return null;
  if (lhs.variable && rhs.variable && lhs.variable !== rhs.variable) return null;
  return { lhs, rhs, variable: lhs.variable ?? rhs.variable };
}

function evalNode(p: NonNullable<ReturnType<typeof parseSafeExpression>>, value: number): number | null {
  try {
    const r = p.node.compile().evaluate(p.variable ? { [p.variable]: value } : {});
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  } catch {
    return null;
  }
}

/** The value a stem fixes for its unknown ("x = 3 es una solución"), or null. */
function stemAssignment(stem: string): { variable: string; value: number } | null {
  const text = norm(stem);
  const found: Array<{ variable: string; value: number }> = [];
  const re = /(?<![A-Za-z0-9)])([a-zA-Z])\s*=\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)(?![\d.]*\s*[(*^]|[\d.]*[A-Za-z])/g;
  for (const m of text.matchAll(re)) {
    const v = evaluateExpression(m[2]);
    if (v !== null) found.push({ variable: m[1], value: v });
  }
  const distinct = new Set(found.map((f) => `${f.variable}=${f.value}`));
  return distinct.size === 1 ? found[0] : null;
}

/** The single solution of the one equation a stem poses ("en la ecuación 5x - 3 = 2x + 12"), or null. */
function stemEquationSolution(stem: string): { variable: string; value: number } | null {
  const text = norm(stem);
  const solutions: Array<{ variable: string; value: number }> = [];
  // math runs: what is left between words (2+ letters) and clause punctuation
  for (const seg of text.replace(/(?<![a-z])(?!sqrt\b)[a-záéíóúñ]{2,}/gi, '|').replace(/[,;:!?¿¡]/g, '|').split('|')) {
    const s = seg.trim().replace(/^[.\s]+|[.\s]+$/g, '');
    if (!s.includes('=')) continue;
    const eq = parseEquation(s);
    if (!eq || !eq.variable) continue;
    // a bare assignment ("x = 3") is not an equation to solve
    if (/^\s*[a-zA-Z]\s*=\s*[-\d.\s/]+$/.test(s)) continue;
    const solved = solveEquation(s, 'point');
    if (solved) solutions.push(solved);
  }
  if (solutions.length === 0) return null;
  const first = solutions[0];
  return solutions.every((s) => s.variable === first.variable && numbersEquivalent(s.value, first.value)) ? first : null;
}

/** An option that is just a value: "5", "x = 5", "$x=\frac{5}{2}$". */
function optionValue(text: string, variable: string): number | null {
  const t = norm(text).replace(/[.;:]+$/, '').trim();
  const m = t.match(/^([a-zA-Z])\s*=\s*(.+)$/);
  if (m) return m[1] === variable ? evaluateExpression(m[2]) : null;
  return evaluateExpression(t);
}

function keyIds(item: ChoiceItemLike): string[] {
  return String(item.correctAnswer ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function decideEquationFamily(item: ChoiceItemLike): { family: ChoiceItemReport['family']; satisfying: string[] } | null {
  const stem = String(item.question ?? '');
  const options = item.options ?? [];
  if (options.length < 2 || NEGATED_STEM.test(stem)) return null;

  // (a) the stem fixes a value; every option is an equation in that unknown
  const assignment = SOLUTION_STEM.test(stem) ? stemAssignment(stem) : null;
  if (assignment) {
    const eqs = options.map((o) => ({ id: o.id, eq: parseEquation(o.text) }));
    if (eqs.every((e) => e.eq && (e.eq.variable === assignment.variable || e.eq.variable === null))) {
      const satisfying: string[] = [];
      for (const { id, eq } of eqs) {
        const l = evalNode(eq!.lhs!, assignment.value);
        const r = evalNode(eq!.rhs!, assignment.value);
        if (l === null || r === null) return null;
        if (numbersEquivalent(l, r)) satisfying.push(id);
      }
      return { family: 'VALUE_SATISFIES_EQUATION', satisfying };
    }
  }

  // (b) the stem poses one equation; every option is a value
  if (!VALUE_STEM.test(stem)) return null;
  const solution = stemEquationSolution(stem);
  if (!solution) return null;
  const values = options.map((o) => ({ id: o.id, v: optionValue(o.text, solution.variable) }));
  if (values.some((x) => x.v === null)) return null;
  return { family: 'EQUATION_HAS_VALUE', satisfying: values.filter((x) => numbersEquivalent(x.v!, solution.value)).map((x) => x.id) };
}

const OPTION_WORD = '(?:opci[oó]n|option|alternativa|inciso|respuesta|answer|choice|r[ée]ponse|antwort|resposta)';
const LETTER = '\\(?([A-E])\\)?(?![A-Za-z0-9])';
const NAMED_AS_ANSWER = [
  // "la respuesta correcta es la C", "the correct answer is C", "correcta: C"
  new RegExp(`correct[ao]?\\s*(?:${OPTION_WORD}\\s*)?(?:es|is|est|ist|é|:)\\s*(?:la\\s+|el\\s+|the\\s+|option\\s+|opci[oó]n\\s+)?${LETTER}`, 'gi'),
  // "la opción C es correcta", "option C is correct"
  new RegExp(`${OPTION_WORD}\\s+${LETTER}\\s+(?:es|is|est|ist|é)\\s+(?:la\\s+|the\\s+)?correct`, 'gi'),
];
const MENTIONED = new RegExp(`${OPTION_WORD}\\s+${LETTER}`, 'gi');

function compact(s: string): string {
  return norm(s).replace(/\s+/g, '').toLowerCase();
}

/** Generic key/explanation consistency for letter-keyed items. */
function explanationFailures(item: ChoiceItemLike): ChoiceItemFailure[] {
  const explanation = String(item.explanation ?? '');
  const options = item.options ?? [];
  const keys = keyIds(item);
  if (!explanation.trim() || keys.length === 0) return [];
  const failures: ChoiceItemFailure[] = [];
  const letterIds = new Set(options.map((o) => o.id).filter((id) => /^[A-E]$/.test(id)));

  if (letterIds.size === options.length && options.length > 0) {
    const named = new Set<string>();
    // letters are option names only when written in capitals ("es a partir de" names nothing)
    for (const re of NAMED_AS_ANSWER) for (const m of explanation.matchAll(re)) if (letterIds.has(m[1])) named.add(m[1]);
    const otherNamed = [...named].filter((l) => !keys.includes(l));
    if (otherNamed.length > 0) failures.push({ code: 'EXPLANATION_NAMES_OTHER_OPTION', detail: `explanation names ${otherNamed.join(',')} as the answer; key is ${keys.join(',')}` });
    else if (named.size === 0) {
      const mentioned = new Set([...explanation.matchAll(MENTIONED)].map((m) => m[1]).filter((l) => letterIds.has(l)));
      if (mentioned.size > 0 && !keys.some((k) => mentioned.has(k))) {
        failures.push({ code: 'EXPLANATION_NAMES_OTHER_OPTION', detail: `explanation refers only to option(s) ${[...mentioned].join(',')}; key is ${keys.join(',')}` });
      }
    }
  }

  // the keyed option quoted, then refuted in the same clause
  const NEGATION = /(?:^|[\s,;:(])(?:no|not|ni|nicht|pas|n[aã]o)(?=[\s,.;:)]|$)|≠|\\neq|no\s+se\s+cumple|does\s+not\s+hold|is\s+false|es\s+falsa|incorrect/i;
  const OTHERS = /dem[aá]s|otras|otros|resto|others|the\s+rest|autres|anderen|outras/i;
  const flat = compact(explanation);
  for (const key of keys) {
    const opt = options.find((o) => o.id === key);
    if (!opt) continue;
    const needle = compact(opt.text);
    if (needle.length < 3 || !/\d/.test(needle)) continue; // only checkable, specific option texts
    // locate the option in the original explanation by walking the compacted index back
    let idx = flat.indexOf(needle);
    while (idx >= 0) {
      const tail = tailAfterCompactIndex(explanation, idx + needle.length);
      const clause = tail.split(/(?<=[.!?])\s|;|\n/)[0].slice(0, 80);
      if (NEGATION.test(clause) && !OTHERS.test(clause.split(NEGATION)[0])) {
        failures.push({ code: 'EXPLANATION_REFUTES_KEY', detail: `explanation says the keyed option "${opt.text}" does not hold` });
        break;
      }
      idx = flat.indexOf(needle, idx + 1);
    }
  }
  return failures;
}

/** The original text after the character that ends at `compactIndex` in compact(text). */
function tailAfterCompactIndex(text: string, compactIndex: number): string {
  // compact() normalizes before removing whitespace; walk the normalized text
  const n = norm(text);
  let seen = 0;
  for (let i = 0; i < n.length; i++) {
    if (!/\s/.test(n[i])) seen++;
    if (seen >= compactIndex) return n.slice(i + 1);
  }
  return '';
}

/** Validates a choice item; non-choice items always pass (nothing to decide here). */
export function validateChoiceItem(item: ChoiceItemLike | null | undefined): ChoiceItemReport {
  const pass: ChoiceItemReport = { ok: true, failures: [], family: null, satisfyingOptionIds: null };
  if (!item || !Array.isArray(item.options) || item.options.length === 0) return pass;
  if (item.answerFormat !== 'single_choice' && item.answerFormat !== 'multi_choice') return pass;
  if (item.options.every((o) => o.id === 'true' || o.id === 'false')) return pass;

  const failures: ChoiceItemFailure[] = [];
  const keys = keyIds(item);
  const decided = decideEquationFamily(item);
  if (decided) {
    const { satisfying } = decided;
    if (satisfying.length === 0) failures.push({ code: 'MCQ_NO_OPTION_SATISFIES', detail: `no option is mathematically correct (key ${keys.join(',')})` });
    else {
      if (item.answerFormat === 'single_choice' && satisfying.length > 1) failures.push({ code: 'MCQ_MULTIPLE_OPTIONS_SATISFY', detail: `options ${satisfying.join(',')} are all correct` });
      if (!sameSet(keys, satisfying) && !(item.answerFormat === 'single_choice' && satisfying.length > 1)) {
        failures.push({ code: 'MCQ_KEY_DOES_NOT_SATISFY', detail: `key ${keys.join(',')} but the correct option(s) are ${satisfying.join(',')}` });
      }
    }
  }
  failures.push(...explanationFailures(item));
  return { ok: failures.length === 0, failures, family: decided?.family ?? null, satisfyingOptionIds: decided?.satisfying ?? null };
}

/** True when the item may be delivered (the delivery-path guard). */
export function isDeliverableChoiceItem(item: ChoiceItemLike | null | undefined): boolean {
  return validateChoiceItem(item).ok;
}
