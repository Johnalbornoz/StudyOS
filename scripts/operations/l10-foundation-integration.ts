/**
 * L10 SHARED FOUNDATION -- integration check against a REAL Postgres.
 *
 * Runs the real guards (src/lib/auth.ts, src/lib/authorization,
 * src/lib/exam-core/route-auth.ts), the real parent service and the L10
 * migrations' triggers against whatever DATABASE_URL points at.
 *
 * ONLY ever run through scripts/l10-ephemeral-db-test.sh, which builds a
 * throwaway local instance (baseline + every migration) and tears it down.
 * It INSERTS fixture rows, so it refuses to run unless the connection string
 * is a local Unix-socket one and L10_EPHEMERAL=1 is set.
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { verifyStudentAccess } from '@/lib/auth';
import { ownStudentId } from '@/lib/exam-core/route-auth';
import { resolveOwnedStudent } from '@/lib/identity/access-predicates';
import { loadAccountStatus, decideAccountGate } from '@/lib/identity/account-status-gate';
import { isOwner, isActiveParentOf, canTeacherAccessLearner, isCoordinatorOfLearner, canAccessLearner, canAccessInstitution, canAccessClass, resolveLearnerReadScope, resolveTeacherClassScope } from '@/lib/authorization';
import { getTeacherClassExamGaps, scopeExamGapsToSubject } from '@/lib/authorization/teacher-exam-scope';
import { teacherSubjectScopeForLearner } from '@/lib/authorization';
import { canonicalConceptsInSubjects, canonicalSubjectOfLearnerConcept, teacherMayReadLearnerConcept } from '@/lib/authorization/teacher-subject-scope';
import { isTransferTaskAlreadyGraded, runTransferSubmissionExclusively, transferSubmissionLockKey } from '@/services/transfer-task-instance.service';
import { launchLockId } from '@/services/activity-launch-lock.service';
import { canReadLearnerRoute } from '@/lib/authorization/teacher-subject-scope';
import { getTeacherStudentOverview } from '@/lib/teacher/read-model.service';
import { Client } from 'pg';
import { buildOperationKey } from '@/lib/algorithms/evidence-idempotency';
import { approveManualPayment, AdminControlledSubscriptionError } from '@/services/membership-admin.service';
import { getOrCreateStudentId, requireStudentId, StudentRoleRequiredError, authFailureOf } from '@/lib/auth';
import { isTeacherOfClass } from '@/lib/teacher/class-assignment.service';
import { getTeacherAssignedClasses, getTeacherClassRoster } from '@/lib/teacher/read-model.service';
import { addStudentToClass, enrollInstitutionStudent, InstitutionOpsError } from '@/lib/institution/institution-operations.service';
import { endClassEnrollment, enrollStudent, respondToClassInvitation, inviteStudentToClass, getClassEnrollmentState } from '@/services/institution.service';
import {
  verifyParentAccess,
  inviteParentByEmail,
  acceptParentInvitation,
  revokeRelationshipByStudent,
  endParentRelationshipByAdmin,
  listPendingInvitationsForEmail,
  requestChildLink,
  respondToRequest,
  ParentInvitationRefusedError,
  MAX_LINK_REQUESTS_PER_LEARNER,
} from '@/services/parent.service';

const url = process.env.DATABASE_URL ?? '';
if (process.env.L10_EPHEMERAL !== '1' || !/[?&]host=\//.test(url)) {
  console.error('REFUSED: this script writes fixtures and only runs against the ephemeral local instance (scripts/l10-ephemeral-db-test.sh).');
  process.exit(2);
}

let passed = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
async function rejects(name: string, fn: () => Promise<unknown>, pattern: RegExp) {
  try {
    await fn();
    check(name, 'no error', `error ${pattern}`);
  } catch (error: any) {
    check(name, pattern.test(String(error?.message ?? error)), true);
  }
}

async function user(tag: string, role: string | null): Promise<{ id: string; clerk: string; email: string }> {
  const clerk = `clerk_${tag}`;
  const email = `${tag}@l10.test`;
  const r = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [clerk, email]);
  const id = r.rows[0].id;
  if (role) await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, $2, 'ACTIVE', 'SELF_REGISTRATION')`, [id, role]);
  return { id, clerk, email };
}
async function student(u: { id: string; clerk: string; email: string }, linked = true): Promise<string> {
  const r = await db.query(`INSERT INTO students (clerk_id, email, name, user_id) VALUES ($1, $2, $3, $4) RETURNING id`, [u.clerk, u.email, u.clerk, linked ? u.id : null]);
  const id = r.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name, user_id) VALUES ($1, 'student', $2, $3)`, [id, u.clerk, linked ? u.id : null]);
  return id;
}
const setRole = (userId: string, role: string, status: 'ACTIVE' | 'REVOKED') => db.query(`UPDATE user_roles SET status = $3 WHERE user_id = $1 AND role = $2`, [userId, role, status]);
const setAccount = (userId: string, status: string) => db.query(`UPDATE users SET status = $2 WHERE id = $1`, [userId, status]);

async function main() {
  // ---------------------------------------------------------------- fixtures
  const s1u = await user('s1', 'STUDENT');
  const s1 = await student(s1u);
  const s2u = await user('s2', 'STUDENT'); // legacy: students.user_id never backfilled
  const s2 = await student(s2u, false);
  const s3u = await user('s3', 'STUDENT');
  const s3 = await student(s3u);
  const pu = await user('p1', 'PARENT');
  const parentId = (await db.query(`INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'P One', $1, $2) RETURNING id`, [pu.clerk, pu.id])).rows[0].id;
  const tu = await user('t1', 'TEACHER');
  const cu = await user('c1', null);
  await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'INSTITUTION_ADMIN', 'ACTIVE', 'INVITATION')`, [cu.id]);
  const strangerU = await user('x1', 'TEACHER');
  const adminU = await user('a1', null);

  const inst = (await db.query(`INSERT INTO institutions (name, status) VALUES ('L10 School', 'ACTIVE') RETURNING id`)).rows[0].id;
  const inst2 = (await db.query(`INSERT INTO institutions (name, status) VALUES ('Other School', 'ACTIVE') RETURNING id`)).rows[0].id;
  const klass = (await db.query(`INSERT INTO classes (institution_id, name) VALUES ($1, 'K1') RETURNING id`, [inst])).rows[0].id;
  const klass2 = (await db.query(`INSERT INTO classes (institution_id, name) VALUES ($1, 'K2') RETURNING id`, [inst])).rows[0].id;
  const tm = (await db.query(`INSERT INTO institution_memberships (institution_id, user_id, membership_role, status) VALUES ($1, $2, 'TEACHER', 'APPROVED') RETURNING id`, [inst, tu.id])).rows[0].id;
  await db.query(`INSERT INTO teacher_assignments (institution_membership_id, class_id, status) VALUES ($1, $2, 'ACTIVE')`, [tm, klass]);
  await db.query(`INSERT INTO institution_memberships (institution_id, user_id, membership_role, status) VALUES ($1, $2, 'INSTITUTION_ADMIN', 'APPROVED')`, [inst, cu.id]);
  await db.query(`INSERT INTO parent_student_relationships (parent_id, student_id, status, responded_at) VALUES ($1, $2, 'accepted', now())`, [parentId, s1]);

  // ------------------------------------------------- enrolment fixtures
  const e1 = (await db.query(`INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'PENDING') RETURNING id`, [klass, s1])).rows[0].id;
  await db.query(`UPDATE class_enrollments SET status = 'ACTIVE' WHERE id = $1`, [e1]);
  const e1b = (await db.query(`INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [klass2, s1])).rows[0].id;
  await db.query(`UPDATE class_enrollments SET status = 'ENDED', ended_at = now() WHERE id = $1`, [e1b]);

  // ------------------------------------------------------- SF-1 / SF-2 student
  check('SF-1 student: owner with ACTIVE role passes verifyStudentAccess', await verifyStudentAccess(s1u.clerk, s1), true);
  check('SF-1 student: another learner is denied', await verifyStudentAccess(s1u.clerk, s3), false);
  await setRole(s1u.id, 'STUDENT', 'REVOKED');
  check('SF-1 student: REVOKED role denies verifyStudentAccess on the next call', await verifyStudentAccess(s1u.clerk, s1), false);
  check('SF-1 student: REVOKED role denies isOwner', await isOwner(s1u.id, s1), false);
  check('SF-1 student: REVOKED role => ownStudentId null', await ownStudentId(s1u.id), null);
  await setRole(s1u.id, 'STUDENT', 'ACTIVE');
  check('SF-1 student: re-grant restores access on the next call', await verifyStudentAccess(s1u.clerk, s1), true);
  await setAccount(s1u.id, 'SUSPENDED');
  check('SF-1 student: SUSPENDED account denies verifyStudentAccess (no Clerk ban involved)', await verifyStudentAccess(s1u.clerk, s1), false);
  check('SF-1 student: SUSPENDED account denies isOwner', await isOwner(s1u.id, s1), false);
  check('SF-1 account gate: SUSPENDED => 403 ACCOUNT_NOT_ACTIVE', decideAccountGate(await loadAccountStatus(s1u.clerk)), { allow: false, status: 403, error: 'ACCOUNT_NOT_ACTIVE' });
  await setAccount(s1u.id, 'ACTIVE');
  check('SF-1 account gate: ACTIVE => allow', decideAccountGate(await loadAccountStatus(s1u.clerk)), { allow: true });
  check('SF-1 account gate: unknown identity => allow (nothing to suspend)', decideAccountGate(await loadAccountStatus('clerk_nobody')), { allow: true });

  check('SF-2 unlinked learner: learning-family guard resolves it', await verifyStudentAccess(s2u.clerk, s2), true);
  check('SF-2 unlinked learner: exam-family isOwner agrees', await isOwner(s2u.id, s2), true);
  check('SF-2 unlinked learner: exam-family ownStudentId is the SAME id', await ownStudentId(s2u.id), s2);
  check('SF-2 resolver by Clerk id and by user id agree', (await resolveOwnedStudent({ clerkId: s2u.clerk }))?.studentId, (await resolveOwnedStudent({ userId: s2u.id }))?.studentId);

  // ------------------------------------------------------------ SF-1 parent
  check('SF-1 parent: accepted + ACTIVE role passes isActiveParentOf', await isActiveParentOf(pu.id, s1), true);
  check('SF-1 parent: accepted + ACTIVE role passes verifyParentAccess', await verifyParentAccess(parentId, s1), true);
  await setRole(pu.id, 'PARENT', 'REVOKED');
  check('SF-1 parent: REVOKED role denies isActiveParentOf', await isActiveParentOf(pu.id, s1), false);
  check('SF-1 parent: REVOKED role denies verifyParentAccess', await verifyParentAccess(parentId, s1), false);
  await setRole(pu.id, 'PARENT', 'ACTIVE');

  // ---------------------------------------------------- SF-1 / SF-3 teacher
  check('SF-3 teacher: reaches own class learner', await canTeacherAccessLearner(tu.id, s1), true);
  check('SF-3 teacher: is teacher of own class', await isTeacherOfClass(tu.id, klass), true);
  check('SF-3 teacher: unassigned teacher is denied', await canTeacherAccessLearner(strangerU.id, s1), false);
  await db.query(`UPDATE institutions SET status = 'SUSPENDED' WHERE id = $1`, [inst]);
  check('SF-3 suspended institution: canTeacherAccessLearner denied', await canTeacherAccessLearner(tu.id, s1), false);
  check('SF-3 suspended institution: isTeacherOfClass denied', await isTeacherOfClass(tu.id, klass), false);
  check('SF-3 suspended institution: canAccessClass (teacher) denied', await canAccessClass(tu.id, klass, 'TEACHER_ASSIGNMENT_MANAGE'), false);
  check('SF-3 suspended institution: teacher class list empty', (await getTeacherAssignedClasses(tu.id)).length, 0);
  await db.query(`UPDATE institutions SET status = 'ACTIVE' WHERE id = $1`, [inst]);
  check('SF-3 institution restored: teacher access returns', await canTeacherAccessLearner(tu.id, s1), true);
  await db.query(`UPDATE classes SET status = 'ARCHIVED', archived_at = now() WHERE id = $1`, [klass]);
  check('SF-3 archived class: canTeacherAccessLearner denied', await canTeacherAccessLearner(tu.id, s1), false);
  check('SF-3 archived class: isTeacherOfClass denied', await isTeacherOfClass(tu.id, klass), false);
  check('SF-3 archived class: canAccessClass (teacher) denied', await canAccessClass(tu.id, klass, 'TEACHER_ASSIGNMENT_MANAGE'), false);
  check('SF-3 archived class: coordinator still reaches it', await canAccessClass(cu.id, klass, 'TEACHER_ASSIGNMENT_MANAGE'), true);
  await db.query(`UPDATE classes SET status = 'ACTIVE', archived_at = NULL WHERE id = $1`, [klass]);
  await setRole(tu.id, 'TEACHER', 'REVOKED');
  check('SF-1 teacher: REVOKED role denies canTeacherAccessLearner', await canTeacherAccessLearner(tu.id, s1), false);
  check('SF-1 teacher: REVOKED role denies isTeacherOfClass', await isTeacherOfClass(tu.id, klass), false);
  check('SF-1 teacher: REVOKED role denies canAccessClass', await canAccessClass(tu.id, klass, 'TEACHER_ASSIGNMENT_MANAGE'), false);
  await setRole(tu.id, 'TEACHER', 'ACTIVE');

  // ------------------------------------------------ SF-1 / SF-4 institution
  check('SF-4 coordinator: canAccessInstitution', await canAccessInstitution(cu.id, inst, 'INSTITUTION_MEMBER_APPROVE'), true);
  check('SF-4 coordinator: other institution denied', await canAccessInstitution(cu.id, inst2, 'INSTITUTION_MEMBER_APPROVE'), false);
  check('SF-4 permission honoured: an unknown permission is refused', await canAccessInstitution(cu.id, inst, 'NOT_A_PERMISSION' as any), false);
  check('SF-4 permission honoured: teacher cannot pass canAccessClass for INSTITUTION_MEMBER_APPROVE', await canAccessClass(tu.id, klass, 'INSTITUTION_MEMBER_APPROVE'), false);
  check('SF-4 permission honoured: teacher cannot pass canAccessClass for INSTITUTION_INTELLIGENCE_VIEW', await canAccessClass(tu.id, klass, 'INSTITUTION_INTELLIGENCE_VIEW'), false);
  check('SF-4 teacher passes canAccessClass for TEACHER_ASSIGNMENT_MANAGE', await canAccessClass(tu.id, klass, 'TEACHER_ASSIGNMENT_MANAGE'), true);

  // ------------------------------------------------ CR-L8-01 / CR-L8-02
  const subj = async (name: string) => (await db.query(`INSERT INTO canonical_subjects (name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
  const maths = await subj('L10 Mathematics');
  const reading = await subj('L10 Reading');
  const concept = async (subjectId: string, name: string) => (await db.query(`INSERT INTO canonical_concepts (canonical_subject_id, name) VALUES ($1, $2) RETURNING id`, [subjectId, name])).rows[0].id;
  const cMath = await concept(maths, 'Linear equations');
  const cRead = await concept(reading, 'Inference');
  await db.query(`UPDATE classes SET canonical_subject_id = $2 WHERE id = $1`, [klass, maths]);
  check('CR-L8-01 the class teacher holds the class scope, with the class subject', await resolveTeacherClassScope(tu.id, klass), { classId: klass, institutionId: inst, canonicalSubjectId: maths });
  check('CR-L8-01 unrelated class => no scope', await resolveTeacherClassScope(tu.id, klass2), null);
  check('CR-L8-01 a teacher of no class here => no scope', await resolveTeacherClassScope(strangerU.id, klass), null);
  check('CR-L8-01 Coordinator cannot use the Teacher scope as a bypass', await resolveTeacherClassScope(cu.id, klass), null);
  check('CR-L8-01 Coordinator is refused by the Teacher roster read model', await getTeacherClassRoster(cu.id, klass).then(() => 'ALLOWED', () => 'DENIED'), 'DENIED');
  check('CR-L8-01 the class teacher still reads the roster', (await getTeacherClassRoster(tu.id, klass)).map((r) => r.studentId), [s1]);
  check('CR-L8-01 Coordinator is refused by getTeacherClassExamGaps', await getTeacherClassExamGaps(cu.id, klass).then(() => 'ALLOWED', (e) => e.name), 'TeacherExamScopeDeniedError');
  check('CR-L8-01 unrelated class is refused by getTeacherClassExamGaps', await getTeacherClassExamGaps(tu.id, klass2).then(() => 'ALLOWED', (e) => e.name), 'TeacherExamScopeDeniedError');
  const rawGaps = {
    studentsWithResults: 1,
    byDomain: [{ family: 'PAA', exam: 'PAA', domain: 'Lectura', students: 1 }],
    byObjective: [{ family: 'PAA', exam: 'PAA', code: 'R1', description: 'Inferir', students: 1 }],
    byConcept: [{ canonicalConceptId: cMath, name: 'Linear equations', students: 1, studentIds: [s1] }, { canonicalConceptId: cRead, name: 'Inference', students: 1, studentIds: [s1] }],
    perStudent: [{ studentId: s1, gaps: 2, concepts: [{ canonicalConceptId: cMath, name: 'Linear equations', studentConceptId: null }, { canonicalConceptId: cRead, name: 'Inference', studentConceptId: null }] }],
  };
  const mathsView = await scopeExamGapsToSubject(rawGaps, maths);
  check('CR-L8-01 authorized class + matching subject => visible', mathsView.perStudent, [{ studentId: s1, gaps: 1, concepts: [{ canonicalConceptId: cMath, name: 'Linear equations', studentConceptId: null }] }]);
  check('CR-L8-01 authorized class + different subject => hidden', JSON.stringify(mathsView).includes('Inference') || JSON.stringify(mathsView).includes('Lectura') || JSON.stringify(mathsView).includes('Inferir'), false);
  check('CR-L8-01 a class with no subject sees no gaps', (await scopeExamGapsToSubject(rawGaps, null)).perStudent, []);
  check('CR-L8-01 real path on an empty attempt history: scoped, empty, subject recorded', (await getTeacherClassExamGaps(tu.id, klass)).gaps.subjectScope, { canonicalSubjectId: maths, objectiveAggregates: 'WITHHELD' });
  await setRole(cu.id, 'INSTITUTION_ADMIN', 'REVOKED');
  check('SF-1 coordinator: REVOKED role denies canAccessInstitution', await canAccessInstitution(cu.id, inst, 'INSTITUTION_MEMBER_APPROVE'), false);
  check('SF-1 coordinator: REVOKED role denies isCoordinatorOfLearner', await isCoordinatorOfLearner(cu.id, s1), false);
  await setRole(cu.id, 'INSTITUTION_ADMIN', 'ACTIVE');

  // ------------------------------------------------- SF-4 D-1 learner scope
  const scope = async (actor: string) => (await resolveLearnerReadScope(actor, s1)).relationships;
  check('D-1 owner relationship', await scope(s1u.id), ['OWNER']);
  check('D-1 parent relationship', await scope(pu.id), ['PARENT']);
  check('D-1 teacher relationship', await scope(tu.id), ['TEACHER']);
  check('D-1 coordinator relationship', await scope(cu.id), ['COORDINATOR']);
  check('D-1 unrelated account has no relationship', await scope(strangerU.id), []);
  check('D-1 parent: released summary yes', await canAccessLearner(pu.id, s1, 'LEARNER_ASSESSMENT_SUMMARY_VIEW'), true);
  check('D-1 parent: gaps yes', await canAccessLearner(pu.id, s1, 'LEARNER_GAPS_VIEW'), true);
  check('D-1 parent: raw item-level detail NO', await canAccessLearner(pu.id, s1, 'LEARNER_ASSESSMENT_DETAIL_VIEW'), false);
  check('D-1 parent: cannot act in the learner work', await canAccessLearner(pu.id, s1, 'LEARNER_INTERVENTION_CREATE'), false);
  check('D-1 teacher: assessment detail yes', await canAccessLearner(tu.id, s1, 'LEARNER_ASSESSMENT_DETAIL_VIEW'), true);
  check('D-1 teacher: a learner outside the class NO', await canAccessLearner(tu.id, s3, 'LEARNER_GAPS_VIEW'), false);
  check('D-1 coordinator: gaps yes', await canAccessLearner(cu.id, s1, 'LEARNER_GAPS_VIEW'), true);
  check('D-1 coordinator: released summary yes', await canAccessLearner(cu.id, s1, 'LEARNER_ASSESSMENT_SUMMARY_VIEW'), true);
  check('D-1 coordinator: raw item-level detail NO', await canAccessLearner(cu.id, s1, 'LEARNER_ASSESSMENT_DETAIL_VIEW'), false);
  check('D-1 coordinator: whole-learner PROGRESS routes stay closed', await canAccessLearner(cu.id, s1, 'LEARNER_PROGRESS_VIEW'), false);
  check('D-1 coordinator: learner not enrolled in the institution NO', await canAccessLearner(cu.id, s3, 'LEARNER_GAPS_VIEW'), false);
  check('D-1 owner: everything', await canAccessLearner(s1u.id, s1, 'LEARNER_ASSESSMENT_DETAIL_VIEW'), true);

  // ---------------------------------------- L10-R1: Teacher subject scope (real DB)
  check('R1 teacher subject scope for a learner of the class = the class subject', await teacherSubjectScopeForLearner(tu.id, s1), [maths]);
  check('R1 no subject scope for a learner who is not in the teacher\'s class', await teacherSubjectScopeForLearner(tu.id, s3), []);
  check('R1 a coordinator has no teacher subject scope', await teacherSubjectScopeForLearner(cu.id, s1), []);
  check('R1 concepts are attributed to the teacher subject only', [...(await canonicalConceptsInSubjects([cMath, cRead], [maths]))], [cMath]);
  const learnerSubject = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Mis mates') RETURNING id`, [s1])).rows[0].id;
  const learnerConcept = async (name: string, canonicalId: string | null) => {
    const id = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [learnerSubject, `l10-${name}`])).rows[0].id;
    await db.query(`INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ($1, $2, $3, $4)`, [id, canonicalId, canonicalId ? 'MATCHED' : 'UNRESOLVED', canonicalId ? 'SEED_FIXTURE' : null]);
    return id;
  };
  const lcMath = await learnerConcept('linear', cMath);
  const lcRead = await learnerConcept('inference', cRead);
  const lcNone = await learnerConcept('unmapped', null);
  check('R1 learner concept -> canonical subject through its MATCHED mapping', await canonicalSubjectOfLearnerConcept(lcMath), maths);
  check('R1 item-level detail: matching subject => the teacher may read', await teacherMayReadLearnerConcept(tu.id, s1, lcMath), true);
  check('R1 item-level detail: different subject => not', await teacherMayReadLearnerConcept(tu.id, s1, lcRead), false);
  check('R1 item-level detail: unmapped concept => not', await teacherMayReadLearnerConcept(tu.id, s1, lcNone), false);
  check('R1 item-level detail: a teacher of no class of the learner => not', await teacherMayReadLearnerConcept(strangerU.id, s1, lcMath), false);
  await db.query(`UPDATE institutions SET status = 'SUSPENDED' WHERE id = $1`, [inst]);
  check('R1 a suspended institution removes the teacher subject scope', await teacherSubjectScopeForLearner(tu.id, s1), []);
  await db.query(`UPDATE institutions SET status = 'ACTIVE' WHERE id = $1`, [inst]);
  const scopedR1 = await getTeacherClassExamGaps(tu.id, klass);
  check('R1 Teacher exam goals and AICE entries are withheld', [scopedR1.goals.perStudent, scopedR1.aice, scopedR1.withheld.includes('EXAM_GOALS'), scopedR1.withheld.includes('AICE_ENTRIES')], [[], [], true, true]);

  // ---------------------------------------- L10-R1: revoked / inactive Student
  await setRole(s1u.id, 'STUDENT', 'REVOKED');
  check('R1 revoked Student: requireStudentId => null (the route answers 403)', await requireStudentId(s1u.clerk), null);
  const revokedError = await getOrCreateStudentId(s1u.clerk).then(() => null, (e) => e);
  check('R1 revoked Student: getOrCreateStudentId refuses with the 403 contract', [revokedError instanceof StudentRoleRequiredError, authFailureOf(revokedError)], [true, { status: 403, error: 'STUDENT_ROLE_REQUIRED' }]);
  await setRole(s1u.id, 'STUDENT', 'ACTIVE');
  await setAccount(s1u.id, 'SUSPENDED');
  check('R1 inactive account: requireStudentId => null', await requireStudentId(s1u.clerk), null);
  check('R1 inactive account: getOrCreateStudentId refuses', authFailureOf(await getOrCreateStudentId(s1u.clerk).then(() => null, (e) => e)), { status: 403, error: 'STUDENT_ROLE_REQUIRED' });
  await setAccount(s1u.id, 'ACTIVE');
  check('R1 restored: getOrCreateStudentId resolves the same learner', await getOrCreateStudentId(s1u.clerk), s1);

  // ---------------------------------------- CR-L11-06: Transfer exactly-once (existing state)
  const taskId = randomUUID();
  const otherTaskId = randomUUID();
  check('CR-L11-06 an OPEN transfer task is not "already graded"', await isTransferTaskAlreadyGraded(taskId, lcMath), false);
  const evidence = (key: string) => db.query(`INSERT INTO learning_evidence (student_id, concept_id, source_type, result, difficulty, operation_key) VALUES ($1, $2, 'TRANSFER', 'correct', 3, $3)`, [s1, lcMath, key]);
  await evidence(buildOperationKey({ operationType: 'TRANSFER', operationId: taskId, conceptId: lcMath }));
  check('CR-L11-06 once the graded evidence exists the task reads as answered', await isTransferTaskAlreadyGraded(taskId, lcMath), true);
  check('CR-L11-06 another task of the same concept stays OPEN', await isTransferTaskAlreadyGraded(otherTaskId, lcMath), false);
  check('CR-L11-06 the same task id under another concept is a different operation', await isTransferTaskAlreadyGraded(taskId, lcRead), false);
  await rejects('CR-L11-06 the database refuses a second evidence row for the same transfer task', () => evidence(buildOperationKey({ operationType: 'TRANSFER', operationId: taskId, conceptId: lcMath })), /learning_evidence_operation_key_unique_idx/);
  check('CR-L11-06 exactly one evidence row for the task', (await db.query(`SELECT count(*)::int AS n FROM learning_evidence WHERE operation_key = $1`, [buildOperationKey({ operationType: 'TRANSFER', operationId: taskId, conceptId: lcMath })])).rows[0].n, 1);

  // ---------------------------------------- L10-R2: Transfer CONCURRENT exactly-once (real Postgres)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const concurrentTask = randomUUID();
  let graderCalls = 0;
  // Stands for the route's gradeAndRecord: a slow AI grading call, then the evidence write (its own connection, committed).
  const gradeAndRecord = (task: string) => async () => {
    graderCalls++;
    await sleep(150);
    await evidence(buildOperationKey({ operationType: 'TRANSFER', operationId: task, conceptId: lcMath }));
    return 'graded';
  };
  const racers = await Promise.all(Array.from({ length: 8 }, () => runTransferSubmissionExclusively(concurrentTask, lcMath, gradeAndRecord(concurrentTask))));
  check('R2 concurrent: 8 simultaneous first submissions => exactly ONE grading invocation', graderCalls, 1);
  check('R2 concurrent: one COMPLETED, every other request the same deterministic refusal', racers.map((r) => r.outcome).sort(), ['COMPLETED', ...Array(7).fill('IN_PROGRESS')]);
  check('R2 concurrent: exactly one evidence row for the task', (await db.query(`SELECT count(*)::int AS n FROM learning_evidence WHERE operation_key = $1`, [buildOperationKey({ operationType: 'TRANSFER', operationId: concurrentTask, conceptId: lcMath })])).rows[0].n, 1);
  const advisoryLocks = async () => (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)).rows[0].n;
  check('R2 concurrent: no claim is left behind', await advisoryLocks(), 0);
  check('R2 concurrent: a later request reads ALREADY_ANSWERED and does not grade', [(await runTransferSubmissionExclusively(concurrentTask, lcMath, gradeAndRecord(concurrentTask))).outcome, graderCalls], ['ALREADY_ANSWERED', 1]);

  // A second wave arriving while the first request is still grading.
  const wave = randomUUID();
  graderCalls = 0;
  const leader = runTransferSubmissionExclusively(wave, lcMath, gradeAndRecord(wave));
  await sleep(40);
  const late = await Promise.all([1, 2, 3].map(() => runTransferSubmissionExclusively(wave, lcMath, gradeAndRecord(wave))));
  check('R2 concurrent: requests arriving mid-grading are refused at once, without grading', [late.map((r) => r.outcome), graderCalls], [['IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS'], 1]);
  check('R2 concurrent: the leader completes', (await leader).outcome, 'COMPLETED');

  // Failure while grading: nothing is stranded.
  const failing = randomUUID();
  graderCalls = 0;
  const failed = await runTransferSubmissionExclusively(failing, lcMath, async () => { graderCalls++; throw new Error('grader failed'); }).then(() => 'RESOLVED', (e) => e.message);
  check('R2 failure: the error reaches the caller', failed, 'grader failed');
  check('R2 failure: the claim is released and no evidence was written -- the task is still OPEN', [await advisoryLocks(), await isTransferTaskAlreadyGraded(failing, lcMath)], [0, false]);
  check('R2 failure: the retry grades and completes', [(await runTransferSubmissionExclusively(failing, lcMath, gradeAndRecord(failing))).outcome, graderCalls], ['COMPLETED', 2]);

  // Crash: a process holding the claim dies (its connection is gone, nothing committed).
  const crashed = randomUUID();
  const dead = new Client({ connectionString: process.env.DATABASE_URL });
  await dead.connect();
  await dead.query('BEGIN');
  check('R2 crash: a "process" takes the claim', (await dead.query(`SELECT pg_try_advisory_xact_lock($1::bigint) AS locked`, [launchLockId(transferSubmissionLockKey(crashed, lcMath))])).rows[0].locked, true);
  graderCalls = 0;
  check('R2 crash: while it holds the claim another request is refused', (await runTransferSubmissionExclusively(crashed, lcMath, gradeAndRecord(crashed))).outcome, 'IN_PROGRESS');
  await dead.end(); // the process dies: no COMMIT, no ROLLBACK, no cleanup code runs
  await sleep(100);
  check('R2 crash: the claim died with the connection; the task is OPEN and the next submission grades', [(await runTransferSubmissionExclusively(crashed, lcMath, gradeAndRecord(crashed))).outcome, graderCalls], ['COMPLETED', 1]);

  // ---------------------------------------- L10-R2: Teacher whole-learner scope (real Postgres)
  check('R2 teacher: learner-wide payload (summary / readiness / exam profiles / eligibility) => refused', await canReadLearnerRoute(tu.id, s1, 'LEARNER_PROGRESS_VIEW', 'DENY'), false);
  check('R2 teacher: exam profiles => refused', await canReadLearnerRoute(tu.id, s1, 'LEARNER_PROFILE_VIEW', 'DENY'), false);
  check('R2 teacher: one concept inside the authorized subject => allowed', await canReadLearnerRoute(tu.id, s1, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: lcMath }), true);
  check('R2 teacher: one concept of ANOTHER subject of the same learner => refused', await canReadLearnerRoute(tu.id, s1, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: lcRead }), false);
  check('R2 teacher: an unmapped concept => refused', await canReadLearnerRoute(tu.id, s1, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: lcNone }), false);
  check('R2 teacher of no class of the learner => refused', await canReadLearnerRoute(strangerU.id, s1, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: lcMath }), false);
  check('R2 owner: unaffected', await canReadLearnerRoute(s1u.id, s1, 'LEARNER_PROGRESS_VIEW', 'DENY'), true);
  check('R2 coordinator: still not admitted to the whole-learner routes', [await canReadLearnerRoute(cu.id, s1, 'LEARNER_PROGRESS_VIEW', 'DENY'), await canReadLearnerRoute(cu.id, s1, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: lcMath })], [false, false]);
  // Evidence so far: transfer evidence on the Mathematics concept only. Add mastery + debt in BOTH subjects.
  for (const c of [lcMath, lcRead]) {
    await db.query(`INSERT INTO mastery_records (student_id, concept_id, subject_id) VALUES ($1, $2, $3)`, [s1, c, learnerSubject]);
    await db.query(`INSERT INTO learning_debt (student_id, concept_id, subject_id, status) VALUES ($1, $2, $3, 'active')`, [s1, c, learnerSubject]);
  }
  const overview = await getTeacherStudentOverview(tu.id, s1);
  check('R2 teacher overview: counts cover the authorized subject only (1 of the learner\'s 2 concepts)', [overview.conceptsWithEvidence, overview.areasNeedingAttentionCount], [1, 1]);
  check('R2 teacher overview: exam-wide readiness is withheld; the subject scope is stated', [overview.latestReadinessStatus, overview.subjectScope], ['WITHHELD', { canonicalSubjectIds: [maths] }]);
  check('R2 teacher overview: last activity comes from the authorized subject', overview.lastActivityAt !== null, true);

  // ---------------------------------------- CR-L11-05: manual payment approval on an admin-set row
  const approval = { studentId: s1, plan: 'MONTHLY', amountCents: 50000, currency: 'COP', occurredAt: new Date().toISOString(), reference: `l10-${randomUUID()}`, method: 'transfer', validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString() };
  await db.query(`INSERT INTO subscriptions (student_id, status, manually_set_by_admin, grant_expires_at, source) VALUES ($1, 'active', true, now() - interval '1 day', 'ADMIN_PROMOTION')`, [s1]);
  const subBefore = (await db.query(`SELECT status, manually_set_by_admin, grant_expires_at, current_period_end, plan FROM subscriptions WHERE student_id = $1`, [s1])).rows[0];
  check('CR-L11-05 expired admin grant + manual approval => refused', await approveManualPayment(adminU.id, approval).then(() => 'APPROVED', (e) => (e instanceof AdminControlledSubscriptionError ? 'REFUSED' : `UNEXPECTED ${e}`)), 'REFUSED');
  check('CR-L11-05 no payment row was written', (await db.query(`SELECT count(*)::int AS n FROM payments p JOIN subscriptions s ON s.id = p.subscription_id WHERE s.student_id = $1`, [s1])).rows[0].n, 0);
  check('CR-L11-05 the subscription row is unchanged (never "active but no access" by approval)', (await db.query(`SELECT status, manually_set_by_admin, grant_expires_at, current_period_end, plan FROM subscriptions WHERE student_id = $1`, [s1])).rows[0], subBefore);
  await db.query(`UPDATE subscriptions SET status = 'suspended' WHERE student_id = $1`, [s1]);
  check('CR-L11-05 administrative suspension + manual approval => refused (the suspension is not lifted)', [await approveManualPayment(adminU.id, { ...approval, reference: `l10-${randomUUID()}` }).then(() => 'APPROVED', (e) => (e instanceof AdminControlledSubscriptionError ? 'REFUSED' : `UNEXPECTED ${e}`)), (await db.query(`SELECT status FROM subscriptions WHERE student_id = $1`, [s1])).rows[0].status], ['REFUSED', 'suspended']);
  const paid = await approveManualPayment(adminU.id, { ...approval, studentId: s3, reference: `l10-${randomUUID()}` }).then(() => 'APPROVED', (e) => `UNEXPECTED ${e}`);
  check('CR-L11-05 a row no administrator set keeps the existing approval path', [paid, (await db.query(`SELECT status, manually_set_by_admin FROM subscriptions WHERE student_id = $1`, [s3])).rows[0]], ['APPROVED', { status: 'active', manually_set_by_admin: false }]);

  // ------------------------------------------------- D-2 / D-4: no deferred schema
  check('D-2 / D-4 the deferred seat-model and onboarding tables do not exist', (await db.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('institution_student_memberships', 'institution_licenses', 'institution_license_seats', 'user_role_onboarding')`)).rows[0].n, 0);

  // ------------------------------------------------- an enrolment ends
  await db.query(`INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'ACTIVE')`, [klass, s3]);
  await db.query(`UPDATE class_enrollments SET status = 'ENDED', ended_at = now() WHERE id = $1`, [e1]);
  check('SF-3/IN-3 after the enrolment ended the teacher no longer reaches the learner', await canTeacherAccessLearner(tu.id, s1), false);
  await enrollStudent(klass, s1); // a NEW row: the ended one is history (CR-L9-02)

  // ------------------------------------------------------ SF-10 one persona
  await rejects('SF-10 a second ACTIVE persona is rejected by the database', () => db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'PARENT', 'ACTIVE', 'SELF_REGISTRATION')`, [s3u.id]), /uq_user_roles_one_persona/);
  await setRole(s3u.id, 'STUDENT', 'REVOKED');
  check('SF-10 admin persona change (revoke, then grant another) stays valid', (await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'PARENT', 'ACTIVE', 'INVITATION') RETURNING role`, [s3u.id])).rows[0].role, 'PARENT');
  await rejects('SF-10 re-activating the old persona beside the new one is rejected', () => setRole(s3u.id, 'STUDENT', 'ACTIVE'), /uq_user_roles_one_persona/);
  check('SF-10 a capability beside a persona is allowed', (await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'INSTITUTION_ADMIN', 'ACTIVE', 'INVITATION') RETURNING role`, [tu.id])).rows[0].role, 'INSTITUTION_ADMIN');


  // ------------------------------------------------- CR-L7-01 + SF-7 invites
  const refusal = async (email: string) => {
    try {
      await inviteParentByEmail(s1, email);
      return 'ACCEPTED';
    } catch (error) {
      return error instanceof ParentInvitationRefusedError ? error.code : `UNEXPECTED ${String(error)}`;
    }
  };
  const countInv = async () => (await db.query(`SELECT count(*)::int AS n FROM parent_invitations WHERE student_id = $1`, [s1])).rows[0].n;
  check('CR-L7-01 own email => refused', await refusal(s1u.email), 'OWN_EMAIL');
  check('CR-L7-01 own email, different case and padding => refused', await refusal(`  ${s1u.email.toUpperCase()} `), 'OWN_EMAIL');
  check('CR-L7-01 already-active parent email => refused', await refusal(pu.email), 'ALREADY_LINKED');
  check('CR-L7-01 refusals wrote nothing', await countInv(), 0);
  const inv1 = await inviteParentByEmail(s1, 'Aunt@Family.test');
  check('CR-L7-01 unrelated valid email => invitation created, stored normalized', [inv1.created, inv1.status, inv1.invitedEmail], [true, 'pending', 'aunt@family.test']);
  const inv1b = await inviteParentByEmail(s1, ' aunt@family.test ');
  check('CR-L7-01 existing pending invitation => same invitation, not created again', [inv1b.id, inv1b.created], [inv1.id, false]);
  check('CR-L7-01 no duplicate invitation row', await countInv(), 1);
  check('SF-7 the invitation carries an expiry', new Date(inv1.expiresAt as string).getTime() > Date.now(), true);

  // L4-07: student invites the parent's email; they link another way; student revokes; the OLD invitation must not re-grant.
  await db.query(`UPDATE parent_student_relationships SET status = 'declined', responded_at = now() - interval '2 days' WHERE parent_id = $1 AND student_id = $2`, [parentId, s1]);
  const stale = await inviteParentByEmail(s1, pu.email);
  await db.query(`UPDATE parent_invitations SET created_at = now() - interval '1 day' WHERE id = $1`, [stale.id]);
  await db.query(`UPDATE parent_student_relationships SET status = 'accepted', responded_at = now() - interval '12 hours' WHERE parent_id = $1 AND student_id = $2`, [parentId, s1]);
  check('SF-7 student revokes the accepted relationship', await revokeRelationshipByStudent(s1, parentId), true);
  check('SF-7 revoke cancels the pending invitation to that parent', (await db.query(`SELECT status FROM parent_invitations WHERE id = $1`, [stale.id])).rows[0].status, 'revoked');
  check('SF-7 the parent no longer sees it as pending', (await listPendingInvitationsForEmail(pu.email)).length, 0);
  check('SF-7 L4-07 accepting the old invitation is refused', await acceptParentInvitation(stale.id, parentId, pu.email), false);
  // Even if the cancellation had been missed, the acceptance itself refuses an invitation that predates the ending.
  await db.query(`UPDATE parent_invitations SET status = 'pending', responded_at = NULL WHERE id = $1`, [stale.id]);
  check('SF-7 L4-07 a still-pending invitation older than the revocation is refused too', await acceptParentInvitation(stale.id, parentId, pu.email), false);
  check('SF-7 L4-07 the relationship stays revoked', await verifyParentAccess(parentId, s1), false);
  const fresh = await inviteParentByEmail(s1, pu.email);
  check('SF-7 a NEW invitation sent after the revocation is accepted', await acceptParentInvitation(fresh.id, parentId, pu.email), true);
  check('SF-7 access is restored only by that new consent', await verifyParentAccess(parentId, s1), true);
  check('SF-7 the invited existing Parent was notified in-app', (await db.query(`SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1 AND notification_type = 'PARENT_INVITATION_RECEIVED'`, [pu.id])).rows[0].n >= 1, true);

  const old = await inviteParentByEmail(s1, 'late@family.test');
  await db.query(`UPDATE parent_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [old.id]);
  const lateU = await user('late', 'PARENT');
  await db.query(`UPDATE users SET email = 'late@family.test' WHERE id = $1`, [lateU.id]);
  const lateParent = (await db.query(`INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Late', $1, $2) RETURNING id`, [lateU.clerk, lateU.id])).rows[0].id;
  check('SF-7 an invitation past its expiry is refused', await acceptParentInvitation(old.id, lateParent, 'late@family.test'), false);
  check('SF-7 and is marked expired', (await db.query(`SELECT status FROM parent_invitations WHERE id = $1`, [old.id])).rows[0].status, 'expired');
  check('SF-7 no relationship row was written for it', (await db.query(`SELECT count(*)::int AS n FROM parent_student_relationships WHERE parent_id = $1`, [lateParent])).rows[0].n, 0);
  const again = await inviteParentByEmail(s1, 'late@family.test');
  check('SF-7 the Student can invite that email again after expiry', [again.created, again.id !== old.id], [true, true]);

  // Admin ends a relationship.
  await endParentRelationshipByAdmin(adminU.id, parentId, s1, 'safeguarding review');
  check('SF-7 admin end: parent access denied on the next call', await verifyParentAccess(parentId, s1), false);
  check('SF-7 admin end: isActiveParentOf denied', await isActiveParentOf(pu.id, s1), false);
  check('SF-7 admin end: an audit row exists', (await db.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'PARENT_RELATIONSHIP_ENDED' AND actor_user_id = $1`, [adminU.id])).rows[0].n, 1);
  await requestChildLink(parentId, s1u.email);
  check('SF-7 admin end: the parent cannot reopen it by re-requesting', (await db.query(`SELECT status FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2`, [parentId, s1])).rows[0].status, 'revoked');

  // Re-request limit (parent-initiated direction), against learner s2.
  await db.query(`UPDATE students SET user_id = $2 WHERE id = $1`, [s2, s2u.id]);
  for (let i = 0; i < MAX_LINK_REQUESTS_PER_LEARNER + 2; i++) {
    await requestChildLink(parentId, s2u.email);
    await respondToRequest(s2, parentId, false);
  }
  const rel = (await db.query(`SELECT status, request_count FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2`, [parentId, s2])).rows[0];
  check('SF-7 re-request limit: requests stop at the cap', [rel.status, rel.request_count], ['declined', MAX_LINK_REQUESTS_PER_LEARNER]);

  check('SF-7 column default no longer grants access', (await db.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'parent_student_relationships' AND column_name = 'status'`)).rows[0].column_default.includes('pending'), true);

  // ------------------------------------------------------------ CR-L9-02
  // s1 is ACTIVE in klass (so: an institution student). klass2 holds s1's ENDED row from the enrolment fixtures.
  const rowsOf = async (c: string, st: string) => (await db.query(`SELECT id, status FROM class_enrollments WHERE class_id = $1 AND student_id = $2 ORDER BY created_at, id`, [c, st])).rows;
  const opsCode = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return 'OK';
    } catch (error) {
      return error instanceof InstitutionOpsError ? error.code : `UNEXPECTED ${String((error as Error)?.message)}`;
    }
  };
  const endedBefore = await rowsOf(klass2, s1);
  check('CR-L9-02 precondition: one ENDED enrolment in the class', endedBefore.map((r: any) => r.status), ['ENDED']);
  await rejects('CR-L9-02 the database refuses to flip an ENDED row back to ACTIVE', () => db.query(`UPDATE class_enrollments SET status = 'ACTIVE' WHERE id = $1`, [endedBefore[0].id]), /CLASS_ENROLLMENT_CLOSED_ROW_IS_HISTORY/);
  const readd = await addStudentToClass(inst, klass2, s1u.email, cu.id);
  check('CR-L9-02 ended enrolment + coordinator add => INVITED, not enrolled', readd.outcome, 'INVITED');
  const afterReadd = await rowsOf(klass2, s1);
  check('CR-L9-02 ended enrolment + coordinator add => no direct ACTIVE', afterReadd.map((r: any) => r.status).sort(), ['ENDED', 'PENDING']);
  check('CR-L9-02 the historical ENDED row is preserved untouched', afterReadd.find((r: any) => r.id === endedBefore[0].id)?.status, 'ENDED');
  check('CR-L9-02 pending grants the teacher nothing', (await getClassEnrollmentState(klass2, s1)).open?.status, 'PENDING');
  check('CR-L9-02 adding again while pending => ALREADY_ENROLLED, no duplicate', await opsCode(() => addStudentToClass(inst, klass2, s1u.email, cu.id)), 'ALREADY_ENROLLED');
  check('CR-L9-02 still exactly one open row', (await rowsOf(klass2, s1)).filter((r: any) => r.status === 'PENDING').length, 1);
  check('CR-L9-02 direct enrol of an institution student into a class they left is refused', await opsCode(() => enrollInstitutionStudent(inst, s1, klass2, cu.id)), 'INVALID_STATE');
  const pendingId = (await getClassEnrollmentState(klass2, s1)).open!.id;
  check('CR-L9-02 the Student declines the new invitation', Boolean(await respondToClassInvitation(s1, pendingId, false)), true);
  check('CR-L9-02 history now holds both closed rows', (await rowsOf(klass2, s1)).map((r: any) => r.status).sort(), ['DECLINED', 'ENDED']);
  const afterDecline = await addStudentToClass(inst, klass2, s1u.email, cu.id);
  check('CR-L9-02 declined enrolment + coordinator add => INVITED, not enrolled', afterDecline.outcome, 'INVITED');
  check('CR-L9-02 declined enrolment + coordinator add => a NEW pending row, the DECLINED row kept', (await rowsOf(klass2, s1)).map((r: any) => r.status).sort(), ['DECLINED', 'ENDED', 'PENDING']);
  await rejects('CR-L9-02 the database refuses to flip a DECLINED row to ACTIVE', () => db.query(`UPDATE class_enrollments SET status = 'ACTIVE' WHERE id = $1`, [pendingId]), /CLASS_ENROLLMENT_CLOSED_ROW_IS_HISTORY/);
  const newPending = (await getClassEnrollmentState(klass2, s1)).open!.id;
  check('CR-L9-02 the new enrolment becomes ACTIVE only when the Student accepts', Boolean(await respondToClassInvitation(s1, newPending, true)), true);
  check('CR-L9-02 after acceptance: one ACTIVE row, history intact', (await rowsOf(klass2, s1)).map((r: any) => r.status).sort(), ['ACTIVE', 'DECLINED', 'ENDED']);
  check('CR-L9-02 active existing enrolment => ALREADY_ENROLLED', await opsCode(() => addStudentToClass(inst, klass2, s1u.email, cu.id)), 'ALREADY_ENROLLED');
  check('CR-L9-02 active existing enrolment => invite path says ALREADY_ACTIVE', (await inviteStudentToClass(inst, klass2, s1u.email, cu.id)).outcome, 'ALREADY_ACTIVE');
  check('CR-L9-02 active existing enrolment => no duplicate row', (await rowsOf(klass2, s1)).length, 3);
  await rejects('CR-L9-02 a second OPEN row is refused by the database', () => db.query(`INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'PENDING')`, [klass2, s1]), /uq_class_enrollments_one_open/);
  // A learner with NO history in the class keeps the existing direct path.
  const klass3 = (await db.query(`INSERT INTO classes (institution_id, name) VALUES ($1, 'K3') RETURNING id`, [inst])).rows[0].id;
  check('CR-L9-02 no history + institution student => existing direct enrolment preserved', (await addStudentToClass(inst, klass3, s1u.email, cu.id)).outcome, 'ENROLLED');
  // "Bulk" is the single add once per address (L9 IN-1): run it over a list that mixes the cases.
  const k3 = (await getClassEnrollmentState(klass3, s1)).open!.id;
  await endClassEnrollment(inst, klass3, k3);
  const bulk: string[] = [];
  for (const email of [s1u.email, s1u.email, 'nobody@l10.test']) bulk.push(await opsCode(async () => (await addStudentToClass(inst, klass3, email, cu.id)).outcome).then((c) => c));
  check('CR-L9-02 bulk (single add per address): never reactivates, never duplicates', bulk, ['OK', 'ALREADY_ENROLLED', 'NO_STUDENT_ACCOUNT']);
  check('CR-L9-02 bulk: the ended row is history and the only open row is PENDING', (await rowsOf(klass3, s1)).map((r: any) => r.status).sort(), ['ENDED', 'PENDING']);

  void randomUUID;
  console.log(`\nL10_INTEGRATION: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log('  - ' + f);
  await db.end();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('L10_INTEGRATION crashed:', error);
  await db.end().catch(() => {});
  process.exit(1);
});
