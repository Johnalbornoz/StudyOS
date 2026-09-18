/**
 * F8 -- deterministic explainability (task §11). Answers, from a
 * persisted diagnosis alone, every question task §11 requires: why
 * this classification, which evidence qualified/did not, what's
 * missing, what alternative was considered, which policy version.
 * Pure read, no re-classification.
 */
import { db, type DbExecutor } from '@/lib/db';
import { getDiagnosisById } from './diagnosis.service';
import { getDiagnosticPolicyById } from './policy.service';
import { fetchEvidenceByIds } from './evidence-gate.service';
import type { EvidenceRow } from './types';

export interface DiagnosisExplanation {
  diagnosisId: string;
  primaryGapType: string;
  confidence: number;
  reasonCodes: string[];
  policyVersion: number;
  supportingEvidence: EvidenceRow[];
  contradictingEvidence: EvidenceRow[];
  alternativesConsidered: unknown[];
  computedAt: string;
}

export async function explainDiagnosis(diagnosisId: string, client: DbExecutor = db): Promise<DiagnosisExplanation | null> {
  const diagnosis = await getDiagnosisById(diagnosisId, client);
  if (!diagnosis) return null;

  const policy = await getDiagnosticPolicyById(diagnosis.policyVersionId, client);
  const [supportingEvidence, contradictingEvidence] = await Promise.all([
    fetchEvidenceByIds(diagnosis.supportingEvidenceIds, client),
    fetchEvidenceByIds(diagnosis.contradictingEvidenceIds, client),
  ]);

  return {
    diagnosisId: diagnosis.id,
    primaryGapType: diagnosis.primaryGapType,
    confidence: diagnosis.confidence,
    reasonCodes: diagnosis.reasonCodes,
    policyVersion: policy?.version ?? -1,
    supportingEvidence,
    contradictingEvidence,
    alternativesConsidered: diagnosis.alternatives,
    computedAt: diagnosis.computedAt,
  };
}
