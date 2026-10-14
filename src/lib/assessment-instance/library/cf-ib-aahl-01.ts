/**
 * CF-IB-AAHL-01 -- the Content Factory constructs Track B ADOPTS for IB Mathematics: analysis and approaches HL.
 *
 * The package (docs/exams/content-factory/CF-IB-AAHL-01, sha256 678741c9...) proposes ten PARAMETRIC_DETERMINISTIC
 * constructs. Track B adopts a construct only when EVERY governance prerequisite exists in the repository:
 *   - its canonical concept is governed and established as assessed by the target component (applicability register);
 *   - a CERTIFIED blueprint bucket of that component places the concept;
 *   - its envelope and core pass the object governance (v52/object-governance.ts).
 * Concept and bucket prerequisites exist for exactly ONE construct: QUADRATIC_MINIMUM_VALUE (concept
 * `math.alg.quadratics`, bucket `v2.ib.math-aa-hl/p1/aahl.p1.functions#0`, human-certified D02). The other nine name
 * concepts that no governed source backs (`math.ib.*`, PROPOSED_NOT_GOVERNED) and buckets that are not certified.
 *
 * EVEN THAT ONE IS NOT ADOPTED into the live library: the package renders NUMERIC_ENTRY, and the governed IB AA HL P1
 * adapter offers MATH_EXPRESSION / SHORT_RESPONSE / EXTENDED_RESPONSE only. Composition refuses every candidate
 * (RESPONSE_FORMAT_NOT_ALLOWED). It is kept here as an EVALUATED entry (`CF_QUADRATIC_MINIMUM_ENTRY`), registered
 * nowhere, so the refusal is reproducible (docs/audits/exam-bank/IB_DELIVERY_BRIDGE.md).
 *
 * The construct code is the Content Factory's, copied unchanged (scripts/content-factory/ib-aahl-01/constructs.ts,
 * QUADRATIC_MINIMUM_VALUE and the helpers it uses). Nothing is authored here: the core family records what the
 * construct already states. Seeds: a candidate of the package is rendered again from ITS parameter set
 * (`@rk=<recognitionKey>`), so an adopted instance is exactly the candidate the package delivered.
 */
import { constructCoreOf, type ConstructCoreRecord } from '../construct-core';
import { RendererEnvelopeSchema, type RendererEnvelope } from '../renderer-envelope';
import { parametricStrategy, rational, sameRational, writeRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';
import type { LibraryEntry } from './catalogue';
import { CF_QUADRATIC_MINIMUM_SEEDS } from './cf-ib-aahl-01.seeds';

export const CF_IB_AAHL_01 = { batchId: 'CF-IB-AAHL-01', packageSha256: '678741c9d6423e6e328847979bf8ca60358bcc944a2d42258f099604c6e659a8', sourceBaselineSha: '610d3c6' } as const;

// ------------------------------------------------------------------ Content Factory code, unchanged (helpers)
const R = (n: number, d = 1): Rational => rational(n, d);
const add = (a: Rational, b: Rational): Rational => R(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational): Rational => R(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational): Rational => R(a.n * b.n, a.d * b.d);
const fromInt = (n: number): Rational => R(n);
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
const keyOf = (c: { answer(p: never): string }, p: unknown): Rational => { const t = c.answer(p as never); const m = /^(-?\d+)\/(\d+)$/.exec(t); if (m) return R(Number(m[1]), Number(m[2])); const dec = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t)!; const s = 10 ** (dec[3]?.length ?? 0); return R((dec[1] ? -1 : 1) * (Number(dec[2]) * s + Number(dec[3] ?? 0)), s); };
const decimalIsAmbiguous = (k: Rational): boolean => { let d = k.d; while (d % 2 === 0) d /= 2; while (d % 5 === 0) d /= 5; if (d !== 1 || k.d === 1) return false; const s = (Math.abs(k.n) / k.d).toString(); const [ip, fp] = s.split('.'); return ip !== '0' && fp?.length === 3; };
const withoutCollisions = <P extends Record<string, number | string>>(c: Pick<ParametricConstruct<P>, 'answer' | 'misconceptionAnswers'>, sets: P[]): P[] => sets.filter((p) => { const key = keyOf(c as never, p); return !decimalIsAmbiguous(key) && !c.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, key)); });
const SUP: Record<number, string> = { 2: '²', 3: '³' };
function poly(coeffs: readonly number[], v = 'x'): string {
  const deg = coeffs.length - 1; const out: string[] = [];
  coeffs.forEach((c, i) => {
    if (c === 0) return;
    const e = deg - i; const abs = Math.abs(c);
    const body = e === 0 ? String(abs) : `${abs === 1 ? '' : abs}${v}${e === 1 ? '' : SUP[e]}`;
    out.push(out.length === 0 ? (c < 0 ? `−${body}` : body) : `${c < 0 ? '−' : '+'} ${body}`);
  });
  return out.length ? out.join(' ') : '0';
}
const evalPoly = (coeffs: readonly number[], x: Rational): Rational => coeffs.reduce<Rational>((acc, c) => add(mul(acc, x), fromInt(c)), fromInt(0));

