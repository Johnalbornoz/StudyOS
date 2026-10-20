/**
 * QF V5.2 -- HUMAN50_POLICY_V1: the certification policy, versioned and content-hashed (pure, no IO).
 *
 * The fifty items a person reviewed taught which defects matter. This policy states those lessons as RULES. It
 * names no item: there is no review id, no item id and no wording of any reviewed item in this file or in anything
 * that decides a certification. The fifty items are used where a calibration set belongs -- in the regression
 * test that checks the policy still reads them the way their reviewer did.
 *
 * A rule has an id, a version, a severity, whether it blocks, what a failure of it means for the outcome, the
 * reason codes it can give and the evidence it must be shown. A rule with no evidence is UNKNOWN, and UNKNOWN on a
 * blocking rule is never a pass.
 *
 * CERTIFICATION IS NOT ELIGIBILITY. What an object IS (its certification state) and WHERE it may be delivered (its
 * eligibility scope) are two things. This policy can make an instance AUTOMATED_CERTIFIED_PILOT; nothing in it can
 * make anything eligible for PRODUCTION.
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';

export const CERTIFICATION_STATES = ['DRAFT', 'VALIDATING', 'AUTOMATED_CERTIFIED_PILOT', 'REVIEW_REQUIRED', 'HUMAN_CERTIFIED', 'REJECTED', 'QUARANTINED', 'RETIRED'] as const;
export type CertificationStateName = (typeof CERTIFICATION_STATES)[number];
/** The states from which something may be delivered at all. Every other state delivers nothing. */
export const DELIVERABLE_CERTIFICATION_STATES: readonly CertificationStateName[] = ['AUTOMATED_CERTIFIED_PILOT', 'HUMAN_CERTIFIED'];

export const ELIGIBILITY_SCOPES = ['PILOT_PREVIEW', 'PRODUCTION'] as const;
export type EligibilityScope = (typeof ELIGIBILITY_SCOPES)[number];

export const RULE_SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];
/** What an established failure of a rule does. REJECT: a known defect. REVIEW: not certifiable by a machine; a person decides. */
export type RuleFailureEffect = 'REJECT' | 'REVIEW';
export const RULE_SUBJECTS = ['ITEM_INSTANCE', 'RECORDED_CANDIDATE'] as const;
export type RuleSubject = (typeof RULE_SUBJECTS)[number];

export interface CertificationRule {
  ruleId: string;
  version: string;
  severity: RuleSeverity;
  /** A blocking rule must PASS (or not apply) for a certification. A non-blocking rule is recorded and never certifies or blocks. */
  blocking: boolean;
  onFailure: RuleFailureEffect;
  /** The principle, in one sentence. */
  statement: string;
  /** What must be shown for the rule to be judged at all. */
  evidenceRequired: string;
  reasonCodes: readonly string[];
  appliesTo: readonly RuleSubject[];
}

const BOTH: readonly RuleSubject[] = ['ITEM_INSTANCE', 'RECORDED_CANDIDATE'];
const rule = (ruleId: string, severity: RuleSeverity, onFailure: RuleFailureEffect, statement: string, evidenceRequired: string, reasonCodes: string[], appliesTo: readonly RuleSubject[] = BOTH, blocking = true): CertificationRule => ({ ruleId, version: '1.0.0', severity, blocking, onFailure, statement, evidenceRequired, reasonCodes, appliesTo });

