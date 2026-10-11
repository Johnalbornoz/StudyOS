/**
 * QB-R2C -- the INDEPENDENT automated validators (pure, no IO).
 *
 * They read a candidate as an outsider would. Two rules keep them independent of the generator:
 *   1. this module imports nothing from `generator/`, and `generator/` imports nothing from here (a test checks both);
 *   2. nothing the generator SET is trusted as a fact. The cell, the stimulus plan and the concept profile are
 *      given by the caller from the plan; what the candidate says about itself (its plan id, its slot, its key,
 *      its declared arithmetic, the stimulus values it says it uses) is CHECKED against them, never believed.
 *
 * Every result carries `kind: 'AUTOMATED_VALIDATION'`. None of this is a review, and no name or type here says
 * it is: a qualified person still has to read every item. In particular:
 *   - ANSWER CORRECTNESS is machine-verified only where arithmetic decides it: the candidate's declared
 *     expression is recomputed by an independent evaluator and compared with the key. That proves the key equals
 *     the declared arithmetic -- not that the arithmetic is the right model of the stem. Every other item is
 *     reported NOT_MACHINE_VERIFIABLE. It is never reported valid.
 *   - CONCEPT FIDELITY is a lexical HEURISTIC over the profile's markers (PASS / WEAK / FAIL). It can be fooled
 *     both ways and it does not understand the question.
 *   - ORIGINALITY is the existing lexical shingle gate, with the template's fixed instruction removed from the
 *     compared text. It does not detect paraphrase.
 */
import { isResponseCorrect, normalizeStudentResponse, numericKeyValue, rationalToNumber, spanishFormOf, validateNumericAnswerKey } from './answer-normalization';
import type { ConceptProfile } from './concept-profile';
import { evaluateExpression, ExpressionError, nearlyEqual } from './expression-evaluator';
import { lineageGaps, type CandidateStimulus, type QuestionCandidate } from './generation-contract';
import { evaluateOriginality, type ComparisonEntry, type OriginalityGateResult, type OriginalityThresholds } from './originality-gate';
import type { RequirementCell } from './requirement-cell';
import { renderStructuredAssets, structuredNumbers, structuredStimulusViolations, TEXT_STIMULUS_KINDS } from './stimulus-spec';
import type { StimulusPlan } from './stimulus-plan';

export const AUTOMATED_VALIDATION = 'AUTOMATED_VALIDATION' as const;
export const INDEPENDENT_VALIDATORS = ['ANSWER_CORRECTNESS', 'CONCEPT_FIDELITY_HEURISTIC', 'RESPONSE_FORMAT', 'STIMULUS_INTEGRITY', 'ORIGINALITY', 'POOL_INTEGRITY', 'ANSWER_NORMALIZATION_ROUND_TRIP', 'LINEAGE_COMPLETENESS'] as const;
export type IndependentValidator = (typeof INDEPENDENT_VALIDATORS)[number];

export interface AutomatedValidationResult<O extends string = string> {
  kind: typeof AUTOMATED_VALIDATION;
  validator: IndependentValidator;
  outcome: O;
  issues: string[];
}
const result = <O extends string>(validator: IndependentValidator, outcome: O, issues: string[] = []): AutomatedValidationResult<O> => ({ kind: AUTOMATED_VALIDATION, validator, outcome, issues });

// ---------------------------------------------------------------------------------------------------------------
// answer correctness
// ---------------------------------------------------------------------------------------------------------------
export type AnswerCorrectnessOutcome = 'MACHINE_VERIFIED' | 'NOT_MACHINE_VERIFIABLE' | 'FAILED';

/** The one number an option states ("45 %", "x = 3", "12 cm", "3/4"), or null when it states none or several. */
export function numericValueOfOptionText(text: string): number | null {
  const t = text.replace(/[−–]/g, '-').replace(/[²³]/g, '');
  const tokens = t.match(/-?\d+(?:[.,]\d+)*(?:\s*\/\s*\d+)?/g) ?? [];
  if (tokens.length !== 1) return null;
  const parsed = normalizeStudentResponse(tokens[0]);
  return parsed.ok && parsed.readings.length === 1 ? rationalToNumber(parsed.readings[0].value) : null;
}

