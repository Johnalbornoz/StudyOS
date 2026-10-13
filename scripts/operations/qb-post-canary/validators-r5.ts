/**
 * POST-CANARY -- specification validators, REVISION 5 (pure: no IO, no clock, no network). OFFLINE.
 *
 * Revision 5 runs revision 4 unchanged and carries its result; what it changes is listed in `R5_CHANGE_LOG`, each
 * change with whether it RELAXES, TIGHTENS or RECLASSIFIES and the Canary evidence for it. Revision 5 was written
 * WITH THE CANARY'S 221 CANDIDATES IN VIEW: its numbers on those candidates are in-sample diagnostics, never
 * certification.
 *
 * A. THE ANSWER KEY IS JUDGED AGAINST WHAT THE LEARNER CAN SEE. A reader per construct extracts the given
 *    quantities from the stem and the stimulus, and -- where it deterministically can -- which quantity the stem
 *    asks for. The generator's declared model, targets and arithmetic are NEVER the basis of a verification; they
 *    are a cross-check that can only add a flag.
 *       INDEPENDENTLY_VERIFIED     givens read, asked quantity read, key equal to the recomputed value
 *       REPRESENTATION_DIFFERENCE  as above, but the key differs only in SIGN, UNIT_PERCENT or ROUNDING
 *       KEY_CONTRADICTED           givens read, asked quantity read, key is another value
 *       STEM_CONSISTENT            givens read; the key equals a quantity they determine, but WHICH quantity the
 *                                  stem asks for was not read. Not a verification.
 *       UNVERIFIED                 no independent recomputation was possible
 * B. OPTIONS that are equations are compared as equations; equivalent forms are equal, different lines are not.
 * C. ORIGINALITY has three notions. Only MATERIAL_DUPLICATE fails the gate. Scenario similarity is not applied to
 *    an ABSTRACT item at all.
 * D. PROFILE issues that are about the generator's declarations or its working outline go to a non-blocking
 *    DECLARATION_QUALITY channel.
 */
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { quadraticEquationStatedIn, type SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';

export const SPECIFICATION_VALIDATORS_REVISION_5 = 5 as const;
export const R5_IN_SAMPLE_NOTICE = 'Revision 5 was developed with the Canary candidates in view. Its results on them are IN-SAMPLE DIAGNOSTICS, not certification evidence.' as const;

// ---------------------------------------------------------------------------------------------------------------
// numbers and equations
// ---------------------------------------------------------------------------------------------------------------
const clean = (t: string): string => t.replace(/[−–—]/g, '-').replace(/ /g, ' ').replace(/²/g, '^2');
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
/** A number written as an integer, a decimal (point or comma) or a fraction a/b. */
export function parseNumber(text: string): number | null {
  const t = clean(text).trim().replace(/\s+/g, '');
  const f = /^(-?\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/.exec(t);
  if (f) { const d = Number(f[2].replace(',', '.')); return d === 0 ? null : Number(f[1].replace(',', '.')) / d; }
  return /^-?\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : null;
}
/** Every number of a text, in order: fractions as their value, decimals with point or comma. */
export function numbersOf(text: string): number[] {
  const out: number[] = [];
  for (const m of clean(text).matchAll(/(?<![\p{L}\d.^])(?!(?<=\d,)\d)(-?\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+(?:[.,]\d+)?))?(?![\d])/gu)) {
    const a = Number(m[1].replace(',', '.'));
    out.push(m[2] !== undefined && Number(m[2].replace(',', '.')) !== 0 ? a / Number(m[2].replace(',', '.')) : a);
  }
  return out;
}
export interface LinearForm { A: number; B: number; C: number }
/** One side of a linear equation in x and y: coefficients of x, of y, and the constant. null when it is not linear in x and y only. */
function linearSide(side: string): { x: number; y: number; c: number } | null {
  const s = side.replace(/\s+/g, '').replace(/\*/g, '');
  if (s.length === 0 || /[^-+\d.,/xy()]/.test(s) || /[()]/.test(s)) return null;
  const out = { x: 0, y: 0, c: 0 };
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== s) return null;
  for (const term of terms) {
    const m = /^([+-]?)(\d+(?:[.,]\d+)?)?(?:\/(\d+(?:[.,]\d+)?))?([xy])?(?:\/(\d+(?:[.,]\d+)?))?$/.exec(term);
    if (!m || (m[2] === undefined && m[4] === undefined)) return null;
    let v = m[2] === undefined ? 1 : Number(m[2].replace(',', '.'));
    if (m[3] !== undefined) v /= Number(m[3].replace(',', '.'));
    if (m[5] !== undefined) v /= Number(m[5].replace(',', '.'));
    if (!Number.isFinite(v)) return null;
    if (m[1] === '-') v = -v;
    if (m[4] === 'x') out.x += v; else if (m[4] === 'y') out.y += v; else out.c += v;
  }
  return out;
}
/** A linear equation in x and y as A x + B y + C = 0, scaled so that its first non-zero coefficient is 1. null when the text is not one. */
export function parseLinearEquation(text: string): LinearForm | null {
  const m = /(?:^|[^\p{L}\d])((?:[-+]?\s*[\d.,/]*\s*[xy]|[-+]?\s*\d)[-+\d.,/xy\s*]*=\s*[-+\d.,/xy\s*]+)/u.exec(` ${clean(text)}`);
  if (!m) return null;
  const sides = m[1].split('=');
  if (sides.length !== 2) return null;
  const l = linearSide(sides[0]), r = linearSide(sides[1].replace(/[.,;]\s*$/, ''));
  if (!l || !r) return null;
  const A = l.x - r.x, B = l.y - r.y, C = l.c - r.c;
  const lead = [A, B, C].find((v) => Math.abs(v) > 1e-12);
  if (lead === undefined || (Math.abs(A) < 1e-12 && Math.abs(B) < 1e-12)) return null;
  return { A: A / lead, B: B / lead, C: C / lead };
}
/** Two equations with the same solutions: `2x + 4 = 0` and `x = -2`; `y = x/2 + 1` and `2y - x = 2`; fractions or decimals; terms in any order. */
export const sameLinearEquation = (a: LinearForm, b: LinearForm): boolean => close(a.A, b.A) && close(a.B, b.B) && close(a.C, b.C);
const lineForm = (m: number, b: number): LinearForm => parseLinearEquation(`y = ${m}x + ${b}`.replace('+ -', '- '))!;