export const HUMAN50_POLICY_V1_RULES: readonly CertificationRule[] = [
  rule('ANSWER_CORRECTNESS', 'CRITICAL', 'REJECT', 'The keyed answer is correct, shown by a route that does not reuse how the key was produced.', 'An independent recomputation of the key from what the learner is shown, or an independent solver that confirmed it.', ['KEY_DOES_NOT_HOLD', 'ANSWER_UNCONFIRMED', 'KEY_CONTRADICTS_ITSELF']),
  rule('CONSTRUCT_ALIGNMENT', 'CRITICAL', 'REJECT', 'The item assesses the construct it claims to assess.', 'The construct core the item is an instance of, or a judgement of fit to the stated objective.', ['CONSTRUCT_FAIL', 'CONSTRUCT_WEAK', 'CONSTRUCT_NOT_JUDGED']),
  rule('CONSTRUCT_NECESSITY', 'CRITICAL', 'REVIEW', 'A correct response is reached only by the reasoning the construct is evidence of: no shorter route exists.', 'The intended and the minimum successful reasoning paths.', ['CONSTRUCT_NOT_NECESSARY', 'METHOD_REQUIRED_BUT_NOT_OBSERVED']),
  rule('SHORTCUT_BYPASS', 'CRITICAL', 'REVIEW', 'Nothing in the item lets a learner check, substitute or read off the answer instead of working it out.', 'The response format against the shortcut constraints of the core; the options, when there are any.', ['FORMAT_ADMITS_SUBSTITUTION', 'KEY_STATES_THE_RESULT', 'KEY_EXPOSES_THE_WORKING', 'OPTION_ELIMINATED_BY_ITS_OWN_CONTRADICTION', 'SHORTCUT_FORMAT_EXCLUDED_BY_THE_CORE']),
  rule('DISTRACTOR_DIAGNOSTICITY', 'MAJOR', 'REVIEW', 'Each wrong option is what a modelled misconception produces.', 'The lineage of each distractor to a misconception of the core.', ['DISTRACTOR_WITHOUT_LINEAGE', 'DISTRACTOR_NOT_DIAGNOSTIC']),
  rule('DISTRACTOR_COMPETITIVENESS', 'MAJOR', 'REVIEW', 'No wrong option can be discarded without the construct, and none is accidentally right.', 'The options, compared with the key and with one another.', ['DISTRACTOR_NOT_COMPETITIVE', 'DISTRACTOR_IS_ALSO_CORRECT', 'KEY_COINCIDES_WITH_A_MISCONCEPTION']),
  rule('OPTION_STRUCTURAL_LEAKAGE', 'MAJOR', 'REVIEW', 'The key is not given away by its form: length, precision, unit or polarity.', 'The surface form of every option.', ['KEY_LENGTH_OUTLIER', 'KEY_HAS_UNIQUE_PRECISION', 'KEY_HAS_UNIQUE_UNIT', 'KEY_IS_THE_ONLY_OPTION_WITH_ITS_POLARITY']),
  rule('REPRESENTATION_FIT', 'CRITICAL', 'REVIEW', 'What the construct needs to be shown is shown, and nothing is described in words that needs a figure.', 'The representations the construct requires against those attached.', ['FIGURE_DESCRIBED_WITHOUT_A_DIAGRAM', 'REQUIRED_REPRESENTATION_MISSING']),
  rule('DIFFICULTY_MECHANISM', 'CRITICAL', 'REVIEW', 'The item is as hard as it claims, for a reason that can be named, and its difficulty is a number from 1 to 5.', 'The lever settings of the band and the item difficulty a certified envelope assigns; or a calibrated tier.', ['DIFFICULTY_NOT_RECORDED', 'PARAMETER_SET_IS_NOT_OF_ITS_BAND', 'CHALLENGE_WITHOUT_A_MECHANISM', 'DIFFICULTY_IS_OF_THE_IDEAL_SOLUTION_ONLY', 'TIER_MISMATCH', 'TIER_BORDERLINE', 'TIER_NOT_JUDGED']),
  rule('MINIMUM_SUCCESSFUL_REASONING_PATH', 'CRITICAL', 'REVIEW', 'The shortest route to a correct response is stated, and it is the reasoning the construct claims.', 'The minimum successful reasoning path of the core and whether any method is required to be observed.', ['NO_MINIMUM_PATH_DECLARED', 'METHOD_REQUIRED_BUT_NOT_OBSERVED']),
  rule('ASSESSMENT_AUTHENTICITY', 'MAJOR', 'REVIEW', 'The item is asked the way its assessment model asks: format, command term, conventions.', 'The adapter of the component: its response formats and its governed command terms.', ['FORMAT_NOT_OF_THE_ADAPTER', 'NO_COMMAND_TERM', 'COMMAND_TERM_NOT_OF_THE_ADAPTER', 'AUTHENTICITY_LOW']),
  rule('RESPONSE_EVALUATION', 'CRITICAL', 'REJECT', 'A correct response is marked correct and an incorrect one incorrect, in every form the policy accepts.', 'The response policy of the instance, run against the key in each accepted form and against the modelled wrong answers.', ['KEY_NOT_ACCEPTED_BY_ITS_OWN_POLICY', 'WRONG_ANSWER_ACCEPTED', 'NO_RESPONSE_POLICY']),
  rule('MARKS_CONSISTENCY', 'MAJOR', 'REJECT', 'The marks of the item, of its parts and of its mark scheme agree.', 'The marks stated to the learner and the marks the rubric adds up to.', ['MARKS_DO_NOT_ADD_UP', 'MARKS_OUTSIDE_THE_ADAPTER_RANGE']),
  rule('AMBIGUITY', 'CRITICAL', 'REVIEW', 'The item has one reading and one correct response.', 'A check for a second valid reading or a second valid answer.', ['AMBIGUITY_FLAGGED', 'SAME_WORDING_DIFFERENT_KEY']),
  rule('LANGUAGE_QUALITY', 'MAJOR', 'REVIEW', 'The wording is complete and is in the language the instance declares.', 'The learner-facing text.', ['UNFILLED_PLACEHOLDER', 'LANGUAGE_IS_NOT_THE_DECLARED_ONE', 'EMPTY_PROMPT']),
  rule('RIGHTS_PROVENANCE', 'CRITICAL', 'REVIEW', 'StudyUs may deliver the content, and where it came from is on the record.', 'A rights state allowed by policy for the scope asked, with the provenance that establishes it.', ['RIGHTS_NOT_ESTABLISHED', 'RIGHTS_STATE_NOT_DELIVERABLE', 'PROVENANCE_UNCLEAR', 'FIXTURE_CONTENT']),
  rule('BLUEPRINT_COMPATIBILITY', 'CRITICAL', 'REVIEW', 'The item has a place: a bucket of a governed blueprint whose class admits the use, linked to its concept.', 'The blueprint classification and the bucket-to-concept link.', ['BLUEPRINT_NOT_CLASSIFIED', 'BLUEPRINT_CLASS_NOT_ELIGIBLE', 'BUCKET_DOES_NOT_LINK_THE_CONCEPT']),
  rule('LINEAGE_COMPLETENESS', 'CRITICAL', 'REVIEW', 'The item is an instance of a construct core, with every link of its lineage recorded and unaltered.', 'Core, applicability, adapter, bucket, seed, parameter set, renderer, envelope, difficulty, digest.', ['LEGACY_NO_CORE_LINEAGE', 'LINEAGE_INCOMPLETE', 'LINEAGE_ALTERED', 'APPLICABILITY_NOT_SUPPORTED']),
  rule('DUPLICATION', 'MAJOR', 'REVIEW', 'The item is not another item again: neither the same wording nor a variant a learner would take for it.', 'The wording and the recognition class of the item against those already certified.', ['DUPLICATE_OF_A_CERTIFIED_INSTANCE', 'NEAR_DUPLICATE']),
  rule('UNSUPPORTED_REPRESENTATION', 'CRITICAL', 'REVIEW', 'The item needs nothing that no certified renderer can draw.', 'The stimulus kinds the instance carries against those its envelope supports.', ['REPRESENTATION_NOT_RENDERABLE', 'REPRESENTATION_OUTSIDE_THE_ENVELOPE']),
  rule('UNSUPPORTED_RESPONSE_FORMAT', 'CRITICAL', 'REVIEW', 'The response format is one the adapter governs, the core allows and the envelope covers.', 'The format of the instance against adapter, core and envelope.', ['FORMAT_OUTSIDE_THE_ENVELOPE', 'FORMAT_NOT_ALLOWED_BY_THE_CORE', 'FORMAT_NOT_OF_THE_ADAPTER']),
  rule('ENVELOPE_CONFORMANCE', 'CRITICAL', 'REVIEW', 'A deterministic instance inherits certification only inside the certified envelope of its renderer.', 'The instance against its envelope: renderer version, adapter, language, format, command term, band, parameters.', ['OUTSIDE_THE_CERTIFIED_ENVELOPE', 'RENDERER_VERSION_CHANGED', 'GOVERNING_OBJECT_NOT_ELIGIBLE'], ['ITEM_INSTANCE']),
];

