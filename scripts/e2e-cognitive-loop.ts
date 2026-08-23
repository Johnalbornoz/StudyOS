/**
 * Phase 2 (Cognitive Learning Engine) deterministic E2E scenario.
 *
 * Runs the full loop directly against the real database (not mocked),
 * calling the actual service functions in the same order the real API
 * routes do -- issue detection -> root cause hypothesis -> diagnostic
 * check -> confirm -> remediation (LEARN -> GUIDED_PRACTICE ->
 * SOLO_VERIFY) -> resolved -> Explain & Defend -> Transfer -> recurring
 * misconception -> NBA v2 recalculation -- plus the mandatory rejection
 * variant, where the first hypothesis is diagnostically REJECTED and
 * the engine must move to the next one.
 *
 * Uses isolated __SCRATCH_e2e_*-tagged data only, cleaned up
 * unconditionally in a finally block. Explain/Transfer generation and
 * grading make real calls to the configured LLM.
 *
 * Run with: npm run test:e2e
 * (equivalent to: npx tsx --env-file=.env.local scripts/e2e-cognitive-loop.ts)
 */

import { db } from '@/lib/db';
import { updateMastery } from '@/services/mastery.service';
import { getLearnerConceptState } from '@/services/learner-model.service';
import { getConceptKnowledgeState } from '@/services/knowledge-state.service';
import {
  detectCognitiveIssue,
  generateRootCauseHypotheses,
  resolveDiagnosticCheck,
  getActiveDiagnoses,
  getDiagnosis,
} from '@/services/cognitive-diagnosis.service';
import { startRemediation, completeRemediationStep, getRemediationPath, getActiveRemediations } from '@/services/remediation.service';
import { generateExplainPrompt, evaluateExplanation, rubricScorePercent } from '@/services/explain-defend.service';
import { generateTransferActivity, evaluateTransferResponse, getTransferScore } from '@/services/transfer.service';
import { getOrCreateSignature, recordStudentMisconception, getRecurringMisconceptions } from '@/services/misconception.service';
import { getTodayPlan, getBestNextAction } from '@/services/today-plan.service';

let passCount = 0;
let failCount = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passCount++;
    console.log(`  ok ${msg}`);
  } else {
    failCount++;
    console.log(`  FAIL ${msg}`);
  }
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const RUN_ID = Date.now();
const SCRATCH_PREFIX = '__SCRATCH_e2e_';

async function makeScratchStudent(tag: string): Promise<string> {
  const clerkId = `${SCRATCH_PREFIX}${tag}_${RUN_ID}`;
  const inserted = await db.query(
    `INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, $3) RETURNING id`,
    [clerkId, `${clerkId}@scratch.local`, `Scratch E2E (${tag})`]
  );
  const studentId = inserted.rows[0].id;
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', $2)`, [studentId, `Scratch E2E (${tag})`]);
  await db.query(`INSERT INTO student_profiles (id) VALUES ($1)`, [studentId]);
  return studentId;
}

async function makeScratchSubject(studentId: string, name: string): Promise<string> {
  const result = await db.query(
    `INSERT INTO subjects (student_id, name, status, target_language, quiz_language_mode, ib_programme, ib_subject_group, ib_level)
     VALUES ($1, $2, 'active', 'en', 'match_interface', 'DP', 'group-4-sciences', 'HL') RETURNING id`,
    [studentId, name]
  );
  return result.rows[0].id;
}

