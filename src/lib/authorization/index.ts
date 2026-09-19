import { db } from '@/lib/db';
import { getCanonicalUserByClerkId, getUserRoles } from '@/lib/identity/canonical-user.service';
import type { LearnerPermission, InstitutionPermission, TeacherInterventionPermission } from './permissions';

export type { LearnerPermission, InstitutionPermission, TeacherInterventionPermission } from './permissions';
export { getCanonicalUserByClerkId };

/**
 * F2 -- THE canonical authorization boundary for relationship/scope-
 * based access (Institutions, Parent/Guardian/Coach, Teacher). Student
 * OWNERSHIP of their own resources continues to be decided by
 * verifyStudentAccess/verifySubjectAccess/verifyContentSourceAccess in
 * src/lib/auth.ts -- untouched, and still the simplest/strongest path
 * (see F2_AUTHORIZATION_ARCHITECTURE.md §4). This module is for the
 * NEW relationship-based access F2 introduces.
 *
 * Every function here fails closed: a missing row, a wrong status, or
 * any DB error resolves to `false`, never `true` and never a thrown
 * exception a caller could misinterpret.
 *
 * `actorUserId` is always the F1 canonical `users.id` -- callers must
 * resolve it from the authenticated Clerk session
 * (`getOrCreateCanonicalUser`) before calling in; nothing here ever
 * trusts a client-supplied actor id.
 */

/**
 * PARENT relationship ONLY: an ACTIVE ('accepted') row in
 * parent_student_relationships for this exact actor+learner pair.
 * Exported (F10 multi-role certification fix) for callers that must
 * prove Parent semantics specifically and must NOT accept a Teacher
 * (or any other) relationship as an equivalent substitute -- unlike
 * `canAccessLearner`, which deliberately composes Owner/Parent/Teacher
 * as equivalent for a given LearnerPermission, because most callers
 * (F5-F9's routes) legitimately want "any authorized viewer". The
 * Parent Read Model (`src/lib/parent/read-model.service.ts`) is not
 * such a caller: a route that presents itself as Parent-scoped must
 * not silently grant access through a Teacher relationship just
 * because the same actor happens to also hold one.
 */
