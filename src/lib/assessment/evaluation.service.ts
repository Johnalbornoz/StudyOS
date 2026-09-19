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

/** Postgres unique_violation on idx_exam_attempt_item_responses_idempotency -- same detection idiom as mastery.service.ts's own operation_key conflict handling. */
const PG_UNIQUE_VIOLATION = '23505';
const IDEMPOTENCY_CONSTRAINT = 'idx_exam_attempt_item_responses_idempotency';

function isIdempotencyConflict(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string } | undefined;
  return pgErr?.code === PG_UNIQUE_VIOLATION && pgErr?.constraint === IDEMPOTENCY_CONSTRAINT;
}

export async function recordExamAttemptItemResponse(params: {
  examAttemptId: string;
  assessmentComponentId: string;
  learningObjectiveId?: string;
  approvedItemId?: string;
  itemSnapshot: Record<string, unknown>;
  evaluation: EvaluationResult;
  reasoningTrace?: Record<string, unknown>;
  /**
   * F9 (task §54/AC-F9-28): optional, purely additive -- when supplied
   * and a response with the same (examAttemptId, idempotencyKey) was
   * already recorded, that EXISTING row is returned instead of
   * inserting a duplicate. Omitted entirely by every pre-F9 caller,
   * which keeps today's unprotected (never-retried-by-design) behavior
   * unchanged, exactly as F5's own operation_key was introduced.
   */
  idempotencyKey?: string;
}): Promise<{ id: string; duplicate?: boolean }> {
  if (params.idempotencyKey) {
    const existing = await db.query(
      `SELECT id FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 AND idempotency_key = $2`,
      [params.examAttemptId, params.idempotencyKey]
    );
    if (existing.rows.length > 0) return { id: existing.rows[0].id, duplicate: true };
  }

  try {
    const result = await db.query(
      `INSERT INTO exam_attempt_item_responses (
         exam_attempt_id, assessment_component_id, learning_objective_id, approved_item_id, item_snapshot,
         raw_response, score, max_score, criteria_breakdown, feedback, evaluation_model_version, evaluation_provenance, reasoning_trace, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
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
        params.idempotencyKey ?? null,
      ]
    );
    return result.rows[0];
  } catch (err) {
    // A genuinely concurrent duplicate submission can lose the SELECT-then-INSERT
    // race above -- the database, not the preceding SELECT, is the final
    // arbiter (same discipline as mastery.service.ts's own operation_key gate).
    if (params.idempotencyKey && isIdempotencyConflict(err)) {
      const existing = await db.query(
        `SELECT id FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 AND idempotency_key = $2`,
        [params.examAttemptId, params.idempotencyKey]
      );
      if (existing.rows.length > 0) return { id: existing.rows[0].id, duplicate: true };
    }
    throw err;
  }
}

export async function getAttemptItemResponse(responseId: string): Promise<any | null> {
  const result = await db.query(`SELECT * FROM exam_attempt_item_responses WHERE id = $1`, [responseId]);
  return result.rows.length === 0 ? null : result.rows[0];
}

export async function listResponsesForAttempt(examAttemptId: string): Promise<any[]> {
  const result = await db.query(`SELECT * FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttemptId]);
  return result.rows;
}
