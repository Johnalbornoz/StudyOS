/**
 * F9 -- Readiness Engine orchestrator (task §2/§5/§6). Composes F7's
 * real blueprint/full-mock-guard services and F8's real runDiagnosis
 * (via blueprint-coverage.service.ts), then applies the pure
 * dimension-classification algorithms and persists an append-only
 * snapshot. Never writes Canonical V2 state; never calls AI.
 */
import { db, type DbExecutor } from '@/lib/db';
import { getBlueprintForVersion, listObjectiveTargets } from '@/lib/assessment/blueprint.service';
import { canFullMockBeOffered } from '@/lib/assessment/full-mock-guard.service';
import { getDiagnosisById } from '@/lib/diagnostics/diagnosis.service';
import type { GapType } from '@/lib/diagnostics/types';
import { classifyBlueprintTargetCoverage, summarizeBlueprintCoverage } from './blueprint-coverage.service';
import { getActiveReadinessPolicy } from './policy.service';
import { getScoreProjectionAvailability } from './score-projection.service';
import {
  classifyBlueprintCoverageDimension,
  classifyEvidenceSufficiencyDimension,
  classifyGapBasedDimension,
  classifySimulationPerformanceDimension,
  combineOverallReadinessStatus,
} from './dimension-classification.algorithms';
import type { DimensionReadinessResult, ReadinessSnapshot } from './types';

const GAP_DIMENSION_MAP: Array<{ dimension: 'KNOWLEDGE_READINESS' | 'SKILL_READINESS' | 'EXAM_TECHNIQUE_READINESS' | 'SPEED_FLUENCY_READINESS'; gapType: GapType }> = [
  { dimension: 'KNOWLEDGE_READINESS', gapType: 'KNOWLEDGE_GAP' },
  { dimension: 'SKILL_READINESS', gapType: 'SKILL_GAP' },
  { dimension: 'EXAM_TECHNIQUE_READINESS', gapType: 'EXAM_TECHNIQUE_GAP' },
  { dimension: 'SPEED_FLUENCY_READINESS', gapType: 'SPEED_FLUENCY_GAP' },
];

async function computeSimulationPerformanceStats(studentId: string, examVersionId: string, client: DbExecutor) {
  const attempts = await client.query(
    `SELECT sa.exam_attempt_id FROM simulation_attempts sa WHERE sa.student_id = $1 AND sa.exam_version_id = $2 AND sa.status = 'COMPLETED'`,
    [studentId, examVersionId]
  );
  const attemptIds: string[] = attempts.rows.map((r: any) => r.exam_attempt_id);
  if (attemptIds.length === 0) return { completedAttemptCount: 0, averageScorePercent: null as number | null, byComponent: {} as Record<string, number>, attemptIds };

  const scores = await client.query(
    `SELECT assessment_component_id, SUM(score) AS total_score, SUM(max_score) AS total_max
     FROM exam_attempt_item_responses WHERE exam_attempt_id = ANY($1::uuid[]) GROUP BY assessment_component_id`,
    [attemptIds]
  );
  const byComponent: Record<string, number> = {};
  let totalScore = 0;
  let totalMax = 0;
  for (const row of scores.rows) {
    const s = Number(row.total_score) || 0;
    const m = Number(row.total_max) || 0;
    totalScore += s;
    totalMax += m;
    byComponent[row.assessment_component_id] = m > 0 ? (s / m) * 100 : 0;
  }
  return { completedAttemptCount: attemptIds.length, averageScorePercent: totalMax > 0 ? (totalScore / totalMax) * 100 : null, byComponent, attemptIds };
}