async function makeScratchConcept(subjectId: string, canonicalId: string, label: string): Promise<string> {
  const result = await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, canonicalId]);
  const conceptId = result.rows[0].id;
  await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'en', $2)`, [conceptId, label]);
  return conceptId;
}

async function linkPrerequisite(prerequisiteConceptId: string, dependentConceptId: string, confidence: number) {
  await db.query(
    `INSERT INTO concept_relationships (source_concept_id, target_concept_id, relationship_type, confidence, source, status)
     VALUES ($1, $2, 'PREREQUISITE_OF', $3, 'MANUAL', 'active')`,
    [prerequisiteConceptId, dependentConceptId, confidence]
  );
}

async function giveWeakEvidence(studentId: string, conceptId: string, subjectId: string, scores: number[]) {
  for (const scorePercent of scores) {
    await updateMastery({
      studentId,
      conceptId,
      subjectId,
      evidence: {
        result: scorePercent >= 70 ? 'correct' : scorePercent >= 50 ? 'partial' : 'incorrect',
        difficulty: 3,
        sourceType: 'PRACTICE_QUIZ',
        confidenceWeight: 0.9,
        scorePercent,
        sampleSize: 4,
      },
      telemetry: { activityType: 'quiz', learningMode: 'COACH', hintsUsed: 0 },
    });
  }
}

async function seedErrors(studentId: string, conceptId: string, subjectId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await db.query(
      `INSERT INTO errors (student_id, concept_id, subject_id, error_type, source_type) VALUES ($1, $2, $3, 'CONCEPTUAL', 'quiz')`,
      [studentId, conceptId, subjectId]
    );
  }
}

/**
 * SCENARIO A -- the mandatory CONFIRM flow: a student struggling with
 * Centripetal Force (repeated conceptual errors) whose true root cause
 * is a weak understanding of Vector Direction.
 */
async function scenarioConfirm() {
  section('SCENARIO A: Confirm flow (Vector Direction -> Centripetal Force)');
  const studentId = await makeScratchStudent('confirm');
  const subjectId = await makeScratchSubject(studentId, 'Physics HL (SCRATCH E2E)');
  const candidateId = await makeScratchConcept(subjectId, `vector_direction_${RUN_ID}`, 'Vector Direction');
  const targetId = await makeScratchConcept(subjectId, `centripetal_force_${RUN_ID}`, 'Centripetal Force');
  await linkPrerequisite(candidateId, targetId, 0.85);

  await giveWeakEvidence(studentId, candidateId, subjectId, [30, 25, 35]);
  const candidateState = await getLearnerConceptState(studentId, candidateId);
  assert(candidateState !== null && candidateState.masteryScore < 50, 'candidate (Vector Direction) mastery is genuinely low after seeded weak evidence');

  await seedErrors(studentId, targetId, subjectId, 3);

  const issue = await detectCognitiveIssue(studentId, targetId);
  assert(issue.justified, 'detectCognitiveIssue: justified=true from repeated conceptual errors on the target concept');
  assert(issue.reasons.includes('repeated_conceptual_error'), 'detectCognitiveIssue: reason includes repeated_conceptual_error');

  const hypotheses = await generateRootCauseHypotheses(studentId, subjectId, targetId, 'en');
  assert(hypotheses.length === 1, `generateRootCauseHypotheses returns exactly the one seeded prerequisite (got ${hypotheses.length})`);
  const hyp = hypotheses[0];
  assert(hyp?.candidateConceptId === candidateId, 'top hypothesis candidate is Vector Direction');
  assert(hyp?.state === 'LIKELY' || hyp?.state === 'SUSPECTED', `hypothesis state is a real hypothesis, not DIAGNOSIS_REQUIRED (got ${hyp?.state})`);
  const diagnosisId = hyp!.diagnosisId;

  const planBeforeConfirm = await getTodayPlan(studentId, 'en');
  const beforeItems = [...planBeforeConfirm.critical, ...planBeforeConfirm.thisWeek, ...planBeforeConfirm.canWait];
  assert(!beforeItems.some((i) => i.reason === 'prerequisite_gap'), 'Today: no prerequisite_gap item before the diagnosis is CONFIRMED');

  await updateMastery({
    studentId,
    conceptId: candidateId,
    subjectId,
    evidence: { result: 'incorrect', difficulty: 3, sourceType: 'DIAGNOSTIC', confidenceWeight: 0.9, scorePercent: 33, sampleSize: 3 },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0 },
  });
  const resolved = await resolveDiagnosticCheck(diagnosisId, 1, 3);
  assert(resolved?.outcome === 'CONFIRMED', `Diagnostic Check (1/3 correct): outcome is CONFIRMED (got ${resolved?.outcome})`);
  assert(resolved?.diagnosis.state === 'CONFIRMED', 'diagnosis.state is CONFIRMED after resolution');

  const activeDiagnoses = await getActiveDiagnoses(studentId);
  assert(
    activeDiagnoses.some((d) => d.id === diagnosisId && d.state === 'CONFIRMED'),
    'getActiveDiagnoses surfaces the CONFIRMED diagnosis (Improve v2 Foundational gaps source)'
  );

  const planAfterConfirm = await getTodayPlan(studentId, 'en');
  const afterConfirmItems = [...planAfterConfirm.critical, ...planAfterConfirm.thisWeek, ...planAfterConfirm.canWait];
  const gapItem = afterConfirmItems.find((i) => i.reason === 'prerequisite_gap' && i.conceptId === candidateId);
  assert(!!gapItem, 'Today: prerequisite_gap item now appears for Vector Direction after CONFIRMED');
  assert(gapItem?.urgencyTier === 'critical', 'prerequisite_gap item is tagged critical');

  const path = await startRemediation(diagnosisId);
  assert(path.state === 'REPAIRING', `remediation path starts in REPAIRING (got ${path.state})`);
  assert(path.pattern === 'LOW_MASTERY', `pattern is LOW_MASTERY given the candidate's weak evidence (got ${path.pattern})`);
  assert(
    path.steps.map((s) => s.stepType).join(',') === 'LEARN,GUIDED_PRACTICE,SOLO_VERIFY',
    `LOW_MASTERY pattern produces LEARN -> GUIDED_PRACTICE -> SOLO_VERIFY (got ${path.steps.map((s) => s.stepType).join(',')})`
  );

  const pathAgain = await startRemediation(diagnosisId);
  assert(pathAgain.id === path.id, 'calling startRemediation again for the same CONFIRMED diagnosis is idempotent (no duplicate path)');

  const planDuringRepair = await getTodayPlan(studentId, 'en');
  const duringItems = [...planDuringRepair.critical, ...planDuringRepair.thisWeek, ...planDuringRepair.canWait];
  assert(
    duringItems.some((i) => i.reason === 'active_remediation' && i.remediationPathId === path.id),
    'Today: active_remediation item appears once remediation has started'
  );
  const bna = await getBestNextAction(studentId, 'en');
  assert(bna?.item.reason === 'active_remediation', `Best Next Action is the active remediation (got ${bna?.item.reason})`);

  for (const step of path.steps) {
    const scorePercent = 85;
    const sourceType = step.stepType === 'SOLO_VERIFY' ? 'CUMULATIVE_ASSESSMENT' : 'PRACTICE_QUIZ';
    await updateMastery({
      studentId,
      conceptId: step.conceptId,
      subjectId,
      evidence: { result: 'correct', difficulty: 3, sourceType, confidenceWeight: 0.9, scorePercent, sampleSize: 4 },
      telemetry: { activityType: 'quiz', learningMode: step.stepType === 'SOLO_VERIFY' ? 'SOLO' : 'COACH', hintsUsed: 0 },
    });
    await completeRemediationStep(step.id, { success: true, score: scorePercent });
  }

  const finalPath = await getRemediationPath(path.id);
  assert(finalPath?.state === 'RESOLVED', `remediation path is RESOLVED after all steps complete (got ${finalPath?.state})`);
  assert(finalPath?.steps.every((s) => s.status === 'completed') ?? false, 'all remediation steps are marked completed');

  const planAfterResolve = await getTodayPlan(studentId, 'en');
  const afterResolveItems = [...planAfterResolve.critical, ...planAfterResolve.thisWeek, ...planAfterResolve.canWait];
  assert(
    !afterResolveItems.some((i) => (i.reason === 'active_remediation' || i.reason === 'prerequisite_gap') && i.conceptId === candidateId),
    'Today: no more active_remediation/prerequisite_gap item for Vector Direction once resolved'
  );
  const activeRemediationsAfter = await getActiveRemediations(studentId);
  assert(!activeRemediationsAfter.some((p) => p.id === path.id), 'getActiveRemediations no longer lists the resolved path');

  const explainPrompt = await generateExplainPrompt(studentId, subjectId, targetId, 'Centripetal Force', 'EXPLAIN', 'en');
  assert(!!explainPrompt.prompt, 'generateExplainPrompt produced a prompt');
  const rubric = await evaluateExplanation(
    'Centripetal Force',
    explainPrompt.prompt,
    explainPrompt.expectedElements,
    "Centripetal force is the net force directed toward the center of a circular path that keeps an object moving in that circle; without it, the object would move off in a straight line per Newton's first law.",
    'en'
  );
  const explainScore = rubricScorePercent(rubric);
  assert(explainScore >= 0 && explainScore <= 100, `rubricScorePercent returns a 0-100 value (got ${explainScore})`);
  await updateMastery({
    studentId,
    conceptId: targetId,
    subjectId,
    evidence: {
      result: explainScore >= 70 ? 'correct' : explainScore >= 40 ? 'partial' : 'incorrect',
      difficulty: 3,
      sourceType: 'EXPLANATION',
      confidenceWeight: 0.85,
      scorePercent: explainScore,
      sampleSize: 1,
    },
    telemetry: { activityType: 'explain_defend', learningMode: 'COACH' },
  });

  const transferActivity = await generateTransferActivity('Centripetal Force', 'circular motion problems with a string and a ball', 'NEAR', 'en');
  assert(!!transferActivity.prompt, 'generateTransferActivity produced a prompt');
  const transferGraded = await evaluateTransferResponse(
    'Centripetal Force',
    transferActivity.prompt,
    'The centripetal force still points toward the center of the new circular path, provided by whatever supplies the inward pull in this context.',
    'en'
  );
  assert(['correct', 'partial', 'incorrect'].includes(transferGraded.result), 'evaluateTransferResponse returns a valid result');
  const transferScorePercent = transferGraded.result === 'correct' ? 100 : transferGraded.result === 'partial' ? 50 : 0;
  await updateMastery({
    studentId,
    conceptId: targetId,
    subjectId,
    evidence: { result: transferGraded.result, difficulty: 3, sourceType: 'TRANSFER', confidenceWeight: 0.85, scorePercent: transferScorePercent, sampleSize: 1 },
    telemetry: { activityType: 'transfer', learningMode: 'SOLO' },
  });
  await db.query(
    `UPDATE learning_evidence SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
     WHERE id = (SELECT id FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND source_type = 'TRANSFER' ORDER BY timestamp DESC LIMIT 1)`,
    [studentId, targetId, JSON.stringify({ transferDistance: 'NEAR', assisted: false })]
  );

  const transferScore = await getTransferScore(studentId, targetId);
  assert(transferScore !== null, 'getTransferScore returns a real value after a TRANSFER evidence event (never fabricated 0)');

  const signature = await getOrCreateSignature(targetId, 'e2e_scratch_misconception', 'Confuses centripetal force with an outward "centrifugal" force');
  await recordStudentMisconception(studentId, signature.id, { source: 'e2e_script' });
  await recordStudentMisconception(studentId, signature.id, { source: 'e2e_script' });
  const recurring = await getRecurringMisconceptions(studentId);
  assert(
    recurring.some((m) => m.signatureId === signature.id && m.occurrenceCount >= 2),
    'getRecurringMisconceptions surfaces the misconception once occurrence_count >= 2'
  );

  const finalTargetState = await getLearnerConceptState(studentId, targetId);
  assert(finalTargetState !== null, 'target concept has a real Learner Model state after Explain/Transfer evidence');
  const finalPlan = await getTodayPlan(studentId, 'en');
  const finalItems = [...finalPlan.critical, ...finalPlan.thisWeek, ...finalPlan.canWait];
  assert(
    finalItems.some((i) => i.reason === 'recurring_misconception' && i.conceptId === targetId),
    'Today/NBA v2 surfaces the recurring misconception on the target concept as the final state'
  );

  // Phase 2.2A: Knowledge State was projected automatically by every
  // updateMastery call above (LEARN/GUIDED_PRACTICE/SOLO_VERIFY/EXPLANATION/
  // TRANSFER evidence) -- confirm it actually persisted, not just that the
  // wiring compiles.
  const candidateKnowledgeState = await getConceptKnowledgeState(studentId, candidateId);
  assert(candidateKnowledgeState !== null, 'Phase 2.2A: concept_knowledge_state has a real row for the remediated candidate concept');
  assert(
    candidateKnowledgeState !== null && candidateKnowledgeState.evidenceCount > 0,
    `Phase 2.2A: evidenceCount is a real positive number, not fabricated (got ${candidateKnowledgeState?.evidenceCount})`
  );
  assert(
    candidateKnowledgeState !== null && candidateKnowledgeState.masteryState !== 'UNKNOWN',
    `Phase 2.2A: mastery_state reflects real evidence, not the empty-evidence default (got ${candidateKnowledgeState?.masteryState})`
  );
  assert(
    candidateKnowledgeState !== null && candidateKnowledgeState.stateReason !== null,
    'Phase 2.2A: state_reason is persisted and explainable, not null'
  );
  const targetKnowledgeState = await getConceptKnowledgeState(studentId, targetId);
  assert(
    targetKnowledgeState !== null && targetKnowledgeState.transferScore !== null,
    'Phase 2.2A: transferScore on the target concept is a real reused value from Phase 2 Transfer evidence, not null/fabricated'
  );

  return { studentId, subjectId };
}

