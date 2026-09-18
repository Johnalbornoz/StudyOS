/**
 * F8 -- diagnosis orchestration (task §5). Fetches evidence + active
 * misconceptions (READ), calls the pure classifiers, persists an
 * append-only learner_gap_diagnoses row. Optionally enriches the
 * stored record with a READ-ONLY snapshot of Canonical V2's current
 * decision for explanatory context only -- a Canonical V2 read failure
 * never fails a diagnosis (INV-F8-01/02: F8 does not depend on, and
 * never writes, Canonical V2 state).
 */
import { db, type DbExecutor } from '@/lib/db';
import { fetchEvidenceForDiagnosis, fetchEvidenceByIds } from './evidence-gate.service';
import { classifyAllDimensions, combineDiagnosis } from './classification.algorithms';
import { getActiveDiagnosticPolicy, getDiagnosticPolicyById } from './policy.service';
import { getActiveMisconceptionSignatureIdsForConcept } from '@/services/misconception.service';
import { getCanonicalPedagogicalDecision, CanonicalDecisionUnavailableError } from '@/lib/pedagogical-decision/canonical-decision.service';
import type { DiagnosisScope, GapDiagnosis } from './types';

export interface StoredGapDiagnosis extends GapDiagnosis {
  id: string;
  studentId: string;
  conceptId: string;
  subjectId: string | null;
  scope: DiagnosisScope;
  policyVersionId: string;
  canonicalContext: { stage: string; actionState: string } | null;
  computedAt: string;
}

async function readCanonicalContextForExplanation(studentId: string, conceptId: string): Promise<{ stage: string; actionState: string } | null> {
  try {
    const { decision } = await getCanonicalPedagogicalDecision({ studentId, conceptId });
    return { stage: decision.stage, actionState: decision.actionState };
  } catch (err) {
    if (err instanceof CanonicalDecisionUnavailableError) return null;
    return null;
  }
}

export async function runDiagnosis(params: {
  studentId: string;
  conceptId: string;
  subjectId?: string;
  scope?: DiagnosisScope;
}): Promise<StoredGapDiagnosis> {
  const scope = params.scope ?? {};
  const [evidence, activeMisconceptionSignatureIds, policy, canonicalContext] = await Promise.all([
    fetchEvidenceForDiagnosis(params.studentId, params.conceptId),
    getActiveMisconceptionSignatureIdsForConcept(params.studentId, params.conceptId),
    getActiveDiagnosticPolicy(),
    readCanonicalContextForExplanation(params.studentId, params.conceptId),
  ]);

  const dimensions = classifyAllDimensions(evidence, policy.rules, scope, activeMisconceptionSignatureIds);
  const diagnosis = combineDiagnosis(dimensions, policy.rules);

  return persistDiagnosis({
    studentId: params.studentId,
    conceptId: params.conceptId,
    subjectId: params.subjectId ?? null,
    scope,
    diagnosis,
    policyVersionId: policy.id,
    canonicalContext,
  });
}

/** Task §38 -- deterministic replay: re-fetches the EXACT immutable evidence rows by id and re-runs classification under an explicit (possibly historical) policy version. Never writes a new diagnosis row -- pure verification. */
export async function replayDiagnosis(params: {
  evidenceIds: string[];
  scope: DiagnosisScope;
  policyVersionId: string;
  activeMisconceptionSignatureIds: string[];
}): Promise<GapDiagnosis> {
  const [evidence, policy] = await Promise.all([
    fetchEvidenceByIds(params.evidenceIds),
    getDiagnosticPolicyById(params.policyVersionId),
  ]);
  if (!policy) throw new Error(`diagnostic policy ${params.policyVersionId} not found`);
  const dimensions = classifyAllDimensions(evidence, policy.rules, params.scope, params.activeMisconceptionSignatureIds);
  return combineDiagnosis(dimensions, policy.rules);
}

async function persistDiagnosis(params: {
  studentId: string;
  conceptId: string;
  subjectId: string | null;
  scope: DiagnosisScope;
  diagnosis: GapDiagnosis;
  policyVersionId: string;
  canonicalContext: { stage: string; actionState: string } | null;
  client?: DbExecutor;
}): Promise<StoredGapDiagnosis> {
  const client = params.client ?? db;
  const result = await client.query(
    `
    INSERT INTO learner_gap_diagnoses (
      student_id, concept_id, subject_id, scope, primary_gap_type, secondary_signals, confidence,
      supporting_evidence_ids, contradicting_evidence_ids, reason_codes, alternatives, policy_version_id, canonical_context
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id, computed_at
    `,
    [
      params.studentId,
      params.conceptId,
      params.subjectId,
      JSON.stringify(params.scope),
      params.diagnosis.primaryGapType,
      params.diagnosis.secondarySignals,
      params.diagnosis.confidence,
      params.diagnosis.supportingEvidenceIds,
      params.diagnosis.contradictingEvidenceIds,
      params.diagnosis.reasonCodes,
      JSON.stringify(params.diagnosis.alternatives),
      params.policyVersionId,
      params.canonicalContext ? JSON.stringify(params.canonicalContext) : null,
    ]
  );

  return {
    id: result.rows[0].id,
    studentId: params.studentId,
    conceptId: params.conceptId,
    subjectId: params.subjectId,
    scope: params.scope,
    policyVersionId: params.policyVersionId,
    canonicalContext: params.canonicalContext,
    computedAt: result.rows[0].computed_at instanceof Date ? result.rows[0].computed_at.toISOString() : result.rows[0].computed_at,
    ...params.diagnosis,
  };
}

export async function getDiagnosisById(diagnosisId: string, client: DbExecutor = db): Promise<StoredGapDiagnosis | null> {
  const result = await client.query(`SELECT * FROM learner_gap_diagnoses WHERE id = $1`, [diagnosisId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    subjectId: row.subject_id,
    scope: row.scope ?? {},
    primaryGapType: row.primary_gap_type,
    secondarySignals: row.secondary_signals ?? [],
    confidence: Number(row.confidence),
    supportingEvidenceIds: row.supporting_evidence_ids ?? [],
    contradictingEvidenceIds: row.contradicting_evidence_ids ?? [],
    reasonCodes: row.reason_codes ?? [],
    alternatives: row.alternatives ?? [],
    policyVersionId: row.policy_version_id,
    canonicalContext: row.canonical_context ?? null,
    computedAt: row.computed_at instanceof Date ? row.computed_at.toISOString() : row.computed_at,
  };
}

export async function listDiagnosesForStudentConcept(studentId: string, conceptId: string, client: DbExecutor = db): Promise<StoredGapDiagnosis[]> {
  const result = await client.query(
    `SELECT * FROM learner_gap_diagnoses WHERE student_id = $1 AND concept_id = $2 ORDER BY computed_at DESC`,
    [studentId, conceptId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    subjectId: row.subject_id,
    scope: row.scope ?? {},
    primaryGapType: row.primary_gap_type,
    secondarySignals: row.secondary_signals ?? [],
    confidence: Number(row.confidence),
    supportingEvidenceIds: row.supporting_evidence_ids ?? [],
    contradictingEvidenceIds: row.contradicting_evidence_ids ?? [],
    reasonCodes: row.reason_codes ?? [],
    alternatives: row.alternatives ?? [],
    policyVersionId: row.policy_version_id,
    canonicalContext: row.canonical_context ?? null,
    computedAt: row.computed_at instanceof Date ? row.computed_at.toISOString() : row.computed_at,
  }));
}
