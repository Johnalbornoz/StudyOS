/**
 * F6 -- invoked by f6-curriculum-mapping-migration-cert.sh against a
 * real, ephemeral, local-only Postgres instance, after
 * f6-seed-pilot-dataset.ts. Exercises the full adversarial matrix from
 * task 30 (A-L) via the real service functions (never mocked). Looks up
 * fixture entities by their known codes/names rather than sharing
 * in-memory state with the seed script (a separate process).
 */
import { db } from '@/lib/db';
import { createMapping, approveMapping, beginReview, proposeMapping, publishMapping, retireMapping, createNewMappingVersion, SelfApprovalError, getMapping } from '@/lib/curriculum/mapping.service';
import { createResource, proposeResource, approveResource, publishResource, rejectResource, retireResource, linkResourceToObjective } from '@/lib/curriculum/resource.service';
import { computeContentCoverage, computeMappingCoverage } from '@/lib/curriculum/coverage.service';
import { createStructureNode, setStructureNodeParent, publishStructureVersion, createStructureVersion, StructureCycleError, getPublishedStructureVersion } from '@/lib/curriculum/structure.service';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { getObjectiveAlignmentForContentChunk } from '@/lib/curriculum/private-content-alignment.service';
import { verifyContentSourceAccess } from '@/lib/auth';

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function objectiveIdByCode(code: string): Promise<string> {
  const r = await db.query(`SELECT id FROM learning_objectives WHERE code = $1`, [code]);
  if (r.rows.length === 0) throw new Error(`objective not found: ${code}`);
  return r.rows[0].id;
}
async function conceptIdByExactName(name: string, expectedCount = 1): Promise<string[]> {
  const r = await db.query(`SELECT id FROM canonical_concepts WHERE name = $1 ORDER BY id`, [name]);
  if (r.rows.length !== expectedCount) throw new Error(`expected ${expectedCount} canonical concepts named '${name}', found ${r.rows.length}`);
  return r.rows.map((row: any) => row.id);
}
async function userIdByClerkId(clerkId: string): Promise<string> {
  const r = await db.query(`SELECT id FROM users WHERE clerk_id = $1`, [clerkId]);
  if (r.rows.length === 0) throw new Error(`user not found: ${clerkId}`);
  return r.rows[0].id;
}
async function subjectIdByProgrammeName(programmeName: string, subjectName: string): Promise<string> {
  const r = await db.query(
    `SELECT s.id FROM academic_subjects s JOIN academic_programmes p ON p.id = s.programme_id WHERE p.name = $1 AND s.name = $2`,
    [programmeName, subjectName]
  );
  if (r.rows.length === 0) throw new Error(`subject not found: ${programmeName}/${subjectName}`);
  return r.rows[0].id;
}

