/**
 * F8 cert helper -- seeds the minimal F4/F6/F7 stack F8's own
 * adversarial matrix needs (task 33), plus F8's own
 * command_term_interpretations fixture and two real learner students
 * (for the cross-learner isolation case Q). Self-contained: does NOT
 * depend on F7's own pilot-dataset script having run first -- only on
 * the real migration history (through F8's own migration) having been
 * applied, which already seeds 6 command_terms and both v1 policy
 * rows. Uses REAL service functions throughout, matching every prior
 * phase's own cert-script discipline.
 */
import { db } from '@/lib/db';
import { createOrganization, createProgramme, createSubject } from '@/lib/curriculum/organization.service';
import { createStructureVersion, createStructureNode, publishStructureVersion } from '@/lib/curriculum/structure.service';
import { createLearningObjective } from '@/lib/curriculum/objective.service';
import { grantEditorialRole } from '@/lib/curriculum/editorial.service';
import { createMapping, proposeMapping, beginReview, approveMapping, publishMapping } from '@/lib/curriculum/mapping.service';
import { ensureCatalogMapping } from '@/lib/catalog/mapping.service';
import { createExamDefinition, createExamVersion, createScoringModel, publishExamVersion } from '@/lib/assessment/exam-definition.service';
import { createComponent, configureTiming, configureToolRules, markSupported } from '@/lib/assessment/component.service';
import { createBlueprint, addComponentAllocation, addObjectiveTarget, publishBlueprint } from '@/lib/assessment/blueprint.service';
import { createStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { createCommandTermInterpretation, activateCommandTermInterpretation } from '@/lib/teaching/command-term-teaching.service';

const EDITOR_1 = 'cccccccc-8888-4ccc-8ccc-cccccccccc81';
const REVIEWER_1 = 'cccccccc-8888-4ccc-8ccc-cccccccccc82';
const PUBLISHER_1 = 'cccccccc-8888-4ccc-8ccc-cccccccccc83';

const STUDENT_1 = '99999999-8888-4999-8999-999999999f81'; // primary diagnostic subject
const STUDENT_2 = '99999999-8888-4999-8999-999999999f82'; // for cross-learner isolation (case Q)

async function main() {
  // --- F1 canonical users for editorial actors ---
  for (const [id, clerkId] of [
    [EDITOR_1, 'clerk_f8_editor1'],
    [REVIEWER_1, 'clerk_f8_reviewer1'],
    [PUBLISHER_1, 'clerk_f8_publisher1'],
  ]) {
    await db.query(`INSERT INTO users (id, clerk_id, email) VALUES ($1, $2, $3)`, [id, clerkId, `${clerkId}@test.local`]);
  }
  await grantEditorialRole(EDITOR_1, 'EDITOR', PUBLISHER_1);
  await grantEditorialRole(REVIEWER_1, 'REVIEWER', PUBLISHER_1);
  await grantEditorialRole(PUBLISHER_1, 'PUBLISHER', PUBLISHER_1);

  // --- F4 canonical fixture: one concept shared by PAA and Cambridge (case I) ---
  await db.query(`INSERT INTO canonical_subjects (id, name) VALUES ('facecafe-0000-4000-8000-000000000081', 'Mathematics (F8)')`);
  await db.query(`INSERT INTO canonical_concepts (id, canonical_subject_id, name) VALUES ('facecafe-0000-4000-8000-0000000000e1', 'facecafe-0000-4000-8000-000000000081', 'Linear Equations (F8)')`);
  const skillRow = await db.query(`SELECT id FROM skills WHERE name = 'factor polynomial' LIMIT 1`);
  const SKILL_ID = skillRow.rows[0]?.id ?? null;
  const commandTermRow = await db.query(`SELECT id, term FROM command_terms WHERE term = 'justify' LIMIT 1`);
  const COMMAND_TERM_ID = commandTermRow.rows[0]?.id;
  console.log(`  seeded F4 canonical fixture (1 concept); reused skill ${SKILL_ID ?? 'NONE'} and command term "${commandTermRow.rows[0]?.term}" (${COMMAND_TERM_ID})`);

  // --- F6: PAA (Admission Exam) ---
  const icfes = await createOrganization('ICFES (F8)');
  const paaProgramme = await createProgramme({ organizationId: icfes.id, name: 'PAA (F8)', programmeType: 'ADMISSION_EXAM' });
  const paaMath = await createSubject({ programmeId: paaProgramme.id, name: 'Mathematics' });
  const paaStructureV1 = await createStructureVersion({ academicSubjectId: paaMath.id, versionLabel: '2024' });
  const paaAlgebra = await createStructureNode({ structureVersionId: paaStructureV1.id, nodeType: 'COMPONENT', sourceLabel: 'Algebra', orderIndex: 1 });
  await publishStructureVersion(paaStructureV1.id);
  const objLinear = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-M-F8-1', description: 'Solve linear equations' });

  const mapLinear = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objLinear.id, targetId: 'facecafe-0000-4000-8000-0000000000e1', relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapLinear.id);
  await beginReview('CONCEPT', REVIEWER_1, mapLinear.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapLinear.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapLinear.id);

  if (SKILL_ID) {
    const skillMapping = await createMapping('SKILL', EDITOR_1, { learningObjectiveId: objLinear.id, targetId: SKILL_ID, relationType: 'FULL' });
    await proposeMapping('SKILL', EDITOR_1, skillMapping.id);
    await beginReview('SKILL', REVIEWER_1, skillMapping.id);
    await approveMapping('SKILL', REVIEWER_1, skillMapping.id);
    await publishMapping('SKILL', PUBLISHER_1, skillMapping.id);
  }
  console.log('  seeded PAA (F8) Mathematics with 1 PUBLISHED-mapped objective (concept + skill)');

  // --- F6: Cambridge contrast (case I -- same canonical concept, different framework) ---
  const cambridge = await createOrganization('Cambridge International (F8)');
  const cambridgeProgramme = await createProgramme({ organizationId: cambridge.id, name: 'Cambridge IGCSE (F8)', programmeType: 'CURRICULUM' });
  const cambridgeMath = await createSubject({ programmeId: cambridgeProgramme.id, name: 'Mathematics' });
  const cambridgeStructureV1 = await createStructureVersion({ academicSubjectId: cambridgeMath.id, versionLabel: '2023-2025' });
  const cambridgeStrand = await createStructureNode({ structureVersionId: cambridgeStructureV1.id, nodeType: 'STRAND', sourceLabel: 'Algebra', orderIndex: 1 });
  await publishStructureVersion(cambridgeStructureV1.id);
  const objCambridgeLinear = await createLearningObjective({ structureNodeId: cambridgeStrand.id, code: 'C-ALG-F8-1', description: 'Solve linear equations' });
  const mapCambridgeLinear = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objCambridgeLinear.id, targetId: 'facecafe-0000-4000-8000-0000000000e1', relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapCambridgeLinear.id);
  await beginReview('CONCEPT', REVIEWER_1, mapCambridgeLinear.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapCambridgeLinear.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapCambridgeLinear.id);
  console.log('  seeded Cambridge IGCSE (F8) Mathematics with 1 objective mapped to the SAME canonical concept as PAA');

  // --- F7: PAA exam version/component/blueprint target with a command term ---
  const paaExamDef = await createExamDefinition({ academicProgrammeId: paaProgramme.id, name: 'PAA (F8)', examFamily: 'ADMISSION_EXAM', purpose: 'university admission', domains: ['Mathematics'] });
  const scoringModel = await createScoringModel({ name: 'PAA (F8) Partial Credit v1', scoringType: 'PARTIAL_CREDIT' });
  const paaExamVersion = await createExamVersion({ examDefinitionId: paaExamDef.id, versionLabel: '2024', scoringModelId: scoringModel.id, supportedModalities: ['ONLINE'] });
  const componentMath = await createComponent({ examVersionId: paaExamVersion.id, name: 'Mathematics Section', componentType: 'SECTION', academicSubjectId: paaMath.id });
  await configureTiming(componentMath.id, 90);
  await configureToolRules(componentMath.id, { calculator: 'PROHIBITED' });
  await markSupported(componentMath.id, true);
  await publishExamVersion(paaExamVersion.id);
  const blueprint = await createBlueprint(paaExamVersion.id);
  await addComponentAllocation(blueprint.id, componentMath.id, { itemCount: 10, weight: 1.0 });
  const targetLinear = await addObjectiveTarget({
    blueprintId: blueprint.id,
    learningObjectiveId: objLinear.id,
    assessmentComponentId: componentMath.id,
    targetItemCount: 5,
    skillId: SKILL_ID ?? undefined,
    commandTermId: COMMAND_TERM_ID,
    difficultyMin: 2,
    difficultyMax: 4,
  });
  await publishBlueprint(blueprint.id);
  console.log('  seeded PAA (F8) exam version (PUBLISHED), 1 SUPPORTED component, blueprint targeting the objective with a command term');

  // --- F8: command_term_interpretations -- a PAA-specific interpretation and a generic default ---
  const paaInterpretation = await createCommandTermInterpretation({
    commandTermId: COMMAND_TERM_ID,
    academicProgrammeId: paaProgramme.id,
    expectedStructure: 'State a claim, then give one piece of supporting evidence with explicit reasoning connecting it to the claim.',
    rubricNotes: 'PAA rewards explicit reasoning chains; a bare assertion never earns full marks.',
    commonFailurePatterns: ['restates the claim without evidence', 'gives evidence without connecting it to the claim'],
  });
  await activateCommandTermInterpretation(paaInterpretation.id);
  const defaultInterpretation = await createCommandTermInterpretation({
    commandTermId: COMMAND_TERM_ID,
    expectedStructure: 'Support your answer with a reason.',
  });
  await activateCommandTermInterpretation(defaultInterpretation.id);
  console.log('  seeded 2 ACTIVE command_term_interpretations for "justify" (1 PAA-specific, 1 generic default)');

  // --- Students (STUDENT_1: primary; STUDENT_2: cross-learner isolation, case Q) ---
  // Each gets its own F1 canonical `users` row linked via students.user_id --
  // canAccessLearner's owner check is `students.user_id = actorUserId`, a real
  // relationship row, never bare id equality between a student and a user.
  for (const [studentId, clerkId, name] of [
    [STUDENT_1, 'clerk_f8_learner1', 'F8 Learner One'],
    [STUDENT_2, 'clerk_f8_learner2', 'F8 Learner Two'],
  ]) {
    const ownerUser = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`${clerkId}_owner`, `${clerkId}_owner@test.local`]);
    await db.query(`INSERT INTO students (id, clerk_id, email, name, user_id) VALUES ($1, $2, $3, $4, $5)`, [studentId, clerkId, `${clerkId}@test.local`, name, ownerUser.rows[0].id]);
    await db.query(`INSERT INTO profiles (id, user_type, full_name, user_id) VALUES ($1, 'student', $2, $3)`, [studentId, name, ownerUser.rows[0].id]);
  }

  const subjectRow = await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Mathematics') RETURNING id`, [STUDENT_1]);
  const SUBJECT_ID = subjectRow.rows[0].id;
  const conceptRow = await db.query(
    `INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, 'LEARNER_LINEAR_EQ_F8') RETURNING id`,
    [SUBJECT_ID]
  );
  const LEARNER_CONCEPT_ID = conceptRow.rows[0].id;
  await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'en', 'Linear Equations')`, [LEARNER_CONCEPT_ID]);
  const learnerMapping = await ensureCatalogMapping(LEARNER_CONCEPT_ID);

  const examProfile = await createStudentExamProfile({ studentId: STUDENT_1, examDefinitionId: paaExamDef.id, examVersionId: paaExamVersion.id, purpose: 'ADMISSION_PREP' });
  console.log(`  seeded 2 learner students (F4 mapping for learner 1: ${learnerMapping.status}), 1 ACTIVE exam profile for STUDENT_1`);

  console.log(
    JSON.stringify({
      paaProgrammeId: paaProgramme.id,
      paaOrganizationId: icfes.id,
      cambridgeProgrammeId: cambridgeProgramme.id,
      cambridgeOrganizationId: cambridge.id,
      objLinear: objLinear.id,
      objCambridgeLinear: objCambridgeLinear.id,
      canonicalConceptId: 'facecafe-0000-4000-8000-0000000000e1',
      commandTermId: COMMAND_TERM_ID,
      skillId: SKILL_ID,
      paaExamVersionId: paaExamVersion.id,
      componentMathId: componentMath.id,
      targetLinearId: targetLinear.id,
      examProfileId: examProfile.id,
      student1: STUDENT_1,
      student2: STUDENT_2,
      subjectId: SUBJECT_ID,
      learnerConceptId: LEARNER_CONCEPT_ID,
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('f8-seed-pilot-dataset failed:', err);
    process.exit(1);
  });
