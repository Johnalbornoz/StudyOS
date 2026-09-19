/**
 * F10 -- invoked by f10-parent-experience-migration-cert.sh against a
 * real, ephemeral, local-only Postgres instance. Exercises the full
 * Parent Experience 2.0 lifecycle end to end using the real service
 * and read-model functions (never mocked): the identity fix, the
 * relationship lifecycle fixes, the authorization boundary, multi-
 * child isolation, Parent/Payer decoupling, read-only enforcement, and
 * a concurrency check.
 *
 * Scoping note (honest, not a silent gap): getOrCreateParentId's
 * BRAND-NEW-parent branch calls Clerk's currentUser(), which has no
 * session to resolve outside a real request -- this script instead
 * seeds a "legacy" profiles row (user_id NULL, exactly as a
 * pre-F10 parent would look) and calls getOrCreateParentId against it,
 * which exercises the EXISTING-ROW self-repair branch -- the same
 * getOrCreateCanonicalUser call, the same UPDATE, and the fix this
 * phase actually needed to prove. The brand-new-profile INSERT branch
 * differs only by which Clerk-authenticated fields it also writes
 * (name/email), not by the user_id-population logic under test.
 */
import { getOrCreateParentId } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { canUseCapability } from '@/lib/entitlements';
import { ensureSubscription } from '@/lib/entitlements/subscription.service';
import { linkChildByEmail, respondToRequest, revokeRelationshipByStudent, unlinkChild } from '@/services/parent.service';
import {
  getParentLearners,
  getParentLearnerOverview,
  getParentSubjectProgress,
  getParentAttentionAreas,
  getParentExamPreparation,
  ParentAccessDeniedError,
} from '@/lib/parent/read-model.service';
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

let childCounter = 0;
async function seedChild(name: string): Promise<string> {
  childCounter += 1;
  const clerkId = `clerk_f10_child_${childCounter}`;
  const email = `f10-child-${childCounter}@test.local`;
  const result = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`, [clerkId, email, name]);
  const id = result.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [id, name]);
  return id;
}

let parentCounter = 0;
async function seedLegacyParentAndRepair(): Promise<{ profileId: string; actorUserId: string; clerkId: string }> {
  parentCounter += 1;
  const clerkId = `clerk_f10_parent_${parentCounter}`;
  const inserted = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', $1, $2, NULL) RETURNING id`,
    [`Parent ${parentCounter}`, clerkId]
  );
  const legacyProfileId = inserted.rows[0].id;

  const repairedProfileId = await getOrCreateParentId(clerkId);
  assert(repairedProfileId === legacyProfileId, `getOrCreateParentId(${clerkId}) returns the SAME existing profile id, not a duplicate`);

  const row = await db.query(`SELECT user_id FROM profiles WHERE id = $1`, [legacyProfileId]);
  assert(row.rows[0].user_id !== null, `profiles.user_id backfilled from NULL for ${clerkId} (BUG #1 fix)`);

  const canonical = await getOrCreateCanonicalUser(clerkId);
  assert(row.rows[0].user_id === canonical.id, `backfilled user_id matches the F1 canonical users.id for ${clerkId}`);

  return { profileId: legacyProfileId, actorUserId: canonical.id, clerkId };
}

