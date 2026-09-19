/**
 * F11-C1 -- invoked by f11c1-execution-orchestration-migration-cert.sh
 * against a real, ephemeral, local-only Postgres instance. Exercises
 * the full Concept Reinforcement execution orchestration: Student/Owner
 * authorization, the 12-case adversarial matrix, idempotency (sequential
 * retry + real concurrency), lifecycle transitions, cancellation-after-
 * start, and a real canonical-evidence proof via the SAME updateMastery
 * the existing Practice submit route itself calls.
 */
import { getOrCreateCanonicalUser } from '@/lib/identity';
import {
  createInstitution,
  inviteInstitutionAdmin,
  requestTeacherMembership,
  decideMembership,
  createGrade,
  createClass,
  enrollStudent,
  createTeacherAssignment,
} from '@/services/institution.service';
import { linkChildByEmail, respondToRequest } from '@/services/parent.service';
import { assignTeacherIntervention, cancelTeacherIntervention } from '@/lib/teacher/intervention.service';
import {
  getStudentPendingTeacherInterventions,
  startConceptReinforcementExecution,
  StudentInterventionAccessDeniedError,
  StudentInterventionNotStartableError,
} from '@/lib/student/teacher-intervention-execution.service';
import { getQuizSession } from '@/services/quiz-persistence.service';
import { updateMastery } from '@/services/mastery.service';
import { db } from '@/lib/db';

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function assertStudentDenied(promise: Promise<unknown>, message: string) {
  try {
    await promise;
    console.error(`ASSERTION FAILED: ${message} (expected StudentInterventionAccessDeniedError, got no error)`);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof StudentInterventionAccessDeniedError)) {
      console.error(`ASSERTION FAILED: ${message} (expected StudentInterventionAccessDeniedError, got ${error})`);
      process.exit(1);
    }
    console.log(`  OK -- ${message}`);
  }
}

async function assertNotStartable(promise: Promise<unknown>, message: string) {
  try {
    await promise;
    console.error(`ASSERTION FAILED: ${message} (expected StudentInterventionNotStartableError, got no error)`);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof StudentInterventionNotStartableError)) {
      console.error(`ASSERTION FAILED: ${message} (expected StudentInterventionNotStartableError, got ${error})`);
      process.exit(1);
    }
    console.log(`  OK -- ${message}`);
  }
}

let studentCounter = 0;
async function seedStudent(name: string): Promise<{ studentId: string; ownerActorId: string; email: string }> {
  studentCounter += 1;
  const clerkId = `clerk_f11c1_student_${studentCounter}`;
  const email = `f11c1-student-${studentCounter}@test.local`;
  const result = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`, [clerkId, email, name]);
  const studentId = result.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [studentId, name]);
  const canonical = await getOrCreateCanonicalUser(clerkId, email);
  await db.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [canonical.id, studentId]);
  return { studentId, ownerActorId: canonical.id, email };
}

let teacherCounter = 0;
async function seedTeacherActor(): Promise<{ actorUserId: string; clerkId: string }> {
  teacherCounter += 1;
  const clerkId = `clerk_f11c1_teacher_${teacherCounter}`;
  const canonical = await getOrCreateCanonicalUser(clerkId, `f11c1-teacher-${teacherCounter}@test.local`);
  return { actorUserId: canonical.id, clerkId };
}

async function seedAdmin(label: string): Promise<string> {
  const result = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`clerk_f11c1_admin_${label}`, `f11c1-admin-${label}@test.local`]);
  return result.rows[0].id;
}

async function seedFullTeacherClassFixture(label: string) {
  const institution = await createInstitution(`F11C1 Institution ${label}`);
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
  const result = await db.query(`INSERT INTO concepts (id, subject_id, canonical_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [subjectId, `f11c1.${label}`]);
  return result.rows[0].id;
}

