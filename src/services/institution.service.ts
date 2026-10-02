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
import { resolveDisplayIdentities } from '@/lib/identity/display-identity';

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
  requestedAt?: string;
  reviewedAt?: string | null;
  reviewedByUserId?: string | null;
}

/**
 * Onboarding/authorization rework (2026-09-21) -- the minimal public
 * list a Teacher's own self-service membership request needs
 * ("elige o identifica una institución válida"). Only `id`/`name` of
 * ACTIVE institutions -- no membership, roster, or other sensitive
 * data. Never institution-scoped by the caller's own identity (unlike
 * `getAdministeredInstitutions`) -- this IS the browse-to-select list.
 */
export async function listActiveInstitutions(): Promise<Institution[]> {
  const result = await db.query(`SELECT id, name, status FROM institutions WHERE status = 'ACTIVE' ORDER BY name ASC`);
  return result.rows.map(toInstitution);
}

export function slugifyInstitutionName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Every institution carries a unique slug (Track A invariant); a taken slug gets a numeric suffix. */
async function uniqueInstitutionSlug(name: string): Promise<string> {
  const base = slugifyInstitutionName(name) || 'institution';
  const taken = new Set((await db.query(`SELECT slug FROM institutions WHERE slug = $1 OR slug LIKE $1 || '-%'`, [base])).rows.map((r: any) => r.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export async function createInstitution(name: string): Promise<Institution> {
  const result = await db.query(
    `INSERT INTO institutions (name, status, slug) VALUES ($1, 'ACTIVE', $2) RETURNING id, name, status`,
    [name, await uniqueInstitutionSlug(name)]
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

export class InstitutionNotAvailableError extends Error {
  constructor() {
    super('INSTITUTION_NOT_AVAILABLE');
    this.name = 'InstitutionNotAvailableError';
  }
}

/**
 * Teacher self-service request -- starts PENDING, grants nothing by itself
 * (INV-F2-04/AC-F2-07).
 *
 * Track A:
 *  - the institution must exist and be ACTIVE (InstitutionNotAvailableError,
 *    never a raw FK 500, never a request into a SUSPENDED institution);
 *  - a REJECTED or REVOKED teacher may ask again: the row goes back to
 *    PENDING and the institution decides again (a request never grants
 *    access by itself, so this is not a re-entry). APPROVED and PENDING rows
 *    are left untouched.
 * `newlyPending` tells the caller whether to signal the institution admins.
 */
export async function requestTeacherMembership(institutionId: string, userId: string): Promise<InstitutionMembership & { newlyPending: boolean }> {
  const result = await db.query(
    `
    INSERT INTO institution_memberships (institution_id, user_id, membership_role, status)
    SELECT i.id, $2, 'TEACHER', 'PENDING' FROM institutions i WHERE i.id = $1 AND i.status = 'ACTIVE'
    ON CONFLICT (institution_id, user_id, membership_role) DO UPDATE
      SET status = 'PENDING', requested_at = NOW(), reviewed_at = NULL, reviewed_by_user_id = NULL, updated_at = NOW()
      WHERE institution_memberships.status IN ('REJECTED', 'REVOKED')
    RETURNING id, institution_id, user_id, membership_role, status
    `,
    [institutionId, userId]
  );
  if (result.rows.length > 0) return { ...toMembership(result.rows[0]), newlyPending: true };
  const institution = await db.query(`SELECT 1 FROM institutions WHERE id = $1 AND status = 'ACTIVE'`, [institutionId]);
  if (institution.rows.length === 0) throw new InstitutionNotAvailableError();
  const existing = await getMembershipStatus(institutionId, userId, 'TEACHER');
  return { ...(existing as InstitutionMembership), newlyPending: false };
}

/**
 * Onboarding/authorization rework (2026-09-21) -- a Teacher's own
 * memberships across EVERY institution they've ever requested at (not
 * scoped to one institutionId), so the self-service UI can show
 * PENDING/APPROVED/REJECTED/REVOKED status without the caller needing
 * to remember which institution they picked. Includes the institution
 * name (safe, non-sensitive) so the UI never needs a second lookup.
 */
export async function getMyTeacherMemberships(userId: string): Promise<Array<InstitutionMembership & { institutionName: string }>> {
  const result = await db.query(
    `
    SELECT im.id, im.institution_id, im.user_id, im.membership_role, im.status, i.name AS institution_name
    FROM institution_memberships im
    JOIN institutions i ON i.id = im.institution_id
    WHERE im.user_id = $1 AND im.membership_role = 'TEACHER'
    ORDER BY im.id
    `,
    [userId]
  );
  return result.rows.map((r: any) => ({ ...toMembership(r), institutionName: r.institution_name }));
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
    WHERE im.user_id = $1 AND im.membership_role = 'INSTITUTION_ADMIN' AND im.status = 'APPROVED' AND i.status = 'ACTIVE'
    ORDER BY i.name
    `,
    [userId]
  );
  return result.rows.map((r: any) => ({ id: r.id, name: r.name, status: r.status }));
}

export async function listPendingMemberships(institutionId: string): Promise<InstitutionMembership[]> {
  const result = await db.query(
    `SELECT id, institution_id, user_id, membership_role, status, requested_at, reviewed_at, reviewed_by_user_id
     FROM institution_memberships WHERE institution_id = $1 AND status = 'PENDING' ORDER BY requested_at ASC`,
    [institutionId]
  );
  return result.rows.map(toMembership);
}

/**
 * Professional Admin Console -- the global "Solicitudes pendientes" inbox needs every institution's pending requests at once, unlike the per-institution coordinator view above. STUDYUS_ADMIN only (never exposed to a coordinator, who only ever sees their own institution via the function above).
 *
 * Track A: each request carries the REQUESTER's identity (name + email),
 * resolved server-side from the membership's own user_id -- an admin must
 * never have to identify a person from an internal id.
 */
export async function listAllPendingMembershipsAcrossInstitutions(): Promise<Array<InstitutionMembership & { institutionName: string; requesterName: string | null; requesterEmail: string | null }>> {
  const result = await db.query(
    `SELECT im.id, im.institution_id, im.user_id, im.membership_role, im.status, im.requested_at, im.reviewed_at, im.reviewed_by_user_id, i.name AS institution_name
     FROM institution_memberships im JOIN institutions i ON i.id = im.institution_id
     WHERE im.status = 'PENDING' ORDER BY im.requested_at ASC`
  );
  const identities = await resolveDisplayIdentities(result.rows.map((r: any) => r.user_id));
  return result.rows.map((r: any) => ({
    ...toMembership(r),
    institutionName: r.institution_name,
    requesterName: identities.get(r.user_id)?.name ?? null,
    requesterEmail: identities.get(r.user_id)?.email ?? null,
  }));
}

/**
 * Onboarding/authorization rework (2026-09-21) -- the coordinator's
 * auditable view of every non-pending decision at their institution
 * (approved/rejected/revoked), most recent first. `institution_memberships`
 * keeps only the LATEST decision per (institution, user, role) row --
 * this is a real limitation (a prior rejection is overwritten if the
 * same person is later approved) documented as a residual risk rather
 * than solved here with a new history table.
 */
export async function listDecidedMemberships(institutionId: string): Promise<Array<InstitutionMembership & { userEmail: string | null; userName: string | null }>> {
  const result = await db.query(
    `
    SELECT im.id, im.institution_id, im.user_id, im.membership_role, im.status, im.requested_at, im.reviewed_at, im.reviewed_by_user_id, u.email AS user_email
    FROM institution_memberships im
    JOIN users u ON u.id = im.user_id
    WHERE im.institution_id = $1 AND im.status != 'PENDING'
    ORDER BY im.reviewed_at DESC NULLS LAST
    `,
    [institutionId]
  );
  // Track A: the person, not a uuid (resolved for this institution's own rows only).
  const identities = await resolveDisplayIdentities(result.rows.map((r: any) => r.user_id));
  return result.rows.map((r: any) => ({
    ...toMembership(r),
    userEmail: identities.get(r.user_id)?.email ?? r.user_email,
    userName: identities.get(r.user_id)?.name ?? null,
  }));
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
    `UPDATE institution_memberships SET status = $1, reviewed_at = NOW(), reviewed_by_user_id = $2, updated_at = NOW() WHERE id = $3 AND status = 'PENDING' RETURNING id`,
    [decision, reviewerUserId, membershipId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Soft-revoke an APPROVED membership -- never a DELETE (INV-F2-07/08). Any ACTIVE assignments under it are ended in the same transaction so access is removed immediately, without deleting the assignment's own historical row.
 *
 * Track A: TEACHER memberships only. An institution admin can never revoke
 * another admin's (or their own) INSTITUTION_ADMIN membership through the
 * teacher console -- admin membership is a StudyUS-admin decision.
 */
export async function revokeMembership(membershipId: string, reviewerUserId: string): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const membership = await client.query(
      `UPDATE institution_memberships SET status = 'REVOKED', reviewed_at = NOW(), reviewed_by_user_id = $1, updated_at = NOW() WHERE id = $2 AND status = 'APPROVED' AND membership_role = 'TEACHER' RETURNING id`,
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

/**
 * Track A: a class's grade must belong to the SAME institution (guarded in
 * the INSERT itself). Throws SCOPE_OUTSIDE_INSTITUTION otherwise -- a class
 * can never be filed under another institution's grade. The optional
 * canonical subject must be an ACTIVE catalog subject (SUBJECT_NOT_AVAILABLE
 * otherwise): it is what scopes the class's topics, assignments and the
 * teacher's learner view.
 */
export async function createClass(
  institutionId: string,
  gradeId: string | null,
  name: string,
  canonicalSubjectId: string | null = null
): Promise<{ id: string; name: string }> {
  if (canonicalSubjectId && !(await isActiveCanonicalSubject(canonicalSubjectId))) throw new Error('SUBJECT_NOT_AVAILABLE');
  const result = await db.query(
    `INSERT INTO classes (institution_id, grade_id, name, canonical_subject_id)
     SELECT $1::uuid, $2::uuid, $3, $4::uuid
     WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM grades g WHERE g.id = $2::uuid AND g.institution_id = $1::uuid)
     RETURNING id, name`,
    [institutionId, gradeId, name, canonicalSubjectId]
  );
  if (result.rows.length === 0) throw new Error('SCOPE_OUTSIDE_INSTITUTION');
  return result.rows[0];
}

async function isActiveCanonicalSubject(canonicalSubjectId: string): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM canonical_subjects WHERE id = $1 AND status = 'ACTIVE'`, [canonicalSubjectId]);
  return r.rows.length > 0;
}

/** ACTIVE catalog subjects an Institution Admin can link a class to (the catalog itself is StudyUS-owned; nobody here creates one). */
export async function listLinkableSubjects(): Promise<Array<{ id: string; name: string }>> {
  const r = await db.query(`SELECT id, name FROM canonical_subjects WHERE status = 'ACTIVE' ORDER BY name`);
  return r.rows.map((row: any) => ({ id: row.id, name: row.name }));
}

/**
 * Link (or re-link) a class of THIS institution to one ACTIVE catalog
 * subject. Scoped by institution in the UPDATE itself: a class id from
 * another institution matches nothing (false).
 */
export async function setClassSubject(institutionId: string, classId: string, canonicalSubjectId: string): Promise<boolean> {
  if (!(await isActiveCanonicalSubject(canonicalSubjectId))) throw new Error('SUBJECT_NOT_AVAILABLE');
  const r = await db.query(
    `UPDATE classes SET canonical_subject_id = $3 WHERE id = $1 AND institution_id = $2 RETURNING id`,
    [classId, institutionId, canonicalSubjectId]
  );
  return (r.rowCount ?? 0) > 0;
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
  // Track A: a scope must name a grade or a class -- a scope with neither
  // silently grants nothing (DB CHECK teacher_assignments_scope_present).
  if (!scope.gradeId && !scope.classId) {
    throw new Error('SCOPE_REQUIRED');
  }
  // Foundation (ADR-F06, tenant isolation): the grade / class must belong to
  // the SAME institution as the membership (and a class must sit in the
  // given grade when both are set). Read paths already re-check
  // c.institution_id = im.institution_id, but without this a scope row could
  // still point a teacher at another institution's class. Guarded in the
  // INSERT itself so the check and the write are one atomic statement.
  const result = await db.query(
    `
    INSERT INTO teacher_assignments (institution_membership_id, grade_id, class_id, subject_label, status)
    SELECT im.id, $2::uuid, $3::uuid, $4, 'ACTIVE'
    FROM institution_memberships im
    WHERE im.id = $1
      AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM grades g WHERE g.id = $2::uuid AND g.institution_id = im.institution_id))
      AND ($3::uuid IS NULL OR EXISTS (
            SELECT 1 FROM classes c
            WHERE c.id = $3::uuid AND c.institution_id = im.institution_id
              AND ($2::uuid IS NULL OR c.grade_id IS NULL OR c.grade_id = $2::uuid)))
    RETURNING id, institution_membership_id, grade_id, class_id, subject_label, status
    `,
    [institutionMembershipId, scope.gradeId ?? null, scope.classId ?? null, scope.subjectLabel ?? null]
  );
  if (result.rows.length === 0) {
    throw new Error('SCOPE_OUTSIDE_INSTITUTION');
  }
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
  return {
    id: row.id,
    institutionId: row.institution_id,
    userId: row.user_id,
    membershipRole: row.membership_role,
    status: row.status,
    requestedAt: row.requested_at ? new Date(row.requested_at).toISOString() : undefined,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : row.reviewed_at === null ? null : undefined,
    reviewedByUserId: row.reviewed_by_user_id ?? undefined,
  };
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

// ---------------------------------------------------------------------------
// Track A -- institution setup, roster and consent-based enrollment.
// Every function here takes the institution id the CALLER was authorized for
// (`canAccessInstitution` at the route) and re-checks that each child object
// (grade / class / enrollment / membership) belongs to it -- a spoofed id from
// another institution simply matches nothing.
// ---------------------------------------------------------------------------

export interface InstitutionGradeRow {
  id: string;
  name: string;
}

export interface InstitutionClassRow {
  id: string;
  name: string;
  gradeId: string | null;
  gradeName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  /** Track A -- the institution curriculum subject this class works on (explicit association). */
  institutionCurriculumId: string | null;
  activeEnrollmentCount: number;
  pendingEnrollmentCount: number;
  teachers: Array<{ assignmentId: string; userId: string; email: string | null; name: string | null }>;
}

export async function getInstitutionById(institutionId: string): Promise<Institution | null> {
  const r = await db.query(`SELECT id, name, status FROM institutions WHERE id = $1`, [institutionId]);
  return r.rows.length > 0 ? toInstitution(r.rows[0]) : null;
}

export async function listInstitutionGrades(institutionId: string): Promise<InstitutionGradeRow[]> {
  const r = await db.query(`SELECT id, name FROM grades WHERE institution_id = $1 ORDER BY name`, [institutionId]);
  return r.rows.map((row: any) => ({ id: row.id, name: row.name }));
}

export async function listInstitutionClassesWithStaff(institutionId: string): Promise<InstitutionClassRow[]> {
  const r = await db.query(
    `
    SELECT c.id, c.name, c.grade_id, g.name AS grade_name, c.canonical_subject_id, cs.name AS subject_name, c.institution_curriculum_id,
      (SELECT COUNT(*)::int FROM class_enrollments ce WHERE ce.class_id = c.id AND ce.status = 'ACTIVE') AS active_count,
      (SELECT COUNT(*)::int FROM class_enrollments ce WHERE ce.class_id = c.id AND ce.status = 'PENDING') AS pending_count,
      COALESCE((
        SELECT json_agg(json_build_object('assignmentId', ta.id, 'userId', im.user_id, 'email', u.email) ORDER BY u.email)
        FROM teacher_assignments ta
        JOIN institution_memberships im ON im.id = ta.institution_membership_id
        JOIN users u ON u.id = im.user_id
        WHERE ta.status = 'ACTIVE' AND im.status = 'APPROVED' AND im.institution_id = c.institution_id
          AND (ta.class_id = c.id OR (ta.class_id IS NULL AND ta.grade_id IS NOT NULL AND ta.grade_id = c.grade_id))
      ), '[]'::json) AS teachers
    FROM classes c
    LEFT JOIN grades g ON g.id = c.grade_id
    LEFT JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id
    WHERE c.institution_id = $1
    ORDER BY g.name NULLS LAST, c.name
    `,
    [institutionId]
  );
  const identities = await resolveDisplayIdentities(r.rows.flatMap((row: any) => (row.teachers ?? []).map((tch: any) => tch.userId)));
  return r.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    gradeId: row.grade_id,
    gradeName: row.grade_name,
    subjectId: row.canonical_subject_id,
    subjectName: row.subject_name,
    institutionCurriculumId: row.institution_curriculum_id ?? null,
    activeEnrollmentCount: row.active_count,
    pendingEnrollmentCount: row.pending_count,
    teachers: (row.teachers ?? []).map((tch: any) => ({
      ...tch,
      email: identities.get(tch.userId)?.email ?? tch.email,
      name: identities.get(tch.userId)?.name ?? null,
    })),
  }));
}

/** Approved TEACHER memberships of one institution, with the teacher's email (never a raw id in the UI). */
export async function listApprovedTeachers(institutionId: string): Promise<Array<{ membershipId: string; userId: string; email: string | null; name: string | null }>> {
  const r = await db.query(
    `SELECT im.id, im.user_id, u.email FROM institution_memberships im JOIN users u ON u.id = im.user_id
     WHERE im.institution_id = $1 AND im.membership_role = 'TEACHER' AND im.status = 'APPROVED' ORDER BY u.email`,
    [institutionId]
  );
  const identities = await resolveDisplayIdentities(r.rows.map((row: any) => row.user_id));
  return r.rows.map((row: any) => ({
    membershipId: row.id,
    userId: row.user_id,
    email: identities.get(row.user_id)?.email ?? row.email,
    name: identities.get(row.user_id)?.name ?? null,
  }));
}

/**
 * Pending requests of ONE institution WITH the requester's identity (name +
 * email) -- the admin decides on a person, not a uuid. Scoped by
 * institution_id: identities are resolved only for this institution's own
 * requesters (the caller has already authorized the viewer for it).
 */
export async function listPendingMembershipsWithEmail(institutionId: string): Promise<Array<InstitutionMembership & { userEmail: string | null; userName: string | null }>> {
  const r = await db.query(
    `SELECT im.id, im.institution_id, im.user_id, im.membership_role, im.status, im.requested_at, im.reviewed_at, im.reviewed_by_user_id, u.email AS user_email
     FROM institution_memberships im JOIN users u ON u.id = im.user_id
     WHERE im.institution_id = $1 AND im.status = 'PENDING' ORDER BY im.requested_at ASC`,
    [institutionId]
  );
  const identities = await resolveDisplayIdentities(r.rows.map((row: any) => row.user_id));
  return r.rows.map((row: any) => ({
    ...toMembership(row),
    userEmail: identities.get(row.user_id)?.email ?? row.user_email,
    userName: identities.get(row.user_id)?.name ?? null,
  }));
}

export interface InstitutionClassSummary {
  id: string;
  name: string;
  gradeId: string | null;
  gradeName: string | null;
  subjectId: string | null;
  subjectName: string | null;
}

export async function getClassInInstitution(institutionId: string, classId: string): Promise<InstitutionClassSummary | null> {
  const r = await db.query(
    `SELECT c.id, c.name, c.grade_id, g.name AS grade_name, c.canonical_subject_id, cs.name AS subject_name
     FROM classes c LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id
     WHERE c.id = $1 AND c.institution_id = $2`,
    [classId, institutionId]
  );
  const row = r.rows[0];
  return row
    ? { id: row.id, name: row.name, gradeId: row.grade_id, gradeName: row.grade_name, subjectId: row.canonical_subject_id, subjectName: row.subject_name }
    : null;
}

export interface ClassRosterEntry {
  enrollmentId: string;
  studentId: string;
  name: string;
  email: string | null;
  status: 'PENDING' | 'ACTIVE';
  since: string;
}

/** The institution-admin roster of one class: ACTIVE students and PENDING invitations (never DECLINED/ENDED). */
export async function listClassRosterForInstitution(institutionId: string, classId: string): Promise<ClassRosterEntry[]> {
  const r = await db.query(
    `
    SELECT ce.id, ce.student_id, ce.status, COALESCE(ce.responded_at, ce.created_at) AS since, s.name, s.email
    FROM class_enrollments ce
    JOIN classes c ON c.id = ce.class_id
    JOIN students s ON s.id = ce.student_id
    WHERE ce.class_id = $1 AND c.institution_id = $2 AND ce.status IN ('ACTIVE', 'PENDING')
    ORDER BY ce.status, s.name NULLS LAST, s.email
    `,
    [classId, institutionId]
  );
  return r.rows.map((row: any) => ({
    enrollmentId: row.id,
    studentId: row.student_id,
    name: row.name || row.email || '',
    email: row.email,
    status: row.status,
    since: row.since instanceof Date ? row.since.toISOString() : row.since,
  }));
}

export type ClassInvitationOutcome =
  | { outcome: 'INVITED'; enrollmentId: string; studentUserId: string }
  | { outcome: 'ALREADY_PENDING' | 'ALREADY_ACTIVE' }
  | { outcome: 'NO_STUDENT_ACCOUNT' };

/**
 * Invite a Student to a class by email. Enrollment is what grants the
 * class's teachers read access to the learner, so it is CONSENT-BASED: the
 * row starts PENDING (grants nothing -- every check requires ACTIVE) and
 * becomes ACTIVE only when the Student accepts. Only identities holding an
 * ACTIVE STUDENT role are matched; independent Students stay independent
 * unless they accept. Re-inviting after a decline/removal re-opens the
 * invitation; an ACTIVE enrollment is left untouched.
 */
export async function inviteStudentToClass(
  institutionId: string,
  classId: string,
  studentEmail: string,
  actorUserId: string
): Promise<ClassInvitationOutcome> {
  const klass = await getClassInInstitution(institutionId, classId);
  if (!klass) throw new Error('CLASS_NOT_IN_INSTITUTION');

  const match = await db.query(
    `SELECT s.id AS student_id, s.user_id FROM students s
     JOIN users u ON u.id = s.user_id
     JOIN user_roles r ON r.user_id = u.id AND r.role = 'STUDENT' AND r.status = 'ACTIVE'
     WHERE (lower(u.email) = lower($1) OR lower(s.email) = lower($1)) AND u.status = 'ACTIVE'
     ORDER BY s.created_at ASC NULLS LAST LIMIT 1`,
    [studentEmail.trim()]
  );
  const student = match.rows[0];
  if (!student) return { outcome: 'NO_STUDENT_ACCOUNT' };

  const existing = await db.query(`SELECT id, status FROM class_enrollments WHERE class_id = $1 AND student_id = $2`, [classId, student.student_id]);
  if (existing.rows[0]?.status === 'ACTIVE') return { outcome: 'ALREADY_ACTIVE' };
  if (existing.rows[0]?.status === 'PENDING') return { outcome: 'ALREADY_PENDING' };

  const written = await db.query(
    `INSERT INTO class_enrollments (class_id, student_id, status, invited_by_user_id)
     VALUES ($1, $2, 'PENDING', $3)
     ON CONFLICT (class_id, student_id) DO UPDATE
       SET status = 'PENDING', invited_by_user_id = $3, responded_at = NULL, ended_at = NULL
       WHERE class_enrollments.status IN ('DECLINED', 'ENDED')
     RETURNING id`,
    [classId, student.student_id, actorUserId]
  );
  if (written.rows.length === 0) return { outcome: 'ALREADY_PENDING' };
  return { outcome: 'INVITED', enrollmentId: written.rows[0].id, studentUserId: student.user_id };
}

/** Remove a Student (or withdraw a pending invitation) -- soft, never a DELETE. Scoped to the class AND institution. */
export async function endClassEnrollment(institutionId: string, classId: string, enrollmentId: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE class_enrollments ce SET status = 'ENDED', ended_at = NOW()
     FROM classes c
     WHERE ce.id = $1 AND ce.class_id = $2 AND c.id = ce.class_id AND c.institution_id = $3 AND ce.status IN ('ACTIVE', 'PENDING')
     RETURNING ce.id, ce.student_id`,
    [enrollmentId, classId, institutionId]
  );
  const ended = r.rows[0];
  if (ended) {
    // The class no longer contributes to this learner's plan; the plan entry and all learning history stay.
    // (Inline on purpose: this module must not import the learning-plan stack.)
    await db.query(
      `WITH retired AS (
         UPDATE student_concept_sources SET active = false, deactivated_at = now(), deactivation_reason = 'ENROLLMENT_ENDED'
         WHERE class_id = $1 AND student_id = $2 AND active = true AND source_type IN ('CLASS_PLAN', 'TEACHER_ASSIGNMENT', 'INSTITUTION_CURRICULUM')
         RETURNING student_id, canonical_concept_id, source_type, source_key
       )
       INSERT INTO student_plan_events (student_id, canonical_concept_id, event_type, source_type, source_key, detail)
       SELECT student_id, canonical_concept_id, 'SOURCE_REMOVED', source_type, source_key, '{"reason":"ENROLLMENT_ENDED"}'::jsonb FROM retired`,
      [classId, ended.student_id]
    ).catch((e) => console.error('[institution] class source deactivation failed', (e as Error)?.message));
  }
  return Boolean(ended);
}

export interface StudentClassInvitation {
  enrollmentId: string;
  classId: string;
  className: string;
  institutionName: string;
  invitedAt: string;
}

/** The Student's own pending class invitations. `studentId` is always the caller's own resolved id. */
export async function listPendingClassInvitationsForStudent(studentId: string): Promise<StudentClassInvitation[]> {
  const r = await db.query(
    `SELECT ce.id, ce.class_id, c.name AS class_name, i.name AS institution_name, ce.created_at
     FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN institutions i ON i.id = c.institution_id
     WHERE ce.student_id = $1 AND ce.status = 'PENDING' AND i.status = 'ACTIVE'
     ORDER BY ce.created_at ASC`,
    [studentId]
  );
  return r.rows.map((row: any) => ({
    enrollmentId: row.id,
    classId: row.class_id,
    className: row.class_name,
    institutionName: row.institution_name,
    invitedAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));
}

/** The Student's own active classes (read-only context for the Student). */
export async function listActiveClassesForStudent(studentId: string): Promise<Array<{ classId: string; className: string; institutionName: string }>> {
  const r = await db.query(
    `SELECT c.id, c.name, i.name AS institution_name FROM class_enrollments ce
     JOIN classes c ON c.id = ce.class_id JOIN institutions i ON i.id = c.institution_id
     WHERE ce.student_id = $1 AND ce.status = 'ACTIVE' ORDER BY i.name, c.name`,
    [studentId]
  );
  return r.rows.map((row: any) => ({ classId: row.id, className: row.name, institutionName: row.institution_name }));
}

/**
 * The Student accepts or declines a PENDING class invitation addressed to
 * THEM (`student_id = $studentId` is the whole authorization boundary; the
 * caller's own resolved id is always used). Returns the inviting admin and
 * class context for the notification, or null when nothing changed.
 */
export async function respondToClassInvitation(
  studentId: string,
  enrollmentId: string,
  accept: boolean
): Promise<{ invitedByUserId: string | null; institutionId: string; classId: string; className: string } | null> {
  const r = await db.query(
    `UPDATE class_enrollments ce SET status = $3, responded_at = NOW()
     FROM classes c
     WHERE ce.id = $1 AND ce.student_id = $2 AND ce.status = 'PENDING' AND c.id = ce.class_id
     RETURNING ce.invited_by_user_id, c.institution_id, c.id AS class_id, c.name`,
    [enrollmentId, studentId, accept ? 'ACTIVE' : 'DECLINED']
  );
  const row = r.rows[0];
  return row ? { invitedByUserId: row.invited_by_user_id, institutionId: row.institution_id, classId: row.class_id, className: row.name } : null;
}

/** ACTIVE teacher scopes of one institution, for the admin's class staffing view. */
export async function listInstitutionTeacherAssignments(institutionId: string): Promise<Array<{ id: string; membershipId: string; email: string | null; gradeName: string | null; className: string | null; subjectLabel: string | null }>> {
  const r = await db.query(
    `SELECT ta.id, ta.institution_membership_id, u.email, g.name AS grade_name, c.name AS class_name, ta.subject_label
     FROM teacher_assignments ta
     JOIN institution_memberships im ON im.id = ta.institution_membership_id
     JOIN users u ON u.id = im.user_id
     LEFT JOIN grades g ON g.id = ta.grade_id
     LEFT JOIN classes c ON c.id = ta.class_id
     WHERE im.institution_id = $1 AND ta.status = 'ACTIVE'
     ORDER BY u.email, c.name NULLS LAST`,
    [institutionId]
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    membershipId: row.institution_membership_id,
    email: row.email,
    gradeName: row.grade_name,
    className: row.class_name,
    subjectLabel: row.subject_label,
  }));
}
