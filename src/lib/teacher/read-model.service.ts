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
import { canTeacherAccessLearner, canAccessClass } from '@/lib/authorization';
import { getStudentMastery } from '@/services/mastery.service';
import { getActiveDebts } from '@/services/learning-debt.service';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
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
 * canAccessClass's `permission` argument is currently not
 * differentiated internally (confirmed by inspection -- every
 * InstitutionPermission value resolves identically today), so any
 * valid enum member gates the exact same real relationship check
 * (institution admin OR an ACTIVE teacher assignment covering this
 * class). TEACHER_ASSIGNMENT_MANAGE is used here as the closest
 * semantic fit; changing this pre-existing behavior is out of scope
 * for F11-A.
 */
async function requireClassAccess(actorUserId: string, classId: string): Promise<void> {
  const allowed = await canAccessClass(actorUserId, classId, 'TEACHER_ASSIGNMENT_MANAGE');
  if (!allowed) throw new TeacherAccessDeniedError(classId);
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

interface ActiveExamProfile {
  id: string;
}

/**
 * No reusable "active exam profile for a student" service export
 * exists anywhere in the codebase (F7's own route and F10's Parent
 * Read Model each independently query student_exam_profiles directly
 * for this same reason -- see F10_NEXT_PHASE_HANDOFF.md item 4). This
 * is now the THIRD call site duplicating this narrow lookup; F10 is
 * frozen and not modified here, so this is recorded as an open
 * decision (promote a shared getActiveExamProfile(studentId) export
 * in a future phase) rather than silently accepted or unilaterally
 * fixed by touching frozen F10 code.
 */
async function getActiveExamProfileId(studentId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT id FROM student_exam_profiles WHERE student_id = $1 AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
    [studentId]
  );
  return result.rows[0]?.id ?? null;
}

export interface TeacherStudentOverview {
  studentId: string;
  name: string;
  conceptsWithEvidence: number;
  areasNeedingAttentionCount: number;
  latestReadinessStatus: ReadinessSnapshot['overallStatus'] | 'NO_ACTIVE_EXAM_PROFILE';
  lastActivityAt: string | null;
}

/**
 * Minimum "teacher-scoped learner learning information" projection
 * (task's own phrasing) -- a straight reuse of F5's mastery/debt reads
 * and F9's readiness engine, never a new calculation. Field selection
 * deliberately mirrors what F10's Parent overview already proved safe
 * to expose (counts and status enums, never raw evidence rows or
 * internal sub-scores) -- Teacher-appropriate minimization is at least
 * as strict as Parent's, not looser.
 */
export async function getTeacherStudentOverview(actorUserId: string, studentId: string): Promise<TeacherStudentOverview> {
  await requireLearnerAccess(actorUserId, studentId);

  const [studentRow, masteryRecords, debts, examProfileId, lastActivityResult] = await Promise.all([
    db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]),
    getStudentMastery(studentId, undefined, 'en').catch(() => []),
    getActiveDebts(studentId, undefined, 'en').catch(() => []),
    getActiveExamProfileId(studentId),
    db.query(`SELECT MAX("timestamp") AS last_at FROM learning_evidence WHERE student_id = $1`, [studentId]),
  ]);

  let latestReadinessStatus: TeacherStudentOverview['latestReadinessStatus'] = 'NO_ACTIVE_EXAM_PROFILE';
  if (examProfileId) {
    const snapshot = await getLatestReadinessSnapshot(examProfileId).catch(() => null);
    if (snapshot) latestReadinessStatus = snapshot.overallStatus;
  }

  const name = studentRow.rows[0]?.name || studentRow.rows[0]?.email || '';

  return {
    studentId,
    name,
    conceptsWithEvidence: masteryRecords.length,
    areasNeedingAttentionCount: debts.length,
    latestReadinessStatus,
    lastActivityAt: lastActivityResult.rows[0]?.last_at ?? null,
  };
}
