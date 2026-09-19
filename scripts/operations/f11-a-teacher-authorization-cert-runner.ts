/**
 * F11-A -- invoked by f11-a-teacher-authorization-migration-cert.sh
 * against a real, ephemeral, local-only Postgres instance. Exercises
 * the full Teacher authorization boundary and Teacher Read Model using
 * the real service/read-model functions (never mocked): the 8 required
 * adversarial cases, multi-role Parent+Teacher isolation in both
 * directions, and class-roster isolation.
 */
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canTeacherAccessLearner } from '@/lib/authorization';
import {
  createInstitution,
  inviteInstitutionAdmin,
  requestTeacherMembership,
  decideMembership,
  revokeMembership,
  createGrade,
  createClass,
  enrollStudent,
  createTeacherAssignment,
  endTeacherAssignment,
} from '@/services/institution.service';
import { linkChildByEmail, respondToRequest } from '@/services/parent.service';
import { getTeacherAssignedClasses, getTeacherClassRoster, getTeacherStudentOverview, TeacherAccessDeniedError } from '@/lib/teacher/read-model.service';
import { getParentLearnerOverview, ParentAccessDeniedError } from '@/lib/parent/read-model.service';
import { db } from '@/lib/db';

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function assertTeacherDenied(promise: Promise<unknown>, message: string) {
  try {
    await promise;
    console.error(`ASSERTION FAILED: ${message} (expected TeacherAccessDeniedError, got no error)`);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof TeacherAccessDeniedError)) {
      console.error(`ASSERTION FAILED: ${message} (expected TeacherAccessDeniedError, got ${error})`);
      process.exit(1);
    }
    console.log(`  OK -- ${message}`);
  }
}

async function assertParentDenied(promise: Promise<unknown>, message: string) {
  try {
    await promise;
    console.error(`ASSERTION FAILED: ${message} (expected ParentAccessDeniedError, got no error)`);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof ParentAccessDeniedError)) {
      console.error(`ASSERTION FAILED: ${message} (expected ParentAccessDeniedError, got ${error})`);
      process.exit(1);
    }
    console.log(`  OK -- ${message}`);
  }
}

