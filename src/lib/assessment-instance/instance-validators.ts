/**
 * QF V5.1 -- validators of a learner-facing instance against the construct it claims to manifest (pure, no IO).
 *
 * V5 asked "is the key right?" and "does a judge like it?". The human review of fifty V5 items (Human-50)
 * showed what that misses: items whose key is right and whose construct is sound, but which can be answered
 * WITHOUT the construct -- the correct option carries the worked arithmetic, one option contradicts itself, the
 * key is the only option with its polarity, a figure is described in words. These validators look for that.
 *
 *   CONSTRUCT_NECESSITY           does the learner have to execute the declared reasoning? Compares the INTENDED
 *                                 reasoning path with the MINIMUM SUCCESSFUL one.
 *   SHORTCUT_BYPASS               routes to the key that skip the construct. Independent of the ideal solution: it
 *                                 reads only what the learner sees.
 *   OPTION_STRUCTURAL_LEAKAGE     clues in the form of the options: polarity, length, precision, units, twins.
 *   DISTRACTOR_DIAGNOSTICITY      every distractor is the product of a named reasoning error.
 *   DISTRACTOR_COMPETITIVENESS    no distractor is impossible, self-contradictory or out of all proportion.
 *   REPRESENTATION_FIT            the representation matches the construct (a figure needs a diagram unless decoding
 *                                 words is the construct).
 *   DIFFICULTY (minimum path)     the tier follows the shortest route that succeeds, and a CHALLENGE needs a
 *                                 mechanism, not load.
 *   AUTHENTICITY (recalibrated)   conformance to the ADAPTER's norms, checked as facts; a judge's "medium" is not a
 *                                 defect when the item conforms.
 *
 * What these are, honestly: deterministic text rules, Spanish and English, written after reading fifty reviewed
 * items. They are a screen, not a judgement. Every finding names its rule, so a reviewer can disagree with it.
 * Nothing here calls a model.
 */
import type { AssessmentAdapter } from './assessment-adapter';

export const INSTANCE_VALIDATOR_VERSION = 'qf51-instance-validators-1.0.0';
export const VALIDATOR_NAMES = ['CONSTRUCT_NECESSITY', 'SHORTCUT_BYPASS', 'OPTION_STRUCTURAL_LEAKAGE', 'DISTRACTOR_DIAGNOSTICITY', 'DISTRACTOR_COMPETITIVENESS', 'REPRESENTATION_FIT', 'DIFFICULTY_MECHANISM', 'AUTHENTICITY'] as const;
export type ValidatorName = (typeof VALIDATOR_NAMES)[number];
export type FindingSeverity = 'REJECT' | 'REVIEW' | 'INFO';
export interface ValidatorFinding { validator: ValidatorName; code: string; severity: FindingSeverity; option: string | null; detail: string }

/** What makes an item hard for the right reason. Named on the core / specification; never inferred from length. */
export const DIFFICULTY_MECHANISMS = ['CONCEPT_INTEGRATION', 'DOMAIN_CONSTRAINT', 'NON_OBVIOUS_STRATEGY', 'MULTI_STAGE_DEPENDENCY', 'TRANSFER', 'COUNTERINTUITIVE_RESULT', 'DATA_DISCRIMINATION', 'EPISTEMIC_JUDGMENT', 'REPRESENTATION_TRANSFORMATION', 'MISCONCEPTION_RESISTANCE'] as const;
export type DifficultyMechanism = (typeof DIFFICULTY_MECHANISMS)[number];
export const TIERS = ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'] as const;
export type Tier = (typeof TIERS)[number];
export const REPRESENTATIONS = ['DIAGRAM', 'TABLE', 'GRAPH'] as const;
export type Representation = (typeof REPRESENTATIONS)[number];

/** Where a distractor comes from: construct core -> misconception model -> the wrong reasoning executed -> its answer. */
export interface DistractorLineage { misconceptionId: string | null; reasoningError: string; derivedAnswer: string | null }

export interface ValidatableItem {
  language: string;
  itemType: string;
  stimulus: string | null;
  prompt: string;
  options: readonly { label: string; text: string }[];
  correctOption: string | null;
  distractorLineage: Readonly<Record<string, DistractorLineage>>;
  /** Representations actually attached to the item (a table written in the text is detected, not declared). */
  assets: readonly Representation[];
}
export interface ConstructContext {
  /** The cognitive actions the construct core requires, in order: the INTENDED reasoning path. */
  intendedReasoningPath: readonly string[];
  difficultyMechanisms: readonly DifficultyMechanism[];
  intendedTier: Tier;
  requiredRepresentations: readonly Representation[];
  /** True only when reading a figure from words IS part of the construct. */
  verbalDecodingIntended: boolean;
}

