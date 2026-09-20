/**
 * F12 -- Attention Areas (task section 35). Every reason code is
 * derived DETERMINISTICALLY from the same real metrics this module's
 * own sibling services already compute (never a second, opaque
 * computation, never AI -- task section 34/36). Each flag cites its
 * exact source metric id and the numbers behind it, so a reader can
 * verify the claim rather than trust an opaque "risk" label. Thresholds
 * are explicit, documented constants -- not a calibrated/approved
 * product policy (none exists yet, matching the small-cohort policy's
 * own OPEN_DECISION framing) -- and are never applied to a
 * cohort-suppressed (too-small) population.
 */
import { getInstitutionLearnerSummary } from './learning.service';
import { getInstitutionDiagnosticSummary } from './diagnostics.service';
import { getInstitutionInterventionSummary } from './interventions.service';
import { requireInstitutionAccess } from './authorization';
import { nowIso, type AnalyticsScope } from './types';

export type AttentionReasonCode =
  | 'INSUFFICIENT_EVIDENCE'
  | 'KNOWLEDGE_GAP_CONCENTRATION'
  | 'SKILL_GAP_CONCENTRATION'
  | 'TECHNIQUE_GAP_CONCENTRATION'
  | 'INTERVENTION_BACKLOG';

export interface AttentionArea {
  reasonCode: AttentionReasonCode;
  scope: AnalyticsScope;
  citedMetricId: string;
  citedNumerator: number;
  citedDenominator: number | null;
  threshold: number;
  detail: string;
}

/** Documented example thresholds -- NOT a calibrated/approved product policy (task section 27's OPEN_DECISION framing applies here too). */
const THRESHOLDS = {
  noEvidenceFraction: 0.3,
  knowledgeGapFraction: 0.25,
  skillGapFraction: 0.25,
  techniqueGapFraction: 0.25,
  interventionBacklogAssignedCount: 10,
};

export async function getInstitutionAttentionAreas(actorUserId: string, institutionId: string, filters?: { classId?: string }): Promise<AttentionArea[]> {
  await requireInstitutionAccess(actorUserId, institutionId);
  const scope: AnalyticsScope = filters?.classId ? { type: 'CLASS', id: filters.classId } : { type: 'INSTITUTION', id: institutionId };

  const [learning, diagnostics, interventions] = await Promise.all([
    getInstitutionLearnerSummary(actorUserId, institutionId, filters),
    getInstitutionDiagnosticSummary(actorUserId, institutionId, filters),
    getInstitutionInterventionSummary(actorUserId, institutionId, filters),
  ]);

  const areas: AttentionArea[] = [];

  if (!learning.cohort.suppressed) {
    const { evidencePresence } = learning.cohort.value;
    const noEvidenceFraction = evidencePresence.value.noEvidence / evidencePresence.population.count;
    if (evidencePresence.population.count > 0 && noEvidenceFraction >= THRESHOLDS.noEvidenceFraction) {
      areas.push({
        reasonCode: 'INSUFFICIENT_EVIDENCE', scope, citedMetricId: 'LEARNING_EVIDENCE_PRESENCE',
        citedNumerator: evidencePresence.value.noEvidence, citedDenominator: evidencePresence.population.count, threshold: THRESHOLDS.noEvidenceFraction,
        detail: `${evidencePresence.value.noEvidence} of ${evidencePresence.population.count} active learners have zero learning_evidence rows -- a real evidence gap, not a claim of poor performance`,
      });
    }
  }

  // F15 -- diagnostics/interventions are now cohort-suppressible
  // (ADR-F15-MIN-COHORT-POLICY.md); a suppressed cohort's distribution
  // is never read here, exactly like the pre-existing `learning`
  // suppression check above -- Attention never overrides or
  // second-guesses a suppression decision its own sibling metrics made.
  if (!diagnostics.cohort.suppressed && diagnostics.cohort.value.distribution.population.count > 0) {
    const total = diagnostics.cohort.value.distribution.population.count;
    const dist = diagnostics.cohort.value.distribution.value;
    const checks: Array<[AttentionReasonCode, number, number, string]> = [
      ['KNOWLEDGE_GAP_CONCENTRATION', dist.KNOWLEDGE_GAP ?? 0, THRESHOLDS.knowledgeGapFraction, 'KNOWLEDGE_GAP'],
      ['SKILL_GAP_CONCENTRATION', dist.SKILL_GAP ?? 0, THRESHOLDS.skillGapFraction, 'SKILL_GAP'],
      ['TECHNIQUE_GAP_CONCENTRATION', dist.EXAM_TECHNIQUE_GAP ?? 0, THRESHOLDS.techniqueGapFraction, 'EXAM_TECHNIQUE_GAP'],
    ];
    for (const [reasonCode, count, threshold] of checks) {
      if (count / total >= threshold) {
        areas.push({
          reasonCode, scope, citedMetricId: 'DIAGNOSTIC_GAP_DISTRIBUTION', citedNumerator: count, citedDenominator: total, threshold,
          detail: `${count} of ${total} latest diagnoses in scope are ${reasonCode.replace('_CONCENTRATION', '')} -- reused verbatim from F8, never re-classified by F12`,
        });
      }
    }
  }

  if (!interventions.cohort.suppressed) {
    const assignedCount = interventions.cohort.value.distribution.value.byStatus.ASSIGNED ?? 0;
    if (assignedCount >= THRESHOLDS.interventionBacklogAssignedCount) {
      areas.push({
        reasonCode: 'INTERVENTION_BACKLOG', scope, citedMetricId: 'INTERVENTION_STATUS_DISTRIBUTION',
        citedNumerator: assignedCount, citedDenominator: interventions.cohort.value.distribution.population.count, threshold: THRESHOLDS.interventionBacklogAssignedCount,
        detail: `${assignedCount} teacher_interventions rows remain ASSIGNED (never started) in scope`,
      });
    }
  }

  return areas;
}

export function attentionAreasCalculatedAt(): string {
  return nowIso();
}
