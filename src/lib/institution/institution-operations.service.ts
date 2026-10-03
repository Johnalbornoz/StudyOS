/**
 * Track A -- Institution workspace: core administration (coordinator).
 *
 *   Grades       create / edit / archive / reactivate / delete (only when nothing depends on it)
 *   Classes      create (grade required, academic area, EXPLICIT curriculum, period, teacher) /
 *                edit / archive / reactivate / change teacher
 *   Teachers     invite an existing teacher account (INVITED -> the teacher accepts -> APPROVED),
 *                suspend / reactivate the institutional relation (assignments are kept)
 *   Students     institution roster; add by email (an institution student is enrolled directly,
 *                anyone else is invited and must accept), enroll in another class, move, remove.
 *                A Student is never created here; learner history is never touched.
 *   Coordinators reactivate a removed coordinator (the last-coordinator rule stays in removal)
 *   Setup        progress of the first-time setup (grades, curriculum, classes, teachers, students)
 *
 * Every function is TENANT-SCOPED: ids of another institution are NOT_FOUND. Callers
 * authorize the actor as a coordinator of the institution first (requireInstitutionAdminActor).
 * Every write is audited in academic_governance_events (actor, object, fields, old, new).
 */
import { db } from '@/lib/db';
import { recordGovernanceEvent } from './academic-governance';
import { resolveDisplayIdentities } from '@/lib/identity/display-identity';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import { assignClassCurriculum, compatibleCurriculaForClass } from './curriculum-management.service';
import { endClassEnrollment, getInstitutionById, inviteInstitutionAdmin, isActiveCanonicalSubject } from '@/services/institution.service';
import { inviteToClassAndNotify } from './class-invitations';

export class InstitutionOpsError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'GRADE_REQUIRED'
      | 'GRADE_NOT_ACTIVE'
      | 'GRADE_HAS_ACTIVE_CLASSES'
      | 'GRADE_HAS_DEPENDENCIES'
      | 'DUPLICATE_GRADE_NAME'
      | 'DUPLICATE_CLASS_NAME'
      | 'CLASS_ARCHIVED'
      | 'DOMAIN_NOT_AVAILABLE'
      | 'DOMAIN_MISMATCH'
      | 'CURRICULUM_NOT_AVAILABLE'
      | 'TEACHER_NOT_AVAILABLE'
      | 'NO_TEACHER_ACCOUNT'
      | 'ALREADY_MEMBER'
      | 'INVALID_STATE'
      | 'NO_STUDENT_ACCOUNT'
      | 'ALREADY_ENROLLED'
      | 'NOT_ENROLLED'
      | 'SAME_CLASS'
      | 'ROLE_REVOKED'
      | 'SUBJECT_NOT_AVAILABLE'
  ) {
    super(code);
    this.name = 'InstitutionOpsError';
  }
}

const audit = (institutionId: string, actorUserId: string, objectType: string, objectId: string, action: string, oldValues: Record<string, unknown> = {}, newValues: Record<string, unknown> = {}) =>
  recordGovernanceEvent({ institutionId, actorUserId, actorScope: 'INSTITUTION', objectType, objectId, action, fields: [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])], oldValues, newValues });
const iso = (v: any): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);
const clean = (s: string | null | undefined, max = 120) => (s === undefined ? undefined : s === null ? null : s.trim().slice(0, max) || null);

// ============================================================================ grades

export interface GradeRow {
  id: string;
  name: string;
  academicLevel: string | null;
  programmeLabel: string | null;
  academicProgrammeId: string | null;
  academicYear: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: string | null;
  activeClasses: number;
  archivedClasses: number;
  students: number;
  curricula: number;
}

export async function listGrades(institutionId: string, opts: { includeArchived?: boolean } = {}): Promise<GradeRow[]> {
  const r = await db.query(
    `SELECT g.*, COALESCE(p.name, g.programme_label) AS programme,
            (SELECT COUNT(*) FROM classes c WHERE c.grade_id = g.id AND c.status = 'ACTIVE')::int AS active_classes,
            (SELECT COUNT(*) FROM classes c WHERE c.grade_id = g.id AND c.status = 'ARCHIVED')::int AS archived_classes,
            (SELECT COUNT(DISTINCT ce.student_id) FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE c.grade_id = g.id AND c.status = 'ACTIVE' AND ce.status = 'ACTIVE')::int AS students,
            (SELECT COUNT(*) FROM institution_curricula ic WHERE ic.grade_id = g.id AND ic.status = 'ACTIVE')::int AS curricula
       FROM grades g LEFT JOIN academic_programmes p ON p.id = g.academic_programme_id
      WHERE g.institution_id = $1 AND ($2::boolean OR g.status = 'ACTIVE')
      ORDER BY g.status, g.name`,
    [institutionId, Boolean(opts.includeArchived)]
  );
  return r.rows.map((g: any) => ({
    id: g.id,
    name: g.name,
    academicLevel: g.academic_level,
    programmeLabel: g.programme,
    academicProgrammeId: g.academic_programme_id,
    academicYear: g.academic_year,
    status: g.status,
    archivedAt: iso(g.archived_at),
    activeClasses: g.active_classes,
    archivedClasses: g.archived_classes,
    students: g.students,
    curricula: g.curricula,
  }));
}