// ------------------------------------------------------------------------------------------------- text helpers
const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s: string): string[] => fold(s).replace(/[^a-z0-9%]+/g, ' ').trim().split(' ').filter(Boolean);
/** Numbers as written values: "90.000" and "90,000" (thousands) are 90000; "1,25" and "1.25" are 1.25. */
export function numbersIn(text: string): string[] {
  const t = text.replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2').replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2');
  return (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(',', '.'))));
}
const jaccard = (a: string, b: string): number => { const x = new Set(words(a)); const y = new Set(words(b)); let both = 0; for (const w of x) if (y.has(w)) both += 1; return x.size + y.size - both ? both / (x.size + y.size - both) : 0; };
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stemOf = (item: ValidatableItem): string => `${item.stimulus ?? ''}\n${item.prompt}`;
const SELECTED = new Set(['SELECTED_RESPONSE', 'MULTI_SELECT']);

// A verdict is what an option says about a claim: it holds / it does not. Read from the first clause, else the last.
const NEGATIVE = /\b(no (es|se|alcanza|permite|puede|basta)|not|inval\w*|incorrect\w*|fals[oa]s?|false|refuta\w*|refuted|wrong|erron\w*)\b/;
const POSITIVE = /\b(valid[oa]?s?|valida|correct[oa]?s?|verdader[oa]s?|true|si (alcanza|es|se)|yes|cierta?)\b/;
const clauses = (text: string): string[] => fold(text).split(/[:;,]| porque | because | pues | since /).map((c) => c.trim()).filter(Boolean);
export type Polarity = 'POSITIVE' | 'NEGATIVE';
const polarityOfClause = (c: string): Polarity | null => (NEGATIVE.test(c) ? 'NEGATIVE' : POSITIVE.test(c) ? 'POSITIVE' : null);
/** The verdict an option gives and where it stands: `leading` when it opens the option (verdict, then justification). */
export function verdictOf(optionText: string): { polarity: Polarity; leading: boolean } | null {
  const cs = clauses(optionText);
  if (!cs.length) return null;
  const first = polarityOfClause(cs[0]);
  if (first) return { polarity: first, leading: true };
  const last = polarityOfClause(cs[cs.length - 1]);
  return last ? { polarity: last, leading: false } : null;
}
/** What follows the verdict clause of an option: the justification the learner is handed. */
const justificationOf = (optionText: string): string => { const i = optionText.search(/[:;,]| porque | because | pues | since /i); return i < 0 ? '' : optionText.slice(i + 1); };

// ----------------------------------------------------------------------------------------------- SHORTCUT_BYPASS
const COST = /(?:plan|opci[oó]n|servicio|proveedor|option|provider|tarifa)?\s*\b([A-Z])\b\s+(?:cuesta|costs?|vale)\s+\$?\s*([\d.,]+)|\b([A-Z])\b\s+\$\s*([\d.,]+)/g;
const CHEAPER = /\b([A-Z])\b\s+(?:es|resulta|is|sale)\s+(mas barato|mas economico|cheaper|mas caro|more expensive|mas costoso)/;
/** An option that states two costs and then concludes the opposite of what they show. */
function selfContradiction(optionText: string): string | null {
  const split = optionText.search(/por tanto|por lo tanto|therefore|so,|entonces|luego/i);
  if (split < 0) return null;
  const premise = optionText.slice(0, split);
  const values = new Map<string, number>();
  for (const m of premise.matchAll(COST)) { const who = m[1] ?? m[3]; const n = numbersIn(m[2] ?? m[4])[0]; if (who && n !== undefined && !values.has(who)) values.set(who, Number(n)); }
  if (values.size !== 2) return null;
  const conclusion = CHEAPER.exec(optionText.slice(split).normalize('NFKD').replace(/[̀-ͯ]/g, ''));
  if (!conclusion || !values.has(conclusion[1])) return null;
  const [mine, other] = [values.get(conclusion[1])!, [...values.entries()].find(([k]) => k !== conclusion[1])![1]];
  const saysCheaper = /barato|economico|cheaper/.test(conclusion[2]);
  return (saysCheaper ? mine > other : mine < other) ? `it states ${mine} and ${other}, then concludes ${conclusion[1]} is ${saysCheaper ? 'cheaper' : 'dearer'}` : null;
}

