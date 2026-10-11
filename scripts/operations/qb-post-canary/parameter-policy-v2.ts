/**
 * POST-CANARY -- PARAMETER POLICY AND TYPED SLOT GUIDANCE, VERSION 2 (pure). FOR FUTURE RUNS.
 *
 * Two defects of the Canary's slot guidance (version 1):
 *   1. it pinned ONE parameter and left the rest to the provider. For the optimum construct that pushed the vertex
 *      off a clean value (slot 226: vertex 49/3, keyed as 16), and four maxima were wrong. Version 2 pins a WHOLE
 *      parameter set wherever the construct has a solvability constraint, built so that the constraint holds.
 *   2. it was untyped. "categories: 6" was read as "6 guests" (slot 211). In version 2 every pinned value carries
 *      the ROLE it must play, the display description is a separate member, and `pinnedRoleIssues` checks the role.
 */
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';

export const PARAMETER_POLICY_V2 = { id: 'studyus-slot-parameter-policy', version: '2' } as const;
export interface PinnedValue { parameter: string; value: number; role: string }
export interface TypedSlotGuidance { policy: typeof PARAMETER_POLICY_V2; scenarioDomain: string | null; pinned: PinnedValue[]; guarantees: string[]; display: { numberOfCategories: number; categoriesMeans: string; verdictTheDisplayMustGive: 'SUPPORTED' | 'CONTRADICTED' | 'NOT_DECIDABLE' } | null }
const pin = (parameter: string, value: number, role: string): PinnedValue => ({ parameter, value, role });

