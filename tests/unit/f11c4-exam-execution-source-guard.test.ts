/**
 * F11-C4 -- source guards for the Exam Reinforcement invariants:
 * (1) zero direct learning_evidence/learner_skill_state/
 *     learner_competency_state/readiness_snapshots/diagnostic-state/
 *     Canonical writes, and no custom scoring/generation engine;
 * (2) Full Mock Guard (getSimulationEligibility) is called
 *     unconditionally for every simulation_type, never special-cased or
 *     bypassed;
 * (3) exam context (profile/version/objective/subject) comes from the
 *     Teacher's own explicit intervention target, never inferred;
 * (4) the entire claim-and-create sequence runs inside the same
 *     row-locked transaction (the stronger concurrency guarantee task
 *     §31 requires for exam attempts specifically);
 * (5) completion is observed from the real F9 simulation_attempts
 *     status, never a second F11 "exam completed" truth.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ORCHESTRATION_SERVICE = 'src/lib/student/teacher-intervention-execution.service.ts';
const TEACHER_INTERVENTION_SERVICE = 'src/lib/teacher/intervention.service.ts';

describe('F11-C4 Exam Reinforcement never becomes a second Assessment/Simulation/Readiness authority', () => {
  it('required files exist', () => {
    for (const p of [ORCHESTRATION_SERVICE, TEACHER_INTERVENTION_SERVICE]) {
      expect(existsSync(join(process.cwd(), p)), `${p} should exist`).toBe(true);
    }
  });

  it('the orchestration service contains zero direct writes to learning_evidence, mastery_records, learner_skill_state, learner_competency_state, readiness_snapshots, diagnostic state, or any Canonical V2 table', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    expect(src).not.toMatch(/INSERT INTO learning_evidence|UPDATE learning_evidence/);
    expect(src).not.toMatch(/INSERT INTO mastery_records|UPDATE mastery_records/);
    expect(src).not.toMatch(/INSERT INTO learner_skill_state|UPDATE learner_skill_state/);
    expect(src).not.toMatch(/INSERT INTO learner_competency_state|UPDATE learner_competency_state/);
    expect(src).not.toMatch(/INSERT INTO readiness_snapshots|UPDATE readiness_snapshots/);
    expect(src).not.toMatch(/INSERT INTO.*diagnos|UPDATE.*diagnos/i);
    expect(src).not.toMatch(/pedagogical_requirement_recognition|canonical_prepared_activity|concept_transfer_state|concept_knowledge_state/);
    expect(src).not.toMatch(/\bupdateMastery\(/);
    expect(src).not.toMatch(/\bcomputeReadinessSnapshot\(/);
    expect(src).not.toMatch(/\brunDiagnosis\(/);
    expect(src).not.toMatch(/\brunPostExamDiagnosis\(/);
  });

  it('the orchestration service contains no custom scoring/grading/generation engine', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    expect(src).not.toMatch(/gradeAnswer|gradeStructuredAnswer|evaluateExplanation|evaluateTransferResponse/);
    expect(src).not.toMatch(/recordExamAttemptItemResponse|recordSimulationItemResponse/);
  });

  it('startExamReinforcementExecution calls getSimulationEligibility unconditionally -- never special-cased per simulation_type, never skipped for FULL_MOCK', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('async function startExamReinforcementExecution');
    const end = src.indexOf('\nexport async function startTeacherInterventionExecution', start);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).toMatch(/getSimulationEligibility\(/);
    // No conditional branch keyed on simulation_type/simulationType wraps the eligibility call itself.
    expect(body).not.toMatch(/simulationType\s*===\s*'FULL_MOCK'/);
    expect(body).not.toMatch(/simulation_type\s*===\s*'FULL_MOCK'/);
    expect(body).toMatch(/if\s*\(!eligibility\.eligible\)/);
  });

  it('the entire claim-and-create sequence for Exam Reinforcement runs inside one client transaction (the stronger, race-eliminating concurrency model task §31 requires)', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('async function startExamReinforcementExecution');
    const end = src.indexOf('\nexport async function startTeacherInterventionExecution', start);
    const body = src.slice(start, end === -1 ? undefined : end);
    // startSimulationAttempt and the execution-registry INSERT must both appear AFTER BEGIN and BEFORE the function's own COMMIT/ROLLBACK handling -- i.e. no `db.connect()`-releasing pattern splits them into two transactions.
    expect(body).toMatch(/await client\.query\('BEGIN'\)/);
    const beginIndex = body.indexOf(`await client.query('BEGIN')`);
    const startAttemptIndex = body.indexOf('await startSimulationAttempt(');
    const commitIndex = body.lastIndexOf(`await client.query('COMMIT')`);
    expect(startAttemptIndex).toBeGreaterThan(beginIndex);
    expect(startAttemptIndex).toBeLessThan(commitIndex);
    // No `client.release()` (which would end the transaction's connection) appears between BEGIN and the final COMMIT/ROLLBACK -- only in the outer finally.
    const releaseIndex = body.indexOf('client.release()');
    expect(releaseIndex).toBeGreaterThan(commitIndex);
  });

  it('exam context (profile/version/objective/subject) is read from the intervention row itself, never from a client-supplied parameter to startExamReinforcementExecution', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('async function startExamReinforcementExecution');
    const signatureEnd = src.indexOf(')', start);
    const signature = src.slice(start, signatureEnd);
    expect(signature).not.toMatch(/examProfileId|examVersionId|simulationType|learningObjectiveId|academicSubjectId/);
    const bodyStart = src.indexOf('{', signatureEnd);
    const bodyEnd = src.indexOf('\nexport async function startTeacherInterventionExecution', start);
    const body = src.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd);
    expect(body).toMatch(/intervention\.exam_profile_id/);
    expect(body).toMatch(/intervention\.simulation_type/);
  });

  it('completion is observed from the real F9 simulation_attempts status via getSimulationAttempt, never a second F11 "exam completed" truth', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('async function reconcileCompletionsForStudent');
    const end = src.indexOf('\nexport type StartExecutionResult', start);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).toMatch(/getSimulationAttempt\(/);
    expect(body).toMatch(/EXAM_PRACTICE/);
    expect(body).not.toMatch(/completeSimulationAttempt\(/);
  });

  it('exam profile ownership is validated in BOTH the Teacher assignment path and the Student start path (defense in depth, task §7)', () => {
    const teacherSrc = readFileSync(join(process.cwd(), TEACHER_INTERVENTION_SERVICE), 'utf-8');
    expect(teacherSrc).toMatch(/TeacherInterventionExamProfileMismatchError/);
    expect(teacherSrc).toMatch(/profile\.studentId !== params\.studentId/);

    const orchestrationSrc = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = orchestrationSrc.indexOf('async function startExamReinforcementExecution');
    const end = orchestrationSrc.indexOf('\nexport async function startTeacherInterventionExecution', start);
    const body = orchestrationSrc.slice(start, end === -1 ? undefined : end);
    expect(body).toMatch(/profile\.studentId !== intervention\.student_id/);
  });

  it('the Exam path never sets targetSkillIds/targetCompetencyIds on a quiz_sessions row -- it never touches storeQuiz at all', () => {
    const src = readFileSync(join(process.cwd(), ORCHESTRATION_SERVICE), 'utf-8');
    const start = src.indexOf('async function startExamReinforcementExecution');
    const end = src.indexOf('\nexport async function startTeacherInterventionExecution', start);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).not.toMatch(/storeQuiz\(/);
    expect(body).not.toMatch(/generatePracticeQuestions\(/);
  });
});