/**
 * Recomputes the key from the candidate's declared arithmetic. `requiresAnswerCheck` is supplied by the exam's own
 * module (which cells are mathematics): this module knows no exam.
 */
export function validateAnswerCorrectness(candidate: QuestionCandidate, ctx: { requiresAnswerCheck: boolean }): AutomatedValidationResult<AnswerCorrectnessOutcome> & { computed: number | null } {
  const out = (outcome: AnswerCorrectnessOutcome, issues: string[], computed: number | null = null) => ({ ...result('ANSWER_CORRECTNESS', outcome, issues), computed });
  const check = candidate.answerCheck;
  if (!check) return ctx.requiresAnswerCheck ? out('FAILED', ['ANSWER_CHECK_MISSING']) : out('NOT_MACHINE_VERIFIABLE', ['NO_ARITHMETIC_DECIDES_THE_ANSWER']);
  if (check.kind === 'NOT_COMPUTABLE') return out('NOT_MACHINE_VERIFIABLE', ['DECLARED_NOT_COMPUTABLE']);
  let computed: number;
  try {
    computed = evaluateExpression(check.expression);
  } catch (e) {
    return out('FAILED', [`EXPRESSION_ERROR:${e instanceof ExpressionError ? e.code : 'UNKNOWN'}`]);
  }
  if (candidate.responseFormat === 'STUDENT_PRODUCED') {
    const key = validateNumericAnswerKey(candidate.numericKey);
    if (!key.ok) return out('FAILED', ['NUMERIC_KEY_MISSING_OR_MALFORMED'], computed);
    const target = rationalToNumber(numericKeyValue(key.key).value);
    const dp = key.key.decimalPlaces;
    const ok = dp !== undefined ? nearlyEqual(Math.round(computed * 10 ** dp + Math.sign(computed) * 1e-9) / 10 ** dp, target) : key.key.tolerance !== undefined ? Math.abs(computed - target) <= Number(key.key.tolerance) + 1e-9 : nearlyEqual(computed, target);
    return ok ? out('MACHINE_VERIFIED', [], computed) : out('FAILED', ['KEY_DOES_NOT_MATCH_COMPUTATION'], computed);
  }
  const keyed = candidate.options.find((o) => o.id === candidate.answerKey);
  if (!keyed) return out('FAILED', ['KEY_IS_NOT_AN_OPTION'], computed);
  const keyedValue = numericValueOfOptionText(keyed.text);
  if (keyedValue === null) return out('NOT_MACHINE_VERIFIABLE', ['KEYED_OPTION_IS_NOT_A_SINGLE_NUMBER'], computed);
  if (!nearlyEqual(keyedValue, computed)) return out('FAILED', ['KEY_DOES_NOT_MATCH_COMPUTATION'], computed);
  // one defensible answer: no other option may state the computed value
  const also = candidate.options.filter((o) => o.id !== candidate.answerKey && (() => { const v = numericValueOfOptionText(o.text); return v !== null && nearlyEqual(v, computed); })());
  return also.length > 0 ? out('FAILED', [`ANOTHER_OPTION_STATES_THE_COMPUTED_VALUE:${also.map((o) => o.id).join(',')}`], computed) : out('MACHINE_VERIFIED', [], computed);
}

