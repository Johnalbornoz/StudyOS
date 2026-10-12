/**
 * Question Factory V5 -- the stages that need no model: structure, leakage, marks, options, declared arithmetic,
 * answer comparison, plausibility and duplicates. Everything here is recomputed from the item; nothing trusts a
 * label the generator attached to it.
 *
 * Pure.
 */
import { evaluateExpression, nearlyEqual } from '../expression-evaluator';
import { normalizeStudentResponse, rationalToNumber } from '../answer-normalization';
import { textualSimilarity } from '../originality-gate';
import { CandidateItemSchema, learnerText, type CandidateItem, type GenerationSpecification } from './item';
import type { QuestionGenerationProfile } from './generation-profile';

export const VALIDATOR_VERSION = 'qf-v5-validators-1.2.0';

export type Severity = 'FAIL' | 'REVIEW';
export interface Finding { code: string; severity: Severity; detail: string }
const fail = (code: string, detail: string): Finding => ({ code, severity: 'FAIL', detail });
const review = (code: string, detail: string): Finding => ({ code, severity: 'REVIEW', detail });

const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const squash = (s: string): string => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// --------------------------------------------------------------------------------------------- stage 3: structure
/** Internal generation language that must never reach a learner (brief 2.9). Matched on folded text. */
export const LEAKAGE_PATTERNS: readonly RegExp[] = [
  /\bblueprint\b/, /\bbucket\b/, /\b(target|intended|actual) difficulty\b/, /\bdificultad (objetivo|prevista|esperada)\b/, /\bdifficulty tier\b/, /\bnivel de dificultad:/,
  /\bexpected answer\b/, /\brespuesta (esperada|correcta):/, /\bcorrect answer:/, /\banswer key\b/, /\bclave de respuesta\b/,
  /\bconstruct (requirement|fit|validity)\b/, /\bmarking hint\b/, /\bgrader\b/, /\bmark ?scheme\b/, /\brubric\b/, /\brubrica\b/,
  /\bmetadata\b/, /\bmetadatos\b/, /\bgeneration (spec|specification|profile)\b/, /\bjson\b/, /\bdistractor(es|s)?\b/,
  /\b(foundational|standard|challenge)\b(?= (tier|band|item|level))/, /\bslot ?key\b/, /\bcommand term\b/, /\bcognitive (target|demand)\b/, /\blearning objective id\b/, /\bas an ai\b/,
];
const RESIDUE = [/\{\{\s*[a-zA-Z_.]+\s*\}\}/, /\$\{[a-zA-Z_.]+\}/, /<(placeholder|todo|insert|value|answer|stem|option)[a-z_]*>/i, /\[(todo|tbd|placeholder|insert[^\]]*)\]/i, /\bNaN\b/, /\blorem ipsum\b/i, /```/, /"[a-zA-Z_]+"\s*:\s*["\[{]/, /\\n(?![a-zA-Z])/];
const TRUNCATED = [/[,;(\[¿¡]\s*$/, /…\s*$|\.\.\.\s*$/, /\b(and|or|the|of|que|de|la|el|y|o)\s*$/i];
/** Parentheses must close, ignoring what is not a parenthesis pair: half-open intervals "[2, 5)" and list labels "a)". */
const balanced = (raw: string): boolean => { const s = raw.replace(/[\[(\]][^()\[\]]{0,40}[,;][^()\[\]]{0,40}[\])\[]/g, ' ').replace(/(^|\s)[a-zA-Z0-9]{1,3}\)/g, '$1'); let n = 0; for (const c of s) { if (c === '(') n += 1; if (c === ')') n -= 1; if (n < 0) return false; } return n === 0; };

export function structuralFindings(raw: unknown, spec: GenerationSpecification, profile: QuestionGenerationProfile): { item: CandidateItem | null; findings: Finding[] } {
  const parsed = CandidateItemSchema.safeParse(raw);
  if (!parsed.success) return { item: null, findings: [fail('SCHEMA_INVALID', parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))] };
  const item = parsed.data;
  const f: Finding[] = [];
  if (item.slotKey !== spec.slotKey) f.push(fail('SLOT_MISMATCH', `item answers ${item.slotKey}, specification is ${spec.slotKey}`));
  if (item.itemType !== spec.itemFormat) f.push(fail('FORMAT_NOT_REQUESTED', `${item.itemType} returned for a ${spec.itemFormat} slot`));
  if (!profile.itemFormats.includes(item.itemType)) f.push(fail('FORMAT_NOT_IN_PROFILE', `${item.itemType} is not a format of ${profile.profileId}`));
  if (item.language !== profile.language) f.push(fail('LANGUAGE_MISMATCH', `${item.language} for a ${profile.language} profile`));

  const texts: [string, string][] = [['fullLearnerPrompt', item.fullLearnerPrompt], ['stimulus', item.stimulus ?? ''], ...item.parts.map((p, i): [string, string] => [`parts[${i}]`, p.prompt]), ...item.options.map((o): [string, string] => [`option ${o.label}`, o.text])];
  for (const [where, text] of texts) {
    for (const r of RESIDUE) if (r.test(text)) f.push(fail('TEMPLATE_RESIDUE', `${where} matches ${r}`));
    const folded = fold(text);
    for (const r of LEAKAGE_PATTERNS) if (r.test(folded)) f.push(fail('SPEC_LEAKAGE', `${where} matches ${r}`));
    if (!balanced(text)) f.push(fail('TRUNCATED', `${where}: unbalanced parentheses`));
  }
  // the material and the question are shown together: a prompt that repeats the material shows it to the learner twice
  if (item.stimulus && squash(item.stimulus).length >= 60 && squash(item.fullLearnerPrompt).includes(squash(item.stimulus).slice(0, 120))) f.push(fail('STIMULUS_REPEATED_IN_PROMPT', 'fullLearnerPrompt repeats the stimulus'));
  for (const [where, text] of texts.filter(([w]) => !w.startsWith('option') && !w.startsWith('stimulus'))) for (const r of TRUNCATED) if (text.trim().length && r.test(text.trim())) f.push(fail('TRUNCATED', `${where} ends mid-sentence`));

  const selected = item.itemType === 'SELECTED_RESPONSE' || item.itemType === 'MULTI_SELECT';
  if (selected) {
    const labels = item.options.map((o) => o.label);
    const expected = 'ABCDEF'.slice(0, profile.optionCount ?? 4).split('');
    if (labels.join('') !== expected.join('')) f.push(fail('OPTIONS_SHAPE', `options ${labels.join('') || '(none)'}; this context uses ${expected.join('')}`));
    if (new Set(item.options.map((o) => squash(o.text))).size !== item.options.length) f.push(fail('DUPLICATE_OPTIONS', 'two options have the same text'));
    const keys = item.proposedAnswer.split(/[\s,]+/).filter(Boolean);
    if (item.itemType === 'SELECTED_RESPONSE' && (keys.length !== 1 || !labels.includes(keys[0]))) f.push(fail('KEY_NOT_AN_OPTION', `proposed key "${item.proposedAnswer}"`));
    if (item.itemType === 'MULTI_SELECT' && (keys.length < 2 || keys.some((k) => !labels.includes(k)))) f.push(fail('KEY_NOT_AN_OPTION', `proposed key "${item.proposedAnswer}"`));
    for (const l of labels.filter((x) => !keys.includes(x))) if (!item.distractorRationales[l]) f.push(fail('DISTRACTOR_WITHOUT_RATIONALE', `option ${l} names no reasoning error`));
    if (item.parts.length) f.push(fail('SELECTED_RESPONSE_WITH_PARTS', 'a selected-response item has no parts'));
    // brief 2.4: a selected-response item is never given extra marks because its tier is high
    if (item.marks !== profile.markPolicy.selectedResponseMarks) f.push(fail('SELECTED_RESPONSE_MARKS_INFLATED', `${item.marks} marks on a selected-response item`));
  } else {
    if (item.options.length) f.push(fail('OPTIONS_ON_CONSTRUCTED_ITEM', 'a constructed-response item carries options'));
    const [lo, hi] = profile.markPolicy.constructedMarks;
    if (item.marks < lo || item.marks > hi) f.push(fail('MARKS_OUT_OF_PROFILE', `${item.marks} marks; ${profile.profileId} allows ${lo}-${hi}`));
    if (profile.markPolicy.marksProportionalToWork) {
      const rubric = item.rubric.reduce((a, r) => a + r.marks, 0);
      if (rubric !== item.marks) f.push(fail('MARKS_NOT_EARNED_BY_RUBRIC', `rubric awards ${rubric}, item is worth ${item.marks}`));
    }
  }
  if (item.marks !== spec.intendedMarks) f.push(review('MARKS_DIFFER_FROM_SPECIFICATION', `${item.marks} vs ${spec.intendedMarks} intended`));

  if (item.itemType === 'MULTI_PART') {
    if (item.parts.length < 2) f.push(fail('MULTI_PART_TOO_FEW_PARTS', `${item.parts.length} part(s)`));
    const seen: string[] = [];
    for (const p of item.parts) {
      if (seen.includes(p.label)) f.push(fail('PART_LABEL_REPEATED', p.label));
      for (const d of p.dependsOn) if (!seen.includes(d)) f.push(fail('PART_DEPENDS_ON_LATER_PART', `${p.label} uses ${d}`));
      seen.push(p.label);
    }
    const sum = item.parts.reduce((a, p) => a + p.marks, 0);
    if (sum !== item.marks) f.push(fail('PART_MARKS_DO_NOT_SUM', `parts total ${sum}, item is worth ${item.marks}`));
  } else if (item.parts.length) f.push(fail('PARTS_ON_SINGLE_ITEM', `${item.itemType} with ${item.parts.length} parts`));
  if (profile.multiPartPolicy === 'NEVER' && item.parts.length) f.push(fail('MULTI_PART_NOT_IN_PROFILE', profile.profileId));

  if (profile.commandTermPolicy.required) {
    const allowed = profile.commandTermPolicy.allowed.map(fold);
    const terms = item.parts.length ? item.parts.map((p) => p.commandTerm) : [item.commandTerm];
    const prompts = item.parts.length ? item.parts.map((p) => p.prompt) : [item.fullLearnerPrompt];
    terms.forEach((t, i) => {
      if (!t) f.push(fail('COMMAND_TERM_MISSING', `no command term on ${item.parts[i]?.label ?? 'the item'}`));
      else if (!allowed.includes(fold(t))) f.push(fail('COMMAND_TERM_NOT_IN_PROFILE', `"${t}"`));
      else if (!fold(prompts[i]).includes(fold(t))) f.push(fail('COMMAND_TERM_NOT_IN_PROMPT', `"${t}" is declared but the learner is never asked to ${t}`));
    });
  }
  if (profile.contextPolicy.requirement === 'MATERIAL_REQUIRED' && !item.stimulus && item.fullLearnerPrompt.length < 160) f.push(review('CONTEXT_THIN', 'the profile requires material context; the item has no stimulus and a short prompt'));
  return { item, findings: f };
}

// ------------------------------------------------------------------------------------- stage 7 (deterministic part)
const FORBIDDEN_OPTION = /\b(all|none) of the above\b|\b(todas|ninguna) (de )?las anteriores\b|\b(both|ambas) [a-d] (and|y) [a-d]\b/;
export function optionFindings(item: CandidateItem): Finding[] {
  if (item.itemType !== 'SELECTED_RESPONSE') return [];
  const f: Finding[] = [];
  const key = item.options.find((o) => o.label === item.proposedAnswer);
  if (!key) return f;
  const others = item.options.filter((o) => o !== key);
  for (const o of item.options) if (FORBIDDEN_OPTION.test(fold(o.text))) f.push(fail('FORBIDDEN_OPTION_FORM', `option ${o.label}`));
  const med = median(others.map((o) => o.text.length));
  if (key.text.length >= 24 && key.text.length > 1.6 * med) f.push(review('KEY_LENGTH_CLUE', `the key is ${key.text.length} characters; the other options have median ${med}`));
  if (squash(key.text).length >= 16 && squash(`${item.stimulus ?? ''} ${item.fullLearnerPrompt}`).includes(squash(key.text))) f.push(review('KEY_VERBATIM_IN_STEM', 'the key repeats a phrase of the stem or stimulus word for word'));
  const unit = (s: string): string => (/[\d)]\s*([a-zA-Z%°µ²³/]+)\s*$/.exec(s.trim())?.[1] ?? '');
  if (unit(key.text) && others.every((o) => unit(o.text) !== unit(key.text))) f.push(review('KEY_UNIT_CLUE', `only the key carries the unit ${unit(key.text)}`));
  // two options that are the same number written differently: more than one defensible answer
  const values = item.options.map((o) => numericValue(o.text, item.acceptedUnits));
  for (let i = 0; i < values.length; i += 1) for (let j = i + 1; j < values.length; j += 1) {
    const a = values[i]; const b = values[j];
    if (a !== null && b !== null && nearlyEqual(a, b)) f.push(fail('EQUIVALENT_OPTIONS', `options ${item.options[i].label} and ${item.options[j].label} are the same value`));
  }
  return f;
}

/** Key-position distribution over a batch: flags a dominant position, never forces a balance item by item. */
export function keyPositionFinding(keys: readonly string[], optionCount: number): Finding | null {
  if (keys.length < 20) return null;
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const expected = keys.length / optionCount;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const chi = 'ABCDEF'.slice(0, optionCount).split('').reduce((a, l) => a + ((counts.get(l) ?? 0) - expected) ** 2 / expected, 0);
  // critical values at p = 0.01 for 2, 3, 4 and 5 degrees of freedom
  const critical = [0, 6.63, 9.21, 11.34, 13.28, 15.09][optionCount - 1] ?? 15.09;
  return chi > critical ? review('KEY_POSITION_SKEW', `position ${top[0]} holds the key in ${top[1]} of ${keys.length} items (chi-square ${chi.toFixed(2)} > ${critical})`) : null;
}

// ----------------------------------------------------------------------------- stages 4 and 9: answers, recomputed
export function numericValue(text: string, units: readonly string[] = []): number | null {
  // "x = 3" is the number 3; a currency sign, a percent sign or a trailing unit word does not change the value
  const s = text.trim().replace(/^[a-zA-Z]\w{0,3}\s*=\s*/, '').replace(/^[$€£]\s*/, '').replace(/(?<=\d)\s*(%|°|[a-zA-Zµ°][a-zA-Zµ°²³/·. ]{0,18})$/, '');
  const direct = normalizeStudentResponse(s, units);
  if (direct.ok && direct.readings.length === 1) return rationalToNumber(direct.readings[0].value);
  try { return evaluateExpression(s); } catch { return null; }
}

const VARIABLE = /[a-zA-Z]/;
/** Rewrites school algebra ("3x(x+2)", "2ab") into the evaluator's grammar at one sample point. Null when it cannot. */
function atPoint(expr: string, point: Readonly<Record<string, number>>): number | null {
  let s = expr.replace(/\s+/g, '').replace(/sqrt/g, '√').replace(/²/g, '^2').replace(/³/g, '^3');
  if (/[=<>]/.test(s)) return null;
  s = s.replace(/[a-zA-Z]/g, (v) => (v in point ? `(${point[v]})` : '?'));
  if (s.includes('?')) return null;
  s = s.replace(/(\d|\))(?=\(|√)/g, '$1*');
  try { return evaluateExpression(s); } catch { return null; }
}
const SAMPLE = [0.37, 1.91, -1.13, 2.53, -2.71];
export function algebraicallyEqual(a: string, b: string): boolean | null {
  const vars = [...new Set(`${a}${b}`.replace(/sqrt/g, '').split('').filter((c) => VARIABLE.test(c)))];
  if (vars.length < 1 || vars.length > 3) return null;
  let compared = 0;
  for (let k = 0; k < SAMPLE.length; k += 1) {
    const point = Object.fromEntries(vars.map((v, i) => [v, SAMPLE[(k + 2 * i) % SAMPLE.length] + i * 0.11]));
    const x = atPoint(a, point); const y = atPoint(b, point);
    if (x === null || y === null) continue;
    compared += 1;
    if (!nearlyEqual(x, y, 1e-7)) return false;
  }
  return compared >= 3 ? true : null;
}

export type AnswerComparison = 'MATCH' | 'MISMATCH' | 'UNDETERMINED';
export interface AnswerComparisonResult { verdict: AnswerComparison; method: 'OPTION_LABEL' | 'NUMERIC' | 'ALGEBRAIC' | 'NORMALISED_TEXT' | 'NONE'; detail: string }
const label = (s: string): string => (/^\(?([A-Fa-f])[).:]?(\s|$)/.exec(s.trim())?.[1] ?? '').toUpperCase();

/** Generator's proposed answer against an independently produced one. Equivalence is proved, never assumed. */
export function compareAnswers(item: CandidateItem, independent: string): AnswerComparisonResult {
  if (item.itemType === 'SELECTED_RESPONSE') {
    const theirs = label(independent);
    if (!theirs) return { verdict: 'UNDETERMINED', method: 'OPTION_LABEL', detail: `the independent answer "${independent.slice(0, 40)}" names no option` };
    return { verdict: theirs === item.proposedAnswer ? 'MATCH' : 'MISMATCH', method: 'OPTION_LABEL', detail: `${item.proposedAnswer} vs ${theirs}` };
  }
  if (item.itemType === 'MULTI_SELECT') {
    const set = (s: string) => [...new Set(s.toUpperCase().match(/\b[A-F]\b/g) ?? [])].sort().join('');
    return { verdict: set(independent) === set(item.proposedAnswer) ? 'MATCH' : 'MISMATCH', method: 'OPTION_LABEL', detail: `${set(item.proposedAnswer)} vs ${set(independent)}` };
  }
  const a = numericValue(item.proposedAnswer, item.acceptedUnits); const b = numericValue(independent, item.acceptedUnits);
  if (a !== null && b !== null) return { verdict: nearlyEqual(a, b, 1e-6) ? 'MATCH' : 'MISMATCH', method: 'NUMERIC', detail: `${a} vs ${b}` };
  const alg = algebraicallyEqual(item.proposedAnswer, independent);
  if (alg !== null) return { verdict: alg ? 'MATCH' : 'MISMATCH', method: 'ALGEBRAIC', detail: 'compared at sample points' };
  if (squash(item.proposedAnswer) === squash(independent)) return { verdict: 'MATCH', method: 'NORMALISED_TEXT', detail: 'identical after normalisation' };
  return { verdict: 'UNDETERMINED', method: 'NONE', detail: 'no deterministic normaliser applies' };
}

/** The arithmetic the generator declared must give its own key, and for a selected response exactly one option. */
export function declaredArithmeticFindings(item: CandidateItem): Finding[] {
  if (!item.answerExpression) return [];
  let value: number;
  try { value = evaluateExpression(item.answerExpression); } catch (e) { return [fail('ANSWER_EXPRESSION_INVALID', e instanceof Error ? e.message : 'not evaluable')]; }
  if (item.itemType === 'SELECTED_RESPONSE') {
    const hits = item.options.filter((o) => { const v = numericValue(o.text, item.acceptedUnits); return v !== null && nearlyEqual(v, value, 1e-6); }).map((o) => o.label);
    // only when every option reads as a number can "none of them equals it" be asserted
    if (hits.length < 1) return item.options.every((o) => numericValue(o.text, item.acceptedUnits) !== null) ? [fail('NO_OPTION_EQUALS_COMPUTED_ANSWER', `the declared arithmetic gives ${value}; no option has that value`)] : [];
    if (hits.length > 1) return [fail('SEVERAL_OPTIONS_EQUAL_COMPUTED_ANSWER', hits.join(', '))];
    return hits[0] === item.proposedAnswer ? [] : [fail('KEY_CONTRADICTS_DECLARED_ARITHMETIC', `arithmetic gives option ${hits[0]}, the key says ${item.proposedAnswer}`)];
  }
  const keyed = numericValue(item.proposedAnswer, item.acceptedUnits);
  if (keyed === null) return [];
  return nearlyEqual(keyed, value, 1e-6) ? [] : [fail('KEY_CONTRADICTS_DECLARED_ARITHMETIC', `arithmetic gives ${value}, the key says ${keyed}`)];
}

// ------------------------------------------------------------------------------------------ stage 13: plausibility
/** Cheap, conservative magnitude checks on learner-visible numbers. A model judge covers what these cannot see. */
export function plausibilityFindings(item: CandidateItem): Finding[] {
  const text = fold(learnerText(item));
  const f: Finding[] = [];
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) { const v = Number(m[1].replace(',', '.')); if (v > 100 && /\b(probab|chance|of the (students|people|sample)|de los (estudiantes|encuestados))/.test(text)) f.push(review('PERCENTAGE_OVER_100', `${m[0]} of a population`)); }
  for (const m of text.matchAll(/\bprobab\w*(?: [a-z]+){0,4} (?:is|es|=|:)\s*(\d+[.,]\d+)(?!\s*%)/g)) { const v = Number(m[1].replace(',', '.')); if (v > 1) f.push(review('PROBABILITY_OVER_1', m[0])); }
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(km\/h|kph)\b/g)) { const v = Number(m[1].replace(',', '.')); if (v > 1300 && !/\b(avion|aircraft|plane|jet|rocket|cohete|satel)/.test(text)) f.push(review('SPEED_IMPLAUSIBLE', m[0])); }
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(anos|years old)\b/g)) { const v = Number(m[1].replace(',', '.')); if (v > 120) f.push(review('AGE_IMPLAUSIBLE', m[0])); }
  return f;
}

// --------------------------------------------------------------------------------------- stage 8: duplicates
export interface CorpusEntry { id: string; source: 'CURRENT_BANK' | 'THIS_BATCH' | 'EARLIER_BATCH'; text: string }
export const DUPLICATE_THRESHOLDS = { near: 0.6, template: 0.9 } as const;
/** The item with its numbers and proper nouns masked: twenty re-numberings of one exercise share one skeleton. */
export const templateSkeleton = (text: string): string => squash(text.replace(/\d+(?:[.,]\d+)?/g, ' # ')).replace(/\b[a-z]\b/g, 'v');
export interface DuplicateResult { verdict: 'UNIQUE' | 'EXACT' | 'NORMALISED' | 'NEAR' | 'TEMPLATE'; score: number; closestId: string | null }

export function duplicateOf(item: CandidateItem, corpus: readonly CorpusEntry[]): DuplicateResult {
  const text = learnerText(item); const norm = squash(text); const skeleton = templateSkeleton(text);
  let best: DuplicateResult = { verdict: 'UNIQUE', score: 0, closestId: null };
  const rank = { UNIQUE: 0, TEMPLATE: 1, NEAR: 2, NORMALISED: 3, EXACT: 4 } as const;
  for (const e of corpus) {
    if (e.id === item.itemId) continue;
    const sim = textualSimilarity(text, e.text);
    const verdict: DuplicateResult['verdict'] = e.text === text ? 'EXACT' : squash(e.text) === norm ? 'NORMALISED' : sim >= DUPLICATE_THRESHOLDS.near ? 'NEAR' : textualSimilarity(skeleton, templateSkeleton(e.text)) >= DUPLICATE_THRESHOLDS.template ? 'TEMPLATE' : 'UNIQUE';
    const score = verdict === 'EXACT' || verdict === 'NORMALISED' ? 1 : Math.round(sim * 1000) / 1000;
    if (rank[verdict] > rank[best.verdict] || (rank[verdict] === rank[best.verdict] && score > best.score)) best = { verdict, score, closestId: verdict === 'UNIQUE' && score < 0.2 ? best.closestId : e.id };
  }
  return best;
}
