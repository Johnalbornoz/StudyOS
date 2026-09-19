/**
 * F9 cert helper -- self-contained: does NOT depend on any prior
 * phase's own pilot-dataset script having run (per the current-state
 * assessment §4, no fixture data from F7/F8's own cert scripts persists
 * into a fresh database). Builds:
 *
 * - PAA (Mathematics fully configured + supported; Reading deliberately
 *   left UNSUPPORTED) -- the real, truthful PAA Full Mock certification
 *   fixture (task 42/43).
 * - Cambridge (a SEPARATE, fully-configured single-domain exam version)
 *   -- used ONLY to certify case L (Full Mock structurally ready vs.
 *   learner not ready) without conflating that proof with the PAA
 *   headline result, which must honestly report NOT_READY.
 * - Two real learner students, each linked to their own F1 canonical
 *   owner user (case T).
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
import { createInstitutionExamPolicy, verifyPolicy } from '@/lib/assessment/institution-policy.service';
import { createCommandTermInterpretation, activateCommandTermInterpretation } from '@/lib/teaching/command-term-teaching.service';

const EDITOR_1 = 'dddddddd-9999-4ddd-8ddd-dddddddddd91';
const REVIEWER_1 = 'dddddddd-9999-4ddd-8ddd-dddddddddd92';
const PUBLISHER_1 = 'dddddddd-9999-4ddd-8ddd-dddddddddd93';

const STUDENT_1 = '99999999-7777-4999-8999-999999999f91';
const STUDENT_2 = '99999999-7777-4999-8999-999999999f92';

async function main() {
  for (const [id, clerkId] of [
    [EDITOR_1, 'clerk_f9_editor1'],
    [REVIEWER_1, 'clerk_f9_reviewer1'],
    [PUBLISHER_1, 'clerk_f9_publisher1'],
  ]) {
    await db.query(`INSERT INTO users (id, clerk_id, email) VALUES ($1, $2, $3)`, [id, clerkId, `${clerkId}@test.local`]);
  }
  await grantEditorialRole(EDITOR_1, 'EDITOR', PUBLISHER_1);
  await grantEditorialRole(REVIEWER_1, 'REVIEWER', PUBLISHER_1);
  await grantEditorialRole(PUBLISHER_1, 'PUBLISHER', PUBLISHER_1);

  // --- F4 canonical fixture: one concept for PAA Math (shared with Cambridge, case U), one for PAA Reading ---
  // Names here are matched EXACTLY (case/trim-insensitive) against the
  // learner's own subject/concept labels by F4's ensureCatalogMapping
  // (src/lib/catalog/mapping.service.ts's exact-label-match query) --
  // "Mathematics (F9)" would never MATCH a student subject literally
  // named "Mathematics", leaving the reverse student-concept lookup
  // permanently UNRESOLVED. Uniqueness comes from the id, not the name.
  await db.query(`INSERT INTO canonical_subjects (id, name) VALUES ('facecafe-0000-4000-8000-000000000091', 'Mathematics')`);
  await db.query(`
    INSERT INTO canonical_concepts (id, canonical_subject_id, name) VALUES
      ('facecafe-0000-4000-8000-0000000000f1', 'facecafe-0000-4000-8000-000000000091', 'Linear Equations'),
      ('facecafe-0000-4000-8000-0000000000f2', 'facecafe-0000-4000-8000-000000000091', 'Reading Comprehension (F9)')
  `);
  const skillRow = await db.query(`SELECT id FROM skills WHERE name = 'factor polynomial' LIMIT 1`);
  const SKILL_ID = skillRow.rows[0]?.id ?? null;
  const commandTermRow = await db.query(`SELECT id, term FROM command_terms WHERE term = 'justify' LIMIT 1`);
  const COMMAND_TERM_ID = commandTermRow.rows[0]?.id;

  // --- PAA: ICFES / ADMISSION_EXAM ---
  const icfes = await createOrganization('ICFES (F9)');
  const paaProgramme = await createProgramme({ organizationId: icfes.id, name: 'PAA (F9)', programmeType: 'ADMISSION_EXAM' });
  const paaMath = await createSubject({ programmeId: paaProgramme.id, name: 'Mathematics' });
  const paaReading = await createSubject({ programmeId: paaProgramme.id, name: 'Reading' });

  const mathStructure = await createStructureVersion({ academicSubjectId: paaMath.id, versionLabel: '2024' });
  const mathNode = await createStructureNode({ structureVersionId: mathStructure.id, nodeType: 'COMPONENT', sourceLabel: 'Algebra', orderIndex: 1 });
  await publishStructureVersion(mathStructure.id);
  const objMath = await createLearningObjective({ structureNodeId: mathNode.id, code: 'PAA-M-F9-1', description: 'Solve linear equations' });

  const readingStructure = await createStructureVersion({ academicSubjectId: paaReading.id, versionLabel: '2024' });
  const readingNode = await createStructureNode({ structureVersionId: readingStructure.id, nodeType: 'COMPONENT', sourceLabel: 'Comprehension', orderIndex: 1 });
  await publishStructureVersion(readingStructure.id);
  const objReading = await createLearningObjective({ structureNodeId: readingNode.id, code: 'PAA-R-F9-1', description: 'Interpret a short passage' });

  const mapMath = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objMath.id, targetId: 'facecafe-0000-4000-8000-0000000000f1', relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapMath.id);
  await beginReview('CONCEPT', REVIEWER_1, mapMath.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapMath.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapMath.id);

  if (SKILL_ID) {
    const skillMapping = await createMapping('SKILL', EDITOR_1, { learningObjectiveId: objMath.id, targetId: SKILL_ID, relationType: 'FULL' });
    await proposeMapping('SKILL', EDITOR_1, skillMapping.id);
    await beginReview('SKILL', REVIEWER_1, skillMapping.id);
    await approveMapping('SKILL', REVIEWER_1, skillMapping.id);
    await publishMapping('SKILL', PUBLISHER_1, skillMapping.id);
  }

  // A SECOND Mathematics objective, under the SAME fully-SUPPORTED component,
  // deliberately left WITHOUT any mapping at all (task 45 case H -- partial
  // curriculum mapping -- isolates "objective unmapped" from "component
  // unsupported", which the Reading objective above conflates since its
  // component is unsupported too).
  const objMathUnmapped = await createLearningObjective({ structureNodeId: mathNode.id, code: 'PAA-M-F9-2', description: 'An objective with no mapping at all' });

  // Reading objective: deliberately left WITHOUT any mapping (task 45 case H -- partial curriculum mapping).
  console.log('  seeded PAA (F9) Mathematics (PUBLISHED-mapped + 1 deliberately unmapped) + Reading (deliberately unmapped) objectives');

  // --- Cambridge contrast: same canonical Math concept, different framework (case U) ---
  const cambridge = await createOrganization('Cambridge International (F9)');
  const cambridgeProgramme = await createProgramme({ organizationId: cambridge.id, name: 'Cambridge IGCSE (F9)', programmeType: 'CURRICULUM' });
  const cambridgeMath = await createSubject({ programmeId: cambridgeProgramme.id, name: 'Mathematics' });
  const cambridgeStructure = await createStructureVersion({ academicSubjectId: cambridgeMath.id, versionLabel: '2023-2025' });
  const cambridgeNode = await createStructureNode({ structureVersionId: cambridgeStructure.id, nodeType: 'STRAND', sourceLabel: 'Algebra', orderIndex: 1 });
  await publishStructureVersion(cambridgeStructure.id);
  const objCambridge = await createLearningObjective({ structureNodeId: cambridgeNode.id, code: 'C-ALG-F9-1', description: 'Solve linear equations' });
  const mapCambridge = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objCambridge.id, targetId: 'facecafe-0000-4000-8000-0000000000f1', relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapCambridge.id);
  await beginReview('CONCEPT', REVIEWER_1, mapCambridge.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapCambridge.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapCambridge.id);
  console.log('  seeded Cambridge IGCSE (F9) Mathematics mapped to the SAME canonical concept as PAA');

  // --- F7: PAA exam version -- Mathematics fully configured/SUPPORTED, Reading deliberately UNSUPPORTED ---
  const paaExamDef = await createExamDefinition({ academicProgrammeId: paaProgramme.id, name: 'PAA (F9)', examFamily: 'ADMISSION_EXAM', purpose: 'university admission', domains: ['Reading', 'Writing', 'Mathematics', 'English'] });
  const paaScoringModel = await createScoringModel({ name: 'PAA (F9) Partial Credit v1', scoringType: 'PARTIAL_CREDIT' });
  const paaExamVersion = await createExamVersion({ examDefinitionId: paaExamDef.id, versionLabel: '2024', scoringModelId: paaScoringModel.id, supportedModalities: ['ONLINE'] });

  const componentMath = await createComponent({ examVersionId: paaExamVersion.id, name: 'Mathematics Section', componentType: 'SECTION', academicSubjectId: paaMath.id });
  await configureTiming(componentMath.id, 60);
  await configureToolRules(componentMath.id, { calculator: 'PROHIBITED' });
  await markSupported(componentMath.id, true);

  // Reading component: deliberately left genuinely UNSUPPORTED (task 42/43 -- never fake completeness).
  const componentReading = await createComponent({ examVersionId: paaExamVersion.id, name: 'Reading Section', componentType: 'SECTION', academicSubjectId: paaReading.id });

  await publishExamVersion(paaExamVersion.id);
  const paaBlueprint = await createBlueprint(paaExamVersion.id);
  await addComponentAllocation(paaBlueprint.id, componentMath.id, { itemCount: 10, weight: 0.6 });
  await addComponentAllocation(paaBlueprint.id, componentReading.id, { itemCount: 5, weight: 0.4 });
  const targetMath = await addObjectiveTarget({
    blueprintId: paaBlueprint.id, learningObjectiveId: objMath.id, assessmentComponentId: componentMath.id,
    targetItemCount: 5, skillId: SKILL_ID ?? undefined, commandTermId: COMMAND_TERM_ID, difficultyMin: 2, difficultyMax: 4,
  });
  const targetReading = await addObjectiveTarget({ blueprintId: paaBlueprint.id, learningObjectiveId: objReading.id, assessmentComponentId: componentReading.id, targetItemCount: 3 });
  const targetMathUnmapped = await addObjectiveTarget({ blueprintId: paaBlueprint.id, learningObjectiveId: objMathUnmapped.id, assessmentComponentId: componentMath.id, targetItemCount: 1 });
  await publishBlueprint(paaBlueprint.id);
  console.log('  seeded PAA (F9) exam version (PUBLISHED): Mathematics fully SUPPORTED, Reading genuinely UNSUPPORTED -- 2 real blueprint-referenced domains');

  // --- F9: command_term_interpretations for "justify" ---
  if (COMMAND_TERM_ID) {
    const interp = await createCommandTermInterpretation({
      commandTermId: COMMAND_TERM_ID,
      academicProgrammeId: paaProgramme.id,
      expectedStructure: 'State a claim, then give one piece of supporting evidence with explicit reasoning.',
      commonFailurePatterns: ['restates the claim without evidence'],
    });
    await activateCommandTermInterpretation(interp.id);
  }

  // --- Cambridge exam version: a SEPARATE, fully-configured single-domain structure, used ONLY for case L ---
  const cambridgeExamDef = await createExamDefinition({ academicProgrammeId: cambridgeProgramme.id, name: 'Cambridge IGCSE Mathematics (F9)', examFamily: 'SUBJECT_ASSESSMENT', domains: ['Mathematics'] });
  const cambridgeScoringModel = await createScoringModel({ name: 'Cambridge (F9) Mark Scheme v1', scoringType: 'MARK_SCHEME' });
  const cambridgeExamVersion = await createExamVersion({ examDefinitionId: cambridgeExamDef.id, versionLabel: '2023-2025', scoringModelId: cambridgeScoringModel.id, supportedModalities: ['PAPER'] });
  const cambridgeComponent = await createComponent({ examVersionId: cambridgeExamVersion.id, name: 'Mathematics Paper', componentType: 'PAPER', academicSubjectId: cambridgeMath.id });
  await configureTiming(cambridgeComponent.id, 90);
  await configureToolRules(cambridgeComponent.id, { calculator: 'ALLOWED' });
  await markSupported(cambridgeComponent.id, true);
  await publishExamVersion(cambridgeExamVersion.id);
  const cambridgeBlueprint = await createBlueprint(cambridgeExamVersion.id);
  await addComponentAllocation(cambridgeBlueprint.id, cambridgeComponent.id, { itemCount: 10, weight: 1.0 });
  const targetCambridge = await addObjectiveTarget({ blueprintId: cambridgeBlueprint.id, learningObjectiveId: objCambridge.id, assessmentComponentId: cambridgeComponent.id, targetItemCount: 10 });
  await publishBlueprint(cambridgeBlueprint.id);
  console.log('  seeded a SEPARATE, fully-configured, single-domain Cambridge (F9) exam version -- structurally Full-Mock-ready, used only to certify case L without conflating it with the honest PAA NOT_READY headline result');

  // --- Institution policies (case O): one verified with a comparable PERCENT_OF_MAX threshold, one unverified ---
  const uniA = await db.query(`INSERT INTO institutions (name, status) VALUES ('Universidad F9 A', 'ACTIVE') RETURNING id`);
  const uniB = await db.query(`INSERT INTO institutions (name, status) VALUES ('Universidad F9 B', 'ACTIVE') RETURNING id`);
  const policyVerified = await createInstitutionExamPolicy({ institutionId: uniA.rows[0].id, examDefinitionId: paaExamDef.id, examVersionId: paaExamVersion.id, admissionContext: 'Undergraduate 2026' });
  await verifyPolicy(policyVerified.id, { minimumScore: 60, scoreUnit: 'PERCENT_OF_MAX' }, { sections: ['Mathematics Section'] });
  const policyUnverified = await createInstitutionExamPolicy({ institutionId: uniB.rows[0].id, examDefinitionId: paaExamDef.id, examVersionId: paaExamVersion.id, admissionContext: 'Undergraduate 2026' });
  console.log('  seeded 2 institution policies (1 VERIFIED with a comparable PERCENT_OF_MAX threshold, 1 POLICY_PENDING)');

  // --- Students ---
  for (const [studentId, clerkId, name] of [
    [STUDENT_1, 'clerk_f9_learner1', 'F9 Learner One'],
    [STUDENT_2, 'clerk_f9_learner2', 'F9 Learner Two'],
  ]) {
    const ownerUser = await db.query(`INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`, [`${clerkId}_owner`, `${clerkId}_owner@test.local`]);
    await db.query(`INSERT INTO students (id, clerk_id, email, name, user_id) VALUES ($1, $2, $3, $4, $5)`, [studentId, clerkId, `${clerkId}@test.local`, name, ownerUser.rows[0].id]);
    await db.query(`INSERT INTO profiles (id, user_type, full_name, user_id) VALUES ($1, 'student', $2, $3)`, [studentId, name, ownerUser.rows[0].id]);
  }

  const subjectRow = await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Mathematics') RETURNING id`, [STUDENT_1]);
  const SUBJECT_ID = subjectRow.rows[0].id;
  const conceptRow = await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, 'LEARNER_LINEAR_EQ_F9') RETURNING id`, [SUBJECT_ID]);
  const LEARNER_CONCEPT_ID = conceptRow.rows[0].id;
  await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'en', 'Linear Equations')`, [LEARNER_CONCEPT_ID]);
  await ensureCatalogMapping(LEARNER_CONCEPT_ID);

  const examProfile = await createStudentExamProfile({ studentId: STUDENT_1, examDefinitionId: paaExamDef.id, examVersionId: paaExamVersion.id, purpose: 'ADMISSION_PREP' });
  const cambridgeExamProfile = await createStudentExamProfile({ studentId: STUDENT_1, examDefinitionId: cambridgeExamDef.id, examVersionId: cambridgeExamVersion.id, purpose: 'SUBJECT_PREP' });
  // STUDENT_2 has zero evidence anywhere (including for the canonical concept PAA/Cambridge share) --
  // this profile is used ONLY to certify case L (structurally ready, learner not ready) with a
  // genuinely no-evidence learner, since STUDENT_1's real shared-concept evidence would otherwise
  // make them legitimately ready for Cambridge too (a correct consequence of shared canonical
  // knowledge, not a bug -- see case U).
  const cambridgeExamProfileStudent2 = await createStudentExamProfile({ studentId: STUDENT_2, examDefinitionId: cambridgeExamDef.id, examVersionId: cambridgeExamVersion.id, purpose: 'SUBJECT_PREP' });
  console.log('  seeded 2 learner students, 1 PAA exam profile + 1 Cambridge exam profile for STUDENT_1');

  console.log(
    JSON.stringify({
      paaExamVersionId: paaExamVersion.id,
      paaExamDefId: paaExamDef.id,
      componentMathId: componentMath.id,
      componentReadingId: componentReading.id,
      objMath: objMath.id,
      objReading: objReading.id,
      objCambridge: objCambridge.id,
      targetMathId: targetMath.id,
      targetMathUnmappedId: targetMathUnmapped.id,
      targetReadingId: targetReading.id,
      commandTermId: COMMAND_TERM_ID,
      skillId: SKILL_ID,
      canonicalConceptId: 'facecafe-0000-4000-8000-0000000000f1',
      examProfileId: examProfile.id,
      cambridgeExamProfileId: cambridgeExamProfile.id,
      cambridgeExamProfileStudent2Id: cambridgeExamProfileStudent2.id,
      cambridgeExamVersionId: cambridgeExamVersion.id,
      targetCambridgeId: targetCambridge.id,
      paaMathAcademicSubjectId: paaMath.id,
      paaReadingAcademicSubjectId: paaReading.id,
      policyVerified: policyVerified.id,
      policyUnverified: policyUnverified.id,
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
    console.error('f9-seed-pilot-dataset failed:', err);
    process.exit(1);
  });