export interface CertificationPolicy {
  policyId: string;
  version: string;
  /** What the policy was calibrated on, and what that is worth. */
  calibration: { set: string; kind: 'IN_SAMPLE_HUMAN_CALIBRATION'; items: number; outOfSampleValidation: 'NOT_YET_RUN' };
  /** The scopes this policy may make something eligible for. Production is not among them. */
  mayGrantScopes: readonly EligibilityScope[];
  /** The rights states that deliver, per scope. A state that is not listed delivers nothing in that scope. */
  deliverableRights: Readonly<Record<EligibilityScope, readonly string[]>>;
  rules: readonly CertificationRule[];
}
const POLICY_V1: CertificationPolicy = {
  policyId: 'HUMAN50_POLICY', version: 'V1',
  calibration: { set: 'Human-50', kind: 'IN_SAMPLE_HUMAN_CALIBRATION', items: 50, outOfSampleValidation: 'NOT_YET_RUN' },
  mayGrantScopes: ['PILOT_PREVIEW'],
  // provider-generated material is not listed: no provider terms and no originality result are on record for it
  deliverableRights: { PILOT_PREVIEW: ['STUDYUS_ORIGINAL_DETERMINISTIC', 'LICENSED', 'PUBLIC_DOMAIN'], PRODUCTION: [] },
  rules: HUMAN50_POLICY_V1_RULES,
};
export const HUMAN50_POLICY_V1: CertificationPolicy = Object.freeze(POLICY_V1);
export const HUMAN50_POLICY_VERSION = `${HUMAN50_POLICY_V1.policyId}_${HUMAN50_POLICY_V1.version}` as const;
/** The identity of the policy. A certification names this hash; a policy edited without a new version is detectable. */
export const policyHashOf = (policy: CertificationPolicy): string => sha256OfCanonicalJson(policy);
export const HUMAN50_POLICY_HASH = policyHashOf(HUMAN50_POLICY_V1);
export const ruleOf = (policy: CertificationPolicy, ruleId: string): CertificationRule | null => policy.rules.find((r) => r.ruleId === ruleId) ?? null;

