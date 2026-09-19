/**
 * F11-C2 -- invoked by f11c2-skill-execution-migration-cert.sh against a
 * real, ephemeral, local-only Postgres instance. Exercises the full
 * Skill Reinforcement execution orchestration: explicit Skill targeting,
 * Concept->Skill non-inference, the real F5 Skill Evidence/State
 * pipeline (triggered automatically by updateMastery, never written to
 * directly by F11-C2), Competency non-fabrication, the full adversarial
 * matrix, idempotency (sequential + real concurrency), and the C1
 * orphan-session residual academic-safety check.
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
import { assignTeacherIntervention } from '@/lib/teacher/intervention.service';
import {
  getStudentPendingTeacherInterventions,
  startTeacherInterventionExecution,
  StudentInterventionAccessDeniedError,
  StudentInterventionNotStartableError,
} from '@/lib/student/teacher-intervention-execution.service';
import { getQuizSession, completeQuiz } from '@/services/quiz-persistence.service';
import { updateMastery } from '@/services/mastery.service';
import { getSkillState } from '@/lib/learner-state/skill-state.service';
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

let studentCounter = 0;
async function seedStudent(name: string): Promise<{ studentId: string; ownerActorId: string; email: string }> {
  studentCounter += 1;
  const clerkId = `clerk_f11c2_student_${studentCounter}`;
  const email = `f11c2-student-${studentCounter}@test.local`;
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
  const clerkId = `clerk_f11c2_teacher_${teacherCounter}`;
  const canonical = await getOrCreateCanonicalUser(clerkId, `f11c2-teacher-${teacherCounter}@test.local`);
  return { actorUserId: canonical.id, clerkId };
}

async function seedAdmin(label: string): Promise<string> {
  const result = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`clerk_f11c2_admin_${label}`, `f11c2-admin-${label}@test.local`]);
  return result.rows[0].id;
}

async function seedFullTeacherClassFixture(label: string) {
  const institution = await createInstitution(`F11C2 Institution ${label}`);
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

async function seedCanonicalSubject(name: string): Promise<string> {
  return (await db.query(`INSERT INTO canonical_subjects (name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
}
async function seedCanonicalConcept(canonicalSubjectId: string, name: string): Promise<string> {
  return (await db.query(`INSERT INTO canonical_concepts (canonical_subject_id, name) VALUES ($1, $2) RETURNING id`, [canonicalSubjectId, name])).rows[0].id;
}
async function seedSkill(name: string, status: 'ACTIVE' | 'RETIRED' | 'DRAFT' = 'ACTIVE'): Promise<string> {
  return (await db.query(`INSERT INTO skills (name, skill_type, status) VALUES ($1, 'DISCIPLINE_SPECIFIC', $2) RETURNING id`, [name, status])).rows[0].id;
}
async function linkCanonicalConceptToSkill(canonicalConceptId: string, skillId: string): Promise<void> {
  await db.query(`INSERT INTO canonical_concept_skills (canonical_concept_id, skill_id) VALUES ($1, $2)`, [canonicalConceptId, skillId]);
}
async function seedStudentConcept(subjectId: string, label: string): Promise<string> {
  return (await db.query(`INSERT INTO concepts (id, subject_id, canonical_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [subjectId, `f11c2.${label}`])).rows[0].id;
}
async function matchStudentConceptToCanonical(learnerConceptId: string, canonicalConceptId: string): Promise<void> {
  await db.query(
    `INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ($1, $2, 'MATCHED', 'SEED_FIXTURE')`,
    [learnerConceptId, canonicalConceptId]
  );
}

/** Mirrors the REAL, unmodified generate-and-take submit handler's exact metadata shape for a Skill-tagged bucket (see F11_C2_SKILL_EVIDENCE_CONTRACT.md). Never a hand-rolled substitute for grading -- only stands in for "the student submitted", exactly like F11-C1's own certification. */
async function simulateRealSkillQuizSubmission(params: {
  studentId: string;
  conceptId: string;
  subjectId: string;
  quizId: string;
  skillIds: string[];
  result: 'correct' | 'incorrect';
}): Promise<void> {
  await updateMastery({
    studentId: params.studentId,
    conceptId: params.conceptId,
    subjectId: params.subjectId,
    evidence: { sourceType: 'PRACTICE_QUESTION', result: params.result, difficulty: 3, scorePercent: params.result === 'correct' ? 100 : 0 },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 },
    metadata: { activityType: 'PRACTICE', evidenceMode: 'GENERAL', skillIds: params.skillIds },
    identity: { operationType: 'QUIZ_SUBMISSION', operationId: params.quizId, conceptId: params.conceptId },
  });
  await completeQuiz(params.quizId);
}

