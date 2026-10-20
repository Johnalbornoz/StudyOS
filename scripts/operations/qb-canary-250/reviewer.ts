/**
 * QUESTION FACTORY CANARY 250 -- the INDEPENDENT STUDYUS AI REVIEWER (pure: no network, no clock, no file IO). FROZEN.
 *
 * THIS IS AN AI REVIEW. It is not a human review, it grants no approval in the Question Bank sense, and it changes
 * no lifecycle. Every artifact that carries it is labelled AI_REVIEW, and the review status of every candidate stays
 * BLOCKED_NO_QUALIFIED_REVIEWER. "APPROVED" below is the name of an AI classification of a canary, nothing more.
 *
 * INDEPENDENCE. The reviewer is another model of another provider than the generator, and it is not shown what the
 * generator said ABOUT its item (see `redactForReview`). It is shown the item, the key and the mark scheme -- it
 * needs the key to judge it -- and it must solve the item itself before it looks at the key.
 *
 * NO REPAIR. The reviewer judges; it does not rewrite. A response that carries a replacement stem, key, option or
 * item is refused whole (REVIEW_CONTAINS_A_REPLACEMENT_ITEM) and is a reviewer failure, not a review.
 *
 * THE DECISION POLICY is code (`decide`), not the model's word: the model proposes a classification, and the policy
 * may only make it stricter. A deterministic validator failure is never silently overridden.
 */
import { z } from 'zod';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import type { SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { hasGateFail } from '../qb-r2e/gates';

export const REVIEWER_VERSION = { id: 'studyus-ai-item-reviewer', version: '1', promptVersion: '1', schemaVersion: '1', redactionVersion: '1', decisionPolicyVersion: '1' } as const;
/**
 * THE REVIEWER MODEL. Another provider and another model family than the generator (OpenAI gpt-5.6-luna), called
 * directly from the lane (the repository's AI gateway is bypassed and sees nothing of it, as for the generator).
 * Thinking is OFF, so that everything the model writes is the structured answer: its cost is bounded and
 * predictable, and its reasoning is the `worked` solution it must write first. No fallback model: a refusal by the
 * provider is a reviewer failure, so that every review is by the one model named here.
 */
export const REVIEWER_RUN_PARAMETERS = { provider: 'anthropic', endpoint: 'messages', apiVersion: '2023-06-01', model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' }, effort: 'medium', responseMode: 'STRICT_JSON_SCHEMA (output_config.format)', fallbacks: 'NONE', retries: 0, gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' } as const;
export const AI_REVIEW_KIND = 'AI_REVIEW' as const;
export const AI_REVIEW_LABEL = 'AI_REVIEW -- an automated review by a model; NOT a human review; grants no approval; changes no lifecycle; review status stays BLOCKED_NO_QUALIFIED_REVIEWER' as const;
export const REVIEW_STATUS_UNCHANGED = 'BLOCKED_NO_QUALIFIED_REVIEWER' as const;

export const REVIEW_DIMENSIONS = ['ACADEMIC_CORRECTNESS', 'CONSTRUCT_VALIDITY', 'PROFILE_FIDELITY', 'RESPONSE_CONTRACT', 'DIFFICULTY', 'LEARNER_QUALITY', 'STIMULUS_INTEGRITY', 'ORIGINALITY', 'FAIRNESS_AMBIGUITY', 'LINEAGE_CONSISTENCY'] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];
export const REVIEW_VERDICTS = ['PASS', 'CONCERN', 'FAIL', 'NOT_APPLICABLE'] as const;
export const AI_CLASSIFICATIONS = ['APPROVED', 'NEEDS_HUMAN_REVIEW', 'REJECTED'] as const;
export type AiClassification = (typeof AI_CLASSIFICATIONS)[number];
export const KEY_AGREEMENTS = ['AGREES', 'DISAGREES', 'CANNOT_DETERMINE'] as const;

