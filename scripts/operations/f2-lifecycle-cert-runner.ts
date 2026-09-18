/**
 * F2 -- invoked by f2-authorization-migration-cert.sh against a real,
 * ephemeral, local-only Postgres instance. Exercises the full
 * institution/membership/assignment/relationship lifecycle end to end
 * using the real service functions (never mocked), then proves
 * revocation removes access without deleting any historical row.
 */
import {
  createInstitution,
  inviteInstitutionAdmin,
  requestTeacherMembership,
  listPendingMemberships,
  decideMembership,
  revokeMembership,
  createGrade,
  createClass,
  enrollStudent,
  createTeacherAssignment,
} from '@/services/institution.service';
import { canAccessLearner, canTeacherAccessLearner, canAccessInstitution } from '@/lib/authorization';
import { unlinkChild, linkChildByEmail, respondToRequest, verifyParentAccess, revokeRelationshipByStudent } from '@/services/parent.service';
import { db } from '@/lib/db';

const LEARNER_ID = '55555555-5555-4555-8555-555555555555';
const LEARNER_USER_ID = '66666666-6666-4666-8666-666666666666';
const TEACHER_USER_ID = '77777777-7777-4777-8777-777777777777';

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function main() {
  // --- Institution + Admin (controlled invitation, never self-service) ---
  const institution = await createInstitution('Certification Test Institution');
  assert(institution.status === 'ACTIVE', 'institution created ACTIVE');

  const adminUserResult = await db.query(
    `INSERT INTO users (clerk_id, email) VALUES ('clerk_admin_1', 'admin1@test.local') RETURNING id`
  );
  const adminUserId = adminUserResult.rows[0].id;
  const adminMembership = await inviteInstitutionAdmin(institution.id, adminUserId);
  assert(adminMembership.status === 'APPROVED', 'invited institution admin is immediately APPROVED (invitation = decision)');
  assert(await canAccessInstitution(adminUserId, institution.id, 'INSTITUTION_MEMBER_APPROVE'), 'the invited admin can approve memberships for THIS institution');
  assert(!(await canAccessInstitution(TEACHER_USER_ID, institution.id, 'INSTITUTION_MEMBER_APPROVE')), 'a random user (not invited) cannot approve memberships');

  // --- Teacher membership: request -> PENDING -> zero access -> approve -> still zero learner access without an assignment ---
  const teacherMembership = await requestTeacherMembership(institution.id, TEACHER_USER_ID);
  assert(teacherMembership.status === 'PENDING', 'teacher self-service request starts PENDING');
  assert(!(await canTeacherAccessLearner(TEACHER_USER_ID, LEARNER_ID)), 'PENDING membership grants zero learner access');

  const pending = await listPendingMemberships(institution.id);
  assert(pending.some((m) => m.id === teacherMembership.id), 'the pending request is visible to the institution');

  const decided = await decideMembership(teacherMembership.id, adminUserId, 'APPROVED');
  assert(decided === true, 'admin approves the teacher membership');
  assert(!(await canTeacherAccessLearner(TEACHER_USER_ID, LEARNER_ID)), 'APPROVED membership WITHOUT an assignment still grants zero learner access (AC-F2-08)');

  const decidedAgain = await decideMembership(teacherMembership.id, adminUserId, 'APPROVED');
  assert(decidedAgain === false, 'deciding an already-decided membership is a no-op, never re-decides history');

  // --- Grade/Class/Enrollment + Assignment: the scope that actually grants access ---
  const grade = await createGrade(institution.id, 'Grade 10');
  const classA = await createClass(institution.id, grade.id, '10A');
  const classB = await createClass(institution.id, grade.id, '10B');
  await enrollStudent(classA.id, LEARNER_ID);

  const assignmentToClassB = await createTeacherAssignment(teacherMembership.id, { classId: classB.id, subjectLabel: 'Mathematics' });
  assert(assignmentToClassB.status === 'ACTIVE', 'assignment to Class 10B created ACTIVE');
  assert(!(await canTeacherAccessLearner(TEACHER_USER_ID, LEARNER_ID)), 'an assignment to a DIFFERENT class (10B) does not grant access to a student enrolled in 10A');

  const assignmentToClassA = await createTeacherAssignment(teacherMembership.id, { classId: classA.id, subjectLabel: 'Mathematics' });
  assert(await canTeacherAccessLearner(TEACHER_USER_ID, LEARNER_ID), 'an ACTIVE assignment matching the student\'s actual class (10A) grants scoped access');
  assert(await canAccessLearner(TEACHER_USER_ID, LEARNER_ID, 'LEARNER_PROGRESS_VIEW'), 'the central canAccessLearner also resolves this to true via the teacher path');
  assert(!(await canAccessLearner(TEACHER_USER_ID, LEARNER_ID, 'LEARNER_INTERVENTION_CREATE')), 'the teacher still cannot satisfy a permission that is not in the teacher-permitted set');

  // --- Revocation: membership revoke cascades to end assignments, WITHOUT deleting anything ---
  const beforeAssignmentCount = await db.query(`SELECT COUNT(*)::int AS c FROM teacher_assignments`);
  const beforeMembershipCount = await db.query(`SELECT COUNT(*)::int AS c FROM institution_memberships`);

  const revoked = await revokeMembership(teacherMembership.id, adminUserId);
  assert(revoked === true, 'admin revokes the teacher membership');
  assert(!(await canTeacherAccessLearner(TEACHER_USER_ID, LEARNER_ID)), 'access is denied IMMEDIATELY after revocation');

  const afterAssignmentCount = await db.query(`SELECT COUNT(*)::int AS c FROM teacher_assignments`);
  const afterMembershipCount = await db.query(`SELECT COUNT(*)::int AS c FROM institution_memberships`);
  assert(afterAssignmentCount.rows[0].c === beforeAssignmentCount.rows[0].c, 'zero teacher_assignments rows were deleted by revocation (only status changed)');
  assert(afterMembershipCount.rows[0].c === beforeMembershipCount.rows[0].c, 'zero institution_memberships rows were deleted by revocation');

  const assignmentStatus = await db.query(`SELECT status FROM teacher_assignments WHERE id = $1`, [assignmentToClassA.id]);
  assert(assignmentStatus.rows[0].status === 'ENDED', 'the assignment historical row still exists, now with status ENDED (not deleted)');

  const membershipStatus = await db.query(`SELECT status FROM institution_memberships WHERE id = $1`, [teacherMembership.id]);
  assert(membershipStatus.rows[0].status === 'REVOKED', 'the membership historical row still exists, now with status REVOKED (not deleted)');

  // --- Parent relationship lifecycle: request -> accept -> revoke, zero data loss ---
  await db.query(`INSERT INTO profiles (id, user_type, full_name, clerk_id) VALUES ('88888888-8888-4888-8888-888888888888', 'parent', 'Parent One', 'clerk_parent_1')`);
  await db.query(`INSERT INTO users (id, clerk_id, email) VALUES ('88888888-8888-4888-8888-888888888888', 'clerk_parent_1', 'parent1@test.local')`);
  await db.query(`UPDATE profiles SET user_id = '88888888-8888-4888-8888-888888888888' WHERE id = '88888888-8888-4888-8888-888888888888'`);

  const link = await linkChildByEmail('88888888-8888-4888-8888-888888888888', 'learner1@test.local');
  assert(link.status === 'pending', 'parent link request starts pending');
  assert(!(await verifyParentAccess('88888888-8888-4888-8888-888888888888', LEARNER_ID)), 'PENDING relationship grants zero access');
  assert(!(await canAccessLearner('88888888-8888-4888-8888-888888888888', LEARNER_ID, 'LEARNER_PROGRESS_VIEW')), 'central service also denies for a pending relationship');

  await respondToRequest(LEARNER_ID, '88888888-8888-4888-8888-888888888888', true);
  assert(await verifyParentAccess('88888888-8888-4888-8888-888888888888', LEARNER_ID), 'ACCEPTED relationship grants access');
  assert(await canAccessLearner('88888888-8888-4888-8888-888888888888', LEARNER_ID, 'LEARNER_PROGRESS_VIEW'), 'central service allows LEARNER_PROGRESS_VIEW for an accepted parent');
  assert(!(await canAccessLearner('88888888-8888-4888-8888-888888888888', LEARNER_ID, 'LEARNER_INTERVENTION_CREATE')), 'central service still denies a permission not in PARENT_PERMISSIONS');

  const beforeRelCount = await db.query(`SELECT COUNT(*)::int AS c FROM parent_student_relationships`);
  const revokedByStudent = await revokeRelationshipByStudent(LEARNER_ID, '88888888-8888-4888-8888-888888888888');
  assert(revokedByStudent === true, 'the learner revokes the now-accepted relationship themselves');
  assert(!(await verifyParentAccess('88888888-8888-4888-8888-888888888888', LEARNER_ID)), 'access denied immediately after student-initiated revocation');
  const afterRelCount = await db.query(`SELECT COUNT(*)::int AS c FROM parent_student_relationships`);
  assert(afterRelCount.rows[0].c === beforeRelCount.rows[0].c, 'zero parent_student_relationships rows deleted by revocation');
  const relStatus = await db.query(`SELECT status FROM parent_student_relationships WHERE student_id = $1 AND parent_id = $2`, [LEARNER_ID, '88888888-8888-4888-8888-888888888888']);
  assert(relStatus.rows[0].status === 'revoked', 'the relationship historical row still exists with status revoked');

  // --- Data preservation: learner/evidence-adjacent counts unchanged throughout ---
  const studentCount = await db.query(`SELECT COUNT(*)::int AS c FROM students`);
  assert(studentCount.rows[0].c === 1, 'exactly the 1 seeded student still exists -- none created/deleted by any F2 operation');

  console.log('\nAll F2 lifecycle assertions passed against real PostgreSQL.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F2 lifecycle cert failed:', err);
    process.exit(1);
  });