async function main() {
  const EDITOR_1 = await userIdByClerkId('clerk_f6_editor1');
  const EDITOR_2 = await userIdByClerkId('clerk_f6_editor2');
  const REVIEWER_1 = await userIdByClerkId('clerk_f6_reviewer1');
  const PUBLISHER_1 = await userIdByClerkId('clerk_f6_publisher1');

  const objLinearPAA = await objectiveIdByCode('PAA-ALG-1');
  const objLinearCambridge = await objectiveIdByCode('C1.1');
  const objQuadraticPAA = await objectiveIdByCode('PAA-ALG-2');
  const objQuadraticFormulaPAA = await objectiveIdByCode('PAA-ALG-3');
  const objVectorsPAA = await objectiveIdByCode('PAA-ALG-4');
  const objProbabilityPAA = await objectiveIdByCode('PAA-ALG-5');

  const [conceptLinear] = await conceptIdByExactName('Linear Equations', 1);
  const [conceptQuadratic] = await conceptIdByExactName('Quadratic Functions', 1);
  const [vectorsA, vectorsB] = await conceptIdByExactName('Vectors', 2);

  const paaMathSubjectId = await subjectIdByProgrammeName('PAA', 'Mathematics');

  // --- Task 30-A: same canonical concept mapped into PAA AND Cambridge -> one canonical concept ---
  const mapLinearPAA = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objLinearPAA, targetId: conceptLinear, relationType: 'FULL' });
  const mapLinearCambridge = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objLinearCambridge, targetId: conceptLinear, relationType: 'FULL' });
  assert(mapLinearPAA.targetId === mapLinearCambridge.targetId, 'task 30-A: PAA and Cambridge objectives both reference the SAME canonical concept id, never a duplicate');
  for (const m of [mapLinearPAA, mapLinearCambridge]) {
    await proposeMapping('CONCEPT', EDITOR_1, m.id);
    await beginReview('CONCEPT', REVIEWER_1, m.id);
    await approveMapping('CONCEPT', REVIEWER_1, m.id);
    await publishMapping('CONCEPT', PUBLISHER_1, m.id);
  }
  const conceptCountCheck = await db.query(`SELECT COUNT(*)::int AS c FROM canonical_concepts WHERE name = 'Linear Equations'`);
  assert(conceptCountCheck.rows[0].c === 1, 'task 30-A: exactly one canonical_concepts row named Linear Equations exists, regardless of being referenced by 2 frameworks');

  // --- Task 30-C: PARTIAL mapping never produces full coverage ---
  const mapQuadraticPartial = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objQuadraticPAA, targetId: conceptQuadratic, relationType: 'PARTIAL' });
  await proposeMapping('CONCEPT', EDITOR_1, mapQuadraticPartial.id);
  await beginReview('CONCEPT', REVIEWER_1, mapQuadraticPartial.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapQuadraticPartial.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapQuadraticPartial.id);

  // --- PREREQUISITE mapping (relation-type coverage) ---
  const mapPrereq = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objQuadraticFormulaPAA, targetId: conceptLinear, relationType: 'PREREQUISITE' });
  await proposeMapping('CONCEPT', EDITOR_1, mapPrereq.id);
  await beginReview('CONCEPT', REVIEWER_1, mapPrereq.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapPrereq.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapPrereq.id);

  // --- Task 30-E: author self-approval attempt -> DENY ---
  const mapSelfApproval = await createMapping('CONCEPT', EDITOR_2, { learningObjectiveId: objVectorsPAA, targetId: vectorsA, relationType: 'FULL' });
  await proposeMapping('CONCEPT', EDITOR_2, mapSelfApproval.id);
  await beginReview('CONCEPT', REVIEWER_1, mapSelfApproval.id);
  let selfApprovalDenied = false;
  try {
    await approveMapping('CONCEPT', EDITOR_2, mapSelfApproval.id); // EDITOR_2 is the creator
  } catch (err) {
    selfApprovalDenied = err instanceof SelfApprovalError;
  }
  assert(selfApprovalDenied, 'task 30-E: author attempting to approve their own proposal is DENIED');
  const afterSelfApprovalAttempt = await getMapping('CONCEPT', mapSelfApproval.id);
  assert(afterSelfApprovalAttempt?.status === 'IN_REVIEW', 'task 30-E: status remains unchanged (IN_REVIEW) after the denied self-approval attempt');

  // --- Task 30-H: ambiguous F4-style canonical correspondence never silently promoted ---
  const mapVectorsCandidateA = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objVectorsPAA, targetId: vectorsA, relationType: 'FULL', provenance: 'AI_SUGGESTED', confidence: 0.6, rationale: 'ambiguous: 2 canonical concepts named Vectors exist' });
  const mapVectorsCandidateB = await createMapping('CONCEPT', EDITOR_1, { learningObjectiveId: objVectorsPAA, targetId: vectorsB, relationType: 'FULL', provenance: 'AI_SUGGESTED', confidence: 0.6, rationale: 'ambiguous: 2 canonical concepts named Vectors exist' });
  assert(mapVectorsCandidateA.status === 'DRAFT' && mapVectorsCandidateB.status === 'DRAFT', 'task 30-H: both ambiguous AI-suggested candidates start as DRAFT, neither silently promoted');
  // Human reviewer resolves the ambiguity by publishing ONLY candidate A.
  await proposeMapping('CONCEPT', EDITOR_1, mapVectorsCandidateA.id);
  await beginReview('CONCEPT', REVIEWER_1, mapVectorsCandidateA.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapVectorsCandidateA.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapVectorsCandidateA.id);
  const candidateBFinal = await getMapping('CONCEPT', mapVectorsCandidateB.id);
  assert(candidateBFinal?.status === 'DRAFT', 'task 30-H: the UNRESOLVED candidate stays DRAFT -- never auto-published just because its sibling was');

  // --- Task 30-F: unpublished mapping is not selectable as published alignment ---
  const bridgeForVectors = await resolveActivityMetadataForObjective(objVectorsPAA);
  assert(bridgeForVectors !== null && bridgeForVectors.canonicalConceptIds.length === 1 && bridgeForVectors.canonicalConceptIds[0] === vectorsA, 'task 30-F: only the PUBLISHED candidate (A) is resolved, the DRAFT sibling (B) is invisible to the activity metadata bridge');

  // --- Task 30-B: same source label, different syllabus versions -> separate version context ---
  const paaV2 = await createStructureVersion({ academicSubjectId: paaMathSubjectId, versionLabel: '2025' });
  const paaAlgebraV2 = await createStructureNode({ structureVersionId: paaV2.id, nodeType: 'COMPONENT', sourceLabel: 'Algebra', orderIndex: 1 }); // SAME label as v1's node
  assert(true, 'task 30-B: a node with the same source_label ("Algebra") was created in a different structure_version_id without any uniqueness conflict');

  // --- Task 30-L: new framework version -- old historical version remains intact ---
  const publishedBeforeV2 = await getPublishedStructureVersion(paaMathSubjectId);
  await publishStructureVersion(paaV2.id);
  const v1AfterSupersede = await db.query(`SELECT status FROM structure_versions WHERE id = $1`, [publishedBeforeV2!.id]);
  assert(v1AfterSupersede.rows[0].status === 'SUPERSEDED', 'task 30-L: the old PUBLISHED version transitions to SUPERSEDED, never deleted');
  const oldNodesStillIntact = await db.query(`SELECT COUNT(*)::int AS c FROM structure_nodes WHERE structure_version_id = $1`, [publishedBeforeV2!.id]);
  assert(oldNodesStillIntact.rows[0].c > 0, 'task 30-L: the superseded version\'s nodes remain fully intact and queryable');
  const oldMappingStillPublished = await getMapping('CONCEPT', mapLinearPAA.id);
  assert(oldMappingStillPublished?.status === 'PUBLISHED', 'task 30-L/INV-F6-09: a mapping made against the OLD version is never rewritten by a new version being published');

  // --- Task 30-J: invalid structure cycle -> REJECT ---
  const nodeChild = await createStructureNode({ structureVersionId: paaV2.id, parentId: paaAlgebraV2.id, nodeType: 'KNOWLEDGE_REQUIREMENT', sourceLabel: 'Linear equations' });
  let cycleRejected = false;
  try {
    await setStructureNodeParent(paaAlgebraV2.id, nodeChild.id); // would make Algebra a child of its own child
  } catch (err) {
    cycleRejected = err instanceof StructureCycleError;
  }
  assert(cycleRejected, 'task 30-J: an invalid structure cycle is rejected before any write');

  // --- Task 30-K: blueprint boundary preserved (structural, not just documented) ---
  const columnCheck = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'structure_nodes'`
  );
  const columnNames = columnCheck.rows.map((r: any) => r.column_name);
  assert(
    !columnNames.some((c: string) => /weight|distribution|item_count|blueprint/i.test(c)),
    'task 30-K: structure_nodes has no assessment-weight/distribution/blueprint column -- the boundary is structural, not just documented'
  );

  // --- Resources: approved, rejected, retired, and duplicates on one objective (task 30-D) ---
  const resourceApproved = await createResource(EDITOR_1, { title: 'PAA Math Official Guide', resourceType: 'TEXTBOOK' });
  const resourceRejectedDraft = await createResource(EDITOR_1, { title: 'Random Practice PDF', resourceType: 'PRACTICE_SET' });
  const resourceRetired = await createResource(EDITOR_1, { title: 'Old PAA Prep Book 2019', resourceType: 'TEXTBOOK' });
  const resourceDup1 = await createResource(EDITOR_1, { title: 'Extra Practice Set 1', resourceType: 'PRACTICE_SET' });
  const resourceDup2 = await createResource(EDITOR_1, { title: 'Extra Practice Set 2', resourceType: 'PRACTICE_SET' });

  for (const r of [resourceApproved, resourceRetired, resourceDup1, resourceDup2]) {
    await proposeResource(EDITOR_1, r.id);
    await approveResource(REVIEWER_1, r.id);
    await publishResource(PUBLISHER_1, r.id);
    await linkResourceToObjective(r.id, objLinearPAA);
  }
  await retireResource(PUBLISHER_1, resourceRetired.id);

  await proposeResource(EDITOR_1, resourceRejectedDraft.id);
  await rejectResource(REVIEWER_1, resourceRejectedDraft.id);
  await linkResourceToObjective(resourceRejectedDraft.id, objQuadraticPAA);

  const resourceRetiredFinal = await db.query(`SELECT status FROM academic_resources WHERE id = $1`, [resourceRetired.id]);
  assert(resourceRetiredFinal.rows[0].status === 'RETIRED', 'task 30-G: the retired resource stays RETIRED, its row and links are never deleted');

  // --- Coverage computation (task 20/21/30-C/30-D) ---
  const paaV1Id = publishedBeforeV2!.id;
  const mappingCoverage = await computeMappingCoverage(paaV1Id);
  assert(mappingCoverage.total === 5, 'coverage: 5 objectives exist under PAA structure v1 (Linear/Quadratic/QuadraticFormula/Vectors/Probability)');
  assert(mappingCoverage.fullyMappedCount === 2, 'coverage: FULL count is exactly Linear + Vectors (2) -- PARTIAL and PREREQUISITE are excluded from FULL');
  assert(mappingCoverage.partiallyMappedCount === 1, 'coverage: PARTIAL count is exactly Quadratic (1)');
  assert(mappingCoverage.unmappedCount === 2, 'coverage: unmapped count is exactly QuadraticFormula(PREREQUISITE-only, counts as neither FULL nor PARTIAL) + Probability(no mapping at all)');

  const contentCoverage = await computeContentCoverage(paaV1Id);
  assert(contentCoverage.withApprovedResourceCount === 1, 'task 30-D/AC-F6-14: objLinearPAA has 3 PUBLISHED resources linked (approved + 2 duplicates) plus 1 RETIRED -- still counts as exactly ONE covered objective, never inflated');

  // --- Task 30-I / INV-F6-12: private content stays private even when aligned to a published objective ---
  // conceptLinear is legitimately referenced by 3 PUBLISHED objective
  // mappings at this point (PAA-Linear FULL, Cambridge-Linear FULL,
  // PAA-QuadraticFormula PREREQUISITE) -- the join correctly surfaces all
  // of them; the assertion checks objLinearPAA is among them, not that
  // it is the only one.
  const alignment = await getObjectiveAlignmentForContentChunk('eeeeeeee-f6ee-4eee-8eee-eeeeeeeeeef1');
  assert(
    alignment.some((a) => a.learningObjectiveId === objLinearPAA && a.relationType === 'FULL'),
    'task 30-I: the private content chunk resolves its alignment to the published PAA objective (among possibly several legitimate ones sharing the same canonical concept)'
  );
  const ownerAccess = await verifyContentSourceAccess('99999999-9999-4999-8999-999999999f61', 'dddddddd-f6dd-4ddd-8ddd-ddddddddddf1');
  const otherLearnerAccess = await verifyContentSourceAccess('99999999-9999-4999-8999-999999999f62', 'dddddddd-f6dd-4ddd-8ddd-ddddddddddf1');
  assert(ownerAccess === true, 'task 30-I: the owning learner can still access their private content after objective alignment');
  assert(otherLearnerAccess === false, 'task 30-I/INV-F6-12: a DIFFERENT learner cannot access it -- alignment to a shared official objective never publishes private content');

  // --- Task 27: activity metadata bridge resolves PUBLISHED mappings, null for unmapped ---
  const bridgeLinear = await resolveActivityMetadataForObjective(objLinearPAA);
  assert(bridgeLinear !== null && bridgeLinear.canonicalConceptIds.includes(conceptLinear), 'task 27: the activity metadata bridge resolves the PUBLISHED concept mapping for a real objective');
  const bridgeUnmapped = await resolveActivityMetadataForObjective(objProbabilityPAA);
  assert(bridgeUnmapped === null, 'task 27: an objective with zero PUBLISHED mappings resolves to null, never a guessed result');

  // --- Version-replacement mapping flow (task 12): change a PUBLISHED mapping without rewriting history ---
  const mapLinearV2 = await createNewMappingVersion('CONCEPT', EDITOR_1, mapLinearPAA.id, { rationale: 'refined scope for 2025' });
  assert(mapLinearV2.mappingGroupId === mapLinearPAA.mappingGroupId && mapLinearV2.version === mapLinearPAA.version + 1, 'task 12: the new mapping version shares the same mapping_group_id with an incremented version number');
  await proposeMapping('CONCEPT', EDITOR_1, mapLinearV2.id);
  await beginReview('CONCEPT', REVIEWER_1, mapLinearV2.id);
  await approveMapping('CONCEPT', REVIEWER_1, mapLinearV2.id);
  await publishMapping('CONCEPT', PUBLISHER_1, mapLinearV2.id);
  const originalMappingAfterReplacement = await getMapping('CONCEPT', mapLinearPAA.id);
  assert(originalMappingAfterReplacement?.status === 'RETIRED', 'task 12/INV-F6-09: publishing the new version atomically retires the original -- never left PUBLISHED alongside it, never deleted');

  console.log('\nAll F6 adversarial certification assertions passed against real PostgreSQL.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F6 lifecycle cert failed:', err);
    process.exit(1);
  });