export const DIMENSION_QUESTIONS: Readonly<Record<ReviewDimension, string>> = {
  ACADEMIC_CORRECTNESS: 'Is the mathematics right and is the key (every keyed answer, every mark point) correct? Judge it against YOUR OWN solution.',
  CONSTRUCT_VALIDITY: 'Does answering the item require exactly the concept and the evidence actions of the evidence target -- nothing given away, nothing else measured instead?',
  PROFILE_FIDELITY: 'Does the item respect the assessment profile and component as the specification records them (response format, tool policy, numeric profile, language, command terms, marks)? Judge against the specification only; you have no other knowledge of the examination to apply as fact.',
  RESPONSE_CONTRACT: 'Can the response be given and scored as the format demands: exactly one correct option and defensible distractors; one unambiguous number with a stated form; parts whose marks and mark points fit what is asked?',
  DIFFICULTY: 'Is the demand consistent with the specification\'s difficulty band and reasoning depth?',
  LEARNER_QUALITY: 'Is the item clear, natural and well written for a learner, in the specification\'s language, with a plausible situation and no trace of authoring instructions?',
  STIMULUS_INTEGRITY: 'When there is a stimulus: is it internally consistent, sufficient, necessary, and free of the answer? NOT_APPLICABLE when the specification asks for none and none is present.',
  ORIGINALITY: 'Does the item look like StudyUs\'s own writing rather than a recognisable published examination question? You are shown no corpus: report only what you recognise, and say so.',
  FAIRNESS_AMBIGUITY: 'Is there one reading only, no second defensible answer, no cultural, regional or linguistic barrier unrelated to the construct?',
  LINEAGE_CONSISTENCY: 'Do the lineage and the specification agree with each other and with the item (concept, family, approach, profile, component, specification id)?',
};

export const REVIEWER_SYSTEM_TEXT = [
  'You are the StudyUs independent item reviewer. You review ONE mathematics assessment item that another system wrote. You did not write it and you owe it nothing.',
  'Work in this order. FIRST solve the item yourself from the learner-facing text and the stimulus alone, without looking at the key: write your working and your answer to every part in independentSolution. ONLY THEN compare your answers with the key and the mark scheme, and say whether they agree.',
  'Then give a verdict on each of the ten dimensions: PASS, CONCERN, FAIL or NOT_APPLICABLE, each with one short reason that cites what in the item it rests on. CONCERN means a defect or doubt a qualified person should look at; FAIL means the item must not be used as it is.',
  'The deterministic validator results are given to you as evidence, not as authority: check them, and say so when you disagree with one.',
  'You judge. You do NOT repair: never write a corrected stem, key, option, mark scheme or item, and never propose replacement wording. Say what is wrong, not what to write instead.',
  'Finally propose a classification: APPROVED (every dimension passes and your solution agrees with the key), NEEDS_HUMAN_REVIEW (a doubt you cannot settle), or REJECTED (a failure). When and only when you propose NEEDS_HUMAN_REVIEW, write in reviewerQuestion exactly ONE precise question a qualified human reviewer should answer; otherwise reviewerQuestion is null.',
  'Be brief: the worked solution in at most 120 words, the comparison and each reason in at most 30 words.',
  'You are an AI reviewer. Your classification is not a human review and approves nothing for use. Answer with the JSON object only.',
].join('\n');

// ---------------------------------------------------------------------------------------------------------------
// redaction: what of the candidate the reviewer sees
// ---------------------------------------------------------------------------------------------------------------
/** Members of the generator's output that are its OWN ACCOUNT of the item. None of them reaches the reviewer. */
export const REDACTED_GENERATOR_FIELDS = [
  'content.rationale', 'content.declaredModel', 'content.context.description', 'content.usesStimulusValues', 'content.proposedSupportingConceptStableIds',
  'content.selected.distractors', 'content.selected.target', 'content.selected.answerCheck', 'content.numeric.target', 'content.numeric.answerCheck',
  'content.constructed.workingOutline', 'content.constructed.parts[].target', 'content.constructed.parts[].answerCheck', 'stimulus.renderedAssets',
] as const;
export const REDACTION_RULE = 'The reviewer receives the item as a learner and a marker would: stem, stimulus, options, the key, the numeric key, parts with their prompts, command terms, marks, mark scheme and final answers, and coded credit levels. It does NOT receive the generator\'s own account of the item: its rationale, its declared model and parameters, its description of the context, its distractor rationales and misconception labels, its answer targets and answer-check declarations, its working outline, or the values it says it used from the stimulus. Validator results are given as outcomes and issue codes; validator notes that restate a generator declaration are left out.' as const;