export function shortcutBypassFindings(item: ValidatableItem): ValidatorFinding[] {
  if (!SELECTED.has(item.itemType) || !item.correctOption) return [];
  const f: ValidatorFinding[] = [];
  const add = (code: string, severity: FindingSeverity, option: string | null, detail: string) => f.push({ validator: 'SHORTCUT_BYPASS', code, severity, option, detail });
  const key = item.options.find((o) => o.label === item.correctOption);
  if (!key) return f;
  const given = new Set(numbersIn(stemOf(item)));
  const derived = (text: string): string[] => numbersIn(text).filter((n) => !given.has(n));
  const verdicts = item.options.map((o) => verdictOf(o.text));
  // An evaluate-the-claim item: every option is a verdict followed by its justification.
  const evaluateClaim = item.options.length >= 3 && verdicts.every((v) => v?.leading);
  if (evaluateClaim && numbersIn(justificationOf(key.text)).length > 0) {
    add('KEY_STATES_THE_RESULT', 'REVIEW', key.label, 'the correct verdict is followed by the numbers that settle the claim: the learner can check them instead of deriving them');
  }
  const mine = derived(key.text).length;
  const others = Math.max(0, ...item.options.filter((o) => o !== key).map((o) => derived(o.text).length));
  if (mine >= 3 && mine - others >= 2) add('KEY_EXPOSES_THE_WORKING', 'REVIEW', key.label, `the key carries ${mine} computed values; no other option carries more than ${others}`);
  for (const o of item.options) {
    const why = selfContradiction(o.text);
    if (!why) continue;
    if (o === key) add('KEY_CONTRADICTS_ITSELF', 'REJECT', o.label, why);
    else add('OPTION_ELIMINATED_BY_ITS_OWN_CONTRADICTION', 'REVIEW', o.label, `${why}: it can be discarded by reading, without the construct`);
  }
  return f;
}