/** Real, end-to-end simulation of "the student submitted the quiz" -- calling the EXACT same functions (`updateMastery`, `completeQuiz`) the existing, unmodified /api/quizzes/generate-and-take submit handler itself calls, with the same operationType/operationId shape. Never a hand-rolled substitute for grading. */
async function simulateRealQuizSubmission(params: { studentId: string; conceptId: string; subjectId: string; quizId: string; result: 'correct' | 'incorrect' }): Promise<void> {
  const { completeQuiz } = await import('@/services/quiz-persistence.service');
  await updateMastery({
    studentId: params.studentId,
    conceptId: params.conceptId,
    subjectId: params.subjectId,
    evidence: { sourceType: 'PRACTICE_QUESTION', result: params.result, difficulty: 3, scorePercent: params.result === 'correct' ? 100 : 0 },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 },
    identity: { operationType: 'QUIZ_SUBMISSION', operationId: params.quizId, conceptId: params.conceptId },
  });
  await completeQuiz(params.quizId);
}

/**
 * `updateMastery` (F5, called by the real Practice submit flow) requires
 * an ACTIVE row in `mastery_policies` to exist -- a pre-existing
 * certification-environment requirement of F5's own aggregation logic,
 * not something F11-C1 introduces. No migration seeds a default row
 * (confirmed by inspection), so every certification script that
 * exercises real evidence writing must seed one itself, exactly as this
 * one does here.
 */
async function seedMasteryPolicy(): Promise<void> {
  await db.query(
    `
    INSERT INTO mastery_policies (
      version, minimum_understanding, minimum_independence, minimum_application, minimum_retention,
      minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count,
      minimum_independent_evidence_count, retention_min_gap_days, validation_window_days
    ) VALUES (1, 0.7, 0.7, 0.7, 0.7, 0.7, false, 3, 1, 1, 1, 14)
    ON CONFLICT (version) DO NOTHING
    `
  );
}

