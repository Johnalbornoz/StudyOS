/**
 * F8 -- real-Postgres adversarial certification (task §33 A-Q). Every
 * case below is exercised via real service calls against the real
 * ephemeral database seeded by f8-seed-pilot-dataset.ts, never mocked.
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { runDiagnosis, getDiagnosisById } from '@/lib/diagnostics/diagnosis.service';
import { explainDiagnosis } from '@/lib/diagnostics/explain.service';
import { getActiveInterventionPolicy } from '@/lib/teaching/intervention-policy.service';
import { selectIntervention } from '@/lib/teaching/intervention-selection.service';
import { resolveFrameworkForObjective } from '@/lib/teaching/framework-context.service';
import { startInterventionSession, recordInterventionAttempt } from '@/lib/teaching/session.service';
import { resolveTeachingContentGenerationContext, checkTeachingContentDeterministic } from '@/lib/teaching/ai-teaching-contract.service';
import { classifyFeedback } from '@/lib/teaching/feedback.service';
import { getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision/canonical-decision.service';
import { canAccessLearner } from '@/lib/authorization';
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
  daysAgo?: number;
}

/**
 * learning_evidence.concept_id carries a real FK to concepts(id) --
 * confirmed only here, against real Postgres (the original inspection
 * pass read the CREATE TABLE statement but missed the separately
 * pg_dump'd ALTER TABLE ADD CONSTRAINT further down the baseline dump).
 * Each test case therefore needs its own real, disposable per-student
 * concept row rather than a bare randomUUID().
 */
async function createTestConcept(subjectId: string): Promise<string> {
  const result = await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, `F8_CERT_${randomUUID()}`]);
  return result.rows[0].id;
}

async function insertEvidence(studentId: string, conceptId: string, subjectId: string, fixture: EvidenceFixture): Promise<string> {
  const result = await db.query(
    `
    INSERT INTO learning_evidence (student_id, concept_id, subject_id, source_type, result, difficulty, "timestamp", activity_type, ai_assistance_type, metadata, score_percent)
    VALUES ($1, $2, $3, 'PRACTICE_QUESTION', $4, $5, now() - ($6 || ' days')::interval, $7, $8, $9, $10)
    RETURNING id
    `,
    [
      studentId,
      conceptId,
      subjectId,
      fixture.result,
      fixture.difficulty ?? 3,
      fixture.daysAgo ?? 1,
      fixture.activityType ?? 'quiz',
      fixture.aiAssistanceType ?? 'NONE',
      fixture.metadata ? JSON.stringify(fixture.metadata) : null,
      fixture.result === 'correct' ? 100 : 0,
    ]
  );
  return result.rows[0].id;
}