async function computeEvidenceSufficiencyStats(studentConceptIds: string[], client: DbExecutor) {
  if (studentConceptIds.length === 0) {
    return { totalQualifyingEvidenceCount: 0, independentEvidenceCount: 0, distinctQuestionTypeCount: 0, distinctContextCount: 0, mostRecentEvidenceAgeDays: null as number | null };
  }
  const result = await client.query(
    `SELECT ai_assistance_type, activity_type, metadata, "timestamp" FROM learning_evidence WHERE concept_id = ANY($1::uuid[])`,
    [studentConceptIds]
  );
  const rows = result.rows;
  const independentCount = rows.filter((r: any) => r.ai_assistance_type === 'NONE').length;
  const questionTypes = new Set(rows.map((r: any) => (r.metadata && r.metadata.questionType) || r.activity_type).filter(Boolean));
  const contexts = new Set(rows.map((r: any) => (r.metadata && r.metadata.context && JSON.stringify(r.metadata.context)) || null).filter(Boolean));
  const mostRecent = rows.reduce((latest: Date | null, r: any) => {
    const ts = new Date(r.timestamp);
    return !latest || ts > latest ? ts : latest;
  }, null as Date | null);
  const ageDays = mostRecent ? Math.floor((Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24)) : null;

  return {
    totalQualifyingEvidenceCount: rows.length,
    independentEvidenceCount: independentCount,
    distinctQuestionTypeCount: questionTypes.size,
    distinctContextCount: contexts.size,
    mostRecentEvidenceAgeDays: ageDays,
  };
}

export async function computeReadinessSnapshot(params: { studentId: string; examProfileId: string; examVersionId: string }): Promise<ReadinessSnapshot> {
  const policy = await getActiveReadinessPolicy();
  const blueprint = await getBlueprintForVersion(params.examVersionId);
  const targets = blueprint ? await listObjectiveTargets(blueprint.id) : [];

  const coverageResults = await Promise.all(targets.map((t) => classifyBlueprintTargetCoverage(t, params.studentId, params.examVersionId)));
  const coverageSummary = summarizeBlueprintCoverage(coverageResults);

  const diagnosisIds = coverageResults.filter((c) => c.diagnosisId).map((c) => c.diagnosisId as string);
  const diagnoses = (await Promise.all(diagnosisIds.map((id) => getDiagnosisById(id)))).filter((d) => d !== null) as NonNullable<Awaited<ReturnType<typeof getDiagnosisById>>>[];

  const studentConceptIds = Array.from(new Set(coverageResults.filter((c) => c.studentConceptId).map((c) => c.studentConceptId as string)));

  const dimensions: DimensionReadinessResult[] = [];
  for (const { dimension, gapType } of GAP_DIMENSION_MAP) {
    const applicable = diagnoses.filter((d) => {
      if (dimension === 'SKILL_READINESS') return !!d.scope.skillId;
      if (dimension === 'EXAM_TECHNIQUE_READINESS') return !!d.scope.commandTermId;
      return true;
    });
    dimensions.push(classifyGapBasedDimension(dimension, gapType, applicable, policy.rules));
  }
  dimensions.push(classifyBlueprintCoverageDimension(coverageSummary, policy.rules));

  const simPerf = await computeSimulationPerformanceStats(params.studentId, params.examVersionId, db);
  dimensions.push(classifySimulationPerformanceDimension(simPerf, policy.rules));

  const evidenceStats = await computeEvidenceSufficiencyStats(studentConceptIds, db);
  dimensions.push(classifyEvidenceSufficiencyDimension(evidenceStats, policy.rules));

  const fullMock = await canFullMockBeOffered(params.examVersionId);
  const overallStatus = combineOverallReadinessStatus(dimensions, fullMock.ready);

  const scoreProjectionAvailability = await getScoreProjectionAvailability(params.examVersionId, evidenceStats.totalQualifyingEvidenceCount);

  const limitations: string[] = [];
  if (coverageSummary.unsupportedByPlatform > 0) limitations.push(`${coverageSummary.unsupportedByPlatform} blueprint target(s) unsupported by the platform -- excluded from coverage calculations, never counted as learner weakness`);
  if (!fullMock.ready) limitations.push(...fullMock.reasons.map((r) => `FULL_MOCK_BLOCKED: ${r}`));

  const reasonCodes = Array.from(new Set(dimensions.flatMap((d) => d.reasonCodes)));

  return persistReadinessSnapshot({
    studentId: params.studentId,
    examProfileId: params.examProfileId,
    examVersionId: params.examVersionId,
    readinessPolicyVersionId: policy.id,
    overallStatus,
    dimensions,
    blueprintCoverage: coverageSummary,
    evidenceCounts: { total: evidenceStats.totalQualifyingEvidenceCount, independent: evidenceStats.independentEvidenceCount, assisted: evidenceStats.totalQualifyingEvidenceCount - evidenceStats.independentEvidenceCount },
    diagnosticGapReferences: diagnosisIds,
    simulationHistoryUsed: simPerf.attemptIds,
    reasonCodes,
    limitations,
    scoreProjectionAvailability,
  });
}