/**
 * SCENARIO B -- the mandatory REJECTION variant: the first hypothesis
 * is diagnostically tested and REJECTED, so the engine must move to
 * the next-ranked hypothesis instead of stopping.
 */
async function scenarioRejection() {
  section('SCENARIO B: Rejection flow (engine moves to the next hypothesis)');
  const studentId = await makeScratchStudent('rejection');
  const subjectId = await makeScratchSubject(studentId, 'Physics HL (SCRATCH E2E, rejection)');
  const candidateA = await makeScratchConcept(subjectId, `basic_trig_${RUN_ID}`, 'Basic Trigonometry');
  const candidateB = await makeScratchConcept(subjectId, `vector_direction_b_${RUN_ID}`, 'Vector Direction');
  const targetId = await makeScratchConcept(subjectId, `centripetal_force_b_${RUN_ID}`, 'Centripetal Force');
  await linkPrerequisite(candidateA, targetId, 0.9);
  await linkPrerequisite(candidateB, targetId, 0.7);

  await giveWeakEvidence(studentId, candidateA, subjectId, [40, 35]);
  await giveWeakEvidence(studentId, candidateB, subjectId, [30, 25]);
  await seedErrors(studentId, targetId, subjectId, 3);

  const hypotheses = await generateRootCauseHypotheses(studentId, subjectId, targetId, 'en');
  assert(hypotheses.length === 2, `both prerequisites become hypotheses (got ${hypotheses.length})`);
  assert(hypotheses[0].candidateConceptId === candidateA, 'hypotheses are ranked by score, highest-confidence edge first (Basic Trigonometry)');

  const rejectedResult = await resolveDiagnosticCheck(hypotheses[0].diagnosisId, 3, 3);
  assert(rejectedResult?.outcome === 'REJECTED', `Diagnostic Check (3/3 correct) on hypothesis A: outcome is REJECTED (got ${rejectedResult?.outcome})`);
  assert(rejectedResult?.diagnosis.state === 'REJECTED', 'hypothesis A diagnosis.state is REJECTED');

  const afterRejectionDiagnoses = await getActiveDiagnoses(studentId);
  assert(
    !afterRejectionDiagnoses.some((d) => d.id === hypotheses[0].diagnosisId),
    'getActiveDiagnoses excludes the REJECTED diagnosis (engine does not keep pursuing a ruled-out hypothesis)'
  );

  const nextHypothesis = hypotheses[1];
  assert(nextHypothesis.candidateConceptId === candidateB, 'next hypothesis in rank order is Vector Direction');
  const confirmedResult = await resolveDiagnosticCheck(nextHypothesis.diagnosisId, 1, 3);
  assert(confirmedResult?.outcome === 'CONFIRMED', `Diagnostic Check (1/3 correct) on hypothesis B: outcome is CONFIRMED (got ${confirmedResult?.outcome})`);

  const finalDiagnosis = await getDiagnosis(nextHypothesis.diagnosisId);
  assert(finalDiagnosis?.state === 'CONFIRMED', 'the engine correctly lands on the true root cause (Vector Direction) after rejecting the first hypothesis');

  return { studentId, subjectId };
}