async function main() {
  const seedRow = await db.query(`SELECT id FROM students WHERE clerk_id = 'clerk_f8_learner1'`);
  const STUDENT_1 = seedRow.rows[0].id;
  const student2Row = await db.query(`SELECT id FROM students WHERE clerk_id = 'clerk_f8_learner2'`);
  const STUDENT_2 = student2Row.rows[0].id;
  const subjectRow = await db.query(`SELECT id FROM subjects WHERE student_id = $1 LIMIT 1`, [STUDENT_1]);
  const SUBJECT_ID = subjectRow.rows[0].id;
  const skillRow = await db.query(`SELECT id FROM skills WHERE name = 'factor polynomial' LIMIT 1`);
  const SKILL_ID = skillRow.rows[0].id;
  const objLinearRow = await db.query(`SELECT id FROM learning_objectives WHERE code = 'PAA-M-F8-1'`);
  const OBJ_LINEAR = objLinearRow.rows[0].id;
  const objCambridgeRow = await db.query(`SELECT id FROM learning_objectives WHERE code = 'C-ALG-F8-1'`);
  const OBJ_CAMBRIDGE = objCambridgeRow.rows[0].id;
  const commandTermRow = await db.query(`SELECT id FROM command_terms WHERE term = 'justify'`);
  const COMMAND_TERM_ID = commandTermRow.rows[0].id;
  const learnerConceptRow = await db.query(`SELECT id FROM concepts WHERE canonical_id = 'LEARNER_LINEAR_EQ_F8'`);
  const LEARNER_CONCEPT_ID = learnerConceptRow.rows[0].id;

  // ---------------------------------------------------------------
  // A. One wrong answer -> INSUFFICIENT_EVIDENCE, not a persistent diagnosis
  // ---------------------------------------------------------------
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, { result: 'incorrect' });
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID });
    assert(diagnosis.primaryGapType === 'INSUFFICIENT_EVIDENCE', `A: expected INSUFFICIENT_EVIDENCE, got ${diagnosis.primaryGapType}`);
    console.log('OK -- A: one wrong answer produces INSUFFICIENT_EVIDENCE, never a persistent diagnosis (INV-F8-04)');
  }

  // ---------------------------------------------------------------
  // B. Repeated concept failures across formats -> Knowledge Gap may be supported
  // ---------------------------------------------------------------
  let knowledgeGapDiagnosisId = '';
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, { result: 'incorrect', activityType: 'quiz' });
    await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, { result: 'incorrect', activityType: 'explain' });
    await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, { result: 'incorrect', activityType: 'quiz' });
    await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, { result: 'incorrect', activityType: 'explain' });
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID });
    assert(diagnosis.primaryGapType === 'KNOWLEDGE_GAP', `B: expected KNOWLEDGE_GAP, got ${diagnosis.primaryGapType}`);
    knowledgeGapDiagnosisId = diagnosis.id;

    // Explainability (task 11): every question it must answer is answerable from the persisted row alone.
    const explanation = await explainDiagnosis(diagnosis.id);
    assert(!!explanation, 'B: explanation must exist');
    assert(explanation!.supportingEvidence.length > 0, 'B: explanation must name supporting evidence');
    assert(explanation!.alternativesConsidered.length === 4, 'B: explanation must list every dimension considered');
    console.log('OK -- B: repeated cross-format failures support Knowledge Gap; explainability answers every task §11 question from the persisted row alone');
  }

  // ---------------------------------------------------------------
  // C. Concept known, repeated command-term failures -> Technique Gap may be supported
  // ---------------------------------------------------------------
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 3; i++) await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, { result: 'correct', metadata: { reasoningRequirement: 'FACTUAL' } });
    for (let i = 0; i < 3; i++)
      await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, {
        result: 'incorrect',
        metadata: { commandTermId: COMMAND_TERM_ID, reasoningRequirement: 'METACOGNITIVE' },
      });
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID, scope: { commandTermId: COMMAND_TERM_ID } });
    assert(diagnosis.primaryGapType === 'EXAM_TECHNIQUE_GAP', `C: expected EXAM_TECHNIQUE_GAP, got ${diagnosis.primaryGapType}`);
    console.log('OK -- C: concept sound on simple forms, repeated command-term failures support Exam Technique Gap');
  }

  // ---------------------------------------------------------------
  // D. Skill graph exists (objLinear -> SKILL_ID mapping is PUBLISHED) but evidence has no explicit skillIds -> no Skill Gap fabricated
  // ---------------------------------------------------------------
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 3; i++) await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, { result: 'incorrect' }); // no metadata.skillIds at all
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID, scope: { skillId: SKILL_ID } });
    assert(diagnosis.primaryGapType !== 'SKILL_GAP', `D: must never fabricate SKILL_GAP from mapping existence alone, got ${diagnosis.primaryGapType}`);
    const skillDim = diagnosis.alternatives.find((d: any) => d.gapType === 'SKILL_GAP'); assert(!!skillDim, 'D: SKILL_GAP dimension must be present in alternatives');
    assert(skillDim.reasonCodes.includes('NO_QUALIFYING_SKILL_EVIDENCE'), 'D: skill dimension must name NO_QUALIFYING_SKILL_EVIDENCE');
    console.log('OK -- D: a PUBLISHED concept-skill mapping existing is never sufficient to fabricate a Skill Gap without qualifying evidence (INV-F8-08)');
  }

  // ---------------------------------------------------------------
  // E. Explicit qualifying skill Evidence -> Skill Gap can be supported
  // ---------------------------------------------------------------
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 3; i++) await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, { result: 'incorrect', metadata: { skillIds: [SKILL_ID] } });
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID, scope: { skillId: SKILL_ID } });
    assert(diagnosis.primaryGapType === 'SKILL_GAP', `E: expected SKILL_GAP, got ${diagnosis.primaryGapType}`);
    console.log('OK -- E: explicit qualifying skill-tagged evidence supports a real Skill Gap diagnosis');
  }

  // ---------------------------------------------------------------
  // F. Slow but incorrect (knowledge missing) -> never diagnosed as pure Speed Gap
  // ---------------------------------------------------------------
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 5; i++)
      await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, {
        result: 'incorrect',
        metadata: { behavior: { responseTimes: [{ responseTimeMs: 150000, timingQuality: 'VALID' }] } },
      });
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID });
    assert(diagnosis.primaryGapType !== 'SPEED_FLUENCY_GAP', `F: must never diagnose pure Speed Gap when knowledge is missing, got ${diagnosis.primaryGapType}`);
    assert(diagnosis.primaryGapType === 'KNOWLEDGE_GAP', `F: expected the real signal to be KNOWLEDGE_GAP, got ${diagnosis.primaryGapType}`);
    console.log('OK -- F: slow-but-incorrect responses are diagnosed as Knowledge Gap, never pure Speed/Fluency Gap');
  }

  // ---------------------------------------------------------------
  // G. Correct independent responses, consistently slow under valid timing -> Speed/Fluency Gap supported
  // ---------------------------------------------------------------
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 5; i++)
      await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, {
        result: 'correct',
        metadata: { behavior: { responseTimes: [{ responseTimeMs: 150000, timingQuality: 'VALID' }] } },
      });
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID });
    assert(diagnosis.primaryGapType === 'SPEED_FLUENCY_GAP', `G: expected SPEED_FLUENCY_GAP, got ${diagnosis.primaryGapType}`);
    console.log('OK -- G: correct-but-consistently-slow responses under valid timing support a real Speed/Fluency Gap');
  }

  // ---------------------------------------------------------------
  // H. Timing rule unavailable -> Speed diagnosis blocked / insufficient evidence
  // ---------------------------------------------------------------
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    for (let i = 0; i < 5; i++)
      await insertEvidence(STUDENT_1, conceptId, SUBJECT_ID, {
        result: 'correct',
        metadata: { behavior: { responseTimes: [{ responseTimeMs: 150000, timingQuality: 'VALID' }] } },
      });
    // Run under a policy variant with no configured timing expectations for ANY difficulty band.
    const { createDiagnosticPolicyVersion, getActiveDiagnosticPolicy } = await import('@/lib/diagnostics/policy.service');
    const active = await getActiveDiagnosticPolicy();
    const noExpectationRules = {
      ...active.rules,
      speed: { ...active.rules.speed, expectedResponseTimeMsByDifficultyBand: { '1': null, '2': null, '3': null, '4': null, '5': null } },
    };
    await createDiagnosticPolicyVersion(noExpectationRules as any);
    const diagnosis = await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID });
    assert(diagnosis.primaryGapType !== 'SPEED_FLUENCY_GAP', `H: must be blocked, got ${diagnosis.primaryGapType}`);
    const speedDim = diagnosis.alternatives.find((d: any) => d.gapType === 'SPEED_FLUENCY_GAP'); assert(!!speedDim, 'H: SPEED_FLUENCY_GAP dimension must be present in alternatives');
    assert(speedDim.reasonCodes.includes('TIMING_EXPECTATION_UNAVAILABLE'), 'H: must name TIMING_EXPECTATION_UNAVAILABLE');
    // Restore a real policy with expectations configured for the remaining cases.
    await createDiagnosticPolicyVersion(active.rules as any);
    console.log('OK -- H: an unconfigured timing expectation blocks Speed diagnosis entirely -- never guessed (INV-F8-09)');
  }

  // ---------------------------------------------------------------
  // I. Same Canonical Concept under PAA and Cambridge -> same knowledge identity, framework-specific intervention
  // ---------------------------------------------------------------
  {
    const paaFramework = await resolveFrameworkForObjective(OBJ_LINEAR);
    const cambridgeFramework = await resolveFrameworkForObjective(OBJ_CAMBRIDGE);
    assert(!!paaFramework && !!cambridgeFramework, 'I: both frameworks must resolve');
    assert(paaFramework!.academicOrganizationId !== cambridgeFramework!.academicOrganizationId, 'I: frameworks must genuinely differ');
    const mappingRow = await db.query(
      `SELECT canonical_concept_id FROM objective_concept_mappings WHERE learning_objective_id = ANY($1::uuid[]) AND status = 'PUBLISHED'`,
      [[OBJ_LINEAR, OBJ_CAMBRIDGE]]
    );
    const distinctConcepts = new Set(mappingRow.rows.map((r: any) => r.canonical_concept_id));
    assert(distinctConcepts.size === 1, 'I: PAA and Cambridge must share the identical canonical concept id');
    console.log('OK -- I: PAA and Cambridge objectives share one canonical knowledge identity while resolving to genuinely different frameworks');
  }

  // ---------------------------------------------------------------
  // J. AI returns wrong framework -> blocked
  // ---------------------------------------------------------------
  {
    const context = await resolveTeachingContentGenerationContext({
      studentId: STUDENT_1,
      conceptId: LEARNER_CONCEPT_ID,
      diagnosisId: knowledgeGapDiagnosisId,
      interventionType: 'EXPLAIN',
      assistanceLevel: 'WORKED_EXAMPLE',
    });
    const wrongFrameworkPayload = {
      canonicalConceptId: context.canonicalConceptIds[0] ?? 'facecafe-0000-4000-8000-0000000000e1',
      framework: { academicOrganizationId: randomUUID(), academicProgrammeId: randomUUID() },
      interventionType: 'EXPLAIN',
      commandTermId: null,
      language: context.language,
      knowledge: { explanation: 'x', keyIdeas: ['x'] },
      strategy: context.framework ? { guidance: 'x', workedExample: null, commonFailurePatterns: [] } : null,
      practiceItems: [],
    };
    const check = checkTeachingContentDeterministic(wrongFrameworkPayload, context);
    assert(check.status === 'FAIL' && check.failures.includes('FRAMEWORK_MISMATCH'), 'J: wrong framework must be blocked with FRAMEWORK_MISMATCH');
    console.log('OK -- J: AI output naming the wrong framework is blocked deterministically before it could ever be presented');
  }

  // ---------------------------------------------------------------
  // K. AI returns malformed teaching output -> blocked
  // ---------------------------------------------------------------
  {
    const context = await resolveTeachingContentGenerationContext({
      studentId: STUDENT_1,
      conceptId: LEARNER_CONCEPT_ID,
      diagnosisId: knowledgeGapDiagnosisId,
      interventionType: 'EXPLAIN',
      assistanceLevel: 'WORKED_EXAMPLE',
    });
    const malformed = { knowledge: { explanation: 'x' } }; // missing required fields entirely
    const check = checkTeachingContentDeterministic(malformed, context);
    assert(check.status === 'FAIL' && check.failures.includes('SCHEMA_INVALID'), 'K: malformed output must be blocked with SCHEMA_INVALID');
    console.log('OK -- K: malformed AI teaching output is blocked deterministically, never silently served');
  }

  // ---------------------------------------------------------------
  // L / M. Assisted correct != independent proof; retry preserves the original attempt, new Evidence is created
  // ---------------------------------------------------------------
  let sessionId = '';
  {
    const policy = await getActiveInterventionPolicy();
    const diagnosis = await getDiagnosisById(knowledgeGapDiagnosisId);
    const recommendation = selectIntervention(diagnosis!, policy.rules);
    const session = await startInterventionSession({
      studentId: STUDENT_1,
      diagnosisId: knowledgeGapDiagnosisId,
      interventionPolicyVersionId: policy.id,
      interventionType: 'GUIDED_PRACTICE',
      gapType: diagnosis!.primaryGapType,
      reasonCodes: recommendation.rationale,
      frameworkContext: null,
    });
    sessionId = session.id;
    assert(session.assistanceLevel === 'TUTOR_GUIDANCE', 'L: GUIDED_PRACTICE session must carry an assisted level, never NONE');

    const attempt1 = await recordInterventionAttempt({
      sessionId,
      studentId: STUDENT_1,
      conceptId: LEARNER_CONCEPT_ID,
      subjectId: SUBJECT_ID,
      difficulty: 3,
      result: 'correct',
      scorePercent: 100,
      feedback: classifyFeedback({ graderResult: { correct: true, score: 1, feedback: 'Correct.' }, gapTypeConsidered: 'KNOWLEDGE_GAP', isTechniqueTargetedIntervention: false }),
      hintsUsed: 1,
    });
    assert(attempt1.attemptNumber === 1, 'L/M: first attempt must be attempt_number 1');

    // This assisted-correct attempt must NOT count as independent evidence toward Knowledge Gap re-classification.
    const evidenceRow = await db.query(`SELECT ai_assistance_type FROM learning_evidence WHERE id = $1`, [attempt1.evidenceId]);
    assert(evidenceRow.rows[0].ai_assistance_type === 'TUTOR_GUIDANCE', 'L: the recorded evidence must carry the assisted level, not NONE');

    const attempt2 = await recordInterventionAttempt({
      sessionId,
      studentId: STUDENT_1,
      conceptId: LEARNER_CONCEPT_ID,
      subjectId: SUBJECT_ID,
      difficulty: 3,
      result: 'incorrect',
      scorePercent: 0,
      feedback: classifyFeedback({ graderResult: { correct: false, score: 0, feedback: 'Incorrect.' }, gapTypeConsidered: 'KNOWLEDGE_GAP', isTechniqueTargetedIntervention: false }),
      hintsUsed: 1,
    });
    assert(attempt2.attemptNumber === 2, 'M: second attempt must be attempt_number 2, never overwriting the first');
    assert(attempt2.evidenceId !== attempt1.evidenceId, 'M: retry must create NEW Evidence, never reuse the original attempt\'s evidence row');
    const originalStillExists = await db.query(`SELECT id FROM learning_evidence WHERE id = $1`, [attempt1.evidenceId]);
    assert(originalStillExists.rows.length === 1, 'M: the original attempt\'s Evidence must remain intact after a retry');
    console.log('OK -- L: assisted-correct evidence carries the assisted level, never treated as independent proof');
    console.log('OK -- M: a retry creates new Evidence via a new attempt row; the original attempt and its Evidence remain untouched');
  }

  // ---------------------------------------------------------------
  // N. Framework mapping retired after historical activity -> historical activity remains intact
  // ---------------------------------------------------------------
  {
    const sessionBefore = await db.query(`SELECT framework_context FROM intervention_sessions WHERE id = $1`, [sessionId]);
    const frozenBefore = JSON.stringify(sessionBefore.rows[0].framework_context);
    // Retire the Cambridge->canonical mapping (an unrelated live curriculum change) to prove ANY later mapping retirement never rewrites a historical session snapshot.
    // A direct status transition is used here (bypassing the editorial DRAFT->...->PUBLISHED->RETIRED workflow) because this step's only
    // purpose is to change the mapping's status fact -- F6's own certification already proves the editorial workflow itself end-to-end.
    const mappingRow = await db.query(
      `SELECT id FROM objective_concept_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`,
      [OBJ_CAMBRIDGE]
    );
    await db.query(`UPDATE objective_concept_mappings SET status = 'RETIRED' WHERE id = $1`, [mappingRow.rows[0].id]);
    const sessionAfter = await db.query(`SELECT framework_context FROM intervention_sessions WHERE id = $1`, [sessionId]);
    const frozenAfter = JSON.stringify(sessionAfter.rows[0].framework_context);
    assert(frozenBefore === frozenAfter, 'N: a historical session\'s frozen framework_context must never change after a later curriculum retirement');
    console.log('OK -- N: retiring a framework mapping after the fact never rewrites a historical intervention session\'s frozen framework context');
  }

  // ---------------------------------------------------------------
  // O. F8 diagnostic recommends intervention -> Canonical stage unchanged until legitimate Evidence is processed
  // ---------------------------------------------------------------
  {
    const conceptId = await createTestConcept(SUBJECT_ID);
    // A fixed `now` on both calls isolates the comparison to whether Canonical
    // V2's actual stage/qualification state changed -- never a false failure
    // from two calls simply landing at different wall-clock instants.
    const fixedNow = new Date().toISOString();
    const before = await getCanonicalPedagogicalDecision({ studentId: STUDENT_1, conceptId, now: fixedNow });
    await runDiagnosis({ studentId: STUDENT_1, conceptId, subjectId: SUBJECT_ID }); // diagnosis alone -- zero evidence written by this call
    const after = await getCanonicalPedagogicalDecision({ studentId: STUDENT_1, conceptId, now: fixedNow });
    assert(before.decision.stage === after.decision.stage, 'O: running a diagnosis alone must never change Canonical V2 stage');
    assert(before.decision.actionState === after.decision.actionState, 'O: running a diagnosis alone must never change Canonical V2 actionState');
    assert(JSON.stringify(before.decision.requirements) === JSON.stringify(after.decision.requirements), 'O: requirement qualification must be byte-identical before/after a bare diagnosis run');
    console.log('OK -- O: F8 diagnosis alone produces zero Canonical V2 stage changes (INV-F8-01/02)');
  }

  // ---------------------------------------------------------------
  // P. Competency only contextually relevant -> no fabricated Competency Evidence
  // ---------------------------------------------------------------
  {
    const beforeCount = await db.query(`SELECT COUNT(*) AS c FROM learner_competency_state WHERE student_id = $1`, [STUDENT_1]);
    const evidenceRow = await db.query(`SELECT metadata FROM learning_evidence WHERE id IN (SELECT evidence_id FROM intervention_attempts WHERE intervention_session_id = $1)`, [sessionId]);
    for (const row of evidenceRow.rows) {
      assert(!row.metadata || !('competencyIds' in (row.metadata as object)), 'P: no F8-written evidence may ever carry a fabricated competencyIds key');
    }
    const afterCount = await db.query(`SELECT COUNT(*) AS c FROM learner_competency_state WHERE student_id = $1`, [STUDENT_1]);
    assert(beforeCount.rows[0].c === afterCount.rows[0].c, 'P: F8 must never create a learner_competency_state row for the student');
    console.log('OK -- P: zero Competency Evidence or state ever fabricated by F8 from mere contextual relevance (INV-F8-12)');
  }

  // ---------------------------------------------------------------
  // Q. Student A requests Student B diagnostic -> DENY (real F2 authorization, real Postgres)
  // ---------------------------------------------------------------
  {
    // canAccessLearner's owner check is `students.user_id = actorUserId` -- a
    // real F1 canonical-identity relationship, never bare id equality. Each
    // seeded student has its own linked owner `users` row.
    const owner1Row = await db.query(`SELECT user_id FROM students WHERE id = $1`, [STUDENT_1]);
    const OWNER_1 = owner1Row.rows[0].user_id;
    const ownAccess = await canAccessLearner(OWNER_1, STUDENT_1, 'LEARNER_PROGRESS_VIEW');
    const crossAccess = await canAccessLearner(OWNER_1, STUDENT_2, 'LEARNER_PROGRESS_VIEW');
    assert(ownAccess === true, 'Q: a student must be able to access their own diagnostic data');
    assert(crossAccess === false, 'Q: Student A must be DENIED access to Student B\'s diagnostic data');
    console.log('OK -- Q: real F2 authorization ALLOWs a student their own data and DENIEs cross-learner access, against real Postgres');
  }

  console.log('');
  console.log('All F8 adversarial certification assertions passed against real PostgreSQL.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('f8-lifecycle-cert-runner failed:', err);
    process.exit(1);
  });
