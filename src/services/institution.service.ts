/**
 * F2 -- Institutions, Institution Membership, Grade/Class/Enrollment,
 * Teacher Assignment. Greenfield domain (F0/F0-R/F0-S/F1 confirmed
 * zero prior institution-related tables or code).
 *
 * Institution Admin is never self-service (INV-F2-12 / carries
 * forward F1's structural restriction): `inviteInstitutionAdmin` is
 * gated by `isAdminEmail` (the same StudyUS-admin allowlist already
 * used by `src/services/admin.service.ts`) at the route boundary, not
 * inside this file -- this file only performs the write once a caller
 * has already been confirmed authorized. No StudyUS Admin Console is
 * built; this is the minimum controlled mechanism the task allows.
 */
import { db } from '@/lib/db';

export type InstitutionStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type MembershipRole = 'TEACHER' | 'INSTITUTION_ADMIN';
export type MembershipStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface Institution {
  id: string;
  name: string;
  status: InstitutionStatus;
}

export interface InstitutionMembership {
  id: string;
  institutionId: string;
  userId: string;
  membershipRole: MembershipRole;
  status: MembershipStatus;
}

export async function createInstitution(name: string): Promise<Institution> {
  const result = await db.query(
    `INSERT INTO institutions (name, status) VALUES ($1, 'ACTIVE') RETURNING id, name, status`,
    [name]
  );
  return toInstitution(result.rows[0]);
}

/**
 * The one controlled path to create an INSTITUTION_ADMIN membership.
 * Writes both the F1 `user_roles` grant (`granted_via='INVITATION'` --
 * the value F1 reserved and never wrote) and the F2
 * `institution_memberships` row, already APPROVED (an invitation is,
 * by construction, already a decision -- there is no pending state for
 * an invited admin to sit in). Idempotent: inviting the same user to
 * the same institution twice does not duplicate anything.
 */