async function gradeOf(institutionId: string, gradeId: string) {
  const g = (await db.query(`SELECT * FROM grades WHERE id = $1 AND institution_id = $2`, [gradeId, institutionId])).rows[0];
  if (!g) throw new InstitutionOpsError('NOT_FOUND');
  return g;
}
async function assertUniqueGradeName(institutionId: string, name: string, exceptId: string | null) {
  const dup = await db.query(`SELECT 1 FROM grades WHERE institution_id = $1 AND lower(name) = lower($2) AND status = 'ACTIVE' AND ($3::uuid IS NULL OR id <> $3)`, [institutionId, name, exceptId]);
  if (dup.rows[0]) throw new InstitutionOpsError('DUPLICATE_GRADE_NAME');
}
async function validProgramme(id: string | null | undefined) {
  if (!id) return null;
  const p = (await db.query(`SELECT id FROM academic_programmes WHERE id = $1`, [id])).rows[0];
  if (!p) throw new InstitutionOpsError('NOT_FOUND');
  return p.id as string;
}

export interface GradeInput {
  name: string;
  academicLevel?: string | null;
  programmeLabel?: string | null;
  academicProgrammeId?: string | null;
  academicYear?: string | null;
}

export async function createGradeV2(institutionId: string, input: GradeInput, actorUserId: string): Promise<{ id: string; name: string }> {
  const name = input.name.trim();
  await assertUniqueGradeName(institutionId, name, null);
  const programmeId = await validProgramme(input.academicProgrammeId);
  const r = await db.query(
    `INSERT INTO grades (institution_id, name, academic_level, programme_label, academic_programme_id, academic_year) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name`,
    [institutionId, name, clean(input.academicLevel) ?? null, clean(input.programmeLabel) ?? null, programmeId, clean(input.academicYear, 20) ?? null]
  );
  await audit(institutionId, actorUserId, 'GRADE', r.rows[0].id, 'GRADE_CREATED', {}, { name, academicLevel: input.academicLevel ?? null, programme: input.programmeLabel ?? programmeId, academicYear: input.academicYear ?? null });
  return r.rows[0];
}

export async function updateGrade(institutionId: string, gradeId: string, patch: Partial<GradeInput>, actorUserId: string) {
  const g = await gradeOf(institutionId, gradeId);
  const next = {
    name: patch.name !== undefined ? patch.name.trim() : g.name,
    academic_level: patch.academicLevel !== undefined ? clean(patch.academicLevel) : g.academic_level,
    programme_label: patch.programmeLabel !== undefined ? clean(patch.programmeLabel) : g.programme_label,
    academic_programme_id: patch.academicProgrammeId !== undefined ? await validProgramme(patch.academicProgrammeId) : g.academic_programme_id,
    academic_year: patch.academicYear !== undefined ? clean(patch.academicYear, 20) : g.academic_year,
  };
  if (next.name.toLowerCase() !== String(g.name).toLowerCase() && g.status === 'ACTIVE') await assertUniqueGradeName(institutionId, next.name, gradeId);
  const changed = (Object.keys(next) as Array<keyof typeof next>).filter((k) => (next[k] ?? null) !== (g[k] ?? null));
  if (!changed.length) return { id: gradeId, changed: false };
  await db.query(
    `UPDATE grades SET name = $2, academic_level = $3, programme_label = $4, academic_programme_id = $5, academic_year = $6, updated_at = now() WHERE id = $1`,
    [gradeId, next.name, next.academic_level, next.programme_label, next.academic_programme_id, next.academic_year]
  );
  await audit(institutionId, actorUserId, 'GRADE', gradeId, 'GRADE_UPDATED', Object.fromEntries(changed.map((k) => [k, g[k] ?? null])), Object.fromEntries(changed.map((k) => [k, next[k] ?? null])));
  return { id: gradeId, changed: true };
}

/** Archive: never deletes. A grade with ACTIVE classes is not archived (archive or move its classes first). */
export async function archiveGrade(institutionId: string, gradeId: string, actorUserId: string) {
  const g = await gradeOf(institutionId, gradeId);
  if (g.status === 'ARCHIVED') return { id: gradeId, changed: false };
  const active = await db.query(`SELECT COUNT(*)::int AS n FROM classes WHERE grade_id = $1 AND status = 'ACTIVE'`, [gradeId]);
  if (active.rows[0].n > 0) throw new InstitutionOpsError('GRADE_HAS_ACTIVE_CLASSES');
  await db.query(`UPDATE grades SET status = 'ARCHIVED', archived_at = now(), updated_at = now() WHERE id = $1`, [gradeId]);
  await audit(institutionId, actorUserId, 'GRADE', gradeId, 'GRADE_ARCHIVED', { status: 'ACTIVE' }, { status: 'ARCHIVED' });
  return { id: gradeId, changed: true };
}

export async function reactivateGrade(institutionId: string, gradeId: string, actorUserId: string) {
  const g = await gradeOf(institutionId, gradeId);
  if (g.status === 'ACTIVE') return { id: gradeId, changed: false };
  await assertUniqueGradeName(institutionId, g.name, gradeId);
  await db.query(`UPDATE grades SET status = 'ACTIVE', archived_at = NULL, updated_at = now() WHERE id = $1`, [gradeId]);
  await audit(institutionId, actorUserId, 'GRADE', gradeId, 'GRADE_REACTIVATED', { status: 'ARCHIVED' }, { status: 'ACTIVE' });
  return { id: gradeId, changed: true };
}

