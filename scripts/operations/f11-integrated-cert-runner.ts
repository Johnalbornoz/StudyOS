/**
 * F11 -- INTEGRATED CERTIFICATION GATE. Certifies F11 as ONE integrated
 * Teacher Workspace system (not merely four individually-passing
 * adapters): F9 Student self-service non-regression, one real Teacher
 * flow exercising all four intervention types through the SAME
 * dispatcher/read-model, joint Evidence-semantics proofs, the full
 * authorization matrix, lifecycle, underlying-engine authority (zero
 * F11 direct writes), PAA Full Mock convergence between Teacher
 * assignment and Student self-service, joint concurrency, and the two
 * coexisting entry points (F9 self-service vs F11 assignment). Every
 * case is a real service call against real ephemeral Postgres, never a
 * mock.
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
  listTeacherInterventionsForStudent,
  TeacherInterventionAccessDeniedError,
} from '@/lib/teacher/intervention.service';
import {
  getStudentPendingTeacherInterventions,
  startTeacherInterventionExecution,
  StudentInterventionAccessDeniedError,
  StudentInterventionNotStartableError,
} from '@/lib/student/teacher-intervention-execution.service';
import { generatePracticeQuestions } from '@/services/quiz-generation.service';
import { storeQuiz, getQuizSession, completeQuiz } from '@/services/quiz-persistence.service';
import { getStudentExamProfile, createStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import { getFullMockEligibility } from '@/lib/simulation/full-mock-eligibility.service';
import { startSimulationAttempt, getSimulationAttempt, completeSimulationAttempt } from '@/lib/simulation/attempt.service';
import { recordSimulationItemResponse } from '@/lib/simulation/scoring.service';
import { updateMastery } from '@/services/mastery.service';
import { getSkillState } from '@/lib/learner-state/skill-state.service';
import { getCompetencyState } from '@/lib/learner-state/competency-state.service';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
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

async function assertTeacherDenied(promise: Promise<unknown>, message: string) {
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

let teacherCounter = 0;
async function seedTeacherActor(): Promise<{ actorUserId: string; clerkId: string }> {
  teacherCounter += 1;
  const clerkId = `clerk_f11int_teacher_${teacherCounter}`;
  const canonical = await getOrCreateCanonicalUser(clerkId, `f11int-teacher-${teacherCounter}@test.local`);
  return { actorUserId: canonical.id, clerkId };
}

let studentCounter = 0;
async function seedStudent(name: string): Promise<{ studentId: string; ownerActorId: string; email: string }> {
  studentCounter += 1;
  const clerkId = `clerk_f11int_student_${studentCounter}`;
  const email = `f11int-student-${studentCounter}@test.local`;
  const result = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`, [clerkId, email, name]);
  const studentId = result.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [studentId, name]);
  const canonical = await getOrCreateCanonicalUser(clerkId, email);
  await db.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [canonical.id, studentId]);
  return { studentId, ownerActorId: canonical.id, email };
}

async function seedAdmin(label: string): Promise<{ actorUserId: string }> {
  const result = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`clerk_f11int_admin_${label}`, `f11int-admin-${label}@test.local`]);
  return { actorUserId: result.rows[0].id };
}

async function seedFullTeacherClassFixture(label: string) {
  const institution = await createInstitution(`F11 Integrated Institution ${label}`);
  const admin = await seedAdmin(label);
  await inviteInstitutionAdmin(institution.id, admin.actorUserId);

  const teacher = await seedTeacherActor();
  const membership = await requestTeacherMembership(institution.id, teacher.actorUserId);
  const approved = await decideMembership(membership.id, admin.actorUserId, 'APPROVED');
  if (!approved) throw new Error(`fixture setup failed: membership not approved for ${label}`);

  const grade = await createGrade(institution.id, `Grade ${label}`);
  const classA = await createClass(institution.id, grade.id, `Class ${label}`);
  const assignment = await createTeacherAssignment(membership.id, { classId: classA.id });

  return { institution, admin, teacher, membership, grade, classA, assignment };
}

async function seedCanonicalSubject(name: string): Promise<string> {
  return (await db.query(`INSERT INTO canonical_subjects (name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
}
async function seedCanonicalConcept(canonicalSubjectId: string, name: string): Promise<string> {
  return (await db.query(`INSERT INTO canonical_concepts (canonical_subject_id, name) VALUES ($1, $2) RETURNING id`, [canonicalSubjectId, name])).rows[0].id;
}
async function seedSkill(name: string): Promise<string> {
  return (await db.query(`INSERT INTO skills (name, skill_type, status) VALUES ($1, 'DISCIPLINE_SPECIFIC', 'ACTIVE') RETURNING id`, [name])).rows[0].id;
}
async function seedCompetency(name: string): Promise<string> {
  const code = `F11INT-${name.replace(/\s+/g, '-').toUpperCase()}-${Math.random().toString(36).slice(2, 8)}`;
  return (await db.query(`INSERT INTO competencies (code, name, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [code, name])).rows[0].id;
}
async function linkCanonicalConceptToSkill(canonicalConceptId: string, skillId: string): Promise<void> {
  await db.query(`INSERT INTO canonical_concept_skills (canonical_concept_id, skill_id) VALUES ($1, $2)`, [canonicalConceptId, skillId]);
}
async function linkCanonicalConceptToCompetency(canonicalConceptId: string, competencyId: string): Promise<void> {
  await db.query(`INSERT INTO canonical_concept_competencies (canonical_concept_id, competency_id) VALUES ($1, $2)`, [canonicalConceptId, competencyId]);
}
async function seedStudentConcept(subjectId: string, label: string): Promise<string> {
  return (await db.query(`INSERT INTO concepts (id, subject_id, canonical_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [subjectId, `f11int.${label}`])).rows[0].id;
}
async function matchStudentConceptToCanonical(learnerConceptId: string, canonicalConceptId: string): Promise<void> {
  await db.query(
    `INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ($1, $2, 'MATCHED', 'SEED_FIXTURE')`,
    [learnerConceptId, canonicalConceptId]
  );
}

async function simulateRealQuizSubmission(params: { studentId: string; conceptId: string; subjectId: string; quizId: string; skillIds?: string[]; competencyIds?: string[]; result: 'correct' | 'incorrect' }) {
  await updateMastery({
    studentId: params.studentId,
    conceptId: params.conceptId,
    subjectId: params.subjectId,
    evidence: { sourceType: 'PRACTICE_QUESTION', result: params.result, difficulty: 3, scorePercent: params.result === 'correct' ? 100 : 0 },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 },
    metadata: { activityType: 'PRACTICE', evidenceMode: 'GENERAL', ...(params.skillIds ? { skillIds: params.skillIds } : {}), ...(params.competencyIds ? { competencyIds: params.competencyIds } : {}) },
    identity: { operationType: 'QUIZ_SUBMISSION', operationId: params.quizId, conceptId: params.conceptId },
  });
  await completeQuiz(params.quizId);
}

async function main() {
  console.log('=== F11 INTEGRATED CERTIFICATION GATE ===');
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

  // ================================================================
  // SECTION 1: STUDENT SELF-SERVICE NON-REGRESSION
  // ================================================================
  console.log('--- SECTION 1: F9 STUDENT SELF-SERVICE NON-REGRESSION ---');
  const student1Row = await db.query(`SELECT id, user_id FROM students WHERE clerk_id = 'clerk_f9_learner1'`);
  const STUDENT_1 = student1Row.rows[0].id;
  const STUDENT_1_OWNER = student1Row.rows[0].user_id;
  const paaExamDefRow = await db.query(`SELECT id FROM exam_definitions WHERE name = 'PAA (F9)'`);
  const PAA_EXAM_DEF_ID = paaExamDefRow.rows[0].id;
  const PAA_EXAM_VERSION_ID = (await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [PAA_EXAM_DEF_ID])).rows[0].id;
  const PAA_EXAM_PROFILE_ID = (await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_version_id = $2`, [STUDENT_1, PAA_EXAM_VERSION_ID])).rows[0].id;
  const OBJ_MATH = (await db.query(`SELECT id FROM learning_objectives WHERE code = 'PAA-M-F9-1'`)).rows[0].id;
  const componentMathId = (await db.query(`SELECT assessment_component_id FROM blueprint_objective_targets WHERE learning_objective_id = $1`, [OBJ_MATH])).rows[0].assessment_component_id;
  const paaMathAcademicSubjectId = (await db.query(`SELECT academic_subject_id FROM assessment_components WHERE id = $1`, [componentMathId])).rows[0].academic_subject_id;

  // A/B/C: Student self-service, DIRECTLY via F9's own real functions -- exactly as the real /api/simulation/attempts route calls them -- with ZERO reference to any teacher_intervention.
  const selfServiceTopic = await startSimulationAttempt({ studentId: STUDENT_1, examProfileId: PAA_EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_MATH, timingMode: 'UNTIMED', language: 'en' });
  assert(selfServiceTopic.simulationAttempt.status === 'ACTIVE', 'Case A: TOPIC_EXAM self-service works independently of any Teacher intervention');
  const selfServiceDomain = await startSimulationAttempt({ studentId: STUDENT_1, examProfileId: PAA_EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'DOMAIN_EXAM', academicSubjectId: paaMathAcademicSubjectId, timingMode: 'UNTIMED', language: 'en' });
  assert(selfServiceDomain.simulationAttempt.status === 'ACTIVE', 'Case B: DOMAIN_EXAM self-service works independently of any Teacher intervention');
  const selfServiceMini = await startSimulationAttempt({ studentId: STUDENT_1, examProfileId: PAA_EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'MINI_MOCK', timingMode: 'UNTIMED', language: 'en' });
  assert(selfServiceMini.simulationAttempt.status === 'ACTIVE', 'Case C: MINI_MOCK self-service works independently of any Teacher intervention');

  const selfServiceFullMockEligibility = await getSimulationEligibility({ studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'FULL_MOCK' });
  assert(!selfServiceFullMockEligibility.eligible, 'Case D: PAA FULL_MOCK self-service is NOT_READY under current certified platform configuration -- identical to the Teacher-assignment path');

  const selfServiceExecutionRows = await db.query(
    `SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE execution_reference IN ($1, $2, $3)`,
    [selfServiceTopic.simulationAttempt.id, selfServiceDomain.simulationAttempt.id, selfServiceMini.simulationAttempt.id]
  );
  assert(selfServiceExecutionRows.rows[0].c === 0, 'Case E: zero teacher_intervention_executions rows reference any of these self-service attempts -- self-service has zero F11 dependency');

  const simulationAttemptsRouteSrc = readFile('src/app/api/simulation/attempts/route.ts');
  assert(!simulationAttemptsRouteSrc.includes('teacher_intervention'), 'Case F: the existing F9 Student self-service route/schema does not require or reference teacher_intervention_id anywhere');

  // ================================================================
  // SECTION 2/5/6: INTEGRATED TEACHER FLOW -- all four types, one Teacher/class/student, real engines, real lifecycle
  // ================================================================
  console.log('--- SECTION 2/5/6: INTEGRATED TEACHER FLOW (all 4 intervention types) ---');
  const fxMain = await seedFullTeacherClassFixture('MAIN');
  const student = await seedStudent('Integrated Flow Student');
  await enrollStudent(fxMain.classA.id, student.studentId);
  const subjectId = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Integrated Subject') RETURNING id`, [student.studentId])).rows[0].id;

  const canonicalSubject = await seedCanonicalSubject('F11-Integrated Canonical Subject');
  // Deliberately SEPARATE canonical concepts for Skill vs Competency context
  // resolution (each maps to its own dedicated canonical concept, matched to
  // its own dedicated learner concept) -- sharing one canonical concept
  // across two different learner-concept mappings would make
  // resolveStudentConceptForCanonicalConcept's result ambiguous between the
  // two, which would silently collapse the Skill and Competency executions
  // onto the SAME concept id and corrupt the Evidence-semantics proof below.
  const canonicalConceptForSkill = await seedCanonicalConcept(canonicalSubject, 'Integrated Canonical Concept (Skill)');
  const canonicalConceptForCompetency = await seedCanonicalConcept(canonicalSubject, 'Integrated Canonical Concept (Competency)');
  const skillS = await seedSkill('Integrated Skill');
  const competencyK = await seedCompetency('Integrated Competency');
  await linkCanonicalConceptToSkill(canonicalConceptForSkill, skillS);
  await linkCanonicalConceptToCompetency(canonicalConceptForCompetency, competencyK);

  const conceptForConcept = await seedStudentConcept(subjectId, 'concept-target');
  const conceptForSkill = await seedStudentConcept(subjectId, 'skill-context');
  const conceptForCompetency = await seedStudentConcept(subjectId, 'competency-context');
  await matchStudentConceptToCanonical(conceptForSkill, canonicalConceptForSkill);
  await matchStudentConceptToCanonical(conceptForCompetency, canonicalConceptForCompetency);

  const examProfile = await createStudentExamProfile({ studentId: student.studentId, examDefinitionId: PAA_EXAM_DEF_ID, examVersionId: PAA_EXAM_VERSION_ID, purpose: 'ADMISSION_PREP' });
  // Match this student's own concept to F9's real canonical concept behind
  // OBJ_MATH (the same 'Linear Equations' canonical concept F9's own
  // seeded STUDENT_1 is matched to) -- without this, recordSimulationItemResponse's
  // real bridge resolves no student concept and legitimately skips Evidence.
  const examConcept = await seedStudentConcept(subjectId, 'exam-math-context');
  await matchStudentConceptToCanonical(examConcept, 'facecafe-0000-4000-8000-0000000000f1');

  // 1. CONCEPT
  const conceptIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: student.studentId, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: conceptForConcept },
  });
  const startedConcept = await startTeacherInterventionExecution(student.ownerActorId, conceptIntervention.id, 'idem-int-concept');
  assert(startedConcept.outcome === 'STARTED', 'CONCEPT intervention starts a real TOPIC_PRACTICE quiz (F5/Practice path)');
  await simulateRealQuizSubmission({ studentId: student.studentId, conceptId: conceptForConcept, subjectId, quizId: (startedConcept as any).executionReference, result: 'correct' });

  // 2. SKILL
  const skillIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: student.studentId, interventionType: 'SKILL_PRACTICE', target: { targetType: 'SKILL', skillId: skillS },
  });
  const startedSkill = await startTeacherInterventionExecution(student.ownerActorId, skillIntervention.id, 'idem-int-skill');
  assert(startedSkill.outcome === 'STARTED', 'SKILL intervention starts a real TOPIC_PRACTICE quiz tagged with the explicit Skill (F5/Practice path)');
  const skillQuiz = await getQuizSession((startedSkill as any).executionReference);
  await simulateRealQuizSubmission({ studentId: student.studentId, conceptId: skillQuiz!.conceptId!, subjectId, quizId: (startedSkill as any).executionReference, skillIds: [skillS], result: 'incorrect' });

  // 3. COMPETENCY
  const competencyIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: student.studentId, interventionType: 'COMPETENCY_PRACTICE', target: { targetType: 'COMPETENCY', competencyId: competencyK },
  });
  const startedCompetency = await startTeacherInterventionExecution(student.ownerActorId, competencyIntervention.id, 'idem-int-competency');
  assert(startedCompetency.outcome === 'STARTED', 'COMPETENCY intervention starts a real TOPIC_PRACTICE quiz tagged with the explicit Competency (F5/Practice path)');
  const competencyQuiz = await getQuizSession((startedCompetency as any).executionReference);
  await simulateRealQuizSubmission({ studentId: student.studentId, conceptId: competencyQuiz!.conceptId!, subjectId, quizId: (startedCompetency as any).executionReference, competencyIds: [competencyK], result: 'correct' });

  // 4. EXAM
  const examIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: student.studentId, interventionType: 'EXAM_PRACTICE', target: { targetType: 'EXAM', examProfileId: examProfile.id, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_MATH },
  });
  const startedExam = await startTeacherInterventionExecution(student.ownerActorId, examIntervention.id, 'idem-int-exam');
  assert(startedExam.outcome === 'STARTED', 'EXAM intervention starts a real F9 simulation attempt (F7/F9 path)');
  const examAttempt = await getSimulationAttempt((startedExam as any).executionReference);
  await recordSimulationItemResponse({
    examAttemptId: examAttempt!.examAttemptId, studentId: student.studentId, examVersionId: PAA_EXAM_VERSION_ID, assessmentComponentId: componentMathId, learningObjectiveId: OBJ_MATH,
    question: { id: 'int-q1', type: 'single_choice', answerFormat: 'single_choice', question: 'x?', correctAnswer: 'A', explanation: '', difficulty: 3 } as any, studentAnswer: 'B',
  });
  await completeSimulationAttempt(examAttempt!.id);

  // Student sees + lifecycle: all four intervention pendings clear once each is legitimately finalized.
  const pendingAfterAll = await getStudentPendingTeacherInterventions(student.studentId);
  assert(pendingAfterAll.length === 0, 'Lifecycle: all four interventions reach terminal state via the SAME reconciliation loop, observed through the SAME Student pending-list read model');

  const statusRows = await db.query(`SELECT id, status FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [[conceptIntervention.id, skillIntervention.id, competencyIntervention.id, examIntervention.id]]);
  assert(statusRows.rows.every((r: any) => r.status === 'COMPLETED'), 'All four interventions reached COMPLETED -- including one (Skill) submitted INCORRECTLY, proving completion means "activity completed", never "passed"/"mastered"');

  // Teacher observes via the existing Teacher read model.
  const teacherView = await listTeacherInterventionsForStudent(fxMain.teacher.actorUserId, student.studentId);
  assert(
    [conceptIntervention.id, skillIntervention.id, competencyIntervention.id, examIntervention.id].every((id) => teacherView.some((t) => t.id === id && t.status === 'COMPLETED')),
    'The Teacher can observe all four resulting COMPLETED statuses through the existing, unmodified Teacher read model (listTeacherInterventionsForStudent) -- no new UI, no new read API'
  );

  // ================================================================
  // SECTION 3: EVIDENCE SEMANTICS, JOINTLY
  // ================================================================
  console.log('--- SECTION 3: EVIDENCE SEMANTICS (all 4 types, jointly) ---');
  const conceptEvidenceRow = await db.query(`SELECT metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp" DESC LIMIT 1`, [student.studentId, conceptForConcept]);
  assert(!conceptEvidenceRow.rows[0].metadata?.skillIds && !conceptEvidenceRow.rows[0].metadata?.competencyIds, 'CONCEPT intervention: legitimate Concept Evidence with NO inferred Skill/Competency Evidence');

  const skillEvidenceRow = await db.query(`SELECT metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp" DESC LIMIT 1`, [student.studentId, skillQuiz!.conceptId!]);
  assert(Array.isArray(skillEvidenceRow.rows[0].metadata?.skillIds) && !skillEvidenceRow.rows[0].metadata?.competencyIds, 'SKILL intervention: explicit Skill Evidence with NO inferred Competency Evidence');

  const competencyEvidenceRow = await db.query(`SELECT metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp" DESC LIMIT 1`, [student.studentId, competencyQuiz!.conceptId!]);
  assert(Array.isArray(competencyEvidenceRow.rows[0].metadata?.competencyIds) && !competencyEvidenceRow.rows[0].metadata?.skillIds, 'COMPETENCY intervention: explicit Competency Evidence with NO reverse/fabricated Skill Evidence');
  // skillS already has ONE legitimate learner_skill_state evidence row from
  // the SKILL intervention itself (run earlier in this same integrated
  // flow) -- the no-reverse-fabrication proof is that the COMPETENCY
  // intervention's OWN submission did not ALSO increment it further.
  const skillStateAfterCompetencyRun = await getSkillState(student.studentId, skillS);
  assert(skillStateAfterCompetencyRun !== null && skillStateAfterCompetencyRun.evidenceCount === 1, 'COMPETENCY intervention added ZERO additional learner_skill_state evidence for the mapped Skill -- still exactly the 1 legitimate row the SKILL intervention itself produced, no reverse fabrication');

  const examEvidenceCount = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND source_type = 'EXAM_SIMULATION'`, [student.studentId])).rows[0].c;
  assert(examEvidenceCount === 1, 'EXAM intervention: exactly one legitimate Evidence row from the real F7/F9 assessment pathway (recordSimulationItemResponse -> updateMastery)');
  const competencyStateForStudent = await getCompetencyState(student.studentId, competencyK);
  assert(competencyStateForStudent !== null, 'COMPETENCY intervention produced a real F5 learner_competency_state row (independent of the other three interventions run in the SAME integrated flow)');

  // ================================================================
  // SECTION 4: AUTHORIZATION MATRIX
  // ================================================================
  console.log('--- SECTION 4: AUTHORIZATION MATRIX ---');
  // Teacher role alone, without a class assignment -> DENY at assignment time.
  const unassignedTeacher = await seedTeacherActor();
  const unassignedMembership = await requestTeacherMembership(fxMain.institution.id, unassignedTeacher.actorUserId);
  await decideMembership(unassignedMembership.id, fxMain.admin.actorUserId, 'APPROVED');
  await assertTeacherDenied(
    assignTeacherIntervention(unassignedTeacher.actorUserId, { classId: fxMain.classA.id, studentId: student.studentId, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: conceptForConcept } }),
    'Teacher role alone (approved membership, no class assignment) -> DENY at assignment time'
  );

  // Teacher correct class/assignment -> ALLOW (already proven above by the successful assignments in Section 2).
  assert(true, 'Teacher with correct class/assignment -> ALLOW (proven by all four successful assignments in Section 2)');

  // Teacher wrong class -> DENY.
  const fxWrongClass = await seedFullTeacherClassFixture('WRONG-CLASS');
  await assertTeacherDenied(
    assignTeacherIntervention(fxWrongClass.teacher.actorUserId, { classId: fxMain.classA.id, studentId: student.studentId, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: conceptForConcept } }),
    'Teacher assigned to a DIFFERENT class -> DENY when targeting a class they do not teach'
  );

  // Cross-student -> DENY.
  const otherStudent = await seedStudent('Other Student (integrated cross-student)');
  await assertStudentDenied(
    startTeacherInterventionExecution(otherStudent.ownerActorId, conceptIntervention.id, 'idem-int-cross-student'),
    'Cross-student: a different Student cannot start another Student\'s intervention'
  );

  // Parent attempting Student execution -> DENY.
  const parentActor = await seedTeacherActor();
  const parentProfileRow = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Integrated Parent', $1, $2) RETURNING id`,
    [parentActor.clerkId, parentActor.actorUserId]
  );
  await linkChildByEmail(parentProfileRow.rows[0].id, student.email);
  await respondToRequest(student.studentId, parentProfileRow.rows[0].id, true);
  await assertStudentDenied(
    startTeacherInterventionExecution(parentActor.actorUserId, conceptIntervention.id, 'idem-int-parent'),
    'Parent attempting Student execution -> DENY, even with an accepted parent-child relationship'
  );

  // Teacher attempting Student execution route -> DENY.
  await assertStudentDenied(
    startTeacherInterventionExecution(fxMain.teacher.actorUserId, conceptIntervention.id, 'idem-int-teacher-as-student'),
    'Teacher attempting the Student execution route -> DENY, even the assigning Teacher'
  );

  // PARENT + TEACHER multi-role -> no widening of Student ownership.
  const multiRoleFx = await seedFullTeacherClassFixture('MULTI-ROLE-INT');
  const multiRoleUser = multiRoleFx.teacher;
  const multiRoleParentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Multi Role Integrated', $1, $2) RETURNING id`,
    [multiRoleUser.clerkId, multiRoleUser.actorUserId]
  );
  await linkChildByEmail(multiRoleParentProfile.rows[0].id, student.email);
  await respondToRequest(student.studentId, multiRoleParentProfile.rows[0].id, true);
  await assertStudentDenied(
    startTeacherInterventionExecution(multiRoleUser.actorUserId, conceptIntervention.id, 'idem-int-multi-role'),
    'PARENT + TEACHER multi-role actor (real Teacher role elsewhere + a real, accepted Parent relationship to THIS student) still cannot execute -- role combination never widens Student ownership'
  );

  // Institution role alone -> no Student execution authority.
  await assertStudentDenied(
    startTeacherInterventionExecution(fxMain.admin.actorUserId, conceptIntervention.id, 'idem-int-institution-admin'),
    'Institution admin role alone -> no Student execution authority, despite being able to access the class/institution'
  );

  // ================================================================
  // SECTION 7: PAA FULL MOCK SAFETY -- Teacher assignment AND Student self-service converge
  // ================================================================
  console.log('--- SECTION 7: PAA FULL MOCK SAFETY (Teacher assignment vs Student self-service converge) ---');
  const teacherFullMockIntervention = await assignTeacherIntervention(fxMain.teacher.actorUserId, {
    classId: fxMain.classA.id, studentId: student.studentId, interventionType: 'EXAM_PRACTICE', target: { targetType: 'EXAM', examProfileId: examProfile.id, simulationType: 'FULL_MOCK' },
  });
  await assertNotStartable(
    startTeacherInterventionExecution(student.ownerActorId, teacherFullMockIntervention.id, 'idem-int-teacher-full-mock'),
    'Teacher-assigned PAA FULL_MOCK: the current F9 NOT_READY truth cannot be overridden by Teacher assignment'
  );
  const studentSelfServiceFullMock = await getSimulationEligibility({ studentId: student.studentId, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'FULL_MOCK' });
  assert(!studentSelfServiceFullMock.eligible, 'Student self-service PAA FULL_MOCK: the SAME structural NOT_READY truth, computed by the SAME getSimulationEligibility authority');
  const rawGuard = await getFullMockEligibility(PAA_EXAM_VERSION_ID);
  assert(!rawGuard.eligible, 'Teacher assignment and Student self-service both converge on the SAME underlying F7/F9 Full Mock Guard authority (canFullMockBeOffered/getFullMockEligibility) -- never two separate truths');

  // ================================================================
  // SECTION 8: CONCURRENCY / IDEMPOTENCY, JOINTLY, ALL FOUR TYPES
  // ================================================================
  console.log('--- SECTION 8: CONCURRENCY / IDEMPOTENCY (all 4 types, sequential + real concurrent) ---');
  const fxConc = await seedFullTeacherClassFixture('CONCURRENCY-INT');
  const concStudent = await seedStudent('Concurrency Integrated Student');
  await enrollStudent(fxConc.classA.id, concStudent.studentId);
  const concSubjectId = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Concurrency Subject') RETURNING id`, [concStudent.studentId])).rows[0].id;
  const concConceptForConcept = await seedStudentConcept(concSubjectId, 'conc-concept');
  const concConceptForSkill = await seedStudentConcept(concSubjectId, 'conc-skill');
  await matchStudentConceptToCanonical(concConceptForSkill, canonicalConceptForSkill);
  const concConceptForCompetency = await seedStudentConcept(concSubjectId, 'conc-competency');
  await matchStudentConceptToCanonical(concConceptForCompetency, canonicalConceptForCompetency);
  const concExamProfile = await createStudentExamProfile({ studentId: concStudent.studentId, examDefinitionId: PAA_EXAM_DEF_ID, examVersionId: PAA_EXAM_VERSION_ID, purpose: 'ADMISSION_PREP' });

  // Concept: sequential duplicate start.
  const concIntv1 = await assignTeacherIntervention(fxConc.teacher.actorUserId, { classId: fxConc.classA.id, studentId: concStudent.studentId, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: concConceptForConcept } });
  const concStart1 = await startTeacherInterventionExecution(concStudent.ownerActorId, concIntv1.id, 'idem-conc-concept');
  const concStart2 = await startTeacherInterventionExecution(concStudent.ownerActorId, concIntv1.id, 'idem-conc-concept');
  assert(concStart2.outcome === 'RECOVERED' && (concStart2 as any).executionId === (concStart1 as any).executionId, 'CONCEPT duplicate start (sequential, same key) -> one usable execution');

  // Skill: sequential duplicate start.
  const skillIntv1 = await assignTeacherIntervention(fxConc.teacher.actorUserId, { classId: fxConc.classA.id, studentId: concStudent.studentId, interventionType: 'SKILL_PRACTICE', target: { targetType: 'SKILL', skillId: skillS } });
  const skillStart1 = await startTeacherInterventionExecution(concStudent.ownerActorId, skillIntv1.id, 'idem-conc-skill');
  const skillStart2 = await startTeacherInterventionExecution(concStudent.ownerActorId, skillIntv1.id, 'idem-conc-skill');
  assert(skillStart2.outcome === 'RECOVERED' && (skillStart2 as any).executionId === (skillStart1 as any).executionId, 'SKILL duplicate start (sequential, same key) -> one usable execution');

  // Competency: real concurrent duplicate start.
  const competencyIntv1 = await assignTeacherIntervention(fxConc.teacher.actorUserId, { classId: fxConc.classA.id, studentId: concStudent.studentId, interventionType: 'COMPETENCY_PRACTICE', target: { targetType: 'COMPETENCY', competencyId: competencyK } });
  const [compA, compB] = await Promise.all([
    startTeacherInterventionExecution(concStudent.ownerActorId, competencyIntv1.id, 'same-key-conc-competency'),
    startTeacherInterventionExecution(concStudent.ownerActorId, competencyIntv1.id, 'same-key-conc-competency'),
  ]);
  const competencyExecRowCount = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [competencyIntv1.id])).rows[0].c;
  assert(competencyExecRowCount === 1 && (compA as any).executionId === (compB as any).executionId, 'COMPETENCY duplicate start (real concurrent Promise.all) -> exactly one usable execution');

  // Exam: real concurrent duplicate start -- no reachable orphan attempt capable of scoring/Evidence/readiness effects.
  const examIntv1 = await assignTeacherIntervention(fxConc.teacher.actorUserId, { classId: fxConc.classA.id, studentId: concStudent.studentId, interventionType: 'EXAM_PRACTICE', target: { targetType: 'EXAM', examProfileId: concExamProfile.id, simulationType: 'MINI_MOCK' } });
  const attemptsBeforeExamRace = (await db.query(`SELECT COUNT(*)::int AS c FROM simulation_attempts WHERE exam_profile_id = $1 AND simulation_type = 'MINI_MOCK'`, [concExamProfile.id])).rows[0].c;
  const [examA, examB] = await Promise.all([
    startTeacherInterventionExecution(concStudent.ownerActorId, examIntv1.id, 'same-key-conc-exam'),
    startTeacherInterventionExecution(concStudent.ownerActorId, examIntv1.id, 'same-key-conc-exam'),
  ]);
  const examExecRowCount = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [examIntv1.id])).rows[0].c;
  const attemptsAfterExamRace = (await db.query(`SELECT COUNT(*)::int AS c FROM simulation_attempts WHERE exam_profile_id = $1 AND simulation_type = 'MINI_MOCK'`, [concExamProfile.id])).rows[0].c;
  assert(examExecRowCount === 1 && (examA as any).executionId === (examB as any).executionId, 'EXAM duplicate start (real concurrent Promise.all) -> exactly one usable execution registry row');
  assert(attemptsAfterExamRace === attemptsBeforeExamRace + 1, `EXAM duplicate start -> exactly ONE new real F9 simulation_attempts row (before=${attemptsBeforeExamRace}, after=${attemptsAfterExamRace}) -- no reachable orphan attempt`);
  const referencedExamAttemptId = (await db.query(`SELECT execution_reference FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [examIntv1.id])).rows[0].execution_reference;
  const allExamAttemptsForProfile = await db.query(`SELECT id FROM simulation_attempts WHERE exam_profile_id = $1 AND simulation_type = 'MINI_MOCK'`, [concExamProfile.id]);
  const orphanCount = allExamAttemptsForProfile.rows.filter((r: any) => r.id !== referencedExamAttemptId).length - (attemptsBeforeExamRace); // subtract any pre-existing rows unrelated to this race
  assert(orphanCount <= 0, 'EXAM duplicate start: zero unreferenced orphan attempts from THIS race specifically (the lock-serialized model prevents the second caller from ever creating one)');

  // ================================================================
  // SECTION 9: F9 SELF-SERVICE VS F11 ASSIGNMENT -- TWO COEXISTING ENTRY POINTS
  // ================================================================
  console.log('--- SECTION 9: TWO COEXISTING ENTRY POINTS (F9 self-service vs F11 assignment) ---');
  // ENTRY A already exercised in Section 1 (direct startSimulationAttempt, zero F11 involvement).
  // ENTRY B already exercised in Section 2 (Teacher -> F11 intervention -> Student -> F7/F9).
  const entryAAttempt = await getSimulationAttempt(selfServiceTopic.simulationAttempt.id);
  const entryBAttempt = await getSimulationAttempt(examAttempt!.id);
  assert(entryAAttempt!.examVersionId === entryBAttempt!.examVersionId, 'Both entry points resolve to the SAME F7/F9 exam version authority -- same assessment authorities, different orchestration origins');
  assert(entryAAttempt!.id !== entryBAttempt!.id, 'Both entry points produce genuinely distinct, independent attempts -- neither depends on or blocks the other');
  console.log('  OK -- F11 is never mandatory for Student exam simulation: Entry A (self-service) succeeded with zero F11 involvement in Section 1, entirely independent of Entry B (Teacher-assigned)');

  // ================================================================
  // SECTION 6 (cont'd) / SECTION 10: ZERO DIRECT F11 WRITES + CANONICAL V2 BOUNDARY
  // ================================================================
  console.log('--- SECTION 6/10: UNDERLYING ENGINE AUTHORITY + CANONICAL V2 BOUNDARY ---');
  const orchestrationSrc = readFile('src/lib/student/teacher-intervention-execution.service.ts');
  assert(!/\bupdateMastery\(/.test(orchestrationSrc), 'F11 orchestration file never calls updateMastery directly (zero direct learning_evidence/mastery_records writes)');
  assert(!/INSERT INTO learner_skill_state|UPDATE learner_skill_state/.test(orchestrationSrc), 'F11 orchestration file never writes learner_skill_state directly');
  assert(!/INSERT INTO learner_competency_state|UPDATE learner_competency_state/.test(orchestrationSrc), 'F11 orchestration file never writes learner_competency_state directly');
  assert(!/INSERT INTO readiness_snapshots|UPDATE readiness_snapshots/.test(orchestrationSrc), 'F11 orchestration file never writes readiness_snapshots directly');
  assert(!/pedagogical_requirement_recognition|canonical_prepared_activity|concept_transfer_state|concept_knowledge_state/.test(orchestrationSrc), 'F11 orchestration file never references any Canonical V2 stage table');
  console.log('  OK -- Teacher assigns intervention -> zero Canonical stage write (structural, no Canonical table referenced anywhere in the assignment path either)');
  const teacherSrc = readFile('src/lib/teacher/intervention.service.ts');
  assert(!/pedagogical_requirement_recognition|canonical_prepared_activity|concept_transfer_state|concept_knowledge_state/.test(teacherSrc), 'F11-B assignment service never references any Canonical V2 stage table');

  console.log('');
  console.log('=== F11 INTEGRATED CERTIFICATION: ALL ASSERTIONS PASSED ===');
}

function readFile(relativePath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F11 integrated certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
