import { db } from '@/lib/db';

/**
 * Minimal, server-side-only read access into the Phase 0E2 audit
 * tables (Step 28). No API route, no UI -- deliberately deferred per
 * the task's own instruction ("Prefer deferring UI/API exposure").
 * Exists for tests, debugging, and a future admin surface to build on
 * once one naturally supports it.
 */

export interface AIExecutionEventRow {
  id: string;
  executionId: string;
  capability: string;
  risk: string;
  provider: string;
  model: string;
  promptId: string;
  promptVersion: string;
  status: 'SUCCESS' | 'FAILURE';
  validationStatus: 'PASSED' | 'FAILED' | 'NOT_APPLICABLE';
  fallbackUsed: boolean;
  errorCode: string | null;
  durationMs: number;
  studentId: string | null;
  subjectId: string | null;
  conceptId: string | null;
  sourceComponent: string | null;
  sourceId: string | null;
  createdAt: string;
}

function rowToAIExecutionEvent(row: any): AIExecutionEventRow {
  return {
    id: row.id,
    executionId: row.execution_id,
    capability: row.capability,
    risk: row.risk,
    provider: row.provider,
    model: row.model,
    promptId: row.prompt_id,
    promptVersion: row.prompt_version,
    status: row.status,
    validationStatus: row.validation_status,
    fallbackUsed: row.fallback_used,
    errorCode: row.error_code,
    durationMs: row.duration_ms,
    studentId: row.student_id,
    subjectId: row.subject_id,
    conceptId: row.concept_id,
    sourceComponent: row.source_component,
    sourceId: row.source_id,
    createdAt: row.created_at,
  };
}

/** Step 24 Question A: given an AI execution id, which provider/model/prompt/version ran? */
export async function getAIExecution(executionId: string): Promise<AIExecutionEventRow | null> {
  const result = await db.query(`SELECT * FROM ai_execution_events WHERE execution_id = $1`, [executionId]);
  return result.rows[0] ? rowToAIExecutionEvent(result.rows[0]) : null;
}

export interface DecisionEventRow {
  id: string;
  decisionId: string;
  decisionType: string;
  engine: string;
  engineVersion: string;
  studentId: string | null;
  subjectId: string | null;
  conceptId: string | null;
  sourceEventType: string | null;
  sourceEventId: string | null;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  reasonCode: string | null;
  reasonDetails: Record<string, unknown> | null;
  aiExecutionId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

function rowToDecisionEvent(row: any): DecisionEventRow {
  return {
    id: row.id,
    decisionId: row.decision_id,
    decisionType: row.decision_type,
    engine: row.engine,
    engineVersion: row.engine_version,
    studentId: row.student_id,
    subjectId: row.subject_id,
    conceptId: row.concept_id,
    sourceEventType: row.source_event_type,
    sourceEventId: row.source_event_id,
    previousState: row.previous_state,
    newState: row.new_state,
    reasonCode: row.reason_code,
    reasonDetails: row.reason_details,
    aiExecutionId: row.ai_execution_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

/** One decision event by its decision_id. */
export async function getDecisionEvent(decisionId: string): Promise<DecisionEventRow | null> {
  const result = await db.query(`SELECT * FROM decision_events WHERE decision_id = $1`, [decisionId]);
  return result.rows[0] ? rowToDecisionEvent(result.rows[0]) : null;
}

/**
 * Step 24 Question E: given a student+concept, the full sequence of
 * auditable state decisions, oldest first.
 */
export async function getDecisionsForStudentConcept(studentId: string, conceptId: string): Promise<DecisionEventRow[]> {
  const result = await db.query(
    `SELECT * FROM decision_events WHERE student_id = $1 AND concept_id = $2 ORDER BY created_at ASC`,
    [studentId, conceptId]
  );
  return result.rows.map(rowToDecisionEvent);
}

/**
 * Step 24 Questions B/C: the full trace for one decision -- the
 * decision itself, and (when it links to one) the AI execution that
 * produced its evidence. Question B (which learning evidence/source
 * caused it) is answered by the decision's own sourceEventType/
 * sourceEventId; this function resolves Question C's next hop.
 */
export async function getDecisionTrace(decisionId: string): Promise<{ decision: DecisionEventRow; aiExecution: AIExecutionEventRow | null } | null> {
  const decision = await getDecisionEvent(decisionId);
  if (!decision) return null;
  const aiExecution = decision.aiExecutionId ? await getAIExecution(decision.aiExecutionId) : null;
  return { decision, aiExecution };
}