// ------------------------------------------------------------------ QUADRATIC_MINIMUM_VALUE (Content Factory, unchanged)
export interface QminParameters extends Record<string, number | string> { a: number; b: number; c: number }
const qminValue = (x: QminParameters): Rational => sub(fromInt(x.c), R(x.b * x.b, 4 * x.a));
const qminBand = (band: PlanningBand, x: QminParameters): string[] => {
  const i: string[] = []; const n = need(i);
  const h = R(-x.b, 2 * x.a); const m = qminValue(x);
  n(band === 'FOUNDATIONAL' ? x.a === 1 && h.d === 1 : band === 'STANDARD' ? x.a >= 2 && h.d === 1 : x.a >= 2 && h.d > 1, 'VERTEX_NOT_IN_THE_BANDS_FORM');
  n(m.n > 0 && (band === 'CHALLENGE' || m.d === 1), 'MINIMUM_NOT_POSITIVE_OR_NOT_IN_THE_BANDS_FORM');
  n(x.b !== 0, 'NO_LINEAR_TERM');
  return i;
};
export const QUADRATIC_MINIMUM_VALUE: ParametricConstruct<QminParameters> = {
  construct: 'QUADRATIC_MINIMUM_VALUE', rendererVersion: 'cf.ib.quadratic-minimum-value@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: QminParameters[] = [];
    for (const a of band === 'FOUNDATIONAL' ? [1] : [2, 3, 4]) for (let b = -16; b <= 16; b++) for (let c = 1; c <= 40; c++) { const x = { a, b, c }; if (qminBand(band, x).length === 0) out.push(x); }
    return withoutCollisions(this, out);
  },
  bandIssues: qminBand,
  present: (x) => `Let f(x) = ${poly([x.a, x.b, x.c])}, x ∈ ℝ. Find the minimum value of f(x).`,
  answer: (x) => writeRational(qminValue(x)),
  keyHolds: (x, key) => sameRational(evalPoly([x.a, x.b, x.c], R(-x.b, 2 * x.a)), key) && key.n > 0,
  misconceptionAnswers: (x) => [
    { id: 'gives-the-x-coordinate-of-the-vertex', value: R(-x.b, 2 * x.a) },
    { id: 'gives-the-y-intercept', value: fromInt(x.c) },
    { id: 'adds-the-square-term', value: add(fromInt(x.c), R(x.b * x.b, 4 * x.a)) },
  ],
  recognitionKey: (x) => `${x.a}|${x.b}|${x.c}`,
};

