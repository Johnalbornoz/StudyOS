/**
 * QB-R2E -- validators, REVISION 3 (pure, no IO). Revision 2 (`specification-validators.ts`) is NOT edited: it is the
 * revision that scored the QB-R2D batch, and that report must stay reproducible with the code that produced it.
 *
 * Revision 3 = every check of revision 2, unchanged and unrelaxed, PLUS:
 *
 *   in PROFILE_COMPLIANCE
 *     marks            the item against the marks the specification now states: total inside the range, number of
 *                      parts inside the range, how it is scored, the kinds of mark point, credit levels present
 *                      exactly when the specification says so                     [new specification field]
 *     command terms    each part carries ONE command term, it is one the specification allows, and the part's
 *                      prompt begins with it                                      [new specification field]
 *   in CONSTRUCT_PRESERVATION
 *     handed over      what the construct is evidence of is given to the learner: a root of the equation in the
 *                      stem, the two linear factors of an optimum model written out, the equation of a model that
 *                      has to be formulated                                       [QB-R2D reading, items 10 a2 and 11]
 *   a gate of its own
 *     LEARNER_TEXT_SPECIFICATION_LEAKAGE   specification vocabulary in anything a learner reads -- stem, prompts,
 *                      options AND the stimulus's text, titles and labels (revision 2 looked at the first three, inside
 *                      STRUCTURAL; that check still runs there)                   [QB-R2D reading, items 10, 11, 15, 17]
 *   a HEURISTIC gate, named as one
 *     ITEM_WRITING     a selected response whose key is uniquely obvious (it alone shows working, or is much the
 *                      longest), whose options are not parallel, or whose stem asks "which option formulates ..."
 *                      instead of asking a question. Outcome PASS or FLAGGED; never FAIL: wording is a reviewer's reading.
 *
 * Nothing here is a review. Every result is an AUTOMATED_VALIDATION.
 */
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { nearlyEqual } from './expression-evaluator';
import type { CandidateStimulus } from './generation-contract';
import { constructVocabularyOf } from './math-construct-registry';
import type { ComparisonEntry } from './originality-gate';
import type { SpecificationCandidate } from './specification-candidate';
import { parseLinearFromText, SPECIFICATION_AUTOMATED_VALIDATION, SPECIFICATION_REVIEW_STATUS, validateSpecificationCandidate, type SpecificationItemValidation } from './specification-validators';

export const SPECIFICATION_VALIDATORS_REVISION_3 = 3 as const;
const constructIdOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown } | null)?.construct ?? '');
const prompts = (c: SpecificationCandidate): string[] => c.content.constructed?.parts.map((p) => p.prompt) ?? [];
/** What a learner reads before answering: the stem and the prompts. Not the options. */
const questionText = (c: SpecificationCandidate): string => [c.content.stem, ...prompts(c)].join(' \n ');

// ---------------------------------------------------------------------------------------------------------------
// marks and command terms: the item against the specification's new fields
// ---------------------------------------------------------------------------------------------------------------
export function marksIssues(c: SpecificationCandidate, s: AdaptationSpecification): string[] {
  const m = s.variable.marks;
  if (!m) return ['SPECIFICATION_STATES_NO_MARKS'];
  const x = c.content;
  const out: string[] = [];
  const total = x.constructed ? x.constructed.totalMarks : 1;
  if (c.marks !== total) out.push(`MARKS_RESTATED_ARE_NOT_THE_ITEMS:${c.marks}/${total}`);
  if (total < m.total.min || total > m.total.max) out.push(`TOTAL_MARKS_OUTSIDE_SPECIFICATION:${total} not in [${m.total.min}, ${m.total.max}]`);
  if ((m.scoredAs === 'MARKED_PARTS') !== (x.constructed !== null)) out.push(`SCORING_IS_NOT_THE_SPECIFICATIONS:${m.scoredAs}`);
  if (x.constructed) {
    const n = x.constructed.parts.length;
    if (m.parts && (n < m.parts.min || n > m.parts.max)) out.push(`PART_COUNT_OUTSIDE_SPECIFICATION:${n} not in [${m.parts.min}, ${m.parts.max}]`);
    const foreign = [...new Set(x.constructed.parts.flatMap((p) => p.markScheme).map((k) => k.kind).filter((k) => !(m.markPointKinds as string[]).includes(k)))];
    if (foreign.length > 0) out.push(`MARK_POINT_KIND_NOT_IN_SPECIFICATION:${foreign.join(',')}`);
  }
  if ((x.credit !== null) !== m.creditLevels) out.push(m.creditLevels ? 'CREDIT_LEVELS_REQUIRED_BY_SPECIFICATION_MISSING' : 'CREDIT_LEVELS_NOT_IN_SPECIFICATION');
  return out;
}