// ------------------------------------------------------------------------------------- OPTION_STRUCTURAL_LEAKAGE
export function optionLeakageFindings(item: ValidatableItem): ValidatorFinding[] {
  if (!SELECTED.has(item.itemType) || !item.correctOption) return [];
  const f: ValidatorFinding[] = [];
  const add = (code: string, severity: FindingSeverity, option: string | null, detail: string) => f.push({ validator: 'OPTION_STRUCTURAL_LEAKAGE', code, severity, option, detail });
  const key = item.options.find((o) => o.label === item.correctOption);
  if (!key) return f;
  const others = item.options.filter((o) => o !== key);
  const verdicts = item.options.map((o) => verdictOf(o.text));
  if (item.options.length >= 3 && verdicts.every((v) => v !== null)) {
    const mine = verdicts[item.options.indexOf(key)]!.polarity;
    if (verdicts.filter((v) => v!.polarity === mine).length === 1) add('KEY_IS_THE_ONLY_OPTION_WITH_ITS_POLARITY', 'REVIEW', key.label, `one option is ${mine}, ${others.length} are not: the odd one out is the key`);
  }
  const med = median(others.map((o) => o.text.length));
  if (key.text.length >= 24 && key.text.length > 1.6 * med) add('KEY_LENGTH_OUTLIER', 'REVIEW', key.label, `${key.text.length} characters against a median of ${med}`);
  const decimals = (t: string): boolean => /\d[.,]\d{1,2}(?!\d)/.test(t.replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2'));
  const numeric = item.options.every((o) => numbersIn(o.text).length > 0);
  if (numeric && decimals(key.text) && others.every((o) => !decimals(o.text))) add('KEY_HAS_UNIQUE_PRECISION', 'REVIEW', key.label, 'only the key is written with decimals');
  const unit = (t: string): string => (/\d\s*([a-zA-Z%°µ²³/]+)\s*\.?$/.exec(t.trim())?.[1] ?? '');
  if (unit(key.text) && others.every((o) => unit(o.text) !== unit(key.text))) add('KEY_HAS_UNIQUE_UNIT', 'REVIEW', key.label, `only the key ends in ${unit(key.text)}`);
  for (let i = 0; i < item.options.length; i += 1) for (let j = i + 1; j < item.options.length; j += 1) if (fold(item.options[i].text).replace(/\s+/g, ' ') === fold(item.options[j].text).replace(/\s+/g, ' ')) add('DUPLICATED_OPTIONS', 'REJECT', item.options[j].label, `same text as ${item.options[i].label}`);
  return f;
}

// ----------------------------------------------------------------------------------------------- DISTRACTORS
export function distractorFindings(item: ValidatableItem, opts: { lineageRequired: boolean }): ValidatorFinding[] {
  if (!SELECTED.has(item.itemType) || !item.correctOption) return [];
  const f: ValidatorFinding[] = [];
  const distractors = item.options.filter((o) => o.label !== item.correctOption);
  const key = item.options.find((o) => o.label === item.correctOption);
  const seen = new Map<string, string>();
  for (const d of distractors) {
    const l = item.distractorLineage[d.label];
    if (!l || !l.reasoningError.trim()) { f.push({ validator: 'DISTRACTOR_DIAGNOSTICITY', code: 'DISTRACTOR_HAS_NO_REASONING_ERROR', severity: 'REVIEW', option: d.label, detail: 'no error of reasoning is named for this option: choosing it diagnoses nothing' }); continue; }
    if (opts.lineageRequired && !l.misconceptionId) f.push({ validator: 'DISTRACTOR_DIAGNOSTICITY', code: 'DISTRACTOR_NOT_FROM_A_MISCONCEPTION_MODEL', severity: 'REVIEW', option: d.label, detail: 'the error is described but is not a misconception of the construct core' });
    const k = fold(l.reasoningError).replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(k)) f.push({ validator: 'DISTRACTOR_DIAGNOSTICITY', code: 'TWO_DISTRACTORS_DIAGNOSE_THE_SAME_ERROR', severity: 'REVIEW', option: d.label, detail: `same reasoning error as ${seen.get(k)}` });
    seen.set(k, d.label);
    if (l.derivedAnswer !== null) {
      const stated = numbersIn(d.text)[0]; const derived = numbersIn(l.derivedAnswer)[0];
      if (stated !== undefined && derived !== undefined && stated !== derived) f.push({ validator: 'DISTRACTOR_DIAGNOSTICITY', code: 'DISTRACTOR_IS_NOT_WHAT_THE_ERROR_PRODUCES', severity: 'REJECT', option: d.label, detail: `the error gives ${derived}; the option shows ${stated}` });
    }
  }
  // competitiveness: nothing here can be chosen by nobody
  const keyValue = key ? Number(numbersIn(key.text)[0]) : NaN;
  const bare = item.options.every((o) => /^[^a-zA-Z]*[\d.,]+[^\d]*$/.test(o.text.trim()) && numbersIn(o.text).length === 1);
  for (const d of distractors) {
    if (selfContradiction(d.text)) f.push({ validator: 'DISTRACTOR_COMPETITIVENESS', code: 'DISTRACTOR_REFUTES_ITSELF', severity: 'REVIEW', option: d.label, detail: 'its own numbers contradict its conclusion: no candidate who reads it chooses it' });
    const v = Number(numbersIn(d.text)[0]);
    if (bare && Number.isFinite(keyValue) && Number.isFinite(v) && keyValue !== 0 && (Math.abs(v / keyValue) >= 1000 || (v !== 0 && Math.abs(v / keyValue) <= 0.001))) f.push({ validator: 'DISTRACTOR_COMPETITIVENESS', code: 'DISTRACTOR_OUT_OF_ALL_PROPORTION', severity: 'REVIEW', option: d.label, detail: `${v} against a key of ${keyValue}` });
    if (bare && Number.isFinite(keyValue) && keyValue > 0 && /^\s*[-−]\s*\d/.test(d.text)) f.push({ validator: 'DISTRACTOR_COMPETITIVENESS', code: 'DISTRACTOR_HAS_AN_IMPOSSIBLE_SIGN', severity: 'REVIEW', option: d.label, detail: `${v}` });
  }
  // twins: two distractors that are one sentence with one word changed, unlike the key and the rest, leave fewer live options
  for (let i = 0; i < distractors.length; i += 1) for (let j = i + 1; j < distractors.length; j += 1) {
    const [a, b] = [distractors[i], distractors[j]];
    const rest = item.options.filter((o) => o !== a && o !== b);
    if (jaccard(a.text, b.text) >= 0.75 && rest.length > 0 && rest.every((o) => jaccard(o.text, a.text) < 0.5 && jaccard(o.text, b.text) < 0.5)) f.push({ validator: 'DISTRACTOR_COMPETITIVENESS', code: 'TWIN_DISTRACTORS', severity: 'REVIEW', option: b.label, detail: `${a.label} and ${b.label} are the same sentence with one term changed; they stand or fall together` });
  }
  return f;
}

