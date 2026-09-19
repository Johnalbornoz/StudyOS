/**
 * F9 -- factual institution-policy threshold comparison (task §38).
 * Calls F7's real, unmodified evaluatePolicyCompliance. Structurally
 * cannot express an admission probability (INV-F9-19/20) -- there is
 * no probability field anywhere in PolicyComparisonResult.
 */
import { db } from '@/lib/db';
import { evaluatePolicyCompliance } from '@/lib/assessment/institution-policy.service';

export type PolicyComparisonResult =
  | { status: 'POLICY_COMPARISON_UNAVAILABLE'; reason: string }
  | { status: 'COMPARABLE'; meetsThreshold: boolean; achievedRawScore: number; thresholdRules: Record<string, unknown> };

export async function comparePolicyCompliance(params: { institutionExamPolicyId: string; examAttemptId: string }): Promise<PolicyComparisonResult> {
  const compliance = await evaluatePolicyCompliance(params.institutionExamPolicyId);
  if (compliance.status === 'POLICY_PENDING') {
    return { status: 'POLICY_COMPARISON_UNAVAILABLE', reason: 'POLICY_NOT_VERIFIED' };
  }

  const scoreRow = await db.query(
    `SELECT SUM(score) AS total_score, SUM(max_score) AS total_max FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`,
    [params.examAttemptId]
  );
  const totalScore = Number(scoreRow.rows[0]?.total_score) || 0;
  const totalMax = Number(scoreRow.rows[0]?.total_max) || 0;
  if (totalMax === 0) return { status: 'POLICY_COMPARISON_UNAVAILABLE', reason: 'NO_SCORED_RESPONSES' };

  const achievedRawScore = (totalScore / totalMax) * 100;
  const thresholdRules = compliance.thresholdRules;
  const minimumScore = typeof thresholdRules.minimumScore === 'number' ? thresholdRules.minimumScore : null;

  // "Versions compatible" (task §38) is verified, never assumed: an
  // achieved score is always a 0-100 fraction of max; a threshold is
  // only ever comparable to it when the policy explicitly declares
  // itself on that same scale. F7's own institution-policy fixtures
  // (e.g. a raw PAA-scale minimumScore like 320/480) are NOT
  // comparable to a percent-of-max without a real scale-conversion
  // model (score-projection.service.ts) -- silently treating them as
  // the same unit would be exactly the fabricated compatibility this
  // gate exists to prevent.
  if (minimumScore === null || thresholdRules.scoreUnit !== 'PERCENT_OF_MAX') {
    return { status: 'POLICY_COMPARISON_UNAVAILABLE', reason: 'THRESHOLD_RULES_NOT_COMPARABLE' };
  }

  return { status: 'COMPARABLE', meetsThreshold: achievedRawScore >= minimumScore, achievedRawScore, thresholdRules };
}