const startsWithTerm = (prompt: string, term: string): boolean => new RegExp(`^[\\s\\p{P}]*${term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}])`, 'iu').test(prompt);
export function commandTermIssues(c: SpecificationCandidate, s: AdaptationSpecification): string[] {
  const terms = s.variable.commandTerms;
  const parts = c.content.constructed?.parts ?? [];
  const out: string[] = [];
  for (const p of parts) {
    if (!terms) { if (p.commandTerm !== null && p.commandTerm !== undefined) out.push(`COMMAND_TERM_GIVEN_BUT_SPECIFICATION_HAS_NONE:${p.label}`); continue; }
    if (!p.commandTerm) out.push(`PART_WITHOUT_A_COMMAND_TERM:${p.label}`);
    else if (!terms.allowed.includes(p.commandTerm)) out.push(`COMMAND_TERM_NOT_ALLOWED_BY_SPECIFICATION:${p.label}=${p.commandTerm}`);
    else if (!startsWithTerm(p.prompt, p.commandTerm)) out.push(`PART_PROMPT_DOES_NOT_BEGIN_WITH_ITS_COMMAND_TERM:${p.label}=${p.commandTerm}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// LEARNER_TEXT_SPECIFICATION_LEAKAGE
// ---------------------------------------------------------------------------------------------------------------
export const LEAKAGE_RULE = {
  id: 'studyus-learner-text-leakage-rule', version: '1',
  rule: 'Learner text is the stem, the part prompts, the options and the stimulus\'s text parts, titles and labels. It leaks when it contains: an evidence-action or verdict code word in capitals; any identifier in capitals with an underscore; a quantity or verdict code or the construct id of the vocabulary; a parameter symbol of the vocabulary, or a symbol of the variables of the construct, of two or more characters as a word of its own; or one of the listed internal phrases.',
  internalPhrases: ['free measure', 'medida libre', 'generated with parameters', 'generado con parámetros', 'evidence target', 'misconception model', 'task family', 'adaptation specification', 'construct vocabulary', 'declared model'],
} as const;
const CODE_WORD = /(?<![\p{L}_])(FORMULATE|SOLVE|INTERPRET|COMPUTE|EVALUATE|REPRESENT|JUSTIFY|RECALL|SUPPORTED|CONTRADICTED|NOT_DECIDABLE|[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)(?![\p{L}_])/gu;

export function learnerTextOf(c: SpecificationCandidate, stimulus: CandidateStimulus | null): string {
  const st = stimulus?.structured;
  return [
    c.content.stem, ...prompts(c), ...(c.content.selected?.options.map((o) => o.text) ?? []),
    ...(stimulus ? stimulus.parts.filter((p) => p.partKind === 'TEXT' || p.partKind === 'SOURCE_NOTE').map((p) => p.text) : []),
    ...(st ? [...st.tables.flatMap((t) => [t.title, ...t.columns.map((col) => col.label), ...t.rows.flatMap((r) => r.filter((cell): cell is string => typeof cell === 'string'))]), ...st.dataSets.flatMap((d) => [d.title, ...(d.categories ?? []), ...d.series.map((q) => q.label)]), ...st.charts.flatMap((ch) => [ch.title, ch.xLabel ?? '', ch.yLabel ?? ''])] : []),
  ].join(' \n ');
}
export function leakedSpecificationVocabulary(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null): string[] {
  const text = learnerTextOf(c, stimulus);
  const vocabulary = constructVocabularyOf(constructIdOf(s));
  const out = new Set<string>([...text.matchAll(CODE_WORD)].map((m) => m[1]));
  // the vocabulary's parameter symbols and the symbols of the construct's own variables (r1, xv, ...), when they are more than one letter
  const constructSymbols = ((s.invariants.construct as { variables?: Array<{ symbol?: unknown }> } | null)?.variables ?? []).map((v) => String(v.symbol ?? ''));
  for (const symbol of new Set([...(vocabulary?.parameters ?? []), ...(vocabulary?.optionalParameters ?? []), ...constructSymbols])) if (/^[\p{L}][\p{L}\d]+$/u.test(symbol) && new RegExp(`(?<![\\p{L}\\d_])${symbol}(?![\\p{L}\\d_])`, 'u').test(text)) out.add(symbol);
  const lower = text.toLowerCase();
  for (const phrase of LEAKAGE_RULE.internalPhrases) if (lower.includes(phrase)) out.add(phrase);
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------------------------
// handed over: positive evidence that the learner was given what the construct is evidence of
// ---------------------------------------------------------------------------------------------------------------
export function handedOverIssues(c: SpecificationCandidate, s: AdaptationSpecification): string[] {
  const construct = constructIdOf(s);
  const P = c.content.declaredModel.parameters;
  const text = questionText(c).replace(/[−–]/g, '-').replace(/(\d),(\d)/g, '$1.$2');
  const out: string[] = [];
  if (construct === 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING') {
    // a declared root given as the value of the unknown (`x = 3`, `x1 = 3`, `r1 = 3`), in what the learner reads before answering
    const stated = [...text.replace(/\([^)]*\)/g, ' ').matchAll(/(?<![\p{L}\d])(?:x|r)_?\d?\s*=\s*(-?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)/gu)].map((m) => { const [n, d] = m[1].replace(/\s+/g, '').split('/'); return d ? Number(n) / Number(d) : Number(n); });
    if (stated.some((r) => [P.r1, P.r2].some((d) => d !== undefined && nearlyEqual(r, d)))) out.push('A_ROOT_IS_STATED_TO_THE_LEARNER');
  }
  if (construct === 'QUADRATIC_MODEL_VERTEX_OPTIMUM') {
    // both linear factors written out as expressions: `p + q x` and `r - s x`
    const rising = [...text.matchAll(/(\d+(?:\.\d+)?)\s*\+\s*(\d*(?:\.\d+)?)\s*\*?\s*\p{L}(?![\p{L}\d])/gu)].some((m) => nearlyEqual(Number(m[1]), P.p) && nearlyEqual(m[2] === '' ? 1 : Number(m[2]), P.q));
    const falling = [...text.matchAll(/(\d+(?:\.\d+)?)\s*-\s*(\d*(?:\.\d+)?)\s*\*?\s*\p{L}(?![\p{L}\d])/gu)].some((m) => nearlyEqual(Number(m[1]), P.r) && nearlyEqual(m[2] === '' ? 1 : Number(m[2]), P.s));
    if (rising && falling) out.push('BOTH_LINEAR_FACTORS_ARE_WRITTEN_OUT_FOR_THE_LEARNER');
  }
  if (construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE' && s.invariants.evidenceTarget.actions.includes('FORMULATE')) {
    const line = parseLinearFromText(text);
    if (line && P.m !== undefined && P.b !== undefined && nearlyEqual(line.m, P.m) && nearlyEqual(line.b, P.b)) out.push('THE_MODEL_TO_BE_FORMULATED_IS_WRITTEN_OUT_FOR_THE_LEARNER');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// ITEM_WRITING: a heuristic gate
// ---------------------------------------------------------------------------------------------------------------
export const ITEM_WRITING_HEURISTIC = {
  id: 'studyus-item-writing-heuristic', version: '1',
  rule: 'Selected responses only. KEY_UNIQUELY_OBVIOUS: the key is at least 40% longer than every other option, or the key shows a calculation (contains "=") and no other option does. OPTIONS_NOT_PARALLEL: some options show a calculation ("=") and others do not, or the longest option is more than three times the shortest. STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED: the stem asks which option formulates, expresses, represents, compares or interprets correctly. A flag is a reason for a person to look, not a verdict.',
} as const;
const META_STEM = /(which|what)\s+(option|of the following|statement|choice)[^?.]*\b(formulat|express|represent|compar|interpret|model)\w*\s+[^?.]*\bcorrect|\bcorrectly\s+(formulat|express|represent|compar|interpret|model)|(qué|cuál)\s+(opción|de las siguientes|comparación|afirmación)[^?.]*(formula|expresa|representa|compara|interpreta|modela)[^?.]*correct|(formula|expresa|representa|compara|interpreta|modela)\s+correctamente|comparación[^?.]*es\s+correcta/i;
export function itemWritingFlags(c: SpecificationCandidate): string[] {
  const sel = c.content.selected;
  if (!sel) return [];
  const out: string[] = [];
  const key = sel.options.find((o) => o.id === sel.answerKey);
  const others = sel.options.filter((o) => o.id !== sel.answerKey);
  const shows = (t: string) => t.includes('=');
  if (key && others.length > 0 && (others.every((o) => key.text.length >= 1.4 * o.text.length) || (shows(key.text) && others.every((o) => !shows(o.text))))) out.push('KEY_UNIQUELY_OBVIOUS');
  const lengths = sel.options.map((o) => o.text.trim().length);
  if (new Set(sel.options.map((o) => shows(o.text))).size > 1 || Math.max(...lengths) > 3 * Math.max(1, Math.min(...lengths))) out.push('OPTIONS_NOT_PARALLEL');
  if (META_STEM.test(c.content.stem)) out.push('STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// one item, revision 3
// ---------------------------------------------------------------------------------------------------------------
export interface SpecificationItemValidationR3 {
  candidateKey: string;
  specificationId: string;
  validatorsRevision: typeof SPECIFICATION_VALIDATORS_REVISION_3;
  kind: typeof SPECIFICATION_AUTOMATED_VALIDATION;
  isHumanReview: false;
  reviewStatus: typeof SPECIFICATION_REVIEW_STATUS;
  /** Revision 2's result for the item, exactly as revision 2 gives it. */
  revision2: SpecificationItemValidation;
  additions: { marks: string[]; commandTerms: string[]; handedOver: string[]; leakage: string[]; itemWritingFlags: string[] };
  /** The gates of revision 3: revision 2's outcome, made worse -- never better -- by the additions. */
  gates: {
    structural: 'PASS' | 'FAIL';
    profileCompliance: 'PASS' | 'FAIL';
    constructPreservation: 'PASS' | 'WEAK' | 'FAIL';
    answerKey: SpecificationItemValidation['answerKey']['outcome'];
    machineRecomputation: SpecificationItemValidation['machineRecomputation']['outcome'];
    stimulusIntegrity: SpecificationItemValidation['stimulusIntegrity']['outcome'];
    originality: SpecificationItemValidation['originality']['outcome'];
    lineage: 'PASS' | 'FAIL';
    learnerTextLeakage: 'PASS' | 'FAIL';
    itemWriting: 'PASS' | 'FLAGGED';
  };
}

export function validateSpecificationCandidateR3(p: { candidate: SpecificationCandidate; specification: AdaptationSpecification; stimulus: CandidateStimulus | null; siblings: readonly SpecificationCandidate[]; extraCorpus?: readonly ComparisonEntry[] }): SpecificationItemValidationR3 {
  const r2 = validateSpecificationCandidate(p);
  const additions = { marks: marksIssues(p.candidate, p.specification), commandTerms: commandTermIssues(p.candidate, p.specification), handedOver: handedOverIssues(p.candidate, p.specification), leakage: leakedSpecificationVocabulary(p.candidate, p.specification, p.stimulus), itemWritingFlags: itemWritingFlags(p.candidate) };
  return {
    candidateKey: p.candidate.candidateKey, specificationId: p.candidate.specificationId, validatorsRevision: SPECIFICATION_VALIDATORS_REVISION_3, kind: SPECIFICATION_AUTOMATED_VALIDATION, isHumanReview: false, reviewStatus: SPECIFICATION_REVIEW_STATUS,
    revision2: r2, additions,
    gates: {
      structural: r2.structural.outcome,
      profileCompliance: r2.profileCompliance.outcome === 'FAIL' || additions.marks.length > 0 || additions.commandTerms.length > 0 ? 'FAIL' : 'PASS',
      constructPreservation: r2.constructPreservation.outcome === 'FAIL' || additions.handedOver.length > 0 ? 'FAIL' : r2.constructPreservation.outcome,
      answerKey: r2.answerKey.outcome, machineRecomputation: r2.machineRecomputation.outcome, stimulusIntegrity: r2.stimulusIntegrity.outcome, originality: r2.originality.outcome, lineage: r2.lineage.outcome,
      learnerTextLeakage: additions.leakage.length > 0 ? 'FAIL' : 'PASS',
      itemWriting: additions.itemWritingFlags.length > 0 ? 'FLAGGED' : 'PASS',
    },
  };
}