// ------------------------------------------------------------------------------------------- REPRESENTATION_FIT
const SHAPES: readonly [string, RegExp][] = [
  ['triangle', /\btri[aá]ngul\w*|\btriang\w*/], ['rectangle', /\brect[aá]ngulo(?! en)\w*|\brectang\w*/], ['semicircle', /\bsemic[ií]rc\w*/], ['circle', /\b(c[ií]rcul\w*|circunferencia|circular|circle)\b/],
  ['quadrilateral', /\bcuadril[aá]ter\w*|\bquadrilateral\w*/], ['trapezium', /\btrapeci\w*|\btrapez\w*/], ['polygon', /\bpol[ií]gon\w*|\bpolygon\w*|\bhex[aá]gon\w*|\bpent[aá]gon\w*/],
  ['solid', /\b(cilindr\w*|cylinder|cono|cone|esfera|sphere|prisma|prism|pir[aá]mide|pyramid)\b/],
];
/** The shape families a text talks about. "triángulo rectángulo" is one triangle, not a triangle and a rectangle. */
export function shapesIn(text: string): string[] {
  const t = text.toLowerCase().replace(/tri[aá]ngulos? rect[aá]ngulos?/g, 'triángulo').replace(/right[- ]angled triangles?|right triangles?/g, 'triangle');
  return SHAPES.filter(([, re]) => re.test(t)).map(([name]) => name);
}
const hasTable = (text: string): boolean => /\|.*\|.*\n\s*\|[\s:|-]+\|/.test(text);

export function representationFindings(item: ValidatableItem, ctx: Pick<ConstructContext, 'requiredRepresentations' | 'verbalDecodingIntended'>): ValidatorFinding[] {
  const f: ValidatorFinding[] = [];
  const text = stemOf(item);
  const present = new Set<Representation>([...item.assets, ...(hasTable(text) ? (['TABLE'] as const) : [])]);
  for (const r of ctx.requiredRepresentations) if (!present.has(r)) f.push({ validator: 'REPRESENTATION_FIT', code: `REQUIRED_${r}_IS_MISSING`, severity: 'REVIEW', option: null, detail: `the construct needs a ${r.toLowerCase()} and the item has none` });
  const shapes = shapesIn(text);
  if (shapes.length >= 2 && !present.has('DIAGRAM') && !ctx.verbalDecodingIntended) f.push({ validator: 'REPRESENTATION_FIT', code: 'FIGURE_DESCRIBED_WITHOUT_A_DIAGRAM', severity: 'REVIEW', option: null, detail: `a composite figure (${shapes.join(', ')}) is given in words only: the item also measures decoding a description, which the construct does not ask for` });
  return f;
}

// ------------------------------------------------------------------------------------------ CONSTRUCT_NECESSITY
export interface NecessityResult { verdict: 'NECESSARY' | 'BYPASSABLE'; intendedReasoningPath: readonly string[]; minimumSuccessfulReasoningPath: readonly string[]; via: string[] }
/** The reasoning each bypass replaces the construct with. */
export const BYPASS_PATHS: Readonly<Record<string, readonly string[]>> = {
  KEY_STATES_THE_RESULT: ['VERIFY_GIVEN_ARITHMETIC'], KEY_EXPOSES_THE_WORKING: ['VERIFY_GIVEN_ARITHMETIC'], OPTION_ELIMINATED_BY_ITS_OWN_CONTRADICTION: ['ELIMINATE_BY_READING'],
  KEY_IS_THE_ONLY_OPTION_WITH_ITS_POLARITY: ['PICK_THE_ODD_ONE_OUT'], KEY_LENGTH_OUTLIER: ['PICK_THE_ODD_ONE_OUT'], KEY_HAS_UNIQUE_PRECISION: ['PICK_THE_ODD_ONE_OUT'], KEY_HAS_UNIQUE_UNIT: ['PICK_THE_ODD_ONE_OUT'],
  FORMAT_ADMITS_SUBSTITUTION: ['SUBSTITUTE_EACH_OPTION'], FIGURE_DESCRIBED_WITHOUT_A_DIAGRAM: ['DECODE_A_VERBAL_DESCRIPTION'],
};
/** A bypass that hands the key over leaves a shorter path; a figure in words ADDS an unintended step instead. */
const SHORTENING = new Set(['KEY_STATES_THE_RESULT', 'KEY_EXPOSES_THE_WORKING', 'KEY_IS_THE_ONLY_OPTION_WITH_ITS_POLARITY', 'KEY_LENGTH_OUTLIER', 'KEY_HAS_UNIQUE_PRECISION', 'KEY_HAS_UNIQUE_UNIT', 'FORMAT_ADMITS_SUBSTITUTION']);