// ---------------------------------------------------------------------------------------------------------------
// concept fidelity (heuristic)
// ---------------------------------------------------------------------------------------------------------------
export type ConceptFidelityOutcome = 'PASS' | 'WEAK' | 'FAIL';
export const CONCEPT_FIDELITY_HEURISTIC = { id: 'studyus-marker-fidelity-heuristic', version: '1', rule: 'FAIL: wrong PRIMARY, or no evidence marker and a foreign one. PASS: at least one evidence marker and more evidence than foreign markers. WEAK: everything else.' } as const;
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A lexical heuristic: which of the profile's markers occur in the stem and the rationale. It does not understand the item. */
export function validateConceptFidelity(candidate: QuestionCandidate, cell: Pick<RequirementCell, 'primaryConcept'>, profile: ConceptProfile | null): AutomatedValidationResult<ConceptFidelityOutcome> & { isHeuristic: true; evidenceHits: string[]; foreignHits: string[] } {
  const base = { isHeuristic: true as const, evidenceHits: [] as string[], foreignHits: [] as string[] };
  if (candidate.primaryConceptStableId !== cell.primaryConcept.stableId) return { ...result('CONCEPT_FIDELITY_HEURISTIC', 'FAIL', ['PRIMARY_IS_NOT_THE_CELLS']), ...base };
  if (!profile || profile.conceptStableId !== cell.primaryConcept.stableId) return { ...result('CONCEPT_FIDELITY_HEURISTIC', 'FAIL', ['PROFILE_MISSING_OR_FOR_ANOTHER_CONCEPT']), ...base };
  const text = fold([candidate.stem, candidate.rationale].join(' \n '));
  const evidenceHits = profile.evidenceMarkers.filter((m) => text.includes(fold(m)));
  const foreignHits = profile.foreignMarkers.filter((m) => text.includes(fold(m)));
  const outcome: ConceptFidelityOutcome = evidenceHits.length === 0 && foreignHits.length > 0 ? 'FAIL' : evidenceHits.length >= 1 && evidenceHits.length > foreignHits.length ? 'PASS' : 'WEAK';
  const issues = outcome === 'PASS' ? [] : [evidenceHits.length === 0 ? 'NO_EVIDENCE_MARKER' : 'FOREIGN_MARKERS_NOT_OUTNUMBERED'];
  return { ...result('CONCEPT_FIDELITY_HEURISTIC', outcome, issues), isHeuristic: true, evidenceHits, foreignHits };
}

// ---------------------------------------------------------------------------------------------------------------
// response format
// ---------------------------------------------------------------------------------------------------------------
const CATCH_ALL_OPTION = /^(todas las anteriores|ninguna de las anteriores|all of the above|none of the above)\.?$/i;

export function validateResponseFormat(candidate: QuestionCandidate, cell: Pick<RequirementCell, 'responseFormat'>, ctx: { optionIds: readonly string[] }): AutomatedValidationResult<'PASS' | 'FAIL'> {
  const issues: string[] = [];
  if (candidate.responseFormat !== cell.responseFormat) issues.push('FORMAT_IS_NOT_THE_CELLS');
  if (candidate.responseFormat === 'MULTIPLE_CHOICE') {
    if (candidate.options.length !== ctx.optionIds.length || candidate.options.some((o, i) => o.id !== ctx.optionIds[i])) issues.push('OPTION_IDS_DO_NOT_FIT');
    if (!candidate.options.some((o) => o.id === candidate.answerKey)) issues.push('KEY_IS_NOT_AN_OPTION');
    if (new Set(candidate.options.map((o) => fold(o.text).replace(/\s+/g, ' ').trim())).size !== candidate.options.length) issues.push('DUPLICATE_OPTION_TEXT');
    if (candidate.options.some((o) => CATCH_ALL_OPTION.test(o.text.trim()))) issues.push('CATCH_ALL_OPTION');
    const wrong = candidate.options.filter((o) => o.id !== candidate.answerKey).map((o) => o.id).sort();
    if (JSON.stringify(Object.keys(candidate.distractorRationales).sort()) !== JSON.stringify(wrong)) issues.push('DISTRACTOR_RATIONALES_DO_NOT_COVER_THE_WRONG_OPTIONS');
    if (candidate.numericKey) issues.push('NUMERIC_KEY_ON_MULTIPLE_CHOICE');
  } else {
    if (candidate.options.length > 0) issues.push('STUDENT_PRODUCED_HAS_OPTIONS');
    const key = validateNumericAnswerKey(candidate.numericKey);
    if (!key.ok) issues.push('NUMERIC_KEY_MISSING_OR_MALFORMED');
    else if (key.key.value !== candidate.answerKey) issues.push('ANSWER_KEY_IS_NOT_THE_NUMERIC_KEY_VALUE');
  }
  if (candidate.instruction && candidate.stem.includes(candidate.instruction)) issues.push('STEM_REPEATS_THE_FIXED_INSTRUCTION');
  return result('RESPONSE_FORMAT', issues.length === 0 ? 'PASS' : 'FAIL', issues);
}