/** Hard delete ONLY a grade nothing depends on (no class ever, no curriculum, no teacher scope). Otherwise: archive. */
export async function deleteGrade(institutionId: string, gradeId: string, actorUserId: string) {
  const g = await gradeOf(institutionId, gradeId);
  const deps = await db.query(
    `SELECT (SELECT COUNT(*) FROM classes WHERE grade_id = $1) + (SELECT COUNT(*) FROM institution_curricula WHERE grade_id = $1) + (SELECT COUNT(*) FROM teacher_assignments WHERE grade_id = $1) AS n`,
    [gradeId]
  );
  if (Number(deps.rows[0].n) > 0) throw new InstitutionOpsError('GRADE_HAS_DEPENDENCIES');
  await db.query(`DELETE FROM grades WHERE id = $1 AND institution_id = $2`, [gradeId, institutionId]);
  await audit(institutionId, actorUserId, 'GRADE', gradeId, 'GRADE_DELETED', { name: g.name }, {});
  return { id: gradeId, deleted: true };
}

// ============================================================================ classes

async function classOf(institutionId: string, classId: string) {
  const c = (await db.query(`SELECT * FROM classes WHERE id = $1 AND institution_id = $2`, [classId, institutionId])).rows[0];
  if (!c) throw new InstitutionOpsError('NOT_FOUND');
  return c;
}
async function activeGrade(institutionId: string, gradeId: string | null | undefined) {
  if (!gradeId) throw new InstitutionOpsError('GRADE_REQUIRED');
  const g = await gradeOf(institutionId, gradeId); // another institution's grade -> NOT_FOUND
  if (g.status !== 'ACTIVE') throw new InstitutionOpsError('GRADE_NOT_ACTIVE');
  return g;
}
async function assertUniqueClassName(institutionId: string, gradeId: string, name: string, exceptId: string | null) {
  const dup = await db.query(
    `SELECT 1 FROM classes WHERE institution_id = $1 AND grade_id = $2 AND lower(name) = lower($3) AND status = 'ACTIVE' AND ($4::uuid IS NULL OR id <> $4)`,
    [institutionId, gradeId, name, exceptId]
  );
  if (dup.rows[0]) throw new InstitutionOpsError('DUPLICATE_CLASS_NAME');
}
async function validDomain(code: string | null | undefined) {
  if (!code) return null;
  if (!(await db.query(`SELECT 1 FROM canonical_academic_domains WHERE code = $1 AND status = 'ACTIVE'`, [code])).rows[0]) throw new InstitutionOpsError('DOMAIN_NOT_AVAILABLE');
  return code;
}
/** An APPROVED teacher membership of THIS institution (another institution's teacher -> TEACHER_NOT_AVAILABLE). */
async function approvedTeacher(institutionId: string, membershipId: string) {
  const m = (await db.query(`SELECT id, user_id FROM institution_memberships WHERE id = $1 AND institution_id = $2 AND membership_role = 'TEACHER' AND status = 'APPROVED'`, [membershipId, institutionId])).rows[0];
  if (!m) throw new InstitutionOpsError('TEACHER_NOT_AVAILABLE');
  return m as { id: string; user_id: string };
}

export interface ClassInput {
  name: string;
  gradeId: string;
  academicDomainCode?: string | null;
  canonicalSubjectId?: string | null;
  institutionCurriculumId?: string | null;
  period?: string | null;
  teacherMembershipId?: string | null;
}

/**
 * Create a class: grade REQUIRED (an ACTIVE grade of this institution), academic area optional,
 * curriculum only if chosen EXPLICITLY (and compatible: same area, usable for the grade), teacher
 * optional (an APPROVED teacher of this institution). Everything is validated BEFORE writing.
 */
export async function createClassV2(institutionId: string, input: ClassInput, actorUserId: string): Promise<{ id: string; name: string }> {
  const name = input.name.trim();
  const grade = await activeGrade(institutionId, input.gradeId);
  await assertUniqueClassName(institutionId, grade.id, name, null);
  const domain = await validDomain(input.academicDomainCode);
  let subjectId = input.canonicalSubjectId ?? null;
  if (subjectId && !(await isActiveCanonicalSubject(subjectId))) throw new InstitutionOpsError('SUBJECT_NOT_AVAILABLE');
  if (input.institutionCurriculumId) {
    const candidates = await compatibleCurriculaForClass(institutionId, grade.id, domain);
    const c = candidates.find((x) => x.curriculumId === input.institutionCurriculumId);
    if (!c) throw new InstitutionOpsError('CURRICULUM_NOT_AVAILABLE');
    if (!c.compatible) throw new InstitutionOpsError(c.compatibility === 'OTHER_DOMAIN' ? 'DOMAIN_MISMATCH' : 'CURRICULUM_NOT_AVAILABLE');
    subjectId = c.canonicalSubjectId;
  }
  const teacher = input.teacherMembershipId ? await approvedTeacher(institutionId, input.teacherMembershipId) : null;
  const created = (await db.query(
    `INSERT INTO classes (institution_id, grade_id, name, canonical_subject_id, academic_domain_code, period) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name`,
    [institutionId, grade.id, name, subjectId, domain, clean(input.period, 40) ?? null]
  )).rows[0];
  await audit(institutionId, actorUserId, 'CLASS', created.id, 'CLASS_CREATED', {}, { name, gradeId: grade.id, academicDomain: domain, period: input.period ?? null });
  if (input.institutionCurriculumId) await assignClassCurriculum({ institutionId, classId: created.id, curriculumId: input.institutionCurriculumId, actorUserId });
  if (teacher) await setClassTeacher(institutionId, created.id, teacher.id, actorUserId);
  return created;
}

