import { db } from '@/lib/db';
import { getCanonicalUserByClerkId, getUserRoles } from '@/lib/identity/canonical-user.service';
import { STUDENT_OWNER_MATCH_SQL, activeRoleSql } from '@/lib/identity/access-predicates';
import { LEARNER_READ_SCOPE, INSTITUTION_ADMIN_PERMISSIONS, TEACHER_CLASS_PERMISSIONS } from './permissions';
import type { LearnerPermission, LearnerRelationship, InstitutionPermission, TeacherInterventionPermission } from './permissions';

export type { LearnerPermission, LearnerRelationship, InstitutionPermission, TeacherInterventionPermission } from './permissions';
export { LEARNER_READ_SCOPE } from './permissions';
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
 *
 * L10 SF-1 (L4-04, L4-12): every guard below also requires the actor's
 * account to be ACTIVE and the role for that surface to be ACTIVE
 * (`activeRoleSql`), read in the same query. A relationship, ownership or
 * membership row that outlives a revoked role or a suspended account no
 * longer authorizes anything.
 *
 * L10 SF-3 (L4-08): teacher access additionally requires the institution to
 * be ACTIVE and the class not to be archived, as coordinator access already
 * did.
 *
 * L10 SF-4 (L4-06, L4-14): the read scope of each relationship is the one
 * table in ./permissions (LEARNER_READ_SCOPE); the institution permission
 * argument is honoured.
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
        AND ${activeRoleSql('$1', 'PARENT')}
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
    const result = await db.query(
      `SELECT 1 FROM students s
       JOIN users u ON ${STUDENT_OWNER_MATCH_SQL}
       WHERE s.id = $1 AND u.id = $2 AND ${activeRoleSql('u.id', 'STUDENT')}
       LIMIT 1`,
      [learnerId, actorUserId]
    );
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
      JOIN institutions i ON i.id = im.institution_id AND i.status = 'ACTIVE'
      JOIN class_enrollments ce ON ce.student_id = $2 AND ce.status = 'ACTIVE'
      JOIN classes c ON c.id = ce.class_id AND c.status = 'ACTIVE'
      WHERE im.user_id = $1
        AND im.membership_role = 'TEACHER'
        AND im.status = 'APPROVED'
        AND ta.status = 'ACTIVE'
        AND (ta.class_id = c.id OR (ta.class_id IS NULL AND ta.grade_id = c.grade_id))
        AND c.institution_id = im.institution_id
        AND ${activeRoleSql('$1', 'TEACHER')}
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
 * COORDINATOR relationship ONLY (L10 SF-4, D-1): the actor is an APPROVED
 * INSTITUTION_ADMIN of an ACTIVE institution in which this learner holds an
 * ACTIVE enrolment. Never inferred from knowing a learner id, and never
 * across institutions.
 */