/** What is wrong with a policy as a document. A usable policy has none. */
export function policyIssues(policy: CertificationPolicy): string[] {
  const issues: string[] = [];
  const ids = policy.rules.map((r) => r.ruleId);
  if (new Set(ids).size !== ids.length) issues.push('RULE_LISTED_TWICE');
  for (const r of policy.rules) {
    if (!/^[A-Z][A-Z0-9_]+$/.test(r.ruleId)) issues.push(`${r.ruleId}: RULE_ID_FORMAT`);
    if (r.reasonCodes.length === 0) issues.push(`${r.ruleId}: NO_REASON_CODE`);
    if (r.severity === 'CRITICAL' && !r.blocking) issues.push(`${r.ruleId}: A_CRITICAL_RULE_ALWAYS_BLOCKS`);
    if (r.appliesTo.length === 0) issues.push(`${r.ruleId}: APPLIES_TO_NOTHING`);
  }
  if (policy.mayGrantScopes.includes('PRODUCTION')) issues.push('A_CALIBRATION_POLICY_CANNOT_GRANT_PRODUCTION');
  if (policy.deliverableRights.PRODUCTION.length > 0) issues.push('PRODUCTION_RIGHTS_ARE_NOT_THIS_POLICYS_TO_GRANT');
  return issues;
}
