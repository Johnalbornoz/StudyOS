/**
 * F11-B -- invoked by f11b-teacher-intervention-migration-cert.sh
 * against a real, ephemeral, local-only Postgres instance. Exercises
 * the Teacher Intervention domain's full authorization boundary (reuse
 * of F11-A's canonical checks), the assign/view/cancel lifecycle, and
 * the real DB-level CHECK constraints -- never mocked.
 */
import { getOrCreateCanonicalUser } from '@/lib/identity';
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
import {
  assignTeacherIntervention,
  listTeacherInterventionsForStudent,
  cancelTeacherIntervention,
  TeacherInterventionAccessDeniedError,
  TeacherInterventionInvalidTargetError,
} from '@/lib/teacher/intervention.service';
import { db } from '@/lib/db';

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function assertDenied(promise: Promise<unknown>, message: string) {
  try {
    await promise;
    console.error(`ASSERTION FAILED: ${message} (expected TeacherInterventionAccessDeniedError, got no error)`);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof TeacherInterventionAccessDeniedError)) {
      console.error(`ASSERTION FAILED: ${message} (expected TeacherInterventionAccessDeniedError, got ${error})`);
      process.exit(1);
    }
    console.log(`  OK -- ${message}`);
  }
}

let studentCounter = 0;
async function seedStudent(name: string): Promise<string> {
  studentCounter += 1;
  const clerkId = `clerk_f11b_student_${studentCounter}`;
  const email = `f11b-student-${studentCounter}@test.local`;
  const result = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`, [clerkId, email, name]);
  const id = result.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [id, name]);
  return id;
}

async function makeStudentOwnerActor(studentId: string, clerkSuffix: string): Promise<string> {
  const canonical = await getOrCreateCanonicalUser(`clerk_f11b_owner_${clerkSuffix}`, `f11b-owner-${clerkSuffix}@test.local`);
  await db.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [canonical.id, studentId]);
  return canonical.id;
}

let teacherCounter = 0;
async function seedTeacherActor(): Promise<{ actorUserId: string; clerkId: string }> {
  teacherCounter += 1;
  const clerkId = `clerk_f11b_teacher_${teacherCounter}`;
  const canonical = await getOrCreateCanonicalUser(clerkId, `f11b-teacher-${teacherCounter}@test.local`);
  return { actorUserId: canonical.id, clerkId };
}

async function seedAdmin(label: string): Promise<string> {
  const result = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`clerk_f11b_admin_${label}`, `f11b-admin-${label}@test.local`]);
  return result.rows[0].id;
}

async function seedFullTeacherClassFixture(label: string) {
  const institution = await createInstitution(`F11B Institution ${label}`);
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

async function seedConcept(subjectId: string, label: string): Promise<string> {
  const result = await db.query(`INSERT INTO concepts (id, subject_id, canonical_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [subjectId, `f11b.${label}`]);
  return result.rows[0].id;
}

