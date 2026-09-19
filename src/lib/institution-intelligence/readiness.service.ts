/**
 * F12 -- Readiness Intelligence (task sections 17/18/19/20). Reads
 * ONLY F9's real `readiness_snapshots` (the LATEST snapshot per
 * exam profile) -- never legacy `exam-readiness.service.ts`
 * (INV-F12-09, structurally guarded, see f12-source-guards.test.ts),
 * never a second readiness computation (INV-F12-08). Scoped to exactly
 * ONE `examVersionId` per call -- there is no code path in this file
 * that aggregates across more than one exam version in the same
 * result, which is what makes incompatible-exam-version averaging
 * structurally impossible rather than merely avoided by convention
 * (INV-F12-17).
 */
import { db } from '@/lib/db';
import { requireInstitutionAccess } from './authorization';
import { getActiveAnalyticsPolicy, applyCohortSuppression, type SuppressibleAggregate } from './policy.service';
import { buildMetric, nowIso, type AnalyticsScope, type MetricEnvelope } from './types';
import type { ReadinessDimension, DimensionStatus, OverallReadinessStatus, ScoreProjectionAvailability } from '@/lib/readiness/types';

interface LatestSnapshotRow {
  student_id: string;
  overall_status: OverallReadinessStatus;
  dimensions: Array<{ dimension: ReadinessDimension; status: DimensionStatus }>;
  score_projection_availability: ScoreProjectionAvailability;
}

async function latestSnapshotsForInstitution(institutionId: string, examVersionId: string, classId?: string): Promise<LatestSnapshotRow[]> {
  const params: unknown[] = [institutionId, examVersionId];
  let classFilter = '';
  if (classId) {
    params.push(classId);
    classFilter = `AND ce.class_id = $${params.length}`;
  }
  const result = await db.query(
    `
    SELECT DISTINCT ON (rs.exam_profile_id)
      rs.student_id, rs.overall_status, rs.dimensions, rs.score_projection_availability
    FROM readiness_snapshots rs
    JOIN student_exam_profiles sep ON sep.id = rs.exam_profile_id
    JOIN class_enrollments ce ON ce.student_id = rs.student_id AND ce.status = 'ACTIVE'
    JOIN classes c ON c.id = ce.class_id AND c.institution_id = $1
    WHERE rs.exam_version_id = $2 ${classFilter}
    ORDER BY rs.exam_profile_id, rs.calculated_at DESC
    `,
    params
  );
  return result.rows;
}

export interface InstitutionReadinessSummary {
  scope: AnalyticsScope;
  examVersionId: string;
  cohort: SuppressibleAggregate<{
    learnerCount: MetricEnvelope<number>;
    overallStatusDistribution: Record<OverallReadinessStatus, number>;
    dimensionStatusDistribution: Record<string, Record<DimensionStatus, number>>;
    scoreProjectionAvailabilityDistribution: Record<ScoreProjectionAvailability, number>;
  }>;
}

export async function getInstitutionReadiness(actorUserId: string, institutionId: string, params: { examVersionId: string; classId?: string }): Promise<InstitutionReadinessSummary> {
  await requireInstitutionAccess(actorUserId, institutionId);
  const policy = await getActiveAnalyticsPolicy();
  const rows = await latestSnapshotsForInstitution(institutionId, params.examVersionId, params.classId);

  const overallStatusDistribution: Record<string, number> = {};
  const dimensionStatusDistribution: Record<string, Record<string, number>> = {};
  const scoreProjectionAvailabilityDistribution: Record<string, number> = {};

  for (const row of rows) {
    overallStatusDistribution[row.overall_status] = (overallStatusDistribution[row.overall_status] ?? 0) + 1;
    scoreProjectionAvailabilityDistribution[row.score_projection_availability] = (scoreProjectionAvailabilityDistribution[row.score_projection_availability] ?? 0) + 1;
    for (const dim of row.dimensions) {
      if (!dimensionStatusDistribution[dim.dimension]) dimensionStatusDistribution[dim.dimension] = {};
      dimensionStatusDistribution[dim.dimension][dim.status] = (dimensionStatusDistribution[dim.dimension][dim.status] ?? 0) + 1;
    }
  }

  const scope: AnalyticsScope = params.classId ? { type: 'CLASS', id: params.classId } : { type: 'INSTITUTION', id: institutionId };
  const lifetime = { type: 'LIFETIME' as const, asOf: nowIso() };

  const inner = {
    learnerCount: buildMetric({
      metricId: 'READINESS_LEARNER_COUNT', name: 'Learners With a Readiness Snapshot for This Exam Version', scope, timeWindow: lifetime,
      populationDescription: `active learners with >=1 readiness_snapshots row for exam version ${params.examVersionId}`, populationCount: rows.length,
      numerator: rows.length, dataSource: 'readiness_snapshots (latest per exam profile)', value: rows.length,
    }),
    overallStatusDistribution: overallStatusDistribution as Record<OverallReadinessStatus, number>,
    dimensionStatusDistribution,
    scoreProjectionAvailabilityDistribution: scoreProjectionAvailabilityDistribution as Record<ScoreProjectionAvailability, number>,
  };

  return { scope, examVersionId: params.examVersionId, cohort: applyCohortSuppression(rows.length, policy, inner) };
}
