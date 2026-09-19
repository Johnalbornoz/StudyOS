/**
 * F12 -- Intervention Intelligence (task section 22) + Teacher
 * Operational Metrics (task section 23). Reads ONLY F11's own
 * `teacher_interventions` table directly (`institution_id`/`class_id`
 * are already real columns on that table -- no join needed to scope
 * it) and reuses F11-C1's own `getEffectiveStatus` function verbatim
 * for the derived EXPIRED status, so F12 never invents a second
 * lifecycle interpretation (INV-F12-22). No Teacher performance score,
 * ranking, or quality metric is computed anywhere in this file
 * (task section 23/INV-F12-13/14) -- only operational counts.
 */
import { db } from '@/lib/db';
import { requireInstitutionAccess, requireClassInInstitution } from './authorization';
import { getEffectiveStatus, type TeacherInterventionStatus } from '@/lib/student/teacher-intervention-execution.service';
import { buildMetric, nowIso, type AnalyticsScope, type MetricEnvelope } from './types';

export type InterventionType = 'CONCEPT_REINFORCEMENT' | 'SKILL_PRACTICE' | 'COMPETENCY_PRACTICE' | 'EXAM_PRACTICE';

export interface InterventionStatusDistribution {
  byStatus: Record<TeacherInterventionStatus, number>;
  byType: Record<InterventionType, number>;
  total: number;
}

async function fetchInterventionRows(institutionId: string, filters?: { classId?: string; interventionType?: InterventionType; sinceDays?: number }) {
  const params: unknown[] = [institutionId];
  const clauses = ['institution_id = $1'];
  if (filters?.classId) {
    params.push(filters.classId);
    clauses.push(`class_id = $${params.length}`);
  }
  if (filters?.interventionType) {
    params.push(filters.interventionType);
    clauses.push(`intervention_type = $${params.length}`);
  }
  if (filters?.sinceDays) {
    params.push(filters.sinceDays);
    clauses.push(`assigned_at >= now() - ($${params.length} || ' days')::interval`);
  }
  const result = await db.query(`SELECT status, due_at, intervention_type FROM teacher_interventions WHERE ${clauses.join(' AND ')}`, params);
  return result.rows as Array<{ status: TeacherInterventionStatus; due_at: Date | null; intervention_type: InterventionType }>;
}

export interface InstitutionInterventionSummary {
  scope: AnalyticsScope;
  timeWindowDescription: string;
  distribution: MetricEnvelope<InterventionStatusDistribution>;
}

/**
 * "Completed" here means the underlying activity was operationally
 * finalized -- it never means passed/mastered/high-scoring
 * (task section 22, INV-F12-... consistent with F11's own lifecycle
 * semantics). Effective status (EXPIRED) is DERIVED the same way F11's
 * own Student surface derives it -- never a second, F12-only rule.
 */
