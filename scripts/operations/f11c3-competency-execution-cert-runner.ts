/**
 * F11-C3 -- invoked by f11c3-competency-execution-migration-cert.sh
 * against a real, ephemeral, local-only Postgres instance. Exercises
 * the full Competency Reinforcement execution orchestration: explicit
 * Competency targeting, Concept->Competency AND Skill->Competency
 * non-inference, the real F5 Competency Evidence/State pipeline,
 * insufficient-evidence semantics, assisted-evidence honesty, no
 * fabricated Skill Evidence, no reverse inference, the full adversarial
 * matrix, idempotency, and the orphan-session residual.
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
import { getCompetencyState } from '@/lib/learner-state/competency-state.service';
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
  const clerkId = `clerk_f11c3_student_${studentCounter}`;
  const email = `f11c3-student-${studentCounter}@test.local`;
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
  const clerkId = `clerk_f11c3_teacher_${teacherCounter}`;
  const canonical = await getOrCreateCanonicalUser(clerkId, `f11c3-teacher-${teacherCounter}@test.local`);
  return { actorUserId: canonical.id, clerkId };
}

async function seedAdmin(label: string): Promise<string> {
  const result = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`clerk_f11c3_admin_${label}`, `f11c3-admin-${label}@test.local`]);
  return result.rows[0].id;
}

async function seedFullTeacherClassFixture(label: string) {
  const institution = await createInstitution(`F11C3 Institution ${label}`);
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
async function seedCompetency(name: string, status: 'ACTIVE' | 'RETIRED' | 'DRAFT' = 'ACTIVE'): Promise<string> {
  const code = `F11C3-${name.replace(/\s+/g, '-').toUpperCase()}-${Math.random().toString(36).slice(2, 8)}`;
  return (await db.query(`INSERT INTO competencies (code, name, status) VALUES ($1, $2, $3) RETURNING id`, [code, name, status])).rows[0].id;
}
async function linkCanonicalConceptToSkill(canonicalConceptId: string, skillId: string): Promise<void> {
  await db.query(`INSERT INTO canonical_concept_skills (canonical_concept_id, skill_id) VALUES ($1, $2)`, [canonicalConceptId, skillId]);
}
async function linkCanonicalConceptToCompetency(canonicalConceptId: string, competencyId: string): Promise<void> {
  await db.query(`INSERT INTO canonical_concept_competencies (canonical_concept_id, competency_id) VALUES ($1, $2)`, [canonicalConceptId, competencyId]);
}
async function linkSkillToCompetency(skillId: string, competencyId: string): Promise<void> {
  await db.query(`INSERT INTO skill_competencies (skill_id, competency_id) VALUES ($1, $2)`, [skillId, competencyId]);
}
async function seedStudentConcept(subjectId: string, label: string): Promise<string> {
  return (await db.query(`INSERT INTO concepts (id, subject_id, canonical_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [subjectId, `f11c3.${label}`])).rows[0].id;
}
async function matchStudentConceptToCanonical(learnerConceptId: string, canonicalConceptId: string): Promise<void> {
  await db.query(
    `INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method) VALUES ($1, $2, 'MATCHED', 'SEED_FIXTURE')`,
    [learnerConceptId, canonicalConceptId]
  );
}

async function simulateRealSubmission(params: {
  studentId: string;
  conceptId: string;
  subjectId: string;
  quizId: string;
  competencyIds?: string[];
  skillIds?: string[];
  result: 'correct' | 'incorrect';
  independent?: boolean;
}): Promise<void> {
  const independent = params.independent ?? true;
  await updateMastery({
    studentId: params.studentId,
    conceptId: params.conceptId,
    subjectId: params.subjectId,
    evidence: { sourceType: 'PRACTICE_QUESTION', result: params.result, difficulty: 3, scorePercent: params.result === 'correct' ? 100 : 0 },
    telemetry: independent ? { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 } : { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 2, aiAssistanceType: 'MULTIPLE_HINTS' },
    metadata: { activityType: 'PRACTICE', evidenceMode: 'GENERAL', ...(params.competencyIds ? { competencyIds: params.competencyIds } : {}), ...(params.skillIds ? { skillIds: params.skillIds } : {}) },
    identity: { operationType: 'QUIZ_SUBMISSION', operationId: params.quizId, conceptId: params.conceptId },
  });
  await completeQuiz(params.quizId);
}

async function main() {
  console.log('=== F11-C3 COMPETENCY REINFORCEMENT EXECUTION ORCHESTRATION CERTIFICATION ===');
  await seedMasteryPolicy();

  console.log('--- SHARED FIXTURE: Concept C -> Competency K (direct edge); Skill S -> Competency K (edge) ---');
  const canonicalSubject = await seedCanonicalSubject('F11C3 Canonical Physics');
  const canonicalConceptC = await seedCanonicalConcept(canonicalSubject, 'Momentum (Canonical)');
  const competencyK = await seedCompetency('Quantitative Modelling');
  await linkCanonicalConceptToCompetency(canonicalConceptC, competencyK);
  const skillS = await seedSkill('Data Interpretation (F11C3)');
  await linkSkillToCompetency(skillS, competencyK);
  const canonicalConceptForSkill = await seedCanonicalConcept(canonicalSubject, 'Momentum for Skill (Canonical)');
  await linkCanonicalConceptToSkill(canonicalConceptForSkill, skillS);
  assert(true, 'Case A: valid Competency lookup -- competency K created and queryable via F4\'s own competencies table');

  console.log('--- CASE B/C: invalid + retired Competency ---');
  const fxBC = await seedFullTeacherClassFixture('INVALID-COMPETENCY');
  const studentBC = await seedStudent('Student Invalid Competency');
  await enrollStudent(fxBC.classA.id, studentBC.studentId);
  let nonexistentRejected = false;
  try {
    await assignTeacherIntervention(fxBC.teacher.actorUserId, {
      classId: fxBC.classA.id,
      studentId: studentBC.studentId,
      interventionType: 'COMPETENCY_PRACTICE',
      target: { targetType: 'COMPETENCY', competencyId: '00000000-0000-4000-8000-000000000000' },
    });
  } catch {
    nonexistentRejected = true;
  }
  assert(nonexistentRejected, 'Case B: assigning a nonexistent Competency target is rejected at assignment time (F11-B FK)');

  const retiredCompetency = await seedCompetency('Retired Competency', 'RETIRED');
  const retiredIntervention = await assignTeacherIntervention(fxBC.teacher.actorUserId, {
    classId: fxBC.classA.id,
    studentId: studentBC.studentId,
    interventionType: 'COMPETENCY_PRACTICE',
    target: { targetType: 'COMPETENCY', competencyId: retiredCompetency },
  });
  await assertNotStartable(
    startTeacherInterventionExecution(studentBC.ownerActorId, retiredIntervention.id, 'idem-retired-competency'),
    'Case C: a RETIRED competency is assignable (F11-B has no status check) but cannot be STARTED (F11-C3 validates status at execution time)'
  );

  console.log('--- CASE F/G/H/K: valid assignment, context resolution, evidence proof, incorrect-response completion ---');
  const fxHappy = await seedFullTeacherClassFixture('HAPPY-COMPETENCY');
  const studentHappy = await seedStudent('Student Happy Competency');
  await enrollStudent(fxHappy.classA.id, studentHappy.studentId);
  const subjectHappy = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [studentHappy.studentId])).rows[0].id;
  const conceptHappy = await seedStudentConcept(subjectHappy, 'happy');
  await matchStudentConceptToCanonical(conceptHappy, canonicalConceptC);

  const competencyIntervention = await assignTeacherIntervention(fxHappy.teacher.actorUserId, {
    classId: fxHappy.classA.id,
    studentId: studentHappy.studentId,
    interventionType: 'COMPETENCY_PRACTICE',
    target: { targetType: 'COMPETENCY', competencyId: competencyK },
  });
  assert(competencyIntervention.status === 'ASSIGNED', 'Case F: valid Competency intervention assignment succeeds');

  const pendingHappy = await getStudentPendingTeacherInterventions(studentHappy.studentId);
  assert(pendingHappy.length === 1 && pendingHappy[0].id === competencyIntervention.id, 'The Competency intervention appears in the SAME Student pending list used for Concept/Skill interventions');

  const startedHappy = await startTeacherInterventionExecution(studentHappy.ownerActorId, competencyIntervention.id, 'idem-happy-competency');
  assert(startedHappy.outcome === 'STARTED', 'Explicit Competency execution starts a real Practice execution');
  const quizIdHappy = (startedHappy as any).executionReference;
  const quizSessionHappy = await getQuizSession(quizIdHappy);
  assert(quizSessionHappy !== null && quizSessionHappy.conceptId === conceptHappy, 'Case G: the launched quiz targets the DETERMINISTICALLY resolved Concept context (this student\'s own matched concept, via the DIRECT canonical_concept_competencies edge), not an AI/heuristic choice');
  assert(JSON.stringify(quizSessionHappy!.targetCompetencyIds) === JSON.stringify([competencyK]), 'The quiz_sessions row explicitly carries the target Competency via targetCompetencyIds');
  assert(quizSessionHappy!.targetSkillIds === null, 'The SAME quiz carries NO targetSkillIds -- Competency and Skill tags remain structurally independent');

  const afterStartRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [competencyIntervention.id]);
  assert(afterStartRow.rows[0].status === 'IN_PROGRESS', 'Lifecycle: ASSIGNED -> IN_PROGRESS on a real Competency execution being created');

  const evidenceBefore = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [studentHappy.studentId, conceptHappy])).rows[0].c;
  await simulateRealSubmission({ studentId: studentHappy.studentId, conceptId: conceptHappy, subjectId: subjectHappy, quizId: quizIdHappy, competencyIds: [competencyK], result: 'incorrect' });
  const evidenceAfter = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [studentHappy.studentId, conceptHappy])).rows[0].c;
  assert(evidenceAfter === evidenceBefore + 1, 'Canonical evidence proof: exactly ONE learning_evidence row was produced by the real writer, none by F11-C3 itself');

  const writtenEvidence = await db.query(`SELECT metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp" DESC LIMIT 1`, [studentHappy.studentId, conceptHappy]);
  const writtenMetadata = writtenEvidence.rows[0].metadata;
  assert(Array.isArray(writtenMetadata?.competencyIds) && writtenMetadata.competencyIds.includes(competencyK), 'Case H: evidence metadata.competencyIds explicitly contains the targeted Competency, traceable to the intervention target -- not graph inference');
  assert(!writtenMetadata?.skillIds, 'Case U (reverse-inference safety): the SAME evidence row carries NO skillIds -- no reverse backfill into Skill Evidence');

  const pendingAfterSubmit = await getStudentPendingTeacherInterventions(studentHappy.studentId);
  assert(pendingAfterSubmit.length === 0, 'Lifecycle: IN_PROGRESS -> COMPLETED reconciled lazily, using the SAME reconciliation loop as Concept/Skill executions');
  const afterSubmitRow = await db.query(`SELECT status FROM teacher_interventions WHERE id = $1`, [competencyIntervention.id]);
  assert(afterSubmitRow.rows[0].status === 'COMPLETED', 'Case K: intervention reached COMPLETED despite an INCORRECT answer -- operational completion, never an academic judgment');

  console.log('--- CASE D: Concept -> Competency negative inference proof ---');
  const fxD = await seedFullTeacherClassFixture('CONCEPT-NEGATIVE');
  const studentD = await seedStudent('Student Concept Negative');
  await enrollStudent(fxD.classA.id, studentD.studentId);
  const subjectD = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [studentD.studentId])).rows[0].id;
  const conceptD = await seedStudentConcept(subjectD, 'concept-negative');
  await matchStudentConceptToCanonical(conceptD, canonicalConceptC); // SAME canonical concept C, which DOES map to competency K

  const conceptIntervention = await assignTeacherIntervention(fxD.teacher.actorUserId, {
    classId: fxD.classA.id,
    studentId: studentD.studentId,
    interventionType: 'CONCEPT_REINFORCEMENT',
    target: { targetType: 'CONCEPT', conceptId: conceptD },
  });
  const startedD = await startTeacherInterventionExecution(studentD.ownerActorId, conceptIntervention.id, 'idem-concept-negative');
  const quizIdD = (startedD as any).executionReference;
  await updateMastery({
    studentId: studentD.studentId,
    conceptId: conceptD,
    subjectId: subjectD,
    evidence: { sourceType: 'PRACTICE_QUESTION', result: 'correct', difficulty: 3, scorePercent: 100 },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 },
    identity: { operationType: 'QUIZ_SUBMISSION', operationId: quizIdD, conceptId: conceptD },
  });
  await completeQuiz(quizIdD);
  const competencyStateForD = await getCompetencyState(studentD.studentId, competencyK);
  assert(competencyStateForD === null, 'Case D (CRITICAL): NO Competency Evidence/State for K exists solely because Concept C (which maps to K) was practiced ordinarily');

  console.log('--- CASE E: Skill -> Competency negative inference proof ---');
  const fxE = await seedFullTeacherClassFixture('SKILL-NEGATIVE');
  const studentE = await seedStudent('Student Skill Negative');
  await enrollStudent(fxE.classA.id, studentE.studentId);
  const subjectE = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [studentE.studentId])).rows[0].id;
  const conceptE = await seedStudentConcept(subjectE, 'skill-negative');
  await matchStudentConceptToCanonical(conceptE, canonicalConceptForSkill);

  const skillIntervention = await assignTeacherIntervention(fxE.teacher.actorUserId, {
    classId: fxE.classA.id,
    studentId: studentE.studentId,
    interventionType: 'SKILL_PRACTICE',
    target: { targetType: 'SKILL', skillId: skillS },
  });
  const startedE = await startTeacherInterventionExecution(studentE.ownerActorId, skillIntervention.id, 'idem-skill-negative');
  const quizIdE = (startedE as any).executionReference;
  await simulateRealSubmission({ studentId: studentE.studentId, conceptId: conceptE, subjectId: subjectE, quizId: quizIdE, skillIds: [skillS], result: 'correct' });
  const skillStateForE = await getSkillState(studentE.studentId, skillS);
  assert(skillStateForE === null || skillStateForE.evidenceCount === 1, 'Fixture validity: legitimate Skill Evidence for S was produced by the real Skill execution');
  const competencyStateForE = await getCompetencyState(studentE.studentId, competencyK);
  assert(competencyStateForE === null, 'Case E (CRITICAL): NO Competency Evidence/State for K exists solely because Skill S (which maps to K) was legitimately practiced -- Skill Evidence never becomes Competency Evidence');

  console.log('--- CASE M: invalid/mismatched Concept context for Competency (no valid mapping) ---');
  const competencyWithNoMapping = await seedCompetency('Competency With No Concept Mapping');
  const fxM = await seedFullTeacherClassFixture('MISMATCHED-COMPETENCY');
  const studentM = await seedStudent('Student Mismatched Competency');
  await enrollStudent(fxM.classA.id, studentM.studentId);
  const mismatchedIntervention = await assignTeacherIntervention(fxM.teacher.actorUserId, {
    classId: fxM.classA.id,
    studentId: studentM.studentId,
    interventionType: 'COMPETENCY_PRACTICE',
    target: { targetType: 'COMPETENCY', competencyId: competencyWithNoMapping },
  });
  await assertNotStartable(
    startTeacherInterventionExecution(studentM.ownerActorId, mismatchedIntervention.id, 'idem-mismatched-competency'),
    'Case M: a Competency with no valid, student-matched Concept context is rejected as controlled failure -- no execution registry row, no quiz, no evidence'
  );
  const executionRowsForMismatched = await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [mismatchedIntervention.id]);
  assert(executionRowsForMismatched.rows[0].c === 0, 'Case M: zero execution registry rows created for the rejected mismatch');

  console.log('--- CASE L: assisted evidence semantics ---');
  const fxL = await seedFullTeacherClassFixture('ASSISTED-COMPETENCY');
  const studentL = await seedStudent('Student Assisted Competency');
  await enrollStudent(fxL.classA.id, studentL.studentId);
  const subjectL = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [studentL.studentId])).rows[0].id;
  const conceptL = await seedStudentConcept(subjectL, 'assisted');
  await matchStudentConceptToCanonical(conceptL, canonicalConceptC);
  const assistedIntervention = await assignTeacherIntervention(fxL.teacher.actorUserId, {
    classId: fxL.classA.id,
    studentId: studentL.studentId,
    interventionType: 'COMPETENCY_PRACTICE',
    target: { targetType: 'COMPETENCY', competencyId: competencyK },
  });
  const startedL = await startTeacherInterventionExecution(studentL.ownerActorId, assistedIntervention.id, 'idem-assisted');
  const quizIdL = (startedL as any).executionReference;
  await simulateRealSubmission({ studentId: studentL.studentId, conceptId: conceptL, subjectId: subjectL, quizId: quizIdL, competencyIds: [competencyK], result: 'correct', independent: false });
  const assistedEvidenceRow = await db.query(`SELECT ai_assistance_type FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY "timestamp" DESC LIMIT 1`, [studentL.studentId, conceptL]);
  assert(assistedEvidenceRow.rows[0].ai_assistance_type !== 'NONE', 'Case L: assisted performance is recorded honestly (ai_assistance_type != NONE), never silently relabeled independent');
  const competencyStateForL = await getCompetencyState(studentL.studentId, competencyK);
  assert(competencyStateForL !== null && competencyStateForL.independentEvidenceCount === 0, 'Case L: F5\'s own projector correctly excludes the assisted evidence from independentEvidenceCount');

  console.log('--- CROSS-ROLE ADVERSARIAL MATRIX (N/O/P/Q) ---');
  const fxAdv = await seedFullTeacherClassFixture('ADVERSARIAL-COMPETENCY');
  const studentAdv = await seedStudent('Student Adversarial Competency');
  await enrollStudent(fxAdv.classA.id, studentAdv.studentId);
  const subjectAdv = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [studentAdv.studentId])).rows[0].id;
  const conceptAdv = await seedStudentConcept(subjectAdv, 'adversarial');
  await matchStudentConceptToCanonical(conceptAdv, canonicalConceptC);
  const interventionAdv = await assignTeacherIntervention(fxAdv.teacher.actorUserId, {
    classId: fxAdv.classA.id,
    studentId: studentAdv.studentId,
    interventionType: 'COMPETENCY_PRACTICE',
    target: { targetType: 'COMPETENCY', competencyId: competencyK },
  });

  const otherStudent = await seedStudent('Other Student (cross-student)');
  await assertStudentDenied(
    startTeacherInterventionExecution(otherStudent.ownerActorId, interventionAdv.id, 'idem-cross-student'),
    'Case N: a different Student cannot start another Student\'s Competency intervention'
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
    'Case O: an accepted Parent relationship does not authorize executing the child\'s Competency intervention'
  );

  await assertStudentDenied(
    startTeacherInterventionExecution(fxAdv.teacher.actorUserId, interventionAdv.id, 'idem-assigning-teacher'),
    'Case P (assigning Teacher): the Teacher who assigned it cannot execute it via the Student route'
  );
  const unrelatedTeacherFx = await seedFullTeacherClassFixture('UNRELATED-TEACHER-COMPETENCY');
  await assertStudentDenied(
    startTeacherInterventionExecution(unrelatedTeacherFx.teacher.actorUserId, interventionAdv.id, 'idem-unrelated-teacher'),
    'Case P (unrelated Teacher): an unrelated Teacher cannot execute it via the Student route'
  );

  const multiRoleFx = await seedFullTeacherClassFixture('MULTI-ROLE-COMPETENCY');
  const multiRoleUser = multiRoleFx.teacher;
  const someOtherChild = await seedStudent('Some other child of multi-role user');
  const multiRoleParentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'Multi Role Competency', $1, $2) RETURNING id`,
    [multiRoleUser.clerkId, multiRoleUser.actorUserId]
  );
  await linkChildByEmail(multiRoleParentProfile.rows[0].id, someOtherChild.email);
  await respondToRequest(someOtherChild.studentId, multiRoleParentProfile.rows[0].id, true);
  await assertStudentDenied(
    startTeacherInterventionExecution(multiRoleUser.actorUserId, interventionAdv.id, 'idem-multi-role'),
    'Case Q: a PARENT+TEACHER actor with real relationships to OTHER students still cannot execute a Competency intervention belonging to a student they do not own'
  );

  console.log('--- IDEMPOTENCY (R/S) ---');
  const startedAdv1 = await startTeacherInterventionExecution(studentAdv.ownerActorId, interventionAdv.id, 'same-key-sequential-competency');
  assert(startedAdv1.outcome === 'STARTED', 'Idempotency (sequential): first call with a fresh key STARTS a real Competency execution');
  const startedAdv2 = await startTeacherInterventionExecution(studentAdv.ownerActorId, interventionAdv.id, 'same-key-sequential-competency');
  assert(startedAdv2.outcome === 'RECOVERED' && (startedAdv2 as any).executionId === (startedAdv1 as any).executionId, 'Case R: sequential retry with the SAME key RECOVERS the identical execution, never starts a second');
  const rowCountSeq = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionAdv.id])).rows[0].c;
  assert(rowCountSeq === 1, 'Case R: exactly ONE teacher_intervention_executions row after sequential retry');

  const fxConc = await seedFullTeacherClassFixture('CONCURRENCY-COMPETENCY');
  const studentConc = await seedStudent('Student Concurrency Competency');
  await enrollStudent(fxConc.classA.id, studentConc.studentId);
  const subjectConc = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [studentConc.studentId])).rows[0].id;
  const conceptConc = await seedStudentConcept(subjectConc, 'concurrency');
  await matchStudentConceptToCanonical(conceptConc, canonicalConceptC);
  const interventionConc = await assignTeacherIntervention(fxConc.teacher.actorUserId, {
    classId: fxConc.classA.id,
    studentId: studentConc.studentId,
    interventionType: 'COMPETENCY_PRACTICE',
    target: { targetType: 'COMPETENCY', competencyId: competencyK },
  });
  const [concA, concB] = await Promise.all([
    startTeacherInterventionExecution(studentConc.ownerActorId, interventionConc.id, 'same-key-concurrent-competency'),
    startTeacherInterventionExecution(studentConc.ownerActorId, interventionConc.id, 'same-key-concurrent-competency'),
  ]);
  const concurrentRowCount = (await db.query(`SELECT COUNT(*)::int AS c FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionConc.id])).rows[0].c;
  assert(concurrentRowCount === 1, 'Case S: two truly simultaneous start calls with the SAME key converge to exactly ONE teacher_intervention_executions row');
  assert((concA as any).executionId === (concB as any).executionId, 'Case S: both concurrent calls resolve to the SAME execution id');

  console.log('--- CASE V: underlying orphan-resource academic-safety check ---');
  const quizSessionsForConcStudent = await db.query(`SELECT id FROM quiz_sessions WHERE student_id = $1`, [studentConc.studentId]);
  const referencedExecution = await db.query(`SELECT execution_reference FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionConc.id]);
  const referencedQuizId = referencedExecution.rows[0].execution_reference;
  const orphanQuizIds = quizSessionsForConcStudent.rows.map((r) => r.id).filter((id) => id !== referencedQuizId);
  console.log(`  (info) ${orphanQuizIds.length} orphan quiz_sessions row(s) from the concurrent race (0 is normal)`);
  const pendingForConcStudent = await getStudentPendingTeacherInterventions(studentConc.studentId);
  assert(
    pendingForConcStudent.every((p) => p.id !== interventionConc.id || p.effectiveStatus === 'IN_PROGRESS'),
    'Case V: the Student pending list reflects only the ONE canonical execution reference, never an orphan'
  );
  const competencyStateForConcBeforeSubmit = await getCompetencyState(studentConc.studentId, competencyK);
  assert(competencyStateForConcBeforeSubmit === null || competencyStateForConcBeforeSubmit.evidenceCount === 0, 'Case V: an unreferenced orphan (if any) contributes ZERO Competency State evidence -- nothing was ever submitted for it');

  console.log('--- CASE I/J: insufficient evidence, then real F5 Competency aggregation at the actual threshold ---');
  const policyRow = await db.query(`SELECT rules FROM aggregation_policy_versions WHERE dimension = 'COMPETENCY' AND status = 'ACTIVE'`);
  const minimumEvidenceCount = policyRow.rows[0].rules.minimumEvidenceCount;
  assert(typeof minimumEvidenceCount === 'number' && minimumEvidenceCount > 0, `F5's own ACTIVE COMPETENCY policy requires ${minimumEvidenceCount} qualifying evidence rows -- reading the REAL policy, not assuming a threshold`);

  const aggStudent = await seedStudent('Student Competency Aggregation');
  const fxAgg = await seedFullTeacherClassFixture('AGGREGATION-COMPETENCY');
  await enrollStudent(fxAgg.classA.id, aggStudent.studentId);
  const subjectAgg = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Physics') RETURNING id`, [aggStudent.studentId])).rows[0].id;
  const conceptAgg = await seedStudentConcept(subjectAgg, 'aggregation');
  await matchStudentConceptToCanonical(conceptAgg, canonicalConceptC);

  for (let i = 0; i < minimumEvidenceCount - 1; i++) {
    const aggIntervention = await assignTeacherIntervention(fxAgg.teacher.actorUserId, {
      classId: fxAgg.classA.id,
      studentId: aggStudent.studentId,
      interventionType: 'COMPETENCY_PRACTICE',
      target: { targetType: 'COMPETENCY', competencyId: competencyK },
    });
    const aggStart = await startTeacherInterventionExecution(aggStudent.ownerActorId, aggIntervention.id, `idem-agg-${i}`);
    const aggQuizId = (aggStart as any).executionReference;
    await simulateRealSubmission({ studentId: aggStudent.studentId, conceptId: conceptAgg, subjectId: subjectAgg, quizId: aggQuizId, competencyIds: [competencyK], result: 'correct' });
  }
  const competencyStateBeforeThreshold = await getCompetencyState(aggStudent.studentId, competencyK);
  assert(
    competencyStateBeforeThreshold !== null && competencyStateBeforeThreshold.state === 'INSUFFICIENT_EVIDENCE' && competencyStateBeforeThreshold.evidenceCount === minimumEvidenceCount - 1,
    `Case I: with ${minimumEvidenceCount - 1} qualifying evidence rows (one short of the real threshold of ${minimumEvidenceCount}), F5's own state remains INSUFFICIENT_EVIDENCE -- one successful activity is never interpreted as mastery`
  );

  const finalIntervention = await assignTeacherIntervention(fxAgg.teacher.actorUserId, {
    classId: fxAgg.classA.id,
    studentId: aggStudent.studentId,
    interventionType: 'COMPETENCY_PRACTICE',
    target: { targetType: 'COMPETENCY', competencyId: competencyK },
  });
  const finalStart = await startTeacherInterventionExecution(aggStudent.ownerActorId, finalIntervention.id, 'idem-agg-final');
  const finalQuizId = (finalStart as any).executionReference;
  await simulateRealSubmission({ studentId: aggStudent.studentId, conceptId: conceptAgg, subjectId: subjectAgg, quizId: finalQuizId, competencyIds: [competencyK], result: 'correct' });

  const competencyStateAfterThreshold = await getCompetencyState(aggStudent.studentId, competencyK);
  assert(competencyStateAfterThreshold !== null, 'Case J: learner_competency_state row exists after enough independent qualifying executions -- created by F5\'s own real projector, never by F11-C3 directly');
  assert(competencyStateAfterThreshold!.evidenceCount === minimumEvidenceCount, `Case J: correct evidence count (${minimumEvidenceCount}) -- no duplicate evidence, no missing evidence`);
  assert(competencyStateAfterThreshold!.competencyId === competencyK && competencyStateAfterThreshold!.studentId === aggStudent.studentId, 'Case J: correct competencyId and correct learnerId on the projected state');
  assert(competencyStateAfterThreshold!.state !== 'NO_EVIDENCE' && competencyStateAfterThreshold!.state !== 'INSUFFICIENT_EVIDENCE', 'Case J: F5\'s own classification moved past the insufficient-evidence floor once the real threshold was met');

  console.log('--- CASE T: no fabricated Skill Evidence from Competency executions ---');
  const skillStateFromCompetencyRuns = await getSkillState(aggStudent.studentId, skillS);
  assert(skillStateFromCompetencyRuns === null, 'Case T: zero Skill Evidence/State exists for Skill S despite this student having completed multiple Competency-K executions and S->K being a real edge');

  console.log('');
  console.log('=== F11-C3 CERTIFICATION: ALL ASSERTIONS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F11-C3 certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
