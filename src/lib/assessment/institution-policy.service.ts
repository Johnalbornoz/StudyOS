/**
 * F7 -- Institution Exam Policy (task 20/22). Separate from the exam
 * itself (INV-F7-10). Unverified policy produces no admission claim
 * (AC-F7-07) -- enforced structurally: threshold_rules requires
 * VERIFIED at the DB level (institution_exam_policies_threshold_requires_verification
 * CHECK), and evaluatePolicyCompliance below refuses outright for a
 * POLICY_PENDING policy rather than computing a partial/guessed answer.
 */
import { db } from '@/lib/db';
import type { InstitutionExamPolicy } from './types';

function toPolicy(r: any): InstitutionExamPolicy {
  return {
    id: r.id,
    institutionId: r.institution_id,
    examDefinitionId: r.exam_definition_id,
    examVersionId: r.exam_version_id,
    admissionContext: r.admission_context,
    verificationStatus: r.verification_status,
    sourceLocator: r.source_locator,
    sectionsConsidered: r.sections_considered,
    thresholdRules: r.threshold_rules,
    status: r.status,
    policyGroupId: r.policy_group_id,
    version: r.version,
  };
}

export async function createInstitutionExamPolicy(params: {
  institutionId: string;
  examDefinitionId: string;
  examVersionId?: string;
  admissionContext?: string;
  sourceLocator?: string;
}): Promise<InstitutionExamPolicy> {
  const result = await db.query(
    `INSERT INTO institution_exam_policies (institution_id, exam_definition_id, exam_version_id, admission_context, source_locator, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE') RETURNING *`,
    [params.institutionId, params.examDefinitionId, params.examVersionId ?? null, params.admissionContext ?? null, params.sourceLocator ?? null]
  );
  return toPolicy(result.rows[0]);
}

/** Marking a policy VERIFIED is the ONLY way threshold_rules may be set -- enforced together, atomically. */
export async function verifyPolicy(policyId: string, thresholdRules: Record<string, unknown>, sectionsConsidered?: Record<string, unknown>): Promise<InstitutionExamPolicy> {
  const result = await db.query(
    `UPDATE institution_exam_policies SET verification_status = 'VERIFIED', threshold_rules = $2, sections_considered = COALESCE($3, sections_considered), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [policyId, JSON.stringify(thresholdRules), sectionsConsidered ? JSON.stringify(sectionsConsidered) : null]
  );
  if (result.rows.length === 0) throw new Error(`policy ${policyId} not found`);
  return toPolicy(result.rows[0]);
}

export async function getInstitutionExamPolicy(policyId: string): Promise<InstitutionExamPolicy | null> {
  const result = await db.query(`SELECT * FROM institution_exam_policies WHERE id = $1`, [policyId]);
  return result.rows.length === 0 ? null : toPolicy(result.rows[0]);
}

export async function listPoliciesForExamVersion(examVersionId: string): Promise<InstitutionExamPolicy[]> {
  const result = await db.query(`SELECT * FROM institution_exam_policies WHERE exam_version_id = $1`, [examVersionId]);
  return result.rows.map(toPolicy);
}

export type PolicyComplianceResult = { status: 'POLICY_PENDING' } | { status: 'VERIFIED'; thresholdRules: Record<string, unknown> };

/**
 * F7 deliberately does NOT calculate admission compliance (task 20's
 * own instruction) -- this returns only the policy's own verification
 * status and, when verified, the raw threshold rules for a FUTURE phase
 * to interpret. It never computes a pass/fail admission verdict itself.
 */
export async function evaluatePolicyCompliance(policyId: string): Promise<PolicyComplianceResult> {
  const policy = await getInstitutionExamPolicy(policyId);
  if (!policy) throw new Error(`policy ${policyId} not found`);
  if (policy.verificationStatus === 'POLICY_PENDING') return { status: 'POLICY_PENDING' };
  return { status: 'VERIFIED', thresholdRules: policy.thresholdRules ?? {} };
}
