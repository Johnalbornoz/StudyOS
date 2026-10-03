/**
 * Foundation (Roles E2E + Exam Core) -- functional scenarios 1-6 and the
 * authorization matrix (§24/§26), run with the REAL services against the
 * REAL DEV database. DEV ONLY: refuses unless the DB fingerprint is the
 * official DEV one. Creates clearly-marked fixtures (clerk ids `fdn-…`,
 * emails `@foundation.test`) and removes every one of them at the end, then
 * proves nothing was left behind.
 *
 *   npx tsx --env-file=.env.neon-dev scripts/operations/foundation-scenarios.ts
 *
 * Two creation paths call Clerk's currentUser() (request-scoped) and cannot
 * run in a script: getOrCreateStudentId's and getOrCreateParentId's creation
 * branches. Their rows are pre-created exactly as those functions would
 * (upsertStudentFromWebhook / a linked parent profile), so the real services
 * below exercise their existing-row paths.
 */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole, resolveAvailableWorkspaces, resolveDefaultWorkspace, getUserRoles } from '@/lib/identity';
import { upsertStudentFromWebhook, getOrCreateStudentId, getOrCreateParentId, verifyStudentAccess, StudentRoleRequiredError } from '@/lib/auth';
import { canAccessLearner, isActiveParentOf, canTeacherAccessLearner, canAccessInstitution, canAccessClass } from '@/lib/authorization';
import { inviteParentByEmail, acceptParentInvitation } from '@/services/parent.service';
import { createInstitution, inviteInstitutionAdmin, requestTeacherMembership, decideMembership, createGrade, createClass, enrollStudent, createTeacherAssignment } from '@/services/institution.service';
import { createExamDefinition, createExamVersion, publishExamVersion } from '@/lib/assessment/exam-definition.service';
import { createStudentExamProfile, isExamProfileOwnedByStudent, isExamVersionStartableForProfile } from '@/lib/assessment/student-exam-profile.service';

const DEV_FP = '2a29b99ee14a22b4';
const CLEANUP_ONLY = process.env.FDN_CLEANUP_RUN ?? null; // re-run cleanup for a previous run id
const RUN = CLEANUP_ONLY ?? randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => results.push({ id, ok, detail });
const created = { users: [] as string[], institutions: [] as string[], examDefinitions: [] as string[] };

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function person(tag: string) {
  const clerk = `fdn-${RUN}-${tag}`;
  const user = await getOrCreateCanonicalUser(clerk, `${tag}-${RUN}@foundation.test`);
  created.users.push(user.id);
  return { clerk, user };
}
async function studentRow(clerk: string, tag: string) {
  return upsertStudentFromWebhook(clerk, `${tag}-${RUN}@foundation.test`, `Foundation ${tag}`);
}
async function parentProfile(clerk: string, userId: string) {
  // Exactly what getOrCreateParentId's creation branch inserts (it needs Clerk's currentUser otherwise).
  await db.query(`INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Foundation parent', $1, $2)`, [clerk, userId]);
  return getOrCreateParentId(clerk); // real existing-row path
}
const count = async (sql: string, params: unknown[]) => Number((await db.query(sql, params)).rows[0]?.n ?? 0);

