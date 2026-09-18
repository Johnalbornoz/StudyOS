/**
 * F7 -- invoked by f7-assessment-framework-migration-cert.sh against a
 * real, ephemeral, local-only Postgres instance, after
 * f7-seed-pilot-dataset.ts. Exercises the full adversarial matrix from
 * task 33 (A-N) via the real service functions (never mocked). Looks up
 * fixture entities by their known codes/names rather than sharing
 * in-memory state with the seed script (a separate process).
 */
import { db } from '@/lib/db';
import { getExamVersion } from '@/lib/assessment/exam-definition.service';
import { getComponent } from '@/lib/assessment/component.service';
import { getObjectiveTarget } from '@/lib/assessment/blueprint.service';
import { evaluatePolicyCompliance, getInstitutionExamPolicy } from '@/lib/assessment/institution-policy.service';
import { getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { resolveGenerationContext } from '@/lib/assessment/generation-contract.service';
import { validateComponentSupported, validateItemForExamContext } from '@/lib/assessment/validation.service';
import { recordExamAttemptItemResponse, listResponsesForAttempt } from '@/lib/assessment/evaluation.service';
import { startExamAttempt, getExamAttempt } from '@/lib/assessment/exam-attempt.service';
import { configureToolRules } from '@/lib/assessment/component.service';
import { retireMapping } from '@/lib/curriculum/mapping.service';
import { bridgeExamResponseToEvidence } from '@/lib/assessment/evidence-bridge.service';
import { canFullMockBeOffered } from '@/lib/assessment/full-mock-guard.service';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';

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
async function examDefIdByName(name: string): Promise<string> {
  const r = await db.query(`SELECT id FROM exam_definitions WHERE name = $1`, [name]);
  if (r.rows.length === 0) throw new Error(`exam definition not found: ${name}`);
  return r.rows[0].id;
}
async function componentIdByName(examVersionId: string, name: string): Promise<string> {
  const r = await db.query(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND name = $2`, [examVersionId, name]);
  if (r.rows.length === 0) throw new Error(`component not found: ${name}`);
  return r.rows[0].id;
}
async function targetIdForObjective(blueprintId: string, learningObjectiveId: string): Promise<string> {
  const r = await db.query(`SELECT id FROM blueprint_objective_targets WHERE blueprint_id = $1 AND learning_objective_id = $2`, [blueprintId, learningObjectiveId]);
  if (r.rows.length === 0) throw new Error(`target not found for objective ${learningObjectiveId}`);
  return r.rows[0].id;
}

async function main() {
  const paaExamDefId = await examDefIdByName('PAA');
  const cambridgeExamDefId = await examDefIdByName('Cambridge IGCSE Mathematics Assessment');

  const paaExamVersionRow = await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [paaExamDefId]);
  const paaExamVersionId = paaExamVersionRow.rows[0].id;

  const componentMathId = await componentIdByName(paaExamVersionId, 'Mathematics Section');
  const componentStatsId = await componentIdByName(paaExamVersionId, 'Statistics Sub-section');
  const componentOralId = await componentIdByName(paaExamVersionId, 'Unsupported Oral Component');

  const blueprintRow = await db.query(`SELECT id FROM assessment_blueprints WHERE exam_version_id = $1`, [paaExamVersionId]);
  const blueprintId = blueprintRow.rows[0].id;

  const objLinear = await objectiveIdByCode('PAA-M-1');
  const objStats = await objectiveIdByCode('PAA-M-2');
  const objUnmapped = await objectiveIdByCode('PAA-M-3');
  const objRetired = await objectiveIdByCode('PAA-M-4');
  const objCambridgeLinear = await objectiveIdByCode('C-ALG-1');

  const conceptLinearRow = await db.query(`SELECT id FROM canonical_concepts WHERE name = 'Linear Equations'`);
  const conceptLinearId = conceptLinearRow.rows[0].id;

  const targetLinearId = await targetIdForObjective(blueprintId, objLinear);

  const policiesRow = await db.query(`SELECT id, verification_status FROM institution_exam_policies WHERE exam_version_id = $1 ORDER BY verification_status`, [paaExamVersionId]);
  const policyVerified = policiesRow.rows.find((r: any) => r.verification_status === 'VERIFIED');
  const policyUnverified = policiesRow.rows.find((r: any) => r.verification_status === 'POLICY_PENDING');

  const profilesRow = await db.query(`SELECT id, purpose FROM student_exam_profiles WHERE exam_definition_id = $1 ORDER BY created_at`, [paaExamDefId]);

  // --- Task 33-A: PAA profile with verified policy -> valid configuration ---
  const complianceVerified = await evaluatePolicyCompliance(policyVerified.id);
  assert(complianceVerified.status === 'VERIFIED', 'task 33-A: a verified institution policy yields a VERIFIED compliance result with real threshold rules');
  assert('thresholdRules' in complianceVerified && (complianceVerified as any).thresholdRules.minimumScore === 320, 'task 33-A: the verified threshold rules are exactly what was configured, never invented');

  // --- Task 33-B: PAA profile with unverified policy -> preparation allowed, admission compliance unavailable ---
  const complianceUnverified = await evaluatePolicyCompliance(policyUnverified.id);
  assert(complianceUnverified.status === 'POLICY_PENDING', 'task 33-B: an unverified policy yields POLICY_PENDING, never a guessed compliance verdict');
  const minimalProfile = await getStudentExamProfile(profilesRow.rows.find((r: any) => !r.purpose)?.id ?? profilesRow.rows[1].id);
  assert(minimalProfile !== null && minimalProfile.status === 'ACTIVE', 'task 33-B: a minimal profile with no institution/target/exam date is still perfectly usable for preparation');

  // --- Task 33-C: two institution policies for the same PAA version -> independent ---
  assert(policiesRow.rows.length === 2, 'task 33-C: exactly 2 independent institution policies exist for the same exam version');
  const policyUnverifiedFull = await getInstitutionExamPolicy(policyUnverified.id);
  assert(policyUnverifiedFull?.thresholdRules === null, 'task 33-C: the unverified policy has NO threshold rules, completely independent of the verified one\'s data');

  // --- Task 33-D: missing calculator rule -> cannot claim fully configured official simulation ---
  const statsComponent = await getComponent(componentStatsId);
  assert(statsComponent?.toolRuleStatus === 'NOT_CONFIGURED', 'task 33-D: the Statistics component has an explicitly NOT_CONFIGURED tool-rule status, never a silently-assumed rule');
  const mockReadinessBeforeFix = await canFullMockBeOffered(paaExamVersionId);
  assert(!mockReadinessBeforeFix.ready, 'task 33-D: Full Mock cannot be offered while any component has unconfigured tool rules');
  assert(mockReadinessBeforeFix.reasons.some((r) => r.includes('TOOL_RULES_NOT_CONFIGURED') && r.includes('Statistics')), 'task 33-D: the specific missing-calculator-rule reason names the Statistics component explicitly');

  // --- Task 33-E: draft mapping -> excluded ---
  const bridgeUnmapped = await resolveActivityMetadataForObjective(objUnmapped);
  assert(bridgeUnmapped === null, 'task 33-E: an objective with only a DRAFT mapping resolves to null -- never selectable for generation');

  // --- Task 33-F: retired mapping -> excluded from new generation ---
  const bridgeRetired = await resolveActivityMetadataForObjective(objRetired);
  assert(bridgeRetired === null, 'task 33-F: an objective whose only mapping was RETIRED resolves to null -- retirement is not merely cosmetic');

  // --- Task 33-G: unsupported component -> explicit failure ---
  const oralComponent = await getComponent(componentOralId);
  const oralValidation = validateComponentSupported(oralComponent!.supportStatus);
  assert(!oralValidation.valid && oralValidation.reasons.includes('UNSUPPORTED_COMPONENT'), 'task 33-G: an unsupported component fails explicitly with a named reason, never a silent degradation');

  // --- Task 33-H: invalid AI-generated item -> validation failure before presentation ---
  const contextForLinear = await resolveGenerationContext(targetLinearId, '99999999-9999-4999-8999-999999999f71');
  const invalidCandidate = { type: 'open_response', difficulty: 5 }; // wrong type AND out-of-range difficulty vs. the target's own configured 2-4/skill-based expectations
  const validation = validateItemForExamContext(invalidCandidate, contextForLinear);
  assert(!validation.valid, 'task 33-H: a candidate item with the wrong type and out-of-range difficulty FAILS validation before it could ever be presented');
  assert(validation.reasons.some((r) => r.startsWith('DIFFICULTY_OUT_OF_RANGE')), 'task 33-H: the failure reason is specific and enumerable, never a generic error');

  // --- Task 33-I: partial-credit response -> evaluation preserves breakdown ---
  const attempt = await startExamAttempt({ studentExamProfileId: profilesRow.rows[0].id, examVersionId: paaExamVersionId, institutionExamPolicyId: policyVerified.id });
  const responseInsert = await recordExamAttemptItemResponse({
    examAttemptId: attempt.id,
    assessmentComponentId: componentMathId,
    learningObjectiveId: objLinear,
    itemSnapshot: { question: 'Solve 2x + 3 = 11 and show your working', type: 'structured_response' },
    evaluation: {
      rawResponse: { finalAnswer: 'x=4', steps: ['2x=8', 'x=4'] },
      score: 2.5,
      maxScore: 3,
      criteriaBreakdown: { setupCorrect: true, algebraCorrect: true, finalAnswerCorrect: false, marksAwarded: { setup: 1, algebra: 1, answer: 0.5 } },
      feedback: 'Correct method, minor final-answer rounding issue',
      evaluationModelVersion: 'gradeAnswer-v1',
      provenance: { aiExecutionId: 'fixture-exec-1' },
    },
  });
  const responses = await listResponsesForAttempt(attempt.id);
  const stored = responses.find((r: any) => r.id === responseInsert.id);
  assert(stored !== undefined && Number(stored.score) === 2.5 && Number(stored.max_score) === 3, 'task 33-I: the partial-credit score/maxScore are preserved exactly');
  assert(stored.criteria_breakdown.marksAwarded.algebra === 1, 'task 33-I: the full criteria/mark breakdown is preserved, not collapsed into a single number');

  // --- Task 33-J: configuration changes after attempt start -> historical attempt unchanged ---
  const frozenBefore = JSON.stringify(attempt.frozenConfiguration);
  await configureToolRules(componentMathId, { calculator: 'ALLOWED_SCIENTIFIC' }); // a real config change, post-attempt-start
  const publisherRow = await db.query(`SELECT id FROM users WHERE clerk_id = 'clerk_f7_publisher1'`);
  const publishedLinearMappingRow = await db.query(`SELECT id FROM objective_concept_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`, [objLinear]);
  await retireMapping('CONCEPT', publisherRow.rows[0].id, publishedLinearMappingRow.rows[0].id); // another real config change, post-attempt-start
  const attemptAfterChanges = await getExamAttempt(attempt.id);
  assert(JSON.stringify(attemptAfterChanges!.frozenConfiguration) === frozenBefore, 'task 33-J/INV-F7-04/30: the historical attempt\'s frozen configuration is byte-identical after real configuration changes were made post-start');
  const componentMathNowConfigured = await getComponent(componentMathId);
  assert(componentMathNowConfigured!.toolRules?.calculator === 'ALLOWED_SCIENTIFIC', 'task 33-J: the LIVE component row did change (proving the change was real, not a no-op)');

  // --- Task 33-K: curriculum node order differs from blueprint distribution -> blueprint wins ---
  const nodeOrderRow = await db.query(`SELECT order_index FROM structure_nodes WHERE id = (SELECT structure_node_id FROM learning_objectives WHERE id = $1)`, [objLinear]);
  const targetAfterReorder = await getObjectiveTarget(targetLinearId);
  await db.query(`UPDATE structure_nodes SET order_index = 999 WHERE id = (SELECT structure_node_id FROM learning_objectives WHERE id = $1)`, [objLinear]);
  const targetAfterNodeReorderChanged = await getObjectiveTarget(targetLinearId);
  assert(
    targetAfterReorder!.targetItemCount === targetAfterNodeReorderChanged!.targetItemCount,
    'task 33-K/INV-F6-05/INV-F7-05: reordering the curriculum node has ZERO effect on the blueprint\'s own target item count -- the blueprint\'s explicit configuration always wins, never curriculum tree order'
  );
  void nodeOrderRow;

  // --- Task 33-L: activity tags skill explicitly -> F5 Skill Evidence can be produced ---
  const learnerStudentId = '99999999-9999-4999-8999-999999999f71';
  const learnerConceptId = 'cccccccc-f7cc-4ccc-8ccc-ccccccccccf1';
  const learnerSubjectId = 'bbbbbbbb-f7bb-4bbb-8bbb-bbbbbbbbbbf1';
  const bridgeOutcome = await bridgeExamResponseToEvidence({
    studentId: learnerStudentId,
    conceptId: learnerConceptId,
    subjectId: learnerSubjectId,
    learningObjectiveId: objLinear,
    result: 'correct',
    difficulty: 3,
    scorePercent: 100,
  });
  assert(bridgeOutcome.attachedSkillIds.length === 1, 'task 33-L: the evidence bridge attached exactly the one PUBLISHED skill mapping for this objective');
  const skillStateRow = await db.query(`SELECT state FROM learner_skill_state WHERE student_id = $1 AND skill_id = $2`, [learnerStudentId, bridgeOutcome.attachedSkillIds[0]]);
  assert(skillStateRow.rows.length === 1, 'task 33-L: F5 Skill Evidence was genuinely produced -- a real learner_skill_state row now exists');

  // --- Task 33-M: competency only contextually relevant -> no fabricated Competency evidence ---
  assert(bridgeOutcome.attachedCompetencyIds.length === 0, 'task 33-M: NO competencyIds were attached -- objLinear has no PUBLISHED competency mapping, even though the underlying skill may relate to a competency in the taxonomy graph');
  const anyCompetencyStateRow = await db.query(`SELECT COUNT(*)::int AS c FROM learner_competency_state WHERE student_id = $1`, [learnerStudentId]);
  assert(anyCompetencyStateRow.rows[0].c === 0, 'task 33-M/INV-F7-18: zero learner_competency_state rows exist for this learner -- no Competency evidence was ever fabricated');

  // --- Task 33-N: same canonical concept assessed under PAA and Cambridge -> same knowledge identity, different assessment configuration ---
  const paaConceptMapping = await db.query(`SELECT canonical_concept_id FROM objective_concept_mappings WHERE learning_objective_id = $1 AND status IN ('PUBLISHED','RETIRED') ORDER BY status LIMIT 1`, [objLinear]);
  const cambridgeConceptMapping = await db.query(`SELECT canonical_concept_id FROM objective_concept_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`, [objCambridgeLinear]);
  assert(paaConceptMapping.rows[0].canonical_concept_id === cambridgeConceptMapping.rows[0].canonical_concept_id, 'task 33-N: PAA and Cambridge objectives reference the exact SAME canonical concept id -- one knowledge identity');
  const paaExamDefRow = await db.query(`SELECT exam_family FROM exam_definitions WHERE id = $1`, [paaExamDefId]);
  const cambridgeExamDefRow = await db.query(`SELECT exam_family FROM exam_definitions WHERE id = $1`, [cambridgeExamDefId]);
  assert(paaExamDefRow.rows[0].exam_family !== cambridgeExamDefRow.rows[0].exam_family, 'task 33-N: PAA (ADMISSION_EXAM) and Cambridge (SUBJECT_ASSESSMENT) have genuinely DIFFERENT assessment configuration, despite sharing the same canonical concept');
  assert(conceptLinearId === paaConceptMapping.rows[0].canonical_concept_id, 'task 33-N: the shared canonical concept is exactly the one seeded, confirmed by direct id equality');

  console.log('\nAll F7 adversarial certification assertions passed against real PostgreSQL.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F7 lifecycle cert failed:', err);
    process.exit(1);
  });