/** (p + q x)(r - s x) with an INTEGER vertex inside the range and both factors positive there. By construction: p = q a, r = s (2 t + a), so the vertex is t. */
export function cleanOptimum(n: number): { p: number; q: number; r: number; s: number; xv: number; Qv: number } {
  const q = 1 + (n % 5), s = 1 + (Math.floor(n / 5) % 4), a = 2 + (n % 7) + Math.floor(n / 20), t = 5 + ((n * 3) % 23);
  const p = q * a, r = s * (2 * t + a);
  return { p, q, r, s, xv: t, Qv: (p + q * t) * (r - s * t) };
}
/** Two points with integer coordinates whose line has a slope that is an integer or a half, and so an intercept that is an integer or a half. */
export function cleanLine(n: number): { x1: number; y1: number; x2: number; y2: number; slope: number; intercept: number } {
  const slopes = [2, -3, 1, -2, 3, -1, 0.5, -0.5, 4, -4, 1.5, -1.5];
  const slope = slopes[n % slopes.length], d = 2 * (1 + (Math.floor(n / slopes.length) % 3));
  const x1 = -8 + (n % 13) * 1, y1 = -9 + ((n * 5) % 19);
  return { x1, y1, x2: x1 + d, y2: y1 + slope * d, slope, intercept: y1 - slope * x1 };
}
/** Two distinct non-zero integer roots; the pair differs for different n below 150. */
export function cleanRoots(n: number): { r1: number; r2: number } {
  const pairs: Array<[number, number]> = [];
  for (let a = -9; a <= 9; a += 1) for (let b = a + 1; b <= 9; b += 1) if (a !== 0 && b !== 0) pairs.push([a, b]);
  pairs.sort((x, y) => (((x[0] + 9) * 31 + (x[1] + 9) * 17) % 23) - (((y[0] + 9) * 31 + (y[1] + 9) * 17) % 23) || x[0] - y[0] || x[1] - y[1]);
  const [r1, r2] = pairs[n % pairs.length];
  return { r1, r2 };
}
/** a : b = c : x with a whole unit value, so the missing value is whole. */
export function cleanProportion(n: number): { a: number; b: number; c: number; x: number } {
  const a = 3 + n, unit = 2 + (n % 9), c = a + 2 + ((n * 7) % 17);
  return { a, b: a * unit, c, x: c * unit };
}
const VERDICTS = ['SUPPORTED', 'CONTRADICTED', 'NOT_DECIDABLE'] as const;
/** The typed guidance of the n-th slot of a construct. */
export function typedGuidance(construct: string, n: number, scenarioDomain: string | null): TypedSlotGuidance {
  const base = { policy: PARAMETER_POLICY_V2, scenarioDomain, display: null };
  switch (construct) {
    case 'QUADRATIC_MODEL_VERTEX_OPTIMUM': { const o = cleanOptimum(n); return { ...base, pinned: [pin('p', o.p, 'the starting value of the factor that increases'), pin('q', o.q, 'the increase of that factor per unit of x'), pin('r', o.r, 'the starting value of the factor that decreases'), pin('s', o.s, 'the decrease of that factor per unit of x')], guarantees: [`the optimum is at x = ${o.xv}, a whole number`, `the optimal value is ${o.Qv}`, 'both factors are positive at the optimum'] }; }
    case 'LINE_THROUGH_TWO_POINTS': { const l = cleanLine(n); return { ...base, pinned: [pin('x1', l.x1, 'the x-coordinate of the first point'), pin('y1', l.y1, 'the y-coordinate of the first point'), pin('x2', l.x2, 'the x-coordinate of the second point'), pin('y2', l.y2, 'the y-coordinate of the second point')], guarantees: [`the slope is ${l.slope}`, `the y-intercept is ${l.intercept}`] }; }
    case 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING': { const r = cleanRoots(n); return { ...base, pinned: [pin('r1', r.r1, 'one root of the equation -- never written in the item'), pin('r2', r.r2, 'the other root of the equation -- never written in the item')], guarantees: ['the equation is given expanded, never factorised', 'the roots are distinct non-zero integers'] }; }
    case 'DIRECT_PROPORTION_MISSING_VALUE': { const p = cleanProportion(n); return { ...base, pinned: [pin('a', p.a, 'the known amount of the first quantity'), pin('b', p.b, 'the amount of the second quantity that corresponds to a'), pin('c', p.c, 'the amount of the first quantity whose corresponding value is asked')], guarantees: [`the missing value is ${p.x}, a whole number`] }; }
    case 'CLASSICAL_PROBABILITY_SINGLE_DRAW': return { ...base, pinned: [pin('n', 6 + n, 'the number of equally likely outcomes')], guarantees: [] };
    case 'COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES': return { ...base, pinned: [pin('n1', 8 + n, 'the number of equally likely outcomes of the first option')], guarantees: [] };
    case 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS': return { ...base, pinned: [pin('p1', 2 + n, 'the amount paid or used in the first option')], guarantees: [] };
    case 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE': return { ...base, pinned: [pin('m', 2 + n, 'the constant rate of change per unit of x')], guarantees: [] };
    case 'RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES': return { ...base, pinned: [pin('vi', 40 + 12 * n, 'the tabulated value the change is measured from')], guarantees: [] };
    case 'CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY': return { ...base, pinned: [], guarantees: [], display: { numberOfCategories: 3 + (Math.floor(n / 3) % 4), categoriesMeans: 'the number of ROWS (categories) of the display. It is not a count of people or things in the situation and is never written as one.', verdictTheDisplayMustGive: VERDICTS[n % 3] } };
    default: throw new Error(`NO_PARAMETER_POLICY_FOR_CONSTRUCT: ${construct}`);
  }
}
const numbersIn = (text: string): number[] => [...text.replace(/[−–]/g, '-').matchAll(/(?<![\p{L}\d.])(?!(?<=\d,)\d)(-?\d+(?:[.,]\d+)?)/gu)].map((m) => Number(m[1].replace(',', '.')));
/** Is every pinned value used, visibly, and in the role intended? */
export function pinnedRoleIssues(c: SpecificationCandidate, stimulus: CandidateStimulus | null, g: TypedSlotGuidance): string[] {
  const out: string[] = [];
  const P = c.content.declaredModel.parameters;
  const stimulusText = (stimulus?.parts ?? []).filter((p) => p.partKind === 'TEXT').map((p) => p.text).join(' ');
  const visible = [...numbersIn(`${c.content.stem} ${stimulusText}`), ...((stimulus?.structured as { tables?: Array<{ rows: unknown[][] }> } | undefined)?.tables ?? []).flatMap((t) => t.rows.flat().filter((v): v is number => typeof v === 'number'))];
  for (const p of g.pinned) {
    if (typeof P[p.parameter] !== 'number' || Math.abs(P[p.parameter] - p.value) > 1e-9) out.push(`PINNED_VALUE_NOT_DECLARED_IN_ITS_ROLE:${p.parameter}=${p.value}`);
    // a root is pinned and must NOT be visible; every other pinned value must be
    const mustBeHidden = /never written/.test(p.role);
    if (!mustBeHidden && !visible.some((v) => Math.abs(v - p.value) < 1e-9)) out.push(`PINNED_VALUE_NOT_VISIBLE_IN_THE_ITEM:${p.parameter}=${p.value}`);
  }
  if (g.display) {
    const tables = ((stimulus?.structured as { tables?: Array<{ rows: unknown[][] }> } | undefined)?.tables ?? []);
    if (tables.length > 0 && tables[0].rows.length !== g.display.numberOfCategories) out.push(`DISPLAY_CATEGORIES_NOT_AS_PINNED:${tables[0].rows.length}/${g.display.numberOfCategories}`);
    // the number of categories written into the text as a quantity of the situation (the Canary's "6 guests")
    if (new RegExp(`(?<![\\d.,])${g.display.numberOfCategories}\\s+[\\p{L}]{4,}`, 'u').test(stimulusText) && !new RegExp(`${g.display.numberOfCategories}\\s+(categor|filas|rows|opciones|options|tipos|types|zonas|zones|grupos|groups)`, 'iu').test(stimulusText)) out.push(`DISPLAY_CATEGORY_COUNT_WRITTEN_AS_A_QUANTITY_OF_THE_SITUATION:${g.display.numberOfCategories}`);
  }
  return out;
}