async function main() {
  if (fingerprint() !== DEV_FP) throw new Error(`REFUSING: not the DEV database (${fingerprint()})`);
  console.log(`foundation scenarios -- DEV ${DEV_FP} -- run ${RUN}`);

  // ---------------- SCENARIO 1: MULTI-ROLE ----------------
  const s1 = await person('s1');
  const s1Student = await studentRow(s1.clerk, 's1');
  check('S1.student-role', (await assignSelfServiceRole(s1.clerk, s1.user.id, 'STUDENT')) === 'GRANTED');
  check('S1.add-parent', (await assignSelfServiceRole(s1.clerk, s1.user.id, 'PARENT')) === 'GRANTED');
  check('S1.idempotent', (await assignSelfServiceRole(s1.clerk, s1.user.id, 'PARENT')) === 'ALREADY_ACTIVE');
  check('S1.same-user', (await getOrCreateCanonicalUser(s1.clerk)).id === s1.user.id);
  check('S1.one-users-row', (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id = $1`, [s1.clerk])) === 1);
  check('S1.one-student-row', (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id = $1`, [s1.clerk])) === 1);
  check('S1.student-reused', (await getOrCreateStudentId(s1.clerk)) === s1Student);
  const s1Roles = (await getUserRoles(s1.user.id)).map((r) => r.role).sort();
  check('S1.roles-coexist', JSON.stringify(s1Roles) === JSON.stringify(['PARENT', 'STUDENT']), s1Roles.join(','));
  check('S1.workspaces', JSON.stringify((await resolveAvailableWorkspaces(s1.user.id)).sort()) === JSON.stringify(['PARENT', 'STUDENT']));
  check('S1.audited', (await count(`SELECT COUNT(*) n FROM admin_audit_log WHERE actor_user_id = $1 AND action = 'ROLE_ADDED'`, [s1.user.id])) === 2);

  // Gate: an identity without STUDENT never gets a students row created.
  const noRole = await person('norole');
  let gated = false;
  try { await getOrCreateStudentId(noRole.clerk); } catch (e) { gated = e instanceof StudentRoleRequiredError; }
  check('S1.no-silent-student', gated && (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id = $1`, [noRole.clerk])) === 0);

  // Revoked role is not silently re-granted.
  await db.query(`UPDATE user_roles SET status = 'REVOKED', revoked_at = NOW() WHERE user_id = $1 AND role = 'PARENT'`, [s1.user.id]);
  check('S1.revoked-not-regranted', (await assignSelfServiceRole(s1.clerk, s1.user.id, 'PARENT')) === 'REVOKED');
  check('S1.revoked-stays', (await count(`SELECT COUNT(*) n FROM user_roles WHERE user_id = $1 AND role = 'PARENT' AND status = 'REVOKED'`, [s1.user.id])) === 1);

  // ---------------- SCENARIO 2: ADMIN + STUDENT ----------------
  const adm = await person('admin');
  await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'STUDYUS_ADMIN', 'ACTIVE', 'BACKFILL')`, [adm.user.id]);
  const admStudent = await studentRow(adm.clerk, 'admin');
  check('S2.admin-only-sees-admin', JSON.stringify(await resolveAvailableWorkspaces(adm.user.id)) === JSON.stringify(['ADMIN']));
  check('S2.add-student-on-admin', (await assignSelfServiceRole(adm.clerk, adm.user.id, 'STUDENT')) === 'GRANTED');
  check('S2.both-workspaces', JSON.stringify((await resolveAvailableWorkspaces(adm.user.id)).sort()) === JSON.stringify(['ADMIN', 'STUDENT']));
  check('S2.default-student', (await resolveDefaultWorkspace(adm.user.id)) === 'STUDENT');
  check('S2.admin-kept', (await getUserRoles(adm.user.id)).some((r) => r.role === 'STUDYUS_ADMIN'));
  check('S2.no-duplicate', (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id = $1`, [adm.clerk])) === 1 && (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id = $1`, [adm.clerk])) === 1);
  check('S2.admin-not-owner-of-others', (await verifyStudentAccess(adm.clerk, s1Student, 'admin')) === false); // session-claim admin grants nothing
  check('S2.owner-still-owner', (await verifyStudentAccess(adm.clerk, admStudent, 'admin')) === true);

  // ---------------- SCENARIO 3: PARENT SECURITY ----------------
  const stA = await person('studentA');
  const studentA = await studentRow(stA.clerk, 'studentA');
  await assignSelfServiceRole(stA.clerk, stA.user.id, 'STUDENT');
  const stB = await person('studentB');
  const studentB = await studentRow(stB.clerk, 'studentB');
  await assignSelfServiceRole(stB.clerk, stB.user.id, 'STUDENT');
  const par = await person('parentA');
  await assignSelfServiceRole(par.clerk, par.user.id, 'PARENT');
  const parentProfileId = await parentProfile(par.clerk, par.user.id);
  const parentEmail = `parentA-${RUN}@foundation.test`;
  const invitation = await inviteParentByEmail(studentA, parentEmail);
  check('S3.pending-no-access', !(await isActiveParentOf(par.user.id, studentA)) && !(await canAccessLearner(par.user.id, studentA, 'LEARNER_PROGRESS_VIEW')));
  check('S3.wrong-email-cannot-accept', (await acceptParentInvitation(invitation.id, parentProfileId, `intruder-${RUN}@foundation.test`)) === false);
  check('S3.accept', (await acceptParentInvitation(invitation.id, parentProfileId, parentEmail)) === true);
  check('S3.accepted-reads-A', await canAccessLearner(par.user.id, studentA, 'LEARNER_PROGRESS_VIEW'));
  check('S3.parent-cannot-write-A', !(await canAccessLearner(par.user.id, studentA, 'LEARNER_INTERVENTION_CREATE')));
  check('S3.parent-A-not-B', !(await canAccessLearner(par.user.id, studentB, 'LEARNER_PROGRESS_VIEW')) && !(await isActiveParentOf(par.user.id, studentB)));
  check('S3.parent-not-via-student-guard', (await verifyStudentAccess(par.clerk, studentA, 'parent' as any)) === false);
  check('S3.student-B-not-A', !(await canAccessLearner(stB.user.id, studentA, 'LEARNER_PROGRESS_VIEW')) && (await verifyStudentAccess(stB.clerk, studentA, 'student')) === false);

  // ---------------- SCENARIO 4: TEACHER / INSTITUTION ----------------
  const inst1 = await createInstitution(`Foundation Inst 1 ${RUN}`);
  const inst2 = await createInstitution(`Foundation Inst 2 ${RUN}`);
  created.institutions.push(inst1.id, inst2.id);
  await db.query(`UPDATE institutions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [[inst1.id, inst2.id]]);
  const ia1 = await person('instadmin1');
  await inviteInstitutionAdmin(inst1.id, ia1.user.id);
  const g1 = await createGrade(inst1.id, '10');
  const cA = await createClass(inst1.id, g1.id, 'Class A');
  const g2 = await createGrade(inst2.id, '10');
  const cB = await createClass(inst2.id, g2.id, 'Class B');
  await enrollStudent(cA.id, studentA);
  await enrollStudent(cB.id, studentB);
  const tch = await person('teacher');
  await assignSelfServiceRole(tch.clerk, tch.user.id, 'TEACHER');
  const membership = await requestTeacherMembership(inst1.id, tch.user.id);
  check('S4.pending-membership', membership.status === 'PENDING');
  check('S4.pending-no-access', !(await canTeacherAccessLearner(tch.user.id, studentA)));
  check('S4.approve', await decideMembership(membership.id, ia1.user.id, 'APPROVED'));
  check('S4.approved-no-assignment-no-access', !(await canTeacherAccessLearner(tch.user.id, studentA)));
  let crossTenant = '';
  try { await createTeacherAssignment(membership.id, { classId: cB.id }); crossTenant = 'CREATED'; } catch (e) { crossTenant = (e as Error).message; }
  check('S4.cross-tenant-assignment-refused', crossTenant === 'SCOPE_OUTSIDE_INSTITUTION', crossTenant);
  let crossGrade = '';
  try { await createTeacherAssignment(membership.id, { gradeId: g2.id }); crossGrade = 'CREATED'; } catch (e) { crossGrade = (e as Error).message; }
  check('S4.cross-tenant-grade-refused', crossGrade === 'SCOPE_OUTSIDE_INSTITUTION', crossGrade);
  check('S4.no-cross-rows', (await count(`SELECT COUNT(*) n FROM teacher_assignments WHERE institution_membership_id = $1`, [membership.id])) === 0);
  await createTeacherAssignment(membership.id, { classId: cA.id, subjectLabel: 'Math' });
  check('S4.authorized-class-A', await canTeacherAccessLearner(tch.user.id, studentA));
  check('S4.not-student-outside-class', !(await canTeacherAccessLearner(tch.user.id, studentB)));
  check('S4.class-A-yes-class-B-no', (await canAccessClass(tch.user.id, cA.id, 'TEACHER_ASSIGNMENT_MANAGE')) && !(await canAccessClass(tch.user.id, cB.id, 'TEACHER_ASSIGNMENT_MANAGE')));
  check('S4.teacher-not-inst-B', !(await canAccessInstitution(tch.user.id, inst2.id, 'INSTITUTION_INTELLIGENCE_VIEW')));
  check('S4.inst-A-not-inst-B', (await canAccessInstitution(ia1.user.id, inst1.id, 'INSTITUTION_INTELLIGENCE_VIEW')) && !(await canAccessInstitution(ia1.user.id, inst2.id, 'INSTITUTION_INTELLIGENCE_VIEW')));
  check('S4.inst-admin-no-learner-access', !(await canAccessLearner(ia1.user.id, studentA, 'LEARNER_PROGRESS_VIEW')));
  check('S4.teacher-cannot-write-evidence', (await verifyStudentAccess(tch.clerk, studentA, 'teacher')) === false); // record-evidence guard
  check('S4.teacher-cannot-start-for-learner', !(await canAccessLearner(tch.user.id, studentA, 'LEARNER_INTERVENTION_CREATE')));

  // ---------------- SCENARIO 5: EXAM OWNERSHIP / VERSION INTEGRITY ----------------
  const def1 = await createExamDefinition({ name: `Foundation Exam ${RUN}`, examFamily: 'PAA' });
  const def2 = await createExamDefinition({ name: `Foundation Exam other ${RUN}`, examFamily: 'PAA' });
  created.examDefinitions.push(def1.id, def2.id);
  const v1 = await createExamVersion({ examDefinitionId: def1.id, versionLabel: 'v1' });
  const vOther = await createExamVersion({ examDefinitionId: def2.id, versionLabel: 'v1' });
  await publishExamVersion(vOther.id);
  const profileA = await createStudentExamProfile({ studentId: studentA, examDefinitionId: def1.id });
  check('S5.profile-owned-by-A', await isExamProfileOwnedByStudent(profileA.id, studentA));
  check('S5.profile-not-B', !(await isExamProfileOwnedByStudent(profileA.id, studentB)));
  check('S5.draft-not-startable', !(await isExamVersionStartableForProfile(profileA.id, v1.id)));
  check('S5.other-exam-not-startable', !(await isExamVersionStartableForProfile(profileA.id, vOther.id)));
  await publishExamVersion(v1.id);
  check('S5.published-startable', await isExamVersionStartableForProfile(profileA.id, v1.id));
  check('S5.B-cannot-act-on-A-attempt', !(await canAccessLearner(stB.user.id, studentA, 'LEARNER_INTERVENTION_CREATE'))); // the check every /attempts/[id] write route runs on attempt.studentId
  check('S5.A-owns-A', await canAccessLearner(stA.user.id, studentA, 'LEARNER_INTERVENTION_CREATE'));

  // ---------------- SCENARIO 6: EXAM EVIDENCE BOUNDARY ----------------
  const evBefore = await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [[studentA, studentB]]);
  const mastBefore = await count(`SELECT COUNT(*) n FROM mastery_records WHERE student_id = ANY($1::uuid[])`, [[studentA, studentB]]);
  // Spoof attempts through every non-owner guard of the evidence write path (record-evidence / cognitive submit routes use verifyStudentAccess):
  const spoofs = [
    await verifyStudentAccess(stB.clerk, studentA, 'student'),
    await verifyStudentAccess(tch.clerk, studentA, 'teacher'),
    await verifyStudentAccess(adm.clerk, studentA, 'admin'),
    await verifyStudentAccess(par.clerk, studentA, 'parent' as any),
  ];
  check('S6.spoofed-evidence-writers-refused', spoofs.every((x) => x === false), JSON.stringify(spoofs));
  check('S6.no-cognitive-writes', evBefore === 0 && mastBefore === 0 && (await count(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [[studentA, studentB]])) === 0);
}

async function cleanup() {
  if (fingerprint() !== DEV_FP) throw new Error('REFUSING cleanup: not the DEV database');
  // Resolve every fixture by its run marker (also works for a previous, interrupted run).
  const userIds = Array.from(new Set([...created.users, ...(await db.query(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`fdn-${RUN}-%`])).rows.map((r: any) => r.id)]));
  created.institutions = Array.from(new Set([...created.institutions, ...(await db.query(`SELECT id FROM institutions WHERE name LIKE $1`, [`Foundation Inst % ${RUN}`])).rows.map((r: any) => r.id)]));
  created.examDefinitions = Array.from(new Set([...created.examDefinitions, ...(await db.query(`SELECT id FROM exam_definitions WHERE name IN ($1, $2)`, [`Foundation Exam ${RUN}`, `Foundation Exam other ${RUN}`])).rows.map((r: any) => r.id)]));
  const studentIds = (await db.query(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`fdn-${RUN}-%`])).rows.map((r: any) => r.id);
  const profileIds = (await db.query(`SELECT id FROM profiles WHERE id = ANY($1::uuid[]) OR clerk_id LIKE $2 OR user_id = ANY($3::uuid[])`, [studentIds, `fdn-${RUN}-%`, userIds])).rows.map((r: any) => r.id);
  const q = (sql: string, p: unknown[]) => db.query(sql, p);
  await q(`DELETE FROM teacher_assignments WHERE institution_membership_id IN (SELECT id FROM institution_memberships WHERE institution_id = ANY($1::uuid[]))`, [created.institutions]);
  await q(`DELETE FROM class_enrollments WHERE class_id IN (SELECT id FROM classes WHERE institution_id = ANY($1::uuid[]))`, [created.institutions]);
  await q(`DELETE FROM classes WHERE institution_id = ANY($1::uuid[])`, [created.institutions]);
  await q(`DELETE FROM grades WHERE institution_id = ANY($1::uuid[])`, [created.institutions]);
  await q(`DELETE FROM institution_memberships WHERE institution_id = ANY($1::uuid[])`, [created.institutions]);
  await q(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [created.institutions]);
  await q(`DELETE FROM student_exam_profiles WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  await q(`DELETE FROM exam_versions WHERE exam_definition_id = ANY($1::uuid[])`, [created.examDefinitions]);
  await q(`DELETE FROM exam_definitions WHERE id = ANY($1::uuid[])`, [created.examDefinitions]);
  await q(`DELETE FROM parent_student_relationships WHERE student_id = ANY($1::uuid[]) OR parent_id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM parent_invitations WHERE student_id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [userIds, userIds]);
  await q(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
  // Every remaining row that references a fixture profile / student (e.g. the
  // notification an accepted parent invitation creates) -- resolved from the FK
  // graph so nothing a scenario created can be missed.
  const refs = (await db.query(
    `SELECT conrelid::regclass::text AS t, a.attname AS c, confrelid::regclass::text AS parent
     FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND confrelid::regclass::text IN ('profiles', 'students') AND array_length(con.conkey, 1) = 1
       AND conrelid::regclass::text NOT IN ('profiles', 'students')`
  )).rows as { t: string; c: string; parent: string }[];
  for (const r of refs) {
    await q(`DELETE FROM ${r.t} WHERE ${r.c} = ANY($1::uuid[])`, [r.parent === 'students' ? studentIds : profileIds]);
  }
  await q(`DELETE FROM student_profiles WHERE id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM user_language_preferences WHERE user_id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM mastery_records WHERE student_id = ANY($1::uuid[])`, [studentIds]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [profileIds]);
  await q(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [studentIds]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  const left =
    (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id LIKE $1`, [`fdn-${RUN}-%`])) +
    (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id LIKE $1`, [`fdn-${RUN}-%`])) +
    (await count(`SELECT COUNT(*) n FROM profiles WHERE clerk_id LIKE $1`, [`fdn-${RUN}-%`])) +
    (await count(`SELECT COUNT(*) n FROM institutions WHERE name LIKE $1`, [`Foundation Inst % ${RUN}`])) +
    (await count(`SELECT COUNT(*) n FROM exam_definitions WHERE name LIKE $1`, [`Foundation Exam % ${RUN}`])) +
    (await count(`SELECT COUNT(*) n FROM exam_definitions WHERE name = $1`, [`Foundation Exam ${RUN}`])) +
    (await count(`SELECT COUNT(*) n FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]));
  check('CLEANUP.no-fixtures-left', left === 0, `remaining=${left}`);
}

(CLEANUP_ONLY ? Promise.resolve() : main())
  .catch((e) => check('RUN.error', false, e instanceof Error ? e.message : String(e)))
  .then(() => cleanup().catch((e) => check('CLEANUP.error', false, e instanceof Error ? e.message : String(e))))
  .finally(async () => {
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.detail ? '  [' + r.detail + ']' : ''}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    await (db as any).end?.();
    process.exitCode = failed ? 1 : 0;
  });