export async function isCoordinatorOfLearner(actorUserId: string, learnerId: string): Promise<boolean> {
  try {
    const result = await db.query(
      `
      SELECT 1
      FROM institution_memberships im
      JOIN institutions i ON i.id = im.institution_id AND i.status = 'ACTIVE'
      JOIN classes c ON c.institution_id = im.institution_id
      JOIN class_enrollments ce ON ce.class_id = c.id AND ce.student_id = $2 AND ce.status = 'ACTIVE'
      WHERE im.user_id = $1
        AND im.membership_role = 'INSTITUTION_ADMIN'
        AND im.status = 'APPROVED'
        AND ${activeRoleSql('$1', 'INSTITUTION_ADMIN')}
      LIMIT 1
      `,
      [actorUserId, learnerId]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

const RELATIONSHIP_CHECKS: ReadonlyArray<[LearnerRelationship, (actorUserId: string, learnerId: string) => Promise<boolean>]> = [
  ['OWNER', isOwner],
  ['PARENT', isActiveParentOf],
  ['TEACHER', canTeacherAccessLearner],
  ['COORDINATOR', isCoordinatorOfLearner],
];

/**
 * True when ANY relationship the actor holds to this learner grants
 * `permission` under LEARNER_READ_SCOPE (./permissions -- the one table).
 * Only relationships that could grant the permission are queried.
 */
export async function canAccessLearner(actorUserId: string, learnerId: string, permission: LearnerPermission): Promise<boolean> {
  for (const [relationship, check] of RELATIONSHIP_CHECKS) {
    if (!LEARNER_READ_SCOPE[relationship].includes(permission)) continue;
    if (await check(actorUserId, learnerId)) return true;
  }
  return false;
}

export interface LearnerReadScope {
  relationships: LearnerRelationship[];
  permissions: LearnerPermission[];
}

/**
 * L10 SF-4 -- everything this actor may read of this learner, as the union
 * over the relationships they actually hold. For a route that returns one
 * payload to several kinds of viewer and must shape it (for example: a
 * result summary for everyone entitled to it, the item-level review only
 * with LEARNER_ASSESSMENT_DETAIL_VIEW). Fails closed to an empty scope.
 */
export async function resolveLearnerReadScope(actorUserId: string, learnerId: string): Promise<LearnerReadScope> {
  const held = await Promise.all(RELATIONSHIP_CHECKS.map(async ([relationship, check]) => ((await check(actorUserId, learnerId)) ? relationship : null)));
  const relationships = held.filter((r): r is LearnerRelationship => r !== null);
  const permissions = new Set<LearnerPermission>();
  for (const relationship of relationships) for (const p of LEARNER_READ_SCOPE[relationship]) permissions.add(p);
  return { relationships, permissions: [...permissions] };
}

/**
 * INSTITUTION_ADMIN, APPROVED, for THIS exact institution -- never any
 * other -- with an ACTIVE institution, an ACTIVE account and an ACTIVE
 * INSTITUTION_ADMIN role (L10 SF-1). The permission must be one an
 * institution admin holds (L10 SF-4): the argument is no longer ignored.
 * Learner-level reads are not granted here; they go through
 * `canAccessLearner` / `isCoordinatorOfLearner` and LEARNER_READ_SCOPE.
 */
export async function canAccessInstitution(actorUserId: string, institutionId: string, permission: InstitutionPermission): Promise<boolean> {
  if (!INSTITUTION_ADMIN_PERMISSIONS.includes(permission)) return false;
  try {
    const result = await db.query(
      `
      SELECT 1 FROM institution_memberships im JOIN institutions i ON i.id = im.institution_id
      WHERE im.user_id = $1 AND im.institution_id = $2 AND im.membership_role = 'INSTITUTION_ADMIN' AND im.status = 'APPROVED'
        AND i.status = 'ACTIVE'
        AND ${activeRoleSql('$1', 'INSTITUTION_ADMIN')}
      LIMIT 1
      `,
      [actorUserId, institutionId]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Institution admins of the class's own institution, or a teacher with an
 * ACTIVE assignment covering this exact class.
 *
 * L10 SF-4: the permission decides which of the two may pass. The teacher
 * branch only satisfies TEACHER_CLASS_PERMISSIONS. The Teacher READ MODELS do
 * not use this function (it admits institution admins): they use
 * `resolveTeacherClassScope`.
 * L10 SF-3: the teacher branch requires an ACTIVE institution and a class
 * that is not archived (the coordinator branch keeps an archived class
 * reachable, so it can still be administered).
 */
export async function canAccessClass(actorUserId: string, classId: string, permission: InstitutionPermission): Promise<boolean> {
  try {
    const classRow = await db.query(`SELECT institution_id, grade_id, status FROM classes WHERE id = $1`, [classId]);
    if (classRow.rows.length === 0) return false;
    const { institution_id: institutionId, status: classStatus } = classRow.rows[0];

    if (await canAccessInstitution(actorUserId, institutionId, permission)) return true;

    if (!TEACHER_CLASS_PERMISSIONS.includes(permission)) return false;
    if (classStatus !== 'ACTIVE') return false;

    const teacherRow = await db.query(
      `
      SELECT 1
      FROM teacher_assignments ta
      JOIN institution_memberships im ON im.id = ta.institution_membership_id
      JOIN institutions i ON i.id = im.institution_id AND i.status = 'ACTIVE'
      WHERE im.user_id = $1
        AND im.membership_role = 'TEACHER'
        AND im.status = 'APPROVED'
        AND ta.status = 'ACTIVE'
        AND (ta.class_id = $2 OR (ta.class_id IS NULL AND ta.grade_id = (SELECT grade_id FROM classes WHERE id = $2)))
        AND im.institution_id = $3
        AND ${activeRoleSql('$1', 'TEACHER')}
      LIMIT 1
      `,
      [actorUserId, classId, institutionId]
    );
    return teacherRow.rows.length > 0;
  } catch {
    return false;
  }
}

export interface TeacherClassScope {
  classId: string;
  institutionId: string;
  /** The class's canonical subject: the academic scope of what its teacher may read. Null until the class is linked to one. */
  canonicalSubjectId: string | null;
}

/**
 * TEACHER of this exact class ONLY (L10 SF-4, CR-L8-01 / CR-L8-02): an
 * APPROVED TEACHER membership with an ACTIVE assignment covering the class,
 * in an ACTIVE institution, on a class that is not archived, with an ACTIVE
 * account and TEACHER role. Unlike `canAccessClass` this never admits an
 * institution admin: the Teacher read models (roster, exam gaps, per-learner
 * results) are not a second way in for a Coordinator, whose learner-level
 * reads are bounded by LEARNER_READ_SCOPE.COORDINATOR on their own routes.
 *
 * Returns the scope the teacher holds there -- the class and its subject --
 * or null. Fails closed.
 */
export async function resolveTeacherClassScope(actorUserId: string, classId: string): Promise<TeacherClassScope | null> {
  try {
    const result = await db.query(
      `
      SELECT c.id AS class_id, c.institution_id, c.canonical_subject_id
      FROM classes c
      JOIN institutions i ON i.id = c.institution_id AND i.status = 'ACTIVE'
      JOIN institution_memberships im ON im.institution_id = c.institution_id
      JOIN teacher_assignments ta ON ta.institution_membership_id = im.id
      WHERE c.id = $2
        AND c.status = 'ACTIVE'
        AND im.user_id = $1
        AND im.membership_role = 'TEACHER'
        AND im.status = 'APPROVED'
        AND ta.status = 'ACTIVE'
        AND (ta.class_id = c.id OR (ta.class_id IS NULL AND ta.grade_id IS NOT NULL AND ta.grade_id = c.grade_id))
        AND ${activeRoleSql('$1', 'TEACHER')}
      LIMIT 1
      `,
      [actorUserId, classId]
    );
    const row = result.rows[0];
    return row ? { classId: row.class_id, institutionId: row.institution_id, canonicalSubjectId: row.canonical_subject_id ?? null } : null;
  } catch {
    return null;
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
