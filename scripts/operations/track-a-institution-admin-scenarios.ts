/**
 * Track A -- Institution workspace: core administration, DEV scenarios with the REAL services
 * against the REAL DEV database (spec §18 + validation, security, audit).
 *
 *   1 create grade  2 configure curriculum  3 create class  4 bind curriculum (explicit)
 *   5 invite teacher  6 teacher accepts / request approved  7 assign teacher to class
 *   8 invite student  9 student accepts  10 enroll in class  11 teacher sees class
 *   12 teacher sees student  13 institution counts  14 archive class  15 history preserved
 *   + validation (no class without grade, foreign grade / curriculum / teacher / student,
 *     duplicate enrollment / class name, hard delete with dependencies), suspend / reactivate,
 *     move student, coordinator rules (last coordinator, reactivate), permissions, audit.
 *
 * DEV ONLY (fingerprint guard). Fixtures (`taia-<run>-…`, `@tracka.test`, institutions
 * "TA Admin <run> …") are removed at the end.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-institution-admin-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { canAccessInstitution } from '@/lib/authorization';
import { createInstitution, inviteInstitutionAdmin, requestTeacherMembership, decideMembership, respondToClassInvitation, listInstitutionClassesWithStaff } from '@/services/institution.service';
import { removeCoordinator } from '@/services/institution-admin.service';
import { getTeacherAssignedClasses, getTeacherClassRoster } from '@/lib/teacher/read-model.service';
import { addInstitutionCurriculumSubjects, listCurriculumSourceOptions, assignClassCurriculum } from '@/lib/institution/curriculum-management.service';
import {
  createGradeV2, updateGrade, archiveGrade, reactivateGrade, deleteGrade, listGrades,
  createClassV2, updateClassV2, archiveClass, reactivateClass, setClassTeacher,
  inviteTeacher, respondTeacherInvitation, suspendTeacher, reactivateTeacher, listTeachers,
  addStudentToClass, enrollInstitutionStudent, moveStudent, listInstitutionStudents,
  reactivateCoordinator, getSetupProgress, InstitutionOpsError,
} from '@/lib/institution/institution-operations.service';

const DEV_FP = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV_FP) throw new Error(`REFUSING: not the DEV database (${fp})`);
  return fp;
}
const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p))?.n ?? 0);
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    return false;
  } catch (e: any) {
    return (e instanceof InstitutionOpsError && e.code === code) || e?.code === code || e?.message === code;
  }
}

async function person(tag: string, role: 'TEACHER' | 'STUDENT' | 'COORD') {
  const clerk = `taia-${RUN}-${tag}`;
  const email = `ia-${tag}-${RUN}@tracka.test`;
  const user = await getOrCreateCanonicalUser(clerk, email);
  let studentId: string | null = null;
  if (role === 'TEACHER') await assignSelfServiceRole(clerk, user.id, 'TEACHER');
  if (role === 'STUDENT') {
    studentId = await upsertStudentFromWebhook(clerk, email, `TA Admin ${tag}`);
    await assignSelfServiceRole(clerk, user.id, 'STUDENT');
  }
  return { user, email, studentId };
}

async function main() {
  console.log(`track-a institution admin scenarios -- db ${guard()} -- run ${RUN}`);
  const coord = await person('coord', 'COORD');
  const coord2 = await person('coord2', 'COORD');
  const teacher = await person('teacher', 'TEACHER');
  const teacher2 = await person('teacher2', 'TEACHER');
  const student = await person('student', 'STUDENT');
  const student2 = await person('student2', 'STUDENT');
  const X = await createInstitution(`TA Admin ${RUN} X`);
  const Y = await createInstitution(`TA Admin ${RUN} Y`);
  const mCoord = await inviteInstitutionAdmin(X.id, coord.user.id);
  await inviteInstitutionAdmin(Y.id, coord.user.id);
  const actor = coord.user.id;
  check('SETUP.empty-institution-wizard', (await getSetupProgress(X.id)).empty);

  // 1 ----------------------------------------------------------------- grade
  const g = await createGradeV2(X.id, { name: '3ro Preparatoria', academicLevel: 'Preparatoria', programmeLabel: 'Cambridge AICE', academicYear: '2026-2027' }, actor);
  const gRow = (await listGrades(X.id)).find((x) => x.id === g.id);
  check('S1.create-grade', !!gRow && gRow.academicLevel === 'Preparatoria' && gRow.academicYear === '2026-2027' && gRow.status === 'ACTIVE');
  check('S1.duplicate-grade-refused', await rejects(() => createGradeV2(X.id, { name: '3ro preparatoria' }, actor), 'DUPLICATE_GRADE_NAME'));
  await updateGrade(X.id, g.id, { academicYear: '2026-2027 (A)' }, actor);
  check('S1.edit-grade', (await listGrades(X.id)).find((x) => x.id === g.id)?.academicYear === '2026-2027 (A)');
  const gY = await createGradeV2(Y.id, { name: 'Y grade' }, actor);

  // 2 ----------------------------------------------------------------- curriculum
  const opt = (await listCurriculumSourceOptions()).find((o) => o.code === '9709' && /^A Level/i.test(o.level ?? ''));
  if (!opt) throw new Error('no 9709 A Level on DEV');
  const [cur] = await addInstitutionCurriculumSubjects({ institutionId: X.id, actorUserId: actor, gradeId: g.id, academicYear: '2026', items: [{ academicSubjectId: opt.academicSubjectId, versionId: opt.versionId }] });
  const [curY] = await addInstitutionCurriculumSubjects({ institutionId: Y.id, actorUserId: actor, gradeId: gY.id, items: [{ academicSubjectId: opt.academicSubjectId, versionId: opt.versionId }] });
  check('S2.configure-curriculum', !!cur.curriculumId && cur.created);

  // 3/4 --------------------------------------------------------------- class + explicit binding
  check('V.class-without-grade-refused', await rejects(() => createClassV2(X.id, { name: 'Sin grado', gradeId: '' }, actor), 'GRADE_REQUIRED'));
  check('V.foreign-grade-refused', await rejects(() => createClassV2(X.id, { name: 'Foreign', gradeId: gY.id }, actor), 'NOT_FOUND'));
  check('V.foreign-curriculum-refused', await rejects(() => createClassV2(X.id, { name: 'Foreign cur', gradeId: g.id, institutionCurriculumId: curY.curriculumId }, actor), 'CURRICULUM_NOT_AVAILABLE'));
  const math = await createClassV2(X.id, { name: 'Math 3A', gradeId: g.id, academicDomainCode: 'MATHEMATICS', institutionCurriculumId: cur.curriculumId, period: '2026-2027' }, actor);
  const mrow = (await listInstitutionClassesWithStaff(X.id)).find((c) => c.id === math.id)!;
  check('S3.create-class', mrow.gradeId === g.id && mrow.academicDomain === 'MATHEMATICS' && mrow.period === '2026-2027' && mrow.status === 'ACTIVE');
  check('S4.curriculum-bound-explicitly', mrow.institutionCurriculumId === cur.curriculumId && (await n(`SELECT count(*) n FROM academic_governance_events WHERE object_id = $1 AND action = 'CLASS_CURRICULUM_ASSIGNED'`, [math.id])) === 1);
  check('V.duplicate-class-name-refused', await rejects(() => createClassV2(X.id, { name: 'math 3a', gradeId: g.id }, actor), 'DUPLICATE_CLASS_NAME'));
  const physics = await createClassV2(X.id, { name: 'Physics 3A', gradeId: g.id, academicDomainCode: 'PHYSICS' }, actor);
  check('V.other-domain-binding-refused', await rejects(() => assignClassCurriculum({ institutionId: X.id, classId: physics.id, curriculumId: cur.curriculumId, actorUserId: actor }), 'DOMAIN_MISMATCH'));
  await updateClassV2(X.id, physics.id, { name: 'Physics 3A (lab)', period: 'T1' }, actor);
  check('S3.edit-class', (await listInstitutionClassesWithStaff(X.id)).find((c) => c.id === physics.id)?.name === 'Physics 3A (lab)');

  // 5/6 --------------------------------------------------------------- teachers
  check('V.no-teacher-account', await rejects(() => inviteTeacher(X.id, `nobody-${RUN}@tracka.test`, actor), 'NO_TEACHER_ACCOUNT'));
  const inv = await inviteTeacher(X.id, teacher.email, actor);
  check('S5.invite-teacher', inv.status === 'INVITED' && (await listTeachers(X.id)).find((x) => x.membershipId === inv.membershipId)?.status === 'INVITED');
  check('V.invited-teacher-not-assignable', await rejects(() => setClassTeacher(X.id, math.id, inv.membershipId, actor), 'TEACHER_NOT_AVAILABLE'));
  check('SEC.other-user-cannot-accept', await rejects(() => respondTeacherInvitation(teacher2.user.id, inv.membershipId, true), 'NOT_FOUND'));
  await respondTeacherInvitation(teacher.user.id, inv.membershipId, true);
  check('S6.teacher-accepts-approved', (await listTeachers(X.id)).find((x) => x.membershipId === inv.membershipId)?.status === 'APPROVED');
  const req = await requestTeacherMembership(X.id, teacher2.user.id);
  await decideMembership(req.id, actor, 'APPROVED');
  check('S6.request-approved', (await listTeachers(X.id)).find((x) => x.membershipId === req.id)?.status === 'APPROVED');
  const mY = await requestTeacherMembership(Y.id, teacher2.user.id);
  await decideMembership(mY.id, actor, 'APPROVED');
  check('V.foreign-teacher-refused', await rejects(() => setClassTeacher(X.id, math.id, mY.id, actor), 'TEACHER_NOT_AVAILABLE'));

  // 7 ----------------------------------------------------------------- assign teacher
  await setClassTeacher(X.id, math.id, inv.membershipId, actor);
  const mrow2 = (await listInstitutionClassesWithStaff(X.id)).find((c) => c.id === math.id)!;
  check('S7.assign-teacher', mrow2.teachers.length === 1 && mrow2.teachers[0].userId === teacher.user.id);
  await setClassTeacher(X.id, physics.id, req.id, actor);
  await setClassTeacher(X.id, physics.id, inv.membershipId, actor);
  const prow = (await listInstitutionClassesWithStaff(X.id)).find((c) => c.id === physics.id)!;
  check('S7.change-teacher-atomic', prow.teachers.length === 1 && prow.teachers[0].userId === teacher.user.id);

  // 8/9/10 ------------------------------------------------------------ students
  check('V.no-student-account', await rejects(() => addStudentToClass(X.id, math.id, `nobody-${RUN}@tracka.test`, actor), 'NO_STUDENT_ACCOUNT'));
  const studentsBefore = await n(`SELECT count(*) n FROM students`);
  const s1 = await addStudentToClass(X.id, math.id, student.email, actor);
  check('S8.invite-student', s1.outcome === 'INVITED' && (await n(`SELECT count(*) n FROM students`)) === studentsBefore);
  const pending = await one(`SELECT id FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'PENDING'`, [math.id, student.studentId]);
  await respondToClassInvitation(student.studentId!, pending.id, true);
  check('S9.student-accepts', (await n(`SELECT count(*) n FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`, [math.id, student.studentId])) === 1);
  check('V.duplicate-enrollment-refused', await rejects(() => addStudentToClass(X.id, math.id, student.email, actor), 'ALREADY_ENROLLED'));
  const s2 = await addStudentToClass(X.id, physics.id, student.email, actor);
  check('S10.enroll-institution-student-direct', s2.outcome === 'ENROLLED' && (await n(`SELECT count(*) n FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`, [physics.id, student.studentId])) === 1);
  check('V.cross-tenant-student-refused', await rejects(() => enrollInstitutionStudent(Y.id, student.studentId!, physics.id, actor), 'NOT_FOUND'));
  check('V.non-institution-student-not-direct', await rejects(() => enrollInstitutionStudent(X.id, student2.studentId!, math.id, actor), 'NOT_FOUND'));

  // 11/12/13 ---------------------------------------------------------- teacher + institution views
  const tClasses = await getTeacherAssignedClasses(teacher.user.id);
  check('S11.teacher-sees-class', tClasses.some((c) => c.classId === math.id));
  const roster = await getTeacherClassRoster(teacher.user.id, math.id);
  check('S12.teacher-sees-student', roster.some((r) => r.studentId === student.studentId));
  const listed = await listInstitutionStudents(X.id);
  const progress = await getSetupProgress(X.id);
  check('S13.institution-counts', listed.some((s) => s.studentId === student.studentId && s.enrollments.length === 2) && progress.complete && progress.classes === 2 && progress.students === 1, JSON.stringify({ grades: progress.grades, classes: progress.classes, teachers: progress.teachers, students: progress.students }));

  // move / suspend ------------------------------------------------------
  const math2 = await createClassV2(X.id, { name: 'Math 3B', gradeId: g.id, academicDomainCode: 'MATHEMATICS' }, actor);
  await moveStudent(X.id, student.studentId!, physics.id, math2.id, actor);
  const moved = await db.query(`SELECT class_id, status FROM class_enrollments WHERE student_id = $1 ORDER BY class_id`, [student.studentId]);
  check('MOVE.history-kept', moved.rows.some((r: any) => r.class_id === physics.id && r.status === 'ENDED') && moved.rows.some((r: any) => r.class_id === math2.id && r.status === 'ACTIVE'));
  await suspendTeacher(X.id, inv.membershipId, actor);
  check('SUSPEND.no-class-access', !(await getTeacherAssignedClasses(teacher.user.id)).some((c) => c.classId === math.id) && (await listTeachers(X.id)).find((x) => x.membershipId === inv.membershipId)?.status === 'SUSPENDED');
  await reactivateTeacher(X.id, inv.membershipId, actor);
  check('SUSPEND.reactivated-access-back', (await getTeacherAssignedClasses(teacher.user.id)).some((c) => c.classId === math.id));

  // 14/15 ------------------------------------------------------------- archive + history
  const enrollBefore = await n(`SELECT count(*) n FROM class_enrollments WHERE class_id = $1`, [math.id]);
  check('V.archive-grade-with-active-classes-refused', await rejects(() => archiveGrade(X.id, g.id, actor), 'GRADE_HAS_ACTIVE_CLASSES'));
  check('V.delete-grade-with-classes-refused', await rejects(() => deleteGrade(X.id, g.id, actor), 'GRADE_HAS_DEPENDENCIES'));
  await archiveClass(X.id, math.id, actor);
  const arow = (await listInstitutionClassesWithStaff(X.id)).find((c) => c.id === math.id)!;
  check('S14.archive-class', arow.status === 'ARCHIVED' && !(await getTeacherAssignedClasses(teacher.user.id)).some((c) => c.classId === math.id));
  check('S15.history-preserved', (await n(`SELECT count(*) n FROM class_enrollments WHERE class_id = $1`, [math.id])) === enrollBefore && arow.institutionCurriculumId === cur.curriculumId && (await n(`SELECT count(*) n FROM teacher_assignments WHERE class_id = $1`, [math.id])) >= 1);
  check('V.archived-class-locked', await rejects(() => updateClassV2(X.id, math.id, { name: 'x' }, actor), 'CLASS_ARCHIVED'));
  await reactivateClass(X.id, math.id, actor);
  check('S15.reactivate-class', (await listInstitutionClassesWithStaff(X.id)).find((c) => c.id === math.id)?.status === 'ACTIVE');
  const empty = await createGradeV2(X.id, { name: `Vacío ${RUN}` }, actor);
  await archiveGrade(X.id, empty.id, actor);
  await reactivateGrade(X.id, empty.id, actor);
  await deleteGrade(X.id, empty.id, actor);
  check('GRADE.archive-reactivate-delete-empty', !(await listGrades(X.id, { includeArchived: true })).some((x) => x.id === empty.id));

  // coordinators ---------------------------------------------------------
  check('COORD.last-coordinator-protected', await rejects(() => removeCoordinator(X.id, mCoord.id, coord2.user.id, 'COORDINATOR'), 'LAST_COORDINATOR'));
  const m2 = await inviteInstitutionAdmin(X.id, coord2.user.id);
  await removeCoordinator(X.id, m2.id, actor, 'COORDINATOR');
  await reactivateCoordinator(X.id, m2.id, actor);
  check('COORD.reactivate', (await one(`SELECT status FROM institution_memberships WHERE id = $1`, [m2.id])).status === 'APPROVED');

  // permissions ----------------------------------------------------------
  check('PERM.coordinator', await canAccessInstitution(actor, X.id, 'TEACHER_ASSIGNMENT_MANAGE'));
  check('PERM.teacher-not-admin', !(await canAccessInstitution(teacher.user.id, X.id, 'TEACHER_ASSIGNMENT_MANAGE')));
  check('PERM.student-not-admin', !(await canAccessInstitution(student.user.id, X.id, 'TEACHER_ASSIGNMENT_MANAGE')));
  check('PERM.cross-tenant-ids', await rejects(() => archiveClass(Y.id, math.id, actor), 'NOT_FOUND') && (await rejects(() => updateGrade(Y.id, g.id, { name: 'x' }, actor), 'NOT_FOUND')) && (await rejects(() => suspendTeacher(Y.id, inv.membershipId, actor), 'NOT_FOUND')));

  // audit ----------------------------------------------------------------
  const actions = (await db.query(`SELECT DISTINCT action FROM academic_governance_events WHERE institution_id = $1`, [X.id])).rows.map((r: any) => r.action);
  const need = ['GRADE_CREATED', 'GRADE_UPDATED', 'GRADE_ARCHIVED', 'GRADE_DELETED', 'CLASS_CREATED', 'CLASS_UPDATED', 'CLASS_ARCHIVED', 'CLASS_REACTIVATED', 'CLASS_CURRICULUM_ASSIGNED', 'TEACHER_INVITED', 'TEACHER_INVITATION_ACCEPTED', 'TEACHER_ASSIGNED', 'TEACHER_SUSPENDED', 'TEACHER_REACTIVATED', 'STUDENT_INVITED', 'STUDENT_ENROLLED', 'STUDENT_MOVED', 'COORDINATOR_REACTIVATED'];
  const missing = need.filter((a) => !actions.includes(a));
  check('AUDIT.every-change-recorded', missing.length === 0, missing.join(',') || `${actions.length} actions`);
}

const childRefs = new Map<string, { t: string; c: string }[]>();
async function refsTo(table: string) {
  if (!childRefs.has(table)) {
    const rows = (await db.query(
      `SELECT conrelid::regclass::text AS t, a.attname AS c FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND confrelid::regclass::text = $1 AND array_length(con.conkey, 1) = 1 AND conrelid::regclass::text <> $1`,
      [table]
    )).rows as { t: string; c: string }[];
    childRefs.set(table, rows);
  }
  return childRefs.get(table)!;
}
async function deleteCascade(table: string, col: string, ids: string[], depth = 0): Promise<void> {
  if (ids.length === 0 || depth > 8) return;
  for (const ch of await refsTo(table)) {
    let rowIds: string[] = [];
    try {
      rowIds = (await db.query(`SELECT id::text AS id FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids])).rows.map((r: any) => r.id);
    } catch {
      rowIds = [];
    }
    await deleteCascade(ch.t, ch.c, rowIds, depth + 1);
  }
  await db.query(`DELETE FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids]);
}

async function cleanup() {
  guard();
  const ids = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows.map((r: any) => r.id as string);
  const inst = await ids(`SELECT id FROM institutions WHERE name LIKE $1`, [`TA Admin ${RUN} %`]);
  const userIds = await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`taia-${RUN}-%`]);
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`taia-${RUN}-%`]);
  for (let pass = 0; pass < 4; pass++) {
    try {
      await db.query(`DELETE FROM academic_governance_events WHERE institution_id = ANY($1::uuid[])`, [inst]);
      await db.query(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[])`, [userIds]).catch(() => undefined);
      await db.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [userIds, userIds]).catch(() => undefined);
      await deleteCascade('institutions', 'id', inst);
      await deleteCascade('students', 'id', studentIds);
      await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await deleteCascade('profiles', 'user_id', userIds);
      await deleteCascade('users', 'id', userIds);
      break;
    } catch (e) {
      if (pass === 3) throw e;
    }
  }
  const left = (await n(`SELECT count(*) n FROM institutions WHERE name LIKE $1`, [`TA Admin ${RUN} %`])) + (await n(`SELECT count(*) n FROM users WHERE clerk_id LIKE $1`, [`taia-${RUN}-%`]));
  check('CLEANUP.no-fixtures-left', left === 0, `remaining=${left}`);
}

main()
  .catch((e) => check('RUN.error', false, e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
  .then(() => cleanup().catch((e) => check('CLEANUP.error', false, e instanceof Error ? e.message : String(e))))
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await db.end();
    process.exitCode = failed.length ? 1 : 0;
  });
