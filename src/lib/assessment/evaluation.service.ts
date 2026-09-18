/**
 * F7 -- Evaluation Contract (task 27). Persists whatever result one of
 * the FOUR EXISTING graders (gradeStructuredAnswer/gradeAnswer/
 * evaluateExplanation/evaluateTransferResponse) already computed, in one
 * common envelope -- F7 never reimplements grading logic, only the
 * persistence contract (raw response, score, max score, criteria
 * breakdown, feedback, model/version, provenance).
 */
import { db } from '@/lib/db';
import type { EvaluationResult } from './types';

export async function recordExamAttemptItemResponse(params: {
  examAttemptId: string;
  assessmentComponentId: string;
  learningObjectiveId?: string;
  approvedItemId?: string;
  itemSnapshot: Record<string, unknown>;
  evaluation: EvaluationResult;
  reasoningTrace?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO exam_attempt_item_responses (
       exam_attempt_id, assessment_component_id, learning_objective_id, approved_item_id, item_snapshot,
       raw_response, score, max_score, criteria_breakdown, feedback, evaluation_model_version, evaluation_provenance, reasoning_trace
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      params.examAttemptId,
      params.assessmentComponentId,
      params.learningObjectiveId ?? null,
      params.approvedItemId ?? null,
      JSON.stringify(params.itemSnapshot),
      params.evaluation.rawResponse !== undefined ? JSON.stringify(params.evaluation.rawResponse) : null,
      params.evaluation.score,
      params.evaluation.maxScore,
      params.evaluation.criteriaBreakdown ? JSON.stringify(params.evaluation.criteriaBreakdown) : null,
      params.evaluation.feedback,
      params.evaluation.evaluationModelVersion,
      params.evaluation.provenance ? JSON.stringify(params.evaluation.provenance) : null,
      params.reasoningTrace ? JSON.stringify(params.reasoningTrace) : null,
    ]
  );
  return result.rows[0];
}

export async function getAttemptItemResponse(responseId: string): Promise<any | null> {
  const result = await db.query(`SELECT * FROM exam_attempt_item_responses WHERE id = $1`, [responseId]);
  return result.rows.length === 0 ? null : result.rows[0];
}

export async function listResponsesForAttempt(examAttemptId: string): Promise<any[]> {
  const result = await db.query(`SELECT * FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttemptId]);
  return result.rows;
}