export interface ReviewableItem {
  responseFormat: string; language: string; difficultyBand: string; marks: number; stem: string;
  selected: { options: Array<{ id: string; text: string }>; answerKey: string } | null;
  numeric: { numericKey: unknown } | null;
  constructed: { totalMarks: number; parts: Array<{ label: string; prompt: string; commandTerm: string | null; marks: number; markScheme: Array<{ kind: string; marks: number; criterion: string }>; finalAnswer: string; numericKey: unknown }> } | null;
  credit: Array<{ code: string; description: string }> | null;
}
export function redactForReview(c: SpecificationCandidate): ReviewableItem {
  const x = c.content;
  return {
    responseFormat: c.responseFormat, language: c.language, difficultyBand: c.difficultyBand, marks: c.marks, stem: x.stem,
    selected: x.selected ? { options: x.selected.options.map((o) => ({ id: o.id, text: o.text })), answerKey: x.selected.answerKey } : null,
    numeric: x.numeric ? { numericKey: x.numeric.numericKey } : null,
    constructed: x.constructed ? { totalMarks: x.constructed.totalMarks, parts: x.constructed.parts.map((p) => ({ label: p.label, prompt: p.prompt, commandTerm: p.commandTerm ?? null, marks: p.marks, markScheme: p.markScheme.map((m) => ({ kind: m.kind, marks: m.marks, criterion: m.criterion })), finalAnswer: p.finalAnswer, numericKey: p.numericKey })) } : null,
    credit: x.credit ? x.credit.map((k) => ({ code: k.code, description: k.description })) : null,
  };
}
export function redactStimulus(s: CandidateStimulus | null): { kind: string; text: string[]; structured: unknown } | null {
  if (!s) return null;
  // the tables, data sets and charts as data; of the parts only what is not derived from them
  return { kind: s.kind, text: s.parts.filter((p) => p.partKind === 'TEXT' || p.partKind === 'SOURCE_NOTE').map((p) => p.text), structured: s.structured };
}
const withoutProvenance = (v: unknown): unknown => (Array.isArray(v) ? v.map(withoutProvenance) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'provenance').map(([k, x]) => [k, withoutProvenance(x)])) : v);
/** The validator results as outcomes and issue codes. */
export function validatorResultsForReview(v: SpecificationItemValidationR4) {
  return {
    validatorsRevision: v.validatorsRevision, gates: v.gates,
    structuralIssues: v.revision4.structuralIssues, profileIssues: [...v.revision3.revision2.profileCompliance.issues, ...v.revision4.demandPolicy.issues], constructIssues: v.revision4.constructIssues, constructWeak: v.revision4.constructWeak,
    answerUnits: v.revision4.answerUnits.map((u) => ({ label: u.label, class: u.class, failureKind: u.failureKind, issues: u.issues })),
    batchDiversity: v.revision4.batchDiversity, itemWritingFlags: v.revision4.itemWritingFlags, learnerTextLeakage: v.revision3.additions.leakage,
  };
}