// ------------------------------------------------------------------ the core this construct is the deterministic renderer of
const CORE_VERSION = '0.1.0-cf.1';
const built = constructCoreOf({
  family: {
    v: 1, familyId: 'tf.math.quadratic.minimum-value', version: CORE_VERSION, familyType: 'MATH_PROBLEM', canonicalSubject: 'Mathematics',
    primaryConcepts: [{ stableId: 'math.alg.quadratics', canonicalSubject: 'Mathematics', canonicalName: 'Quadratic functions and inequalities' }],
    targetSkills: ['Algebraic reasoning'], targetCompetencies: ['dev.comp.math-reasoning'],
    evidenceTarget: { actions: ['COMPUTE'], object: 'A quadratic function f(x) = ax² + bx + c with a > 0 and integer coefficients, given by its expression.', observablePerformance: 'Locates the vertex of the parabola and evaluates the function there to give its minimum value.' },
    supportedContexts: [{ kind: 'ABSTRACT', note: 'The function is given directly, with no situation.' }],
    difficultyLevers: [{ lever: 'leading-coefficient', kind: 'STEPS', description: 'Whether a = 1 or a >= 2 (the vertex abscissa needs a division).' }, { lever: 'vertex-form', kind: 'NUMERIC', description: 'Whether the vertex abscissa and the minimum are integers or fractions.' }],
    commonMisconceptions: ['Gives the x-coordinate of the vertex instead of the minimum value.', 'Gives the y-intercept c.', 'Adds the square term when completing the square.'],
    responseConstraints: { allowedFormats: ['NUMERIC_ENTRY', 'SHORT_RESPONSE'], stimulusNeed: 'NONE', stimulusKinds: [], note: 'A produced value; no candidate value is offered.' },
    profileSupport: { IB: { status: 'SUPPORTED' } },
    provenance: { authoredBy: 'STUDYUS', authoringKind: 'STUDYUS_GENERATED', authoredAt: '2026-10-14T00:00:00Z', referenceSourceKeys: ['studyus.content-factory.cf-ib-aahl-01'], containsCopiedProtectedExpression: false, note: 'Content Factory CF-IB-AAHL-01: deterministic construct written in-session by the model; reviewed by nobody. Adopted by Track B unchanged.' },
    lifecycle: 'IN_REVIEW', reviewStatus: 'IN_REVIEW',
    specialization: {
      mathematicalStructure: { construct: 'QUADRATIC_MINIMUM_VALUE', description: 'f(x) = ax² + bx + c with integer a >= 1, b != 0, c > 0; the minimum is f(-b/2a) = c - b²/4a > 0.' },
      variables: [{ symbol: 'a', meaning: 'Leading coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Linear coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Constant term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'm', meaning: 'The minimum value', role: 'UNKNOWN', domain: 'RATIONAL' }],
      parameterRanges: [{ symbol: 'a', min: 1, max: 4, step: 1, note: null }, { symbol: 'b', min: -16, max: 16, step: 1, note: 'Never 0.' }, { symbol: 'c', min: 1, max: 40, step: 1, note: null }],
      relationships: ['m = c - b^2 / (4a)', 'the vertex is at x = -b / (2a)'],
      constraints: ['a >= 1, so the parabola opens upwards and has a minimum.', 'b is never 0.', 'The minimum is positive.'],
      validSolutionRules: ['The keyed value is f at the vertex, in lowest terms.', 'The keyed value is never what a modelled misconception gives.'],
      misconceptionModels: [{ id: 'gives-the-x-coordinate-of-the-vertex', description: 'Gives -b/2a.', producesError: '-b / (2a)' }, { id: 'gives-the-y-intercept', description: 'Gives f(0).', producesError: 'f(0) = c' }, { id: 'adds-the-square-term', description: 'Completes the square with the wrong sign.', producesError: 'c + b^2 / (4a)' }],
      numericalDifficultyLevers: [{ lever: 'leading-coefficient', kind: 'STEPS', FOUNDATIONAL: 'a = 1, integer vertex.', STANDARD: 'a >= 2, integer vertex abscissa.', CHALLENGE: 'a >= 2, fractional vertex abscissa; the minimum may be a fraction.' }],
      calculatorDependency: 'NONE',
    },
  },
  shortcutConstraints: [
    { id: 'vertex-coordinate-confusion', bypass: 'When -b/2a equals the minimum value, a learner who gives the vertex abscissa is marked right.', excludedFormats: ['SELECTED_RESPONSE'], instanceRule: 'The keyed minimum is never -b/2a, c, or c + b²/4a (withoutCollisions).' },
  ],
});
if (!built.ok) throw new Error(`CF_IB_AAHL_01_CORE_INVALID: ${built.issue} ${built.details.join('; ')}`);
export const CORE_QUADRATIC_MINIMUM: ConstructCoreRecord = built.core;

const parsed = RendererEnvelopeSchema.safeParse({
  v: 1, rendererVersion: QUADRATIC_MINIMUM_VALUE.rendererVersion, strategy: 'PARAMETRIC_DETERMINISTIC', construct: QUADRATIC_MINIMUM_VALUE.construct, constructFamilyId: CORE_QUADRATIC_MINIMUM.constructFamilyId, constructFamilyVersion: CORE_QUADRATIC_MINIMUM.familyVersion,
  adapterIds: ['IB.MATH_AA_HL.P1'], languages: ['en'], responseFormats: ['NUMERIC_ENTRY'], commandTerms: [],
  parameterRanges: [{ symbol: 'a', min: 1, max: 4, step: 1 }, { symbol: 'b', min: -16, max: 16, step: 1 }, { symbol: 'c', min: 1, max: 40, step: 1 }],
  bands: [
    { planningBand: 'FOUNDATIONAL', itemDifficulty: 2, leverSettings: ['a = 1.', 'Integer vertex abscissa and integer minimum.'] },
    { planningBand: 'STANDARD', itemDifficulty: 3, leverSettings: ['a from 2 to 4.', 'Integer vertex abscissa and integer minimum.'] },
    { planningBand: 'CHALLENGE', itemDifficulty: 4, leverSettings: ['a from 2 to 4.', 'Fractional vertex abscissa.'] },
  ],
  stimulusKinds: [], exclusions: ['Minimum value only: the vertex coordinates, the axis of symmetry and the range are not asked.', 'Positive minima only.'],
});
if (!parsed.success) throw new Error(`CF_IB_AAHL_01_ENVELOPE_INVALID: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
export const ENVELOPE_QUADRATIC_MINIMUM: RendererEnvelope = parsed.data;

export const REASONING_QUADRATIC_MINIMUM = {
  minimumSuccessfulPath: ['Find the abscissa of the vertex, x = -b/(2a).', 'Evaluate f there (or complete the square) to obtain the minimum value.'],
  supportedStrategies: ['VERTEX_FORMULA', 'COMPLETING_THE_SQUARE', 'DERIVATIVE_ZERO'], requiredObservableMethod: null,
} as const;

/** The seed of a package candidate: it names the candidate and the parameter set the renderer must use. */
export const cfSeedOf = (candidateId: string, recognitionKey: string): string => `${CF_IB_AAHL_01.batchId}/${candidateId}@rk=${recognitionKey}`;

/** The evaluated (NOT registered) library entry: what adoption would be, if the IB adapter offered its format. */
export const CF_QUADRATIC_MINIMUM_ENTRY: LibraryEntry = {
  core: CORE_QUADRATIC_MINIMUM, envelope: ENVELOPE_QUADRATIC_MINIMUM, construct: QUADRATIC_MINIMUM_VALUE as unknown as ParametricConstruct, strategy: parametricStrategy(QUADRATIC_MINIMUM_VALUE),
  targets: [{ adapterId: 'IB.MATH_AA_HL.P1', language: 'en', responseFormat: 'NUMERIC_ENTRY' }], reasoning: REASONING_QUADRATIC_MINIMUM, challengeMechanisms: ['NON_OBVIOUS_STRATEGY'], origin: 'CF_PACKAGE', packageSeeds: CF_QUADRATIC_MINIMUM_SEEDS,
};
