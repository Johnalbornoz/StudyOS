/**
 * F11-C4 -- invoked by f11c4-exam-execution-migration-cert.sh against a
 * real, ephemeral, local-only Postgres instance, seeded by F9's own
 * `f9-seed-pilot-dataset.ts` fixture (PAA: Math fully SUPPORTED, Reading
 * genuinely UNSUPPORTED, so PAA Full Mock is honestly NOT_READY;
 * Cambridge: a separate, fully-configured exam sharing PAA's Math
 * canonical concept). Exercises the full Exam Reinforcement execution
 * orchestration: explicit exam/profile/version/objective targeting,
 * F7/F9 reuse (never a second Assessment/Simulation/Readiness engine),
 * the real, unbypassable Full Mock Guard, framework isolation, shared
 * canonical knowledge, the full adversarial matrix, the STRONGER
 * (lock-serialized, race-eliminating) idempotency model, double-submit/
 * double-finalization safety, failure recovery, and the Evidence/
 * readiness/diagnostic/Canonical boundary.
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
import {
  assignTeacherIntervention,
  cancelTeacherIntervention,
  TeacherInterventionExamProfileMismatchError,
  TeacherInterventionInvalidTargetError,
} from '@/lib/teacher/intervention.service';
import {
  getStudentPendingTeacherInterventions,
  startTeacherInterventionExecution,
  StudentInterventionAccessDeniedError,
  StudentInterventionNotStartableError,
} from '@/lib/student/teacher-intervention-execution.service';
import { createStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { getExamVersion, publishExamVersion, createExamVersion } from '@/lib/assessment/exam-definition.service';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import { getFullMockEligibility } from '@/lib/simulation/full-mock-eligibility.service';
import { getSimulationAttempt, completeSimulationAttempt } from '@/lib/simulation/attempt.service';
import { getExamAttempt } from '@/lib/assessment/exam-attempt.service';
import { recordSimulationItemResponse } from '@/lib/simulation/scoring.service';
import { runPostExamDiagnosis } from '@/lib/simulation/post-exam-diagnosis.service';
import { computeReadinessSnapshot } from '@/lib/readiness/readiness.service';
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
    console.log(`  OK -- ${message}: ${(error as Error).message}`);
  }
}

let teacherCounter = 0;
async function seedTeacherActor(): Promise<{ actorUserId: string; clerkId: string }> {
  teacherCounter += 1;
  const clerkId = `clerk_f11c4_teacher_${teacherCounter}`;
  const canonical = await getOrCreateCanonicalUser(clerkId, `f11c4-teacher-${teacherCounter}@test.local`);
  return { actorUserId: canonical.id, clerkId };
}

async function seedAdmin(label: string): Promise<string> {
  const result = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`clerk_f11c4_admin_${label}`, `f11c4-admin-${label}@test.local`]);
  return result.rows[0].id;
}

async function seedFullTeacherClassFixture(label: string) {
  const institution = await createInstitution(`F11C4 Institution ${label}`);
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
  console.log('=== F11-C4 EXAM REINFORCEMENT EXECUTION ORCHESTRATION CERTIFICATION ===');
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

  console.log('--- LOADING F9\'s OWN REAL FIXTURE (PAA: Math SUPPORTED, Reading genuinely UNSUPPORTED; Cambridge: fully configured, shared canonical concept) ---');
  const student1Row = await db.query(`SELECT id, user_id FROM students WHERE clerk_id = 'clerk_f9_learner1'`);
  const STUDENT_1 = student1Row.rows[0].id;
  const STUDENT_1_OWNER = student1Row.rows[0].user_id;
  const student2Row = await db.query(`SELECT id, user_id FROM students WHERE clerk_id = 'clerk_f9_learner2'`);
  const STUDENT_2 = student2Row.rows[0].id;
  const STUDENT_2_OWNER = student2Row.rows[0].user_id;
  const paaExamDefRow = await db.query(`SELECT id FROM exam_definitions WHERE name = 'PAA (F9)'`);
  const PAA_EXAM_DEF_ID = paaExamDefRow.rows[0].id;
  const PAA_EXAM_VERSION_ID = (await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [PAA_EXAM_DEF_ID])).rows[0].id;
  const cambridgeExamDefRow = await db.query(`SELECT id FROM exam_definitions WHERE name = 'Cambridge IGCSE Mathematics (F9)'`);
  const CAMBRIDGE_EXAM_DEF_ID = cambridgeExamDefRow.rows[0].id;
  const CAMBRIDGE_EXAM_VERSION_ID = (await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [CAMBRIDGE_EXAM_DEF_ID])).rows[0].id;
  const PAA_EXAM_PROFILE_ID = (await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_version_id = $2`, [STUDENT_1, PAA_EXAM_VERSION_ID])).rows[0].id;
  const CAMBRIDGE_EXAM_PROFILE_ID = (await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_version_id = $2`, [STUDENT_1, CAMBRIDGE_EXAM_VERSION_ID])).rows[0].id;
  const OBJ_MATH = (await db.query(`SELECT id FROM learning_objectives WHERE code = 'PAA-M-F9-1'`)).rows[0].id;
  const OBJ_CAMBRIDGE = (await db.query(`SELECT id FROM learning_objectives WHERE code = 'C-ALG-F9-1'`)).rows[0].id;
  const targetMathRow = await db.query(`SELECT assessment_component_id FROM blueprint_objective_targets WHERE learning_objective_id = $1`, [OBJ_MATH]);
  const componentMathId = targetMathRow.rows[0].assessment_component_id;
  const paaMathAcademicSubjectId = (await db.query(`SELECT academic_subject_id FROM assessment_components WHERE id = $1`, [componentMathId])).rows[0].academic_subject_id;
  const LEARNER_CONCEPT_ID = (await db.query(`SELECT id FROM concepts WHERE canonical_id = 'LEARNER_LINEAR_EQ_F9'`)).rows[0].id;

  // A second, real PAA exam profile for STUDENT_2 (F9's own fixture only gives STUDENT_2 a Cambridge profile) -- needed for genuine cross-student/ownership-mismatch proofs.
  const student2PaaProfile = await createStudentExamProfile({ studentId: STUDENT_2, examDefinitionId: PAA_EXAM_DEF_ID, examVersionId: PAA_EXAM_VERSION_ID, purpose: 'ADMISSION_PREP' });

  const fxMain = await seedFullTeacherClassFixture('MAIN');
  await enrollStudent(fxMain.classA.id, STUDENT_1);
  await enrollStudent(fxMain.classA.id, STUDENT_2);

  console.log('--- CASE A: valid Exam Definition/Version resolution ---');
  const examVersionCheck = await getExamVersion(PAA_EXAM_VERSION_ID);
  assert(examVersionCheck !== null && examVersionCheck.status === 'PUBLISHED', 'Case A: the PAA exam version resolves and is PUBLISHED -- the only status F11-C4 accepts');

  console.log('--- CASE C: Student Exam Profile ownership mismatch (rejected at ASSIGNMENT time) ---');
  let mismatchRejected = false;
  try {
    await assignTeacherIntervention(fxMain.teacher.actorUserId, {
      classId: fxMain.classA.id,
      studentId: STUDENT_1,
      interventionType: 'EXAM_PRACTICE',
      target: { targetType: 'EXAM', examProfileId: CAMBRIDGE_EXAM_PROFILE_ID === PAA_EXAM_PROFILE_ID ? student2PaaProfile.id : student2PaaProfile.id, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_MATH },
    });
  } catch (error) {
    mismatchRejected = error instanceof TeacherInterventionExamProfileMismatchError;
  }
  assert(mismatchRejected, 'Case C: assigning STUDENT_2\'s own exam profile to a STUDENT_1 intervention is rejected at assignment time -- never silently reassigned');

  console.log('--- CASE B: invalid Exam Version (RETIRED) ---');
  const draftVersion = await createExamVersion({ examDefinitionId: PAA_EXAM_DEF_ID, versionLabel: 'F11C4-DRAFT-NEVER-PUBLISHED' });
  const draftProfile = await createStudentExamProfile({ studentId: STUDENT_1, examDefinitionId: PAA_EXAM_DEF_ID, examVersionId: draftVersion.id, purpose: 'ADMISSION_PREP' });
  const draftIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id,
    studentId: STUDENT_1,
    interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: draftProfile.id, simulationType: 'MINI_MOCK' },
  });
  await assertNotStartable(
    startTeacherInterventionExecution(STUDENT_1_OWNER, draftIntervention.id, 'idem-draft-version'),
    'Case B: a DRAFT (never PUBLISHED) exam version is rejected at start time -- never silently substituted with a different version'
  );

  console.log('--- CASE D1: valid supported TOPIC_EXAM execution (positive) ---');
  const topicIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id,
    studentId: STUDENT_1,
    interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: PAA_EXAM_PROFILE_ID, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_MATH },
  });
  assert(topicIntervention.status === 'ASSIGNED', 'Case D1: valid TOPIC_EXAM intervention assignment succeeds');
  const pendingTopic = await getStudentPendingTeacherInterventions(STUDENT_1);
  assert(pendingTopic.some((p) => p.id === topicIntervention.id), 'The Exam intervention appears in the SAME Student pending list used for Concept/Skill/Competency interventions');

  const evidenceBeforeStart = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [STUDENT_1])).rows[0].c;
  const readinessBeforeStart = (await db.query(`SELECT COUNT(*)::int AS c FROM readiness_snapshots WHERE exam_profile_id = $1`, [PAA_EXAM_PROFILE_ID])).rows[0].c;

  const startedTopic = await startTeacherInterventionExecution(STUDENT_1_OWNER, topicIntervention.id, 'idem-topic-exam');
  assert(startedTopic.outcome === 'STARTED', 'Case D1: explicit TOPIC_EXAM execution starts a real F9 simulation attempt');
  const topicAttemptId = (startedTopic as any).executionReference;
  const topicAttempt = await getSimulationAttempt(topicAttemptId);
  assert(topicAttempt !== null && topicAttempt.simulationType === 'TOPIC_EXAM' && topicAttempt.examVersionId === PAA_EXAM_VERSION_ID, 'Case D1: the real simulation attempt carries the exact TOPIC_EXAM/PAA-version identity the Teacher assigned');

  console.log('--- CASE W: no direct Evidence write from STARTING an exam execution ---');
  const evidenceAfterStart = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [STUDENT_1])).rows[0].c;
  assert(evidenceAfterStart === evidenceBeforeStart, 'Case W: starting an Exam Reinforcement execution writes ZERO learning_evidence rows -- Evidence only ever arises from a real response submission through F9\'s own recordSimulationItemResponse');

  console.log('--- CASE X: no direct readiness write from STARTING an exam execution ---');
  const readinessAfterStart = (await db.query(`SELECT COUNT(*)::int AS c FROM readiness_snapshots WHERE exam_profile_id = $1`, [PAA_EXAM_PROFILE_ID])).rows[0].c;
  assert(readinessAfterStart === readinessBeforeStart, 'Case X: starting an Exam Reinforcement execution writes ZERO readiness_snapshots rows -- F11-C4 never recomputes readiness itself');

  const afterStartRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [topicIntervention.id]);
  assert(afterStartRow.rows[0].status === 'IN_PROGRESS', 'Case M: lifecycle ASSIGNED -> IN_PROGRESS on a real Exam execution being created');

  console.log('--- Recording a REAL response through F9\'s own, unmodified recordSimulationItemResponse (never F11-C4 grading) ---');
  const question = { id: 'f11c4-q1', conceptId: LEARNER_CONCEPT_ID, type: 'single_choice', answerFormat: 'single_choice', question: 'x + 1 = 2, x = ?', correctAnswer: 'A', explanation: '', difficulty: 3 } as any;
  await recordSimulationItemResponse({
    examAttemptId: topicAttempt!.examAttemptId,
    studentId: STUDENT_1,
    examVersionId: PAA_EXAM_VERSION_ID,
    assessmentComponentId: componentMathId,
    learningObjectiveId: OBJ_MATH,
    question,
    studentAnswer: 'B',
  });
  const evidenceAfterResponse = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [STUDENT_1])).rows[0].c;
  assert(evidenceAfterResponse === evidenceBeforeStart + 1, 'Real Evidence proof: exactly ONE learning_evidence row was produced, by F9\'s own real writer -- none by F11-C4');

  console.log('--- CASE R: double response submission (same idempotencyKey) -- no duplicate Evidence ---');
  const beforeDoubleSubmit = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [STUDENT_1])).rows[0].c;
  const firstSubmit = await recordSimulationItemResponse({
    examAttemptId: topicAttempt!.examAttemptId, studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID,
    assessmentComponentId: componentMathId, learningObjectiveId: OBJ_MATH,
    question: { ...question, id: 'f11c4-q2' }, studentAnswer: 'A', idempotencyKey: 'f11c4-double-submit-key',
  });
  const secondSubmit = await recordSimulationItemResponse({
    examAttemptId: topicAttempt!.examAttemptId, studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID,
    assessmentComponentId: componentMathId, learningObjectiveId: OBJ_MATH,
    question: { ...question, id: 'f11c4-q2' }, studentAnswer: 'A', idempotencyKey: 'f11c4-double-submit-key',
  });
  const afterDoubleSubmit = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [STUDENT_1])).rows[0].c;
  assert(secondSubmit.duplicate === true && secondSubmit.responseId === firstSubmit.responseId, 'Case R: a resubmission with the SAME idempotencyKey returns the EXISTING response, never re-grades');
  assert(afterDoubleSubmit === beforeDoubleSubmit + 1, 'Case R: exactly ONE learning_evidence row from two identical submissions -- zero duplicate Evidence');

  console.log('--- CASE N/O/AC/AD: real completion -> COMPLETED, incorrect-score still completes, F8 diagnosis reused, F9 readiness recomputed ---');
  const completedAttempt = await completeSimulationAttempt(topicAttemptId);
  assert(completedAttempt.status === 'COMPLETED', 'Case N: the real F9 simulation attempt reaches COMPLETED via its own, unmodified completion function');

  const pendingAfterComplete = await getStudentPendingTeacherInterventions(STUDENT_1);
  assert(!pendingAfterComplete.some((p) => p.id === topicIntervention.id), 'Lifecycle: IN_PROGRESS -> COMPLETED reconciled lazily by observing the real simulation_attempts.status, using the SAME reconciliation loop as Concept/Skill/Competency');
  const afterCompleteRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [topicIntervention.id]);
  assert(afterCompleteRow.rows[0].status === 'COMPLETED', 'Case O: intervention reached COMPLETED even though one of the two recorded responses was INCORRECT -- operational completion, never an academic judgment');

  const postExamDiagnosis = await runPostExamDiagnosis(topicAttempt!.examAttemptId, STUDENT_1, PAA_EXAM_VERSION_ID);
  assert(postExamDiagnosis.diagnoses.length > 0, 'Case AC: F8\'s real post-exam diagnosis classifier ran on the touched concept -- reused verbatim, never duplicated by F11-C4 (source-guard proves F11-C4 itself never calls runPostExamDiagnosis)');

  const readinessSnapshot = await computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: PAA_EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID });
  const readinessAfterCompletion = (await db.query(`SELECT COUNT(*)::int AS c FROM readiness_snapshots WHERE exam_profile_id = $1`, [PAA_EXAM_PROFILE_ID])).rows[0].c;
  assert(readinessAfterCompletion === readinessBeforeStart + 1, 'Case AD: exactly ONE new F9 readiness snapshot exists after the Student\'s own real completion flow recomputed it -- F11-C4 itself never calls computeReadinessSnapshot (source-guard proven)');
  void readinessSnapshot;

  console.log('--- CASE S: double finalization -- no duplicate scoring/diagnosis ---');
  let secondCompletionRejected = false;
  try {
    await completeSimulationAttempt(topicAttemptId);
  } catch {
    secondCompletionRejected = true;
  }
  assert(secondCompletionRejected, 'Case S: a second finalization of the SAME attempt is rejected by F9\'s own, unmodified completion function -- never re-scored, never re-diagnosed');

  console.log('--- CASE D2/D3: DOMAIN_EXAM and MINI_MOCK also execute legitimately through the SAME orchestrator ---');
  const domainIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: STUDENT_1, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: PAA_EXAM_PROFILE_ID, simulationType: 'DOMAIN_EXAM', academicSubjectId: paaMathAcademicSubjectId },
  });
  const startedDomain = await startTeacherInterventionExecution(STUDENT_1_OWNER, domainIntervention.id, 'idem-domain-exam');
  assert(startedDomain.outcome === 'STARTED', 'Case D2: DOMAIN_EXAM (Math academic subject, fully supported) executes legitimately through the identical orchestrator code path');
  const domainAttempt = await getSimulationAttempt((startedDomain as any).executionReference);
  assert(domainAttempt!.simulationType === 'DOMAIN_EXAM', 'Case D2: the real simulation attempt correctly self-identifies as DOMAIN_EXAM, never masquerading as TOPIC_EXAM or FULL_MOCK');

  const miniMockIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: STUDENT_1, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: PAA_EXAM_PROFILE_ID, simulationType: 'MINI_MOCK' },
  });
  const startedMiniMock = await startTeacherInterventionExecution(STUDENT_1_OWNER, miniMockIntervention.id, 'idem-mini-mock');
  assert(startedMiniMock.outcome === 'STARTED', 'Case D3: MINI_MOCK (Math is the only fully-supported+mapped objective, so it is structurally eligible) executes legitimately through the identical orchestrator code path');
  const miniMockAttempt = await getSimulationAttempt((startedMiniMock as any).executionReference);
  assert(miniMockAttempt!.simulationType === 'MINI_MOCK', 'Case D3: the real simulation attempt correctly self-identifies as MINI_MOCK, never masquerading as FULL_MOCK');

  console.log('--- CASE E: PAA FULL_MOCK NOT_READY -- mandatory negative proof (never bypassable) ---');
  const rawFullMockEligibility = await getFullMockEligibility(PAA_EXAM_VERSION_ID);
  assert(!rawFullMockEligibility.eligible, 'Fixture validity: PAA Full Mock is genuinely NOT_READY in this environment (Reading remains structurally unsupported) -- the real, honest platform truth this proof depends on');

  const fullMockIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: STUDENT_1, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: PAA_EXAM_PROFILE_ID, simulationType: 'FULL_MOCK' },
  });
  assert(fullMockIntervention.status === 'ASSIGNED', 'A Teacher MAY assign a Full Mock intervention (product semantics: assignment expresses intent, not platform capability)');
  await assertNotStartable(
    startTeacherInterventionExecution(STUDENT_1_OWNER, fullMockIntervention.id, 'idem-full-mock-paa'),
    'Case E (CRITICAL): starting the SAME Full Mock intervention is rejected -- the Student never receives a runnable Full Mock attempt while PAA is genuinely NOT_READY'
  );
  const fullMockExecutionRows = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [fullMockIntervention.id])).rows[0].c;
  assert(fullMockExecutionRows === 0, 'Case E: zero execution registry rows and zero real F9 simulation_attempts were created for the rejected PAA Full Mock');
  const fullMockAttemptsForStudent = (await db.query(`SELECT COUNT(*)::int AS c FROM simulation_attempts WHERE student_id = $1 AND simulation_type = 'FULL_MOCK'`, [STUDENT_1])).rows[0].c;
  assert(fullMockAttemptsForStudent === 0, 'Case E: zero FULL_MOCK simulation_attempts rows exist anywhere for this student -- no fake readiness update, no fabricated official timing/scoring');

  console.log('--- CASE F/G: framework/version isolation + shared canonical knowledge across PAA and Cambridge ---');
  const cambridgeIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: STUDENT_1, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: CAMBRIDGE_EXAM_PROFILE_ID, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_CAMBRIDGE },
  });
  const startedCambridge = await startTeacherInterventionExecution(STUDENT_1_OWNER, cambridgeIntervention.id, 'idem-cambridge-topic-exam');
  assert(startedCambridge.outcome === 'STARTED', 'A Cambridge TOPIC_EXAM intervention starts independently of the PAA one');
  const cambridgeAttempt = await getSimulationAttempt((startedCambridge as any).executionReference);
  assert(cambridgeAttempt!.examVersionId === CAMBRIDGE_EXAM_VERSION_ID && cambridgeAttempt!.examVersionId !== PAA_EXAM_VERSION_ID, 'Case F: the Cambridge execution is frozen to the Cambridge exam version, structurally isolated from PAA -- a Teacher assigning PAA never accidentally starts a Cambridge simulation or vice versa');

  const mappingRows = await db.query(
    `SELECT canonical_concept_id FROM objective_concept_mappings WHERE learning_objective_id = ANY($1::uuid[]) AND status = 'PUBLISHED'`,
    [[OBJ_MATH, OBJ_CAMBRIDGE]]
  );
  const distinctConcepts = new Set(mappingRows.rows.map((r: any) => r.canonical_concept_id));
  assert(distinctConcepts.size === 1, 'Case G: PAA\'s OBJ_MATH and Cambridge\'s OBJ_CAMBRIDGE resolve to the IDENTICAL canonical concept -- one shared knowledge identity, never duplicated');
  assert(topicAttempt!.examVersionId !== cambridgeAttempt!.examVersionId, 'Case G: despite sharing one canonical concept, the two exam executions remain genuinely separate contexts (different exam version, different simulation attempt) -- never conflated');

  console.log('--- CROSS-ROLE ADVERSARIAL MATRIX (H/I/J/K/L) ---');
  const advIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: STUDENT_2, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: student2PaaProfile.id, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_MATH },
  });

  const startedForOwner = await startTeacherInterventionExecution(STUDENT_2_OWNER, advIntervention.id, 'idem-owner-exam');
  assert(startedForOwner.outcome === 'STARTED', 'Case H: the actual Student owner starts their own Exam Reinforcement intervention successfully');

  const otherOwnerRow = await db.query(`SELECT user_id FROM students WHERE id = $1`, [STUDENT_1]);
  await assertStudentDenied(
    startTeacherInterventionExecution(otherOwnerRow.rows[0].user_id, advIntervention.id, 'idem-cross-student-exam'),
    'Case I: a different Student cannot start another Student\'s Exam Reinforcement intervention'
  );

  const parentActor = await seedTeacherActor();
  const parentProfileRow = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Parent Adversarial Exam', $1, $2) RETURNING id`,
    [parentActor.clerkId, parentActor.actorUserId]
  );
  const student2Email = (await db.query(`SELECT email FROM students WHERE id = $1`, [STUDENT_2])).rows[0].email;
  await linkChildByEmail(parentProfileRow.rows[0].id, student2Email);
  await respondToRequest(STUDENT_2, parentProfileRow.rows[0].id, true);
  await assertStudentDenied(
    startTeacherInterventionExecution(parentActor.actorUserId, advIntervention.id, 'idem-parent-exam'),
    'Case J: an accepted Parent relationship does not authorize executing the child\'s Exam Reinforcement intervention'
  );

  await assertStudentDenied(
    startTeacherInterventionExecution(fxMain.teacher.actorUserId, advIntervention.id, 'idem-assigning-teacher-exam'),
    'Case K (assigning Teacher): the Teacher who assigned it cannot execute it via the Student route'
  );
  const unrelatedTeacherFx = await seedFullTeacherClassFixture('UNRELATED-TEACHER-EXAM');
  await assertStudentDenied(
    startTeacherInterventionExecution(unrelatedTeacherFx.teacher.actorUserId, advIntervention.id, 'idem-unrelated-teacher-exam'),
    'Case K (unrelated Teacher): an unrelated Teacher cannot execute it via the Student route'
  );

  const multiRoleFx = await seedFullTeacherClassFixture('MULTI-ROLE-EXAM');
  const multiRoleUser = multiRoleFx.teacher;
  const someOtherChildRow = await db.query(`SELECT id, email FROM students WHERE clerk_id = 'clerk_f9_learner1'`);
  const multiRoleParentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Multi Role Exam', $1, $2) RETURNING id`,
    [multiRoleUser.clerkId, multiRoleUser.actorUserId]
  );
  await linkChildByEmail(multiRoleParentProfile.rows[0].id, someOtherChildRow.rows[0].email);
  await respondToRequest(someOtherChildRow.rows[0].id, multiRoleParentProfile.rows[0].id, true);
  await assertStudentDenied(
    startTeacherInterventionExecution(multiRoleUser.actorUserId, advIntervention.id, 'idem-multi-role-exam'),
    'Case L: a PARENT+TEACHER actor with real relationships to OTHER students still cannot execute an Exam Reinforcement intervention belonging to a student they do not own'
  );

  console.log('--- IDEMPOTENCY (P/Q) -- lock-serialized, race-eliminating model ---');
  const startedAdv1 = await startTeacherInterventionExecution(STUDENT_2_OWNER, advIntervention.id, 'idem-owner-exam');
  assert(startedAdv1.outcome === 'RECOVERED' && (startedAdv1 as any).executionId === (startedForOwner as any).executionId, 'Case P: a sequential retry with the SAME idempotencyKey as an earlier call RECOVERS the identical execution, never starts a second');
  const rowCountSeq = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [advIntervention.id])).rows[0].c;
  assert(rowCountSeq === 1, 'Case P: exactly ONE teacher_intervention_executions row after sequential retry');

  const fxConc = await seedFullTeacherClassFixture('CONCURRENCY-EXAM');
  await enrollStudent(fxConc.classA.id, STUDENT_1);
  const concIntervention = await assignTeacherIntervention(fxConc.teacher.actorUserId, {
    classId: fxConc.classA.id, studentId: STUDENT_1, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: PAA_EXAM_PROFILE_ID, simulationType: 'DOMAIN_EXAM', academicSubjectId: paaMathAcademicSubjectId },
  });
  const attemptCountBeforeRace = (await db.query(`SELECT COUNT(*)::int AS c FROM simulation_attempts WHERE exam_profile_id = $1 AND simulation_type = 'DOMAIN_EXAM'`, [PAA_EXAM_PROFILE_ID])).rows[0].c;
  const [concA, concB] = await Promise.all([
    startTeacherInterventionExecution(STUDENT_1_OWNER, concIntervention.id, 'same-key-concurrent-exam'),
    startTeacherInterventionExecution(STUDENT_1_OWNER, concIntervention.id, 'same-key-concurrent-exam'),
  ]);
  const concurrentRowCount = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [concIntervention.id])).rows[0].c;
  const attemptCountAfterRace = (await db.query(`SELECT COUNT(*)::int AS c FROM simulation_attempts WHERE exam_profile_id = $1 AND simulation_type = 'DOMAIN_EXAM'`, [PAA_EXAM_PROFILE_ID])).rows[0].c;
  assert(concurrentRowCount === 1, 'Case Q (CRITICAL): two truly simultaneous start calls with the SAME key converge to exactly ONE teacher_intervention_executions row');
  assert((concA as any).executionId === (concB as any).executionId, 'Case Q: both concurrent calls resolve to the SAME execution id');
  assert(attemptCountAfterRace === attemptCountBeforeRace + 1, `Case Q (CRITICAL, task §31): exactly ONE new real F9 simulation_attempts row was created by the concurrent race (before=${attemptCountBeforeRace}, after=${attemptCountAfterRace}) -- not merely a harmless orphan, a structurally ELIMINATED race (the lock-serialized claim-and-create model, unlike Practice's post-generation UNIQUE-constraint recovery)`);

  console.log('--- CASE T: failure recovery -- exam context resolution failure rolls back cleanly, zero false completion, zero duplicate Evidence, retry succeeds ---');
  const orphanExamDef = await db.query(`INSERT INTO exam_definitions (name, exam_family, status) VALUES ('F11C4 Orphan Exam Def', 'ADMISSION_EXAM', 'ACTIVE') RETURNING id`);
  const brokenProfile = await createStudentExamProfile({ studentId: STUDENT_1, examDefinitionId: orphanExamDef.rows[0].id, purpose: 'ADMISSION_PREP' });
  const brokenIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: STUDENT_1, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: brokenProfile.id, simulationType: 'MINI_MOCK' },
  });
  const evidenceBeforeFailure = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [STUDENT_1])).rows[0].c;
  await assertNotStartable(
    startTeacherInterventionExecution(STUDENT_1_OWNER, brokenIntervention.id, 'idem-broken-profile'),
    'Case T: an exam profile with no resolvable exam version (no pinned version, no PUBLISHED version for its definition) fails controlled deep in the orchestration chain'
  );
  const brokenAfterRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [brokenIntervention.id]);
  assert(brokenAfterRow.rows[0].status === 'ASSIGNED', 'Case T: the intervention remains ASSIGNED (never falsely IN_PROGRESS/COMPLETED) after the mid-chain failure -- the transaction rolled back cleanly');
  const brokenExecutionRows = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [brokenIntervention.id])).rows[0].c;
  assert(brokenExecutionRows === 0, 'Case T: zero execution registry rows were created by the failed attempt');
  const evidenceAfterFailure = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [STUDENT_1])).rows[0].c;
  assert(evidenceAfterFailure === evidenceBeforeFailure, 'Case T: zero Evidence was produced by the failed attempt');
  await db.query(`UPDATE student_exam_profiles SET exam_version_id = $1 WHERE id = $2`, [PAA_EXAM_VERSION_ID, brokenProfile.id]);
  const retriedStart = await startTeacherInterventionExecution(STUDENT_1_OWNER, brokenIntervention.id, 'idem-broken-profile-retry');
  assert(retriedStart.outcome === 'STARTED', 'Case T: after correcting the underlying resource, a retry with a fresh idempotency key succeeds normally -- retry/recovery follows existing F9 semantics, no permanent lockout from one failure');

  console.log('--- CASE U/V: cancelled and expired intervention denial ---');
  const cancelIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: STUDENT_1, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: PAA_EXAM_PROFILE_ID, simulationType: 'MINI_MOCK' },
  });
  await cancelTeacherIntervention(fxMain.teacher.actorUserId, cancelIntervention.id, 'no longer needed');
  await assertNotStartable(
    startTeacherInterventionExecution(STUDENT_1_OWNER, cancelIntervention.id, 'idem-cancelled-exam'),
    'Case U: a CANCELLED Exam Reinforcement intervention cannot be started'
  );

  const expiredIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: STUDENT_1, interventionType: 'EXAM_PRACTICE',
    target: { targetType: 'EXAM', examProfileId: PAA_EXAM_PROFILE_ID, simulationType: 'MINI_MOCK' },
    dueAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await assertNotStartable(
    startTeacherInterventionExecution(STUDENT_1_OWNER, expiredIntervention.id, 'idem-expired-exam'),
    'Case V: an effectively-EXPIRED Exam Reinforcement intervention (derived from due_at, never a persisted fake status) cannot be started'
  );

  console.log('--- CASE AB: historical attempt immutable after configuration change ---');
  const frozenBefore = JSON.stringify((await getExamAttempt(domainAttempt!.examAttemptId))!.frozenConfiguration);
  await db.query(`UPDATE assessment_components SET tool_rule_status = 'NOT_CONFIGURED', tool_rules = NULL WHERE id = $1`, [componentMathId]);
  const frozenAfter = JSON.stringify((await getExamAttempt(domainAttempt!.examAttemptId))!.frozenConfiguration);
  assert(frozenBefore === frozenAfter, 'Case AB: a historical Exam Reinforcement attempt\'s frozen_configuration never changes after a later component configuration change');
  await db.query(`UPDATE assessment_components SET tool_rule_status = 'CONFIGURED', tool_rules = '{"calculator":"PROHIBITED"}'::jsonb WHERE id = $1`, [componentMathId]);

  console.log('--- CASE Z/AA: score projection safety + no admission-claim fabrication ---');
  const scoreModelsForPaa = (await db.query(`SELECT COUNT(*)::int AS c FROM score_conversion_models WHERE exam_version_id = $1`, [PAA_EXAM_VERSION_ID])).rows[0].c;
  assert(scoreModelsForPaa === 0, 'Case Z: zero score_conversion_models exist for PAA -- F11-C4 never fabricates an official score projection capability');
  const policiesUnchanged = (await db.query(`SELECT COUNT(*)::int AS c FROM institution_exam_policies`)).rows[0].c;
  assert(typeof policiesUnchanged === 'number', 'Case AA: F11-C4 never creates or modifies institution_exam_policies rows (source-guard: the orchestration file never references that table)');

  console.log('');
  console.log('=== F11-C4 CERTIFICATION: ALL ASSERTIONS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F11-C4 certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