export interface ReviewInput {
  reviewer: typeof REVIEWER_VERSION; slotId: string;
  canonicalConcept: unknown; evidenceTarget: unknown; assessmentProfile: unknown; assessmentComponent: unknown; taskFamily: unknown; learningApproach: unknown;
  adaptationSpecification: unknown; item: ReviewableItem; stimulus: ReturnType<typeof redactStimulus>; lineage: unknown; deterministicValidatorResults: ReturnType<typeof validatorResultsForReview>;
  dimensions: typeof DIMENSION_QUESTIONS;
}
export function buildReviewInput(p: { slotId: string; specification: AdaptationSpecification; candidate: SpecificationCandidate; stimulus: CandidateStimulus | null; validation: SpecificationItemValidationR4 }): ReviewInput {
  const s = p.specification;
  const la = s.learningApproach;
  return {
    reviewer: REVIEWER_VERSION, slotId: p.slotId,
    canonicalConcept: s.primaryConcept, evidenceTarget: s.invariants.evidenceTarget,
    assessmentProfile: { profileId: s.systemProfile.profileId, version: s.systemProfile.version, status: s.systemProfile.status }, assessmentComponent: s.componentProfile ? { componentId: s.componentProfile.componentId, version: s.componentProfile.version, status: s.componentProfile.status, localSubject: s.componentProfile.localSubject } : null,
    taskFamily: s.taskFamily, learningApproach: la ? { approachId: la.approachId, version: la.version, participation: la.participation, honouredPreferences: la.honouredPreferences.map((h) => `${h.dimension}:${h.decided}`), unmetPreferences: la.unmetPreferences.map((u) => `${u.dimension}:${u.decided}`) } : { recordedAs: 'STANDARD_BY_ABSENCE' },
    // the evidence target is given once, above; the other invariants are given here
    adaptationSpecification: withoutProvenance({ specificationId: s.specificationId, invariantHash: s.invariantHash, contentUseClass: s.contentUseClass, targetSkills: s.targetSkills, invariantsOtherThanTheEvidenceTarget: Object.fromEntries(Object.entries(s.invariants).filter(([k]) => k !== 'evidenceTarget')), variable: s.variable, parameterization: s.parameterization, purpose: s.purpose }),
    item: redactForReview(p.candidate), stimulus: redactStimulus(p.stimulus),
    lineage: { primaryConcept: p.candidate.lineage.primaryConcept, taskFamily: p.candidate.lineage.taskFamily, learningApproach: p.candidate.lineage.learningApproach, systemProfile: p.candidate.lineage.systemProfile, componentProfile: p.candidate.lineage.componentProfile ? { id: p.candidate.lineage.componentProfile.id, version: p.candidate.lineage.componentProfile.version } : null, disciplinePolicy: p.candidate.lineage.disciplinePolicy, adaptationSpecification: p.candidate.lineage.adaptationSpecification, contentUseClass: p.candidate.lineage.contentUseClass, generation: { harness: p.candidate.lineage.generationRequest.harness, template: p.candidate.lineage.generationRequest.template, provider: p.candidate.lineage.generationRun.provider, model: p.candidate.lineage.generationRun.model } },
    deterministicValidatorResults: validatorResultsForReview(p.validation),
    dimensions: DIMENSION_QUESTIONS,
  };
}
export interface RenderedReview { system: string; user: string; requestHash: string; input: ReviewInput }
export function renderReviewRequest(input: ReviewInput): RenderedReview {
  return { system: REVIEWER_SYSTEM_TEXT, user: JSON.stringify(input), requestHash: sha256OfCanonicalJson({ system: REVIEWER_SYSTEM_TEXT, input, schema: REVIEW_PROVIDER_JSON_SCHEMA }), input };
}

// ---------------------------------------------------------------------------------------------------------------
// the response: strict
// ---------------------------------------------------------------------------------------------------------------
const TEXT = (max: number) => z.string().trim().min(1).max(max);
const DimensionSchema = z.strictObject({ verdict: z.enum(REVIEW_VERDICTS), reason: TEXT(700) });
export const ReviewResponseSchema = z.strictObject({
  independentSolution: z.strictObject({ worked: TEXT(4000), answers: z.array(z.strictObject({ label: TEXT(20), answer: TEXT(600) })).min(1).max(8), agreesWithKey: z.enum(KEY_AGREEMENTS), comparison: TEXT(700) }),
  dimensions: z.strictObject(Object.fromEntries(REVIEW_DIMENSIONS.map((d) => [d, DimensionSchema])) as Record<ReviewDimension, typeof DimensionSchema>),
  classification: z.enum(AI_CLASSIFICATIONS),
  reviewerQuestion: z.string().trim().min(10).max(500).nullable(),
});
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;
const str = { type: 'string' } as const;
const dimensionJson = { type: 'object', additionalProperties: false, required: ['verdict', 'reason'], properties: { verdict: { type: 'string', enum: [...REVIEW_VERDICTS] }, reason: str } } as const;
/** The schema the provider is asked to obey. Strict mode cannot carry length limits; the harness's parser does. */
export const REVIEW_PROVIDER_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['independentSolution', 'dimensions', 'classification', 'reviewerQuestion'],
  properties: {
    independentSolution: { type: 'object', additionalProperties: false, required: ['worked', 'answers', 'agreesWithKey', 'comparison'], properties: { worked: str, answers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'answer'], properties: { label: str, answer: str } } }, agreesWithKey: { type: 'string', enum: [...KEY_AGREEMENTS] }, comparison: str } },
    dimensions: { type: 'object', additionalProperties: false, required: [...REVIEW_DIMENSIONS], properties: Object.fromEntries(REVIEW_DIMENSIONS.map((d) => [d, dimensionJson])) },
    classification: { type: 'string', enum: [...AI_CLASSIFICATIONS] },
    reviewerQuestion: { anyOf: [str, { type: 'null' }] },
  },
} as const;