async function main() {
  console.log('=== F11-B TEACHER INTERVENTION DOMAIN CERTIFICATION ===');

  // --- Happy path: authorized Teacher -> assigned learner -> ALLOW, full assign/view/cancel lifecycle ---
  const fx1 = await seedFullTeacherClassFixture('HAPPY');
  const studentA1 = await seedStudent('Student A (happy path)');
  await enrollStudent(fx1.classA.id, studentA1);
  const subjectResult = await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Math') RETURNING id`, [studentA1]);
  const conceptA1 = await seedConcept(subjectResult.rows[0].id, 'happy');

  const assigned1 = await assignTeacherIntervention(fx1.teacher.actorUserId, {
    classId: fx1.classA.id,
    studentId: studentA1,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    reason: 'Struggling with fractions',
    instructions: 'Complete 5 practice problems',
  });
  assert(assigned1.status === 'ASSIGNED', 'Case 1: authorized Teacher -> assigned learner -> ALLOW, row created with status ASSIGNED');
  assert(assigned1.institutionId === fx1.institution.id, 'Case 1: institution_id correctly resolved from the class, not client-supplied');

  const viewed1 = await listTeacherInterventionsForStudent(fx1.teacher.actorUserId, studentA1);
  assert(viewed1.length === 1 && viewed1[0].id === assigned1.id, 'View: TEACHER_INTERVENTION_VIEW returns the assigned intervention');

  const cancelled1 = await cancelTeacherIntervention(fx1.teacher.actorUserId, assigned1.id, 'No longer needed');
  assert(cancelled1.status === 'CANCELLED', 'Cancel: TEACHER_INTERVENTION_CANCEL transitions ASSIGNED -> CANCELLED');
  assert(cancelled1.cancellationReason === 'No longer needed', 'Cancel: cancellation_reason recorded');

  const cancelledAgain1 = await cancelTeacherIntervention(fx1.teacher.actorUserId, assigned1.id, 'second attempt');
  assert(cancelledAgain1.status === 'CANCELLED' && cancelledAgain1.cancellationReason === 'No longer needed', 'Cancel: cancelling an already-CANCELLED row is a no-op, never re-decides history');

  // --- Case 2: TEACHER role alone, no institution assignment -> DENY ---
  const roleOnlyTeacher = await seedTeacherActor();
  await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'TEACHER', 'ACTIVE', 'SELF_REGISTRATION')`, [roleOnlyTeacher.actorUserId]);
  const studentA2 = await seedStudent('Student A (case 2)');
  await enrollStudent(fx1.classA.id, studentA2);
  await assertDenied(
    assignTeacherIntervention(roleOnlyTeacher.actorUserId, {
      classId: fx1.classA.id,
      studentId: studentA2,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Case 2: F1 TEACHER role alone, zero institution assignment -> DENY'
  );

  // --- Case 3: Teacher from another class -> DENY ---
  const fx3 = await seedFullTeacherClassFixture('C3');
  const studentInFx1 = await seedStudent('Student in Class HAPPY, not C3');
  await enrollStudent(fx1.classA.id, studentInFx1);
  await assertDenied(
    assignTeacherIntervention(fx3.teacher.actorUserId, {
      classId: fx1.classA.id, // fx3's teacher has no assignment to fx1's class
      studentId: studentInFx1,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Case 3: Teacher not assigned to the target class -> DENY'
  );

  // --- Case 4: Teacher from another institution -> DENY ---
  const fx4 = await seedFullTeacherClassFixture('C4-other-institution');
  const studentInFx4 = await seedStudent('Student in another institution');
  await enrollStudent(fx4.classA.id, studentInFx4);
  await assertDenied(
    assignTeacherIntervention(fx1.teacher.actorUserId, {
      classId: fx4.classA.id,
      studentId: studentInFx4,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Case 4: Teacher from Institution A cannot assign into Institution B\'s class'
  );

  // --- Case 5: inactive (revoked) membership -> DENY ---
  const fx5 = await seedFullTeacherClassFixture('C5');
  const studentA5 = await seedStudent('Student A (case 5)');
  await enrollStudent(fx5.classA.id, studentA5);
  await revokeMembership(fx5.membership.id, fx5.adminUserId);
  await assertDenied(
    assignTeacherIntervention(fx5.teacher.actorUserId, {
      classId: fx5.classA.id,
      studentId: studentA5,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Case 5: revoked institution membership -> DENY'
  );

  // --- Case 6: inactive teacher assignment -> DENY ---
  const fx6 = await seedFullTeacherClassFixture('C6');
  const studentA6 = await seedStudent('Student A (case 6)');
  await enrollStudent(fx6.classA.id, studentA6);
  await endTeacherAssignment(fx6.assignment.id);
  await assertDenied(
    assignTeacherIntervention(fx6.teacher.actorUserId, {
      classId: fx6.classA.id,
      studentId: studentA6,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Case 6: ENDED teacher assignment -> DENY'
  );

  // --- Case 7: inactive class enrollment -> DENY ---
  const fx7 = await seedFullTeacherClassFixture('C7');
  const studentA7 = await seedStudent('Student A (case 7)');
  await enrollStudent(fx7.classA.id, studentA7);
  await db.query(`UPDATE class_enrollments SET status = 'ENDED' WHERE class_id = $1 AND student_id = $2`, [fx7.classA.id, studentA7]);
  await assertDenied(
    assignTeacherIntervention(fx7.teacher.actorUserId, {
      classId: fx7.classA.id,
      studentId: studentA7,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Case 7: ENDED class enrollment -> DENY'
  );

  // --- Cases 8/9/10: multi-role PARENT+TEACHER + OWNER isolation ---
  console.log('--- MULTI-ROLE / OWNER ISOLATION ---');
  const fxMR = await seedFullTeacherClassFixture('MR');
  const userY = fxMR.teacher;
  const studentParentOnly = await seedStudent('Student (Parent-only relationship to User Y)');
  const studentTeacherOnly = await seedStudent('Student (Teacher-only relationship to User Y)');
  await enrollStudent(fxMR.classA.id, studentTeacherOnly);

  const parentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'User Y', $1, $2) RETURNING id`,
    [userY.clerkId, userY.actorUserId]
  );
  const userYParentProfileId = parentProfile.rows[0].id;
  const parentOnlyEmail = (await db.query(`SELECT email FROM students WHERE id = $1`, [studentParentOnly])).rows[0].email;
  await linkChildByEmail(userYParentProfileId, parentOnlyEmail);
  await respondToRequest(studentParentOnly, userYParentProfileId, true);

  await assertDenied(
    assignTeacherIntervention(userY.actorUserId, {
      classId: fxMR.classA.id,
      studentId: studentParentOnly,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Case 8/10: PARENT+TEACHER actor cannot use the Parent relationship to assign a Teacher intervention (Parent-only student, not enrolled in any of this teacher\'s classes)'
  );
  await assertDenied(
    listTeacherInterventionsForStudent(userY.actorUserId, studentParentOnly),
    'Case 8/10: PARENT+TEACHER actor cannot VIEW interventions for the Parent-only student via the Teacher surface'
  );

  const assignedToTeacherOnly = await assignTeacherIntervention(userY.actorUserId, {
    classId: fxMR.classA.id,
    studentId: studentTeacherOnly,
    interventionType: 'SKILL_PRACTICE',
    target: { targetType: 'CONCEPT', conceptId: conceptA1 },
  });
  assert(assignedToTeacherOnly.studentId === studentTeacherOnly, 'Multi-role fixture validity: the SAME actor CAN assign to the Teacher-only student (proves the denial above is real isolation, not a broken fixture)');

  // --- Case 9: OWNER relationship -> DENY (a student cannot Teacher-assign themselves) ---
  const studentOwnerActorId = await makeStudentOwnerActor(studentTeacherOnly, 'self');
  await assertDenied(
    assignTeacherIntervention(studentOwnerActorId, {
      classId: fxMR.classA.id,
      studentId: studentTeacherOnly,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Case 9: the learner\'s own OWNER relationship (self) does not satisfy Teacher intervention authorization'
  );

  // --- Class-roster leakage: teacher assigned to Class A only cannot target a student on a DIFFERENT class they're also assigned to, by supplying the wrong classId ---
  console.log('--- CLASS ISOLATION ---');
  const fxCI = await seedFullTeacherClassFixture('CI-A');
  const classCIB = await createClass(fxCI.institution.id, fxCI.grade.id, 'Class CI-B (same teacher, second class)');
  await createTeacherAssignment(fxCI.membership.id, { classId: classCIB.id });
  const studentOnlyInB = await seedStudent('Student only in Class CI-B');
  await enrollStudent(classCIB.id, studentOnlyInB);

  await assertDenied(
    assignTeacherIntervention(fxCI.teacher.actorUserId, {
      classId: fxCI.classA.id, // wrong class for this student, even though same teacher IS legitimately assigned to classCIB
      studentId: studentOnlyInB,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: conceptA1 },
    }),
    'Class isolation: supplying the WRONG classId denies assignment even though the teacher legitimately teaches this student in a DIFFERENT class -- class_id must match the real active enrollment'
  );
  const correctlyAssigned = await assignTeacherIntervention(fxCI.teacher.actorUserId, {
    classId: classCIB.id, // correct class
    studentId: studentOnlyInB,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: conceptA1 },
  });
  assert(correctlyAssigned.classId === classCIB.id, 'Class isolation: assignment succeeds once the CORRECT class_id (matching the real active enrollment) is supplied');

  // --- DB-level CHECK constraint proofs (cannot be proven by unit tests, real Postgres only) ---
  console.log('--- DATABASE CHECK CONSTRAINTS ---');
  let targetMismatchRejected = false;
  try {
    await db.query(
      `INSERT INTO teacher_interventions (assigned_by_user_id, institution_id, class_id, student_id, target_type, concept_id, skill_id, intervention_type)
       VALUES ($1, $2, $3, $4, 'CONCEPT', NULL, gen_random_uuid(), 'CONCEPT_REINFORCEMENT')`,
      [fx1.teacher.actorUserId, fx1.institution.id, fx1.classA.id, studentA1]
    );
  } catch (error: any) {
    targetMismatchRejected = error?.code === '23514'; // check_violation
  }
  assert(targetMismatchRejected, 'DB CHECK: target_type=CONCEPT with a NULL concept_id and a non-NULL skill_id is rejected at the database level');

  let invalidTargetFkRejected = false;
  try {
    await assignTeacherIntervention(fx1.teacher.actorUserId, {
      classId: fx1.classA.id,
      studentId: studentA1,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: '00000000-0000-4000-8000-000000000000' },
    });
  } catch (error) {
    invalidTargetFkRejected = error instanceof TeacherInterventionInvalidTargetError;
  }
  assert(invalidTargetFkRejected, 'A well-formed but nonexistent conceptId is rejected as TeacherInterventionInvalidTargetError, not a raw FK-violation crash');

  console.log('');
  console.log('=== F11-B TEACHER INTERVENTION DOMAIN CERTIFICATION: ALL ASSERTIONS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F11-B certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
