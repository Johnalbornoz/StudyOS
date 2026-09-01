/**
 * Phase 1E, Steps 13-14: Transfer Coverage (student + subject).
 *
 * Descriptive coverage only -- reuses `learning_evidence` rows already
 * written by transfer.service.ts (source_type = 'TRANSFER'); does NOT
 * reimplement transfer evaluation or `computeTransferScore`.
 *
 * Denominator (Step 13, documented explicitly): `eligibleConceptCount`
 * is concepts in this subject where the student has a mastery_records
 * row -- i.e. concepts they have actually engaged with -- NOT the full
 * subject curriculum. A concept the student has never touched cannot
 * fairly be called "transfer-eligible" yet, and counting it in the
 * denominator would understate coverage for a student who simply
 * hasn't reached that part of the subject.
 *
 * Step 14: one successful Transfer task is not proof of general
 * ability -- this module reports counts/coverage, never a
 * GENERAL_TRANSFER_ABILITY label, and the existing per-concept
 * `getTransferScore` (already sample-gated, unchanged) remains the
 * only per-concept transfer strength signal.
 */
import { db } from '@/lib/db';
import { type TransferCoverageSummary, type MetricResult, TRANSFER_COVERAGE_MODEL_VERSION, metricAvailable, metricUnavailable, quality } from './types';

interface TransferEvidenceRow {
  concept_id: string;
  result: string;
  timestamp: string;
}

export function computeTransferCoverage(eligibleConceptIds: string[], transferRows: TransferEvidenceRow[]): TransferCoverageSummary {
  const coveredConceptIds = new Set(transferRows.map((r) => r.concept_id));
  const successfulTransferCount = transferRows.filter((r) => r.result === 'correct').length;
  const lastTransferAt = transferRows.length > 0 ? transferRows.reduce((latest, r) => (r.timestamp > latest ? r.timestamp : latest), transferRows[0].timestamp) : null;

  return {
    transferEvidenceCount: transferRows.length,
    successfulTransferCount,
    coveredConceptCount: coveredConceptIds.size,
    eligibleConceptCount: eligibleConceptIds.length,
    coveragePercent: eligibleConceptIds.length > 0 ? Math.round((coveredConceptIds.size / eligibleConceptIds.length) * 100) : null,
    lastTransferAt,
    quality: quality(transferRows.length, lastTransferAt, TRANSFER_COVERAGE_MODEL_VERSION, eligibleConceptIds.length > 0 ? Math.round((coveredConceptIds.size / eligibleConceptIds.length) * 100) : undefined),
  };
}

export async function readTransferCoverage(studentId: string, subjectId: string): Promise<MetricResult<TransferCoverageSummary>> {
  const eligibleResult = await db.query<{ concept_id: string }>(
    `SELECT concept_id FROM mastery_records WHERE student_id = $1 AND subject_id = $2`,
    [studentId, subjectId]
  );
  const eligibleConceptIds = eligibleResult.rows.map((r) => r.concept_id);

  if (eligibleConceptIds.length === 0) {
    return metricUnavailable('INSUFFICIENT_EVIDENCE', 'No engaged concepts in this subject yet -- transfer coverage has no eligible denominator.');
  }

  const transferResult = await db.query<TransferEvidenceRow>(
    `SELECT concept_id, result, timestamp FROM learning_evidence
     WHERE student_id = $1 AND concept_id = ANY($2) AND source_type = 'TRANSFER'`,
    [studentId, eligibleConceptIds]
  );

  return metricAvailable(computeTransferCoverage(eligibleConceptIds, transferResult.rows));
}
