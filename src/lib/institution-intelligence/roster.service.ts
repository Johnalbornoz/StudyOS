/**
 * F12 -- Institution roster / population intelligence (task section 11).
 * "Active" is defined explicitly and consistently:
 *   - active TEACHER membership = institution_memberships.status = 'APPROVED' AND membership_role = 'TEACHER'
 *   - active teacher ASSIGNMENT = teacher_assignments.status = 'ACTIVE'
 *   - active ENROLLMENT = class_enrollments.status = 'ACTIVE'
 * Revoked/rejected/pending memberships and ended assignments/enrollments
 * are never counted as active (task section 11's own explicit
 * requirement). All queries are set-based GROUP BY/COUNT DISTINCT over
 * already-indexed columns -- never one query per learner/teacher/class
 * (task section 45).
 */
import { db } from '@/lib/db';
import { requireInstitutionAccess } from './authorization';
import { buildMetric, clampPagination, nowIso, type MetricEnvelope, type PaginatedResult, type PaginationParams } from './types';

export interface InstitutionOverview {
  institutionId: string;
  institutionName: string;
  institutionStatus: string;
  activeTeacherCount: MetricEnvelope<number>;
  activeClassCount: MetricEnvelope<number>;
  uniqueActiveLearnerCount: MetricEnvelope<number>;
  activeEnrollmentCount: MetricEnvelope<number>;
  gradeCount: number;
}

export async function getInstitutionOverview(actorUserId: string, institutionId: string): Promise<InstitutionOverview> {
  await requireInstitutionAccess(actorUserId, institutionId);

  const institutionRow = await db.query(`SELECT name, status FROM institutions WHERE id = $1`, [institutionId]);
  if (institutionRow.rows.length === 0) throw new Error(`institution ${institutionId} not found`);

  const [teacherCount, classCount, gradeCount, enrollmentStats] = await Promise.all([
    db.query(
      `SELECT COUNT(DISTINCT im.id)::int AS c
       FROM institution_memberships im
       WHERE im.institution_id = $1 AND im.membership_role = 'TEACHER' AND im.status = 'APPROVED'`,
      [institutionId]
    ),
    db.query(`SELECT COUNT(*)::int AS c FROM classes WHERE institution_id = $1`, [institutionId]),
    db.query(`SELECT COUNT(*)::int AS c FROM grades WHERE institution_id = $1`, [institutionId]),
    db.query(
      `
      SELECT
        COUNT(DISTINCT ce.student_id)::int AS unique_learners,
        COUNT(*)::int AS active_enrollments
      FROM class_enrollments ce
      JOIN classes c ON c.id = ce.class_id
      WHERE c.institution_id = $1 AND ce.status = 'ACTIVE'
      `,
      [institutionId]
    ),
  ]);

  const asOf = nowIso();
  const scope = { type: 'INSTITUTION' as const, id: institutionId };
  const lifetime = { type: 'LIFETIME' as const, asOf };

  return {
    institutionId,
    institutionName: institutionRow.rows[0].name,
    institutionStatus: institutionRow.rows[0].status,
    activeTeacherCount: buildMetric({
      metricId: 'INSTITUTION_ACTIVE_TEACHER_COUNT', name: 'Active Teachers', scope, timeWindow: lifetime,
      populationDescription: 'APPROVED TEACHER memberships in this institution', populationCount: teacherCount.rows[0].c,
      numerator: teacherCount.rows[0].c, denominator: null, dataSource: 'institution_memberships',
      exclusions: ['PENDING/REJECTED/REVOKED memberships'], value: teacherCount.rows[0].c,
    }),
    activeClassCount: buildMetric({
      metricId: 'INSTITUTION_CLASS_COUNT', name: 'Classes', scope, timeWindow: lifetime,
      populationDescription: 'classes belonging to this institution', populationCount: classCount.rows[0].c,
      numerator: classCount.rows[0].c, denominator: null, dataSource: 'classes',
      limitations: ['classes has no status column in the current schema -- this counts all classes that exist, not a distinct "active" lifecycle state'],
      value: classCount.rows[0].c,
    }),
    uniqueActiveLearnerCount: buildMetric({
      metricId: 'INSTITUTION_UNIQUE_ACTIVE_LEARNERS', name: 'Unique Active Learners', scope, timeWindow: lifetime,
      populationDescription: 'distinct students with >=1 ACTIVE class_enrollments row in this institution', populationCount: enrollmentStats.rows[0].unique_learners,
      numerator: enrollmentStats.rows[0].unique_learners, denominator: null, dataSource: 'class_enrollments JOIN classes',
      exclusions: ['ENDED enrollments'],
      limitations: ['a learner enrolled in multiple classes within this institution counts ONCE here (INV-F12-16) -- see activeEnrollmentCount for the enrollment-row total, which may legitimately exceed this'],
      value: enrollmentStats.rows[0].unique_learners,
    }),
    activeEnrollmentCount: buildMetric({
      metricId: 'INSTITUTION_ACTIVE_ENROLLMENT_COUNT', name: 'Active Enrollments', scope, timeWindow: lifetime,
      populationDescription: 'ACTIVE class_enrollments rows in this institution (one per class a learner is enrolled in)', populationCount: enrollmentStats.rows[0].active_enrollments,
      numerator: enrollmentStats.rows[0].active_enrollments, denominator: null, dataSource: 'class_enrollments JOIN classes',
      exclusions: ['ENDED enrollments'],
      limitations: ['this is an enrollment-row count, not a unique-learner count -- may legitimately exceed uniqueActiveLearnerCount when learners belong to multiple classes'],
      value: enrollmentStats.rows[0].active_enrollments,
    }),
    gradeCount: gradeCount.rows[0].c,
  };
}

