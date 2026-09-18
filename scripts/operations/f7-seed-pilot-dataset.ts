/**
 * F7 cert helper -- seeds the full F4/F6/F7 stack needed for the PAA
 * vertical + Cambridge contrast (task 21/22/24). Uses the REAL service
 * functions throughout, never hand-crafted rows except the small amount
 * of raw SQL F4/F6's own cert scripts already established as acceptable
 * (canonical catalog fixture rows, F1 users, F4/F6 students/subjects).
 */
import { db } from '@/lib/db';
import { createOrganization, createProgramme, createQualification, createSubject } from '@/lib/curriculum/organization.service';
import { createStructureVersion, createStructureNode, publishStructureVersion } from '@/lib/curriculum/structure.service';
import { createLearningObjective } from '@/lib/curriculum/objective.service';
import { grantEditorialRole } from '@/lib/curriculum/editorial.service';
import { createMapping, proposeMapping, beginReview, approveMapping, publishMapping, retireMapping } from '@/lib/curriculum/mapping.service';
import { ensureCatalogMapping } from '@/lib/catalog/mapping.service';
import { createExamDefinition, createExamVersion, createScoringModel, publishExamVersion } from '@/lib/assessment/exam-definition.service';
import { createComponent, configureTiming, configureToolRules, markSupported } from '@/lib/assessment/component.service';
import { createBlueprint, addComponentAllocation, addObjectiveTarget, publishBlueprint } from '@/lib/assessment/blueprint.service';
import { createInstitutionExamPolicy, verifyPolicy } from '@/lib/assessment/institution-policy.service';
import { createStudentExamProfile, addPreparationGoal } from '@/lib/assessment/student-exam-profile.service';

const EDITOR_1 = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbb1';
const REVIEWER_1 = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbb2';
const PUBLISHER_1 = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbb3';