async function cleanup(studentIds: string[]) {
  section('CLEANUP');
  for (const studentId of studentIds) {
    await db.query(`DELETE FROM analytics_events WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM concept_knowledge_state WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM student_misconceptions WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM remediation_steps WHERE remediation_path_id IN (SELECT id FROM remediation_paths WHERE student_id = $1)`, [studentId]);
    await db.query(`DELETE FROM remediation_paths WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM cognitive_diagnoses WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM errors WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM learning_debt WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM learning_evidence WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM mastery_events WHERE mastery_id IN (SELECT id FROM mastery_records WHERE student_id = $1)`, [studentId]);
    await db.query(`DELETE FROM mastery_records WHERE student_id = $1`, [studentId]);
    const subjects = await db.query(`SELECT id FROM subjects WHERE student_id = $1`, [studentId]);
    for (const { id: subjectId } of subjects.rows) {
      await db.query(`DELETE FROM misconception_signatures WHERE concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)`, [subjectId]);
      await db.query(
        `DELETE FROM concept_relationships WHERE source_concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)
           OR target_concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)`,
        [subjectId]
      );
      await db.query(`DELETE FROM concept_localizations WHERE concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)`, [subjectId]);
      await db.query(`DELETE FROM concepts WHERE subject_id = $1`, [subjectId]);
    }
    await db.query(`DELETE FROM subjects WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM student_profiles WHERE id = $1`, [studentId]);
    await db.query(`DELETE FROM profiles WHERE id = $1`, [studentId]);
    await db.query(`DELETE FROM students WHERE id = $1`, [studentId]);
  }
  console.log(`  cleaned up ${studentIds.length} scratch student(s)`);

  const residue = await db.query(`SELECT count(*)::int AS n FROM students WHERE clerk_id LIKE $1`, [`${SCRATCH_PREFIX}%`]);
  assert(residue.rows[0].n === 0, `zero residual scratch data left in the database (found ${residue.rows[0].n})`);
}

async function main() {
  const createdStudentIds: string[] = [];
  try {
    const a = await scenarioConfirm();
    createdStudentIds.push(a.studentId);
    const b = await scenarioRejection();
    createdStudentIds.push(b.studentId);
  } finally {
    await cleanup(createdStudentIds);
  }

  console.log(`\n=== RESULT: ${passCount} passed, ${failCount} failed ===`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    console.error('E2E SCRIPT ERROR:', err);
    process.exitCode = 1;
  })
  .finally(() => db.end?.());