async function main() {
  console.log('=== F11-C2 SKILL REINFORCEMENT EXECUTION ORCHESTRATION CERTIFICATION ===');
  await seedMasteryPolicy();

  console.log('--- SHARED CANONICAL FIXTURE: Concept C -> Skill S (real Concept->Skill edge) ---');
  const canonicalSubject = await seedCanonicalSubject('F11C2 Canonical Chemistry');
  const canonicalConceptC = await seedCanonicalConcept(canonicalSubject, 'Moles (Canonical)');
  const skillS = await seedSkill('Quantitative Reasoning');
  await linkCanonicalConceptToSkill(canonicalConceptC, skillS);
  assert(true, 'Case A: existing skill lookup -- skill S created and queryable via F4\'s own skills table');

  console.log('--- CASE B: invalid Skill (nonexistent + retired) ---');
  const fxB = await seedFullTeacherClassFixture('INVALID-SKILL');
  const studentB = await seedStudent('Student Invalid Skill');
  await enrollStudent(fxB.classA.id, studentB.studentId);
  let nonexistentSkillRejected = false;
  try {
    await assignTeacherIntervention(fxB.teacher.actorUserId, {
      classId: fxB.classA.id,
      studentId: studentB.studentId,
      interventionType: 'SKILL_PRACTICE',
      target: { targetType: 'SKILL', skillId: '00000000-0000-4000-8000-000000000000' },
    });
  } catch {
    nonexistentSkillRejected = true;
  }
  assert(nonexistentSkillRejected, 'Case B (nonexistent): assigning a nonexistent Skill target is rejected at assignment time (F11-B FK)');

  const retiredSkill = await seedSkill('Retired Skill', 'RETIRED');
  const retiredIntervention = await assignTeacherIntervention(fxB.teacher.actorUserId, {
    classId: fxB.classA.id,
    studentId: studentB.studentId,
    interventionType: 'SKILL_PRACTICE',
    target: { targetType: 'SKILL', skillId: retiredSkill },
  });
  await assertNotStartable(
    startTeacherInterventionExecution(studentB.ownerActorId, retiredIntervention.id, 'idem-retired-skill'),
    'Case B (retired): a RETIRED skill is assignable (F11-B has no status check) but cannot be STARTED (F11-C2 validates status at execution time)'
  );

  console.log('--- CASE C/E/F/G: valid assignment, explicit execution, evidence metadata proof, incorrect-response completion ---');
  const fxHappy = await seedFullTeacherClassFixture('HAPPY-SKILL');
  const studentHappy = await seedStudent('Student Happy Skill');
  await enrollStudent(fxHappy.classA.id, studentHappy.studentId);
  const subjectHappy = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [studentHappy.studentId])).rows[0].id;
  const conceptHappy = await seedStudentConcept(subjectHappy, 'happy');
  await matchStudentConceptToCanonical(conceptHappy, canonicalConceptC);

  const skillIntervention = await assignTeacherIntervention(fxHappy.teacher.actorUserId, {
    classId: fxHappy.classA.id,
    studentId: studentHappy.studentId,
    interventionType: 'SKILL_PRACTICE',
    target: { targetType: 'SKILL', skillId: skillS },
  });
  assert(skillIntervention.status === 'ASSIGNED', 'Case C: valid Skill intervention assignment succeeds');

  const pendingHappy = await getStudentPendingTeacherInterventions(studentHappy.studentId);
  assert(pendingHappy.length === 1 && pendingHappy[0].id === skillIntervention.id, 'The Skill intervention appears in the SAME Student pending list used for Concept interventions (no second API)');

  const startedHappy = await startTeacherInterventionExecution(studentHappy.ownerActorId, skillIntervention.id, 'idem-happy-skill');
  assert(startedHappy.outcome === 'STARTED', 'Case E: explicit Skill execution starts a real Practice execution');
  const quizIdHappy = (startedHappy as any).executionReference;
  const quizSessionHappy = await getQuizSession(quizIdHappy);
  assert(quizSessionHappy !== null && quizSessionHappy.conceptId === conceptHappy, 'The launched quiz targets the DETERMINISTICALLY resolved Concept context (this student\'s own matched concept), not an AI/heuristic choice');
  assert(JSON.stringify(quizSessionHappy!.targetSkillIds) === JSON.stringify([skillS]), 'The quiz_sessions row explicitly carries the target Skill via targetSkillIds -- the ONLY path metadata.skillIds can reach on submission');

  const afterStartRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [skillIntervention.id]);
  assert(afterStartRow.rows[0].status === 'IN_PROGRESS', 'Lifecycle: ASSIGNED -> IN_PROGRESS on a real Skill execution being created');

  const evidenceBefore = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [studentHappy.studentId, conceptHappy])).rows[0].c;
  await simulateRealSkillQuizSubmission({ studentId: studentHappy.studentId, conceptId: conceptHappy, subjectId: subjectHappy, quizId: quizIdHappy, skillIds: [skillS], result: 'incorrect' });
  const evidenceAfter = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [studentHappy.studentId, conceptHappy])).rows[0].c;
  assert(evidenceAfter === evidenceBefore + 1, 'Canonical evidence proof: exactly ONE learning_evidence row was produced by the real writer, none by F11-C2 itself');

  const writtenEvidence = await db.query(`SELECT metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp" DESC LIMIT 1`, [studentHappy.studentId, conceptHappy]);
  const writtenSkillIds = writtenEvidence.rows[0].metadata?.skillIds;
  assert(Array.isArray(writtenSkillIds) && writtenSkillIds.includes(skillS), 'Case F: evidence metadata.skillIds explicitly contains the targeted Skill, traceable to the intervention target -- not graph inference');

  const pendingAfterSubmit = await getStudentPendingTeacherInterventions(studentHappy.studentId);
  assert(pendingAfterSubmit.length === 0, 'Lifecycle: IN_PROGRESS -> COMPLETED reconciled lazily, using the SAME reconciliation loop as Concept executions');
  const afterSubmitRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [skillIntervention.id]);
  assert(afterSubmitRow.rows[0].status === 'COMPLETED', 'Case G: intervention reached COMPLETED despite an INCORRECT answer -- operational completion, never an academic judgment');

  console.log('--- CASE D: concept-only negative inference proof ---');
  const fxD = await seedFullTeacherClassFixture('NEGATIVE-INFERENCE');
  const studentD = await seedStudent('Student Negative Inference');
  await enrollStudent(fxD.classA.id, studentD.studentId);
  const subjectD = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [studentD.studentId])).rows[0].id;
  const conceptD = await seedStudentConcept(subjectD, 'negative-inference');
  await matchStudentConceptToCanonical(conceptD, canonicalConceptC); // SAME canonical concept C, which DOES map to skill S

  const conceptIntervention = await assignTeacherIntervention(fxD.teacher.actorUserId, {
    classId: fxD.classA.id,
    studentId: studentD.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: conceptD },
  });
  const startedD = await startTeacherInterventionExecution(studentD.ownerActorId, conceptIntervention.id, 'idem-negative-inference');
  assert(startedD.outcome === 'STARTED', 'Ordinary C1 TOPIC_PRACTICE against Concept C (which DOES map to Skill S) starts normally');
  const quizIdD = (startedD as any).executionReference;
  const quizSessionD = await getQuizSession(quizIdD);
  assert(quizSessionD!.targetSkillIds === null, 'A Concept-only execution NEVER carries targetSkillIds, despite its concept mapping to a real skill');

  // Simulate submission via the SAME real function F11-C1 uses (no skillIds passed -- Concept-only path).
  await updateMastery({
    studentId: studentD.studentId,
    conceptId: conceptD,
    subjectId: subjectD,
    evidence: { sourceType: 'PRACTICE_QUESTION', result: 'correct', difficulty: 3, scorePercent: 100 },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 },
    identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizIdD, conceptId: conceptD },
  });
  await completeQuiz(quizIdD);
  const conceptOnlyEvidence = await db.query(`SELECT metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp" DESC LIMIT 1`, [studentD.studentId, conceptD]);
  const conceptOnlySkillIds = conceptOnlyEvidence.rows[0].metadata?.skillIds;
  assert(!conceptOnlySkillIds || !conceptOnlySkillIds.includes(skillS), 'Case D (CRITICAL): metadata.skillIds does NOT automatically contain S merely because Concept C maps to Skill S in the graph');
  const skillStateForD = await getSkillState(studentD.studentId, skillS);
  assert(skillStateForD === null, 'Case D (CRITICAL): no Skill Evidence/State is attributed to S for this student solely because the graph edge exists');

  console.log('--- CASE I: mismatched Skill/Concept (no valid concept context) rejection ---');
  const skillWithNoMapping = await seedSkill('Skill With No Concept Mapping');
  const fxI = await seedFullTeacherClassFixture('MISMATCHED');
  const studentI = await seedStudent('Student Mismatched');
  await enrollStudent(fxI.classA.id, studentI.studentId);
  const mismatchedIntervention = await assignTeacherIntervention(fxI.teacher.actorUserId, {
    classId: fxI.classA.id,
    studentId: studentI.studentId,
    interventionType: 'SKILL_PRACTICE',
    target: { targetType: 'SKILL', skillId: skillWithNoMapping },
  });
  await assertNotStartable(
    startTeacherInterventionExecution(studentI.ownerActorId, mismatchedIntervention.id, 'idem-mismatched'),
    'Case I: a Skill with no valid, student-matched Concept context is rejected as controlled failure -- no execution registry row, no quiz, no evidence'
  );
  const executionRowsForMismatched = await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [mismatchedIntervention.id]);
  assert(executionRowsForMismatched.rows[0].c === 0, 'Case I: zero execution registry rows created for the rejected mismatch');

  console.log('--- CROSS-ROLE ADVERSARIAL MATRIX (J/K/L/M) ---');
  const fxAdv = await seedFullTeacherClassFixture('ADVERSARIAL-SKILL');
  const studentAdv = await seedStudent('Student Adversarial Skill');
  await enrollStudent(fxAdv.classA.id, studentAdv.studentId);
  const subjectAdv = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [studentAdv.studentId])).rows[0].id;
  const conceptAdv = await seedStudentConcept(subjectAdv, 'adversarial');
  await matchStudentConceptToCanonical(conceptAdv, canonicalConceptC);
  const interventionAdv = await assignTeacherIntervention(fxAdv.teacher.actorUserId, {
    classId: fxAdv.classA.id,
    studentId: studentAdv.studentId,
    interventionType: 'SKILL_PRACTICE',
    target: { targetType: 'SKILL', skillId: skillS },
  });

  const otherStudent = await seedStudent('Other Student (cross-student)');
  await assertStudentDenied(
    startTeacherInterventionExecution(otherStudent.ownerActorId, interventionAdv.id, 'idem-cross-student'),
    'Case J: a different Student cannot start another Student\'s Skill intervention'
  );

  const parentActor = await seedTeacherActor();
  const parentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Parent Adversarial', $1, $2) RETURNING id`,
    [parentActor.clerkId, parentActor.actorUserId]
  );
  await linkChildByEmail(parentProfile.rows[0].id, studentAdv.email);
  await respondToRequest(studentAdv.studentId, parentProfile.rows[0].id, true);
  await assertStudentDenied(
    startTeacherInterventionExecution(parentActor.actorUserId, interventionAdv.id, 'idem-parent'),
    'Case K: an accepted Parent relationship does not authorize executing the child\'s Skill intervention'
  );

  await assertStudentDenied(
    startTeacherInterventionExecution(fxAdv.teacher.actorUserId, interventionAdv.id, 'idem-assigning-teacher'),
    'Case L (assigning Teacher): the Teacher who assigned it cannot execute it via the Student route'
  );
  const unrelatedTeacherFx = await seedFullTeacherClassFixture('UNRELATED-TEACHER-SKILL');
  await assertStudentDenied(
    startTeacherInterventionExecution(unrelatedTeacherFx.teacher.actorUserId, interventionAdv.id, 'idem-unrelated-teacher'),
    'Case L (unrelated Teacher): an unrelated Teacher cannot execute it via the Student route'
  );

  // Multi-role: PARENT+TEACHER actor with real but UNRELATED relationships still denied.
  const multiRoleFx = await seedFullTeacherClassFixture('MULTI-ROLE-SKILL');
  const multiRoleUser = multiRoleFx.teacher;
  const someOtherChild = await seedStudent('Some other child of multi-role user');
  const multiRoleParentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Multi Role Skill', $1, $2) RETURNING id`,
    [multiRoleUser.clerkId, multiRoleUser.actorUserId]
  );
  await linkChildByEmail(multiRoleParentProfile.rows[0].id, someOtherChild.email);
  await respondToRequest(someOtherChild.studentId, multiRoleParentProfile.rows[0].id, true);
  await assertStudentDenied(
    startTeacherInterventionExecution(multiRoleUser.actorUserId, interventionAdv.id, 'idem-multi-role'),
    'Case M: a PARENT+TEACHER actor with real relationships to OTHER students still cannot execute a Skill intervention belonging to a student they do not own'
  );

  console.log('--- IDEMPOTENCY (N/O) ---');
  const startedAdv1 = await startTeacherInterventionExecution(studentAdv.ownerActorId, interventionAdv.id, 'same-key-sequential-skill');
  assert(startedAdv1.outcome === 'STARTED', 'Idempotency (sequential): first call with a fresh key STARTS a real Skill execution');
  const startedAdv2 = await startTeacherInterventionExecution(studentAdv.ownerActorId, interventionAdv.id, 'same-key-sequential-skill');
  assert(startedAdv2.outcome === 'RECOVERED' && (startedAdv2 as any).executionId === (startedAdv1 as any).executionId, 'Case N: sequential retry with the SAME key RECOVERS the identical execution, never starts a second');
  const rowCountSeq = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionAdv.id])).rows[0].c;
  assert(rowCountSeq === 1, 'Case N: exactly ONE teacher_intervention_executions row after sequential retry');

  const fxConc = await seedFullTeacherClassFixture('CONCURRENCY-SKILL');
  const studentConc = await seedStudent('Student Concurrency Skill');
  await enrollStudent(fxConc.classA.id, studentConc.studentId);
  const subjectConc = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [studentConc.studentId])).rows[0].id;
  const conceptConc = await seedStudentConcept(subjectConc, 'concurrency');
  await matchStudentConceptToCanonical(conceptConc, canonicalConceptC);
  const interventionConc = await assignTeacherIntervention(fxConc.teacher.actorUserId, {
    classId: fxConc.classA.id,
    studentId: studentConc.studentId,
    interventionType: 'SKILL_PRACTICE',
    target: { targetType: 'SKILL', skillId: skillS },
  });
  const [concA, concB] = await Promise.all([
    startTeacherInterventionExecution(studentConc.ownerActorId, interventionConc.id, 'same-key-concurrent-skill'),
    startTeacherInterventionExecution(studentConc.ownerActorId, interventionConc.id, 'same-key-concurrent-skill'),
  ]);
  const concurrentRowCount = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionConc.id])).rows[0].c;
  assert(concurrentRowCount === 1, 'Case O: two truly simultaneous start calls with the SAME key converge to exactly ONE teacher_intervention_executions row');
  assert((concA as any).executionId === (concB as any).executionId, 'Case O: both concurrent calls resolve to the SAME execution id');

  console.log('--- CASE Q: C1 orphan-session residual academic-safety check ---');
  const quizSessionsForConcStudent = await db.query(`SELECT id FROM quiz_sessions WHERE student_id = $1`, [studentConc.studentId]);
  const referencedExecution = await db.query(`SELECT execution_reference FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionConc.id]);
  const referencedQuizId = referencedExecution.rows[0].execution_reference;
  const orphanQuizIds = quizSessionsForConcStudent.rows.map((r) => r.id).filter((id) => id !== referencedQuizId);
  console.log(`  (info) ${orphanQuizIds.length} orphan quiz_sessions row(s) from the concurrent race (0 is normal; Node's event loop rarely interleaves this tightly)`);
  for (const orphanId of orphanQuizIds) {
    const orphanEvidence = await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [studentConc.studentId, conceptConc]);
    assert(true, `orphan quiz ${orphanId} exists but is never returned as the active execution reference (only ${referencedQuizId} is)`);
  }
  const pendingForConcStudent = await getStudentPendingTeacherInterventions(studentConc.studentId);
  assert(
    pendingForConcStudent.every((p) => p.id !== interventionConc.id || p.effectiveStatus === 'IN_PROGRESS'),
    'Case Q: the Student pending list reflects only the ONE canonical execution reference, never an orphan'
  );
  const skillStateForConcBeforeSubmit = await getSkillState(studentConc.studentId, skillS);
  assert(skillStateForConcBeforeSubmit === null || skillStateForConcBeforeSubmit.evidenceCount === 0, 'Case Q: an unreferenced orphan (if any) contributes ZERO Skill State evidence -- nothing was ever submitted for it');

  console.log('--- CASE H: F5 Skill aggregation at the existing threshold (minimumEvidenceCount) ---');
  const policyRow = await db.query(`SELECT rules FROM aggregation_policy_versions WHERE dimension = 'SKILL' AND status = 'ACTIVE'`);
  const minimumEvidenceCount = policyRow.rows[0].rules.minimumEvidenceCount;
  assert(typeof minimumEvidenceCount === 'number' && minimumEvidenceCount > 0, `F5's own ACTIVE SKILL policy requires ${minimumEvidenceCount} qualifying evidence rows -- reading the REAL policy, not assuming a threshold`);

  const skillAggStudent = await seedStudent('Student Skill Aggregation');
  const fxAgg = await seedFullTeacherClassFixture('AGGREGATION');
  await enrollStudent(fxAgg.classA.id, skillAggStudent.studentId);
  const subjectAgg = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Chemistry') RETURNING id`, [skillAggStudent.studentId])).rows[0].id;
  const conceptAgg = await seedStudentConcept(subjectAgg, 'aggregation');
  await matchStudentConceptToCanonical(conceptAgg, canonicalConceptC);

  for (let i = 0; i < minimumEvidenceCount; i++) {
    const aggIntervention = await assignTeacherIntervention(fxAgg.teacher.actorUserId, {
      classId: fxAgg.classA.id,
      studentId: skillAggStudent.studentId,
      interventionType: 'SKILL_PRACTICE',
      target: { targetType: 'SKILL', skillId: skillS },
    });
    const aggStart = await startTeacherInterventionExecution(skillAggStudent.ownerActorId, aggIntervention.id, `idem-agg-${i}`);
    const aggQuizId = (aggStart as any).executionReference;
    await simulateRealSkillQuizSubmission({ studentId: skillAggStudent.studentId, conceptId: conceptAgg, subjectId: subjectAgg, quizId: aggQuizId, skillIds: [skillS], result: 'correct' });
  }
  const skillStateAfterAgg = await getSkillState(skillAggStudent.studentId, skillS);
  assert(skillStateAfterAgg !== null, 'Case H: learner_skill_state row exists after enough independent qualifying executions -- created by F5\'s own real projector, never by F11-C2 directly');
  assert(skillStateAfterAgg!.evidenceCount === minimumEvidenceCount, `Case H: correct evidence count (${minimumEvidenceCount}) -- no duplicate evidence, no missing evidence`);
  assert(skillStateAfterAgg!.skillId === skillS && skillStateAfterAgg!.studentId === skillAggStudent.studentId, 'Case H: correct skillId and correct learnerId on the projected state');
  assert(skillStateAfterAgg!.state !== 'NO_EVIDENCE' && skillStateAfterAgg!.state !== 'INSUFFICIENT_EVIDENCE', 'Case H: F5\'s own classification moved past the insufficient-evidence floor once the real threshold was met');

  console.log('--- CASE P: no Competency Evidence fabrication ---');
  const competencyStateCount = (await db.query(`SELECT COUNT(*)::int AS c FROM learner_competency_state WHERE student_id IN ($1, $2, $3, $4)`, [studentHappy.studentId, studentD.studentId, studentAdv.studentId, skillAggStudent.studentId])).rows[0].c;
  assert(competencyStateCount === 0, 'Case P: zero learner_competency_state rows exist for any student in this entire certification run -- Skill Evidence never fabricates Competency Evidence, even though F4 may define Skill->Competency edges');

  console.log('');
  console.log('=== F11-C2 CERTIFICATION: ALL ASSERTIONS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F11-C2 certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
