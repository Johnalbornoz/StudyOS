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
import { getActiveValidationCycle, getKVR14, getTimeToMastery } from '@/services/validation-cycle.service';
import { recordExamResult, getConceptAttribution } from '@/services/exam-result.service';
import { mapAssessmentConceptCoverage, detectCalibrationConflict, getCalibrationConflicts } from '@/services/external-assessment.service';
import { runKnowledgeStateBackfill } from '@/services/knowledge-state-backfill.service';
import { getDueItems } from '@/services/learning-scheduler.service';
import { storeQuiz, getQuizSession, completeQuiz } from '@/services/quiz-persistence.service';
import { canUseAI } from '@/lib/ai-permission-policy';

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

async function giveEvidence(
  studentId: string,
  conceptId: string,
  subjectId: string,
  sourceType: string,
  scorePercent: number,
  aiAssistanceType: 'NONE' | 'HINT' = 'NONE'
) {
  await updateMastery({
    studentId,
    conceptId,
    subjectId,
    evidence: {
      result: scorePercent >= 70 ? 'correct' : scorePercent >= 50 ? 'partial' : 'incorrect',
      difficulty: 3,
      sourceType: sourceType as any,
      confidenceWeight: 0.9,
      scorePercent,
      sampleSize: 4,
    },
    telemetry: { activityType: 'quiz', learningMode: aiAssistanceType === 'NONE' ? 'SOLO' : 'COACH', hintsUsed: aiAssistanceType === 'NONE' ? 0 : 1, aiAssistanceType },
  });
}

/**
 * Inserts one evidence row directly with a backdated timestamp -- not
 * through updateMastery (which always stamps NOW()) -- so a concept's
 * `first_evidence_at` is genuinely in the past. This lets the rest of
 * the scenario write "today's" evidence and have it immediately count
 * toward Retention (real time separation from first exposure), without
 * the E2E script needing to actually wait days.
 */