// ---------------------------------------------------------------------------------------------------------------
// comparing a key with a recomputed value
// ---------------------------------------------------------------------------------------------------------------
export type KeyClassR5 = 'INDEPENDENTLY_VERIFIED' | 'REPRESENTATION_DIFFERENCE' | 'KEY_CONTRADICTED' | 'STEM_CONSISTENT' | 'UNVERIFIED';
export type Representation = 'SIGN' | 'UNIT_PERCENT' | 'ROUNDING';
const roundTo = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;
const significant = (v: number, n: number): number => (v === 0 ? 0 : Number(v.toPrecision(n)));
const ROUNDING_ASKED = /redonde|aproxim|décima|centésima|cifras? decimal|decimal place|d\.p\.|s\.f\.|significant|nearest|to the nearest|whole percent|número entero más cercano|\bround/i;
const PERCENT_ASKED = /%|porcent|percent|puntos porcentuales|percentage/i;
/** How a keyed number relates to a recomputed one. `text` is the learner-visible text that asks for it. */
export function compareKey(keyed: number, expected: number, text: string, signIsARepresentation = false): 'EQUAL' | Representation | 'DIFFERENT' {
  if (close(keyed, expected)) return 'EQUAL';
  const percentAsked = PERCENT_ASKED.test(text);
  if (percentAsked && (close(keyed, expected * 100) || close(keyed * 100, expected))) return 'EQUAL';
  // rounding to one or more decimal places; a whole number or significant figures only when the text asks for rounding
  const rounded = (e: number): boolean => [1, 2, 3, 4].some((d) => close(keyed, roundTo(e, d))) || (ROUNDING_ASKED.test(text) && [2, 3, 4].some((n) => close(keyed, significant(e, n))));
  // rounding to a whole number is a representation only when the text asks for rounding
  const wholeAsked = ROUNDING_ASKED.test(text) && close(keyed, Math.round(expected));
  if (rounded(expected) || wholeAsked || (percentAsked && (rounded(expected * 100) || (ROUNDING_ASKED.test(text) && close(keyed, Math.round(expected * 100)))))) return ROUNDING_ASKED.test(text) ? 'EQUAL' : 'ROUNDING';
  // a sign is a representation only for a difference or a change (the order of subtraction); for any other quantity it is an error
  if (signIsARepresentation && expected !== 0 && close(keyed, -expected)) return 'SIGN';
  if (close(keyed, expected * 100) || close(keyed * 100, expected)) return 'UNIT_PERCENT';
  return 'DIFFERENT';
}

// ---------------------------------------------------------------------------------------------------------------
// the readers: what the stem gives, and what it asks
// ---------------------------------------------------------------------------------------------------------------
export interface StemReading { reader: string; given: Record<string, number>; /** every quantity the givens determine, by name */ determined: Record<string, number>; /** the line the givens determine, when there is one */ line: LinearForm | null; note: string | null }
interface Ask { quantity: string | null; expected: number | null; expectsEquation: boolean }
type Table = { columns: Array<{ type: string; header?: string; label?: string; key?: string }>; rows: unknown[][] };
const tablesOf = (stimulus: CandidateStimulus | null): Table[] => ((stimulus?.structured as { tables?: Table[] } | undefined)?.tables ?? []);
const POINT = /[\p{L}]?\s*=?\s*\(\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*\)/gu;
/** A label: the 1 or 2 that follows a word (Route 1, promoción 2, plan 1). It names an option; it is not a quantity. */
const LABEL = /([\p{L}]{3,})\s+([12])(?![\d/]|[.,]\d)/gu;
const withoutLabels = (t: string): string => clean(t).replace(LABEL, '$1');

