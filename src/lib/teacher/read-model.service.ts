/**
 * F11-A -- Teacher Read Model. The ONLY thing Teacher-facing
 * routes/UI (once built) should call. Mirrors the architectural
 * pattern of src/lib/parent/read-model.service.ts (F10), but is
 * deliberately its own, separate file -- F10 is closed and frozen and
 * is not modified here.
 *
 * Every method re-validates authorization itself, as its first
 * action, through the TEACHER-SPECIFIC canonical primitives
 * (canTeacherAccessLearner / canAccessClass) -- NEVER the generic
 * canAccessLearner, which deliberately composes Owner/Parent/Teacher
 * as equivalent for F5-F9's "any authorized viewer" routes. That
 * composition is exactly what caused F10's Parent Read Model
 * authorization-widening bug (a Parent-scoped route was silently
 * satisfied by an unrelated Teacher relationship); this file exists
 * specifically to not repeat that mistake for the Teacher side. See
 * docs/implementation/f11/F11_A_TEACHER_AUTHORIZATION_CERTIFICATION.md.
 *
 * Sources learner data exclusively from F5/F8/F9's own existing,
 * certified read functions -- this is a projection layer, never a
 * second learning-state/mastery/readiness/competency/exam-scoring
 * authority.
 */

import { db } from '@/lib/db';
import { canTeacherAccessLearner, resolveTeacherClassScope } from '@/lib/authorization';
import { activeRoleSql } from '@/lib/identity/access-predicates';
import { learnerConceptsInTeacherSubjects } from '@/lib/authorization/teacher-subject-scope';
import type { ReadinessSnapshot } from '@/lib/readiness/types';

export class TeacherAccessDeniedError extends Error {
  constructor(resourceId: string) {
    super(`Teacher actor is not authorized to access resource ${resourceId}`);
    this.name = 'TeacherAccessDeniedError';
  }
}

async function requireLearnerAccess(actorUserId: string, studentId: string): Promise<void> {
  const allowed = await canTeacherAccessLearner(actorUserId, studentId);
  if (!allowed) throw new TeacherAccessDeniedError(studentId);
}

/**
 * L10 SF-4 (L4-06, CR-L8-01, CR-L8-02): the Teacher read models are for the
 * class's TEACHER only. This used to go through `canAccessClass`, which also
 * admits the institution's admins -- so a Coordinator could read the class
 * roster and per-student exam data through the Teacher routes. It now uses
 * `resolveTeacherClassScope` (teacher of this exact class, never an
 * institution admin). A Coordinator's learner-level reads are bounded by
 * LEARNER_READ_SCOPE.COORDINATOR and served by the institution's own routes.
 */
async function requireClassAccess(actorUserId: string, classId: string): Promise<void> {
  const scope = await resolveTeacherClassScope(actorUserId, classId);
  if (!scope) throw new TeacherAccessDeniedError(classId);
}

export interface TeacherAssignedClass {
  classId: string;
  name: string;
  gradeId: string | null;
  institutionId: string;
}

/**
 * Derives the list from the SAME relationship criteria
 * canTeacherAccessLearner itself uses (APPROVED TEACHER membership,
 * ACTIVE assignment, direct class_id OR grade-wide assignment,
 * institution match) -- projected as a list of classes instead of a
 * boolean over one learner. No reusable "list my assigned classes"
 * service export existed prior to F11-A (confirmed during
 * reconnaissance); this is new, narrow, read-only SQL, not a new
 * authorization primitive -- it implements the identical criteria.
 */
export async function getTeacherAssignedClasses(actorUserId: string): Promise<TeacherAssignedClass[]> {
  const result = await db.query(
    `
    SELECT DISTINCT c.id, c.name, c.grade_id, c.institution_id
    FROM teacher_assignments ta
    JOIN institution_memberships im ON im.id = ta.institution_membership_id
    JOIN classes c ON (c.id = ta.class_id OR (ta.class_id IS NULL AND c.grade_id = ta.grade_id))
    WHERE im.user_id = $1
      AND im.membership_role = 'TEACHER'
      AND im.status = 'APPROVED'
      AND ta.status = 'ACTIVE'
      AND c.institution_id = im.institution_id
      AND c.status = 'ACTIVE' -- an archived class leaves the teacher's working list (its history stays)
      AND EXISTS (SELECT 1 FROM institutions i WHERE i.id = im.institution_id AND i.status = 'ACTIVE') -- L10 SF-3
      AND ${activeRoleSql('$1', 'TEACHER')} -- L10 SF-1
    ORDER BY c.name
    `,
    [actorUserId]
  );
  return result.rows.map((r) => ({ classId: r.id, name: r.name, gradeId: r.grade_id, institutionId: r.institution_id }));
}