async function backdateFirstEvidence(
  studentId: string,
  conceptId: string,
  subjectId: string,
  scorePercent: number,
  daysAgo: number
) {
  await db.query(
    `INSERT INTO learning_evidence (student_id, concept_id, subject_id, source_type, result, difficulty, score_percent, ai_assistance_type, timestamp)
     VALUES ($1, $2, $3, 'PRACTICE_QUIZ', $4, 3, $5, 'HINT', NOW() - ($6 || ' days')::interval)`,
    [studentId, conceptId, subjectId, scorePercent >= 70 ? 'correct' : scorePercent >= 50 ? 'partial' : 'incorrect', scorePercent, daysAgo]
  );
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
 * SCENARIO C -- the mandatory Phase 2.2B success golden path: a
 * concept whose evidence genuinely earns Validated Mastery. A backdated
 * baseline establishes real time separation from "today's" evidence, so
 * later evidence counts as real Retention without the script needing to
 * wait actual days. Understanding/Independence/Application all clear
 * policy, Retention (pooled from all time-separated evidence) and
 * Transfer both come in strong, and there are zero critical
 * misconceptions -- exactly the brief's "everything lines up" case.
 */
async function scenarioValidationSuccess() {
  section('SCENARIO C: Phase 2.2B success golden path (Validated Mastery)');
  const studentId = await makeScratchStudent('validation_success');
  const subjectId = await makeScratchSubject(studentId, 'Physics HL (SCRATCH E2E, validation)');
  const conceptId = await makeScratchConcept(subjectId, `centripetal_force_v_${RUN_ID}`, 'Centripetal Force');

  // Baseline, 10 days ago -- weak, and HINT-assisted so it never pollutes Independence.
  await backdateFirstEvidence(studentId, conceptId, subjectId, 42, 10);

  const cycleAfterBaseline = await getActiveValidationCycle(studentId, conceptId);
  assert(cycleAfterBaseline === null, 'no Validation Cycle exists yet -- the backdated baseline was written directly, never through the projector');

  // "Today": strong Understanding (Explain & Defend evidence), Independence, and Application.
  await giveEvidence(studentId, conceptId, subjectId, 'EXPLANATION', 88, 'NONE');
  const cycleAfterFirstReal = await getActiveValidationCycle(studentId, conceptId);
  assert(cycleAfterFirstReal !== null, 'a Validation Cycle opens as soon as real evidence produces a meaningful gap (Understanding alone is not enough for Provisional)');
  assert(cycleAfterFirstReal?.triggerType !== undefined, 'the opened cycle carries a real trigger type');

  await giveEvidence(studentId, conceptId, subjectId, 'EXPLANATION', 88, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'PRACTICE_QUIZ', 86, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'PRACTICE_QUIZ', 86, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'CUMULATIVE_ASSESSMENT', 82, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'CUMULATIVE_ASSESSMENT', 82, 'NONE');

  // Transfer, reusing Phase 2's real Transfer evidence path (same metadata stamp the real submit route uses).
  await giveEvidence(studentId, conceptId, subjectId, 'TRANSFER', 78, 'NONE');
  await db.query(
    `UPDATE learning_evidence SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"transferDistance":"NEAR","assisted":false}'::jsonb
     WHERE id = (SELECT id FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND source_type = 'TRANSFER' ORDER BY timestamp DESC LIMIT 1)`,
    [studentId, conceptId]
  );
  // Re-run the projector now that Transfer evidence (and its metadata) is in place.
  await giveEvidence(studentId, conceptId, subjectId, 'CUMULATIVE_ASSESSMENT', 84, 'NONE');

  const finalState = await getConceptKnowledgeState(studentId, conceptId);
  assert(finalState !== null, 'Concept Knowledge State exists after the full evidence sequence');
  assert(!!finalState && finalState.understandingScore !== null && finalState.understandingScore >= 80, `Understanding passes policy (got ${finalState?.understandingScore})`);
  assert(!!finalState && finalState.independenceScore !== null && finalState.independenceScore >= 80, `Independence passes policy (got ${finalState?.independenceScore})`);
  assert(!!finalState && finalState.applicationScore !== null && finalState.applicationScore >= 75, `Application passes policy (got ${finalState?.applicationScore})`);
  assert(!!finalState && finalState.retentionScore !== null, `Retention is a real (non-null) value, not "waiting" forever, thanks to the backdated baseline (got ${finalState?.retentionScore})`);
  assert(!!finalState && finalState.transferScore !== null, `Transfer is a real reused value from Phase 2 (got ${finalState?.transferScore})`);
  assert(finalState?.criticalMisconceptionCount === 0, 'zero critical misconceptions');
  assert(finalState?.masteryState === 'VALIDATED_MASTERY', `final Mastery State is VALIDATED_MASTERY (got ${finalState?.masteryState})`);
  assert(finalState?.validationReadiness === 'READY', `Validation Readiness is READY (got ${finalState?.validationReadiness})`);

  const cycleAfterValidation = await getActiveValidationCycle(studentId, conceptId);
  assert(cycleAfterValidation === null, 'the Validation Cycle is no longer active -- it closed when Validated Mastery was reached');

  const kvr = await getKVR14(studentId);
  assert(kvr.eligibleCount >= 1, `KVR-14: at least one eligible (CLOSED) cycle exists (got ${kvr.eligibleCount})`);
  assert(kvr.validatedCount >= 1, `KVR-14: at least one cycle validated within its deadline (got ${kvr.validatedCount})`);
  assert(kvr.value === 100, `KVR-14 is 100% for this student (only cycle, and it validated) (got ${kvr.value})`);

  const ttm = await getTimeToMastery(studentId);
  assert(ttm.count >= 1, 'Time to Mastery has at least one real, validated cycle to average');
  assert(ttm.averageDays !== null && ttm.averageDays >= 0, `Time to Mastery is a real, non-negative number of days (got ${ttm.averageDays})`);

  return { studentId, subjectId };
}

/**
 * SCENARIO D -- the mandatory Phase 2.2B failure golden path: strong
 * Understanding/Independence/Application, but Retention and Transfer
 * both genuinely fail policy. The concept must never be silently
 * declared validated, decay must never be reported for a concept that
 * was never validated in the first place (that's specifically for a
 * *regression* from Validated Mastery -- see Scenario C's counterpart
 * in the unit tests), and once its Validation Cycle's deadline passes
 * without clearing policy, it must resolve to an explicit DEVELOPING
 * outcome -- never left as an implicit UNKNOWN.
 */
async function scenarioValidationFailure() {
  section('SCENARIO D: Phase 2.2B failure golden path (never validated, deadline resolves explicitly)');
  const studentId = await makeScratchStudent('validation_failure');
  const subjectId = await makeScratchSubject(studentId, 'Physics HL (SCRATCH E2E, validation failure)');
  const conceptId = await makeScratchConcept(subjectId, `centripetal_force_f_${RUN_ID}`, 'Centripetal Force');

  await backdateFirstEvidence(studentId, conceptId, subjectId, 42, 10);

  // Strong Understanding, Independence, Application...
  await giveEvidence(studentId, conceptId, subjectId, 'EXPLANATION', 90, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'EXPLANATION', 90, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'PRACTICE_QUIZ', 90, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'PRACTICE_QUIZ', 90, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'CUMULATIVE_ASSESSMENT', 85, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'CUMULATIVE_ASSESSMENT', 85, 'NONE');
  // ...but a cluster of weak, HINT-assisted attempts (excluded from Independence, but Retention
  // pools ALL time-separated evidence regardless of source) drags the real Retention picture down.
  await giveEvidence(studentId, conceptId, subjectId, 'PRACTICE_QUESTION', 20, 'HINT');
  await giveEvidence(studentId, conceptId, subjectId, 'PRACTICE_QUESTION', 20, 'HINT');
  await giveEvidence(studentId, conceptId, subjectId, 'PRACTICE_QUESTION', 20, 'HINT');
  // A poor, assisted Transfer attempt, reusing Phase 2's real Transfer evidence path
  // (HINT-assisted here so it's excluded from Independence's own pool, same as the
  // weak PRACTICE_QUESTION cluster above -- only Retention pools every evidence type).
  await giveEvidence(studentId, conceptId, subjectId, 'TRANSFER', 20, 'HINT');
  await db.query(
    `UPDATE learning_evidence SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"transferDistance":"NEAR","assisted":true}'::jsonb
     WHERE id = (SELECT id FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND source_type = 'TRANSFER' ORDER BY timestamp DESC LIMIT 1)`,
    [studentId, conceptId]
  );
  await giveEvidence(studentId, conceptId, subjectId, 'CUMULATIVE_ASSESSMENT', 84, 'NONE');

  const state = await getConceptKnowledgeState(studentId, conceptId);
  assert(!!state && state.understandingScore !== null && state.understandingScore >= 80, `Understanding still passes (got ${state?.understandingScore})`);
  assert(!!state && state.independenceScore !== null && state.independenceScore >= 80, `Independence still passes (got ${state?.independenceScore})`);
  assert(!!state && state.applicationScore !== null && state.applicationScore >= 75, `Application still passes (got ${state?.applicationScore})`);
  assert(!!state && state.retentionScore !== null && state.retentionScore < 75, `Retention is real but genuinely fails policy (got ${state?.retentionScore})`);
  assert(!!state && state.transferScore !== null && state.transferScore < 70, `Transfer is real but genuinely fails policy (got ${state?.transferScore})`);
  assert(state?.masteryState !== 'VALIDATED_MASTERY', `not validated despite strong Understanding/Independence/Application (got ${state?.masteryState})`);
  assert(state?.masteryState === 'PROVISIONAL_MASTERY', `stays at Provisional Mastery -- it can currently perform, it just hasn't proven Retention/Transfer (got ${state?.masteryState})`);

  const openCycle = await getActiveValidationCycle(studentId, conceptId);
  assert(openCycle !== null, 'a Validation Cycle is open, tracking this real gap');
  // The trigger reflects whichever dimension was already failing/insufficient
  // at the exact moment the cycle first opened (early in this evidence
  // sequence, before Retention/Transfer evidence existed at all) -- it is
  // fixed at open time, not retroactively updated as later evidence arrives.
  // What matters here is that it's a real, valid trigger, not which specific
  // one -- the current per-dimension picture is what state_reason is for.
  const validTriggers = ['LOW_BASELINE', 'CONFIRMED_MISCONCEPTION', 'DIAGNOSTIC_FAILURE', 'REPEATED_CONCEPTUAL_ERROR', 'APPLICATION_FAILURE', 'TRANSFER_FAILURE', 'RETENTION_FAILURE', 'KNOWLEDGE_DECAY', 'EXTERNAL_ASSESSMENT_CONFLICT'];
  assert(!!openCycle && validTriggers.includes(openCycle.triggerType), `trigger type is a real, valid TriggerType (got ${openCycle?.triggerType})`);

  // Simulate the validation window elapsing without the student ever clearing policy --
  // a direct, honest time-jump (this scratch cycle's own deadline, not a global clock),
  // not a real multi-day wait.
  await db.query(`UPDATE validation_cycles SET validation_deadline = NOW() - INTERVAL '1 day' WHERE id = $1`, [openCycle!.id]);

  const afterDeadline = await getActiveValidationCycle(studentId, conceptId);
  assert(afterDeadline === null, 'the expired cycle is no longer active -- it resolved explicitly, it did not just keep sitting open');

  const closedCycle = await db.query(`SELECT status, final_outcome, outcome_reason FROM validation_cycles WHERE id = $1`, [openCycle!.id]);
  const row = closedCycle.rows[0];
  assert(row.status === 'CLOSED', `the cycle's own status is explicitly CLOSED, never left implicitly open/unknown (got ${row.status})`);
  assert(row.final_outcome === 'DEVELOPING', `first failed attempt at this concept resolves to DEVELOPING, not yet Intervention Required (got ${row.final_outcome})`);
  assert(!!row.outcome_reason, 'the outcome carries a real, honest reason code, not a silent/fabricated one');

  return { studentId, subjectId };
}

/**
 * SCENARIO E -- the mandatory Phase 2.2C External Validation flow: a
 * concept with strong internal Understanding (from real Explain &
 * Defend evidence) disagrees with a genuinely poor real school exam
 * result. Uses the existing exam-result.service.ts (Phase 1) to record
 * the exam -- real reuse, not a parallel external-assessment path --
 * then confirms the calibration conflict this creates never touches
 * Knowledge State itself, either before or after being detected.
 */
async function scenarioExternalValidation() {
  section('SCENARIO E: Phase 2.2C external validation (calibration conflict)');
  const studentId = await makeScratchStudent('external_validation');
  const subjectId = await makeScratchSubject(studentId, 'Physics HL (SCRATCH E2E, external validation)');
  const conceptId = await makeScratchConcept(subjectId, `centripetal_force_ext_${RUN_ID}`, 'Centripetal Force');

  // Strong internal Understanding, established via real Explain & Defend evidence
  // (Understanding prioritizes EXPLANATION evidence over general quiz evidence,
  // so this stays high regardless of whatever the exam recalibration below does).
  await giveEvidence(studentId, conceptId, subjectId, 'EXPLANATION', 92, 'NONE');
  await giveEvidence(studentId, conceptId, subjectId, 'EXPLANATION', 90, 'NONE');

  const beforeExam = await getConceptKnowledgeState(studentId, conceptId);
  assert(!!beforeExam && beforeExam.understandingScore !== null && beforeExam.understandingScore >= 80, `internal Understanding is strong before any external evidence exists (got ${beforeExam?.understandingScore})`);

  // A real, poor school exam result -- reusing the existing (Phase 1)
  // exam-result.service.ts rather than a parallel external-assessment path.
  // Note: recordExamResult itself recalibrates Knowledge State via its own
  // pre-existing updateMastery call (documented, known Phase 1 behavior --
  // see the commit introducing this module) -- that expected write is why
  // the "no write" check below is taken right before/after
  // detectCalibrationConflict specifically, not around recordExamResult.
  const occurrence = await db.query(
    `INSERT INTO assessment_occurrences (subject_id, scheduled_date, status, topics) VALUES ($1, CURRENT_DATE, 'expected', $2) RETURNING id`,
    [subjectId, [conceptId]]
  );
  const occurrenceId = occurrence.rows[0].id;
  await recordExamResult({ occurrenceId, studentId, score: 40, maxScore: 100 });

  // Explicit concept coverage mapping -- never auto-inferred from the topics array.
  await mapAssessmentConceptCoverage(occurrenceId, [{ conceptId, weight: 1.0, mappingConfidence: 0.9 }]);

  const beforeConflictCheck = await getConceptKnowledgeState(studentId, conceptId);
  const conflict = await detectCalibrationConflict(studentId, conceptId);
  assert(conflict !== null, 'a genuine internal/external disagreement produces a real calibration conflict');
  assert(!!conflict && conflict.externalScore === 40, `external score matches the real recorded exam percentage (got ${conflict?.externalScore})`);
  assert(!!conflict && conflict.conflictMagnitude >= 20, `conflict magnitude reflects a genuine disagreement (got ${conflict?.conflictMagnitude})`);
  assert(!!conflict && conflict.possibleInterpretations.includes('INTERNAL_OVERESTIMATION'), `tagged with a real interpretation (got ${conflict?.possibleInterpretations})`);

  const afterConflictCheck = await getConceptKnowledgeState(studentId, conceptId);
  assert(
    !!beforeConflictCheck && !!afterConflictCheck && afterConflictCheck.understandingScore === beforeConflictCheck.understandingScore,
    `detecting the conflict never changed the concept's internal Understanding score (before ${beforeConflictCheck?.understandingScore}, after ${afterConflictCheck?.understandingScore})`
  );
  assert(
    !!beforeConflictCheck && !!afterConflictCheck && new Date(afterConflictCheck.updatedAt).getTime() === new Date(beforeConflictCheck.updatedAt).getTime(),
    'Knowledge State\'s own updated_at is untouched -- detectCalibrationConflict truly never writes to it'
  );

  const conflicts = await getCalibrationConflicts(studentId);
  assert(conflicts.some((c) => c.conceptId === conceptId), 'the conflict is readable back via getCalibrationConflicts');

  return { studentId, subjectId, occurrenceId };
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

/**
 * SCENARIO F -- Phase 3 Pre-flight: exam attribution honesty, Knowledge
 * State backfill idempotency, and the Learning Scheduling Clock's
 * due-item surfacing, all against real persisted state.
 */
async function scenarioPreflight() {
  section('SCENARIO F: Phase 3 Pre-flight (exam attribution, backfill, scheduler)');
  const studentId = await makeScratchStudent('preflight');
  const subjectId = await makeScratchSubject(studentId, 'Physics HL (SCRATCH E2E, preflight)');
  const mappedConcept = await makeScratchConcept(subjectId, `projectile_motion_${RUN_ID}`, 'Projectile Motion');
  const subjectWideConcept = await makeScratchConcept(subjectId, `energy_conservation_${RUN_ID}`, 'Energy Conservation');

  // --- Exam attribution: same 85% exam score, two different attribution
  // granularities -- CONCEPT_MAPPED (explicit, high-confidence mapping)
  // vs SUBJECT_WIDE (no topics selected at all, lowest confidence). The
  // real bug this fixes: both used to move mastery identically (uniform
  // 1.0 confidence). They must not anymore.
  const mappedOccurrence = await db.query(
    `INSERT INTO assessment_occurrences (subject_id, scheduled_date, status, topics) VALUES ($1, CURRENT_DATE, 'expected', $2) RETURNING id`,
    [subjectId, [mappedConcept]]
  );
  const mappedOccurrenceId = mappedOccurrence.rows[0].id;
  await mapAssessmentConceptCoverage(mappedOccurrenceId, [{ conceptId: mappedConcept, weight: 1.0, mappingConfidence: 0.95 }]);

  const subjectWideOccurrence = await db.query(
    `INSERT INTO assessment_occurrences (subject_id, scheduled_date, status, topics) VALUES ($1, CURRENT_DATE, 'expected', $2) RETURNING id`,
    [subjectId, []]
  );
  const subjectWideOccurrenceId = subjectWideOccurrence.rows[0].id;

  const mappedAttribution = await getConceptAttribution(mappedOccurrenceId, subjectId, [mappedConcept]);
  const subjectWideAttribution = await getConceptAttribution(subjectWideOccurrenceId, subjectId, []);
  assert(mappedAttribution[0].sourceGranularity === 'CONCEPT_MAPPED', 'explicit coverage mapping yields CONCEPT_MAPPED granularity');
  assert(subjectWideAttribution.some((a) => a.conceptId === subjectWideConcept), 'no topics selected falls back to every concept in the subject');
  assert(
    subjectWideAttribution[0].confidenceWeight < mappedAttribution[0].confidenceWeight,
    `SUBJECT_WIDE confidence (${subjectWideAttribution[0].confidenceWeight}) is strictly lower than CONCEPT_MAPPED (${mappedAttribution[0].confidenceWeight})`
  );

  const beforeMapped = await db.query(`SELECT mastery_score FROM mastery_records WHERE student_id = $1 AND concept_id = $2`, [studentId, mappedConcept]);
  const beforeSubjectWide = await db.query(`SELECT mastery_score FROM mastery_records WHERE student_id = $1 AND concept_id = $2`, [studentId, subjectWideConcept]);

  await recordExamResult({ occurrenceId: mappedOccurrenceId, studentId, score: 85, maxScore: 100 });
  await recordExamResult({ occurrenceId: subjectWideOccurrenceId, studentId, score: 85, maxScore: 100 });

  const afterMapped = await db.query(`SELECT mastery_score FROM mastery_records WHERE student_id = $1 AND concept_id = $2`, [studentId, mappedConcept]);
  const afterSubjectWide = await db.query(`SELECT mastery_score FROM mastery_records WHERE student_id = $1 AND concept_id = $2`, [studentId, subjectWideConcept]);
  const mappedDelta = Number(afterMapped.rows[0].mastery_score) - Number(beforeMapped.rows[0]?.mastery_score ?? 0);
  const subjectWideDelta = Number(afterSubjectWide.rows[0].mastery_score) - Number(beforeSubjectWide.rows[0]?.mastery_score ?? 0);
  assert(
    subjectWideDelta < mappedDelta,
    `the same 85% exam score moves mastery LESS under SUBJECT_WIDE attribution (${subjectWideDelta}) than CONCEPT_MAPPED (${mappedDelta}) -- no longer uniformly trusted`
  );

  const evidenceMetadata = await db.query(
    `SELECT metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND source_type = 'REAL_SCHOOL_EXAM' ORDER BY timestamp DESC LIMIT 1`,
    [studentId, subjectWideConcept]
  );
  assert(
    evidenceMetadata.rows[0]?.metadata?.examConceptAttribution?.sourceGranularity === 'SUBJECT_WIDE',
    `the attribution granularity is persisted onto the evidence row itself (got ${JSON.stringify(evidenceMetadata.rows[0]?.metadata)})`
  );

  // --- Knowledge State backfill: simulate a gap (evidence exists, but
  // no projected state -- e.g. recorded before the projector hook
  // existed) by deleting the already-correct row the giveEvidence calls
  // above triggered, then reconstructing it via the backfill service
  // (the SAME projector, never a parallel formula).
  await giveEvidence(studentId, mappedConcept, subjectId, 'PRACTICE_QUIZ', 80, 'NONE');
  const liveProjectedState = await getConceptKnowledgeState(studentId, mappedConcept);
  await db.query(`DELETE FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2`, [studentId, mappedConcept]);
  const gapState = await getConceptKnowledgeState(studentId, mappedConcept);
  assert(gapState === null, 'the simulated gap really has no projected state before backfill runs');

  const firstRun = await runKnowledgeStateBackfill({ studentId });
  assert(firstRun.metrics.statesReconstructed >= 1, `backfill reconstructs the missing state (statesReconstructed=${firstRun.metrics.statesReconstructed})`);
  const reconstructed = await getConceptKnowledgeState(studentId, mappedConcept);
  assert(
    !!reconstructed && !!liveProjectedState && reconstructed.masteryState === liveProjectedState.masteryState && reconstructed.understandingScore === liveProjectedState.understandingScore,
    `the reconstructed state matches what the live projector already produced (mastery ${reconstructed?.masteryState} vs ${liveProjectedState?.masteryState})`
  );

  const secondRun = await runKnowledgeStateBackfill({ studentId });
  assert(secondRun.metrics.conceptsWithEvidence === 0, `re-running backfill with nothing stale finds zero candidates (idempotent, got ${secondRun.metrics.conceptsWithEvidence})`);

  // --- Learning Scheduling Clock: a retention review overdue by 1 day
  // must surface as a due item, purely from time, with no priority
  // ranking implied.
  await db.query(`UPDATE mastery_records SET next_review_date = NOW() - INTERVAL '1 day' WHERE student_id = $1 AND concept_id = $2`, [studentId, mappedConcept]);
  const dueItems = await getDueItems(studentId);
  assert(
    dueItems.some((i) => i.type === 'RETENTION_REVIEW_DUE' && i.conceptId === mappedConcept),
    'an overdue retention review surfaces as a due item from the Learning Scheduling Clock'
  );

  return { studentId, subjectId, backfillRunIds: [firstRun.runId, secondRun.runId] };
}

/**
 * SCENARIO G -- Phase 3A Evidence Mode Engine: Activity Type/Evidence
 * Mode are stamped immutably at attempt creation and actually change
 * what the resulting evidence counts as -- Solo Check produces real
 * Independent evidence, Review (assisted) produces Practice evidence,
 * Retention Review produces Independent evidence, and the server-side
 * canUseAI policy denies HINT for every attempt whose persisted
 * Evidence Mode isn't PRACTICE, regardless of which quiz mode a
 * client might claim.
 */
async function scenarioEvidenceModeEngine() {
  section('SCENARIO G: Phase 3A Evidence Mode Engine (Solo Check, Review, Retention Check)');
  const studentId = await makeScratchStudent('evidence_mode');
  const subjectId = await makeScratchSubject(studentId, 'Physics HL (SCRATCH E2E, evidence mode)');
  const conceptId = await makeScratchConcept(subjectId, `momentum_conservation_${RUN_ID}`, 'Conservation of Momentum');

  const quizIds: string[] = [];

  // --- Solo Check (quick_check) -- the fixed legacy bug: this must be
  // SOLO_CHECK/INDEPENDENT, never CUMULATIVE_ASSESSMENT/ASSESSMENT.
  const soloCheckQuizId = await storeQuiz(studentId, conceptId, subjectId, [{ conceptId } as any], 'en', 'quick_check');
  quizIds.push(soloCheckQuizId);
  const soloCheckSession = await getQuizSession(soloCheckQuizId);
  assert(soloCheckSession?.activityType === 'SOLO_CHECK', `Solo Check attempt has Activity Type SOLO_CHECK (got ${soloCheckSession?.activityType})`);
  assert(soloCheckSession?.evidenceMode === 'INDEPENDENT', `Solo Check attempt has Evidence Mode INDEPENDENT (got ${soloCheckSession?.evidenceMode})`);
  assert(!canUseAI({ evidenceMode: soloCheckSession!.evidenceMode, feature: 'HINT' }), 'canUseAI denies HINT for the real, persisted Solo Check attempt');
  assert(canUseAI({ evidenceMode: soloCheckSession!.evidenceMode, feature: 'MATH_TOOLBAR' }), 'canUseAI still allows the Math Toolbar during Solo Check (input assistance, not answer assistance)');

  const soloLearningMode: 'SOLO' | 'COACH' = soloCheckSession!.evidenceMode === 'PRACTICE' ? 'COACH' : 'SOLO';
  await updateMastery({
    studentId,
    conceptId,
    subjectId,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.9, scorePercent: 90, sampleSize: 4 },
    telemetry: { activityType: 'quiz', learningMode: soloLearningMode, hintsUsed: 0 },
    metadata: { activityType: soloCheckSession!.activityType, evidenceMode: soloCheckSession!.evidenceMode },
  });
  await completeQuiz(soloCheckQuizId);

  const afterSoloCheck = await db.query(
    `SELECT ai_assistance_type, metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT 1`,
    [studentId, conceptId]
  );
  assert(afterSoloCheck.rows[0]?.ai_assistance_type === 'NONE', `Solo Check evidence is unassisted (ai_assistance_type=NONE, got ${afterSoloCheck.rows[0]?.ai_assistance_type})`);
  assert(afterSoloCheck.rows[0]?.metadata?.evidenceMode === 'INDEPENDENT', 'Solo Check evidence records its real Evidence Mode in metadata');

  // --- Review (assisted reinforcement) -- REVIEW/PRACTICE, AI may help.
  const reviewQuizId = await storeQuiz(studentId, conceptId, subjectId, [{ conceptId } as any], 'en', 'review');
  quizIds.push(reviewQuizId);
  const reviewSession = await getQuizSession(reviewQuizId);
  assert(reviewSession?.activityType === 'REVIEW' && reviewSession?.evidenceMode === 'PRACTICE', `Review attempt is REVIEW/PRACTICE (got ${reviewSession?.activityType}/${reviewSession?.evidenceMode})`);
  assert(canUseAI({ evidenceMode: reviewSession!.evidenceMode, feature: 'HINT' }), 'canUseAI allows HINT during Review (reinforcement, AI may assist)');

  const reviewLearningMode: 'SOLO' | 'COACH' = reviewSession!.evidenceMode === 'PRACTICE' ? 'COACH' : 'SOLO';
  await updateMastery({
    studentId,
    conceptId,
    subjectId,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUIZ', confidenceWeight: 0.9, scorePercent: 85, sampleSize: 4 },
    telemetry: { activityType: 'quiz', learningMode: reviewLearningMode, hintsUsed: 1, aiAssistanceType: 'HINT' },
    metadata: { activityType: reviewSession!.activityType, evidenceMode: reviewSession!.evidenceMode },
  });
  await completeQuiz(reviewQuizId);

  const afterReview = await db.query(
    `SELECT ai_assistance_type, metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT 1`,
    [studentId, conceptId]
  );
  assert(afterReview.rows[0]?.ai_assistance_type === 'HINT', `Review evidence records real assistance used (ai_assistance_type=HINT, got ${afterReview.rows[0]?.ai_assistance_type})`);
  assert(afterReview.rows[0]?.metadata?.evidenceMode === 'PRACTICE', 'Review evidence records Evidence Mode PRACTICE in metadata');

  // --- Retention Review (unassisted) -- RETENTION_CHECK/INDEPENDENT.
  const retentionQuizId = await storeQuiz(studentId, conceptId, subjectId, [{ conceptId } as any], 'en', 'retention_check');
  quizIds.push(retentionQuizId);
  const retentionSession = await getQuizSession(retentionQuizId);
  assert(retentionSession?.activityType === 'RETENTION_CHECK' && retentionSession?.evidenceMode === 'INDEPENDENT', `Retention Review attempt is RETENTION_CHECK/INDEPENDENT (got ${retentionSession?.activityType}/${retentionSession?.evidenceMode})`);
  assert(!canUseAI({ evidenceMode: retentionSession!.evidenceMode, feature: 'HINT' }), 'canUseAI denies HINT during Retention Review');

  const retentionLearningMode: 'SOLO' | 'COACH' = retentionSession!.evidenceMode === 'PRACTICE' ? 'COACH' : 'SOLO';
  await updateMastery({
    studentId,
    conceptId,
    subjectId,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.9, scorePercent: 88, sampleSize: 4 },
    telemetry: { activityType: 'quiz', learningMode: retentionLearningMode, hintsUsed: 0 },
    metadata: { activityType: retentionSession!.activityType, evidenceMode: retentionSession!.evidenceMode },
  });
  await completeQuiz(retentionQuizId);

  const afterRetention = await db.query(
    `SELECT ai_assistance_type, metadata FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT 1`,
    [studentId, conceptId]
  );
  assert(afterRetention.rows[0]?.ai_assistance_type === 'NONE', `Retention Review evidence is unassisted (got ${afterRetention.rows[0]?.ai_assistance_type})`);
  assert(afterRetention.rows[0]?.metadata?.activityType === 'RETENTION_CHECK', 'Retention Review evidence records Activity Type RETENTION_CHECK in metadata');

  // --- Attempt Mode Immutability: each mode change created a brand-new
  // quizId; nothing ever rewrote an existing attempt's mode.
  assert(new Set(quizIds).size === quizIds.length, 'Practice/Independent/Assessment transitions each required a brand-new attempt, never an in-place mode change');
  const modesOfRecord = await db.query(`SELECT id, quiz_mode, activity_type, evidence_mode FROM quiz_sessions WHERE id = ANY($1)`, [quizIds]);
  assert(modesOfRecord.rows.every((r) => r.activity_type && r.evidence_mode), 'every attempt has its Activity Type/Evidence Mode permanently stamped in quiz_sessions');

  // --- Backward compatibility: an existing cumulative_assessment
  // attempt (Assessment Mode, pre-Phase-3A semantics) still resolves
  // correctly and still denies HINT, exactly as before.
  const cumulativeQuizId = await storeQuiz(studentId, null, subjectId, [{ conceptId } as any], 'en', 'cumulative_assessment', [conceptId]);
  quizIds.push(cumulativeQuizId);
  const cumulativeSession = await getQuizSession(cumulativeQuizId);
  assert(cumulativeSession?.activityType === 'CUMULATIVE_ASSESSMENT' && cumulativeSession?.evidenceMode === 'ASSESSMENT', 'pre-existing Cumulative Assessment mode is unaffected by the Solo Check fix');
  assert(!canUseAI({ evidenceMode: cumulativeSession!.evidenceMode, feature: 'HINT' }), 'Cumulative Assessment still denies HINT (regression check)');
  await completeQuiz(cumulativeQuizId);

  return { studentId, subjectId, quizIds };
}