export async function updateClassV2(institutionId: string, classId: string, patch: Partial<Omit<ClassInput, 'institutionCurriculumId' | 'teacherMembershipId'>>, actorUserId: string) {
  const c = await classOf(institutionId, classId);
  if (c.status === 'ARCHIVED') throw new InstitutionOpsError('CLASS_ARCHIVED');
  const gradeId = patch.gradeId !== undefined ? (await activeGrade(institutionId, patch.gradeId)).id : c.grade_id;
  const name = patch.name !== undefined ? patch.name.trim() : c.name;
  if (gradeId && (name.toLowerCase() !== String(c.name).toLowerCase() || gradeId !== c.grade_id)) await assertUniqueClassName(institutionId, gradeId, name, classId);
  const domain = patch.academicDomainCode !== undefined ? await validDomain(patch.academicDomainCode) : c.academic_domain_code;
  if (patch.academicDomainCode !== undefined && c.institution_curriculum_id && domain) {
    // The bound curriculum must stay in the class's area: unbind (explicitly) before changing the area.
    const cd = (await db.query(`SELECT cs.academic_domain_code AS d FROM institution_curricula ic JOIN canonical_subjects cs ON cs.id = ic.canonical_subject_id WHERE ic.id = $1`, [c.institution_curriculum_id])).rows[0]?.d;
    if (cd && cd !== domain) throw new InstitutionOpsError('DOMAIN_MISMATCH');
  }
  const period = patch.period !== undefined ? clean(patch.period, 40) : c.period;
  const subjectId = patch.canonicalSubjectId !== undefined ? patch.canonicalSubjectId : c.canonical_subject_id;
  if (patch.canonicalSubjectId && !(await isActiveCanonicalSubject(patch.canonicalSubjectId))) throw new InstitutionOpsError('SUBJECT_NOT_AVAILABLE');
  const before = { name: c.name, grade_id: c.grade_id, academic_domain_code: c.academic_domain_code, period: c.period, canonical_subject_id: c.canonical_subject_id };
  const after = { name, grade_id: gradeId, academic_domain_code: domain, period, canonical_subject_id: subjectId };
  const changed = (Object.keys(after) as Array<keyof typeof after>).filter((k) => (after[k] ?? null) !== (before[k] ?? null));
  if (!changed.length) return { id: classId, changed: false };
  await db.query(`UPDATE classes SET name = $2, grade_id = $3, academic_domain_code = $4, period = $5, canonical_subject_id = $6, updated_at = now() WHERE id = $1`, [classId, name, gradeId, domain, period, subjectId]);
  await audit(institutionId, actorUserId, 'CLASS', classId, 'CLASS_UPDATED', Object.fromEntries(changed.map((k) => [k, before[k] ?? null])), Object.fromEntries(changed.map((k) => [k, after[k] ?? null])));
  return { id: classId, changed: true };
}

/** Archive a class: enrollments, plan, assignments, evidence and learner history are KEPT (history). */
export async function archiveClass(institutionId: string, classId: string, actorUserId: string) {
  const c = await classOf(institutionId, classId);
  if (c.status === 'ARCHIVED') return { id: classId, changed: false };
  await db.query(`UPDATE classes SET status = 'ARCHIVED', archived_at = now(), updated_at = now() WHERE id = $1`, [classId]);
  await audit(institutionId, actorUserId, 'CLASS', classId, 'CLASS_ARCHIVED', { status: 'ACTIVE' }, { status: 'ARCHIVED' });
  return { id: classId, changed: true };
}

export async function reactivateClass(institutionId: string, classId: string, actorUserId: string) {
  const c = await classOf(institutionId, classId);
  if (c.status === 'ACTIVE') return { id: classId, changed: false };
  if (c.grade_id) {
    const g = await gradeOf(institutionId, c.grade_id);
    if (g.status !== 'ACTIVE') throw new InstitutionOpsError('GRADE_NOT_ACTIVE');
    await assertUniqueClassName(institutionId, c.grade_id, c.name, classId);
  }
  await db.query(`UPDATE classes SET status = 'ACTIVE', archived_at = NULL, updated_at = now() WHERE id = $1`, [classId]);
  await audit(institutionId, actorUserId, 'CLASS', classId, 'CLASS_REACTIVATED', { status: 'ARCHIVED' }, { status: 'ACTIVE' });
  return { id: classId, changed: true };
}

/**
 * The class's teacher (one class-scoped teacher; grade-wide scopes are untouched): ends the
 * current class-scoped assignments and creates the new one atomically. null = no class teacher.
 */
