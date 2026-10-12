/**
 * QB-R2E -- the PRE-REGISTERED pass criteria and the code that evaluates them (pure, no IO).
 *
 * Written, and frozen with the validators, BEFORE any provider call. The evaluator below is the only thing that
 * turns results into gate values; it may not be reinterpreted afterwards. Every term it needs is defined here.
 *
 * Source of the criteria: the Orchestrator's text. Where that text is explicit it is followed to the letter; where
 * it is silent the stricter sensible reading was chosen. Each such choice is listed in `CHOICES`, so that it is
 * visible which words are the Orchestrator's and which are this lane's.
 */
import type { SpecificationItemValidationR3 } from '@/lib/exam-core/question-bank/production/specification-validators-r3';

export const R2E_ADAPTATIONS = 20 as const;

export const PRE_REGISTRATION = {
  id: 'qb-r2e-pre-registration', version: '1',
  definitions: {
    ADAPTATION: 'One of the 20 selected adaptation specifications (scripts/operations/qb-r2e/selection.ts, frozen).',
    ATTEMPT_1: 'The first call for an adaptation: its prompt with attempt = 1. Exactly one call. There is NO automatic retry of any kind.',
    ATTEMPT_2: 'The ONE regeneration: the same prompt with attempt = 2 and nothing else (no hint of what failed). Exactly one call. Made if and only if ATTEMPT_1 is REGENERABLE. There is no attempt 3.',
    NO_CANDIDATE: 'An attempt that produced no candidate: no content received (transport failure, timeout, HTTP error), an answer that is not well-formed under the strict schema, or an answer the harness refused by name. A NO_CANDIDATE first attempt is a FAILED first attempt.',
    GATE_FAIL: 'For a candidate, any of: structural FAIL; profileCompliance FAIL; constructPreservation FAIL; answerKey FAILED; machineRecomputation FAIL; stimulusIntegrity FAIL; originality other than PASS_LOW_SIMILARITY; lineage FAIL; learnerTextLeakage FAIL.',
    REGENERABLE: 'ATTEMPT_1 is NO_CANDIDATE or has a GATE_FAIL. An attempt that is only WEAK, FLAGGED or HUMAN_REVIEW_REQUIRED is a result and is NOT regenerated.',
    STRICT_PASS: 'A candidate exists and: structural PASS; profileCompliance PASS; constructPreservation PASS (WEAK is not a strict pass); answerKey MACHINE_VERIFIED, DETERMINISTIC_RULE_VERIFIED or HUMAN_REVIEW_REQUIRED (not FAILED); machineRecomputation PASS or NOT_APPLICABLE; stimulusIntegrity PASS or NOT_APPLICABLE; originality PASS_LOW_SIMILARITY; lineage PASS; learnerTextLeakage PASS; itemWriting PASS (a heuristic FLAG is not a strict pass).',
    FINAL_ATTEMPT: 'ATTEMPT_2 when it was due, otherwise ATTEMPT_1. A regeneration REPLACES the first attempt even when it is worse; there is no best-of-two. An ATTEMPT_2 that was due and not run is NO_CANDIDATE.',
    PER_ITEM_CRITERIA: 'Criteria with denominator 20 other than FIRST_ATTEMPT_STRICT_PASS are measured on the FINAL_ATTEMPT of each adaptation. A FINAL_ATTEMPT that is NO_CANDIDATE fails every one of them. The same counts are ALSO reported for first attempts, for information.',
    SIBLINGS_FOR_ORIGINALITY: 'A first attempt is compared with the first attempts of the other adaptations; a final attempt with the final attempts of the other adaptations. Both are also compared with every QB-R2D candidate and with the QB-R2B and QB-R2C pilot drafts.',
    MATERIAL_ORIGINALITY_FAILURE: 'An originality outcome other than PASS_LOW_SIMILARITY under the existing gate thresholds (textual similarity >= 0.5 is REVIEW, >= 0.8 is REJECT), or the same construct with identical parameter values as another candidate of the fresh batch or of QB-R2D.',
    CLEAN_ITEM_FOR_A_PROOF: 'A FINAL_ATTEMPT candidate with structural PASS (the response contract), profileCompliance PASS, constructPreservation not FAIL, answerKey not FAILED and learnerTextLeakage PASS.',
    SAME_FAMILY_PROOF: 'Adaptations 01-05 (one task family, one invariant hash, five assessment systems). PASS when the five specifications share ONE invariant hash and ONE primary concept, every pair of different systems differs in its specification, and the items of AT LEAST THREE different assessment systems are CLEAN, declare the family\'s construct and carry the invariant hash in their lineage. The number of clean systems (of five) is reported.',
    APPROACH_PROOF: 'The three pairs (06,07) (01,08) (04,09). PASS when in EVERY pair: both items are CLEAN; concept id, invariant hash and declared construct are identical; the two items do NOT share a parameter set; STANDARD is recorded by absence and STEM_PLUS explicitly; every unmet preference carries its overriding rule, and a rule authority exactly when it carries a certification status. AND the school pair differs in response format in specification and items; AND the PAA pair has at least one preference overridden by an OFFICIAL rule while both items keep the same response format.',
    LEAKAGE_COUNT: 'Over ALL attempts: candidates with learnerTextLeakage FAIL, plus attempts the harness refused with RESPONSE_LEAKS_SPECIFICATION_VOCABULARY.',
    ANSWER_FAILURE_COUNT: 'Candidates of ANY attempt with answerKey FAILED, plus adaptations whose FINAL_ATTEMPT is NO_CANDIDATE.',
    REQUEST_REJECTED: 'The very first call of the run is made alone. If the provider rejects the REQUEST itself (an HTTP 4xx: authentication, model, parameters or schema) the run stops, LIVE_PROVIDER is BLOCKED and the run is VOID: no criterion is evaluated and no further call is made. A rejected request is not content. A void run needs a new freeze.',
    NO_MANUAL_REPAIR: 'Every artifact except the recording and the ledger is produced by replaying the recording. No item, key, mark or number is edited by hand. A unit test compares the stored artifacts with a replay, byte for byte.',
  },
  criteria: {
    FIRST_ATTEMPT_STRICT_PASS: { comparator: '>=', threshold: 16, of: 20, measuredOn: 'ATTEMPT_1' },
    STRUCTURAL_COMPLIANCE: { comparator: '=', threshold: 20, of: 20, measuredOn: 'FINAL_ATTEMPT' },
    PROFILE_COMPLIANCE: { comparator: '=', threshold: 20, of: 20, measuredOn: 'FINAL_ATTEMPT' },
    ANSWER_VALIDATION_FAILURES: { comparator: '=', threshold: 0, of: null, measuredOn: 'ALL_ATTEMPTS_AND_FINAL' },
    CONSTRUCT_PRESERVATION_FAIL: { comparator: '=', threshold: 0, of: 20, measuredOn: 'FINAL_ATTEMPT' },
    CONSTRUCT_PRESERVATION_WEAK: { comparator: '<=', threshold: 2, of: 20, measuredOn: 'FINAL_ATTEMPT' },
    LINEAGE_COMPLETENESS: { comparator: '=', threshold: 20, of: 20, measuredOn: 'FINAL_ATTEMPT' },
    STIMULUS_INTEGRITY: { comparator: '=', threshold: 'ALL_APPLICABLE', of: 'ADAPTATIONS_WHOSE_SPECIFICATION_HAS_A_STIMULUS', measuredOn: 'FINAL_ATTEMPT' },
    ORIGINALITY_MATERIAL_FAILURES: { comparator: '=', threshold: 0, of: 20, measuredOn: 'FINAL_ATTEMPT' },
    MULTI_PROFILE_SAME_FAMILY_PROOF: { comparator: '=', threshold: 'PASS', of: null, measuredOn: 'FINAL_ATTEMPT' },
    STANDARD_VS_STEM_PLUS_PROOF: { comparator: '=', threshold: 'PASS', of: null, measuredOn: 'FINAL_ATTEMPT' },
    LEARNER_TEXT_SPECIFICATION_LEAKAGE: { comparator: '=', threshold: 0, of: null, measuredOn: 'ALL_ATTEMPTS' },
    MAX_REGENERATIONS_PER_ADAPTATION: { comparator: '<=', threshold: 1, of: null, measuredOn: 'RUN' },
    NO_MANUAL_CONTENT_REPAIR: { comparator: '=', threshold: 'TRUE', of: null, measuredOn: 'RUN' },
  },
  verdict: 'GENERATOR_READY_FOR_DEV_SCALE is YES only when EVERY criterion above passes. If any fails it is NO. GENERATOR_READY_FOR_PILOT_CONTENT, READY_FOR_BANK_INGESTION and QUESTION_BANK_READY are NO / NO / FAIL whatever the result: nothing here is reviewed, and rights are not established.',
  choices: [
    'STRICT_PASS allows answerKey HUMAN_REVIEW_REQUIRED. This is NOT the strictest reading. Reason: a part whose answer is an interpretation or a justification in words cannot be decided by any rule, so excluding it would make the criterion unattainable by construction for every constructed response with such a part. Such answers are reported separately and are never counted as verified.',
    'STRICT_PASS excludes a heuristic itemWriting FLAG and a constructPreservation WEAK (stricter than "no validator fails").',
    'CONSTRUCT_PRESERVATION "WEAK/HUMAN_REVIEW <= 2/20" is read as: at most 2 FINAL attempts whose constructPreservation gate is WEAK. It is not the count of answers needing human review.',
    'ANSWER_VALIDATION_FAILURES and LEARNER_TEXT_SPECIFICATION_LEAKAGE are counted over ALL attempts, not only final ones (stricter).',
    'A FINAL_ATTEMPT is the regeneration when one was due, even if it is worse than the first attempt (stricter than best-of-two).',
    'No transport retry at all: a call that returns no content is a failed attempt (stricter than the Orchestrator\'s reading, which would allow a transport retry; also what the cumulative budget allows).',
    'A malformed answer is a failed first attempt and its second call is the one regeneration (the Orchestrator\'s stricter reading, adopted).',
    'SAME_FAMILY_PROOF follows the Orchestrator\'s text (at least three systems). All five are attempted and the count is reported; requiring five would be stricter than the text.',
    'A regeneration is made only for a REGENERABLE first attempt, mechanically; an attempt that is merely WEAK or FLAGGED stands.',
    'REQUEST_REJECTED voids the run instead of counting twenty failures: a rejected request shape says nothing about generation.',
  ],
} as const;

