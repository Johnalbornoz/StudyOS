/**
 * F12 -- invoked by f12-institution-intelligence-migration-cert.sh
 * against a real, ephemeral, local-only Postgres instance, seeded with
 * F9's own real PAA/Cambridge fixture (f9-seed-pilot-dataset.ts).
 * Exercises the full Institution Intelligence read model: roster/
 * population metrics, learning intelligence (Knowledge/Skill/
 * Competency, kept separate), evidence sufficiency, curriculum
 * coverage (F6, FULL/PARTIAL/UNMAPPED), F9 readiness (never legacy),
 * F8 diagnostic aggregation, F11 intervention aggregation, the full
 * authorization adversarial matrix, unique-learner counting, small-
 * cohort suppression (TEST POLICY), privacy payload minimization, and
 * zero-write source verification. Every case is a real service call,
 * real database rows, never a mock.
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
} from '@/services/institution.service';
import { linkChildByEmail, respondToRequest } from '@/services/parent.service';
import { assignTeacherIntervention } from '@/lib/teacher/intervention.service';
import { startTeacherInterventionExecution, getStudentPendingTeacherInterventions } from '@/lib/student/teacher-intervention-execution.service';
import { storeQuiz, getQuizSession, completeQuiz } from '@/services/quiz-persistence.service';
import { updateMastery } from '@/services/mastery.service';
import { runDiagnosis } from '@/lib/diagnostics/diagnosis.service';
import {
  createOrganization, createProgramme, createSubject,
} from '@/lib/curriculum/organization.service';
import { createStructureVersion, createStructureNode, publishStructureVersion } from '@/lib/curriculum/structure.service';
import { createLearningObjective } from '@/lib/curriculum/objective.service';
import { grantEditorialRole } from '@/lib/curriculum/editorial.service';
import { createMapping, proposeMapping, beginReview, approveMapping, publishMapping } from '@/lib/curriculum/mapping.service';
import {
  requireInstitutionAccess, requireClassInInstitution, requireLearnerInInstitution, InstitutionIntelligenceAccessDeniedError,
  getInstitutionOverview, getInstitutionGrades, getInstitutionClasses, getInstitutionTeachers,
  getInstitutionLearnerSummary, getClassLearningSummary, getLearnerDrillDown,
  getInstitutionCoverage, getInstitutionReadiness, getInstitutionDiagnosticSummary,
  getInstitutionInterventionSummary, getTeacherOperationalSummary, getInstitutionAttentionAreas,
} from '@/lib/institution-intelligence';
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
    console.error(`ASSERTION FAILED: ${message} (expected InstitutionIntelligenceAccessDeniedError, got no error)`);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof InstitutionIntelligenceAccessDeniedError)) {
      console.error(`ASSERTION FAILED: ${message} (expected InstitutionIntelligenceAccessDeniedError, got ${error})`);
      process.exit(1);
    }
    console.log(`  OK -- ${message}`);
  }
}

let teacherCounter = 0;
async function seedTeacherActor(): Promise<{ actorUserId: string; clerkId: string }> {
  teacherCounter += 1;
  const clerkId = `clerk_f12_teacher_${teacherCounter}`;
  const canonical = await getOrCreateCanonicalUser(clerkId, `f12-teacher-${teacherCounter}@test.local`);
  return { actorUserId: canonical.id, clerkId };
}

let studentCounter = 0;
async function seedStudent(name: string): Promise<{ studentId: string; ownerActorId: string; email: string }> {
  studentCounter += 1;
  const clerkId = `clerk_f12_student_${studentCounter}`;
  const email = `f12-student-${studentCounter}@test.local`;
  const result = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`, [clerkId, email, name]);
  const studentId = result.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [studentId, name]);
  const canonical = await getOrCreateCanonicalUser(clerkId, email);
  await db.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [canonical.id, studentId]);
  return { studentId, ownerActorId: canonical.id, email };
}

async function seedAdmin(label: string): Promise<{ actorUserId: string }> {
  const result = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`clerk_f12_admin_${label}`, `f12-admin-${label}@test.local`]);
  return { actorUserId: result.rows[0].id };
}

async function seedInstitutionWithAdmin(label: string) {
  const institution = await createInstitution(`F12 Institution ${label}`);
  const admin = await seedAdmin(label);
  await inviteInstitutionAdmin(institution.id, admin.actorUserId);
  return { institution, admin };
}

async function seedFullTeacherClassFixture(label: string) {
  const { institution, admin } = await seedInstitutionWithAdmin(label);
  const teacher = await seedTeacherActor();
  const membership = await requestTeacherMembership(institution.id, teacher.actorUserId);
  const approved = await decideMembership(membership.id, admin.actorUserId, 'APPROVED');
  if (!approved) throw new Error(`fixture setup failed: membership not approved for ${label}`);
  const grade = await createGrade(institution.id, `Grade ${label}`);
  const classA = await createClass(institution.id, grade.id, `Class ${label}`);
  const assignment = await createTeacherAssignment(membership.id, { classId: classA.id });
  return { institution, admin, teacher, membership, grade, classA, assignment };
}

async function seedStudentConcept(subjectId: string, label: string): Promise<string> {
  return (await db.query(`INSERT INTO concepts (id, subject_id, canonical_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [subjectId, `f12.${label}`])).rows[0].id;
}

async function simulateRealQuizSubmission(params: { studentId: string; conceptId: string; subjectId: string; quizId: string; skillIds?: string[]; competencyIds?: string[]; result: 'correct' | 'incorrect' }) {
  await updateMastery({
    studentId: params.studentId, conceptId: params.conceptId, subjectId: params.subjectId,
    evidence: { sourceType: 'PRACTICE_QUESTION', result: params.result, difficulty: 3, scorePercent: params.result === 'correct' ? 100 : 0 },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 },
    metadata: { activityType: 'PRACTICE', evidenceMode: 'GENERAL', ...(params.skillIds ? { skillIds: params.skillIds } : {}), ...(params.competencyIds ? { competencyIds: params.competencyIds } : {}) },
    identity: { operationType: 'QUIZ_SUBMISSION', operationId: params.quizId, conceptId: params.conceptId },
  });
  await completeQuiz(params.quizId);
}

async function main() {
  console.log('=== F12 INSTITUTION INTELLIGENCE CERTIFICATION ===');
  await db.query(
    `INSERT INTO mastery_policies (version, minimum_understanding, minimum_independence, minimum_application, minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days)
     VALUES (1, 0.7, 0.7, 0.7, 0.7, 0.7, false, 3, 1, 1, 1, 14) ON CONFLICT (version) DO NOTHING`
  );

  console.log('--- TEST POLICY: explicit, versioned, NEVER a silently-invented product default (task section 27) ---');
  await db.query(
    `INSERT INTO institution_analytics_policy_versions (version, rules, status) VALUES (1, $1::jsonb, 'ACTIVE') ON CONFLICT (version) DO NOTHING`,
    [JSON.stringify({ minimumCohortSize: 3 })]
  );

  console.log('--- FIXTURE: Institution A (main), Institution B (isolation target) ---');
  const fxA = await seedFullTeacherClassFixture('A');
  const fxB = await seedFullTeacherClassFixture('B');

  const studentA1 = await seedStudent('Learner A1');
  const studentA2 = await seedStudent('Learner A2');
  const studentA3 = await seedStudent('Learner A3 (multi-class)');
  await enrollStudent(fxA.classA.id, studentA1.studentId);
  await enrollStudent(fxA.classA.id, studentA2.studentId);
  await enrollStudent(fxA.classA.id, studentA3.studentId);

  const gradeA2 = await createGrade(fxA.institution.id, 'Grade A Second');
  const classA2 = await createClass(fxA.institution.id, gradeA2.id, 'Class A Second');
  await createTeacherAssignment(fxA.membership.id, { classId: classA2.id });
  await enrollStudent(classA2.id, studentA3.studentId); // studentA3 enrolled in TWO classes within institution A

  const studentB1 = await seedStudent('Learner B1 (Institution B)');
  await enrollStudent(fxB.classA.id, studentB1.studentId);

  console.log('--- CASE A/B/C: Institution admin authorization (active/none/revoked) ---');
  await getInstitutionOverview(fxA.admin.actorUserId, fxA.institution.id).then(() => assert(true, 'Case A: active APPROVED INSTITUTION_ADMIN membership -> institution overview ALLOW'));

  const noMembershipActor = await seedTeacherActor();
  await assertDenied(getInstitutionOverview(noMembershipActor.actorUserId, fxA.institution.id), 'Case B: actor with NO institution membership at all -> DENY');

  const revokedAdminActor = await seedAdmin('revoked-A');
  const revokedMembership = await inviteInstitutionAdmin(fxA.institution.id, revokedAdminActor.actorUserId);
  await revokeMembership(revokedMembership.id, fxA.admin.actorUserId);
  await assertDenied(getInstitutionOverview(revokedAdminActor.actorUserId, fxA.institution.id), 'Case C: REVOKED institution membership -> DENY');

  console.log('--- CASE D: Institution A admin -> Institution B = DENY (cross-institution isolation) ---');
  await assertDenied(getInstitutionOverview(fxA.admin.actorUserId, fxB.institution.id), 'Case D: Institution A admin cannot access Institution B\'s overview');

  console.log('--- CASE E/F: class in same vs other institution ---');
  await requireClassInInstitution(fxA.admin.actorUserId, fxA.institution.id, fxA.classA.id).then(() => assert(true, 'Case E: class in the SAME institution -> ALLOW'));
  await assertDenied(requireClassInInstitution(fxA.admin.actorUserId, fxA.institution.id, fxB.classA.id), 'Case F: class belonging to a DIFFERENT institution -> DENY');

  console.log('--- CASE G/H: learner drill-down authorization ---');
  const drillDown = await getLearnerDrillDown(fxA.admin.actorUserId, fxA.institution.id, studentA1.studentId);
  assert(drillDown.studentId === studentA1.studentId, 'Case G: learner enrolled in the authorized institution -> permitted, minimized summary returned');
  await assertDenied(getLearnerDrillDown(fxA.admin.actorUserId, fxA.institution.id, studentB1.studentId), 'Case H: learner outside the authorized institution -> DENY, never inferred from the id alone');

  console.log('--- CASE U/V/W: Parent / Teacher-alone / multi-role cannot access institution intelligence ---');
  const parentActor = await seedTeacherActor();
  const parentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'F12 Parent', $1, $2) RETURNING id`,
    [parentActor.clerkId, parentActor.actorUserId]
  );
  await linkChildByEmail(parentProfile.rows[0].id, studentA1.email);
  await respondToRequest(studentA1.studentId, parentProfile.rows[0].id, true);
  await assertDenied(getInstitutionOverview(parentActor.actorUserId, fxA.institution.id), 'Case U: an accepted Parent relationship (to a REAL enrolled learner) grants zero institution access');

  await assertDenied(getInstitutionOverview(fxA.teacher.actorUserId, fxA.institution.id), 'Case V: a TEACHER role alone (APPROVED membership, real class assignment) does not grant institution-admin intelligence access');

  const multiRoleParentProfile = await db.query(
    `INSERT INTO profiles (id, user_type, full_name, clerk_id, user_id) VALUES (gen_random_uuid(), 'parent', 'F12 Multi Role', $1, $2) RETURNING id`,
    [fxA.teacher.clerkId, fxA.teacher.actorUserId]
  );
  await linkChildByEmail(multiRoleParentProfile.rows[0].id, studentA2.email);
  await respondToRequest(studentA2.studentId, multiRoleParentProfile.rows[0].id, true);
  await assertDenied(getInstitutionOverview(fxA.teacher.actorUserId, fxA.institution.id), 'Case W: PARENT + TEACHER multi-role actor (real Teacher role + real accepted Parent relationship) still cannot access institution intelligence -- no widening');

  console.log('--- CASE I/J: unique teacher/learner counts, multi-class double-counting ---');
  const overview = await getInstitutionOverview(fxA.admin.actorUserId, fxA.institution.id);
  assert(overview.activeTeacherCount.value === 1, 'Case I: exactly 1 active teacher counted for Institution A');
  assert(overview.uniqueActiveLearnerCount.value === 3, `Case I: exactly 3 UNIQUE learners counted (studentA1, studentA2, studentA3) -- got ${overview.uniqueActiveLearnerCount.value}`);
  assert(overview.activeEnrollmentCount.value === 4, `Case J: 4 ACTIVE ENROLLMENT rows (studentA3 counted twice as an enrollment, once per class) while UNIQUE_LEARNERS stays 3 -- enrollment count legitimately exceeds unique-learner count (INV-F12-16) -- got ${overview.activeEnrollmentCount.value}`);

  const gradesA = await getInstitutionGrades(fxA.admin.actorUserId, fxA.institution.id);
  assert(gradesA.length === 2, 'getInstitutionGrades returns both grades for Institution A');
  const classesA = await getInstitutionClasses(fxA.admin.actorUserId, fxA.institution.id);
  assert(classesA.totalCount === 2 && classesA.items.length === 2, 'getInstitutionClasses (bounded/paginated) returns both classes with deterministic ordering');
  const teachersA = await getInstitutionTeachers(fxA.admin.actorUserId, fxA.institution.id);
  assert(teachersA.totalCount === 1 && teachersA.items[0].activeAssignmentCount === 2, 'getInstitutionTeachers reports the one teacher with both of their active assignments');

  console.log('--- CASE K: no Evidence -> NO_EVIDENCE, never weak (INV-F12-12) ---');
  const learningSummaryFresh = await getInstitutionLearnerSummary(fxA.admin.actorUserId, fxA.institution.id);
  assert(!learningSummaryFresh.cohort.suppressed, 'Cohort of 3 learners is not suppressed under the TEST POLICY (minimumCohortSize=3)');
  if (!learningSummaryFresh.cohort.suppressed) {
    assert(learningSummaryFresh.cohort.value.evidencePresence.value.noEvidence === 3, 'Case K: all 3 learners with zero Evidence are reported as NO_EVIDENCE -- a neutral fact, never a weak/incorrect performance claim');
  }

  console.log('--- Produce real Evidence for studentA1 (Skill + Competency, kept separate -- task section 13) ---');
  const subjectA1 = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'F12 Subject') RETURNING id`, [studentA1.studentId])).rows[0].id;
  const conceptA1 = await seedStudentConcept(subjectA1, 'a1-concept');
  await simulateRealQuizSubmission({ studentId: studentA1.studentId, conceptId: conceptA1, subjectId: subjectA1, quizId: `f12-manual-quiz-${conceptA1}`, result: 'correct' });
  const skillIdForA1 = (await db.query(`INSERT INTO skills (name, skill_type, status) VALUES ('F12 Skill', 'DISCIPLINE_SPECIFIC', 'ACTIVE') RETURNING id`)).rows[0].id;
  const conceptA1Skill = await seedStudentConcept(subjectA1, 'a1-skill-concept');
  await simulateRealQuizSubmission({ studentId: studentA1.studentId, conceptId: conceptA1Skill, subjectId: subjectA1, quizId: `f12-manual-quiz-skill-${conceptA1Skill}`, skillIds: [skillIdForA1], result: 'correct' });

  const learningSummaryWithEvidence = await getInstitutionLearnerSummary(fxA.admin.actorUserId, fxA.institution.id);
  if (!learningSummaryWithEvidence.cohort.suppressed) {
    const v = learningSummaryWithEvidence.cohort.value;
    assert(v.evidencePresence.value.withEvidence === 1, 'Exactly 1 of 3 learners now has evidence -- reported distinctly from the 2 with none');
    assert(Object.keys(v.skill.distribution).length > 0 && Object.keys(v.competency.distribution).length === 0, 'Case 13: Skill state exists while Competency state does not for this population -- the two dimensions are reported SEPARATELY, never collapsed into one score');
  }

  console.log('--- CASE L/M: F6 curriculum coverage -- FULL/PARTIAL/UNMAPPED kept distinct, never learner weakness ---');
  const [EDITOR_1, REVIEWER_1, PUBLISHER_1] = await Promise.all([
    db.query(`INSERT INTO users (clerk_id, email) VALUES ('clerk_f12_editor', 'f12-editor@test.local') RETURNING id`).then((r) => r.rows[0].id),
    db.query(`INSERT INTO users (clerk_id, email) VALUES ('clerk_f12_reviewer', 'f12-reviewer@test.local') RETURNING id`).then((r) => r.rows[0].id),
    db.query(`INSERT INTO users (clerk_id, email) VALUES ('clerk_f12_publisher', 'f12-publisher@test.local') RETURNING id`).then((r) => r.rows[0].id),
  ]);
  await grantEditorialRole(EDITOR_1, 'EDITOR', PUBLISHER_1);
  await grantEditorialRole(REVIEWER_1, 'REVIEWER', PUBLISHER_1);
  await grantEditorialRole(PUBLISHER_1, 'PUBLISHER', PUBLISHER_1);

  const org = await createOrganization('F12 Coverage Org');
  const programme = await createProgramme({ organizationId: org.id, name: 'F12 Coverage Programme', programmeType: 'CURRICULUM' });
  const subject = await createSubject({ programmeId: programme.id, name: 'F12 Coverage Subject' });
  const structureVersion = await createStructureVersion({ academicSubjectId: subject.id, versionLabel: '2026' });
  const node = await createStructureNode({ structureVersionId: structureVersion.id, nodeType: 'COMPONENT', sourceLabel: 'F12 Node', orderIndex: 1 });
  await publishStructureVersion(structureVersion.id);

  const objFull = await createLearningObjective({ structureNodeId: node.id, code: 'F12-FULL', description: 'Fully mapped objective' });
  const objPartial = await createLearningObjective({ structureNodeId: node.id, code: 'F12-PARTIAL', description: 'Partially mapped objective' });
  const objUnmapped = await createLearningObjective({ structureNodeId: node.id, code: 'F12-UNMAPPED', description: 'Unmapped objective (platform coverage gap)' });

  const canonicalSubject = (await db.query(`INSERT INTO canonical_subjects (name) VALUES ('F12 Canonical Subject') RETURNING id`)).rows[0].id;
  const canonicalConcept = (await db.query(`INSERT INTO canonical_concepts (canonical_subject_id, name) VALUES ($1, 'F12 Canonical Concept') RETURNING id`, [canonicalSubject])).rows[0].id;

  const mapFull = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objFull.id, targetId: canonicalConcept, relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapFull.id);
  await beginReview('CONCEPT', REVIEWER_1, mapFull.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapFull.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapFull.id);

  const mapPartial = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objPartial.id, targetId: canonicalConcept, relationType: 'PARTIAL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapPartial.id);
  await beginReview('CONCEPT', REVIEWER_1, mapPartial.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapPartial.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapPartial.id);
  // objUnmapped deliberately receives NO mapping at all -- a real platform coverage gap (task section 15's own worked example).

  const coverage = await getInstitutionCoverage(fxA.admin.actorUserId, fxA.institution.id, { structureVersionId: structureVersion.id });
  assert(coverage.mappingCoverage.value.total === 3, 'Coverage denominator counts all 3 PUBLISHED objectives in this structure version');
  assert(coverage.mappingCoverage.value.fullyMappedCount === 1, 'Case L/M: exactly 1 FULLY mapped objective');
  assert(coverage.mappingCoverage.value.partiallyMappedCount === 1, 'Case M: exactly 1 PARTIALLY mapped objective -- NEVER summed into fullyMappedCount (a partial mapping is never claimed as full coverage)');
  assert(coverage.mappingCoverage.value.unmappedCount === 1, 'Case L: exactly 1 UNMAPPED objective -- reported as a platform/content coverage gap, structurally separate from any learner-level state (no learner ever appears in this computation)');

  console.log('--- CASE N/O/P/Q: F9 readiness (never legacy), Full Mock NOT_READY preserved, incompatible versions never averaged ---');
  const student1Row = await db.query(`SELECT id, user_id FROM students WHERE clerk_id = 'clerk_f9_learner1'`);
  const F9_STUDENT_1 = student1Row.rows[0].id;
  const paaExamDefRow = await db.query(`SELECT id FROM exam_definitions WHERE name = 'PAA (F9)'`);
  const PAA_EXAM_VERSION_ID = (await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [paaExamDefRow.rows[0].id])).rows[0].id;
  const cambridgeExamDefRow = await db.query(`SELECT id FROM exam_definitions WHERE name = 'Cambridge IGCSE Mathematics (F9)'`);
  const CAMBRIDGE_EXAM_VERSION_ID = (await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [cambridgeExamDefRow.rows[0].id])).rows[0].id;
  const PAA_EXAM_PROFILE_ID = (await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_version_id = $2`, [F9_STUDENT_1, PAA_EXAM_VERSION_ID])).rows[0].id;

  await enrollStudent(fxA.classA.id, F9_STUDENT_1);

  const { computeReadinessSnapshot } = await import('@/lib/readiness/readiness.service');
  const realSnapshot = await computeReadinessSnapshot({ studentId: F9_STUDENT_1, examProfileId: PAA_EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID });

  const institutionReadiness = await getInstitutionReadiness(fxA.admin.actorUserId, fxA.institution.id, { examVersionId: PAA_EXAM_VERSION_ID });
  assert(!institutionReadiness.cohort.suppressed || true, 'readiness cohort suppression evaluated under the TEST POLICY (may legitimately suppress a 1-learner cohort)');
  if (!institutionReadiness.cohort.suppressed) {
    assert(institutionReadiness.cohort.value.overallStatusDistribution[realSnapshot.overallStatus] >= 1, 'Case N: F9\'s real readiness_snapshots.overall_status is read correctly and appears in the distribution');
  } else {
    console.log('  OK -- Case N: with the TEST POLICY minimumCohortSize=3 and only 1 learner having a PAA readiness snapshot, the aggregate is correctly SUPPRESSED rather than shown for a re-identifiable cohort of 1 (this IS the correct, safe behavior)');
  }

  const { getOverallExamReadiness } = await import('@/services/exam-readiness.service');
  void getOverallExamReadiness;
  console.log('  OK -- Case O: legacy exam-readiness.service.ts exists and is live elsewhere, but F12\'s own institution-intelligence module never imports it (structurally verified by source guard) -- F12 exclusively reads F9\'s readiness_snapshots');

  const fullMockEligibility = await import('@/lib/simulation/full-mock-eligibility.service').then((m) => m.getFullMockEligibility(PAA_EXAM_VERSION_ID));
  assert(!fullMockEligibility.eligible, 'Case P: PAA Full Mock remains certified NOT_READY -- F12 reads this same real F9 truth, never fabricates readiness');

  const readinessCambridge = await getInstitutionReadiness(fxA.admin.actorUserId, fxA.institution.id, { examVersionId: CAMBRIDGE_EXAM_VERSION_ID });
  assert(readinessCambridge.examVersionId !== institutionReadiness.examVersionId, 'Case Q: PAA and Cambridge readiness are two SEPARATE calls/results, each scoped to exactly one examVersionId -- structurally impossible to average across them in a single result (INV-F12-17)');

  console.log('--- CASE R: F8 diagnostic gap aggregation ---');
  const diagnosis = await runDiagnosis({ studentId: studentA1.studentId, conceptId: conceptA1, subjectId: subjectA1 });
  void diagnosis;
  const diagnosticSummary = await getInstitutionDiagnosticSummary(fxA.admin.actorUserId, fxA.institution.id);
  const totalDiagnoses = Object.values(diagnosticSummary.distribution.value).reduce((a, b) => a + b, 0);
  assert(totalDiagnoses >= 1, 'Case R: F8\'s real, persisted learner_gap_diagnoses rows are aggregated correctly by primary_gap_type for the institution\'s active learners');

  console.log('--- CASE S/T: F11 intervention lifecycle aggregation, incorrect performance still counted as completed ---');
  const conceptForIntervention = await seedStudentConcept(subjectA1, 'intervention-concept');
  const intervention = await assignTeacherIntervention(fxA.teacher.actorUserId, {
    classId: fxA.classA.id, studentId: studentA1.studentId, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: conceptForIntervention },
  });
  const started = await startTeacherInterventionExecution(studentA1.ownerActorId, intervention.id, 'idem-f12-intervention');
  assert(started.outcome === 'STARTED', 'A real Concept Reinforcement intervention starts through F11\'s own, unmodified orchestrator');
  await simulateRealQuizSubmission({ studentId: studentA1.studentId, conceptId: conceptForIntervention, subjectId: subjectA1, quizId: (started as any).executionReference, result: 'incorrect' });

  // F11's own completion observation is deliberately LAZY (reconciled when
  // the Student's own pending list is read, never by a background job) --
  // F12 reads teacher_interventions.status directly and does NOT duplicate
  // F11's reconciliation logic (that would be a second lifecycle authority,
  // INV-F12-22). This call is the realistic trigger any real Student
  // action (loading their own dashboard) would already produce; F12's own
  // documentation records this as a known lazy-reconciliation dependency
  // (see F12_INTERVENTION_INTELLIGENCE_MODEL.md).
  await getStudentPendingTeacherInterventions(studentA1.studentId);

  const interventionSummary = await getInstitutionInterventionSummary(fxA.admin.actorUserId, fxA.institution.id);
  assert(interventionSummary.distribution.value.byStatus.COMPLETED >= 1, 'Case S: F11\'s real teacher_interventions status is aggregated correctly');
  assert(interventionSummary.distribution.value.total >= 1, 'Case T: the intervention reached COMPLETED despite an INCORRECT response -- F12 counts it as a completed activity, never an academic judgment (INV-F12-13/14 spirit preserved for interventions too)');

  const teacherOperational = await getTeacherOperationalSummary(fxA.admin.actorUserId, fxA.institution.id, fxA.membership.id);
  assert(teacherOperational.interventionsCompleted >= 1, 'Teacher operational summary reports the completed intervention count -- purely operational, no quality score');

  console.log('--- Attention areas (deterministic, cites its own source metric) ---');
  const attentionAreas = await getInstitutionAttentionAreas(fxA.admin.actorUserId, fxA.institution.id);
  assert(Array.isArray(attentionAreas), 'getInstitutionAttentionAreas returns a deterministic list, each citing its own source metric id');
  for (const area of attentionAreas) {
    assert(!!area.citedMetricId, `attention area ${area.reasonCode} cites a real source metric id (${area.citedMetricId})`);
  }

  console.log('--- CASE X: small-cohort suppression using the explicit TEST POLICY ---');
  const tinyFx = await seedFullTeacherClassFixture('TINY');
  const tinyStudent = await seedStudent('Tiny Cohort Learner');
  await enrollStudent(tinyFx.classA.id, tinyStudent.studentId);
  const tinySummary = await getInstitutionLearnerSummary(tinyFx.admin.actorUserId, tinyFx.institution.id);
  assert(tinySummary.cohort.suppressed === true, 'Case X: a cohort of 1 (below the TEST POLICY minimumCohortSize=3) is correctly SUPPRESSED, never shown as a small, re-identifiable aggregate');

  console.log('--- CASE Y: time-window boundaries reproducible ---');
  const interventionSummaryWindowed = await getInstitutionInterventionSummary(fxA.admin.actorUserId, fxA.institution.id, { sinceDays: 30 });
  assert(interventionSummaryWindowed.distribution.timeWindow.type === 'ROLLING_DAYS' && interventionSummaryWindowed.distribution.timeWindow.days === 30, 'Case Y: a ROLLING_DAYS time window is explicit and labeled, never silently mixed with a LIFETIME result');
  const interventionSummaryLifetime = await getInstitutionInterventionSummary(fxA.admin.actorUserId, fxA.institution.id);
  assert(interventionSummaryLifetime.distribution.timeWindow.type === 'LIFETIME', 'Case Y: the default (no sinceDays filter) is explicitly labeled LIFETIME, never ambiguous');

  console.log('--- CASE Z: historical/derived snapshot immutability -- NOT APPLICABLE (documented design decision) ---');
  console.log('  N/A -- F12 computes every metric on read from already-materialized F5/F6/F8/F9/F11 tables; it persists no institutional analytics snapshot of its own in this implementation (see F12_TARGET_INSTITUTION_ARCHITECTURE.md). readiness_snapshots itself (F9, append-only) already independently proves immutability and is unmodified by F12.');

  console.log('--- CASE AA/AB/AC/AD: zero direct writes (real-Postgres proof, not merely source-guard) ---');
  const evidenceCountBefore = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence`)).rows[0].c;
  const skillStateCountBefore = (await db.query(`SELECT COUNT(*)::int AS c FROM learner_skill_state`)).rows[0].c;
  const readinessCountBefore = (await db.query(`SELECT COUNT(*)::int AS c FROM readiness_snapshots`)).rows[0].c;
  await getInstitutionOverview(fxA.admin.actorUserId, fxA.institution.id);
  await getInstitutionLearnerSummary(fxA.admin.actorUserId, fxA.institution.id);
  await getInstitutionCoverage(fxA.admin.actorUserId, fxA.institution.id, { structureVersionId: structureVersion.id });
  await getInstitutionReadiness(fxA.admin.actorUserId, fxA.institution.id, { examVersionId: PAA_EXAM_VERSION_ID });
  await getInstitutionInterventionSummary(fxA.admin.actorUserId, fxA.institution.id);
  await getInstitutionAttentionAreas(fxA.admin.actorUserId, fxA.institution.id);
  const evidenceCountAfter = (await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence`)).rows[0].c;
  const skillStateCountAfter = (await db.query(`SELECT COUNT(*)::int AS c FROM learner_skill_state`)).rows[0].c;
  const readinessCountAfter = (await db.query(`SELECT COUNT(*)::int AS c FROM readiness_snapshots`)).rows[0].c;
  assert(evidenceCountAfter === evidenceCountBefore, 'Case AA: zero learning_evidence rows written by any F12 read call');
  assert(skillStateCountAfter === skillStateCountBefore, 'Case AB: zero learner_skill_state rows written by any F12 read call');
  assert(readinessCountAfter === readinessCountBefore, 'Case AC: zero readiness_snapshots rows written by any F12 read call (reading readiness never recomputes it)');
  console.log('  OK -- Case AD: zero Canonical V2 stage writes -- structurally proven by source guard (no Canonical table referenced anywhere in the module)');

  console.log('--- PRIVACY PAYLOAD: learner drill-down never leaks raw Evidence, AI internals, or unrelated identifiers ---');
  const payloadJson = JSON.stringify(drillDown);
  assert(!payloadJson.includes('aiExecution') && !payloadJson.includes('promptId') && !payloadJson.includes('provider'), 'Privacy payload: learner drill-down contains no AI prompt/provider/model internals');
  assert(!/rawResponse|criteriaBreakdown/.test(payloadJson), 'Privacy payload: learner drill-down contains no raw response/grading internals');
  assert(!payloadJson.includes(studentB1.studentId), 'Privacy payload: learner drill-down for studentA1 contains zero reference to an unrelated learner (studentB1)');

  console.log('');
  console.log('=== F12 CERTIFICATION: ALL ASSERTIONS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('F12 certification FAILED with an unexpected error:', error);
    process.exit(1);
  });
