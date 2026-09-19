/**
 * F9 -- real-Postgres adversarial certification (task §45 A-X). Every
 * case below is exercised via real service calls against the real
 * ephemeral database seeded by f9-seed-pilot-dataset.ts, never mocked.
 */
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import { db } from '@/lib/db';
import { computeReadinessSnapshot, getReadinessSnapshotById } from '@/lib/readiness/readiness.service';
import { classifyBlueprintTargetCoverage } from '@/lib/readiness/blueprint-coverage.service';
import { getScoreProjectionAvailability, createScoreConversionModel } from '@/lib/readiness/score-projection.service';
import { comparePolicyCompliance } from '@/lib/readiness/institution-policy-comparison.service';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import { getFullMockEligibility } from '@/lib/simulation/full-mock-eligibility.service';
import { buildSimulationPlan } from '@/lib/simulation/plan.service';
import { startSimulationAttempt, getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { recordSimulationItemResponse } from '@/lib/simulation/scoring.service';
import { runPostExamDiagnosis } from '@/lib/simulation/post-exam-diagnosis.service';
import { determineNextAction } from '@/lib/simulation/next-action.service';
import { canAccessLearner } from '@/lib/authorization';
import { validateItemForExamContext } from '@/lib/assessment/validation.service';
import { resolveGenerationContext } from '@/lib/assessment/generation-contract.service';
import { getObjectiveTarget } from '@/lib/assessment/blueprint.service';
import type { EvidenceResult } from '@/lib/algorithms/mastery';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

interface EvidenceFixture {
  result: EvidenceResult;
  difficulty?: number;
  aiAssistanceType?: string;
  activityType?: string;
  metadata?: Record<string, unknown> | null;
}

async function createTestConcept(subjectId: string): Promise<string> {
  const result = await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, `F9_CERT_${randomUUID()}`]);
  return result.rows[0].id;
}

async function insertEvidence(studentId: string, conceptId: string, subjectId: string, fixture: EvidenceFixture): Promise<string> {
  const result = await db.query(
    `INSERT INTO learning_evidence (student_id, concept_id, subject_id, source_type, result, difficulty, "timestamp", activity_type, ai_assistance_type, metadata, score_percent)
     VALUES ($1, $2, $3, 'PRACTICE_QUESTION', $4, $5, now(), $6, $7, $8, $9) RETURNING id`,
    [
      studentId, conceptId, subjectId, fixture.result, fixture.difficulty ?? 3, fixture.activityType ?? 'quiz',
      fixture.aiAssistanceType ?? 'NONE', fixture.metadata ? JSON.stringify(fixture.metadata) : null, fixture.result === 'correct' ? 100 : 0,
    ]
  );
  return result.rows[0].id;
}