async function persistReadinessSnapshot(snapshot: Omit<ReadinessSnapshot, 'id' | 'calculatedAt'>): Promise<ReadinessSnapshot> {
  const result = await db.query(
    `
    INSERT INTO readiness_snapshots (
      student_id, exam_profile_id, exam_version_id, readiness_policy_version_id, overall_status, dimensions,
      blueprint_coverage, evidence_counts, diagnostic_gap_references, simulation_history_used, reason_codes,
      limitations, score_projection_availability
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id, calculated_at
    `,
    [
      snapshot.studentId,
      snapshot.examProfileId,
      snapshot.examVersionId,
      snapshot.readinessPolicyVersionId,
      snapshot.overallStatus,
      JSON.stringify(snapshot.dimensions),
      JSON.stringify(snapshot.blueprintCoverage),
      JSON.stringify(snapshot.evidenceCounts),
      snapshot.diagnosticGapReferences,
      snapshot.simulationHistoryUsed,
      snapshot.reasonCodes,
      snapshot.limitations,
      snapshot.scoreProjectionAvailability,
    ]
  );
  return { ...snapshot, id: result.rows[0].id, calculatedAt: result.rows[0].calculated_at instanceof Date ? result.rows[0].calculated_at.toISOString() : result.rows[0].calculated_at };
}

function rowToSnapshot(row: any): ReadinessSnapshot {
  return {
    id: row.id,
    studentId: row.student_id,
    examProfileId: row.exam_profile_id,
    examVersionId: row.exam_version_id,
    readinessPolicyVersionId: row.readiness_policy_version_id,
    overallStatus: row.overall_status,
    dimensions: row.dimensions,
    blueprintCoverage: row.blueprint_coverage,
    evidenceCounts: row.evidence_counts,
    diagnosticGapReferences: row.diagnostic_gap_references ?? [],
    simulationHistoryUsed: row.simulation_history_used ?? [],
    reasonCodes: row.reason_codes ?? [],
    limitations: row.limitations ?? [],
    scoreProjectionAvailability: row.score_projection_availability,
    calculatedAt: row.calculated_at instanceof Date ? row.calculated_at.toISOString() : row.calculated_at,
  };
}

export async function getReadinessSnapshotById(id: string, client: DbExecutor = db): Promise<ReadinessSnapshot | null> {
  const result = await client.query(`SELECT * FROM readiness_snapshots WHERE id = $1`, [id]);
  return result.rows.length === 0 ? null : rowToSnapshot(result.rows[0]);
}

export async function getLatestReadinessSnapshot(examProfileId: string, client: DbExecutor = db): Promise<ReadinessSnapshot | null> {
  const result = await client.query(`SELECT * FROM readiness_snapshots WHERE exam_profile_id = $1 ORDER BY calculated_at DESC LIMIT 1`, [examProfileId]);
  return result.rows.length === 0 ? null : rowToSnapshot(result.rows[0]);
}

export async function listReadinessSnapshots(examProfileId: string, client: DbExecutor = db): Promise<ReadinessSnapshot[]> {
  const result = await client.query(`SELECT * FROM readiness_snapshots WHERE exam_profile_id = $1 ORDER BY calculated_at DESC`, [examProfileId]);
  return result.rows.map(rowToSnapshot);
}