async function main() {
  console.log('--- SECTION 1: identity fix (BUG #1) ---');
  const p1 = await seedLegacyParentAndRepair();
  const repairedAgain = await getOrCreateParentId(p1.clerkId);
  assert(repairedAgain === p1.profileId, 'calling getOrCreateParentId a second time is a stable no-op (idempotent)');

  console.log('--- SECTION 2: zero-child state ---');
  const p2 = await seedLegacyParentAndRepair();
  const p2Learners = await getParentLearners(p2.actorUserId);
  assert(Array.isArray(p2Learners) && p2Learners.length === 0, 'a parent with zero accepted relationships gets an empty learner list, not an error');

  console.log('--- SECTION 3: pending grants no access; accept grants access ---');
  const p3 = await seedLegacyParentAndRepair();
  const childA = await seedChild('Child A');
  const childAEmail = (await db.query(`SELECT email FROM students WHERE id = $1`, [childA])).rows[0].email;

  await linkChildByEmail(p3.profileId, childAEmail);
  assert(!(await canAccessLearner(p3.actorUserId, childA, 'LEARNER_PROGRESS_VIEW')), 'PENDING relationship grants zero access (INV-F10-03)');
  await assertDenied(getParentLearnerOverview(p3.actorUserId, childA), 'getParentLearnerOverview denies while PENDING');

  await respondToRequest(childA, p3.profileId, true);
  assert(await canAccessLearner(p3.actorUserId, childA, 'LEARNER_PROGRESS_VIEW'), 'ACCEPTED relationship grants access (INV-F10-02)');
  const overviewA = await getParentLearnerOverview(p3.actorUserId, childA);
  assert(overviewA.studentId === childA, 'getParentLearnerOverview succeeds once ACCEPTED, returns the correct student');

  console.log('--- SECTION 4: cross-child denial ---');
  const childB = await seedChild('Child B');
  assert(!(await canAccessLearner(p3.actorUserId, childB, 'LEARNER_PROGRESS_VIEW')), 'Parent P3 has no relationship to Child B -> denied');
  await assertDenied(getParentSubjectProgress(p3.actorUserId, childB), 'getParentSubjectProgress denies for an unrelated child (cross-child leakage guard)');

  console.log('--- SECTION 5: revoke is immediate; re-request after revoke works (BUG #2 fix) ---');
  const revoked = await revokeRelationshipByStudent(childA, p3.profileId);
  assert(revoked === true, 'student-initiated revoke succeeds');
  assert(!(await canAccessLearner(p3.actorUserId, childA, 'LEARNER_PROGRESS_VIEW')), 'access denied IMMEDIATELY after revoke (INV-F10-04)');
  await assertDenied(getParentLearnerOverview(p3.actorUserId, childA), 'getParentLearnerOverview denies immediately after revoke');

  await linkChildByEmail(p3.profileId, childAEmail);
  const statusAfterRerequest = await db.query(
    `SELECT status FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2`,
    [p3.profileId, childA]
  );
  assert(statusAfterRerequest.rows[0].status === 'pending', 'a NEW request after revoke is possible and reaches pending (previously permanently blocked by ON CONFLICT DO NOTHING)');

  console.log('--- SECTION 6: multi-child isolation ---');
  const p4 = await seedLegacyParentAndRepair();
  const childD = await seedChild('Child D');
  const childE = await seedChild('Child E');
  const childF = await seedChild('Child F');
  await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Mathematics')`, [childD]);
  await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Biology')`, [childE]);

  for (const child of [childD, childE]) {
    const email = (await db.query(`SELECT email FROM students WHERE id = $1`, [child])).rows[0].email;
    await linkChildByEmail(p4.profileId, email);
    await respondToRequest(child, p4.profileId, true);
  }

  const p4Learners = await getParentLearners(p4.actorUserId);
  assert(p4Learners.length === 2 && p4Learners.every((l) => [childD, childE].includes(l.studentId)), 'getParentLearners returns exactly the 2 accepted children, no more, no less');

  const overviewD = await getParentLearnerOverview(p4.actorUserId, childD);
  const overviewE = await getParentLearnerOverview(p4.actorUserId, childE);
  assert(overviewD.subjectCount === 1 && overviewE.subjectCount === 1, 'each child has its own independent subject data');
  const subjectsD = await getParentSubjectProgress(p4.actorUserId, childD);
  const subjectsE = await getParentSubjectProgress(p4.actorUserId, childE);
  assert(subjectsD[0].name === 'Mathematics' && subjectsE[0].name === 'Biology', "switching context (D->E) returns each child's OWN distinct subject, never merged or mixed up");
  assert(!(await canAccessLearner(p4.actorUserId, childF, 'LEARNER_PROGRESS_VIEW')), 'Child F (never linked) remains denied regardless of P4 having 2 other active children');

  console.log('--- SECTION 7: Parent vs Payer decoupling (INV-F10-18) ---');
  const p5 = await seedLegacyParentAndRepair(); // payer, no relationship
  const p6 = await seedLegacyParentAndRepair(); // relationship, not payer
  const childG = await seedChild('Child G');
  const childGEmail = (await db.query(`SELECT email FROM students WHERE id = $1`, [childG])).rows[0].email;

  await ensureSubscription(childG, 'MONTHLY', p5.actorUserId);
  assert(await canUseCapability(p5.actorUserId, childG, 'BILLING_MANAGE'), 'P5 (the registered payer) can manage billing for Child G');
  assert(!(await canAccessLearner(p5.actorUserId, childG, 'LEARNER_PROGRESS_VIEW')), 'P5 being the PAYER grants ZERO learner-progress access without a relationship (payer != authorized parent)');

  await linkChildByEmail(p6.profileId, childGEmail);
  await respondToRequest(childG, p6.profileId, true);
  assert(await canAccessLearner(p6.actorUserId, childG, 'LEARNER_PROGRESS_VIEW'), 'P6 (accepted relationship, NOT the payer) can view Child G progress');
  assert(!(await canUseCapability(p6.actorUserId, childG, 'BILLING_MANAGE')), 'P6 having a relationship grants ZERO billing capability (relationship != payer)');

  console.log('--- SECTION 8: read-only boundary at the authorization layer ---');
  assert(
    !(await canAccessLearner(p6.actorUserId, childG, 'LEARNER_INTERVENTION_CREATE')),
    'an accepted PARENT relationship never satisfies LEARNER_INTERVENTION_CREATE -- Parent permissions are read-only by construction (task §40)'
  );

  console.log('--- SECTION 9: concurrency -- duplicate accept, duplicate revoke ---');
  const p7 = await seedLegacyParentAndRepair();
  const childH = await seedChild('Child H');
  const childHEmail = (await db.query(`SELECT email FROM students WHERE id = $1`, [childH])).rows[0].email;
  await linkChildByEmail(p7.profileId, childHEmail);

  await Promise.all([respondToRequest(childH, p7.profileId, true), respondToRequest(childH, p7.profileId, true)]);
  const afterDupAccept = await db.query(
    `SELECT count(*)::int AS n FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2 AND status = 'accepted'`,
    [p7.profileId, childH]
  );
  assert(afterDupAccept.rows[0].n === 1, 'two concurrent accept calls result in exactly ONE accepted row, never a duplicate or an error');

  await Promise.all([revokeRelationshipByStudent(childH, p7.profileId), revokeRelationshipByStudent(childH, p7.profileId)]);
  const afterDupRevoke = await db.query(
    `SELECT status, count(*)::int AS n FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2 GROUP BY status`,
    [p7.profileId, childH]
  );
  assert(afterDupRevoke.rows.length === 1 && afterDupRevoke.rows[0].status === 'revoked' && afterDupRevoke.rows[0].n === 1, 'two concurrent revoke calls result in exactly ONE row, status revoked, no duplicate row created');

  console.log('--- SECTION 10: read-model data correctness with real seeded data ---');
  const p8 = await seedLegacyParentAndRepair();
  const childI = await seedChild('Child I');
  const childIEmail = (await db.query(`SELECT email FROM students WHERE id = $1`, [childI])).rows[0].email;
  const subjResult = await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [childI]);
  const subjectId = subjResult.rows[0].id;
  const conceptResult = await db.query(
    `INSERT INTO concepts (id, subject_id, canonical_id) VALUES (gen_random_uuid(), $1, 'chem.moles') RETURNING id`,
    [subjectId]
  );
  const conceptId = conceptResult.rows[0].id;
  await db.query(
    `INSERT INTO mastery_records (student_id, concept_id, subject_id, mastery_score, attempt_count) VALUES ($1, $2, $3, 42, 3)`,
    [childI, conceptId, subjectId]
  );
  await db.query(
    `INSERT INTO learning_debt (student_id, concept_id, subject_id, severity, status) VALUES ($1, $2, $3, 3, 'active')`,
    [childI, conceptId, subjectId]
  );

  await linkChildByEmail(p8.profileId, childIEmail);
  await respondToRequest(childI, p8.profileId, true);

  const subjectsI = await getParentSubjectProgress(p8.actorUserId, childI);
  assert(subjectsI.length === 1 && subjectsI[0].conceptsWithQualifyingEvidence === 1, 'real mastery record is correctly reflected as 1 concept with qualifying evidence');
  const attentionI = await getParentAttentionAreas(p8.actorUserId, childI);
  assert(
    attentionI.some((a) => a.category === 'KNOWLEDGE_PRACTICE_NEEDED'),
    'a real active learning-debt row surfaces as a KNOWLEDGE_PRACTICE_NEEDED attention area'
  );

  const examPrepNone = await getParentExamPreparation(p8.actorUserId, childI);
  assert(examPrepNone === null, 'a child with no active Exam Profile returns null exam prep, not a fabricated status (task §17 zero-state)');

  console.log('--- SECTION 11: performance baseline (characterization only, local ephemeral Postgres, small samples) ---');
  async function timeSamples(label: string, fn: () => Promise<unknown>, samples: number) {
    const durations: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await fn();
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const max = durations[durations.length - 1];
    console.log(`  ${label}: samples=${samples} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
  }

  await timeSamples('getParentLearners', () => getParentLearners(p4.actorUserId), 20);
  await timeSamples('getParentLearnerOverview', () => getParentLearnerOverview(p4.actorUserId, childD), 20);
  await timeSamples('getParentSubjectProgress', () => getParentSubjectProgress(p4.actorUserId, childD), 20);
  await timeSamples('getParentAttentionAreas', () => getParentAttentionAreas(p8.actorUserId, childI), 20);
  await timeSamples('multi-child switch (D->E->D)', async () => {
    await getParentLearnerOverview(p4.actorUserId, childD);
    await getParentLearnerOverview(p4.actorUserId, childE);
  }, 20);

  console.log('');
  console.log('=== F10 lifecycle certification: ALL ASSERTIONS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F10 lifecycle certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