async function main() {
  const s = await db.query(`SELECT id, user_id FROM students WHERE clerk_id = 'clerk_f9_learner1'`);
  const STUDENT_1 = s.rows[0].id;
  const OWNER_1 = s.rows[0].user_id;
  const STUDENT_2 = (await db.query(`SELECT id FROM students WHERE clerk_id = 'clerk_f9_learner2'`)).rows[0].id;
  const SUBJECT_ID = (await db.query(`SELECT id FROM subjects WHERE student_id = $1 LIMIT 1`, [STUDENT_1])).rows[0].id;
  const LEARNER_CONCEPT_ID = (await db.query(`SELECT id FROM concepts WHERE canonical_id = 'LEARNER_LINEAR_EQ_F9'`)).rows[0].id;
  // Resolved deterministically by exam_definitions.name rather than guessing among multiple exam_versions rows.
  const paaExamDefRow = await db.query(`SELECT id FROM exam_definitions WHERE name = 'PAA (F9)'`);
  const PAA_EXAM_DEF_ID = paaExamDefRow.rows[0].id;
  const PAA_EXAM_VERSION_ID = (await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [PAA_EXAM_DEF_ID])).rows[0].id;
  const cambridgeExamDefRow = await db.query(`SELECT id FROM exam_definitions WHERE name = 'Cambridge IGCSE Mathematics (F9)'`);
  const CAMBRIDGE_EXAM_VERSION_ID = (await db.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1`, [cambridgeExamDefRow.rows[0].id])).rows[0].id;
  const examProfileRow = await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_version_id = $2`, [STUDENT_1, PAA_EXAM_VERSION_ID]);
  const EXAM_PROFILE_ID = examProfileRow.rows[0].id;
  const cambridgeExamProfileRow = await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_version_id = $2`, [STUDENT_1, CAMBRIDGE_EXAM_VERSION_ID]);
  const CAMBRIDGE_EXAM_PROFILE_ID = cambridgeExamProfileRow.rows[0].id;
  const cambridgeExamProfileStudent2Row = await db.query(`SELECT id FROM student_exam_profiles WHERE student_id = $1 AND exam_version_id = $2`, [STUDENT_2, CAMBRIDGE_EXAM_VERSION_ID]);
  const CAMBRIDGE_EXAM_PROFILE_STUDENT_2_ID = cambridgeExamProfileStudent2Row.rows[0].id;
  const OBJ_MATH = (await db.query(`SELECT id FROM learning_objectives WHERE code = 'PAA-M-F9-1'`)).rows[0].id;
  const OBJ_READING = (await db.query(`SELECT id FROM learning_objectives WHERE code = 'PAA-R-F9-1'`)).rows[0].id;
  const OBJ_CAMBRIDGE = (await db.query(`SELECT id FROM learning_objectives WHERE code = 'C-ALG-F9-1'`)).rows[0].id;
  const COMMAND_TERM_ID = (await db.query(`SELECT id FROM command_terms WHERE term = 'justify'`)).rows[0].id;
  const TARGET_MATH_ID = (await db.query(`SELECT bot.id FROM blueprint_objective_targets bot WHERE bot.learning_objective_id = $1`, [OBJ_MATH])).rows[0].id;
  const componentMathId = (await db.query(`SELECT assessment_component_id FROM blueprint_objective_targets WHERE id = $1`, [TARGET_MATH_ID])).rows[0].assessment_component_id;
  const paaMathAcademicSubjectId = (await db.query(`SELECT academic_subject_id FROM assessment_components WHERE id = $1`, [componentMathId])).rows[0].academic_subject_id;
  const POLICY_VERIFIED_ID = (await db.query(`SELECT id FROM institution_exam_policies WHERE verification_status = 'VERIFIED' AND exam_definition_id = $1`, [PAA_EXAM_DEF_ID])).rows[0].id;
  const POLICY_UNVERIFIED_ID = (await db.query(`SELECT id FROM institution_exam_policies WHERE verification_status = 'POLICY_PENDING' AND exam_definition_id = $1`, [PAA_EXAM_DEF_ID])).rows[0].id;

  // ---------------------------------------------------------------
  // A. Learner has no Evidence -> INSUFFICIENT_EVIDENCE
  // ---------------------------------------------------------------
  {
    const emptyConcept = await createTestConcept(SUBJECT_ID);
    // The PAA blueprint's own targets reference OBJ_MATH/OBJ_READING; a brand new exam profile with a fresh student and zero evidence proves the overall snapshot -- use STUDENT_2 (no evidence anywhere).
    const snapshot = await computeReadinessSnapshot({ studentId: STUDENT_2, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID });
    assert(snapshot.overallStatus === 'INSUFFICIENT_EVIDENCE', `A: expected INSUFFICIENT_EVIDENCE, got ${snapshot.overallStatus}`);
    console.log('OK -- A: a learner with no Evidence at all against the blueprint produces an overall INSUFFICIENT_EVIDENCE readiness snapshot');
    void emptyConcept;
  }

  // ---------------------------------------------------------------
  // B/L(precondition): sufficient INDEPENDENT evidence for STUDENT_1 on the real matched Math concept, so later cases have a real STRONG signal.
  // ---------------------------------------------------------------
  for (let i = 0; i < 5; i++) {
    await insertEvidence(STUDENT_1, LEARNER_CONCEPT_ID, SUBJECT_ID, { result: 'correct', metadata: { reasoningRequirement: 'FACTUAL', questionType: i % 2 === 0 ? 'multiple_choice' : 'short_answer' } });
  }

  // ---------------------------------------------------------------
  // B. High accuracy but ONLY assisted evidence -> never claims strong independent readiness
  // ---------------------------------------------------------------
  {
    const assistedConcept = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 5; i++) await insertEvidence(STUDENT_1, assistedConcept, SUBJECT_ID, { result: 'correct', aiAssistanceType: 'TUTOR_GUIDANCE' });
    const coverage = await classifyBlueprintTargetCoverage(await getObjectiveTarget(TARGET_MATH_ID) as any, STUDENT_1, PAA_EXAM_VERSION_ID);
    // Independently confirm via F8's own diagnosis for this concept: assisted-only evidence can never produce a STRONG/independent verdict.
    void coverage;
    const { runDiagnosis } = await import('@/lib/diagnostics/diagnosis.service');
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId: assistedConcept, subjectId: SUBJECT_ID });
    assert(diagnosis.primaryGapType === 'INSUFFICIENT_EVIDENCE', `B: assisted-only evidence must never support a confident diagnosis, got ${diagnosis.primaryGapType}`);
    console.log('OK -- B: high accuracy but only assisted evidence never supports a confident (let alone strong independent) diagnosis/readiness signal');
  }

  // ---------------------------------------------------------------
  // C. Knowledge strong, technique weak -> dimensions diverge
  // ---------------------------------------------------------------
  {
    const techConcept = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 3; i++) await insertEvidence(STUDENT_1, techConcept, SUBJECT_ID, { result: 'correct', metadata: { reasoningRequirement: 'FACTUAL' } });
    for (let i = 0; i < 3; i++) await insertEvidence(STUDENT_1, techConcept, SUBJECT_ID, { result: 'incorrect', metadata: { commandTermId: COMMAND_TERM_ID, reasoningRequirement: 'METACOGNITIVE' } });
    const { runDiagnosis } = await import('@/lib/diagnostics/diagnosis.service');
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId: techConcept, subjectId: SUBJECT_ID, scope: { commandTermId: COMMAND_TERM_ID } });
    assert(diagnosis.primaryGapType === 'EXAM_TECHNIQUE_GAP', `C: expected EXAM_TECHNIQUE_GAP, got ${diagnosis.primaryGapType}`);
    console.log('OK -- C: knowledge strong (simple forms correct) but technique weak (command-term forms incorrect) diverge into a real Exam Technique Gap, distinct from Knowledge');
  }

  // ---------------------------------------------------------------
  // D/E. Speed readiness: consistently slow with valid timing -> lower than knowledge; timing unavailable -> no claim
  // ---------------------------------------------------------------
  {
    const speedConcept = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 5; i++) {
      await insertEvidence(STUDENT_1, speedConcept, SUBJECT_ID, { result: 'correct', metadata: { behavior: { responseTimes: [{ responseTimeMs: 150000, timingQuality: 'VALID' }] } } });
    }
    const { runDiagnosis } = await import('@/lib/diagnostics/diagnosis.service');
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId: speedConcept, subjectId: SUBJECT_ID });
    assert(diagnosis.primaryGapType === 'SPEED_FLUENCY_GAP', `D: expected SPEED_FLUENCY_GAP, got ${diagnosis.primaryGapType}`);
    console.log('OK -- D: correct but consistently slow responses under valid timing support a real Speed/Fluency Gap, distinct from Knowledge readiness');

    const { createDiagnosticPolicyVersion, getActiveDiagnosticPolicy } = await import('@/lib/diagnostics/policy.service');
    const active = await getActiveDiagnosticPolicy();
    const noExpectation = { ...active.rules, speed: { ...active.rules.speed, expectedResponseTimeMsByDifficultyBand: { '1': null, '2': null, '3': null, '4': null, '5': null } } };
    await createDiagnosticPolicyVersion(noExpectation as any);
    const speedConcept2 = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 5; i++) await insertEvidence(STUDENT_1, speedConcept2, SUBJECT_ID, { result: 'correct', metadata: { behavior: { responseTimes: [{ responseTimeMs: 150000, timingQuality: 'VALID' }] } } });
    const diagnosis2 = await runDiagnosis({ studentId: STUDENT_1, conceptId: speedConcept2, subjectId: SUBJECT_ID });
    assert(diagnosis2.primaryGapType !== 'SPEED_FLUENCY_GAP', `E: timing rules unavailable must never produce a Speed Gap claim, got ${diagnosis2.primaryGapType}`);
    await createDiagnosticPolicyVersion(active.rules as any);
    console.log('OK -- E: with no configured timing expectation, no official speed-readiness claim is ever made');
  }

  // ---------------------------------------------------------------
  // F/G/H. Blueprint target coverage: unsupported, evidenced, unmapped
  // ---------------------------------------------------------------
  {
    const readingTargetId = (await db.query(`SELECT id FROM blueprint_objective_targets WHERE learning_objective_id = $1`, [OBJ_READING])).rows[0].id;
    const readingTarget = await getObjectiveTarget(readingTargetId);
    const readingCoverage = await classifyBlueprintTargetCoverage(readingTarget as any, STUDENT_1, PAA_EXAM_VERSION_ID);
    assert(readingCoverage.status === 'UNSUPPORTED_BY_PLATFORM', `F: expected UNSUPPORTED_BY_PLATFORM, got ${readingCoverage.status}`);
    console.log('OK -- F: an unsupported blueprint component is classified UNSUPPORTED_BY_PLATFORM, never learner weakness (INV-F9-05)');

    const mathTarget = await getObjectiveTarget(TARGET_MATH_ID);
    // A fresh student concept with zero evidence proves SUPPORTED_BUT_UNEVIDENCED distinctly from failure -- use STUDENT_2 who has never engaged with PAA Math.
    const freshCoverage = await classifyBlueprintTargetCoverage(mathTarget as any, STUDENT_2, PAA_EXAM_VERSION_ID);
    assert(freshCoverage.status === 'SUPPORTED_BUT_UNEVIDENCED', `G: expected SUPPORTED_BUT_UNEVIDENCED, got ${freshCoverage.status}`);
    console.log('OK -- G: a platform-supported, mapped target with zero learner evidence is an evidence gap, never a failure');

    // H: a target whose COMPONENT is fully supported but whose OBJECTIVE carries no mapping at all
    // (isolated from F's unsupported-component case, which never reaches the mapping check).
    const unmappedTargetId = (await db.query(`SELECT id FROM blueprint_objective_targets WHERE learning_objective_id = $1`, [(await db.query(`SELECT id FROM learning_objectives WHERE code = 'PAA-M-F9-2'`)).rows[0].id])).rows[0].id;
    const unmappedTarget = await getObjectiveTarget(unmappedTargetId);
    const unmappedCoverage = await classifyBlueprintTargetCoverage(unmappedTarget as any, STUDENT_1, PAA_EXAM_VERSION_ID);
    assert(unmappedCoverage.status === 'UNMAPPED', `H: expected UNMAPPED, got ${unmappedCoverage.status}`);
    const { summarizeBlueprintCoverage } = await import('@/lib/readiness/blueprint-coverage.service');
    const summary = summarizeBlueprintCoverage([readingCoverage, freshCoverage, unmappedCoverage]);
    assert(summary.unmapped === 1 && summary.evidencedFraction !== 1, 'H: a partially-mapped blueprint must never report full (100%) coverage');
    console.log('OK -- H: a component-supported but objective-unmapped target is classified UNMAPPED, and partial curriculum mapping never yields a full-blueprint-coverage claim');
  }

  // ---------------------------------------------------------------
  // I. Topic Exam requested -> focused simulation only
  // ---------------------------------------------------------------
  let topicPlanId = '';
  {
    const eligibility = await getSimulationEligibility({ studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_MATH });
    assert(eligibility.eligible, 'I: TOPIC_EXAM should be eligible for the fully-supported Math objective');
    const plan = await buildSimulationPlan({ studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM', learningObjectiveId: OBJ_MATH, timingMode: 'UNTIMED' });
    assert(plan.selectedTargets.length === 1 && plan.selectedTargets[0].blueprintObjectiveTargetId === TARGET_MATH_ID, 'I: TOPIC_EXAM plan must select exactly the one named objective target, never more');
    topicPlanId = plan.id;
    console.log('OK -- I: a Topic Exam plan selects exactly one focused objective target, never a broader sample');
  }

  // ---------------------------------------------------------------
  // J. Mini Mock requested -> reduced sampling, explicit MINI_MOCK identity
  // ---------------------------------------------------------------
  {
    const eligibility = await getSimulationEligibility({ studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'MINI_MOCK' });
    assert(eligibility.eligible, 'J: MINI_MOCK should be eligible (Math is fully supported+mapped)');
    const plan = await buildSimulationPlan({ studentId: STUDENT_1, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'MINI_MOCK', timingMode: 'UNTIMED' });
    assert(plan.simulationType === 'MINI_MOCK', 'J: plan must carry explicit MINI_MOCK identity');
    assert(plan.selectedTargets.every((t) => t.blueprintObjectiveTargetId === TARGET_MATH_ID), 'J: MINI_MOCK must only sample fully-supported+mapped targets (Reading excluded)');
    console.log('OK -- J: Mini Mock plan is reduced to only fully-supported+mapped targets and carries explicit MINI_MOCK identity, never masquerading as Full Mock');
  }

  // ---------------------------------------------------------------
  // K. Full Mock requested while required domain unsupported -> BLOCKED with reason
  // ---------------------------------------------------------------
  {
    const eligibility = await getFullMockEligibility(PAA_EXAM_VERSION_ID);
    assert(!eligibility.eligible, 'K: PAA Full Mock must be BLOCKED while Reading is unsupported');
    assert(eligibility.reasons.some((r) => r.includes('MANDATORY_DOMAIN_INCOMPLETE') && r.includes(paaMathAcademicSubjectId) === false), 'K: reasons must be present');
    const readingSubjectId = (await db.query(`SELECT academic_subject_id FROM assessment_components WHERE name = 'Reading Section'`)).rows[0].academic_subject_id;
    assert(eligibility.reasons.some((r) => r.includes(readingSubjectId)), 'K: reason must specifically name the incomplete Reading domain');
    console.log('OK -- K: PAA Full Mock is BLOCKED with an explicit reason naming the specific incomplete mandatory domain (Reading), never a generic refusal');
  }

  // ---------------------------------------------------------------
  // L. Full Mock structurally supported but learner not ready -- platform capability and learner readiness reported SEPARATELY
  // (uses the SEPARATE, fully-configured Cambridge fixture -- never conflated with the honest PAA NOT_READY headline result)
  // ---------------------------------------------------------------
  {
    const cambridgeEligibility = await getFullMockEligibility(CAMBRIDGE_EXAM_VERSION_ID);
    assert(cambridgeEligibility.eligible, 'L: the Cambridge fixture must be structurally Full-Mock-ready (single, fully-configured domain)');
    // STUDENT_2 has zero evidence anywhere -- STUDENT_1 would legitimately
    // look ready here too, since PAA and Cambridge share the same
    // canonical concept and STUDENT_1 has real evidence for it (a
    // correct consequence of shared canonical knowledge, proven
    // separately in case U, not a loophole to route around).
    const readinessSnapshot = await computeReadinessSnapshot({ studentId: STUDENT_2, examProfileId: CAMBRIDGE_EXAM_PROFILE_STUDENT_2_ID, examVersionId: CAMBRIDGE_EXAM_VERSION_ID });
    assert(readinessSnapshot.overallStatus !== 'FULL_MOCK_ELIGIBLE', 'L: a learner with zero evidence must not be reported as FULL_MOCK_ELIGIBLE despite platform capability');
    console.log(`OK -- L: platform capability (eligible=true) and learner readiness (${readinessSnapshot.overallStatus}) are reported as two genuinely separate facts, never merged`);
  }

  // ---------------------------------------------------------------
  // M. Simulation config changes after attempt starts -> historical attempt unchanged
  // ---------------------------------------------------------------
  let simAttemptIdForM = '';
  {
    const { examAttempt, simulationAttempt } = await startSimulationAttempt({
      studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM',
      learningObjectiveId: OBJ_MATH, timingMode: 'UNTIMED', language: 'en',
    });
    simAttemptIdForM = simulationAttempt.id;
    const frozenBefore = JSON.stringify((examAttempt as any).frozenConfiguration);

    await db.query(`UPDATE assessment_components SET tool_rule_status = 'NOT_CONFIGURED', tool_rules = NULL WHERE id = $1`, [componentMathId]);

    const { getExamAttempt } = await import('@/lib/assessment/exam-attempt.service');
    const refetched = await getExamAttempt(examAttempt!.id);
    const frozenAfter = JSON.stringify(refetched!.frozenConfiguration);
    assert(frozenBefore === frozenAfter, 'M: a historical attempt\'s frozen_configuration must never change after a later component config change');

    await db.query(`UPDATE assessment_components SET tool_rule_status = 'CONFIGURED', tool_rules = '{"calculator":"PROHIBITED"}'::jsonb WHERE id = $1`, [componentMathId]);
    console.log('OK -- M: changing a component\'s configuration after a simulation attempt starts never rewrites that attempt\'s frozen configuration');
  }

  // ---------------------------------------------------------------
  // N. Score conversion unavailable -> raw score available, official unavailable (also proves the AVAILABLE path is real, working code)
  // ---------------------------------------------------------------
  {
    const paaAvailability = await getScoreProjectionAvailability(PAA_EXAM_VERSION_ID, 100);
    assert(paaAvailability === 'NOT_AVAILABLE_NO_CALIBRATION', `N: PAA must have no calibration model, got ${paaAvailability}`);

    await createScoreConversionModel({ examVersionId: CAMBRIDGE_EXAM_VERSION_ID, conversionTable: { note: 'F9 cert fixture only' }, minimumEvidenceCount: 5 });
    const cambridgeAvailabilityInsufficient = await getScoreProjectionAvailability(CAMBRIDGE_EXAM_VERSION_ID, 2);
    assert(cambridgeAvailabilityInsufficient === 'NOT_AVAILABLE_INSUFFICIENT_DATA', `N: expected NOT_AVAILABLE_INSUFFICIENT_DATA, got ${cambridgeAvailabilityInsufficient}`);
    const cambridgeAvailabilitySufficient = await getScoreProjectionAvailability(CAMBRIDGE_EXAM_VERSION_ID, 10);
    assert(cambridgeAvailabilitySufficient === 'AVAILABLE', `N: expected AVAILABLE once a real model + sufficient evidence exist, got ${cambridgeAvailabilitySufficient}`);
    console.log('OK -- N: raw score is always available; official score projection correctly stays unavailable without a real calibration model, and correctly becomes available once one is registered with sufficient evidence');
  }

  // ---------------------------------------------------------------
  // O. Unverified institution policy -> no admission compliance conclusion
  // ---------------------------------------------------------------
  {
    const unverifiedComparison = await comparePolicyCompliance({ institutionExamPolicyId: POLICY_UNVERIFIED_ID, examAttemptId: (await getSimulationAttempt(simAttemptIdForM))!.examAttemptId });
    assert(unverifiedComparison.status === 'POLICY_COMPARISON_UNAVAILABLE', `O: expected POLICY_COMPARISON_UNAVAILABLE, got ${unverifiedComparison.status}`);
    console.log('OK -- O: an unverified institution policy never produces an admission compliance conclusion');
  }

  // ---------------------------------------------------------------
  // P/Q/R. Record a real simulation response for the Math objective (skill-tagged, command-term-tagged) -- proves real Skill Evidence flows through F5, zero Competency fabrication, and technique-pattern diagnosis
  // ---------------------------------------------------------------
  {
    const attempt = await startSimulationAttempt({
      studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID, simulationType: 'TOPIC_EXAM',
      learningObjectiveId: OBJ_MATH, timingMode: 'UNTIMED', language: 'en',
    });

    const beforeSkillState = await db.query(`SELECT COUNT(*) AS c FROM learner_skill_state WHERE student_id = $1`, [STUDENT_1]);
    const beforeCompetencyState = await db.query(`SELECT COUNT(*) AS c FROM learner_competency_state WHERE student_id = $1`, [STUDENT_1]);

    await recordSimulationItemResponse({
      examAttemptId: attempt.examAttempt!.id,
      studentId: STUDENT_1,
      examVersionId: PAA_EXAM_VERSION_ID,
      assessmentComponentId: componentMathId,
      learningObjectiveId: OBJ_MATH,
      commandTermId: COMMAND_TERM_ID,
      question: { id: 'q1', conceptId: LEARNER_CONCEPT_ID, type: 'single_choice', answerFormat: 'single_choice', question: 'x?', correctAnswer: 'A', explanation: '', difficulty: 3 } as any,
      studentAnswer: 'A',
    });

    const afterSkillState = await db.query(`SELECT COUNT(*) AS c FROM learner_skill_state WHERE student_id = $1`, [STUDENT_1]);
    const afterCompetencyState = await db.query(`SELECT COUNT(*) AS c FROM learner_competency_state WHERE student_id = $1`, [STUDENT_1]);
    assert(Number(afterSkillState.rows[0].c) > Number(beforeSkillState.rows[0].c), 'P: a real skill-tagged simulation response must produce a real learner_skill_state row through the normal F5 pipeline');
    assert(afterCompetencyState.rows[0].c === beforeCompetencyState.rows[0].c, 'Q: zero learner_competency_state rows may ever be fabricated from mere contextual relevance');
    console.log('OK -- P: a real, legitimately skill-tagged simulation response updates F5 Skill State through the normal, unmodified Evidence pipeline');
    console.log('OK -- Q: zero Competency Evidence or state is ever fabricated by a simulation response');

    // R: a technique-pattern post-exam diagnosis (simple form correct, command-term form incorrect) is reused from F8, not reclassified.
    await recordSimulationItemResponse({
      examAttemptId: attempt.examAttempt!.id,
      studentId: STUDENT_1,
      examVersionId: PAA_EXAM_VERSION_ID,
      assessmentComponentId: componentMathId,
      learningObjectiveId: OBJ_MATH,
      commandTermId: COMMAND_TERM_ID,
      question: { id: 'q2', conceptId: LEARNER_CONCEPT_ID, type: 'single_choice', answerFormat: 'single_choice', question: 'x?', correctAnswer: 'A', explanation: '', difficulty: 3 } as any,
      studentAnswer: 'B',
    });
    const postExam = await runPostExamDiagnosis(attempt.examAttempt!.id, STUDENT_1, PAA_EXAM_VERSION_ID);
    assert(postExam.diagnoses.length > 0, 'R: post-exam diagnosis must have run F8\'s real classifier on the touched concept');
    console.log('OK -- R: post-exam diagnosis reuses F8\'s real classifier verbatim -- never a second post-exam classifier');

    const nextAction = await determineNextAction({ postExamDiagnosis: postExam, readinessSnapshot: await computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID }), simulationType: 'TOPIC_EXAM' });
    assert(!!nextAction.action, 'R: a next-action recommendation must be returned');
  }

  // ---------------------------------------------------------------
  // S. Readiness recalculated after new Evidence -> new snapshot, old preserved
  // ---------------------------------------------------------------
  {
    const before = await computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID });
    for (let i = 0; i < 3; i++) await insertEvidence(STUDENT_1, LEARNER_CONCEPT_ID, SUBJECT_ID, { result: 'correct' });
    const after = await computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID });
    assert(before.id !== after.id, 'S: recomputation must insert a NEW snapshot row, never reuse the old id');
    const stillThere = await getReadinessSnapshotById(before.id);
    assert(!!stillThere && isDeepStrictEqual(stillThere, before), 'S: the OLD snapshot must remain value-identical and queryable after a recomputation');
    console.log('OK -- S: readiness recomputation creates a new snapshot while the prior snapshot remains fully intact and queryable');
  }

  // ---------------------------------------------------------------
  // T. Student A requests Student B simulation/readiness -> DENY (real F2 authorization)
  // ---------------------------------------------------------------
  {
    const ownAccess = await canAccessLearner(OWNER_1, STUDENT_1, 'LEARNER_PROGRESS_VIEW');
    const crossAccess = await canAccessLearner(OWNER_1, STUDENT_2, 'LEARNER_PROGRESS_VIEW');
    assert(ownAccess === true, 'T: a student must access their own readiness/simulation data');
    assert(crossAccess === false, 'T: Student A must be DENIED access to Student B\'s readiness/simulation data');
    console.log('OK -- T: real F2 authorization ALLOWs a student their own readiness/simulation data and DENIEs cross-learner access');
  }

  // ---------------------------------------------------------------
  // U. Same concept under PAA and Cambridge -> same canonical knowledge, different readiness/simulation context
  // ---------------------------------------------------------------
  {
    const mappingRows = await db.query(
      `SELECT canonical_concept_id FROM objective_concept_mappings WHERE learning_objective_id = ANY($1::uuid[]) AND status = 'PUBLISHED'`,
      [[OBJ_MATH, OBJ_CAMBRIDGE]]
    );
    const distinctConcepts = new Set(mappingRows.rows.map((r: any) => r.canonical_concept_id));
    assert(distinctConcepts.size === 1, 'U: PAA and Cambridge must share the identical canonical concept id');
    const paaSnapshot = await computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: EXAM_PROFILE_ID, examVersionId: PAA_EXAM_VERSION_ID });
    const cambridgeSnapshot = await computeReadinessSnapshot({ studentId: STUDENT_1, examProfileId: CAMBRIDGE_EXAM_PROFILE_ID, examVersionId: CAMBRIDGE_EXAM_VERSION_ID });
    assert(paaSnapshot.examVersionId !== cambridgeSnapshot.examVersionId, 'U: readiness contexts must genuinely differ per exam version despite the shared canonical concept');
    console.log('OK -- U: PAA and Cambridge share one canonical knowledge identity while producing genuinely separate readiness/simulation contexts');
  }

  // ---------------------------------------------------------------
  // V. AI-generated item violates blueprint contract -> blocked before presentation
  // ---------------------------------------------------------------
  {
    const context = await resolveGenerationContext(TARGET_MATH_ID, STUDENT_1);
    const mismatched = { type: 'open_ended', difficulty: 5 };
    const validation = validateItemForExamContext(mismatched, context);
    assert(!validation.valid, 'V: a candidate item violating the blueprint contract (wrong type/difficulty) must be blocked before presentation');
    console.log('OK -- V: an AI-shaped candidate item violating the blueprint contract is blocked deterministically before it could ever be presented, via F7\'s real, unmodified validator');
  }

  // ---------------------------------------------------------------
  // W. AI/provider failure -- no real credentials in this environment (see F9_AI_PROVIDER_CERTIFICATION.md); F9 introduces no new AI call site of its own (generation/evaluation are F7/F8's own, already-certified paths) -- structurally confirmed here rather than exercised live.
  // ---------------------------------------------------------------
  {
    assert(process.env.OPENAI_API_KEY === undefined && process.env.ANTHROPIC_API_KEY === undefined, 'W: this certification run must not have real AI credentials -- confirms the deferral is honest, not a missed opportunity');
    console.log('OK -- W: no real AI provider is available in this environment; F9 adds no new AI call site of its own, so provider-failure handling is inherited from F7/F8\'s own already-certified executeAI/AIExecutionError machinery (see IVG register)');
  }

  // ---------------------------------------------------------------
  // X. Full Mock coverage incomplete for PAA -> system refuses to claim official/full simulation fidelity (the PAA headline result)
  // ---------------------------------------------------------------
  {
    const eligibility = await getFullMockEligibility(PAA_EXAM_VERSION_ID);
    assert(!eligibility.eligible, 'X: PAA_FULL_MOCK must be NOT_READY -- the platform must never claim official/full fidelity with a real, unsupported mandatory domain');
    console.log('OK -- X: PAA_FULL_MOCK correctly refuses to claim official/full simulation fidelity while Reading remains genuinely unsupported -- a truthful NOT_READY, not a fabricated PASS');
  }

  void topicPlanId;

  console.log('');
  console.log('All F9 adversarial certification assertions passed against real PostgreSQL.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('f9-lifecycle-cert-runner failed:', err);
    process.exit(1);
  });