async function main() {
  // --- F1 canonical users for editorial actors ---
  for (const [id, clerkId] of [
    [EDITOR_1, 'clerk_f7_editor1'],
    [REVIEWER_1, 'clerk_f7_reviewer1'],
    [PUBLISHER_1, 'clerk_f7_publisher1'],
  ]) {
    await db.query(`INSERT INTO users (id, clerk_id, email) VALUES ($1, $2, $3)`, [id, clerkId, `${clerkId}@test.local`]);
  }
  await grantEditorialRole(EDITOR_1, 'EDITOR', PUBLISHER_1);
  await grantEditorialRole(REVIEWER_1, 'REVIEWER', PUBLISHER_1);
  await grantEditorialRole(PUBLISHER_1, 'PUBLISHER', PUBLISHER_1);

  // --- F4 canonical catalog fixture ---
  await db.query(`INSERT INTO canonical_subjects (id, name) VALUES ('facecafe-0000-4000-8000-000000000001', 'Mathematics')`);
  await db.query(`
    INSERT INTO canonical_concepts (id, canonical_subject_id, name) VALUES
      ('facecafe-0000-4000-8000-0000000000c1', 'facecafe-0000-4000-8000-000000000001', 'Linear Equations'),
      ('facecafe-0000-4000-8000-0000000000c2', 'facecafe-0000-4000-8000-000000000001', 'Statistics')
  `);
  const skillRow = await db.query(`SELECT id FROM skills WHERE name = 'factor polynomial' LIMIT 1`);
  const SKILL_ID = skillRow.rows[0]?.id ?? null;
  const COMPETENCY_ROW = await db.query(`SELECT id FROM competencies WHERE code = 'C3' LIMIT 1`);
  const COMPETENCY_ID = COMPETENCY_ROW.rows[0]?.id ?? null;
  console.log('  seeded F4 canonical fixture (2 concepts, reused skill/competency taxonomy)');

  // --- F6: PAA (Admission Exam) ---
  const icfes = await createOrganization('ICFES');
  const paaProgramme = await createProgramme({ organizationId: icfes.id, name: 'PAA', programmeType: 'ADMISSION_EXAM' });
  const paaMath = await createSubject({ programmeId: paaProgramme.id, name: 'Mathematics' });
  const paaStructureV1 = await createStructureVersion({ academicSubjectId: paaMath.id, versionLabel: '2024' });
  const paaAlgebra = await createStructureNode({ structureVersionId: paaStructureV1.id, nodeType: 'COMPONENT', sourceLabel: 'Algebra', orderIndex: 1 });
  await publishStructureVersion(paaStructureV1.id);

  const objLinear = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-M-1', description: 'Solve linear equations' });
  const objStats = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-M-2', description: 'Interpret basic statistics (calculator-dependent)' });
  const objUnmapped = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-M-3', description: 'An objective with only a DRAFT mapping' });
  const objRetired = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-M-4', description: 'An objective whose mapping was retired' });

  // PUBLISHED mapping for objLinear (task 30/E/F comparison baseline)
  const mapLinear = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objLinear.id, targetId: 'facecafe-0000-4000-8000-0000000000c1', relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapLinear.id);
  await beginReview('CONCEPT', REVIEWER_1, mapLinear.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapLinear.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapLinear.id);

  // Task 33-L: a PUBLISHED skill mapping for objLinear, so the F7 evidence
  // bridge can resolve a real, non-fabricated skillId.
  if (SKILL_ID) {
    const skillMapping = await createMapping('SKILL', EDITOR_1, { learningObjectiveId: objLinear.id, targetId: SKILL_ID, relationType: 'FULL' });
    await proposeMapping('SKILL', EDITOR_1, skillMapping.id);
    await beginReview('SKILL', REVIEWER_1, skillMapping.id);
    await approveMapping('SKILL', REVIEWER_1, skillMapping.id);
    await publishMapping('SKILL', PUBLISHER_1, skillMapping.id);
  }
  // Task 33-M: deliberately NO objective_competency_mapping for objLinear,
  // even though the taxonomy graph may relate this skill to a competency
  // -- proving F7 never fabricates Competency evidence from mere relevance.

  // Task 33-E: a DRAFT-only mapping for objUnmapped, never proposed/published.
  await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objUnmapped.id, targetId: 'facecafe-0000-4000-8000-0000000000c2', relationType: 'FULL' });

  // Task 33-F: a mapping that WAS published, then retired.
  const mapToRetire = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objRetired.id, targetId: 'facecafe-0000-4000-8000-0000000000c2', relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapToRetire.id);
  await beginReview('CONCEPT', REVIEWER_1, mapToRetire.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapToRetire.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapToRetire.id);
  await retireMapping('CONCEPT', PUBLISHER_1, mapToRetire.id);

  console.log('  seeded PAA (ICFES, ADMISSION_EXAM) Mathematics with 4 objectives (1 PUBLISHED-mapped, 1 DRAFT-only, 1 RETIRED-mapping, 1 unmapped baseline)');

  // --- F6: Cambridge contrast (task 33-N) ---
  const cambridge = await createOrganization('Cambridge International');
  const cambridgeProgramme = await createProgramme({ organizationId: cambridge.id, name: 'Cambridge IGCSE', programmeType: 'CURRICULUM' });
  const cambridgeQualification = await createQualification({ programmeId: cambridgeProgramme.id, name: 'IGCSE' });
  const cambridgeMath = await createSubject({ programmeId: cambridgeProgramme.id, qualificationId: cambridgeQualification.id, name: 'Mathematics' });
  const cambridgeStructureV1 = await createStructureVersion({ academicSubjectId: cambridgeMath.id, versionLabel: '2023-2025' });
  const cambridgeStrand = await createStructureNode({ structureVersionId: cambridgeStructureV1.id, nodeType: 'STRAND', sourceLabel: 'Algebra', orderIndex: 1 });
  await publishStructureVersion(cambridgeStructureV1.id);
  const objCambridgeLinear = await createLearningObjective({ structureNodeId: cambridgeStrand.id, code: 'C-ALG-1', description: 'Solve linear equations' });
  const mapCambridgeLinear = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objCambridgeLinear.id, targetId: 'facecafe-0000-4000-8000-0000000000c1', relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapCambridgeLinear.id);
  await beginReview('CONCEPT', REVIEWER_1, mapCambridgeLinear.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapCambridgeLinear.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapCambridgeLinear.id);
  console.log('  seeded Cambridge IGCSE Mathematics with 1 objective mapped to the SAME canonical concept as PAA');

  // --- Task 33-N: a second, minimal Exam Definition for Cambridge --
  // same underlying canonical concept, genuinely different assessment
  // configuration (CURRICULUM subject-assessment vs. PAA's ADMISSION_EXAM). ---
  const cambridgeExamDef = await createExamDefinition({ academicProgrammeId: cambridgeProgramme.id, name: 'Cambridge IGCSE Mathematics Assessment', examFamily: 'SUBJECT_ASSESSMENT', purpose: 'end-of-programme certification', domains: ['Mathematics'] });
  const cambridgeScoringModel = await createScoringModel({ name: 'Cambridge Mark Scheme v1', scoringType: 'MARK_SCHEME' });
  const cambridgeExamVersion = await createExamVersion({ examDefinitionId: cambridgeExamDef.id, versionLabel: '2023-2025', scoringModelId: cambridgeScoringModel.id, supportedModalities: ['PAPER'] });
  console.log('  seeded a second Exam Definition (Cambridge, SUBJECT_ASSESSMENT/MARK_SCHEME) -- distinct config, same underlying canonical concept as PAA');

  // --- F7: PAA Exam Definition/Version/Components/Blueprint ---
  const paaExamDef = await createExamDefinition({ academicProgrammeId: paaProgramme.id, name: 'PAA', examFamily: 'ADMISSION_EXAM', purpose: 'university admission', domains: ['Reading', 'Writing', 'Mathematics', 'English'] });
  const scoringModel = await createScoringModel({ name: 'PAA Partial Credit v1', scoringType: 'PARTIAL_CREDIT', config: { note: 'fixture only' } });
  const paaExamVersion = await createExamVersion({ examDefinitionId: paaExamDef.id, versionLabel: '2024', scoringModelId: scoringModel.id, supportedModalities: ['ONLINE'] });

  // Component A: fully configured (timing + tools) -> SUPPORTED.
  const componentMath = await createComponent({ examVersionId: paaExamVersion.id, name: 'Mathematics Section', componentType: 'SECTION', academicSubjectId: paaMath.id });
  await configureTiming(componentMath.id, 90);
  await configureToolRules(componentMath.id, { calculator: 'PROHIBITED' });
  await markSupported(componentMath.id, true);

  // Component B: task 33-D -- timing configured, generation/bank support
  // marked SUPPORTED, but calculator/tool rule deliberately left
  // NOT_CONFIGURED -- isolates "missing calculator rule" as the ONLY
  // Full Mock blocker for this component, distinct from case G's
  // (componentOral below) genuinely unsupported component.
  const componentStats = await createComponent({ examVersionId: paaExamVersion.id, name: 'Statistics Sub-section', componentType: 'SECTION', academicSubjectId: paaMath.id });
  await configureTiming(componentStats.id, 30);
  await markSupported(componentStats.id, true);
  // tool rules intentionally left NOT_CONFIGURED

  // Component C: task 33-G -- genuinely unsupported (nothing configured).
  const componentOral = await createComponent({ examVersionId: paaExamVersion.id, name: 'Unsupported Oral Component', componentType: 'ORAL' });

  await publishExamVersion(paaExamVersion.id);

  const blueprint = await createBlueprint(paaExamVersion.id);
  await addComponentAllocation(blueprint.id, componentMath.id, { itemCount: 10, weight: 0.7 });
  await addComponentAllocation(blueprint.id, componentStats.id, { itemCount: 5, weight: 0.3 });
  const targetLinear = await addObjectiveTarget({ blueprintId: blueprint.id, learningObjectiveId: objLinear.id, assessmentComponentId: componentMath.id, targetItemCount: 5, skillId: SKILL_ID ?? undefined, difficultyMin: 2, difficultyMax: 4 });
  const targetStats = await addObjectiveTarget({ blueprintId: blueprint.id, learningObjectiveId: objStats.id, assessmentComponentId: componentStats.id, targetItemCount: 5 });
  const targetUnmapped = await addObjectiveTarget({ blueprintId: blueprint.id, learningObjectiveId: objUnmapped.id, assessmentComponentId: componentMath.id, targetItemCount: 2 });
  const targetRetired = await addObjectiveTarget({ blueprintId: blueprint.id, learningObjectiveId: objRetired.id, assessmentComponentId: componentOral.id, targetItemCount: 2 });
  await publishBlueprint(blueprint.id);
  console.log('  seeded PAA exam version (PUBLISHED), 3 components (1 fully SUPPORTED, 1 missing tool rules, 1 fully UNSUPPORTED), blueprint targeting all 4 objectives');

  // --- Task 33-A/B/C: two institution policies for the SAME exam version ---
  const uniA = await db.query(`INSERT INTO institutions (name, status) VALUES ('Universidad A', 'ACTIVE') RETURNING id`);
  const uniB = await db.query(`INSERT INTO institutions (name, status) VALUES ('Universidad B', 'ACTIVE') RETURNING id`);
  const policyVerified = await createInstitutionExamPolicy({ institutionId: uniA.rows[0].id, examDefinitionId: paaExamDef.id, examVersionId: paaExamVersion.id, admissionContext: 'Undergraduate 2026', sourceLocator: 'https://universidad-a.example/admisiones' });
  await verifyPolicy(policyVerified.id, { minimumScore: 320 }, { sections: ['Mathematics Section'] });
  const policyUnverified = await createInstitutionExamPolicy({ institutionId: uniB.rows[0].id, examDefinitionId: paaExamDef.id, examVersionId: paaExamVersion.id, admissionContext: 'Undergraduate 2026' });
  console.log('  seeded 2 independent institution policies for the SAME PAA exam version (1 VERIFIED, 1 POLICY_PENDING)');

  // --- Student + profiles + private content fixture for the evidence bridge ---
  await db.query(`INSERT INTO students (id, clerk_id, email, name) VALUES ('99999999-9999-4999-8999-999999999f71', 'clerk_f7_learner1', 'f7learner1@test.local', 'F7 Learner One')`);
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ('99999999-9999-4999-8999-999999999f71', 'student', 'F7 Learner One')`);
  await db.query(`INSERT INTO subjects (id, student_id, name) VALUES ('bbbbbbbb-f7bb-4bbb-8bbb-bbbbbbbbbbf1', '99999999-9999-4999-8999-999999999f71', 'Mathematics')`);
  await db.query(`INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-f7cc-4ccc-8ccc-ccccccccccf1', 'bbbbbbbb-f7bb-4bbb-8bbb-bbbbbbbbbbf1', 'LEARNER_LINEAR_EQ')`);
  await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-f7cc-4ccc-8ccc-ccccccccccf1', 'en', 'Linear Equations')`);
  const learnerMapping = await ensureCatalogMapping('cccccccc-f7cc-4ccc-8ccc-ccccccccccf1');

  const profileVerified = await createStudentExamProfile({ studentId: '99999999-9999-4999-8999-999999999f71', examDefinitionId: paaExamDef.id, examVersionId: paaExamVersion.id, purpose: 'ADMISSION_PREP', institutionTargetId: undefined });
  await addPreparationGoal({ studentExamProfileId: profileVerified.id, goalType: 'TARGET_SCORE', targetValue: '350' });
  const profileMinimal = await createStudentExamProfile({ studentId: '99999999-9999-4999-8999-999999999f71', examDefinitionId: paaExamDef.id });
  console.log(`  seeded 1 learner (F4 mapping: ${learnerMapping.status}) with 2 exam profiles (1 with a target-score goal, 1 minimal)`);

  console.log(JSON.stringify({
    paaExamDef: paaExamDef.id, paaExamVersion: paaExamVersion.id, componentMath: componentMath.id, componentStats: componentStats.id, componentOral: componentOral.id,
    blueprint: blueprint.id, objLinear: objLinear.id, objStats: objStats.id, objUnmapped: objUnmapped.id, objRetired: objRetired.id,
    targetLinear: targetLinear.id, targetStats: targetStats.id, targetUnmapped: targetUnmapped.id, targetRetired: targetRetired.id,
    policyVerified: policyVerified.id, policyUnverified: policyUnverified.id,
    profileVerified: profileVerified.id, profileMinimal: profileMinimal.id,
    conceptLinear: 'facecafe-0000-4000-8000-0000000000c1', competencyId: COMPETENCY_ID, skillId: SKILL_ID,
    learnerStudentId: '99999999-9999-4999-8999-999999999f71', learnerConceptId: 'cccccccc-f7cc-4ccc-8ccc-ccccccccccf1', learnerSubjectId: 'bbbbbbbb-f7bb-4bbb-8bbb-bbbbbbbbbbf1',
  }));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('f7-seed-pilot-dataset failed:', err);
    process.exit(1);
  });