// ---------------------------------------------------------------------------------------------------------------
// stimulus integrity
// ---------------------------------------------------------------------------------------------------------------
const squash = (s: string): string => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
/** Text a stem quotes: between « », “ ” or straight double quotes. */
export const quotedSpans = (stem: string): string[] => [...stem.matchAll(/«([^»]+)»|“([^”]+)”|"([^"]+)"/g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim()).filter((s) => s.length > 0);
const NUMBERED_REFERENCE = /\b(oraci[oó]n(?:es)?|sentences?|versos?|lines?|l[ií]neas?|p[aá]rrafos?|paragraphs?|estrofas?|stanzas?)\s+(\d+)(?:\s*(?:y|and|,|-|a|to)\s*(\d+))?/gi;
const numbersIn = (s: string): number[] => (s.replace(/[−–]/g, '-').match(/\d+(?:[.,]\d+)?/g) ?? []).map((t) => Number(t.replace(',', '.')));

/**
 * Does the question really sit on its plan's stimulus? `plan` is the stimulus plan of the generation plan that
 * holds the candidate's slot (null when the plan has none for it) -- supplied by the caller, not read from the
 * candidate.
 */
export function validateStimulusIntegrity(candidate: QuestionCandidate, cell: Pick<RequirementCell, 'stimulus' | 'cellKey'>, stimulus: CandidateStimulus | null, plan: StimulusPlan | null): AutomatedValidationResult<'PASS' | 'FAIL'> {
  const issues: string[] = [];
  if (candidate.stimulusKey !== null && !stimulus) issues.push('STIMULUS_NOT_FOUND');
  if (cell.stimulus.class === 'STIMULUS_REQUIRED' && candidate.stimulusKey === null) issues.push('STIMULUS_MISSING');
  if (cell.stimulus.class === 'STANDALONE' && candidate.stimulusKey !== null) issues.push('UNREQUESTED_STIMULUS');
  if (cell.stimulus.class === 'STIMULUS_REQUIRED' && !plan) issues.push('NO_STIMULUS_PLAN_FOR_THE_SLOT');
  if (plan) {
    if (!candidate.slotKey || !plan.memberSlots.some((s) => s.slotKey === candidate.slotKey)) issues.push('SLOT_IS_NOT_IN_THE_STIMULUS_PLAN');
    if (candidate.stimulusPlanId !== plan.stimulusPlanId) issues.push('CANDIDATE_NAMES_ANOTHER_STIMULUS_PLAN');
    if (stimulus && stimulus.stimulusPlanId !== plan.stimulusPlanId) issues.push('STIMULUS_IS_OF_ANOTHER_PLAN');
    if (stimulus && stimulus.kind !== plan.stimulusKind) issues.push('STIMULUS_KIND_IS_NOT_THE_PLANS');
    if (stimulus && stimulus.language !== plan.language) issues.push('STIMULUS_LANGUAGE_IS_NOT_THE_PLANS');
  } else if (candidate.stimulusPlanId) issues.push('CANDIDATE_NAMES_A_PLAN_THE_PLAN_DOES_NOT_HAVE');
  if (stimulus) {
    if (cell.stimulus.class !== 'STANDALONE' && stimulus.kind !== cell.stimulus.kind) issues.push('STIMULUS_KIND_IS_NOT_THE_CELLS');
    for (const v of structuredStimulusViolations(stimulus.kind, stimulus.structured)) issues.push(`STRUCTURED:${v}`);
    // the stored assets are DERIVED: rendering the specification again must give the same bytes
    if (stimulus.structured) {
      let fresh: string;
      try {
        fresh = JSON.stringify(renderStructuredAssets(stimulus.structured, stimulus.language));
      } catch {
        fresh = 'NOT_RENDERABLE';
      }
      if (fresh !== JSON.stringify(stimulus.renderedAssets ?? [])) issues.push('RENDERED_ASSETS_ARE_NOT_THE_SPECIFICATIONS');
    } else if ((stimulus.renderedAssets ?? []).length > 0) issues.push('RENDERED_ASSET_WITHOUT_A_SPECIFICATION');
    // text: what the stem quotes is in the text, and the sentence / line / paragraph it cites exists
    const textParts = stimulus.parts.filter((p) => p.partKind === 'TEXT' || p.partKind === 'NUMBERED_TEXT' || p.partKind === 'VERSE');
    const whole = squash(textParts.map((p) => p.text).join(' '));
    if (textParts.length > 0) for (const span of quotedSpans(candidate.stem)) if (!whole.includes(squash(span))) issues.push(`QUOTED_SPAN_NOT_IN_STIMULUS:${span.slice(0, 40)}`);
    if (TEXT_STIMULUS_KINDS.has(stimulus.kind) || textParts.length > 0) {
      const labels = (kinds: string[]) => textParts.filter((p) => kinds.includes(p.partKind)).map((p) => Number(p.label)).filter((n) => Number.isInteger(n));
      for (const m of candidate.stem.matchAll(NUMBERED_REFERENCE)) {
        const word = fold(m[1]);
        const pool = /^(oracion|sentence)/.test(word) ? labels(['NUMBERED_TEXT']) : /^(verso|line)/.test(word) ? labels(['VERSE']) : /^(parrafo|paragraph)/.test(word) ? labels(['TEXT']) : null;
        if (pool === null) continue;
        for (const n of [m[2], m[3]].filter(Boolean).map(Number)) if (!pool.includes(n)) issues.push(`CITED_PART_DOES_NOT_EXIST:${m[1]} ${n}`);
      }
    }
    // data: the numbers the question says it relies on are in the data, and are really used
    if (stimulus.structured) {
      const data = structuredNumbers(stimulus.structured);
      const declared = candidate.usesStimulusValues ?? [];
      if (declared.length === 0) issues.push('NO_STIMULUS_VALUE_DECLARED');
      const used = numbersIn([candidate.stem, candidate.rationale, candidate.answerCheck?.kind === 'ARITHMETIC_EXPRESSION' ? candidate.answerCheck.expression : ''].join(' '));
      for (const v of declared) {
        if (!data.some((d) => nearlyEqual(d, v))) issues.push(`DECLARED_VALUE_IS_NOT_IN_THE_DATA:${v}`);
        else if (!used.some((u) => nearlyEqual(u, v))) issues.push(`DECLARED_VALUE_IS_NOT_USED:${v}`);
      }
    }
  }
  return result('STIMULUS_INTEGRITY', issues.length === 0 ? 'PASS' : 'FAIL', issues);
}