function readLine(stem: string): StemReading | null {
  const pts = [...clean(stem).matchAll(POINT)].map((m) => [Number(m[1]), Number(m[2])] as const);
  if (pts.length < 2 || close(pts[0][0], pts[1][0])) return null;
  const [[x1, y1], [x2, y2]] = pts;
  const m = (y2 - y1) / (x2 - x1), b = y1 - m * x1;
  return { reader: 'TWO_POINTS_IN_THE_STEM', given: { x1, y1, x2, y2 }, determined: { SLOPE: m, Y_INTERCEPT: b, ...(m !== 0 ? { X_INTERCEPT: -b / m } : {}) }, line: lineForm(m, b), note: null };
}
function askOfLine(r: StemReading, ask: string): Ask {
  const a = clean(ask);
  const atX = /(?<![\p{L}\d])x\s*=\s*(-?\d+(?:[.,]\d+)?)/u.exec(a.replace(POINT, ' '));
  if (atX) { const x0 = Number(atX[1].replace(',', '.')); return { quantity: `VALUE_AT_X=${x0}`, expected: r.determined.SLOPE * x0 + r.determined.Y_INTERCEPT, expectsEquation: false }; }
  const kinds = [[/pendiente|slope|gradient/i, 'SLOPE'], [/y-intercept|ordenada al origen|corte con el eje y|intersecci[oó]n con el eje y|intercepto en y/i, 'Y_INTERCEPT'], [/x-intercept|corte con el eje x|intersecci[oó]n con el eje x/i, 'X_INTERCEPT']] as const;
  const hits = kinds.filter(([re]) => re.test(a)).map(([, k]) => k);
  if (hits.length === 1 && !/ecuaci[oó]n|equation/i.test(a)) return { quantity: hits[0], expected: r.determined[hits[0]] ?? null, expectsEquation: false };
  if (/ecuaci[oó]n|equation|y\s*=\s*mx/i.test(a)) return { quantity: 'EQUATION', expected: null, expectsEquation: true };
  return { quantity: null, expected: null, expectsEquation: false };
}
function readQuadratic(stem: string): StemReading | null {
  const t = clean(stem);
  const f = /(-?\d+(?:\.\d+)?)?\s*\(\s*x\s*([+-])\s*(\d+(?:\.\d+)?)\s*\)\s*\(\s*x\s*([+-])\s*(\d+(?:\.\d+)?)\s*\)\s*=\s*0/.exec(t);
  let roots: [number, number] | null = null, note: string | null = null;
  if (f) { roots = [f[2] === '-' ? Number(f[3]) : -Number(f[3]), f[4] === '-' ? Number(f[5]) : -Number(f[5])]; note = 'the stem gives the equation already factorised'; }
  else {
    const eq = quadraticEquationStatedIn(t);
    if (!eq) return null;
    const disc = eq.B * eq.B - 4 * eq.A * eq.C;
    if (disc < 0) return null;
    roots = [(-eq.B - Math.sqrt(disc)) / (2 * eq.A), (-eq.B + Math.sqrt(disc)) / (2 * eq.A)];
  }
  const lo = Math.min(...roots), hi = Math.max(...roots);
  return { reader: 'EQUATION_IN_THE_STEM', given: {}, determined: { LESSER_ROOT: lo, GREATER_ROOT: hi, SUM_OF_ROOTS: lo + hi, PRODUCT_OF_ROOTS: lo * hi }, line: null, note };
}
function askOfQuadratic(r: StemReading, ask: string): Ask {
  const kinds = [[/ra[ií]z mayor|mayor ra[ií]z|greater root|larger root|largest root|soluci[oó]n mayor|greater solution|larger solution/i, 'GREATER_ROOT'], [/ra[ií]z menor|menor ra[ií]z|lesser root|smaller root|smallest root|soluci[oó]n menor|smaller solution|lesser solution/i, 'LESSER_ROOT'], [/suma de (las|sus) ra[ií]ces|sum of the roots/i, 'SUM_OF_ROOTS'], [/producto de (las|sus) ra[ií]ces|product of the roots/i, 'PRODUCT_OF_ROOTS']] as const;
  const hits = kinds.filter(([re]) => re.test(ask)).map(([, k]) => k);
  return hits.length === 1 ? { quantity: hits[0], expected: r.determined[hits[0]], expectsEquation: false } : { quantity: null, expected: null, expectsEquation: false };
}
const START = /(?:starts? at|start(?:ing)? (?:value|reading|price|fee) (?:of|is)|empieza en|comienza en|inicial(?:es)?(?: es)?(?: de)?|initial(?:ly)?(?: is)?(?: of)?)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/giu;
const UP = /(?:increases?|aumenta|sube|crece|rises?)\s*(?:by|en)?\s*(\d+(?:[.,]\d+)?)/giu;
const DOWN = /(?:decreases?|disminuye|baja|se reduce|falls?|drops?)\s*(?:by|en)?\s*(\d+(?:[.,]\d+)?)/giu;
function readOptimum(stem: string): StemReading | null {
  const t = clean(stem);
  const num = (s: string) => Number(s.replace(',', '.'));
  const inc = /(\d+(?:[.,]\d+)?)\s*\+\s*(\d+(?:[.,]\d+)?)\s*\*?\s*x(?![\p{L}\d^])/u.exec(t), dec = /(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*\*?\s*x(?![\p{L}\d^])/u.exec(t);
  const starts = [...t.matchAll(START)].map((m) => num(m[1])), ups = [...t.matchAll(UP)].map((m) => num(m[1])), downs = [...t.matchAll(DOWN)].map((m) => num(m[1]));
  let p: number, q: number, r: number, s: number;
  if (inc) { p = num(inc[1]); q = num(inc[2]); } else if (ups.length === 1 && starts.length >= 1) { p = starts[0]; q = ups[0]; } else return null;
  if (dec) { r = num(dec[1]); s = num(dec[2]); } else if (downs.length === 1 && starts.length >= (inc ? 1 : 2)) { r = starts[inc ? 0 : 1]; s = downs[0]; } else return null;
  if (q <= 0 || s <= 0) return null;
  const xv = (q * r - p * s) / (2 * q * s);
  return { reader: 'TWO_LINEAR_FACTORS_IN_THE_STEM', given: { p, q, r, s }, determined: { MEASURE_AT_OPTIMUM: xv, OPTIMAL_VALUE: (p + q * xv) * (r - s * xv) }, line: null, note: inc && dec ? 'the stem writes both linear factors out' : null };
}
const MEASURE_ASK = /that gives|which gives|that produces|that maximi[sz]es|que (da|produce|maximiza|hace|permite)|value of x|valor de x|\bx\b (that|que)|para (que|obtener|alcanzar)|at which|for which|con qu[eé]|qu[eé] (valor|recargo|precio|cantidad|nivel)/i;
const OPTIMUM_ASK = /m[aá]xim[oa]s?\b|maximum|greatest|largest|highest|\bmayor\b|m[aá]s alto/i;
function askOfOptimum(r: StemReading, ask: string): Ask {
  if (!OPTIMUM_ASK.test(ask)) return { quantity: null, expected: null, expectsEquation: false };
  const q = MEASURE_ASK.test(ask) ? 'MEASURE_AT_OPTIMUM' : 'OPTIMAL_VALUE';
  return { quantity: q, expected: r.determined[q], expectsEquation: false };
}
function readTwoPairs(stem: string, kind: 'PROBABILITY' | 'RATE'): StemReading | null {
  const n = numbersOf(withoutLabels(stem)).filter((v) => v > 0);
  if (n.length !== 4) return null;
  const [a, b, c, d] = n;
  if (kind === 'PROBABILITY') {
    const P1 = Math.min(a, b) / Math.max(a, b), P2 = Math.min(c, d) / Math.max(c, d);
    return { reader: 'TWO_COUNT_PAIRS_IN_THE_STEM', given: { n1: Math.max(a, b), k1: Math.min(a, b), n2: Math.max(c, d), k2: Math.min(c, d) }, determined: { PROBABILITY_1: P1, PROBABILITY_2: P2, PROBABILITY_DIFFERENCE: Math.abs(P1 - P2), HIGHER_PROBABILITY: Math.max(P1, P2), LOWER_PROBABILITY: Math.min(P1, P2) }, line: null, note: null };
  }
  return { reader: 'TWO_AMOUNT_PAIRS_IN_THE_STEM', given: { a1: a, b1: b, a2: c, b2: d }, determined: { RATE_1_B_PER_A: b / a, RATE_2_B_PER_A: d / c, RATE_1_A_PER_B: a / b, RATE_2_A_PER_B: c / d, RATE_DIFFERENCE_B_PER_A: Math.abs(b / a - d / c), RATE_DIFFERENCE_A_PER_B: Math.abs(a / b - c / d) }, line: null, note: 'which way the rate runs is not read' };
}
function readSingleDraw(stem: string): StemReading | null {
  const n = [...new Set(numbersOf(withoutLabels(stem)).filter((v) => Number.isInteger(v) && v > 1))];
  if (n.length !== 2) return null;
  const N = Math.max(...n), k = Math.min(...n);
  return { reader: 'TWO_COUNTS_IN_THE_STEM', given: { n: N, k }, determined: { PROBABILITY: k / N, COMPLEMENT_PROBABILITY: 1 - k / N }, line: null, note: 'which event is asked about is not read' };
}
function readProportion(stem: string): StemReading | null {
  const n = numbersOf(clean(stem)).filter((v) => v > 0);
  if (n.length !== 3) return null;
  const [a, b, c] = n;
  return { reader: 'THREE_NUMBERS_IN_THE_STEM', given: { n1: a, n2: b, n3: c }, determined: { 'n2*n3/n1': (b * c) / a, 'n1*n3/n2': (a * c) / b, 'n1*n2/n3': (a * b) / c }, line: null, note: 'which numbers correspond is not read: every pairing is listed' };
}
const numericColumns = (t: Table): number[] => t.columns.map((col, i) => (col.type === 'NUMBER' ? i : -1)).filter((i) => i >= 0);
function readLinearModel(stem: string, stimulus: CandidateStimulus | null): StemReading | null {
  for (const t of tablesOf(stimulus)) {
    const cols = numericColumns(t);
    if (cols.length !== 2 || t.rows.length < 2) continue;
    const pts = t.rows.map((r) => [Number(r[cols[0]]), Number(r[cols[1]])] as const);
    if (close(pts[0][0], pts[1][0])) continue;
    const m = (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]), b = pts[0][1] - m * pts[0][0];
    if (!pts.every(([x, y]) => close(y, m * x + b))) continue;
    return { reader: 'TABLE_OF_A_LINE_IN_THE_STIMULUS', given: { m, b }, determined: { RATE: m, START_VALUE: b }, line: lineForm(m, b), note: null };
  }
  const t = clean(stem);
  const num = (s: string) => Number(s.replace(',', '.'));
  const starts = [...t.matchAll(START)].map((x) => num(x[1])), ups = [...t.matchAll(UP)].map((x) => num(x[1]));
  const rate = /(\d+(?:[.,]\d+)?)\s*(?:[\p{L}€$]+\s+){0,3}(?:per|por|each|cada|a)\s+[\p{L}]+/iu.exec(t), already = /(?:already|ya)\s+[\p{L}\s]{0,30}?(\d+(?:[.,]\d+)?)/iu.exec(t);
  const m = ups.length === 1 ? ups[0] : rate ? num(rate[1]) : null, b = starts.length === 1 ? starts[0] : already ? num(already[1]) : null;
  if (m === null || b === null) return null;
  return { reader: 'START_AND_RATE_IN_THE_STEM', given: { m, b }, determined: { RATE: m, START_VALUE: b }, line: lineForm(m, b), note: null };
}
function readRelativeChange(ask: string, stimulus: CandidateStimulus | null): StemReading | null {
  for (const t of tablesOf(stimulus)) {
    const cols = numericColumns(t);
    const labelCol = t.columns.findIndex((col) => col.type !== 'NUMBER');
    if (cols.length < 1 || labelCol < 0) continue;
    const a = clean(ask).toLowerCase();
    const found = t.rows.map((r) => ({ label: String(r[labelCol]).toLowerCase(), value: Number(r[cols[0]]) })).map((r) => ({ ...r, at: new RegExp(`(?<![\\p{L}\\d])${r.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'u').exec(a)?.index ?? -1 })).filter((r) => r.at >= 0).sort((x, y) => x.at - y.at);
    if (found.length !== 2 || found[0].value === 0) continue;
    const [i, j] = found;
    return { reader: 'TWO_ROWS_OF_THE_TABLE_NAMED_IN_THE_QUESTION', given: { vi: i.value, vj: j.value }, determined: { RELATIVE_CHANGE_PERCENT: (100 * (j.value - i.value)) / i.value, ABSOLUTE_CHANGE: j.value - i.value }, line: null, note: null };
  }
  return null;
}
function askOfRelativeChange(r: StemReading, ask: string): Ask {
  if (/porcent|percent|%/i.test(ask) && !/puntos|points/i.test(ask)) return { quantity: 'RELATIVE_CHANGE_PERCENT', expected: r.determined.RELATIVE_CHANGE_PERCENT, expectsEquation: false };
  return { quantity: null, expected: null, expectsEquation: false };
}
const HIGHER = /\bmayor\b|\bm[aá]s\b|higher|greater|better|best|mejor|larger|more likely/i, LOWER = /\bmenor\b|\bmenos\b|lower|smaller|worse|peor|less likely|fewer/i;

export const R5_READERS: Readonly<Record<string, string>> = {
  LINE_THROUGH_TWO_POINTS: 'two points written as (x, y) in the stem; asked: the value of y at a stated x, the slope, an intercept, or the equation',
  QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING: 'the quadratic equation written in the stem (either side, or factorised); asked: greater root, lesser root, sum, product',
  QUADRATIC_MODEL_VERTEX_OPTIMUM: 'two linear factors, written as expressions in x or as "starts at ... and increases / decreases by ..."; asked: the maximising x, or the maximum value',
  COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES: 'four counts in the stem, read as two (favourable, total) pairs in order; asked: which option is higher or lower (verdict). A keyed NUMBER is checked for consistency only',
  UNIT_RATE_COMPARISON_OF_TWO_OPTIONS: 'four amounts in the stem, read as two pairs in order; which way the rate runs is NOT read, so a key is checked for consistency only',
  CLASSICAL_PROBABILITY_SINGLE_DRAW: 'two counts in the stem; which event is asked about is NOT read, so a key is checked for consistency only',
  DIRECT_PROPORTION_MISSING_VALUE: 'three numbers in the stem; which correspond is NOT read, so a key is checked against every pairing for consistency only',
  LINEAR_MODEL_FIXED_START_CONSTANT_RATE: 'a table of a line in the stimulus, or a start and a rate in the stem; asked: the equation. A keyed NUMBER is checked for consistency only',
  RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES: 'two rows of the stimulus table named in the question, in the order named; asked: the percentage change',
  CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY: 'NO READER: whether a display supports a statement is not recomputed. Every key of this construct is UNVERIFIED',
};

export interface KeyUnitR5 { label: string; class: KeyClassR5; representation: Representation | null; reader: string | null; asked: string | null; keyed: string | null; expected: number | string | null; flags: string[]; revision4Class: string }
const constructOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown }).construct ?? '');
const fmt = (v: number): number => Number(v.toPrecision(12));

export function answerKeyR5(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null, r4: SpecificationItemValidationR4): { units: KeyUnitR5[]; reading: StemReading | null } {
  const construct = constructOf(s);
  const x = c.content;
  const stimulusText = (stimulus?.parts ?? []).filter((p) => p.partKind === 'TEXT').map((p) => p.text).join(' ');
  const stem = `${stimulusText} ${x.stem}`;
  type Unit = { label: string; ask: string; keyedText: string; numeric: number | null };
  const units: Unit[] = x.selected ? [{ label: 'item', ask: x.stem, keyedText: x.selected.options.find((o) => o.id === x.selected!.answerKey)?.text ?? '', numeric: null }]
    : x.numeric ? [{ label: 'item', ask: x.stem, keyedText: String((x.numeric.numericKey as { value?: unknown }).value ?? ''), numeric: null }]
      : x.constructed!.parts.map((p) => ({ label: p.label, ask: p.prompt, keyedText: p.numericKey ? String((p.numericKey as { value?: unknown }).value ?? '') : p.finalAnswer, numeric: null }));
  for (const u of units) { const direct = parseNumber(u.keyedText); const inText = numbersOf(u.keyedText); u.numeric = direct ?? (inText.length === 1 ? inText[0] : null); }
  // what a closed item asks is its question: the last sentence of the stem that ends in a question mark, else its last sentence
  const sentences = clean(x.stem).split(/(?<=[.?!])\s+/).filter((t) => t.trim().length > 0);
  const question = [...sentences].reverse().find((t) => /\?/.test(t)) ?? sentences[sentences.length - 1] ?? x.stem;
  const askContext = (u: Unit): string => (x.constructed ? u.ask : question);
  const reading: StemReading | null = construct === 'LINE_THROUGH_TWO_POINTS' ? readLine(stem) : construct === 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING' ? readQuadratic(stem) : construct === 'QUADRATIC_MODEL_VERTEX_OPTIMUM' ? readOptimum(stem)
    : construct === 'COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES' ? readTwoPairs(stem, 'PROBABILITY') : construct === 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS' ? readTwoPairs(stem, 'RATE') : construct === 'CLASSICAL_PROBABILITY_SINGLE_DRAW' ? readSingleDraw(stem)
      : construct === 'DIRECT_PROPORTION_MISSING_VALUE' ? readProportion(stem) : construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE' ? readLinearModel(stem, stimulus) : construct === 'RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES' ? readRelativeChange(`${x.stem} ${x.constructed?.parts.map((p) => p.prompt).join(' ') ?? ''}`, stimulus) : null;
  const r4Units = new Map(r4.revision4.answerUnits.map((u) => [u.label, u]));
  const declared = c.content.declaredModel.parameters;
  const out = units.map((u): KeyUnitR5 => {
    const r4u = r4Units.get(u.label);
    const flags: string[] = [];
    const base = { label: u.label, representation: null as Representation | null, reader: reading?.reader ?? null, asked: null as string | null, keyed: u.keyedText.slice(0, 120), expected: null as number | string | null, revision4Class: r4u?.class ?? 'NONE' };
    const done = (cls: KeyClassR5, over: Partial<KeyUnitR5> = {}): KeyUnitR5 => {
      // the generator's declarations are a cross-check only: they can add a flag, never raise or lower the class
      if (r4u?.class === 'FAILED' && cls !== 'KEY_CONTRADICTED') flags.push('DECLARED_TARGET_OR_ARITHMETIC_DISAGREES_WITH_THE_KEY');
      if ((r4u?.class === 'MACHINE_VERIFIED' || r4u?.class === 'DETERMINISTIC_RULE_VERIFIED') && cls !== 'INDEPENDENTLY_VERIFIED') flags.push('REVISION_4_VERIFIED_FROM_DECLARATIONS_ONLY');
      return { ...base, class: cls, flags, ...over };
    };
    if (!reading) return done('UNVERIFIED');
    if (Object.entries(reading.given).some(([k, v]) => typeof declared[k] === 'number' && !close(declared[k], v))) flags.push('STEM_GIVENS_DIFFER_FROM_THE_DECLARED_PARAMETERS');
    const context = `${askContext(u)}`;
    const ask: Ask = construct === 'LINE_THROUGH_TWO_POINTS' ? askOfLine(reading, context) : construct === 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING' ? askOfQuadratic(reading, context) : construct === 'QUADRATIC_MODEL_VERTEX_OPTIMUM' ? askOfOptimum(reading, context)
      : construct === 'RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES' ? askOfRelativeChange(reading, context) : construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE' && /ecuaci[oó]n|equation|relaci[oó]n|relationship|expresi[oó]n|expression|modelo|model/i.test(context) && parseLinearEquation(u.keyedText) ? { quantity: 'EQUATION', expected: null, expectsEquation: true } : { quantity: null, expected: null, expectsEquation: false };
    // an equation is asked for and the givens determine a line
    if (ask.expectsEquation && reading.line) {
      const keyed = parseLinearEquation(u.keyedText);
      if (!keyed) return done('UNVERIFIED', { asked: 'EQUATION' });
      return sameLinearEquation(keyed, reading.line) ? done('INDEPENDENTLY_VERIFIED', { asked: 'EQUATION', expected: `${fmt(reading.line.A)}x + ${fmt(reading.line.B)}y + ${fmt(reading.line.C)} = 0` }) : done('KEY_CONTRADICTED', { asked: 'EQUATION', expected: `${fmt(reading.line.A)}x + ${fmt(reading.line.B)}y + ${fmt(reading.line.C)} = 0` });
    }
    // which option is higher or lower, keyed as that option
    if (construct === 'COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES' && u.numeric === null) {
      const label = /\b([12])\b/.exec(clean(u.keyedText))?.[1];
      const hi = HIGHER.test(context), lo = LOWER.test(context);
      if (!label || hi === lo || close(reading.determined.PROBABILITY_1, reading.determined.PROBABILITY_2)) return done('UNVERIFIED');
      const wanted = (reading.determined.PROBABILITY_1 > reading.determined.PROBABILITY_2) === hi ? '1' : '2';
      return done(label === wanted ? 'INDEPENDENTLY_VERIFIED' : 'KEY_CONTRADICTED', { asked: hi ? 'OPTION_WITH_HIGHER_PROBABILITY' : 'OPTION_WITH_LOWER_PROBABILITY', expected: `option ${wanted}` });
    }
    if (u.numeric === null) return done('UNVERIFIED');
    if (ask.quantity !== null && ask.expected !== null) {
      const signed = /DIFFERENCE|CHANGE/.test(ask.quantity);
      const cmp = compareKey(u.numeric, ask.expected, `${stem} ${u.ask}`, signed);
      const over = { asked: ask.quantity, expected: fmt(ask.expected) };
      // the key is ANOTHER quantity the givens determine: the question was read differently here than the item keys it. Not a contradiction.
      const other = cmp === 'DIFFERENT' ? Object.entries(reading.determined).find(([name, value]) => name !== ask.quantity && compareKey(u.numeric!, value, `${stem} ${u.ask}`) === 'EQUAL') : undefined;
      if (other) { flags.push(`ASKED_QUANTITY_READ_AS_${ask.quantity}_BUT_THE_KEY_IS_${other[0]}`); return done('STEM_CONSISTENT', { asked: `ambiguous: read as ${ask.quantity}; the key is ${other[0]}`, expected: fmt(other[1]) }); }
      return cmp === 'EQUAL' ? done('INDEPENDENTLY_VERIFIED', over) : cmp === 'DIFFERENT' ? done('KEY_CONTRADICTED', over) : done('REPRESENTATION_DIFFERENCE', { ...over, representation: cmp });
    }
    // the asked quantity was not read: is the key one of the quantities the givens determine?
    const candidates = Object.entries({ ...reading.determined, ...(construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE' ? Object.fromEntries(numbersOf(clean(stem)).map((v) => [`VALUE_AT_X=${v}`, reading.determined.RATE * v + reading.determined.START_VALUE])) : {}) });
    for (const [name, value] of candidates) { const cmp = compareKey(u.numeric, value, `${stem} ${u.ask}`, /DIFFERENCE|CHANGE/.test(name)); if (cmp !== 'DIFFERENT') return done('STEM_CONSISTENT', { asked: `not read; the key is ${name}`, expected: fmt(value), representation: cmp === 'EQUAL' ? null : cmp }); }
    flags.push('KEY_IS_NONE_OF_THE_QUANTITIES_THE_STEM_DETERMINES');
    return done('UNVERIFIED');
  });
  return { units: out, reading };
}

// ---------------------------------------------------------------------------------------------------------------
// B. options
// ---------------------------------------------------------------------------------------------------------------
export function optionIssuesR5(c: SpecificationCandidate, r4StructuralIssues: readonly string[]): string[] {
  if (!c.content.selected) return [...r4StructuralIssues];
  const options = c.content.selected.options;
  const eq = new Map(options.map((o) => [o.id, /=/.test(o.text) ? parseLinearEquation(o.text) : null]));
  const isEquation = (id: string): boolean => /=/.test(options.find((o) => o.id === id)?.text ?? '');
  const kept = r4StructuralIssues.filter((i) => { const m = /^OPTIONS_STATE_THE_SAME_NUMBER:(\w+),(\w+)$/.exec(i); return !m || !(isEquation(m[1]) || isEquation(m[2])); });
  const out = [...kept];
  for (let i = 0; i < options.length; i += 1) for (let j = i + 1; j < options.length; j += 1) { const a = eq.get(options[i].id), b = eq.get(options[j].id); if (a && b && sameLinearEquation(a, b)) out.push(`OPTIONS_ARE_EQUIVALENT_EQUATIONS:${options[i].id},${options[j].id}`); }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// C. originality
// ---------------------------------------------------------------------------------------------------------------
export const ORIGINALITY_RULE_R5 = {
  id: 'studyus-originality-rule', version: '5',
  MATERIAL_DUPLICATE: 'FAILS the gate. (1) textual similarity at the existing reject threshold (0.8) with another item; or (2) the same construct with the WHOLE parameter set equal to another item\'s; or (3) for an item with a situation: a near-duplicate scenario (similarity >= 0.4) AND a shared defining parameter pair with the SAME other item.',
  MATHEMATICAL_TEMPLATE_SIMILARITY: 'A signal, not a failure: a defining parameter pair shared with another item of the construct, without the whole set and without a near-duplicate scenario.',
  STRUCTURAL_SIMILARITY: 'A signal, not a failure: textual similarity in the existing review band (0.5 to 0.8), or -- for an item with a situation -- a near-duplicate scenario without a shared parameter pair.',
  abstractItems: 'Scenario similarity is NOT APPLIED to an item whose context is ABSTRACT: it has no scenario, and its framing sentence is its family\'s.',
} as const;
export interface OriginalityR5 { materialDuplicate: string[]; mathematicalTemplateSimilarity: string[]; structuralSimilarity: string[]; scenarioRuleApplied: boolean }
export function originalityR5(c: SpecificationCandidate, r4: SpecificationItemValidationR4): OriginalityR5 {
  const abstract = c.content.context.kind === 'ABSTRACT';
  const textual = r4.revision3.revision2.originality.outcome;
  const scenario = new Set<string>(), pair = new Map<string, string>(), material: string[] = [];
  for (const f of r4.revision4.batchDiversity) {
    const m = /^(SHARES_PARAMETER_VALUES|NEAR_DUPLICATE_SCENARIO):(.+):([^:]+)$/.exec(f);
    if (!m) continue;
    if (m[1] === 'NEAR_DUPLICATE_SCENARIO') { if (!abstract) scenario.add(m[2]); } else if (m[3] === 'WHOLE_SET') material.push(`WHOLE_PARAMETER_SET:${m[2]}`); else pair.set(m[2], m[3]);
  }
  if (textual === 'REJECT_TEXTUAL_SIMILARITY') material.push('TEXTUAL_SIMILARITY_AT_THE_REJECT_THRESHOLD');
  for (const peer of scenario) if (pair.has(peer)) material.push(`NEAR_DUPLICATE_SCENARIO_AND_SHARED_PAIR:${peer}:${pair.get(peer)}`);
  return {
    materialDuplicate: material,
    mathematicalTemplateSimilarity: [...pair].filter(([peer]) => !scenario.has(peer)).map(([peer, p]) => `SHARED_PARAMETER_PAIR:${peer}:${p}`),
    structuralSimilarity: [...(textual === 'REVIEW_STRUCTURAL_SIMILARITY' ? ['TEXTUAL_SIMILARITY_IN_THE_REVIEW_BAND'] : []), ...[...scenario].filter((peer) => !pair.has(peer)).map((peer) => `NEAR_DUPLICATE_SCENARIO:${peer}`)],
    scenarioRuleApplied: !abstract,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// D. profile channels
// ---------------------------------------------------------------------------------------------------------------
/** Issue codes that are about what the generator DECLARED or about its working outline, which no learner and no marker sees. */
export const DECLARATION_QUALITY_CODES = ['PARAMETER_NOT_OF_THE_CONSTRUCT', 'WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS', 'ITEM_DOES_NOT_SAY_WHICH_STIMULUS_VALUES_IT_USES'] as const;
export const PROFILE_CHANNEL_RULE = 'A profile issue whose code is in DECLARATION_QUALITY_CODES is reported in the DECLARATION_QUALITY channel and does not fail the item. EVERY OTHER code stays a HARD failure, including codes not seen in the Canary: marks and mark-scheme structure, response format, command terms, calculator rules on stated or keyed numbers, value ranges and parameter constraints (they are about the numbers of the item).' as const;
export const channelOfProfileIssue = (issue: string): 'DECLARATION_QUALITY' | 'HARD' => ((DECLARATION_QUALITY_CODES as readonly string[]).includes(issue.split(':')[0]) ? 'DECLARATION_QUALITY' : 'HARD');
export function profileR5(r4: SpecificationItemValidationR4): { hard: string[]; declarationQuality: string[] } {
  const all = [...r4.revision3.revision2.profileCompliance.issues, ...r4.revision3.additions.marks, ...r4.revision3.additions.commandTerms, ...r4.revision4.demandPolicy.issues];
  return { hard: all.filter((i) => channelOfProfileIssue(i) === 'HARD'), declarationQuality: all.filter((i) => channelOfProfileIssue(i) === 'DECLARATION_QUALITY') };
}

// ---------------------------------------------------------------------------------------------------------------
// two checks the Canary's AI reviewer made and revision 4 did not
// ---------------------------------------------------------------------------------------------------------------
/** The asked value of a linear model is already a cell of the stimulus table, in the row the question names. */
export function keyedValueReadFromTheTable(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null, units: readonly KeyUnitR5[]): string[] {
  if (constructOf(s) !== 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE') return [];
  const asked = numbersOf(clean(c.content.stem));
  const out: string[] = [];
  for (const u of units) { const inKey = numbersOf(u.keyed ?? ''); const k = parseNumber(u.keyed ?? '') ?? (inKey.length === 1 ? inKey[0] : null); if (k === null) continue; for (const t of tablesOf(stimulus)) for (const row of t.rows) { const cells = row.filter((v): v is number => typeof v === 'number'); if (cells.length === 2 && close(cells[1], k) && asked.some((a) => close(a, cells[0]))) out.push(`KEYED_VALUE_IS_A_CELL_OF_THE_STIMULUS_ROW_THE_QUESTION_NAMES:${u.label}:${cells[0]}->${cells[1]}`); } }
  return out;
}
/** The stimulus text states a count of the things a table column counts, and the column does not add up to it. */
export function stimulusTotalIssues(stimulus: CandidateStimulus | null): string[] {
  const text = clean((stimulus?.parts ?? []).filter((p) => p.partKind === 'TEXT').map((p) => p.text).join(' ')).toLowerCase();
  const out: string[] = [];
  for (const t of tablesOf(stimulus)) for (const i of numericColumns(t)) {
    const col = t.columns[i];
    const header = `${col.header ?? ''} ${col.label ?? ''}`.toLowerCase();
    const words = (header.match(/[\p{L}]{5,}/gu) ?? []).filter((w) => !/^(n[uú]mero|number|cantidad|total|count)$/u.test(w));
    const sum = t.rows.reduce((n, r) => n + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0);
    for (const w of words) for (const m of text.matchAll(new RegExp(`(\\d+)\\s+${w}`, 'gu'))) if (Number(m[1]) !== sum && Number(m[1]) > 1) out.push(`STIMULUS_TEXT_COUNT_DISAGREES_WITH_THE_TABLE_TOTAL:${m[1]} ${w}/${sum}`);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------------------------
// the whole revision
// ---------------------------------------------------------------------------------------------------------------
const KEY_ORDER: readonly KeyClassR5[] = ['KEY_CONTRADICTED', 'REPRESENTATION_DIFFERENCE', 'UNVERIFIED', 'STEM_CONSISTENT', 'INDEPENDENTLY_VERIFIED'];
export interface GatesR5 { structural: 'PASS' | 'FAIL'; profileCompliance: 'PASS' | 'FAIL'; declarationQuality: 'CLEAN' | 'ISSUES'; constructPreservation: 'PASS' | 'WEAK' | 'FAIL'; answerKey: KeyClassR5; stimulusIntegrity: 'PASS' | 'FAIL' | 'NOT_APPLICABLE'; originality: 'PASS' | 'MATERIAL_DUPLICATE'; originalitySignals: number; lineage: string; learnerTextLeakage: string; itemWriting: string }
export interface SpecificationItemValidationR5 {
  candidateKey: string; validatorsRevision: 5; kind: 'AUTOMATED_VALIDATION'; isHumanReview: false; inSample: typeof R5_IN_SAMPLE_NOTICE;
  answerKey: { units: KeyUnitR5[]; reading: StemReading | null }; structuralIssues: string[]; profile: { hard: string[]; declarationQuality: string[] }; constructIssues: string[]; constructWeak: string[]; stimulusIssues: string[]; originality: OriginalityR5; gates: GatesR5;
}
export function validateSpecificationCandidateR5(p: { candidate: SpecificationCandidate; specification: AdaptationSpecification; stimulus: CandidateStimulus | null; revision4: SpecificationItemValidationR4 }): SpecificationItemValidationR5 {
  const { candidate: c, specification: s, stimulus, revision4: r4 } = p;
  const answerKey = answerKeyR5(c, s, stimulus, r4);
  const structuralIssues = optionIssuesR5(c, r4.revision4.structuralIssues);
  const profile = profileR5(r4);
  const constructIssues = [...r4.revision4.constructIssues, ...keyedValueReadFromTheTable(c, s, stimulus, answerKey.units)];
  const stimulusIssues = stimulusTotalIssues(stimulus);
  const originality = originalityR5(c, r4);
  const g4 = r4.gates;
  const gates: GatesR5 = {
    structural: structuralIssues.length > 0 ? 'FAIL' : 'PASS',
    profileCompliance: profile.hard.length > 0 ? 'FAIL' : 'PASS', declarationQuality: profile.declarationQuality.length > 0 ? 'ISSUES' : 'CLEAN',
    constructPreservation: constructIssues.length > 0 ? 'FAIL' : g4.constructPreservation === 'FAIL' ? 'FAIL' : g4.constructPreservation,
    answerKey: KEY_ORDER.find((k) => answerKey.units.some((u) => u.class === k)) ?? 'UNVERIFIED',
    stimulusIntegrity: stimulusIssues.length > 0 || g4.stimulusIntegrity === 'FAIL' ? 'FAIL' : g4.stimulusIntegrity,
    originality: originality.materialDuplicate.length > 0 ? 'MATERIAL_DUPLICATE' : 'PASS', originalitySignals: originality.mathematicalTemplateSimilarity.length + originality.structuralSimilarity.length,
    lineage: g4.lineage, learnerTextLeakage: g4.learnerTextLeakage, itemWriting: g4.itemWriting,
  };
  return { candidateKey: c.candidateKey, validatorsRevision: SPECIFICATION_VALIDATORS_REVISION_5, kind: 'AUTOMATED_VALIDATION', isHumanReview: false, inSample: R5_IN_SAMPLE_NOTICE, answerKey, structuralIssues, profile, constructIssues, constructWeak: r4.revision4.constructWeak, stimulusIssues, originality, gates };
}
/** A hard failure of revision 5. */
export const hasGateFailR5 = (g: GatesR5): boolean => g.structural === 'FAIL' || g.profileCompliance === 'FAIL' || g.constructPreservation === 'FAIL' || g.answerKey === 'KEY_CONTRADICTED' || g.stimulusIntegrity === 'FAIL' || g.originality === 'MATERIAL_DUPLICATE' || g.lineage === 'FAIL' || g.learnerTextLeakage === 'FAIL';
export const isStrictPassR5 = (g: GatesR5): boolean => !hasGateFailR5(g) && g.constructPreservation === 'PASS' && g.itemWriting === 'PASS';
/**
 * REJECTED BY VALIDATOR: a failure of a gate that states a deterministic fact about the item, which the Canary's
 * decision policy rejects on whatever a reviewer says (its rule R1). The SAME definition for both revisions:
 * structural FAIL, answer key failed / contradicted, lineage FAIL, learner-text leakage FAIL (revision 4 also has a
 * machine-recomputation gate, which fails exactly when its answer key does).
 */
export const rejectedByValidatorR4 = (g: SpecificationItemValidationR4['gates']): boolean => g.structural === 'FAIL' || g.answerKey === 'FAILED' || g.machineRecomputation === 'FAIL' || g.lineage === 'FAIL' || g.learnerTextLeakage === 'FAIL';
export const rejectedByValidatorR5 = (g: GatesR5): boolean => g.structural === 'FAIL' || g.answerKey === 'KEY_CONTRADICTED' || g.lineage === 'FAIL' || g.learnerTextLeakage === 'FAIL';

export const R5_CHANGE_LOG = [
  { id: 'A1', area: 'ANSWER_KEY', kind: 'TIGHTENS', change: 'A key is verified only by recomputation from learner-visible text. Agreement with the generator\'s declared parameters, target or arithmetic verifies nothing.', evidence: 'c250-070: wrong key (120; the stem gives 16.875) classed MACHINE_VERIFIED by revision 4 from the declared parameters.' },
  { id: 'A2', area: 'ANSWER_KEY', kind: 'RELAXES', change: 'A key is not failed because it disagrees with the quantity the generator DECLARED as target, or with the generator\'s declared arithmetic. The disagreement becomes a declaration flag.', evidence: 'c250-004, 079, 090 (key is y at a stated x; revision 4 compared it with the intercept); c250-048 (key 13254 is right; the declared expression gives 4816.5).' },
  { id: 'A3', area: 'ANSWER_KEY', kind: 'RECLASSIFIES', change: 'Sign, percent-unit and rounding differences are REPRESENTATION_DIFFERENCE with their subtype, not a failed key. Rounding to a whole number counts only when the text asks for rounding.', evidence: 'c250-146 (0.5 against -0.5), c250-153 (2.5 percentage points against 0.025), c250-194 (0.321 against 0.3214...).' },
  { id: 'A4', area: 'ANSWER_KEY', kind: 'RECLASSIFIES', change: 'New classes. STEM_CONSISTENT (the key is a quantity the stem determines, the asked quantity was not read) and UNVERIFIED are not verifications; where no reader exists the class is UNVERIFIED.', evidence: 'Revision 4 verified 139 of 221 keys, all through declarations.' },
  { id: 'B1', area: 'OPTIONS', kind: 'RELAXES', change: 'Options that are equations are compared as equations: different lines are different options even when they share a number.', evidence: 'c250-019: y = x - 4 and y = -x + 4 failed as "the same number"; the key is correct.' },
  { id: 'B2', area: 'OPTIONS', kind: 'TIGHTENS', change: 'Two options that are equivalent equations (reordered, scaled, fraction or decimal) are the same option.', evidence: 'No Canary case; the counterpart of B1, with synthetic fixtures.' },
  { id: 'C1', area: 'ORIGINALITY', kind: 'RELAXES', change: 'Scenario similarity is not applied to ABSTRACT items.', evidence: '66 items carried near-duplicate-scenario findings; framing sentences such as "In the coordinate plane, two points are A(..) and B(..)" score 1.0 against their siblings.' },
  { id: 'C2', area: 'ORIGINALITY', kind: 'RECLASSIFIES', change: 'Three notions. Only MATERIAL_DUPLICATE fails; a shared parameter pair alone, a near-duplicate scenario alone, and textual similarity in the review band are reported signals.', evidence: 'Orchestrator instruction; 57 items failed revision 4 on originality alone. The QB-R2E pair 06 a2 / 07 (scenario AND shared pair) is still a material duplicate.' },
  { id: 'D1', area: 'PROFILE', kind: 'RECLASSIFIES', change: 'PARAMETER_NOT_OF_THE_CONSTRUCT, WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS and ITEM_DOES_NOT_SAY_WHICH_STIMULUS_VALUES_IT_USES go to a non-blocking DECLARATION_QUALITY channel.', evidence: '31 and 26 Canary items; neither is visible to a learner or a marker.' },
  { id: 'T1', area: 'CONSTRUCT', kind: 'TIGHTENS', change: 'A linear-model item whose keyed value is a cell of the stimulus table in the row the question names fails construct preservation.', evidence: 'c250-122: the fare for 7 km is in the table; revision 4 passed it, the AI reviewer rejected it.' },
  { id: 'T2', area: 'STIMULUS', kind: 'TIGHTENS', change: 'A stimulus whose text states a count of what a table column counts, when the column adds up to another number, fails stimulus integrity.', evidence: 'c250-211: "6 invitados", table sums to 13; a revision-4 strict pass.' },
] as const;
