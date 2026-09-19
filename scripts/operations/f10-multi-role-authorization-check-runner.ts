/**
 * F10 -- MULTI-ROLE AUTHORIZATION CERTIFICATION CHECK (deferred item,
 * executed on request against the certified F10 candidate HEAD
 * 870f1a6). Proves PARENT-route authorization is not widened by
 * TEACHER authorization for the same actor.
 *
 * Fixture: User X holds BOTH an ACCEPTED Parent relationship to Child A
 * and an ACTIVE Teacher assignment (via an APPROVED institution
 * membership) covering Student B's class. Student B has NO Parent
 * relationship with User X. If the Parent Read Model's authorization
 * check is (incorrectly) the generic canAccessLearner(...,
 * 'LEARNER_PROGRESS_VIEW') -- which by design treats Parent OR Teacher
 * as equivalent for that permission, since both call sites legitimately
 * want "any authorized viewer" -- then Test 2 below will incorrectly
 * ALLOW, because User X's real Teacher access to Student B satisfies
 * that generic check even though the PARENT route has no business
 * granting Parent-labeled access via a Teacher relationship.
 */
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner, canTeacherAccessLearner } from '@/lib/authorization';
import { linkChildByEmail, respondToRequest } from '@/services/parent.service';
import { createInstitution, inviteInstitutionAdmin, requestTeacherMembership, decideMembership, createGrade, createClass, enrollStudent, createTeacherAssignment } from '@/services/institution.service';
import { getParentLearnerOverview, ParentAccessDeniedError } from '@/lib/parent/read-model.service';
import { db } from '@/lib/db';

function report(name: string, expected: string, actualPass: boolean, detail?: string) {
  const line = `${name}: expected=${expected} actual=${actualPass ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`;
  console.log(line);
  return actualPass;
}

async function seedChild(name: string, clerkSuffix: string): Promise<string> {
  const clerkId = `clerk_f10mr_${clerkSuffix}`;
  const email = `f10mr-${clerkSuffix}@test.local`;
  const result = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`, [clerkId, email, name]);
  const id = result.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [id, name]);
  return id;
}

async function main() {
  console.log('=== F10 MULTI-ROLE AUTHORIZATION CERTIFICATION CHECK ===');

  // --- User X: a legacy-shaped parent profile (user_id NULL), repaired via getOrCreateParentId, giving it BOTH the profiles-side parent identity and an F1 canonical actor id. ---
  const clerkX = 'clerk_f10mr_userx';
  const legacyProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'User X', $1, NULL) RETURNING id`,
    [clerkX]
  );
  const userXProfileId = legacyProfile.rows[0].id;
  const userXCanonical = await getOrCreateCanonicalUser(clerkX);
  await db.query(`UPDATE profiles SET user_id = $1 WHERE id = $2`, [userXCanonical.id, userXProfileId]);
  const userXActorId = userXCanonical.id;

  // --- Child A: accepted Parent relationship to User X ---
  const childA = await seedChild('Child A', 'childa');
  const childAEmail = (await db.query(`SELECT email FROM students WHERE id = $1`, [childA])).rows[0].email;
  await linkChildByEmail(userXProfileId, childAEmail);
  await respondToRequest(childA, userXProfileId, true);

  // --- Student B: Teacher-only access via Institution I / Class C, NO Parent relationship to User X ---
  const studentB = await seedChild('Student B', 'studentb');
  const institution = await createInstitution('F10 Multi-Role Check Institution');
  const adminUser = await db.query(`INSERT INTO users (clerk_id, email) VALUES ('clerk_f10mr_admin', 'f10mr-admin@test.local') RETURNING id`);
  const adminUserId = adminUser.rows[0].id;
  await inviteInstitutionAdmin(institution.id, adminUserId);

  const teacherMembership = await requestTeacherMembership(institution.id, userXActorId);
  const approved = await decideMembership(teacherMembership.id, adminUserId, 'APPROVED');
  if (!approved) throw new Error('fixture setup failed: teacher membership was not approved');

  const grade = await createGrade(institution.id, 'F10MR Grade');
  const classC = await createClass(institution.id, grade.id, 'Class C');
  await enrollStudent(classC.id, studentB);
  await createTeacherAssignment(teacherMembership.id, { classId: classC.id });

  // --- Fixture integrity check: confirm User X has NO Parent relationship with Student B ---
  const noParentRel = await db.query(
    `SELECT 1 FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2`,
    [userXProfileId, studentB]
  );
  if (noParentRel.rows.length > 0) throw new Error('fixture invalid: a parent_student_relationships row exists between User X and Student B');
  console.log('  fixture integrity: confirmed zero parent_student_relationships rows between User X and Student B');

  const results: boolean[] = [];

  // --- TEST 1: Parent Read Model, User X -> Child A -> ALLOW ---
  let test1Pass: boolean;
  try {
    const overview = await getParentLearnerOverview(userXActorId, childA);
    test1Pass = overview.studentId === childA;
  } catch {
    test1Pass = false;
  }
  results.push(report('TEST 1 (PARENT+TEACHER -> accepted Parent child, via Parent Read Model)', 'ALLOW', test1Pass));

  // --- TEST 2: Parent Read Model, User X -> Student B -> DENY (critical assertion) ---
  let test2Pass: boolean;
  try {
    await getParentLearnerOverview(userXActorId, studentB);
    test2Pass = false; // it must have thrown; reaching here is a FAIL
  } catch (error) {
    test2Pass = error instanceof ParentAccessDeniedError;
  }
  results.push(report('TEST 2 (PARENT+TEACHER -> Teacher-only Student B, via Parent Read Model -- CRITICAL)', 'DENY', test2Pass));

  // --- TEST 3: Teacher authorization path, User X -> Student B -> ALLOW (validates the fixture) ---
  const test3Pass = await canTeacherAccessLearner(userXActorId, studentB);
  results.push(report('TEST 3 (PARENT+TEACHER -> Teacher-only Student B, via Teacher authorization -- fixture validity)', 'ALLOW', test3Pass));

  // --- Diagnostic: show what the GENERIC canAccessLearner returns for Student B (expected to be true, since it treats Parent OR Teacher as equivalent for LEARNER_PROGRESS_VIEW by design -- this is NOT the bug by itself, it only becomes a bug if the Parent Read Model calls this generic check directly for a Parent-labeled route) ---
  const genericAllowsB = await canAccessLearner(userXActorId, studentB, 'LEARNER_PROGRESS_VIEW');
  console.log(`  diagnostic: generic canAccessLearner(User X, Student B, LEARNER_PROGRESS_VIEW) = ${genericAllowsB} (expected true -- Teacher access legitimately satisfies THIS generic permission; the Parent Read Model must not delegate to it directly)`);

  const allPass = results.every(Boolean);
  console.log('');
  console.log(`MULTI_ROLE_PARENT_ISOLATION: ${allPass ? 'PASS' : 'FAIL'}`);

  if (!allPass) {
    console.error('CERTIFICATION CHECK FAILED -- see above. Do not mark this item PASS.');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('Multi-role authorization check crashed with an unexpected error:', error);
  process.exit(1);
});