// ---------------------------------------------------------------------------------------------------------------
// originality (existing gate; boilerplate excluded)
// ---------------------------------------------------------------------------------------------------------------
/** Stem and options without any template-fixed instruction sentence: boilerplate is not content. */
export function comparableTextWithoutBoilerplate(c: Pick<QuestionCandidate, 'stem' | 'options'>, fixedSentences: readonly string[]): string {
  let stem = c.stem;
  for (const f of fixedSentences) stem = stem.split(f).join(' ');
  return [stem, ...c.options.map((o) => o.text)].join(' \n ');
}

export function validateOriginality(candidate: QuestionCandidate, siblings: readonly QuestionCandidate[], ctx: { fixedSentences: readonly string[]; extraCorpus?: readonly ComparisonEntry[]; thresholds?: OriginalityThresholds }): AutomatedValidationResult<OriginalityGateResult['outcome']> & { gate: OriginalityGateResult } {
  const corpus: ComparisonEntry[] = [...siblings.filter((s) => s.candidateKey !== candidate.candidateKey).map((s) => ({ source: 'GENERATION_BATCH_SIBLING' as const, key: s.candidateKey, comparisonPermitted: true, text: comparableTextWithoutBoilerplate(s, ctx.fixedSentences) })), ...(ctx.extraCorpus ?? [])];
  const gate = evaluateOriginality({ text: comparableTextWithoutBoilerplate(candidate, ctx.fixedSentences) }, corpus, ctx.thresholds);
  return { ...result('ORIGINALITY', gate.outcome, gate.outcome === 'PASS_LOW_SIMILARITY' ? [] : [`CLOSEST:${gate.closest?.key ?? ''}`]), gate };
}

// ---------------------------------------------------------------------------------------------------------------
// pool integrity
// ---------------------------------------------------------------------------------------------------------------
export interface PoolIntegrityReport extends AutomatedValidationResult<'PASS' | 'FAIL'> {
  stimuli: Array<{ stimulusKey: string; stimulusPlanId: string | null; planPool: string | null; candidatePools: string[]; candidates: number; ok: boolean }>;
  /** Stimuli whose questions are not all in one pool, or not in their plan's pool. */
  stimulusPoolViolations: number;
}