export async function setClassTeacher(institutionId: string, classId: string, membershipId: string | null, actorUserId: string) {
  const c = await classOf(institutionId, classId);
  if (c.status === 'ARCHIVED') throw new InstitutionOpsError('CLASS_ARCHIVED');
  const teacher = membershipId ? await approvedTeacher(institutionId, membershipId) : null;
  const client = await db.connect();
  let ended: string[] = [];
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT ta.id, ta.institution_membership_id FROM teacher_assignments ta JOIN institution_memberships im ON im.id = ta.institution_membership_id
        WHERE ta.class_id = $1 AND ta.status = 'ACTIVE' AND im.institution_id = $2 FOR UPDATE OF ta`,
      [classId, institutionId]
    );
    if (teacher && current.rows.length === 1 && current.rows[0].institution_membership_id === teacher.id) {
      await client.query('ROLLBACK');
      return { classId, changed: false };
    }
    ended = current.rows.map((r: any) => r.institution_membership_id);
    await client.query(`UPDATE teacher_assignments SET status = 'ENDED', ended_at = now() WHERE id = ANY($1::uuid[])`, [current.rows.map((r: any) => r.id)]);
    if (teacher) await client.query(`INSERT INTO teacher_assignments (institution_membership_id, class_id, status) VALUES ($1, $2, 'ACTIVE')`, [teacher.id, classId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await audit(institutionId, actorUserId, 'CLASS', classId, teacher ? 'TEACHER_ASSIGNED' : 'TEACHER_UNASSIGNED', { teacherMembershipIds: ended }, { teacherMembershipId: teacher?.id ?? null });
  if (teacher) {
    await notifyUser({
      recipientUserId: teacher.user_id,
      workspace: 'TEACHER',
      type: 'TEACHER_CLASS_ASSIGNED',
      title: 'Nueva clase',
      message: `Ahora puedes trabajar con ${c.name}.`,
      payload: { scopeName: c.name },
      actionHref: `/dashboard/teacher/classes/${classId}`,
    }).catch(() => null);
  }
  return { classId, changed: true };
}

// ============================================================================ teachers

export type TeacherStatus = 'INVITED' | 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED' | 'REVOKED';
export interface TeacherRow {
  membershipId: string;
  userId: string;
  email: string | null;
  name: string | null;
  status: TeacherStatus;
  since: string | null;
  classes: Array<{ assignmentId: string; classId: string | null; className: string | null; gradeId: string | null; gradeName: string | null }>;
}

export async function listTeachers(institutionId: string): Promise<TeacherRow[]> {
  const r = await db.query(
    `SELECT im.id, im.user_id, im.status, u.email, COALESCE(im.reviewed_at, im.invited_at, im.requested_at) AS since,
            COALESCE((SELECT json_agg(json_build_object('assignmentId', ta.id, 'classId', ta.class_id, 'className', c.name, 'gradeId', ta.grade_id, 'gradeName', g.name) ORDER BY c.name NULLS LAST, g.name)
                        FROM teacher_assignments ta LEFT JOIN classes c ON c.id = ta.class_id LEFT JOIN grades g ON g.id = ta.grade_id
                       WHERE ta.institution_membership_id = im.id AND ta.status = 'ACTIVE' AND (c.id IS NULL OR c.status = 'ACTIVE')), '[]'::json) AS classes
       FROM institution_memberships im JOIN users u ON u.id = im.user_id
      WHERE im.institution_id = $1 AND im.membership_role = 'TEACHER'
      ORDER BY CASE im.status WHEN 'PENDING' THEN 0 WHEN 'INVITED' THEN 1 WHEN 'APPROVED' THEN 2 WHEN 'SUSPENDED' THEN 3 ELSE 4 END, u.email`,
    [institutionId]
  );
  const ids = await resolveDisplayIdentities(r.rows.map((x: any) => x.user_id));
  return r.rows.map((x: any) => ({ membershipId: x.id, userId: x.user_id, email: ids.get(x.user_id)?.email ?? x.email, name: ids.get(x.user_id)?.name ?? null, status: x.status, since: iso(x.since), classes: x.classes ?? [] }));
}

async function teacherMembership(institutionId: string, membershipId: string) {
  const m = (await db.query(`SELECT * FROM institution_memberships WHERE id = $1 AND institution_id = $2 AND membership_role = 'TEACHER'`, [membershipId, institutionId])).rows[0];
  if (!m) throw new InstitutionOpsError('NOT_FOUND');
  return m;
}

/**
 * Invite an EXISTING teacher account (by email) to the institution: INVITED until the teacher
 * accepts (-> APPROVED). A pending self-request from that teacher is simply approved. Nobody is
 * created here: an email without a teacher account is NO_TEACHER_ACCOUNT (the person signs up first).
 */
export async function inviteTeacher(institutionId: string, email: string, actorUserId: string): Promise<{ membershipId: string; status: TeacherStatus }> {
  const user = (await db.query(
    `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'TEACHER' AND r.status = 'ACTIVE'
      WHERE lower(u.email) = lower($1) AND u.status = 'ACTIVE' LIMIT 1`,
    [email.trim()]
  )).rows[0];
  if (!user) throw new InstitutionOpsError('NO_TEACHER_ACCOUNT');
  const existing = (await db.query(`SELECT id, status FROM institution_memberships WHERE institution_id = $1 AND user_id = $2 AND membership_role = 'TEACHER'`, [institutionId, user.id])).rows[0];
  if (existing?.status === 'APPROVED') throw new InstitutionOpsError('ALREADY_MEMBER');
  if (existing?.status === 'INVITED') return { membershipId: existing.id, status: 'INVITED' };
  let membershipId: string;
  let status: TeacherStatus;
  if (existing?.status === 'PENDING') {
    // The teacher already asked to join: inviting them is the coordinator's approval.
    await db.query(`UPDATE institution_memberships SET status = 'APPROVED', reviewed_at = now(), reviewed_by_user_id = $2, updated_at = now() WHERE id = $1`, [existing.id, actorUserId]);
    membershipId = existing.id;
    status = 'APPROVED';
  } else {
    const r = await db.query(
      `INSERT INTO institution_memberships (institution_id, user_id, membership_role, status, invited_at, invited_by_user_id)
       VALUES ($1, $2, 'TEACHER', 'INVITED', now(), $3)
       ON CONFLICT (institution_id, user_id, membership_role) DO UPDATE SET status = 'INVITED', invited_at = now(), invited_by_user_id = $3, suspended_at = NULL, updated_at = now()
       RETURNING id`,
      [institutionId, user.id, actorUserId]
    );
    membershipId = r.rows[0].id;
    status = 'INVITED';
  }
  await audit(institutionId, actorUserId, 'TEACHER_MEMBERSHIP', membershipId, status === 'APPROVED' ? 'TEACHER_APPROVED' : 'TEACHER_INVITED', { status: existing?.status ?? null }, { status, email: email.trim().toLowerCase() });
  const institution = await getInstitutionById(institutionId);
  await notifyUser({
    recipientUserId: user.id,
    workspace: 'TEACHER',
    type: status === 'APPROVED' ? 'TEACHER_MEMBERSHIP_APPROVED' : 'TEACHER_INSTITUTION_INVITED',
    title: status === 'APPROVED' ? 'Solicitud aprobada' : 'Invitación de una institución',
    message: status === 'APPROVED' ? `${institution?.name ?? ''} aprobó tu solicitud como docente.` : `${institution?.name ?? ''} te invitó a unirte como docente. Acepta o rechaza en tu espacio de docente.`,
    payload: { institutionName: institution?.name ?? '' },
    actionHref: '/dashboard/teacher',
  }).catch(() => null);
  return { membershipId, status };
}

/** The TEACHER answers an invitation to their OWN membership (another user's -> NOT_FOUND). */
export async function respondTeacherInvitation(userId: string, membershipId: string, accept: boolean) {
  const m = (await db.query(`SELECT * FROM institution_memberships WHERE id = $1 AND user_id = $2 AND membership_role = 'TEACHER'`, [membershipId, userId])).rows[0];
  if (!m) throw new InstitutionOpsError('NOT_FOUND');
  if (m.status !== 'INVITED') {
    if ((accept && m.status === 'APPROVED') || (!accept && m.status === 'REJECTED')) return { membershipId, status: m.status as TeacherStatus, changed: false };
    throw new InstitutionOpsError('INVALID_STATE');
  }
  const status = accept ? 'APPROVED' : 'REJECTED';
  await db.query(`UPDATE institution_memberships SET status = $2, reviewed_at = now(), updated_at = now() WHERE id = $1`, [membershipId, status]);
  await recordGovernanceEvent({ institutionId: m.institution_id, actorUserId: userId, actorScope: 'TEACHER', objectType: 'TEACHER_MEMBERSHIP', objectId: membershipId, action: accept ? 'TEACHER_INVITATION_ACCEPTED' : 'TEACHER_INVITATION_DECLINED', fields: ['status'], oldValues: { status: 'INVITED' }, newValues: { status } });
  return { membershipId, status: status as TeacherStatus, changed: true };
}

export async function listMyTeacherInvitations(userId: string) {
  const r = await db.query(
    `SELECT im.id, i.id AS institution_id, COALESCE(i.display_name, i.name) AS institution_name, im.invited_at FROM institution_memberships im JOIN institutions i ON i.id = im.institution_id
      WHERE im.user_id = $1 AND im.membership_role = 'TEACHER' AND im.status = 'INVITED' AND i.status = 'ACTIVE' ORDER BY im.invited_at DESC`,
    [userId]
  );
  return r.rows.map((x: any) => ({ membershipId: x.id, institutionId: x.institution_id, institutionName: x.institution_name, invitedAt: iso(x.invited_at) }));
}

/** Pause the institutional relation: no class access while SUSPENDED; assignments are KEPT for reactivation. */
export async function suspendTeacher(institutionId: string, membershipId: string, actorUserId: string) {
  const m = await teacherMembership(institutionId, membershipId);
  if (m.status === 'SUSPENDED') return { membershipId, changed: false };
  if (m.status !== 'APPROVED') throw new InstitutionOpsError('INVALID_STATE');
  await db.query(`UPDATE institution_memberships SET status = 'SUSPENDED', suspended_at = now(), reviewed_by_user_id = $2, updated_at = now() WHERE id = $1`, [membershipId, actorUserId]);
  await audit(institutionId, actorUserId, 'TEACHER_MEMBERSHIP', membershipId, 'TEACHER_SUSPENDED', { status: 'APPROVED' }, { status: 'SUSPENDED' });
  return { membershipId, changed: true };
}

export async function reactivateTeacher(institutionId: string, membershipId: string, actorUserId: string) {
  const m = await teacherMembership(institutionId, membershipId);
  if (m.status === 'APPROVED') return { membershipId, changed: false };
  if (m.status !== 'SUSPENDED') throw new InstitutionOpsError('INVALID_STATE');
  await db.query(`UPDATE institution_memberships SET status = 'APPROVED', suspended_at = NULL, reviewed_by_user_id = $2, reviewed_at = now(), updated_at = now() WHERE id = $1`, [membershipId, actorUserId]);
  await audit(institutionId, actorUserId, 'TEACHER_MEMBERSHIP', membershipId, 'TEACHER_REACTIVATED', { status: 'SUSPENDED' }, { status: 'APPROVED' });
  return { membershipId, changed: true };
}

// ============================================================================ students

export interface InstitutionStudentRow {
  studentId: string;
  name: string | null;
  email: string | null;
  enrollments: Array<{ enrollmentId: string; classId: string; className: string; gradeName: string | null; status: 'ACTIVE' | 'PENDING'; classStatus: 'ACTIVE' | 'ARCHIVED' }>;
  status: 'ACTIVE' | 'PENDING';
}

/** Students related to THIS institution through a class enrollment (ACTIVE or a PENDING invitation). */
export async function listInstitutionStudents(institutionId: string): Promise<InstitutionStudentRow[]> {
  const r = await db.query(
    `SELECT s.id, s.name, s.email,
            json_agg(json_build_object('enrollmentId', ce.id, 'classId', c.id, 'className', c.name, 'gradeName', g.name, 'status', ce.status, 'classStatus', c.status) ORDER BY c.name) AS enrollments
       FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN students s ON s.id = ce.student_id LEFT JOIN grades g ON g.id = c.grade_id
      WHERE c.institution_id = $1 AND ce.status IN ('ACTIVE', 'PENDING')
      GROUP BY s.id, s.name, s.email
      ORDER BY s.name NULLS LAST, s.email`,
    [institutionId]
  );
  return r.rows.map((x: any) => ({
    studentId: x.id,
    name: x.name,
    email: x.email,
    enrollments: x.enrollments,
    status: (x.enrollments as any[]).some((e) => e.status === 'ACTIVE') ? 'ACTIVE' : 'PENDING',
  }));
}

async function activeClassOf(institutionId: string, classId: string) {
  const c = await classOf(institutionId, classId);
  if (c.status === 'ARCHIVED') throw new InstitutionOpsError('CLASS_ARCHIVED');
  return c;
}
/** Already an ACTIVE student of this institution (consented to a class of it before). */
async function isInstitutionStudent(institutionId: string, studentId: string) {
  const r = await db.query(`SELECT 1 FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE ce.student_id = $1 AND c.institution_id = $2 AND ce.status = 'ACTIVE' LIMIT 1`, [studentId, institutionId]);
  return r.rows.length > 0;
}
async function enrollActive(classId: string, studentId: string, actorUserId: string) {
  const r = await db.query(
    `INSERT INTO class_enrollments (class_id, student_id, status, invited_by_user_id, responded_at) VALUES ($1, $2, 'ACTIVE', $3, now())
     ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'ACTIVE', ended_at = NULL, responded_at = now()
       WHERE class_enrollments.status IN ('DECLINED', 'ENDED', 'PENDING')
     RETURNING id`,
    [classId, studentId, actorUserId]
  );
  if (!r.rows[0]) throw new InstitutionOpsError('ALREADY_ENROLLED');
  return r.rows[0].id as string;
}

/**
 * "Añadir estudiante" by email to a class. Never creates a Student:
 *   - a student of THIS institution already -> enrolled ACTIVE directly in the class;
 *   - any other existing student -> invited (PENDING until they accept: consent);
 *   - no student account -> NO_STUDENT_ACCOUNT.
 */
export async function addStudentToClass(institutionId: string, classId: string, email: string, actorUserId: string): Promise<{ outcome: 'ENROLLED' | 'INVITED'; studentId: string | null }> {
  const klass = await activeClassOf(institutionId, classId);
  const student = (await db.query(
    `SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE (lower(u.email) = lower($1) OR lower(s.email) = lower($1)) AND u.status = 'ACTIVE' ORDER BY s.created_at LIMIT 1`,
    [email.trim()]
  )).rows[0];
  if (!student) throw new InstitutionOpsError('NO_STUDENT_ACCOUNT');
  const existing = (await db.query(`SELECT status FROM class_enrollments WHERE class_id = $1 AND student_id = $2`, [classId, student.id])).rows[0];
  if (existing?.status === 'ACTIVE' || existing?.status === 'PENDING') throw new InstitutionOpsError('ALREADY_ENROLLED');
  if (await isInstitutionStudent(institutionId, student.id)) {
    const enrollmentId = await enrollActive(classId, student.id, actorUserId);
    await audit(institutionId, actorUserId, 'ENROLLMENT', enrollmentId, 'STUDENT_ENROLLED', {}, { classId, studentId: student.id, via: 'INSTITUTION_STUDENT' });
    return { outcome: 'ENROLLED', studentId: student.id };
  }
  const invited = await inviteToClassAndNotify(institutionId, { id: klass.id, name: klass.name }, email, actorUserId);
  if (invited.outcome === 'NO_STUDENT_ACCOUNT') throw new InstitutionOpsError('NO_STUDENT_ACCOUNT');
  if (invited.outcome !== 'INVITED') throw new InstitutionOpsError('ALREADY_ENROLLED');
  await audit(institutionId, actorUserId, 'ENROLLMENT', invited.enrollmentId, 'STUDENT_INVITED', {}, { classId, studentId: student.id });
  return { outcome: 'INVITED', studentId: student.id };
}

/** Enroll an institution student (ACTIVE elsewhere in this institution) in one more class. */
export async function enrollInstitutionStudent(institutionId: string, studentId: string, classId: string, actorUserId: string) {
  await activeClassOf(institutionId, classId);
  if (!(await isInstitutionStudent(institutionId, studentId))) throw new InstitutionOpsError('NOT_FOUND'); // cross-tenant / not a student here
  const enrollmentId = await enrollActive(classId, studentId, actorUserId);
  await audit(institutionId, actorUserId, 'ENROLLMENT', enrollmentId, 'STUDENT_ENROLLED', {}, { classId, studentId, via: 'INSTITUTION_STUDENT' });
  return { enrollmentId };
}

/** Move between classes of THIS institution: the old enrollment is ENDED (history kept), the new one ACTIVE. */
export async function moveStudent(institutionId: string, studentId: string, fromClassId: string, toClassId: string, actorUserId: string) {
  if (fromClassId === toClassId) throw new InstitutionOpsError('SAME_CLASS');
  await classOf(institutionId, fromClassId);
  await activeClassOf(institutionId, toClassId);
  const from = (await db.query(`SELECT id FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`, [fromClassId, studentId])).rows[0];
  if (!from) throw new InstitutionOpsError('NOT_ENROLLED');
  const toId = await enrollActive(toClassId, studentId, actorUserId);
  await endClassEnrollment(institutionId, fromClassId, from.id);
  await audit(institutionId, actorUserId, 'ENROLLMENT', toId, 'STUDENT_MOVED', { classId: fromClassId, enrollmentId: from.id }, { classId: toClassId, enrollmentId: toId, studentId });
  return { fromEnrollmentId: from.id, toEnrollmentId: toId };
}

export async function removeStudentFromClass(institutionId: string, classId: string, enrollmentId: string, actorUserId: string) {
  await classOf(institutionId, classId);
  const ok = await endClassEnrollment(institutionId, classId, enrollmentId);
  if (!ok) throw new InstitutionOpsError('NOT_ENROLLED');
  await audit(institutionId, actorUserId, 'ENROLLMENT', enrollmentId, 'STUDENT_REMOVED_FROM_CLASS', { status: 'ACTIVE' }, { status: 'ENDED', classId });
  return { enrollmentId };
}

// ============================================================================ coordinators

/** Reactivate a REMOVED coordinator of this institution (an account whose platform role was revoked cannot). */
export async function reactivateCoordinator(institutionId: string, membershipId: string, actorUserId: string) {
  const m = (await db.query(`SELECT id, user_id, status FROM institution_memberships WHERE id = $1 AND institution_id = $2 AND membership_role = 'INSTITUTION_ADMIN'`, [membershipId, institutionId])).rows[0];
  if (!m) throw new InstitutionOpsError('NOT_FOUND');
  if (m.status === 'APPROVED') return { membershipId, changed: false };
  if (m.status !== 'REVOKED') throw new InstitutionOpsError('INVALID_STATE');
  const revoked = await db.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'INSTITUTION_ADMIN' AND status = 'REVOKED'`, [m.user_id]);
  if (revoked.rows[0]) throw new InstitutionOpsError('ROLE_REVOKED');
  await inviteInstitutionAdmin(institutionId, m.user_id);
  await audit(institutionId, actorUserId, 'COORDINATOR', membershipId, 'COORDINATOR_REACTIVATED', { status: 'REVOKED' }, { status: 'APPROVED' });
  return { membershipId, changed: true };
}