let studentCounter = 0;
async function seedStudent(name: string): Promise<string> {
  studentCounter += 1;
  const clerkId = `clerk_f11a_student_${studentCounter}`;
  const email = `f11a-student-${studentCounter}@test.local`;
  const result = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`, [clerkId, email, name]);
  const id = result.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [id, name]);
  return id;
}

let teacherCounter = 0;
async function seedTeacherActor(): Promise<{ actorUserId: string; clerkId: string }> {
  teacherCounter += 1;
  const clerkId = `clerk_f11a_teacher_${teacherCounter}`;
  const canonical = await getOrCreateCanonicalUser(clerkId, `f11a-teacher-${teacherCounter}@test.local`);
  return { actorUserId: canonical.id, clerkId };
}

async function seedAdmin(institutionLabel: string): Promise<string> {
  const result = await db.query(
    `INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`,
    [`clerk_f11a_admin_${institutionLabel}`, `f11a-admin-${institutionLabel}@test.local`]
  );
  return result.rows[0].id;
}

/** Full happy-path setup: Institution -> Grade -> Class -> approved Teacher membership + ACTIVE assignment to that class. Returns everything a case might need to then deviate from. */
async function seedFullTeacherClassFixture(label: string) {
  const institution = await createInstitution(`F11A Institution ${label}`);
  const adminUserId = await seedAdmin(label);
  await inviteInstitutionAdmin(institution.id, adminUserId);

  const teacher = await seedTeacherActor();
  const membership = await requestTeacherMembership(institution.id, teacher.actorUserId);
  const approved = await decideMembership(membership.id, adminUserId, 'APPROVED');
  if (!approved) throw new Error(`fixture setup failed: membership not approved for ${label}`);

  const grade = await createGrade(institution.id, `Grade ${label}`);
  const classA = await createClass(institution.id, grade.id, `Class ${label}`);
  const assignment = await createTeacherAssignment(membership.id, { classId: classA.id });

  return { institution, adminUserId, teacher, membership, grade, classA, assignment };
}

async function main() {
  console.log('=== F11-A TEACHER AUTHORIZATION CERTIFICATION ===');

  // --- CASE 1: Teacher assigned to Class A, Student A actively enrolled -> ALLOW ---
  const fx1 = await seedFullTeacherClassFixture('C1');
  const studentA1 = await seedStudent('Student A (case 1)');
  await enrollStudent(fx1.classA.id, studentA1);
  assert(await canTeacherAccessLearner(fx1.teacher.actorUserId, studentA1), 'Case 1: Teacher assigned to Class A, Student A enrolled in Class A -> ALLOW');
  const overview1 = await getTeacherStudentOverview(fx1.teacher.actorUserId, studentA1);
  assert(overview1.studentId === studentA1, 'Case 1: getTeacherStudentOverview succeeds for the enrolled student');

  // --- CASE 2: Teacher assigned to Class A, Student B NOT enrolled in Class A -> DENY ---
  const studentB2 = await seedStudent('Student B (case 2, unenrolled)');
  assert(!(await canTeacherAccessLearner(fx1.teacher.actorUserId, studentB2)), 'Case 2: Teacher assigned to Class A, Student B not enrolled anywhere -> DENY');
  await assertTeacherDenied(getTeacherStudentOverview(fx1.teacher.actorUserId, studentB2), 'Case 2: getTeacherStudentOverview denies for an unenrolled student');

  // --- CASE 3: Teacher NOT assigned to Class B, Student B enrolled in Class B -> DENY ---
  const classB3 = await createClass(fx1.institution.id, fx1.grade.id, 'Class B (case 3, teacher not assigned)');
  const studentB3 = await seedStudent('Student B (case 3)');
  await enrollStudent(classB3.id, studentB3);
  assert(!(await canTeacherAccessLearner(fx1.teacher.actorUserId, studentB3)), 'Case 3: Teacher not assigned to Class B, Student B enrolled there -> DENY');

  // --- CASE 4: Teacher belongs to Institution A, Student belongs only to Institution B -> DENY ---
  const fx4other = await seedFullTeacherClassFixture('C4-other-institution');
  const studentInB4 = await seedStudent('Student (case 4, institution B only)');
  await enrollStudent(fx4other.classA.id, studentInB4);
  // fx1's teacher (institution A) attempting to access a student who only exists in institution B's class
  assert(!(await canTeacherAccessLearner(fx1.teacher.actorUserId, studentInB4)), 'Case 4: Teacher from Institution A denied access to a student enrolled only in Institution B\'s class');

  // --- CASE 5: Teacher institution membership REVOKED, all else otherwise valid -> DENY ---
  const fx5 = await seedFullTeacherClassFixture('C5');
  const studentA5 = await seedStudent('Student A (case 5)');
  await enrollStudent(fx5.classA.id, studentA5);
  assert(await canTeacherAccessLearner(fx5.teacher.actorUserId, studentA5), 'Case 5 setup: access ALLOWED before revocation');
  await revokeMembership(fx5.membership.id, fx5.adminUserId);
  assert(!(await canTeacherAccessLearner(fx5.teacher.actorUserId, studentA5)), 'Case 5: revoked institution membership -> DENY, immediately');

  // --- CASE 6: Teacher assignment ENDED, membership + enrollment still valid -> DENY ---
  const fx6 = await seedFullTeacherClassFixture('C6');
  const studentA6 = await seedStudent('Student A (case 6)');
  await enrollStudent(fx6.classA.id, studentA6);
  assert(await canTeacherAccessLearner(fx6.teacher.actorUserId, studentA6), 'Case 6 setup: access ALLOWED before ending the assignment');
  await endTeacherAssignment(fx6.assignment.id);
  assert(!(await canTeacherAccessLearner(fx6.teacher.actorUserId, studentA6)), 'Case 6: ENDED teacher assignment -> DENY, membership and enrollment still otherwise valid');

  // --- CASE 7: Student class enrollment ENDED, membership + assignment still valid -> DENY ---
  const fx7 = await seedFullTeacherClassFixture('C7');
  const studentA7 = await seedStudent('Student A (case 7)');
  await enrollStudent(fx7.classA.id, studentA7);
  assert(await canTeacherAccessLearner(fx7.teacher.actorUserId, studentA7), 'Case 7 setup: access ALLOWED before ending the enrollment');
  await db.query(`UPDATE class_enrollments SET status = 'ENDED' WHERE class_id = $1 AND student_id = $2`, [fx7.classA.id, studentA7]);
  assert(!(await canTeacherAccessLearner(fx7.teacher.actorUserId, studentA7)), 'Case 7: ENDED class enrollment -> DENY, membership and assignment still otherwise valid');

  // --- CASE 8: actor has F1 user_roles TEACHER role but no institutional assignment at all -> DENY ---
  const roleOnlyTeacher = await seedTeacherActor();
  await db.query(
    `INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'TEACHER', 'ACTIVE', 'SELF_REGISTRATION')`,
    [roleOnlyTeacher.actorUserId]
  );
  const studentA8 = await seedStudent('Student A (case 8)');
  assert(!(await canTeacherAccessLearner(roleOnlyTeacher.actorUserId, studentA8)), 'Case 8: F1 TEACHER role granted, zero institution membership/assignment -> DENY');
  const classesForRoleOnly = await getTeacherAssignedClasses(roleOnlyTeacher.actorUserId);
  assert(classesForRoleOnly.length === 0, 'Case 8: getTeacherAssignedClasses returns empty for a role-only teacher, not an error');

  // --- MULTI-ROLE ISOLATION (mandatory gate): User Y is PARENT (accepted, Student A) + TEACHER (assignment, Student B) ---
  console.log('--- MULTI-ROLE ISOLATION ---');
  const fxMR = await seedFullTeacherClassFixture('MR');
  const userY = fxMR.teacher; // reuse the same canonical actor as both parent and teacher identity
  const studentAmr = await seedStudent('Student A (multi-role, Parent-only)');
  const studentBmr = await seedStudent('Student B (multi-role, Teacher-only)');
  await enrollStudent(fxMR.classA.id, studentBmr);

  // give User Y a parent profile + accepted relationship to Student A ONLY
  const parentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'User Y', $1, $2) RETURNING id`,
    [userY.clerkId, userY.actorUserId]
  );
  const userYParentProfileId = parentProfile.rows[0].id;
  const studentAmrEmail = (await db.query(`SELECT email FROM students WHERE id = $1`, [studentAmr])).rows[0].email;
  await linkChildByEmail(userYParentProfileId, studentAmrEmail);
  await respondToRequest(studentAmr, userYParentProfileId, true);

  // fixture integrity: confirm no parent relationship to Student B, and no teacher assignment covering Student A
  const noParentRelToB = await db.query(`SELECT 1 FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2`, [userYParentProfileId, studentBmr]);
  assert(noParentRelToB.rows.length === 0, 'Multi-role fixture integrity: zero parent_student_relationships between User Y and Student B');
  assert(!(await canTeacherAccessLearner(userY.actorUserId, studentAmr)), 'Multi-role fixture integrity: Teacher path alone does NOT reach Student A (confirms Student A is Parent-only)');

  await assertTeacherDenied(getTeacherStudentOverview(userY.actorUserId, studentAmr), 'Teacher API -> Student A (Parent-only relationship): DENY -- Parent relationship must not authorize Teacher API');
  const teacherToB = await getTeacherStudentOverview(userY.actorUserId, studentBmr);
  assert(teacherToB.studentId === studentBmr, 'Teacher API -> Student B (Teacher-only relationship): ALLOW');
  const parentToA = await getParentLearnerOverview(userY.actorUserId, studentAmr);
  assert(parentToA.studentId === studentAmr, 'Parent API -> Student A (accepted Parent relationship): ALLOW');
  await assertParentDenied(getParentLearnerOverview(userY.actorUserId, studentBmr), 'Parent API -> Student B (Teacher-only relationship): DENY -- Teacher relationship must not authorize Parent API');

  // --- CLASS ISOLATION ---
  console.log('--- CLASS ISOLATION ---');
  const fxCI = await seedFullTeacherClassFixture('CI-A');
  const classCIB = await createClass(fxCI.institution.id, fxCI.grade.id, 'Class CI-B (same teacher, second class)');
  await createTeacherAssignment(fxCI.membership.id, { classId: classCIB.id });

  const studentOnlyInA = await seedStudent('Student only in Class CI-A');
  const studentOnlyInB = await seedStudent('Student only in Class CI-B');
  const studentEndedInA = await seedStudent('Student with ENDED enrollment in Class CI-A');
  await enrollStudent(fxCI.classA.id, studentOnlyInA);
  await enrollStudent(classCIB.id, studentOnlyInB);
  await enrollStudent(fxCI.classA.id, studentEndedInA);
  await db.query(`UPDATE class_enrollments SET status = 'ENDED' WHERE class_id = $1 AND student_id = $2`, [fxCI.classA.id, studentEndedInA]);

  const otherInstitutionFixture = await seedFullTeacherClassFixture('CI-other-institution');
  const studentInOtherInstitution = await seedStudent('Student in another institution entirely');
  await enrollStudent(otherInstitutionFixture.classA.id, studentInOtherInstitution);

  const rosterA = await getTeacherClassRoster(fxCI.teacher.actorUserId, fxCI.classA.id);
  const rosterIds = rosterA.map((r) => r.studentId);
  assert(rosterIds.includes(studentOnlyInA), 'Class isolation: roster(Class CI-A) includes the actively-enrolled student');
  assert(!rosterIds.includes(studentOnlyInB), 'Class isolation: roster(Class CI-A) does NOT include a student exclusively enrolled in Class CI-B (same teacher, different class)');
  assert(!rosterIds.includes(studentEndedInA), 'Class isolation: roster(Class CI-A) does NOT include a student whose enrollment in THIS class is ENDED');
  assert(!rosterIds.includes(studentInOtherInstitution), 'Class isolation: roster(Class CI-A) does NOT include a student from another institution entirely');

  await assertTeacherDenied(getTeacherClassRoster(fxCI.teacher.actorUserId, otherInstitutionFixture.classA.id), 'Class isolation: this teacher cannot fetch the roster of a class in another institution');

  console.log('');
  console.log('=== F11-A TEACHER AUTHORIZATION CERTIFICATION: ALL ASSERTIONS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F11-A certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