export function constructNecessity(ctx: Pick<ConstructContext, 'intendedReasoningPath'>, findings: readonly ValidatorFinding[]): NecessityResult {
  const via = [...new Set(findings.filter((x) => x.severity !== 'INFO' && SHORTENING.has(x.code)).map((x) => x.code))];
  if (!via.length) return { verdict: 'NECESSARY', intendedReasoningPath: ctx.intendedReasoningPath, minimumSuccessfulReasoningPath: ctx.intendedReasoningPath, via };
  // the shortest route wins: a learner needs only one of the bypasses
  const shortest = via.map((c) => BYPASS_PATHS[c]).sort((a, b) => a.length - b.length)[0];
  return { verdict: 'BYPASSABLE', intendedReasoningPath: ctx.intendedReasoningPath, minimumSuccessfulReasoningPath: shortest, via };
}

// ------------------------------------------------------------------------------------------ DIFFICULTY_MECHANISM
const ARTIFICIAL = { longNumber: /\d{7,}|\d+[.,]\d{4,}/, textLength: 1800 } as const;
export interface DifficultyResult { tierFromMinimumPath: Tier; intendedTier: Tier; tierFit: 'YES' | 'BORDERLINE' | 'NO'; direction: 'MATCH' | 'TOO_EASY' | 'TOO_HARD'; findings: ValidatorFinding[] }

/**
 * The tier an item can honestly claim, from the path a learner actually needs. A bypassed item is FOUNDATIONAL
 * whatever its ideal solution looks like. CHALLENGE needs a declared mechanism; length and big numbers are not one.
 */