// ============================================================================ setup progress

export interface SetupProgress {
  grades: number;
  curricula: number;
  classes: number;
  teachers: number;
  students: number;
  steps: Array<{ key: 'grades' | 'curriculum' | 'classes' | 'teachers' | 'students'; done: boolean }>;
  complete: boolean;
  empty: boolean;
}

export async function getSetupProgress(institutionId: string): Promise<SetupProgress> {
  const r = (await db.query(
    `SELECT (SELECT COUNT(*) FROM grades WHERE institution_id = $1 AND status = 'ACTIVE')::int AS grades,
            (SELECT COUNT(*) FROM institution_curricula WHERE institution_id = $1 AND status = 'ACTIVE')::int AS curricula,
            (SELECT COUNT(*) FROM classes WHERE institution_id = $1 AND status = 'ACTIVE')::int AS classes,
            (SELECT COUNT(*) FROM institution_memberships WHERE institution_id = $1 AND membership_role = 'TEACHER' AND status IN ('APPROVED', 'INVITED'))::int AS teachers,
            (SELECT COUNT(DISTINCT ce.student_id) FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE c.institution_id = $1 AND ce.status IN ('ACTIVE', 'PENDING'))::int AS students`,
    [institutionId]
  )).rows[0];
  const steps: SetupProgress['steps'] = [
    { key: 'grades', done: r.grades > 0 },
    { key: 'curriculum', done: r.curricula > 0 },
    { key: 'classes', done: r.classes > 0 },
    { key: 'teachers', done: r.teachers > 0 },
    { key: 'students', done: r.students > 0 },
  ];
  return { ...r, steps, complete: steps.every((s) => s.done), empty: steps.every((s) => !s.done) };
}