async function cleanup(studentIds: string[], backfillRunIds: string[] = []) {
  section('CLEANUP');
  for (const studentId of studentIds) {
    await db.query(`DELETE FROM analytics_events WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM quiz_sessions WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM calibration_conflicts WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM assessment_results WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM validation_events WHERE validation_cycle_id IN (SELECT id FROM validation_cycles WHERE student_id = $1)`, [studentId]);
    await db.query(`DELETE FROM validation_cycles WHERE student_id = $1`, [studentId]);
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
      await db.query(`DELETE FROM assessment_concept_coverage WHERE concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)`, [subjectId]);
      await db.query(`DELETE FROM assessment_occurrences WHERE subject_id = $1`, [subjectId]);
      await db.query(`DELETE FROM concepts WHERE subject_id = $1`, [subjectId]);
    }
    await db.query(`DELETE FROM subjects WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM student_profiles WHERE id = $1`, [studentId]);
    await db.query(`DELETE FROM profiles WHERE id = $1`, [studentId]);
    await db.query(`DELETE FROM students WHERE id = $1`, [studentId]);
  }
  console.log(`  cleaned up ${studentIds.length} scratch student(s)`);

  if (backfillRunIds.length > 0) {
    await db.query(`DELETE FROM backfill_runs WHERE id = ANY($1::uuid[])`, [backfillRunIds]);
  }

  const residue = await db.query(`SELECT count(*)::int AS n FROM students WHERE clerk_id LIKE $1`, [`${SCRATCH_PREFIX}%`]);
  assert(residue.rows[0].n === 0, `zero residual scratch data left in the database (found ${residue.rows[0].n})`);
  if (backfillRunIds.length > 0) {
    const backfillResidue = await db.query(`SELECT count(*)::int AS n FROM backfill_runs WHERE id = ANY($1::uuid[])`, [backfillRunIds]);
    assert(backfillResidue.rows[0].n === 0, `zero residual backfill_runs rows left (found ${backfillResidue.rows[0].n})`);
  }
}

async function main() {
  const createdStudentIds: string[] = [];
  let backfillRunIds: string[] = [];
  try {
    const a = await scenarioConfirm();
    createdStudentIds.push(a.studentId);
    const b = await scenarioRejection();
    createdStudentIds.push(b.studentId);
    const c = await scenarioValidationSuccess();
    createdStudentIds.push(c.studentId);
    const d = await scenarioValidationFailure();
    createdStudentIds.push(d.studentId);
    const e = await scenarioExternalValidation();
    createdStudentIds.push(e.studentId);
    const f = await scenarioPreflight();
    createdStudentIds.push(f.studentId);
    backfillRunIds = f.backfillRunIds;
    const g = await scenarioEvidenceModeEngine();
    createdStudentIds.push(g.studentId);
  } finally {
    await cleanup(createdStudentIds, backfillRunIds);
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