// ---------------------------------------------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------------------------------------------
export type AttemptStatus = 'CANDIDATE' | 'NO_CONTENT_RECEIVED' | 'MALFORMED' | 'REFUSED_BY_HARNESS' | 'NOT_RUN';
export interface AttemptResult { attempt: 1 | 2; status: AttemptStatus; refusalCode: string | null; gates: SpecificationItemValidationR3['gates'] | null }
export interface AdaptationResult { selectionKey: string; hasStimulus: boolean; first: AttemptResult; second: AttemptResult | null; /** The gates of the FINAL attempt as scored among final attempts (originality is relative to its siblings). */ finalGates: SpecificationItemValidationR3['gates'] | null }

type Gates = SpecificationItemValidationR3['gates'];
export const hasGateFail = (g: Gates): boolean => g.structural === 'FAIL' || g.profileCompliance === 'FAIL' || g.constructPreservation === 'FAIL' || g.answerKey === 'FAILED' || g.machineRecomputation === 'FAIL' || g.stimulusIntegrity === 'FAIL' || g.originality !== 'PASS_LOW_SIMILARITY' || g.lineage === 'FAIL' || g.learnerTextLeakage === 'FAIL';
export const isStrictPass = (a: AttemptResult): boolean => a.status === 'CANDIDATE' && a.gates !== null && !hasGateFail(a.gates) && a.gates.constructPreservation === 'PASS' && a.gates.itemWriting === 'PASS';
/** The mechanical rule of the one regeneration. */
export const isRegenerable = (first: AttemptResult): boolean => first.status !== 'CANDIDATE' || first.gates === null || hasGateFail(first.gates);
export const finalAttemptOf = (a: AdaptationResult): AttemptResult => (isRegenerable(a.first) ? a.second ?? { attempt: 2, status: 'NOT_RUN', refusalCode: null, gates: null } : a.first);

