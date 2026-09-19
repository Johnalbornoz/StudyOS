/**
 * F9 -- scoring integration (task §28). Chooses among the FOUR
 * EXISTING graders by item shape -- exactly as F8's
 * recordInterventionAttempt already does -- then persists via F7's
 * real, unmodified recordExamAttemptItemResponse. No new grading
 * logic anywhere in F9.
 */
import { db } from '@/lib/db';
import { gradeStructuredAnswer, gradeAnswer, type GeneratedQuestion } from '@/services/quiz-generation.service';
import { recordExamAttemptItemResponse } from '@/lib/assessment/evaluation.service';
import type { EvaluationResult } from '@/lib/assessment/types';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { updateMastery } from '@/services/mastery.service';

const STRUCTURED_FORMATS = new Set(['single_choice', 'multi_choice', 'matching', 'ordering', 'classification']);

/**
 * Also writes real learning_evidence for the response, through the
 * SAME writer F7's own evidence-bridge and F8's evidence-integration
 * already use (updateMastery, sourceType 'EXAM_SIMULATION' -- the
 * pre-existing F5 evidence source type, never a new one). A simulation
 * attempt is independent evidence by definition (no hint/scaffold path
 * exists inside an exam attempt) -- ai_assistance_type is always
 * 'NONE'. Metadata keys are attached only when genuinely resolved,
 * never fabricated (mirrors F7/F8's own INV-F7-18/INV-F8-12
 * discipline).
 */
export async function recordSimulationItemResponse(params: {
  examAttemptId: string;
  studentId: string;
  examVersionId: string;
  assessmentComponentId: string;
  learningObjectiveId?: string;
  commandTermId?: string | null;
  question: GeneratedQuestion;
  studentAnswer: string;
  language?: string;
  /**
   * Task §54/AC-F9-28: a caller-supplied, stable id for THIS logical
   * submission (minted once, round-tripped unchanged through any
   * transport retry -- never regenerated per attempt, which would make
   * every retry look new). When a response already exists for
   * (examAttemptId, idempotencyKey), that EXISTING response is
   * returned untouched -- the grader is never re-invoked and NO
   * duplicate Evidence is ever written.
   */
  idempotencyKey?: string;
}): Promise<{ responseId: string; evaluation: EvaluationResult; evidenceWritten: boolean; duplicate: boolean }> {
  let evaluation: EvaluationResult;

  if (STRUCTURED_FORMATS.has(params.question.answerFormat)) {
    const result = gradeStructuredAnswer(params.question, params.studentAnswer);
    evaluation = { rawResponse: params.studentAnswer, score: result.score, maxScore: 1, criteriaBreakdown: null, feedback: result.feedback || null, evaluationModelVersion: null, provenance: null };
  } else {
    const result = await gradeAnswer(params.question, params.studentAnswer, params.language ?? 'en');
    evaluation = {
      rawResponse: params.studentAnswer,
      score: result.score,
      maxScore: 1,
      criteriaBreakdown: { errorType: result.errorType, reasoningValid: result.reasoningValid, confidence: result.confidence },
      feedback: result.feedback,
      evaluationModelVersion: result.aiExecution?.aiModel ?? null,
      provenance: result.aiExecution ? { ...result.aiExecution } : null,
    };
  }

  const { id, duplicate } = await recordExamAttemptItemResponse({
    examAttemptId: params.examAttemptId,
    assessmentComponentId: params.assessmentComponentId,
    learningObjectiveId: params.learningObjectiveId,
    itemSnapshot: params.question as unknown as Record<string, unknown>,
    evaluation,
    idempotencyKey: params.idempotencyKey,
  });

  if (duplicate) {
    // The first application already wrote Evidence (if any) -- a retry
    // must never re-run updateMastery a second time for the same
    // logical submission.
    return { responseId: id, evaluation, evidenceWritten: false, duplicate: true };
  }

  let evidenceWritten = false;
  if (params.learningObjectiveId) {
    const bridge = await resolveActivityMetadataForObjective(params.learningObjectiveId);
    if (bridge && bridge.canonicalConceptIds.length > 0) {
      let studentConceptId: string | null = null;
      for (const canonicalConceptId of bridge.canonicalConceptIds) {
        studentConceptId = await resolveStudentConceptForCanonicalConcept(params.studentId, canonicalConceptId);
        if (studentConceptId) break;
      }
      if (studentConceptId) {
        const subjectRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [studentConceptId]);
        const subjectId = subjectRow.rows[0]?.subject_id;
        if (subjectId) {
          const metadata: Record<string, unknown> = { context: { examAttemptId: params.examAttemptId, simulationSource: true } };
          if (bridge.skillIds.length > 0) metadata.skillIds = bridge.skillIds;
          metadata.framework = { examVersionId: params.examVersionId };
          if (params.commandTermId) metadata.commandTermId = params.commandTermId;
          if (params.question.type) metadata.questionType = params.question.type;

          await updateMastery({
            studentId: params.studentId,
            conceptId: studentConceptId,
            subjectId,
            evidence: { sourceType: 'EXAM_SIMULATION', result: evaluation.score >= 1 ? 'correct' : evaluation.score > 0 ? 'partial' : 'incorrect', difficulty: params.question.difficulty, scorePercent: evaluation.maxScore > 0 ? (evaluation.score / evaluation.maxScore) * 100 : 0 },
            telemetry: { activityType: 'EXAM_SIMULATION', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' },
            metadata,
            identity: params.idempotencyKey ? { operationType: 'EXAM_SIMULATION_RESPONSE', operationId: params.idempotencyKey, conceptId: studentConceptId } : undefined,
          });
          evidenceWritten = true;
        }
      }
    }
  }

  return { responseId: id, evaluation, evidenceWritten, duplicate: false };
}

export async function getSimulationScoreSummary(examAttemptId: string): Promise<{ rawScore: number; maxScore: number; byComponent: Record<string, { score: number; maxScore: number }> }> {
  const result = await db.query(`SELECT assessment_component_id, score, max_score FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttemptId]);
  const byComponent: Record<string, { score: number; maxScore: number }> = {};
  let rawScore = 0;
  let maxScore = 0;
  for (const row of result.rows) {
    const s = Number(row.score) || 0;
    const m = Number(row.max_score) || 0;
    rawScore += s;
    maxScore += m;
    if (!byComponent[row.assessment_component_id]) byComponent[row.assessment_component_id] = { score: 0, maxScore: 0 };
    byComponent[row.assessment_component_id].score += s;
    byComponent[row.assessment_component_id].maxScore += m;
  }
  return { rawScore, maxScore, byComponent };
}