/** Catalog programmes a grade can name (authority · programme). */
export async function listProgrammeOptions(): Promise<Array<{ id: string; name: string }>> {
  const r = await db.query(
    `SELECT p.id, p.name, o.name AS authority FROM academic_programmes p JOIN academic_organizations o ON o.id = p.organization_id WHERE p.status = 'ACTIVE' ORDER BY o.name, p.name`
  );
  return r.rows.map((x: any) => ({ id: x.id, name: x.authority && !String(x.name).includes(x.authority) ? `${x.authority} · ${x.name}` : x.name }));
}

/**
 * Student detail permitted to the institution: its own enrollments, the academic profile and how
 * many concepts THIS institution placed in the student's plan (counts only -- never answers,
 * evidence or another institution's data). Not a student of this institution -> NOT_FOUND.
 */
export async function getInstitutionStudentDetail(institutionId: string, studentId: string) {
  const row = (await listInstitutionStudents(institutionId)).find((s) => s.studentId === studentId);
  if (!row) throw new InstitutionOpsError('NOT_FOUND');
  const [profile, concepts] = await Promise.all([
    db.query(`SELECT country_of_study, school_year, curriculum_type, academic_year FROM student_academic_profile WHERE student_id = $1`, [studentId]).catch(() => ({ rows: [] as any[] })),
    db.query(`SELECT COUNT(DISTINCT canonical_concept_id)::int AS n FROM student_concept_sources WHERE student_id = $1 AND institution_id = $2 AND active = true`, [studentId, institutionId]).catch(() => ({ rows: [{ n: 0 }] as any[] })),
  ]);
  const p = profile.rows[0];
  return { ...row, profile: p ? { country: p.country_of_study, schoolYear: p.school_year, curriculumType: p.curriculum_type, academicYear: p.academic_year } : null, institutionConcepts: concepts.rows[0]?.n ?? 0 };
}