export const REVIEW_REFUSAL_CODES = ['REVIEW_RESPONSE_NOT_JSON', 'REVIEW_CONTAINS_A_REPLACEMENT_ITEM', 'REVIEW_SCHEMA_INVALID', 'REVIEW_QUESTION_MISSING', 'REVIEW_QUESTION_NOT_EXACTLY_ONE', 'REVIEW_QUESTION_WITHOUT_NEEDS_HUMAN_REVIEW'] as const;
export type ReviewRefusalCode = (typeof REVIEW_REFUSAL_CODES)[number];
export class ReviewRefusedError extends Error {
  constructor(public readonly code: ReviewRefusalCode, public readonly detail = '') { super(detail ? `${code}: ${detail}` : code); this.name = 'ReviewRefusedError'; }
}
/** The NO-REPAIR heuristic, named: keys that carry a replacement, and text that introduces replacement wording. */
export const NO_REPAIR_HEURISTIC = {
  id: 'studyus-ai-review-no-repair', version: '1',
  keyPattern: /(revis|rewrit|rewrot|replac|correct(ed|ion)|suggest|propos|improv|fixed|new|alternativ|amend)[a-z_]*(stem|item|question|key|answer|option|distractor|markscheme|mark_scheme|wording|text|version)|^(stem|options|answerKey|markScheme|item|parts)$/i,
  textPattern: /\b(revised|corrected|rewritten|replacement|improved|suggested|amended|fixed)\s+(stem|item|question|key|option|options|distractor|mark scheme|wording|version)\s*:|\b(should|could|must)\s+(instead\s+)?(read|be reworded as|be rewritten as|be replaced by|be replaced with)\s*:|\b(rewrite|reword|replace)\s+(it|the stem|the question|the option|the key)\s+(as|with|by)\s*:/i,
  rule: 'A review is refused whole when any object key anywhere in it names a replacement (a revised, corrected, suggested or new stem, key, option, mark scheme or item; or an item-shaped member), or when any of its texts introduces replacement wording ("corrected stem:", "should read:", "rewrite the stem as:"). The reviewer\'s own solution and its statement that the key is wrong are not a repair. A heuristic: it catches the forms named, not every paraphrase.',
} as const;
function keysAndTexts(v: unknown, keys: string[], texts: string[]): void {
  if (typeof v === 'string') texts.push(v);
  else if (Array.isArray(v)) v.forEach((x) => keysAndTexts(x, keys, texts));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { keys.push(k); keysAndTexts(x, keys, texts); }
}
export function parseReviewResponse(rawText: string): ReviewResponse {
  let json: unknown;
  try { json = JSON.parse(rawText); } catch { throw new ReviewRefusedError('REVIEW_RESPONSE_NOT_JSON'); }
  const keys: string[] = [], texts: string[] = [];
  keysAndTexts(json, keys, texts);
  const badKey = keys.find((k) => NO_REPAIR_HEURISTIC.keyPattern.test(k));
  if (badKey) throw new ReviewRefusedError('REVIEW_CONTAINS_A_REPLACEMENT_ITEM', `key ${badKey}`);
  const badText = texts.find((t) => NO_REPAIR_HEURISTIC.textPattern.test(t));
  if (badText) throw new ReviewRefusedError('REVIEW_CONTAINS_A_REPLACEMENT_ITEM', `text ${badText.slice(0, 80)}`);
  const parsed = ReviewResponseSchema.safeParse(json);
  if (!parsed.success) throw new ReviewRefusedError('REVIEW_SCHEMA_INVALID', parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const r = parsed.data;
  if (r.classification === 'NEEDS_HUMAN_REVIEW' && r.reviewerQuestion === null) throw new ReviewRefusedError('REVIEW_QUESTION_MISSING');
  if (r.classification !== 'NEEDS_HUMAN_REVIEW' && r.reviewerQuestion !== null) throw new ReviewRefusedError('REVIEW_QUESTION_WITHOUT_NEEDS_HUMAN_REVIEW');
  if (r.reviewerQuestion !== null && (r.reviewerQuestion.match(/\?/g) ?? []).length !== 1) throw new ReviewRefusedError('REVIEW_QUESTION_NOT_EXACTLY_ONE', r.reviewerQuestion.slice(0, 80));
  return r;
}
export const reviewRefusalCodeOf = (rawText: string): ReviewRefusalCode | null => { try { parseReviewResponse(rawText); return null; } catch (e) { if (e instanceof ReviewRefusedError) return e.code; throw e; } };

// ---------------------------------------------------------------------------------------------------------------
// the decision policy
// ---------------------------------------------------------------------------------------------------------------
type Gates = SpecificationItemValidationR4['gates'];
/** Reviewer dimensions whose FAIL rejects an item. */
export const REJECTING_DIMENSIONS: readonly ReviewDimension[] = ['ACADEMIC_CORRECTNESS', 'CONSTRUCT_VALIDITY', 'RESPONSE_CONTRACT', 'STIMULUS_INTEGRITY', 'FAIRNESS_AMBIGUITY'];
/** Validator gates that are deterministic facts about the item: their failure rejects whatever the reviewer says. */
export const DETERMINISTIC_REJECTING_GATES = ['structural', 'answerKey', 'machineRecomputation', 'lineage', 'learnerTextLeakage'] as const;
/** Validator gates that rest on rules a person could dispute: their failure blocks approval and, when the reviewer saw no failure, sends the item to a person. */
export const DISPUTABLE_GATES = ['profileCompliance', 'constructPreservation', 'stimulusIntegrity', 'originality'] as const;
const gateFailed = (g: Gates, k: (typeof DETERMINISTIC_REJECTING_GATES)[number] | (typeof DISPUTABLE_GATES)[number]): boolean => (k === 'answerKey' ? g.answerKey === 'FAILED' : k === 'originality' ? g.originality !== 'PASS_LOW_SIMILARITY' : g[k] === 'FAIL');
export const validatorStrictPass = (g: Gates): boolean => !hasGateFail(g) && g.constructPreservation === 'PASS' && g.itemWriting === 'PASS';

export const DECISION_POLICY = {
  id: 'studyus-ai-review-decision-policy', version: REVIEWER_VERSION.decisionPolicyVersion,
  rules: [
    'R1 REJECTED when a deterministic validator gate failed (structural, answer key FAILED, machine recomputation, lineage, learner-text leakage). If the reviewer saw no failure in any dimension, the disagreement VALIDATOR_FAIL_REVIEWER_PASS is recorded; the validator is not overridden.',
    'R2 REJECTED when the reviewer gives FAIL on ACADEMIC_CORRECTNESS, CONSTRUCT_VALIDITY, RESPONSE_CONTRACT, STIMULUS_INTEGRITY or FAIRNESS_AMBIGUITY -- except R3.',
    'R3 NEEDS_HUMAN_REVIEW when the reviewer\'s own solution DISAGREES with the key (or it fails ACADEMIC_CORRECTNESS) while the validators MACHINE_VERIFIED the key: two checks contradict each other, and a person decides (disagreement REVIEWER_REJECTS_A_MACHINE_VERIFIED_KEY).',
    'R4 REJECTED when the reviewer\'s own solution DISAGREES with the key and the key was not machine verified.',
    'R5 NEEDS_HUMAN_REVIEW when a disputable validator gate failed (profile compliance, construct preservation, stimulus integrity, originality) and the reviewer rejected nothing (disagreement VALIDATOR_FAIL_REVIEWER_PASS when the reviewer saw no failure at all).',
    'R6 NEEDS_HUMAN_REVIEW when the reviewer gives FAIL on any other dimension, or CONCERN on any dimension, or cannot determine whether its solution agrees with the key.',
    'R7 NEEDS_HUMAN_REVIEW when the validators did not strictly pass the item (construct preservation WEAK, or item writing FLAGGED) although the reviewer passed everything (disagreement VALIDATOR_DOUBT_REVIEWER_PASS).',
    'R8 APPROVED only when: the validators strictly passed the item, every dimension is PASS or NOT_APPLICABLE, the reviewer\'s solution AGREES with the key, and the reviewer proposed APPROVED.',
    'R9 The reviewer\'s own proposal can only make the outcome stricter: the final classification is the stricter of the policy\'s and the reviewer\'s (disagreement REVIEWER_PROPOSAL_STRICTER_THAN_ITS_VERDICTS, or REVIEWER_PROPOSAL_LAXER_THAN_POLICY, recorded).',
    'R10 A NEEDS_HUMAN_REVIEW outcome carries exactly one question: the reviewer\'s when it wrote one, otherwise one the policy states from the rule that fired.',
    'A reviewer failure (no response, a refused or malformed response, a truncated one, a provider refusal) is REVIEWER_FAILURE: no classification, never an approval, not retried.',
  ],
} as const;
const STRICTNESS: Readonly<Record<AiClassification, number>> = { APPROVED: 0, NEEDS_HUMAN_REVIEW: 1, REJECTED: 2 };
export type Disagreement = 'VALIDATOR_FAIL_REVIEWER_PASS' | 'VALIDATOR_DOUBT_REVIEWER_PASS' | 'REVIEWER_REJECTS_A_MACHINE_VERIFIED_KEY' | 'REVIEWER_FAIL_VALIDATOR_STRICT_PASS' | 'REVIEWER_PROPOSAL_STRICTER_THAN_ITS_VERDICTS' | 'REVIEWER_PROPOSAL_LAXER_THAN_POLICY';
export interface AiDecision {
  kind: typeof AI_REVIEW_KIND; isHumanReview: false; reviewStatus: typeof REVIEW_STATUS_UNCHANGED; policy: { id: string; version: string };
  classification: AiClassification; rule: string; reasons: string[]; disagreements: Disagreement[]; reviewerProposed: AiClassification;
  reviewerQuestion: { question: string; source: 'AI_REVIEWER' | 'DECISION_POLICY' } | null;
}
export function decide(review: ReviewResponse, gates: Gates): AiDecision {
  const verdictOf = (d: ReviewDimension) => review.dimensions[d].verdict;
  const failed = REVIEW_DIMENSIONS.filter((d) => verdictOf(d) === 'FAIL');
  const concerns = REVIEW_DIMENSIONS.filter((d) => verdictOf(d) === 'CONCERN');
  const rejecting = failed.filter((d) => REJECTING_DIMENSIONS.includes(d));
  const deterministicFails = DETERMINISTIC_REJECTING_GATES.filter((k) => gateFailed(gates, k));
  const disputableFails = DISPUTABLE_GATES.filter((k) => gateFailed(gates, k));
  const agreement = review.independentSolution.agreesWithKey;
  const reviewerSawNoFailure = failed.length === 0 && agreement !== 'DISAGREES';
  const disagreements: Disagreement[] = [];
  let classification: AiClassification, rule: string, reasons: string[];
  const keyDisputed = agreement === 'DISAGREES' || verdictOf('ACADEMIC_CORRECTNESS') === 'FAIL';
  if (deterministicFails.length > 0) {
    classification = 'REJECTED'; rule = 'R1'; reasons = deterministicFails.map((k) => `validator:${k}`);
    if (reviewerSawNoFailure) disagreements.push('VALIDATOR_FAIL_REVIEWER_PASS');
  } else if (keyDisputed && gates.answerKey === 'MACHINE_VERIFIED') {
    classification = 'NEEDS_HUMAN_REVIEW'; rule = 'R3'; reasons = [`reviewer:${agreement === 'DISAGREES' ? 'SOLUTION_DISAGREES_WITH_KEY' : 'ACADEMIC_CORRECTNESS'}`, 'validator:answerKey=MACHINE_VERIFIED'];
    disagreements.push('REVIEWER_REJECTS_A_MACHINE_VERIFIED_KEY');
  } else if (rejecting.length > 0) {
    classification = 'REJECTED'; rule = 'R2'; reasons = rejecting.map((d) => `reviewer:${d}`);
  } else if (agreement === 'DISAGREES') {
    classification = 'REJECTED'; rule = 'R4'; reasons = ['reviewer:SOLUTION_DISAGREES_WITH_KEY'];
  } else if (disputableFails.length > 0) {
    classification = 'NEEDS_HUMAN_REVIEW'; rule = 'R5'; reasons = disputableFails.map((k) => `validator:${k}`);
    if (reviewerSawNoFailure) disagreements.push('VALIDATOR_FAIL_REVIEWER_PASS');
  } else if (failed.length > 0 || concerns.length > 0 || agreement === 'CANNOT_DETERMINE') {
    classification = 'NEEDS_HUMAN_REVIEW'; rule = 'R6'; reasons = [...failed.map((d) => `reviewer:${d}=FAIL`), ...concerns.map((d) => `reviewer:${d}=CONCERN`), ...(agreement === 'CANNOT_DETERMINE' ? ['reviewer:AGREEMENT_WITH_KEY_NOT_DETERMINED'] : [])];
  } else if (!validatorStrictPass(gates)) {
    classification = 'NEEDS_HUMAN_REVIEW'; rule = 'R7'; reasons = [...(gates.constructPreservation !== 'PASS' ? [`validator:constructPreservation=${gates.constructPreservation}`] : []), ...(gates.itemWriting !== 'PASS' ? [`validator:itemWriting=${gates.itemWriting}`] : [])];
    disagreements.push('VALIDATOR_DOUBT_REVIEWER_PASS');
  } else {
    classification = 'APPROVED'; rule = 'R8'; reasons = [];
  }
  if ((rejecting.length > 0 || agreement === 'DISAGREES') && validatorStrictPass(gates) && rule !== 'R3') disagreements.push('REVIEWER_FAIL_VALIDATOR_STRICT_PASS');
  // R9: the reviewer's proposal may only make it stricter
  if (STRICTNESS[review.classification] > STRICTNESS[classification]) { disagreements.push('REVIEWER_PROPOSAL_STRICTER_THAN_ITS_VERDICTS'); classification = review.classification; rule = `${rule}+R9`; reasons = [...reasons, `reviewer:PROPOSED_${review.classification}`]; }
  else if (STRICTNESS[review.classification] < STRICTNESS[classification]) disagreements.push('REVIEWER_PROPOSAL_LAXER_THAN_POLICY');
  const reviewerQuestion: AiDecision['reviewerQuestion'] = classification !== 'NEEDS_HUMAN_REVIEW' ? null
    : review.reviewerQuestion !== null ? { question: review.reviewerQuestion, source: 'AI_REVIEWER' }
      : { question: `The decision policy sent this item to a person by rule ${rule} (${reasons.join(', ') || 'no reason recorded'}): is the item correct and usable as it stands?`, source: 'DECISION_POLICY' };
  return { kind: AI_REVIEW_KIND, isHumanReview: false, reviewStatus: REVIEW_STATUS_UNCHANGED, policy: { id: DECISION_POLICY.id, version: DECISION_POLICY.version }, classification, rule, reasons, disagreements, reviewerProposed: review.classification, reviewerQuestion };
}
