/**
 * IB Mathematics: analysis and approaches HL Paper 3 -- one StudyUs-original PARAMETRIC_DETERMINISTIC construct for the
 * governed objective aahl.p3.investigation ("Extended problem solving: conjecture, generalize and justify"), linked in
 * OBJECTIVE_LEARNING_LINKS to the canonical concept Sequences and series (pure data + pure functions, no IO, no provider).
 *
 *   aahl.p3.investigation  IB_P3_ARITHMETIC_SUM_INVESTIGATION  show the general sum of an arithmetic pattern, hence use it
 *
 * The learner is led through an investigation: the pattern is shown, the general result is to be SHOWN, and the "hence"
 * part asks for ONE exact integer, recomputed by `keyHolds` by adding the terms one at a time (no formula reused).
 */
import { rational, sameRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';

const R = (n: number, d = 1): Rational => rational(n, d);
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };

/**
 * A pattern of rows: the first row has a tiles and each row has d more tiles than the row before.
 *   TOTAL      (FOUNDATIONAL) the number of tiles in the first n rows
 *   ROWS_EXACT (STANDARD)     the number of rows that use exactly N tiles (N is a sum of the pattern)
 *   ROWS_EXCEED(CHALLENGE)    the least number of rows that use more than N tiles (N is not a sum of the pattern)
 */
export interface ArithmeticSumParameters extends Record<string, number | string> { ask: 'TOTAL' | 'ROWS_EXACT' | 'ROWS_EXCEED'; a: number; d: number; n: number; r: number }
const term = (x: ArithmeticSumParameters, k: number): number => x.a + (k - 1) * x.d;
const sum = (x: ArithmeticSumParameters, k: number): number => (k * (2 * x.a + (k - 1) * x.d)) / 2;
/** The N shown in a "hence find the rows" part: a sum of the pattern, or a sum plus r (strictly short of the next sum). */
const shownN = (x: ArithmeticSumParameters): number => (x.ask === 'ROWS_EXCEED' ? sum(x, x.n - 1) + x.r : sum(x, x.n));
const bandOf = (b: PlanningBand): ArithmeticSumParameters['ask'] => (b === 'FOUNDATIONAL' ? 'TOTAL' : b === 'STANDARD' ? 'ROWS_EXACT' : 'ROWS_EXCEED');
const sumBand = (band: PlanningBand, x: ArithmeticSumParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandOf(band) === x.ask, 'ASK_IS_NOT_THE_BANDS');
  n(x.a >= 2 && x.a <= 15 && x.d >= 2 && x.d <= 6 && x.a !== x.d, 'PATTERN_OUTSIDE_THE_ENVELOPE');
  n(x.n >= 6 && x.n <= 20, 'N_OUTSIDE_THE_ENVELOPE');
  // r only exists for ROWS_EXCEED: strictly between two consecutive sums
  n(x.ask === 'ROWS_EXCEED' ? x.r >= 0 && x.r < term(x, x.n) : x.r === 0, 'R_OUTSIDE_THE_ENVELOPE');
  return i;
};
/** The rows' first two terms and the general result the learner is asked to show. */
const pattern = (x: ArithmeticSumParameters): string => `A pattern is made of rows of tiles. The first row has ${x.a} tiles, the second row has ${x.a + x.d} tiles, the third row has ${x.a + 2 * x.d} tiles, and each row has ${x.d} more tiles than the row before. Show that the total number of tiles in the first n rows is (n/2)(${2 * x.a} + ${x.d}(n − 1)).`;

export const IB_P3_ARITHMETIC_SUM_INVESTIGATION: ParametricConstruct<ArithmeticSumParameters> = {
  construct: 'IB_P3_ARITHMETIC_SUM_INVESTIGATION', rendererVersion: 'tb.ib.p3-arithmetic-sum-investigation@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: ArithmeticSumParameters[] = [];
    const ask = bandOf(band);
    for (let a = 2; a <= 15; a++) for (let d = 2; d <= 6; d++) for (let n = 6; n <= 20; n++) {
      const rs = ask === 'ROWS_EXCEED' ? [1, Math.floor((a + (n - 1) * d) / 2)] : [0];
      for (const r of rs) { const x: ArithmeticSumParameters = { ask, a, d, n, r }; if (sumBand(band, x).length === 0) out.push(x); }
    }
    return out.filter((p) => { const k = R(Number(this.answer(p))); return k.n > 0 && !this.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, k)); });
  },
  bandIssues: sumBand,
  present: (x) => x.ask === 'TOTAL'
    ? `${pattern(x)} Hence find the total number of tiles in the first ${x.n} rows.`
    : x.ask === 'ROWS_EXACT'
      ? `${pattern(x)} Hence find the number of rows that use exactly ${shownN(x)} tiles in total.`
      : `${pattern(x)} Hence find the least number of rows that use more than ${shownN(x)} tiles in total.`,
  answer: (x) => String(x.ask === 'TOTAL' ? sum(x, x.n) : x.n),
  // by building the pattern row by row from the shown first terms (no closed form reused)
  keyHolds: (x, key) => {
    if (key.d !== 1 || key.n <= 0) return false;
    let total = 0; let row = x.a; let rows = 0;
    if (x.ask === 'TOTAL') { for (let k = 0; k < x.n; k++) { total += row; row += x.d; } return total === key.n; }
    const target = shownN(x);
    while (x.ask === 'ROWS_EXACT' ? total < target : total <= target) { total += row; row += x.d; rows += 1; }
    return (x.ask === 'ROWS_EXCEED' || total === target) && rows === key.n;
  },
  misconceptionAnswers: (x) => x.ask === 'TOTAL' ? [
    { id: 'gives-the-last-row', value: R(term(x, x.n)) },
    { id: 'ignores-the-common-difference', value: R(x.n * x.a) },
    { id: 'one-row-short', value: R(sum(x, x.n - 1)) },
    { id: 'uses-n-for-n-minus-one', value: R(x.n * (2 * x.a + x.n * x.d), 2) },
  ] : [
    { id: 'one-row-short', value: R(x.n - 1) },
    { id: 'divides-by-the-first-row', value: R(shownN(x), x.a) },
    { id: 'gives-the-last-row', value: R(term(x, x.n)) },
    { id: 'one-row-too-many', value: R(x.n + 1) },
  ],
  recognitionKey: (x) => `${x.ask}|${x.a}|${x.d}|${x.n}|${x.r}`,
};

export const IB_AAHL_P3_CONSTRUCTS = [IB_P3_ARITHMETIC_SUM_INVESTIGATION] as const;
