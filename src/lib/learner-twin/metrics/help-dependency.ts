/**
 * Phase 1E, Step 3/4: Help Dependency (student + concept).
 *
 * A transparent component model, NOT a weighted score -- no existing
 * approved weighting between hints/AI-assistance/independence was
 * found anywhere in the codebase (Phase 1E's own source audit), so
 * none was invented. `band` is always `null`: see the module's own
 * HelpDependencyComponents doc comment.
 *
 * Sample gate (Step 4) reuses the EXISTING mastery-policy sufficiency
 * threshold (mastery_policies.minimum_evidence_count) rather than an
 * invented cutoff -- below it, this returns INSUFFICIENT_EVIDENCE, not
 * a fabricated HIGH_DEPENDENCY from one assisted attempt.
 */
import { db } from '@/lib/db';
import { getIndependentMastery } from '@/services/learner-model.service';
import { getActiveMasteryPolicy } from '@/services/knowledge-state.service';
import {
  type HelpDependencyComponents,
  type MetricResult,
  HELP_DEPENDENCY_MODEL_VERSION,
  metricAvailable,
  metricUnavailable,
  quality,
} from './types';

interface EvidenceRow {
  ai_assistance_type: string;
  hints_used: number;
  timestamp: string;
}
interface VerificationRow {
  outcome: string | null;
}

/** Pure: the actual component computation, given already-fetched rows. Independently testable without a DB. */
export function computeHelpDependency(
  evidenceRows: EvidenceRow[],
  independentMastery: number | null,
  verificationRows: VerificationRow[]
): HelpDependencyComponents {
  const totalEvidenceCount = evidenceRows.length;
  const assistedEvidenceCount = evidenceRows.filter((r) => r.ai_assistance_type !== 'NONE').length;
  const independentEvidenceCount = totalEvidenceCount - assistedEvidenceCount;
  const hintUsageCount = evidenceRows.filter((r) => Number(r.hints_used) > 0).length;

  const resolved = verificationRows.filter((r) => r.outcome !== null);
  const confirmedCount = resolved.filter((r) => r.outcome === 'CONFIRMED').length;
  const contradictedCount = resolved.filter((r) => r.outcome === 'CONTRADICTED').length;
  const inconclusiveCount = resolved.filter((r) => r.outcome === 'INCONCLUSIVE').length;

  const lastUpdatedAt = evidenceRows.length > 0
    ? evidenceRows.reduce((latest, r) => (r.timestamp > latest ? r.timestamp : latest), evidenceRows[0].timestamp)
    : null;

  return {
    totalEvidenceCount,
    assistedEvidenceCount,
    independentEvidenceCount,
    assistedEvidenceShare: totalEvidenceCount > 0 ? assistedEvidenceCount / totalEvidenceCount : 0,
    independentEvidenceShare: totalEvidenceCount > 0 ? independentEvidenceCount / totalEvidenceCount : 0,
    hintUsageShare: totalEvidenceCount > 0 ? hintUsageCount / totalEvidenceCount : 0,
    independentMastery,
    verificationConsistency:
      resolved.length > 0
        ? { resolvedCount: resolved.length, confirmedCount, contradictedCount, inconclusiveCount, confirmedShare: confirmedCount / resolved.length }
        : null,
    band: null,
    quality: quality(totalEvidenceCount, lastUpdatedAt, HELP_DEPENDENCY_MODEL_VERSION),
  };
}

/** Read-only. One query for evidence, one for the mastery-policy sample gate (reused, not reimplemented), one for verification attempts. */
export async function readHelpDependency(studentId: string, conceptId: string): Promise<MetricResult<HelpDependencyComponents>> {
  const policy = await getActiveMasteryPolicy();

  const evidenceResult = await db.query(
    `SELECT ai_assistance_type, hints_used, timestamp FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  const evidenceRows: EvidenceRow[] = evidenceResult.rows;

  if (evidenceRows.length < policy.minimumEvidenceCount) {
    return metricUnavailable(
      'INSUFFICIENT_EVIDENCE',
      `${evidenceRows.length} evidence row(s) for this concept; the active mastery policy requires at least ${policy.minimumEvidenceCount} before Help Dependency is meaningful.`
    );
  }

  const [independentMastery, verificationResult] = await Promise.all([
    getIndependentMastery(studentId, conceptId),
    db.query(`SELECT outcome FROM verification_attempts WHERE student_id = $1 AND concept_id = $2`, [studentId, conceptId]),
  ]);

  return metricAvailable(computeHelpDependency(evidenceRows, independentMastery, verificationResult.rows));
}