export interface CriterionResult { criterion: keyof typeof PRE_REGISTRATION.criteria; required: string; observed: string; pass: boolean }
export interface GateEvaluation {
  preRegistration: { id: string; version: string };
  runVoid: boolean;
  criteria: CriterionResult[];
  firstAttemptForInformation: Record<string, string>;
  allHardCriteriaPass: boolean;
  GENERATOR_READY_FOR_DEV_SCALE: 'YES' | 'NO' | 'NOT_EVALUATED_RUN_VOID';
  GENERATOR_READY_FOR_PILOT_CONTENT: 'NO';
  READY_FOR_BANK_INGESTION: 'NO';
  QUESTION_BANK_READY: 'FAIL';
}

export function evaluateGates(p: { adaptations: readonly AdaptationResult[]; sameFamilyProof: 'PASS' | 'FAIL'; approachProof: 'PASS' | 'FAIL'; maxAttemptsObserved: number; artifactsAreAReplay: boolean; runVoid: boolean }): GateEvaluation {
  const A = p.adaptations;
  const finals = A.map((a) => ({ a, f: finalAttemptOf(a), g: finalAttemptOf(a).status === 'CANDIDATE' ? a.finalGates : null }));
  const count = (ok: (g: Gates) => boolean, of: Array<Gates | null>) => of.filter((g) => g !== null && ok(g)).length;
  const firstGates = A.map((a) => (a.first.status === 'CANDIDATE' ? a.first.gates : null));
  const finalGates = finals.map((x) => x.g);
  const attempts = A.flatMap((a) => [a.first, ...(a.second ? [a.second] : [])]);
  const strict = A.filter((a) => isStrictPass(a.first)).length;
  const answerFailures = attempts.filter((t) => t.gates?.answerKey === 'FAILED').length + finals.filter((x) => x.g === null).length;
  const leakage = attempts.filter((t) => t.gates?.learnerTextLeakage === 'FAIL' || t.refusalCode === 'RESPONSE_LEAKS_SPECIFICATION_VOCABULARY').length;
  const withStimulus = finals.filter((x) => x.a.hasStimulus);
  const stimulusOk = withStimulus.filter((x) => x.g !== null && x.g.stimulusIntegrity === 'PASS').length;
  const constructFail = finals.filter((x) => x.g === null || x.g.constructPreservation === 'FAIL').length;
  const constructWeak = count((g) => g.constructPreservation === 'WEAK', finalGates);
  const originalityFailures = finals.filter((x) => x.g === null || x.g.originality !== 'PASS_LOW_SIMILARITY').length;
  const n = A.length;
  const row = (criterion: CriterionResult['criterion'], required: string, observed: string, pass: boolean): CriterionResult => ({ criterion, required, observed, pass });
  const criteria: CriterionResult[] = [
    row('FIRST_ATTEMPT_STRICT_PASS', '>= 16/20', `${strict}/${n}`, n === R2E_ADAPTATIONS && strict >= 16),
    row('STRUCTURAL_COMPLIANCE', '20/20', `${count((g) => g.structural === 'PASS', finalGates)}/${n}`, n === R2E_ADAPTATIONS && count((g) => g.structural === 'PASS', finalGates) === 20),
    row('PROFILE_COMPLIANCE', '20/20', `${count((g) => g.profileCompliance === 'PASS', finalGates)}/${n}`, n === R2E_ADAPTATIONS && count((g) => g.profileCompliance === 'PASS', finalGates) === 20),
    row('ANSWER_VALIDATION_FAILURES', '0', String(answerFailures), answerFailures === 0),
    row('CONSTRUCT_PRESERVATION_FAIL', '0', String(constructFail), constructFail === 0),
    row('CONSTRUCT_PRESERVATION_WEAK', '<= 2/20', `${constructWeak}/${n}`, constructWeak <= 2),
    row('LINEAGE_COMPLETENESS', '20/20', `${count((g) => g.lineage === 'PASS', finalGates)}/${n}`, n === R2E_ADAPTATIONS && count((g) => g.lineage === 'PASS', finalGates) === 20),
    row('STIMULUS_INTEGRITY', 'all applicable', `${stimulusOk}/${withStimulus.length}`, stimulusOk === withStimulus.length),
    row('ORIGINALITY_MATERIAL_FAILURES', '0', String(originalityFailures), originalityFailures === 0),
    row('MULTI_PROFILE_SAME_FAMILY_PROOF', 'PASS', p.sameFamilyProof, p.sameFamilyProof === 'PASS'),
    row('STANDARD_VS_STEM_PLUS_PROOF', 'PASS', p.approachProof, p.approachProof === 'PASS'),
    row('LEARNER_TEXT_SPECIFICATION_LEAKAGE', '0', String(leakage), leakage === 0),
    row('MAX_REGENERATIONS_PER_ADAPTATION', '<= 1 (at most two attempts)', `${Math.max(0, p.maxAttemptsObserved - 1)}`, p.maxAttemptsObserved <= 2 && A.every((a) => a.second === null || isRegenerable(a.first))),
    row('NO_MANUAL_CONTENT_REPAIR', 'TRUE', p.artifactsAreAReplay ? 'TRUE' : 'FALSE', p.artifactsAreAReplay),
  ];
  const all = criteria.every((c) => c.pass);
  return {
    preRegistration: { id: PRE_REGISTRATION.id, version: PRE_REGISTRATION.version }, runVoid: p.runVoid, criteria,
    firstAttemptForInformation: {
      candidates: `${firstGates.filter((g) => g !== null).length}/${n}`, structural: `${count((g) => g.structural === 'PASS', firstGates)}/${n}`, profileCompliance: `${count((g) => g.profileCompliance === 'PASS', firstGates)}/${n}`,
      constructFail: String(firstGates.filter((g) => g === null || g.constructPreservation === 'FAIL').length), constructWeak: String(count((g) => g.constructPreservation === 'WEAK', firstGates)), lineage: `${count((g) => g.lineage === 'PASS', firstGates)}/${n}`,
      itemWritingFlagged: String(count((g) => g.itemWriting === 'FLAGGED', firstGates)), answerHumanReviewRequired: String(count((g) => g.answerKey === 'HUMAN_REVIEW_REQUIRED', firstGates)), regenerable: String(A.filter((a) => isRegenerable(a.first)).length),
    },
    allHardCriteriaPass: !p.runVoid && all,
    GENERATOR_READY_FOR_DEV_SCALE: p.runVoid ? 'NOT_EVALUATED_RUN_VOID' : all ? 'YES' : 'NO',
    GENERATOR_READY_FOR_PILOT_CONTENT: 'NO', READY_FOR_BANK_INGESTION: 'NO', QUESTION_BANK_READY: 'FAIL',
  };
}