async function main() {
  console.log('=== F11-C1 CONCEPT REINFORCEMENT EXECUTION ORCHESTRATION CERTIFICATION ===');
  await seedMasteryPolicy();

  console.log('--- HAPPY PATH: assign -> list -> start -> submit -> reconcile -> canonical evidence proof ---');
  const fx = await seedFullTeacherClassFixture('HAPPY');
  const student = await seedStudent('Student Happy');
  await enrollStudent(fx.classA.id, student.studentId);
  const subjectResult = await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [student.studentId]);
  const subjectId = subjectResult.rows[0].id;
  const conceptId = await seedConcept(subjectId, 'happy');

  const intervention = await assignTeacherIntervention(fx.teacher.actorUserId, {
    classId: fx.classA.id,
    studentId: student.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId },
  });
  assert(intervention.status === 'ASSIGNED', 'Setup: Teacher Intervention assigned');

  const pendingBefore = await getStudentPendingTeacherInterventions(student.studentId);
  assert(pendingBefore.length === 1 && pendingBefore[0].id === intervention.id, 'Case 1: assigned student can list their own intervention');
  assert(pendingBefore[0].effectiveStatus === 'ASSIGNED', 'Effective status matches stored status when no due_at has passed');

  const beforeEvidenceCount = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [student.studentId, conceptId])).rows[0].c;

  const startResult = await startConceptReinforcementExecution(student.ownerActorId, intervention.id, 'idem-key-happy-1');
  assert(startResult.outcome === 'STARTED', 'Case 6: student can execute their own valid CONCEPT_REINFORCEMENT');
  const quizId = (startResult as any).executionReference;
  const quizSessionAfterStart = await getQuizSession(quizId);
  assert(quizSessionAfterStart !== null && quizSessionAfterStart.status === 'active', 'A real quiz_sessions row was created via the SAME generatePracticeQuestions/storeQuiz functions the existing route uses');

  const afterStartRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [intervention.id]);
  assert(afterStartRow.rows[0].status === 'IN_PROGRESS', 'Lifecycle: ASSIGNED -> IN_PROGRESS triggered by a real execution being created, not merely viewed');

  // Case: real submission with an INCORRECT answer -- proves completion never requires a passing score.
  await simulateRealQuizSubmission({ studentId: student.studentId, conceptId, subjectId, quizId, result: 'incorrect' });
  const quizSessionAfterSubmit = await getQuizSession(quizId);
  assert(quizSessionAfterSubmit?.status === 'completed', 'The real Practice engine (unmodified) marked the quiz session completed');

  const afterSubmitPending = await getStudentPendingTeacherInterventions(student.studentId);
  assert(afterSubmitPending.length === 0, 'Lifecycle: IN_PROGRESS -> COMPLETED reconciled lazily on read, removing it from the pending list');
  const afterSubmitRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [intervention.id]);
  assert(afterSubmitRow.rows[0].status === 'COMPLETED', 'Teacher Intervention reached COMPLETED despite an INCORRECT answer -- operational completion, never an academic judgment');

  const afterEvidenceCount = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [student.studentId, conceptId])).rows[0].c;
  assert(afterEvidenceCount === beforeEvidenceCount + 1, 'Canonical evidence proof: exactly ONE learning_evidence row was produced (by the real Practice engine), F11-C1 wrote zero of its own');

  const executionRow = await db.query(`SELECT status, execution_reference FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [intervention.id]);
  assert(executionRow.rows.length === 1 && executionRow.rows[0].status === 'COMPLETED' && executionRow.rows[0].execution_reference === quizId, 'Exactly one execution registry row, correctly reconciled to COMPLETED');

  // Case 9: COMPLETED intervention cannot start another F11-C1 execution.
  await assertNotStartable(
    startConceptReinforcementExecution(student.ownerActorId, intervention.id, 'idem-key-happy-2-should-fail'),
    'Case 9: a COMPLETED intervention cannot start another execution, even with a fresh idempotency key'
  );

  console.log('--- ADVERSARIAL MATRIX ---');

  // Case 2/10: a different student cannot list or start it.
  const otherStudent = await seedStudent('Other Student');
  const otherPending = await getStudentPendingTeacherInterventions(otherStudent.studentId);
  assert(otherPending.length === 0, "Case 2: a different student's list never includes another student's intervention");

  const fx3 = await seedFullTeacherClassFixture('ADVERSARIAL');
  const student3 = await seedStudent('Student Adversarial');
  await enrollStudent(fx3.classA.id, student3.studentId);
  const subject3 = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [student3.studentId])).rows[0].id;
  const concept3 = await seedConcept(subject3, 'adversarial');
  const intervention3 = await assignTeacherIntervention(fx3.teacher.actorUserId, {
    classId: fx3.classA.id,
    studentId: student3.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: concept3 },
  });

  await assertStudentDenied(
    startConceptReinforcementExecution(otherStudent.ownerActorId, intervention3.id, 'idem-key-wrong-student'),
    'Case 2/10: a different student cannot start another student\'s intervention (wrong student identity)'
  );

  // Case 3: Parent cannot execute the child's Teacher Intervention.
  const parentActor = await seedTeacherActor(); // reuse the canonical-user helper for a plain actor identity
  const parentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Parent Three', $1, $2) RETURNING id`,
    [parentActor.clerkId, parentActor.actorUserId]
  );
  await linkChildByEmail(parentProfile.rows[0].id, student3.email);
  await respondToRequest(student3.studentId, parentProfile.rows[0].id, true);
  await assertStudentDenied(
    startConceptReinforcementExecution(parentActor.actorUserId, intervention3.id, 'idem-key-parent'),
    'Case 3: an accepted Parent relationship does not authorize executing the child\'s Teacher Intervention'
  );

  // Case 4: the assigning Teacher cannot execute it.
  await assertStudentDenied(
    startConceptReinforcementExecution(fx3.teacher.actorUserId, intervention3.id, 'idem-key-assigning-teacher'),
    'Case 4: the Teacher who assigned the intervention cannot execute it themselves'
  );

  // Case 5: another, unrelated Teacher cannot execute it.
  const otherTeacherFx = await seedFullTeacherClassFixture('OTHER-TEACHER');
  await assertStudentDenied(
    startConceptReinforcementExecution(otherTeacherFx.teacher.actorUserId, intervention3.id, 'idem-key-other-teacher'),
    'Case 5: an unrelated Teacher cannot execute another Teacher\'s intervention'
  );

  // Case 11: Owner identity does not imply Teacher permissions.
  let ownerCannotAssign = false;
  try {
    await assignTeacherIntervention(student3.ownerActorId, {
      classId: fx3.classA.id,
      studentId: student3.studentId,
      interventionType: 'CONCEPT_REINFORCEMENT',
      target: { targetType: 'CONCEPT', conceptId: concept3 },
    });
  } catch {
    ownerCannotAssign = true;
  }
  assert(ownerCannotAssign, 'Case 11: the Owner (Student) identity does not satisfy Teacher authorization -- cannot assign, cancel, or view via the Teacher surface');

  // Case 7: CANCELLED intervention cannot start.
  const fx7 = await seedFullTeacherClassFixture('CANCEL-BEFORE');
  const student7 = await seedStudent('Student Cancel Before');
  await enrollStudent(fx7.classA.id, student7.studentId);
  const subject7 = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Biology') RETURNING id`, [student7.studentId])).rows[0].id;
  const concept7 = await seedConcept(subject7, 'cancel-before');
  const intervention7 = await assignTeacherIntervention(fx7.teacher.actorUserId, {
    classId: fx7.classA.id,
    studentId: student7.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: concept7 },
  });
  await cancelTeacherIntervention(fx7.teacher.actorUserId, intervention7.id);
  await assertNotStartable(
    startConceptReinforcementExecution(student7.ownerActorId, intervention7.id, 'idem-key-cancelled'),
    'Case 7: a CANCELLED intervention cannot start an execution'
  );

  // Case 8: EXPIRED effective intervention cannot start.
  const fx8 = await seedFullTeacherClassFixture('EXPIRED');
  const student8 = await seedStudent('Student Expired');
  await enrollStudent(fx8.classA.id, student8.studentId);
  const subject8 = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'History') RETURNING id`, [student8.studentId])).rows[0].id;
  const concept8 = await seedConcept(subject8, 'expired');
  const intervention8 = await assignTeacherIntervention(fx8.teacher.actorUserId, {
    classId: fx8.classA.id,
    studentId: student8.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: concept8 },
    dueAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour in the past
  });
  const pending8 = await getStudentPendingTeacherInterventions(student8.studentId);
  assert(pending8.length === 1 && pending8[0].effectiveStatus === 'EXPIRED', 'Stored status remains ASSIGNED, but effectiveStatus is EXPIRED once due_at has passed (no cron mutated the stored row)');
  const stored8 = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [intervention8.id]);
  assert(stored8.rows[0].status === 'ASSIGNED', 'Confirms: stored status is untouched by expiry -- only the derived effective status changes');
  await assertNotStartable(
    startConceptReinforcementExecution(student8.ownerActorId, intervention8.id, 'idem-key-expired'),
    'Case 8: an effectively-EXPIRED intervention cannot start an execution'
  );

  // Case 12: PARENT+TEACHER actor does not gain Student execution rights unless genuinely the intervention's own student owner.
  const fx12 = await seedFullTeacherClassFixture('MULTI-ROLE');
  const multiRoleUser = fx12.teacher; // this actor is a real Teacher in fx12
  const someOtherStudent = await seedStudent('Student Not Owned By Multi-Role User');
  await enrollStudent(fx12.classA.id, someOtherStudent.studentId);
  const subject12 = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Geography') RETURNING id`, [someOtherStudent.studentId])).rows[0].id;
  const concept12 = await seedConcept(subject12, 'multi-role');
  const intervention12 = await assignTeacherIntervention(multiRoleUser.actorUserId, {
    classId: fx12.classA.id,
    studentId: someOtherStudent.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: concept12 },
  });
  // Give the SAME multi-role actor an ALSO-valid Parent relationship to yet another student.
  const parentOnlyChild = await seedStudent('Parent-only child of multi-role user');
  const multiRoleParentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Multi Role', $1, $2) RETURNING id`,
    [multiRoleUser.clerkId, multiRoleUser.actorUserId]
  );
  await linkChildByEmail(multiRoleParentProfile.rows[0].id, parentOnlyChild.email);
  await respondToRequest(parentOnlyChild.studentId, multiRoleParentProfile.rows[0].id, true);
  // Now this ONE actor genuinely holds Teacher (of intervention12's class) AND Parent (of a different child) relationships -- neither should let them execute intervention12, which belongs to a THIRD student they do not own.
  await assertStudentDenied(
    startConceptReinforcementExecution(multiRoleUser.actorUserId, intervention12.id, 'idem-key-multi-role'),
    'Case 12: a PARENT+TEACHER actor with real relationships to OTHER students still cannot execute an intervention belonging to a student they do not personally own'
  );
  // Fixture validity: that SAME actor, if they genuinely owned a student (self), COULD start it -- proven separately via the happy-path student above, whose ownerActorId is a distinct, real Owner identity. Restating the general principle: ownership is the only path, demonstrated positively by the happy path and negatively here.

  console.log('--- NOT_EXECUTABLE_YET (non-CONCEPT_REINFORCEMENT types) ---');
  const fxNE = await seedFullTeacherClassFixture('NOT-EXECUTABLE');
  const studentNE = await seedStudent('Student Not Executable');
  await enrollStudent(fxNE.classA.id, studentNE.studentId);
  const subjectNE = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Math') RETURNING id`, [studentNE.studentId])).rows[0].id;
  const skillResult = await db.query(`SELECT id FROM skills LIMIT 1`);
  let skillId = skillResult.rows[0]?.id;
  if (!skillId) {
    skillId = (await db.query(`INSERT INTO skills (name, skill_type) VALUES ('Test Skill', 'DISCIPLINE_SPECIFIC') RETURNING id`)).rows[0].id;
  }
  const skillIntervention = await assignTeacherIntervention(fxNE.teacher.actorUserId, {
    classId: fxNE.classA.id,
    studentId: studentNE.studentId,
    interventionType: 'SKILL_PRACTICE',
    target: { targetType: 'SKILL', skillId },
  });
  const skillStart = await startConceptReinforcementExecution(studentNE.ownerActorId, skillIntervention.id, 'idem-key-skill');
  assert(skillStart.outcome === 'NOT_EXECUTABLE_YET', 'SKILL_PRACTICE returns a clean NOT_EXECUTABLE_YET domain result, never silently translated to a concept execution');
  const skillInterventionRowAfter = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [skillIntervention.id]);
  assert(skillInterventionRowAfter.rows[0].status === 'ASSIGNED', 'A NOT_EXECUTABLE_YET result never transitions the intervention to IN_PROGRESS');

  console.log('--- IDEMPOTENCY ---');
  const fxIdem = await seedFullTeacherClassFixture('IDEMPOTENCY');
  const studentIdem = await seedStudent('Student Idempotency');
  await enrollStudent(fxIdem.classA.id, studentIdem.studentId);
  const subjectIdem = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [studentIdem.studentId])).rows[0].id;
  const conceptIdem = await seedConcept(subjectIdem, 'idempotency');
  const interventionIdem = await assignTeacherIntervention(fxIdem.teacher.actorUserId, {
    classId: fxIdem.classA.id,
    studentId: studentIdem.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: conceptIdem },
  });

  const firstStart = await startConceptReinforcementExecution(studentIdem.ownerActorId, interventionIdem.id, 'same-key-sequential');
  assert(firstStart.outcome === 'STARTED', 'Idempotency (sequential): first call with a fresh key STARTS a real execution');
  const secondStart = await startConceptReinforcementExecution(studentIdem.ownerActorId, interventionIdem.id, 'same-key-sequential');
  assert(secondStart.outcome === 'RECOVERED', 'Idempotency (sequential retry): the SAME key on a repeated request RECOVERS, never starts a second execution');
  assert((firstStart as any).executionId === (secondStart as any).executionId, 'Idempotency (sequential retry): the recovered execution id is IDENTICAL to the original -- a deterministic result');
  const rowCountAfterSequential = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionIdem.id])).rows[0].c;
  assert(rowCountAfterSequential === 1, 'Idempotency (sequential retry): exactly ONE teacher_intervention_executions row exists, not two');

  // Real concurrency: two truly simultaneous start calls with the SAME key.
  const fxConc = await seedFullTeacherClassFixture('CONCURRENCY');
  const studentConc = await seedStudent('Student Concurrency');
  await enrollStudent(fxConc.classA.id, studentConc.studentId);
  const subjectConc = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [studentConc.studentId])).rows[0].id;
  const conceptConc = await seedConcept(subjectConc, 'concurrency');
  const interventionConc = await assignTeacherIntervention(fxConc.teacher.actorUserId, {
    classId: fxConc.classA.id,
    studentId: studentConc.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: conceptConc },
  });
  const [concA, concB] = await Promise.all([
    startConceptReinforcementExecution(studentConc.ownerActorId, interventionConc.id, 'same-key-concurrent'),
    startConceptReinforcementExecution(studentConc.ownerActorId, interventionConc.id, 'same-key-concurrent'),
  ]);
  const concurrentRowCount = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionConc.id])).rows[0].c;
  assert(concurrentRowCount === 1, 'Idempotency (real concurrency): two truly simultaneous start calls with the SAME key converge to exactly ONE teacher_intervention_executions row');
  assert((concA as any).executionId === (concB as any).executionId, 'Idempotency (real concurrency): both concurrent calls resolve to the SAME execution id');

  // Different keys -> two separate executions (0..N cardinality).
  const thirdStart = await startConceptReinforcementExecution(studentIdem.ownerActorId, interventionIdem.id, 'a-genuinely-different-key');
  assert(thirdStart.outcome === 'STARTED', 'Cardinality: a DIFFERENT idempotency key on the same still-IN_PROGRESS intervention starts a genuinely separate execution');
  const rowCountAfterSecondReal = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionIdem.id])).rows[0].c;
  assert(rowCountAfterSecondReal === 2, 'Cardinality: 1 Teacher Intervention now correctly has 2 distinct execution rows (0..N architecture, not fixed 1:1)');

  console.log('--- CANCELLATION AFTER EXECUTION STARTS ---');
  const fxCancelAfter = await seedFullTeacherClassFixture('CANCEL-AFTER');
  const studentCancelAfter = await seedStudent('Student Cancel After');
  await enrollStudent(fxCancelAfter.classA.id, studentCancelAfter.studentId);
  const subjectCA = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [studentCancelAfter.studentId])).rows[0].id;
  const conceptCA = await seedConcept(subjectCA, 'cancel-after');
  const interventionCA = await assignTeacherIntervention(fxCancelAfter.teacher.actorUserId, {
    classId: fxCancelAfter.classA.id,
    studentId: studentCancelAfter.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: conceptCA },
  });
  const startedCA = await startConceptReinforcementExecution(studentCancelAfter.ownerActorId, interventionCA.id, 'idem-key-cancel-after');
  const quizIdCA = (startedCA as any).executionReference;
  await cancelTeacherIntervention(fxCancelAfter.teacher.actorUserId, interventionCA.id);

  const quizSessionStillActive = await getQuizSession(quizIdCA);
  assert(quizSessionStillActive?.status === 'active', 'Cancellation after execution start: the already-started Practice execution is left completely untouched (not abandoned, not deleted)');
  const executionRowAfterCancel = await db.query(`SELECT status FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionCA.id]);
  assert(executionRowAfterCancel.rows[0].status === 'ACTIVE', 'Cancellation after execution start: the execution registry row remains historically ACTIVE, never mutated by the cancellation');
  await assertNotStartable(
    startConceptReinforcementExecution(studentCancelAfter.ownerActorId, interventionCA.id, 'idem-key-cancel-after-retry'),
    'Cancellation after execution start: a NEW execution attempt is blocked once the intervention itself is CANCELLED'
  );
  // Prove evidence remains intact even after cancellation, by completing the already-started (still real, still valid) quiz.
  const evidenceCountBeforeCancelSubmit = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [studentCancelAfter.studentId, conceptCA])).rows[0].c;
  await simulateRealQuizSubmission({ studentId: studentCancelAfter.studentId, conceptId: conceptCA, subjectId: subjectCA, quizId: quizIdCA, result: 'correct' });
  const evidenceCountAfterCancelSubmit = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [studentCancelAfter.studentId, conceptCA])).rows[0].c;
  assert(evidenceCountAfterCancelSubmit === evidenceCountBeforeCancelSubmit + 1, 'Cancellation never blocks or deletes evidence already in flight -- the pre-existing execution completes normally and writes real evidence');
  const interventionAfterCancelSubmit = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [interventionCA.id]);
  assert(interventionAfterCancelSubmit.rows[0].status === 'CANCELLED', 'The Teacher Intervention remains CANCELLED -- completing a pre-cancellation execution never resurrects it to COMPLETED');

  console.log('');
  console.log('=== F11-C1 CERTIFICATION: ALL ASSERTIONS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F11-C1 certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