export interface InstitutionGrade {
  id: string;
  name: string;
  classCount: number;
}

export async function getInstitutionGrades(actorUserId: string, institutionId: string): Promise<InstitutionGrade[]> {
  await requireInstitutionAccess(actorUserId, institutionId);
  const result = await db.query(
    `
    SELECT g.id, g.name, COUNT(c.id)::int AS class_count
    FROM grades g
    LEFT JOIN classes c ON c.grade_id = g.id
    WHERE g.institution_id = $1
    GROUP BY g.id, g.name
    ORDER BY g.name
    `,
    [institutionId]
  );
  return result.rows.map((r: any) => ({ id: r.id, name: r.name, classCount: r.class_count }));
}

export interface InstitutionClassSummary {
  id: string;
  name: string;
  gradeId: string | null;
  gradeName: string | null;
  activeEnrollmentCount: number;
}

/**
 * Bounded (task section 46) -- an institution's class list can grow
 * arbitrarily; deterministic ordering by name then id (never
 * unspecified DB order) makes pagination reproducible page-to-page.
 */
export async function getInstitutionClasses(
  actorUserId: string,
  institutionId: string,
  filters?: { gradeId?: string },
  pagination?: Partial<PaginationParams>
): Promise<PaginatedResult<InstitutionClassSummary>> {
  await requireInstitutionAccess(actorUserId, institutionId);
  const { limit, offset } = clampPagination(pagination);

  if (filters?.gradeId) {
    const gradeRow = await db.query(`SELECT institution_id FROM grades WHERE id = $1`, [filters.gradeId]);
    if (gradeRow.rows.length === 0 || gradeRow.rows[0].institution_id !== institutionId) {
      throw new Error(`grade ${filters.gradeId} does not belong to institution ${institutionId}`);
    }
  }

  const whereClauses = ['c.institution_id = $1'];
  const params: unknown[] = [institutionId];
  if (filters?.gradeId) {
    params.push(filters.gradeId);
    whereClauses.push(`c.grade_id = $${params.length}`);
  }
  const whereSql = whereClauses.join(' AND ');

  const totalResult = await db.query(`SELECT COUNT(*)::int AS c FROM classes c WHERE ${whereSql}`, params);
  params.push(limit, offset);
  const rowsResult = await db.query(
    `
    SELECT c.id, c.name, c.grade_id, g.name AS grade_name,
      (SELECT COUNT(*)::int FROM class_enrollments ce WHERE ce.class_id = c.id AND ce.status = 'ACTIVE') AS active_enrollment_count
    FROM classes c
    LEFT JOIN grades g ON g.id = c.grade_id
    WHERE ${whereSql}
    ORDER BY c.name, c.id
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );

  return {
    items: rowsResult.rows.map((r: any) => ({ id: r.id, name: r.name, gradeId: r.grade_id, gradeName: r.grade_name, activeEnrollmentCount: r.active_enrollment_count })),
    limit,
    offset,
    totalCount: totalResult.rows[0].c,
  };
}

export interface InstitutionTeacherSummary {
  membershipId: string;
  userId: string;
  activeAssignmentCount: number;
  activeLearnerCount: number;
}

/** Bounded (task section 46). No score, no ranking (task section 23) -- purely a roster with operational counts. */
export async function getInstitutionTeachers(
  actorUserId: string,
  institutionId: string,
  pagination?: Partial<PaginationParams>
): Promise<PaginatedResult<InstitutionTeacherSummary>> {
  await requireInstitutionAccess(actorUserId, institutionId);
  const { limit, offset } = clampPagination(pagination);

  const totalResult = await db.query(
    `SELECT COUNT(*)::int AS c FROM institution_memberships WHERE institution_id = $1 AND membership_role = 'TEACHER' AND status = 'APPROVED'`,
    [institutionId]
  );
  const rowsResult = await db.query(
    `
    SELECT
      im.id AS membership_id,
      im.user_id,
      (SELECT COUNT(*)::int FROM teacher_assignments ta WHERE ta.institution_membership_id = im.id AND ta.status = 'ACTIVE') AS active_assignment_count,
      (
        SELECT COUNT(DISTINCT ce.student_id)::int
        FROM teacher_assignments ta
        JOIN classes c ON (c.id = ta.class_id OR (ta.class_id IS NULL AND c.grade_id = ta.grade_id AND c.institution_id = im.institution_id))
        JOIN class_enrollments ce ON ce.class_id = c.id AND ce.status = 'ACTIVE'
        WHERE ta.institution_membership_id = im.id AND ta.status = 'ACTIVE'
      ) AS active_learner_count
    FROM institution_memberships im
    WHERE im.institution_id = $1 AND im.membership_role = 'TEACHER' AND im.status = 'APPROVED'
    ORDER BY im.id
    LIMIT $2 OFFSET $3
    `,
    [institutionId, limit, offset]
  );

  return {
    items: rowsResult.rows.map((r: any) => ({ membershipId: r.membership_id, userId: r.user_id, activeAssignmentCount: r.active_assignment_count, activeLearnerCount: r.active_learner_count })),
    limit,
    offset,
    totalCount: totalResult.rows[0].c,
  };
}