export function difficultyFromMinimumPath(item: ValidatableItem, ctx: Pick<ConstructContext, 'intendedTier' | 'difficultyMechanisms' | 'intendedReasoningPath'>, necessity: NecessityResult, calibrated: Tier | null, coreDerived = true): DifficultyResult {
  const findings: ValidatorFinding[] = [];
  const steps = necessity.minimumSuccessfulReasoningPath.length;
  // an item with no declared path (text that predates construct cores) keeps the calibrated tier unless it is bypassed
  const byPath: Tier = necessity.verdict === 'BYPASSABLE' ? 'FOUNDATIONAL' : steps === 0 ? calibrated ?? ctx.intendedTier : steps >= 3 && ctx.difficultyMechanisms.length > 0 ? 'CHALLENGE' : steps >= 2 ? 'STANDARD' : 'FOUNDATIONAL';
  // a calibrator that read the ideal solution cannot raise the tier above what the minimum path supports
  const tier = calibrated && TIERS.indexOf(calibrated) < TIERS.indexOf(byPath) ? calibrated : byPath;
  if (ctx.intendedTier === 'CHALLENGE' && ctx.difficultyMechanisms.length === 0) findings.push({ validator: 'DIFFICULTY_MECHANISM', code: 'CHALLENGE_WITHOUT_A_MECHANISM', severity: coreDerived ? 'REVIEW' : 'INFO', option: null, detail: 'a CHALLENGE item names what makes it hard; none is declared' });
  if (necessity.verdict === 'BYPASSABLE' && ctx.intendedTier !== 'FOUNDATIONAL') findings.push({ validator: 'DIFFICULTY_MECHANISM', code: 'DIFFICULTY_IS_OF_THE_IDEAL_SOLUTION_ONLY', severity: 'REVIEW', option: null, detail: `intended ${ctx.intendedTier}, but the shortest successful path is ${necessity.minimumSuccessfulReasoningPath.join(' -> ')}` });
  const text = stemOf(item);
  if (ARTIFICIAL.longNumber.test(text.replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2')) || text.length > ARTIFICIAL.textLength) findings.push({ validator: 'DIFFICULTY_MECHANISM', code: 'ARTIFICIAL_LOAD', severity: 'INFO', option: null, detail: 'long numbers or a long text: load that is not a difficulty mechanism' });
  const delta = TIERS.indexOf(tier) - TIERS.indexOf(ctx.intendedTier);
  return { tierFromMinimumPath: tier, intendedTier: ctx.intendedTier, tierFit: delta === 0 ? 'YES' : Math.abs(delta) === 1 && necessity.verdict === 'NECESSARY' ? 'BORDERLINE' : 'NO', direction: delta === 0 ? 'MATCH' : delta < 0 ? 'TOO_EASY' : 'TOO_HARD', findings };
}

// -------------------------------------------------------------------------------------- AUTHENTICITY (recalibrated)
export interface AuthenticityResult { conformance: 'CONFORMS' | 'DEVIATES'; deviations: ValidatorFinding[]; recalibrated: 'ACCEPTABLE' | 'REVIEW' | 'REJECT' }
/**
 * Authenticity is conformance to the ADAPTER: its response formats, command terms and option conventions. Those
 * are facts and are checked as facts. A judge's rating is advisory: LOW still rejects, but MEDIUM on an item that
 * conforms is not a defect -- "unusual" is not "inauthentic".
 */
export function authenticityAgainstAdapter(item: ValidatableItem & { commandTerm?: string | null }, adapter: Pick<AssessmentAdapter, 'adapterId' | 'responseFormats' | 'commandTerms'>, judge: 'HIGH' | 'MEDIUM' | 'LOW' | null): AuthenticityResult {
  const deviations: ValidatorFinding[] = [];
  const dev = (code: string, detail: string) => deviations.push({ validator: 'AUTHENTICITY', code, severity: 'REVIEW', option: null, detail });
  const format = item.itemType === 'MULTI_PART' ? null : item.itemType;
  if (format && !adapter.responseFormats.includes(format)) dev('FORMAT_NOT_OF_THE_ADAPTER', `${format} is not a response format of ${adapter.adapterId} (${adapter.responseFormats.join(', ')})`);
  if (adapter.commandTerms.use === 'CONTROLLED_VOCABULARY' && !SELECTED.has(item.itemType)) {
    const term = item.commandTerm ?? null;
    const allowed = adapter.commandTerms.terms.map(fold);
    if (!term) dev('NO_COMMAND_TERM', `${adapter.adapterId} asks under a command term`);
    else if (!allowed.includes(fold(term))) dev('COMMAND_TERM_NOT_OF_THE_ADAPTER', `"${term}" is not one of ${adapter.commandTerms.terms.join(', ')}`);
  }
  const conformance = deviations.length ? 'DEVIATES' : 'CONFORMS';
  const recalibrated = judge === 'LOW' ? 'REJECT' : conformance === 'DEVIATES' ? 'REVIEW' : 'ACCEPTABLE';
  return { conformance, deviations, recalibrated };
}

// ------------------------------------------------------------------------------------------------- all together
export interface InstanceValidation { validatorVersion: string; findings: ValidatorFinding[]; necessity: NecessityResult; difficulty: DifficultyResult; authenticity: AuthenticityResult | null; verdict: 'PASS' | 'REVIEW' | 'REJECT' }

export function validateInstance(input: {
  item: ValidatableItem & { commandTerm?: string | null };
  construct: ConstructContext;
  adapter: Pick<AssessmentAdapter, 'adapterId' | 'responseFormats' | 'commandTerms'> | null;
  /** Formats the core excludes because options would let the learner substitute instead of solving. */
  shortcutExcludedFormats: readonly string[];
  /** True for an instance rendered from a core: its distractors must come from the core's misconception models. */
  lineageRequired: boolean;
  judgeAuthenticity: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  calibratedTier: Tier | null;
}): InstanceValidation {
  const { item, construct } = input;
  const findings: ValidatorFinding[] = [...shortcutBypassFindings(item), ...optionLeakageFindings(item), ...distractorFindings(item, { lineageRequired: input.lineageRequired }), ...representationFindings(item, construct)];
  if (input.shortcutExcludedFormats.includes(item.itemType)) findings.push({ validator: 'SHORTCUT_BYPASS', code: 'FORMAT_ADMITS_SUBSTITUTION', severity: 'REJECT', option: null, detail: `${item.itemType} lets the learner try each option instead of executing the construct` });
  const necessity = constructNecessity(construct, findings);
  if (necessity.verdict === 'BYPASSABLE') findings.push({ validator: 'CONSTRUCT_NECESSITY', code: 'CONSTRUCT_NOT_NECESSARY', severity: 'REVIEW', option: null, detail: `intended ${necessity.intendedReasoningPath.join(' -> ') || '(not declared)'}; sufficient ${necessity.minimumSuccessfulReasoningPath.join(' -> ')} (${necessity.via.join(', ')})` });
  const difficulty = difficultyFromMinimumPath(item, construct, necessity, input.calibratedTier, input.lineageRequired);
  findings.push(...difficulty.findings);
  const authenticity = input.adapter ? authenticityAgainstAdapter(item, input.adapter, input.judgeAuthenticity) : null;
  if (authenticity) findings.push(...authenticity.deviations);
  const verdict = findings.some((x) => x.severity === 'REJECT') || authenticity?.recalibrated === 'REJECT' ? 'REJECT' : findings.some((x) => x.severity === 'REVIEW') ? 'REVIEW' : 'PASS';
  return { validatorVersion: INSTANCE_VALIDATOR_VERSION, findings, necessity, difficulty, authenticity, verdict };
}

// ------------------------------------------------------------------------------------- certification decision
/** What the model-backed stages said about an item (the V5 record), reduced to what a decision needs. */
export interface MachineEvidence { answerConfirmed: boolean; ambiguity: boolean; constructFit: 'PASS' | 'WEAK' | 'FAIL' | null; tierFit: 'YES' | 'BORDERLINE' | 'NO' | null; provenanceClear: boolean }
export type CertificationDecision = 'MACHINE_CERTIFIED' | 'REVIEW_REQUIRED' | 'REJECTED';
export interface CertificationOutcome { decision: CertificationDecision; reasons: string[] }

/**
 * V5.1's decision for one item. Two changes from V5, both from the fifty reviewed items:
 *   - an item the validators can bypass is never certified, however sound its key and its construct;
 *   - a judge's authenticity "medium" is no longer a reason for review by itself: authenticity is the adapter
 *     conformance in `validation.authenticity`.
 * Everything else that sent an item to review or rejected it in V5 still does.
 */
export function certificationDecision(machine: MachineEvidence, validation: InstanceValidation): CertificationOutcome {
  const reject: string[] = [];
  if (!machine.provenanceClear) reject.push('PROVENANCE_UNCLEAR');
  if (machine.constructFit === 'FAIL') reject.push('CONSTRUCT_FAIL');
  if (machine.tierFit === 'NO') reject.push('TIER_MISMATCH');
  reject.push(...validation.findings.filter((f) => f.severity === 'REJECT').map((f) => f.code));
  if (validation.authenticity?.recalibrated === 'REJECT') reject.push('AUTHENTICITY_LOW');
  if (reject.length) return { decision: 'REJECTED', reasons: [...new Set(reject)] };
  const review: string[] = [];
  if (!machine.answerConfirmed) review.push('ANSWER_UNCONFIRMED');
  if (machine.ambiguity) review.push('AMBIGUITY_FLAGGED');
  if (machine.constructFit !== 'PASS') review.push(machine.constructFit === 'WEAK' ? 'CONSTRUCT_WEAK' : 'CONSTRUCT_NOT_JUDGED');
  if (machine.tierFit !== 'YES') review.push(machine.tierFit === 'BORDERLINE' ? 'TIER_BORDERLINE' : 'TIER_NOT_JUDGED');
  review.push(...validation.findings.filter((f) => f.severity === 'REVIEW').map((f) => f.code));
  return review.length ? { decision: 'REVIEW_REQUIRED', reasons: [...new Set(review)] } : { decision: 'MACHINE_CERTIFIED', reasons: [] };
}

/** A rendered instance as the validators read it. Structural: any renderer's output fits. */
export function validatableOfRendered(i: { learner: { language: string; itemType: string; stimulus: string | null; prompt: string; options: readonly { label: string; text: string }[] }; key: { correctOption: string | null; distractorLineage?: Readonly<Record<string, DistractorLineage>> } }, assets: readonly Representation[] = []): ValidatableItem {
  return { language: i.learner.language, itemType: i.learner.itemType, stimulus: i.learner.stimulus, prompt: i.learner.prompt, options: i.learner.options, correctOption: i.key.correctOption, distractorLineage: i.key.distractorLineage ?? {}, assets };
}