export async function inviteInstitutionAdmin(institutionId: string, userId: string): Promise<InstitutionMembership> {
  await db.query(
    `INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'INSTITUTION_ADMIN', 'ACTIVE', 'INVITATION')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [userId]
  );
  const result = await db.query(
    `
    INSERT INTO institution_memberships (institution_id, user_id, membership_role, status, reviewed_at)
    VALUES ($1, $2, 'INSTITUTION_ADMIN', 'APPROVED', NOW())
    ON CONFLICT (institution_id, user_id, membership_role) DO UPDATE SET status = 'APPROVED', reviewed_at = NOW()
    RETURNING id, institution_id, user_id, membership_role, status
    `,
    [institutionId, userId]
  );
  return toMembership(result.rows[0]);
}

/** Teacher self-service request -- starts PENDING, grants nothing by itself (INV-F2-04/AC-F2-07). */
export async function requestTeacherMembership(institutionId: string, userId: string): Promise<InstitutionMembership> {
  const result = await db.query(
    `
    INSERT INTO institution_memberships (institution_id, user_id, membership_role, status)
    VALUES ($1, $2, 'TEACHER', 'PENDING')
    ON CONFLICT (institution_id, user_id, membership_role) DO UPDATE SET status = institution_memberships.status
    RETURNING id, institution_id, user_id, membership_role, status
    `,
    [institutionId, userId]
  );
  return toMembership(result.rows[0]);
}

export async function getMembershipStatus(institutionId: string, userId: string, role: MembershipRole): Promise<InstitutionMembership | null> {
  const result = await db.query(
    `SELECT id, institution_id, user_id, membership_role, status FROM institution_memberships WHERE institution_id = $1 AND user_id = $2 AND membership_role = $3`,
    [institutionId, userId, role]
  );
  return result.rows.length > 0 ? toMembership(result.rows[0]) : null;
}

/**
 * F13 -- the read F13's Institution workspace UI needs and F12 never
 * provided (F12 is scoped to "read data WITHIN an already-known,
 * already-authorized institutionId" -- it has no "which institutions
 * am I an admin of" roster lookup of its own). A pure roster read,
 * scoped to the caller's OWN user id -- never returns another actor's
 * memberships, never grants access to anything itself (the institution
 * intelligence read model still independently re-authorizes every
 * call, per F12's own design).
 */
export async function getAdministeredInstitutions(userId: string): Promise<Institution[]> {
  const result = await db.query(
    `
    SELECT i.id, i.name, i.status
    FROM institutions i
    JOIN institution_memberships im ON im.institution_id = i.id
    WHERE im.user_id = $1 AND im.membership_role = 'INSTITUTION_ADMIN' AND im.status = 'APPROVED'
    ORDER BY i.name
    `,
    [userId]
  );
  return result.rows.map((r: any) => ({ id: r.id, name: r.name, status: r.status }));
}

export async function listPendingMemberships(institutionId: string): Promise<InstitutionMembership[]> {
  const result = await db.query(
    `SELECT id, institution_id, user_id, membership_role, status FROM institution_memberships WHERE institution_id = $1 AND status = 'PENDING' ORDER BY requested_at ASC`,
    [institutionId]
  );
  return result.rows.map(toMembership);
}

/**
 * Approve/reject a PENDING membership. `reviewerUserId` is recorded
 * for audit (`reviewed_by_user_id`). Only transitions rows that are
 * actually PENDING -- approving/rejecting an already-decided or
 * revoked membership is a no-op (returns false), never silently
 * re-decides history.
 */
export async function decideMembership(
  membershipId: string,
  reviewerUserId: string,
  decision: 'APPROVED' | 'REJECTED'
): Promise<boolean> {
  const result = await db.query(
    `UPDATE institution_memberships SET status = $1, reviewed_at = NOW(), reviewed_by_user_id = $2 WHERE id = $3 AND status = 'PENDING' RETURNING id`,
    [decision, reviewerUserId, membershipId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Soft-revoke an APPROVED membership -- never a DELETE (INV-F2-07/08). Any ACTIVE assignments under it are ended in the same transaction so access is removed immediately, without deleting the assignment's own historical row. */
export async function revokeMembership(membershipId: string, reviewerUserId: string): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const membership = await client.query(
      `UPDATE institution_memberships SET status = 'REVOKED', reviewed_at = NOW(), reviewed_by_user_id = $1 WHERE id = $2 AND status = 'APPROVED' RETURNING id`,
      [reviewerUserId, membershipId]
    );
    if ((membership.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `UPDATE teacher_assignments SET status = 'ENDED', ended_at = NOW() WHERE institution_membership_id = $1 AND status = 'ACTIVE'`,
      [membershipId]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createGrade(institutionId: string, name: string): Promise<{ id: string; name: string }> {
  const result = await db.query(`INSERT INTO grades (institution_id, name) VALUES ($1, $2) RETURNING id, name`, [institutionId, name]);
  return result.rows[0];
}

export async function createClass(institutionId: string, gradeId: string | null, name: string): Promise<{ id: string; name: string }> {
  const result = await db.query(
    `INSERT INTO classes (institution_id, grade_id, name) VALUES ($1, $2, $3) RETURNING id, name`,
    [institutionId, gradeId, name]
  );
  return result.rows[0];
}

export async function enrollStudent(classId: string, studentId: string): Promise<void> {
  await db.query(
    `INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'ACTIVE')
     ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'ACTIVE'`,
    [classId, studentId]
  );
}

export interface TeacherAssignment {
  id: string;
  institutionMembershipId: string;
  gradeId: string | null;
  classId: string | null;
  subjectLabel: string | null;
  status: 'ACTIVE' | 'ENDED';
}

/** Requires an already-APPROVED TEACHER membership -- fails closed (throws) otherwise, never silently creates an assignment nobody can legitimately hold. */
export async function createTeacherAssignment(
  institutionMembershipId: string,
  scope: { gradeId?: string | null; classId?: string | null; subjectLabel?: string | null }
): Promise<TeacherAssignment> {
  const membership = await db.query(
    `SELECT 1 FROM institution_memberships WHERE id = $1 AND membership_role = 'TEACHER' AND status = 'APPROVED'`,
    [institutionMembershipId]
  );
  if (membership.rows.length === 0) {
    throw new Error('MEMBERSHIP_NOT_APPROVED');
  }
  const result = await db.query(
    `
    INSERT INTO teacher_assignments (institution_membership_id, grade_id, class_id, subject_label, status)
    VALUES ($1, $2, $3, $4, 'ACTIVE')
    RETURNING id, institution_membership_id, grade_id, class_id, subject_label, status
    `,
    [institutionMembershipId, scope.gradeId ?? null, scope.classId ?? null, scope.subjectLabel ?? null]
  );
  return toAssignment(result.rows[0]);
}

/** Soft-end an assignment -- never a DELETE. */
export async function endTeacherAssignment(assignmentId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE teacher_assignments SET status = 'ENDED', ended_at = NOW() WHERE id = $1 AND status = 'ACTIVE' RETURNING id`,
    [assignmentId]
  );
  return (result.rowCount ?? 0) > 0;
}

function toInstitution(row: any): Institution {
  return { id: row.id, name: row.name, status: row.status };
}

function toMembership(row: any): InstitutionMembership {
  return { id: row.id, institutionId: row.institution_id, userId: row.user_id, membershipRole: row.membership_role, status: row.status };
}

function toAssignment(row: any): TeacherAssignment {
  return {
    id: row.id,
    institutionMembershipId: row.institution_membership_id,
    gradeId: row.grade_id,
    classId: row.class_id,
    subjectLabel: row.subject_label,
    status: row.status,
  };
}