export async function getInstitutionInterventionSummary(
  actorUserId: string,
  institutionId: string,
  filters?: { classId?: string; interventionType?: InterventionType; sinceDays?: number }
): Promise<InstitutionInterventionSummary> {
  await requireInstitutionAccess(actorUserId, institutionId);
  if (filters?.classId) await requireClassInInstitution(actorUserId, institutionId, filters.classId);

  const rows = await fetchInterventionRows(institutionId, filters);
  const byStatus: Record<string, number> = { ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, EXPIRED: 0 };
  const byType: Record<string, number> = { CONCEPT_REINFORCEMENT: 0, SKILL_PRACTICE: 0, COMPETENCY_PRACTICE: 0, EXAM_PRACTICE: 0 };

  for (const row of rows) {
    const effectiveStatus = getEffectiveStatus(row.status, row.due_at ? row.due_at.toISOString() : null);
    byStatus[effectiveStatus] = (byStatus[effectiveStatus] ?? 0) + 1;
    byType[row.intervention_type] = (byType[row.intervention_type] ?? 0) + 1;
  }

  const scope: AnalyticsScope = filters?.classId ? { type: 'CLASS', id: filters.classId } : { type: 'INSTITUTION', id: institutionId };
  const timeWindow = filters?.sinceDays
    ? { type: 'ROLLING_DAYS' as const, days: filters.sinceDays, asOf: nowIso() }
    : { type: 'LIFETIME' as const, asOf: nowIso() };

  return {
    scope,
    timeWindowDescription: filters?.sinceDays ? `assigned_at within the last ${filters.sinceDays} days` : 'all time (lifetime)',
    distribution: buildMetric({
      metricId: 'INTERVENTION_STATUS_DISTRIBUTION', name: 'Teacher Intervention Status/Type Distribution', scope, timeWindow,
      populationDescription: 'teacher_interventions rows in scope', populationCount: rows.length,
      numerator: rows.length, dataSource: 'teacher_interventions',
      limitations: [
        'COMPLETED means the underlying activity was operationally finalized -- it is never a claim of mastery, passing, readiness, or high score (task section 22)',
        'EXPIRED is derived on read from due_at, exactly as F11\'s own Student surface derives it -- never a second, F12-specific expiry rule',
      ],
      value: { byStatus: byStatus as Record<TeacherInterventionStatus, number>, byType: byType as Record<InterventionType, number>, total: rows.length },
    }),
  };
}

export interface TeacherOperationalSummary {
  membershipId: string;
  userId: string;
  activeAssignmentCount: number;
  activeLearnerCount: number;
  interventionsAssigned: number;
  interventionsCompleted: number;
  lastInterventionAssignedAt: string | null;
}

/**
 * Purely operational counts (task section 23) -- assigned/completed
 * counts and recency ONLY. No score, no ranking, no "BEST/WORST
 * TEACHER" comparison is ever computed or exposed (INV-F12-13/14).
 */
export async function getTeacherOperationalSummary(actorUserId: string, institutionId: string, membershipId: string): Promise<TeacherOperationalSummary> {
  await requireInstitutionAccess(actorUserId, institutionId);

  const membershipRow = await db.query(`SELECT user_id, institution_id FROM institution_memberships WHERE id = $1`, [membershipId]);
  if (membershipRow.rows.length === 0 || membershipRow.rows[0].institution_id !== institutionId) {
    throw new Error(`membership ${membershipId} does not belong to institution ${institutionId}`);
  }
  const userId = membershipRow.rows[0].user_id;

  const [assignmentStats, interventionStats] = await Promise.all([
    db.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM teacher_assignments WHERE institution_membership_id = $1 AND status = 'ACTIVE') AS active_assignment_count,
        (
          SELECT COUNT(DISTINCT ce.student_id)::int
          FROM teacher_assignments ta
          JOIN classes c ON (c.id = ta.class_id OR (ta.class_id IS NULL AND c.grade_id = ta.grade_id))
          JOIN class_enrollments ce ON ce.class_id = c.id AND ce.status = 'ACTIVE'
          WHERE ta.institution_membership_id = $1 AND ta.status = 'ACTIVE'
        ) AS active_learner_count
      `,
      [membershipId]
    ),
    db.query(
      `
      SELECT
        COUNT(*)::int AS assigned,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
        MAX(assigned_at) AS last_assigned_at
      FROM teacher_interventions WHERE assigned_by_user_id = $1 AND institution_id = $2
      `,
      [userId, institutionId]
    ),
  ]);

  return {
    membershipId,
    userId,
    activeAssignmentCount: assignmentStats.rows[0].active_assignment_count,
    activeLearnerCount: assignmentStats.rows[0].active_learner_count,
    interventionsAssigned: interventionStats.rows[0].assigned,
    interventionsCompleted: interventionStats.rows[0].completed,
    lastInterventionAssignedAt: interventionStats.rows[0].last_assigned_at ? new Date(interventionStats.rows[0].last_assigned_at).toISOString() : null,
  };
}
