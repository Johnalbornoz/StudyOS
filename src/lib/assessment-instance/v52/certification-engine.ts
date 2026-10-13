/**
 * QF V5.2 -- the certification decision engine: evidence per rule in, ONE decision with its reasons out (pure, no IO).
 *
 *   AUTOMATED_CERTIFIED_PILOT   every blocking rule that applies PASSED (or does not apply)
 *   REJECTED                    a blocking rule whose failure is a known defect FAILED
 *   REVIEW_REQUIRED             anything else: evidence missing, a rule that only a person can settle, an
 *                               unsupported representation or format, unclear rights, outside the envelope
 * The engine never says "failed validation": every reason names its rule, its reason code and what was seen. It
 * grants only the scopes its policy may grant. It knows no assessment system, no item id and no wording.
 */
import { HUMAN50_POLICY_V1, policyHashOf, type CertificationPolicy, type CertificationRule, type EligibilityScope, type RuleSeverity, type RuleSubject } from './certification-policy';

export type RuleResult = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';
export interface RuleEvidence { ruleId: string; result: RuleResult; reasonCode: string | null; detail: string }
export const CERTIFICATION_OUTCOMES = ['AUTOMATED_CERTIFIED_PILOT', 'REVIEW_REQUIRED', 'REJECTED'] as const;
export type CertificationOutcomeV52 = (typeof CERTIFICATION_OUTCOMES)[number];
export interface DecisionReason { ruleId: string; ruleVersion: string; severity: RuleSeverity; effect: 'REJECT' | 'REVIEW'; reasonCode: string; detail: string }
export interface CertificationDecisionV52 {
  outcome: CertificationOutcomeV52;
  policyVersion: string;
  policyHash: string;
  subject: RuleSubject;
  reasons: DecisionReason[];
  /** One line per rule of the policy that applies to the subject: what was judged and what was seen. */
  evidence: RuleEvidence[];
  /** The scopes the decision makes the subject eligible for. Empty unless certified; never PRODUCTION under a calibration policy. */
  scopes: EligibilityScope[];
}

const pass = (ruleId: string, detail: string): RuleEvidence => ({ ruleId, result: 'PASS', reasonCode: null, detail });
export const evidence = {
  pass,
  notApplicable: (ruleId: string, detail: string): RuleEvidence => ({ ruleId, result: 'NOT_APPLICABLE', reasonCode: null, detail }),
  fail: (ruleId: string, reasonCode: string, detail: string): RuleEvidence => ({ ruleId, result: 'FAIL', reasonCode, detail }),
  unknown: (ruleId: string, reasonCode: string, detail: string): RuleEvidence => ({ ruleId, result: 'UNKNOWN', reasonCode, detail }),
  /** PASS when nothing is wrong; otherwise the first thing that is. */
  check: (ruleId: string, problems: readonly { reasonCode: string; detail: string }[], okDetail: string): RuleEvidence => (problems.length === 0 ? pass(ruleId, okDetail) : { ruleId, result: 'FAIL', reasonCode: problems[0].reasonCode, detail: problems.map((p) => `${p.reasonCode}: ${p.detail}`).join(' | ') }),
};

const reasonOf = (rule: CertificationRule, effect: 'REJECT' | 'REVIEW', reasonCode: string, detail: string): DecisionReason => ({ ruleId: rule.ruleId, ruleVersion: rule.version, severity: rule.severity, effect, reasonCode, detail });

/** The decision for one subject. Evidence for a rule the policy does not have is ignored; a rule with no evidence is UNKNOWN. */
export function decide(subject: RuleSubject, given: readonly RuleEvidence[], policy: CertificationPolicy = HUMAN50_POLICY_V1): CertificationDecisionV52 {
  const reasons: DecisionReason[] = [];
  const seen: RuleEvidence[] = [];
  for (const rule of policy.rules) {
    if (!rule.appliesTo.includes(subject)) continue;
    const e = given.find((x) => x.ruleId === rule.ruleId) ?? { ruleId: rule.ruleId, result: 'UNKNOWN' as const, reasonCode: 'NO_EVIDENCE', detail: `nothing was shown for ${rule.ruleId}: ${rule.evidenceRequired}` };
    seen.push(e);
    if (!rule.blocking || e.result === 'PASS' || e.result === 'NOT_APPLICABLE') continue;
    const code = e.reasonCode ?? 'NO_REASON_GIVEN';
    // a reason the rule does not declare is itself a reason for review: the evidence does not speak the policy's language
    const declared = code === 'NO_EVIDENCE' || rule.reasonCodes.includes(code);
    if (e.result === 'FAIL' && rule.onFailure === 'REJECT' && declared) reasons.push(reasonOf(rule, 'REJECT', code, e.detail));
    else reasons.push(reasonOf(rule, 'REVIEW', declared ? code : `UNDECLARED_REASON:${code}`, e.detail));
  }
  const outcome: CertificationOutcomeV52 = reasons.some((r) => r.effect === 'REJECT') ? 'REJECTED' : reasons.length > 0 ? 'REVIEW_REQUIRED' : 'AUTOMATED_CERTIFIED_PILOT';
  return { outcome, policyVersion: `${policy.policyId}_${policy.version}`, policyHash: policyHashOf(policy), subject, reasons, evidence: seen, scopes: outcome === 'AUTOMATED_CERTIFIED_PILOT' ? [...policy.mayGrantScopes] : [] };
}
