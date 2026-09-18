/**
 * F6 cert helper -- seeds the pilot academic dataset (task 22): PAA
 * Mathematics (Admission Exam) plus a contrasting Cambridge Mathematics
 * (Curriculum/IGCSE) fixture, editorial actors, and a private-content
 * fixture for the isolation test. Uses the REAL F6/F4 service functions,
 * never hand-crafted rows, except for the small amount of raw SQL needed
 * to create F1 canonical users and F4 canonical catalog fixtures (the
 * same pattern F4/F5's own cert scripts already use).
 */
import { db } from '@/lib/db';
import { createOrganization, createProgramme, createQualification, createSubject } from '@/lib/curriculum/organization.service';
import { createStructureVersion, createStructureNode, publishStructureVersion } from '@/lib/curriculum/structure.service';
import { createLearningObjective } from '@/lib/curriculum/objective.service';
import { grantEditorialRole } from '@/lib/curriculum/editorial.service';
import { ensureCatalogMapping } from '@/lib/catalog/mapping.service';

const EDITOR_1 = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa1';
const EDITOR_2 = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa2';
const REVIEWER_1 = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa3';
const PUBLISHER_1 = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa4';

async function main() {
  // --- F1 canonical users for editorial actors ---
  for (const [id, clerkId] of [
    [EDITOR_1, 'clerk_f6_editor1'],
    [EDITOR_2, 'clerk_f6_editor2'],
    [REVIEWER_1, 'clerk_f6_reviewer1'],
    [PUBLISHER_1, 'clerk_f6_publisher1'],
  ]) {
    await db.query(`INSERT INTO users (id, clerk_id, email) VALUES ($1, $2, $3)`, [id, clerkId, `${clerkId}@test.local`]);
  }
  await grantEditorialRole(EDITOR_1, 'EDITOR', PUBLISHER_1);
  await grantEditorialRole(EDITOR_2, 'EDITOR', PUBLISHER_1);
  // EDITOR_2 also holds a REVIEWER grant, deliberately -- task 30-E's own
  // scenario is a real person who CAN review, attempting to review their
  // OWN proposal (the interesting adversarial case is the self-approval
  // check itself, not a plain missing-grant denial).
  await grantEditorialRole(EDITOR_2, 'REVIEWER', PUBLISHER_1);
  await grantEditorialRole(REVIEWER_1, 'REVIEWER', PUBLISHER_1);
  await grantEditorialRole(PUBLISHER_1, 'PUBLISHER', PUBLISHER_1);
  console.log('  seeded 4 editorial actors (2 editors [one also a reviewer, for the self-approval test], 1 reviewer, 1 publisher)');

  // --- F4 canonical catalog fixture (test-only, mirrors F4's own cert pattern) ---
  await db.query(`INSERT INTO canonical_subjects (id, name) VALUES ('cafe0000-0000-4000-8000-000000000001', 'Mathematics')`);
  await db.query(`
    INSERT INTO canonical_concepts (id, canonical_subject_id, name) VALUES
      ('cafe0000-0000-4000-8000-0000000000c1', 'cafe0000-0000-4000-8000-000000000001', 'Linear Equations'),
      ('cafe0000-0000-4000-8000-0000000000c2', 'cafe0000-0000-4000-8000-000000000001', 'Quadratic Functions'),
      ('cafe0000-0000-4000-8000-0000000000c3', 'cafe0000-0000-4000-8000-000000000001', 'Vectors'),
      ('cafe0000-0000-4000-8000-0000000000c4', 'cafe0000-0000-4000-8000-000000000001', 'Vectors')
  `); // c3/c4: deliberately ambiguous (same name, task 30-H)
  console.log('  seeded 1 canonical subject, 4 canonical concepts (Vectors x2 deliberately ambiguous)');

  // --- PAA: Admission Exam, not a curriculum clone (task 23) ---
  const icfes = await createOrganization('ICFES');
  const paaProgramme = await createProgramme({ organizationId: icfes.id, name: 'PAA', programmeType: 'ADMISSION_EXAM' });
  const paaMath = await createSubject({ programmeId: paaProgramme.id, name: 'Mathematics' });
  const paaV1 = await createStructureVersion({ academicSubjectId: paaMath.id, versionLabel: '2024' });
  // PAA nomenclature: COMPONENT (2-level tree)
  const paaAlgebra = await createStructureNode({ structureVersionId: paaV1.id, nodeType: 'COMPONENT', sourceLabel: 'Algebra', orderIndex: 1 });
  await publishStructureVersion(paaV1.id);
  console.log('  seeded PAA (ICFES, ADMISSION_EXAM) Mathematics, structure v1 PUBLISHED, nomenclature: COMPONENT');

  // --- Cambridge: Curriculum, different nomenclature and depth (task 24) ---
  const cambridge = await createOrganization('Cambridge International');
  const cambridgeProgramme = await createProgramme({ organizationId: cambridge.id, name: 'Cambridge IGCSE', programmeType: 'CURRICULUM', stage: 'Lower Secondary' });
  const igcse = await createQualification({ programmeId: cambridgeProgramme.id, name: 'IGCSE' });
  const cambridgeMath = await createSubject({ programmeId: cambridgeProgramme.id, qualificationId: igcse.id, name: 'Mathematics' });
  const cambridgeV1 = await createStructureVersion({ academicSubjectId: cambridgeMath.id, versionLabel: '2023-2025 syllabus' });
  // Cambridge nomenclature: STRAND -> SUB_STRAND (3-level tree, deeper than PAA's 2-level)
  const cambridgeNumber = await createStructureNode({ structureVersionId: cambridgeV1.id, nodeType: 'STRAND', sourceLabel: 'Number', orderIndex: 1 });
  const cambridgeFractions = await createStructureNode({ structureVersionId: cambridgeV1.id, parentId: cambridgeNumber.id, nodeType: 'SUB_STRAND', sourceLabel: 'Fractions and percentages', orderIndex: 1 });
  await publishStructureVersion(cambridgeV1.id);
  console.log('  seeded Cambridge International (CURRICULUM/IGCSE) Mathematics, structure v1 PUBLISHED, nomenclature: STRAND -> SUB_STRAND (different depth than PAA)');

  // --- Objectives ---
  const objLinearPAA = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-ALG-1', description: 'Solve linear equations in one variable' });
  const objLinearCambridge = await createLearningObjective({ structureNodeId: cambridgeFractions.id, code: 'C1.1', description: 'Solve linear equations' });
  const objQuadraticPAA = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-ALG-2', description: 'Interpret quadratic graphs' });
  const objQuadraticFormulaPAA = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-ALG-3', description: 'Apply the quadratic formula' });
  const objVectorsPAA = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-ALG-4', description: 'Vector operations in 2D' });
  const objProbabilityPAA = await createLearningObjective({ structureNodeId: paaAlgebra.id, code: 'PAA-ALG-5', description: 'Probability distributions' }); // deliberately left unmapped

  console.log('  seeded 6 learning objectives (PAA: 5, Cambridge: 1)');
  console.log(JSON.stringify({
    paaV1: paaV1.id, cambridgeV1: cambridgeV1.id, paaMath: paaMath.id,
    objLinearPAA: objLinearPAA.id, objLinearCambridge: objLinearCambridge.id,
    objQuadraticPAA: objQuadraticPAA.id, objQuadraticFormulaPAA: objQuadraticFormulaPAA.id,
    objVectorsPAA: objVectorsPAA.id, objProbabilityPAA: objProbabilityPAA.id,
    conceptLinear: 'cafe0000-0000-4000-8000-0000000000c1', conceptQuadratic: 'cafe0000-0000-4000-8000-0000000000c2',
    conceptVectorsA: 'cafe0000-0000-4000-8000-0000000000c3', conceptVectorsB: 'cafe0000-0000-4000-8000-0000000000c4',
    editor1: EDITOR_1, editor2: EDITOR_2, reviewer1: REVIEWER_1, publisher1: PUBLISHER_1,
  }));

  // --- Private content fixture (task 19): a student's own concept, MATCHED to canonical "Linear Equations" ---
  await db.query(`INSERT INTO students (id, clerk_id, email, name) VALUES ('99999999-9999-4999-8999-999999999f61', 'clerk_f6_learner1', 'f6learner1@test.local', 'F6 Learner One')`);
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ('99999999-9999-4999-8999-999999999f61', 'student', 'F6 Learner One')`);
  await db.query(`INSERT INTO students (id, clerk_id, email, name) VALUES ('99999999-9999-4999-8999-999999999f62', 'clerk_f6_learner2', 'f6learner2@test.local', 'F6 Learner Two')`);
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ('99999999-9999-4999-8999-999999999f62', 'student', 'F6 Learner Two')`);
  await db.query(`INSERT INTO subjects (id, student_id, name) VALUES ('bbbbbbbb-f6bb-4bbb-8bbb-bbbbbbbbbbf1', '99999999-9999-4999-8999-999999999f61', 'Mathematics')`);
  await db.query(`INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-f6cc-4ccc-8ccc-ccccccccccf1', 'bbbbbbbb-f6bb-4bbb-8bbb-bbbbbbbbbbf1', 'LEARNER_LINEAR_EQ')`);
  await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-f6cc-4ccc-8ccc-ccccccccccf1', 'en', 'Linear Equations')`);
  await db.query(`
    INSERT INTO content_sources (id, student_id, subject_id, source_type, source_language, storage_path)
    VALUES ('dddddddd-f6dd-4ddd-8ddd-ddddddddddf1', '99999999-9999-4999-8999-999999999f61', 'bbbbbbbb-f6bb-4bbb-8bbb-bbbbbbbbbbf1', 'upload', 'en', '/private/f6-cert/learner1-notes.pdf')
  `);
  await db.query(`
    INSERT INTO content_chunks (id, source_id, chunk_text, seq_order, concept_mappings)
    VALUES ('eeeeeeee-f6ee-4eee-8eee-eeeeeeeeeef1', 'dddddddd-f6dd-4ddd-8ddd-ddddddddddf1', 'My private notes on linear equations', 0, ARRAY['cccccccc-f6cc-4ccc-8ccc-ccccccccccf1']::uuid[])
  `);
  const mapping = await ensureCatalogMapping('cccccccc-f6cc-4ccc-8ccc-ccccccccccf1');
  console.log(`  seeded 2 learners + 1 private content chunk, F4 mapping status: ${mapping.status}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('f6-seed-pilot-dataset failed:', err);
    process.exit(1);
  });