export interface TeacherRosterStudent {
  studentId: string;
  name: string;
}

/**
 * Returns ONLY students with an ACTIVE class_enrollments row for the
 * requested, authorized class -- an ENDED enrollment never appears,
 * and a student never appears via any relationship other than this
 * exact class's own enrollment rows (no Parent/Owner inference of any
 * kind is possible here; this query has no such join available to it).
 */
export async function getTeacherClassRoster(actorUserId: string, classId: string): Promise<TeacherRosterStudent[]> {
  await requireClassAccess(actorUserId, classId);

  const result = await db.query(
    `
    SELECT s.id, s.name, s.email
    FROM class_enrollments ce
    JOIN students s ON s.id = ce.student_id
    WHERE ce.class_id = $1 AND ce.status = 'ACTIVE'
    ORDER BY s.name
    `,
    [classId]
  );
  return result.rows.map((r) => ({ studentId: r.id, name: r.name || r.email }));
}

export interface TeacherStudentOverview {
  studentId: string;
  name: string;
  conceptsWithEvidence: number;
  areasNeedingAttentionCount: number;
  /** L10-R2: readiness is exam-wide and cannot be attributed to the teacher's subject -- always 'WITHHELD' for a Teacher. */
  latestReadinessStatus: ReadinessSnapshot['overallStatus'] | 'NO_ACTIVE_EXAM_PROFILE' | 'WITHHELD';
  lastActivityAt: string | null;
  /** L10-R2: the canonical subjects these numbers are limited to (the teacher's authorized subjects for this learner). */
  subjectScope: { canonicalSubjectIds: string[] };
}

/**
 * Minimum "teacher-scoped learner learning information" projection: counts
 * and a date, never raw evidence rows or internal sub-scores.
 *
 * L10-R2 (Teacher whole-learner scope). This used to count over the WHOLE
 * learner -- every subject they study -- and to return the readiness status
 * of their personal exam preparation. Teacher learner data requires an
 * authorized Student, Class AND Subject, so:
 *   - the two counts and the last-activity date are taken over the learner's
 *     concepts inside the subject(s) this teacher is authorized for with this
 *     learner (`learnerConceptsInTeacherSubjects`), and nothing else;
 *   - readiness is exam-wide, cannot be sliced, and is withheld;
 *   - a teacher with no subject scope for the learner gets zeros.
 * The count predicates are the ones the mastery and learning-debt read
 * models use (a mastery record; an active or monitored debt of an active
 * subject); only the concept filter is added.
 */
export async function getTeacherStudentOverview(actorUserId: string, studentId: string): Promise<TeacherStudentOverview> {
  await requireLearnerAccess(actorUserId, studentId);

  const [studentRow, scope] = await Promise.all([
    db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]),
    learnerConceptsInTeacherSubjects(actorUserId, studentId),
  ]);
  const name = studentRow.rows[0]?.name || studentRow.rows[0]?.email || '';
  const conceptIds = [...scope.conceptIds];
  const base = { studentId, name, latestReadinessStatus: 'WITHHELD' as const, subjectScope: { canonicalSubjectIds: scope.subjectIds } };
  if (conceptIds.length === 0) return { ...base, conceptsWithEvidence: 0, areasNeedingAttentionCount: 0, lastActivityAt: null };

  const [mastery, debts, lastActivity] = await Promise.all([
    db.query(`SELECT count(*)::int AS n FROM mastery_records WHERE student_id = $1 AND concept_id = ANY($2::uuid[])`, [studentId, conceptIds]),
    db.query(
      `SELECT count(*)::int AS n FROM learning_debt ld JOIN subjects s ON s.id = ld.subject_id
        WHERE ld.student_id = $1 AND ld.status IN ('active', 'monitoring') AND s.status = 'active' AND ld.concept_id = ANY($2::uuid[])`,
      [studentId, conceptIds]
    ),
    db.query(`SELECT MAX("timestamp") AS last_at FROM learning_evidence WHERE student_id = $1 AND concept_id = ANY($2::uuid[])`, [studentId, conceptIds]),
  ]);
  return {
    ...base,
    conceptsWithEvidence: mastery.rows[0]?.n ?? 0,
    areasNeedingAttentionCount: debts.rows[0]?.n ?? 0,
    lastActivityAt: lastActivity.rows[0]?.last_at ?? null,
  };
}