export async function isActiveParentOf(actorUserId: string, learnerId: string): Promise<boolean> {
  try {
    const result = await db.query(
      `
      SELECT 1 FROM parent_student_relationships psr
      JOIN profiles p ON p.id = psr.parent_id
      WHERE p.user_id = $1 AND psr.student_id = $2 AND psr.status = 'accepted'
      LIMIT 1
      `,
      [actorUserId, learnerId]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * OWNER relationship ONLY: the actor IS this learner (students.user_id
 * match). Exported (F11-C1) for the same reason isActiveParentOf was
 * exported in F10: a caller that must prove Student/Owner execution
 * authority specifically -- and must NOT accept a Teacher or Parent
 * relationship as an equivalent substitute -- needs this narrow check,
 * not the generic canAccessLearner composition. A Teacher-assigned
 * intervention does not authorize the Teacher to execute it; only the
 * real learner can.
 */
export async function isOwner(actorUserId: string, learnerId: string): Promise<boolean> {
  try {
    const result = await db.query(`SELECT 1 FROM students WHERE id = $1 AND user_id = $2 LIMIT 1`, [learnerId, actorUserId]);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * TEACHER: requires ALL THREE -- an APPROVED TEACHER membership in some
 * institution, an ACTIVE teacher_assignment under that membership, and
 * an ACTIVE class_enrollment linking the learner to a class the
 * assignment actually covers (or, for a grade-wide assignment with no
 * specific class, any class in that grade the learner is enrolled in).
 * A membership alone, or an assignment alone, is never sufficient
 * (INV-F2-04).
 */
export async function canTeacherAccessLearner(actorUserId: string, learnerId: string): Promise<boolean> {
  try {
    const result = await db.query(
      `
      SELECT 1
      FROM teacher_assignments ta
      JOIN institution_memberships im ON im.id = ta.institution_membership_id
      JOIN class_enrollments ce ON ce.student_id = $2 AND ce.status = 'ACTIVE'
      JOIN classes c ON c.id = ce.class_id
      WHERE im.user_id = $1
        AND im.membership_role = 'TEACHER'
        AND im.status = 'APPROVED'
        AND ta.status = 'ACTIVE'
        AND (ta.class_id = c.id OR (ta.class_id IS NULL AND ta.grade_id = c.grade_id))
        AND c.institution_id = im.institution_id
      LIMIT 1
      `,
      [actorUserId, learnerId]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Which LearnerPermissions each relationship type currently satisfies.
 * LEARNER_INTERVENTION_CREATE is deliberately satisfiable by nobody in
 * F2 -- no code path creates an intervention yet (F11 territory); it
 * exists in the vocabulary now so F11 extends this table instead of
 * inventing a second permission system.
 */
const PARENT_PERMISSIONS: readonly LearnerPermission[] = ['LEARNER_PROGRESS_VIEW', 'LEARNER_PROFILE_VIEW'];
const TEACHER_PERMISSIONS: readonly LearnerPermission[] = ['LEARNER_PROGRESS_VIEW', 'LEARNER_PROFILE_VIEW'];
const OWNER_PERMISSIONS: readonly LearnerPermission[] = ['LEARNER_PROGRESS_VIEW', 'LEARNER_PROFILE_VIEW', 'LEARNER_INTERVENTION_CREATE'];

export async function canAccessLearner(actorUserId: string, learnerId: string, permission: LearnerPermission): Promise<boolean> {
  if (OWNER_PERMISSIONS.includes(permission) && (await isOwner(actorUserId, learnerId))) return true;
  if (PARENT_PERMISSIONS.includes(permission) && (await isActiveParentOf(actorUserId, learnerId))) return true;
  if (TEACHER_PERMISSIONS.includes(permission) && (await canTeacherAccessLearner(actorUserId, learnerId))) return true;
  return false;
}

/** INSTITUTION_ADMIN, APPROVED, for THIS exact institution -- never any other. Never grants learner access (see F2_AUTHORIZATION_ARCHITECTURE.md §3). */
export async function canAccessInstitution(actorUserId: string, institutionId: string, _permission: InstitutionPermission): Promise<boolean> {
  try {
    const result = await db.query(
      `
      SELECT 1 FROM institution_memberships
      WHERE user_id = $1 AND institution_id = $2 AND membership_role = 'INSTITUTION_ADMIN' AND status = 'APPROVED'
      LIMIT 1
      `,
      [actorUserId, institutionId]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/** Institution admins of the class's own institution, or a teacher with an ACTIVE assignment covering this exact class. */
export async function canAccessClass(actorUserId: string, classId: string, permission: InstitutionPermission): Promise<boolean> {
  try {
    const classRow = await db.query(`SELECT institution_id, grade_id FROM classes WHERE id = $1`, [classId]);
    if (classRow.rows.length === 0) return false;
    const { institution_id: institutionId } = classRow.rows[0];

    if (await canAccessInstitution(actorUserId, institutionId, permission)) return true;

    const teacherRow = await db.query(
      `
      SELECT 1
      FROM teacher_assignments ta
      JOIN institution_memberships im ON im.id = ta.institution_membership_id
      WHERE im.user_id = $1
        AND im.membership_role = 'TEACHER'
        AND im.status = 'APPROVED'
        AND ta.status = 'ACTIVE'
        AND (ta.class_id = $2 OR (ta.class_id IS NULL AND ta.grade_id = (SELECT grade_id FROM classes WHERE id = $2)))
        AND im.institution_id = $3
      LIMIT 1
      `,
      [actorUserId, classId, institutionId]
    );
    return teacherRow.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * F11-B -- the ONLY gate for the Teacher Intervention domain. All 3
 * TeacherInterventionPermission values resolve to the SAME real check
 * (the permission argument exists for call-site clarity and future
 * differentiation, not because the three currently diverge) --
 * deliberately never composed with isOwner/isActiveParentOf. A Parent
 * or Owner relationship must never satisfy this, no matter which
 * permission is requested.
 */
export async function canTeacherManageIntervention(
  actorUserId: string,
  learnerId: string,
  _permission: TeacherInterventionPermission
): Promise<boolean> {
  return canTeacherAccessLearner(actorUserId, learnerId);
}

/**
 * Preserves the exact pre-F2 signature/contract of the stub this
 * replaces in src/lib/auth.ts (`teacherId` there is the Clerk user id,
 * matching how verifyStudentAccess's 'teacher' branch already calls
 * it) -- only its body changes, from an unconditional `return false`
 * to a real, fail-closed query.
 */
export async function canTeacherAccessStudentByClerkId(teacherClerkId: string, studentId: string): Promise<boolean> {
  try {
    const actor = await getCanonicalUserByClerkId(teacherClerkId);
    if (!actor) return false;
    return await canTeacherAccessLearner(actor.id, studentId);
  } catch {
    return false;
  }
}

export { getUserRoles };