/** ONE_STIMULUS_PLAN = ONE_POOL, checked on what was generated: the pools are read from the CELLS, the plan from the caller. */
export function validatePoolIntegrity(candidates: readonly QuestionCandidate[], stimuli: readonly CandidateStimulus[], cellOf: (cellKey: string) => RequirementCell | undefined, planOfSlot: (slotKey: string) => StimulusPlan | null): PoolIntegrityReport {
  const issues: string[] = [];
  const rows = stimuli.map((st) => {
    const members = candidates.filter((c) => c.stimulusKey === st.stimulusKey);
    const candidatePools = [...new Set(members.map((c) => cellOf(c.cellKey)?.intendedPool ?? 'UNKNOWN_CELL'))].sort();
    const plans = [...new Set(members.map((c) => (c.slotKey ? planOfSlot(c.slotKey)?.stimulusPlanId ?? null : null)))];
    const plan = members[0]?.slotKey ? planOfSlot(members[0].slotKey) : null;
    const ok = members.length > 0 && candidatePools.length === 1 && plans.length === 1 && (plan === null ? members.length === 1 : candidatePools[0] === plan.intendedPool && members.every((c) => plan.memberSlots.some((s) => s.slotKey === c.slotKey)));
    if (!ok) issues.push(`STIMULUS_POOL_VIOLATION:${st.stimulusKey}`);
    return { stimulusKey: st.stimulusKey, stimulusPlanId: plan?.stimulusPlanId ?? null, planPool: plan?.intendedPool ?? null, candidatePools, candidates: members.length, ok };
  });
  return { ...result('POOL_INTEGRITY', issues.length === 0 ? 'PASS' : 'FAIL', issues), stimuli: rows, stimulusPoolViolations: rows.filter((r) => !r.ok).length };
}

// ---------------------------------------------------------------------------------------------------------------
// answer normalisation round trip, lineage
// ---------------------------------------------------------------------------------------------------------------
/** A student-produced key must grade itself correct in both decimal conventions, and a different number incorrect. */
export function validateAnswerNormalizationRoundTrip(candidate: QuestionCandidate): AutomatedValidationResult<'PASS' | 'FAIL' | 'NOT_APPLICABLE'> {
  if (candidate.responseFormat !== 'STUDENT_PRODUCED') return result('ANSWER_NORMALIZATION_ROUND_TRIP', 'NOT_APPLICABLE');
  const key = validateNumericAnswerKey(candidate.numericKey);
  if (!key.ok) return result('ANSWER_NORMALIZATION_ROUND_TRIP', 'FAIL', ['NUMERIC_KEY_MISSING_OR_MALFORMED']);
  const issues: string[] = [];
  if (isResponseCorrect(key.key, key.key.value).outcome !== 'CORRECT') issues.push('KEY_DOES_NOT_GRADE_ITSELF_CORRECT');
  if (isResponseCorrect(key.key, spanishFormOf(key.key)).outcome !== 'CORRECT') issues.push('KEY_IN_DECIMAL_COMMA_IS_NOT_CORRECT');
  if (isResponseCorrect(key.key, `  ${key.key.value} `).outcome !== 'CORRECT') issues.push('WHITESPACE_CHANGES_THE_VERDICT');
  const other = String(Math.round(rationalToNumber(numericKeyValue(key.key).value)) + 1000);
  if (isResponseCorrect(key.key, other).outcome !== 'INCORRECT') issues.push('A_DIFFERENT_NUMBER_IS_NOT_INCORRECT');
  return result('ANSWER_NORMALIZATION_ROUND_TRIP', issues.length === 0 ? 'PASS' : 'FAIL', issues);
}

export function validateLineageCompleteness(candidate: QuestionCandidate): AutomatedValidationResult<'PASS' | 'FAIL'> {
  const gaps = lineageGaps(candidate.lineage);
  if (candidate.lineage.kind === 'MODEL' && candidate.lineage.requirementCellKey !== undefined && candidate.lineage.requirementCellKey !== candidate.cellKey) gaps.push('LINEAGE_CELL_IS_NOT_THE_CANDIDATES');
  return result('LINEAGE_COMPLETENESS', gaps.length === 0 ? 'PASS' : 'FAIL', gaps.map((g) => `LINEAGE:${g}`));
}
