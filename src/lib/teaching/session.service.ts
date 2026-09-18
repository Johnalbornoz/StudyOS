/**
 * F8 -- intervention_sessions + intervention_attempts (task §30/§20).
 * One frozen "launch" row + append-only child attempt rows, mirroring
 * F7's exam_attempts/exam_attempt_item_responses precedent. Retry never
 * overwrites a prior attempt (task §20/case M). PROVE-type sessions
 * never accept a recorded attempt here (see
 * F8_INTERVENTION_SELECTION_MODEL.md's PROVE handling section).
 */
import { randomUUID } from 'crypto';
import { db, type DbExecutor } from '@/lib/db';
import { writeInterventionEvidence } from './evidence-integration.service';
import { DEFAULT_ASSISTANCE_LEVEL_BY_INTERVENTION } from './types';
import type { AssistanceLevel, FrameworkIdentity, InterventionAttempt, InterventionSession, InterventionType } from './types';
import type { AttemptFeedback } from './feedback.service';

export class ProveNotRecordableHereError extends Error {
  constructor() {
    super('PROVE_NOT_RECORDABLE_HERE');
    this.name = 'ProveNotRecordableHereError';
  }
}

function toSession(row: {
  id: string;
  student_id: string;
  diagnosis_id: string;
  intervention_policy_version_id: string;
  intervention_type: InterventionType;
  gap_type: string;
  reason_codes: string[];
  framework_context: FrameworkIdentity | null;
  assistance_level: AssistanceLevel | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  created_at: string | Date;
  completed_at: string | Date | null;
}): InterventionSession {
  return {
    id: row.id,
    studentId: row.student_id,
    diagnosisId: row.diagnosis_id,
    interventionPolicyVersionId: row.intervention_policy_version_id,
    interventionType: row.intervention_type,
    gapType: row.gap_type as InterventionSession['gapType'],
    reasonCodes: row.reason_codes ?? [],
    frameworkContext: row.framework_context ?? null,
    assistanceLevel: row.assistance_level,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at,
  };
}

function toAttempt(row: {
  id: string;
  intervention_session_id: string;
  attempt_number: number;
  evidence_id: string;
  outcome: 'correct' | 'incorrect' | 'partial';
  feedback: Record<string, unknown>;
  created_at: string | Date;
}): InterventionAttempt {
  return {
    id: row.id,
    interventionSessionId: row.intervention_session_id,
    attemptNumber: row.attempt_number,
    evidenceId: row.evidence_id,
    outcome: row.outcome,
    feedback: row.feedback ?? {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export async function startInterventionSession(params: {
  studentId: string;
  diagnosisId: string;
  interventionPolicyVersionId: string;
  interventionType: InterventionType;
  gapType: string;
  reasonCodes: string[];
  frameworkContext: FrameworkIdentity | null;
}): Promise<InterventionSession> {
  const assistanceLevel = DEFAULT_ASSISTANCE_LEVEL_BY_INTERVENTION[params.interventionType];
  const result = await db.query(
    `
    INSERT INTO intervention_sessions (
      student_id, diagnosis_id, intervention_policy_version_id, intervention_type, gap_type, reason_codes, framework_context, assistance_level
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
    `,
    [
      params.studentId,
      params.diagnosisId,
      params.interventionPolicyVersionId,
      params.interventionType,
      params.gapType,
      params.reasonCodes,
      params.frameworkContext ? JSON.stringify(params.frameworkContext) : null,
      assistanceLevel,
    ]
  );
  return toSession(result.rows[0]);
}

export async function getInterventionSession(sessionId: string, client: DbExecutor = db): Promise<InterventionSession | null> {
  const result = await client.query(`SELECT * FROM intervention_sessions WHERE id = $1`, [sessionId]);
  if (result.rows.length === 0) return null;
  return toSession(result.rows[0]);
}

export async function listAttemptsForSession(sessionId: string, client: DbExecutor = db): Promise<InterventionAttempt[]> {
  const result = await client.query(
    `SELECT * FROM intervention_attempts WHERE intervention_session_id = $1 ORDER BY attempt_number ASC`,
    [sessionId]
  );
  return result.rows.map(toAttempt);
}

export async function completeInterventionSession(sessionId: string): Promise<InterventionSession> {
  const result = await db.query(
    `UPDATE intervention_sessions SET status = 'COMPLETED', completed_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING *`,
    [sessionId]
  );
  if (result.rows.length === 0) throw new Error(`intervention session ${sessionId} not found or not ACTIVE`);
  return toSession(result.rows[0]);
}

export interface RecordInterventionAttemptParams {
  sessionId: string;
  studentId: string;
  conceptId: string;
  subjectId: string;
  skillId?: string;
  commandTermId?: string | null;
  questionType?: string | null;
  reasoningRequirement?: string | null;
  difficulty: number;
  result: 'correct' | 'incorrect' | 'partial';
  scorePercent: number;
  feedback: AttemptFeedback;
  hintsUsed: number;
  timing?: { questionPresentedAt: string; answerSubmittedAt: string };
}

/**
 * The session row is locked (SELECT ... FOR UPDATE) for the duration
 * of this call so concurrent attempts on the SAME session never
 * compute the same attempt_number -- the actual evidence write still
 * goes through updateMastery's own separate transaction/connection
 * (idempotent per operation_key), so no deadlock risk: this lock never
 * touches learning_evidence.
 */
export async function recordInterventionAttempt(params: RecordInterventionAttemptParams): Promise<InterventionAttempt> {
  const lockClient = await db.connect();
  try {
    await lockClient.query('BEGIN');
    const sessionRow = await lockClient.query(`SELECT * FROM intervention_sessions WHERE id = $1 FOR UPDATE`, [params.sessionId]);
    if (sessionRow.rows.length === 0) throw new Error(`intervention session ${params.sessionId} not found`);
    const session = toSession(sessionRow.rows[0]);

    if (session.studentId !== params.studentId) throw new Error('FORBIDDEN');
    if (session.interventionType === 'PROVE') throw new ProveNotRecordableHereError();
    if (session.status !== 'ACTIVE') throw new Error(`intervention session ${params.sessionId} is not ACTIVE`);

    const countResult = await lockClient.query(`SELECT COUNT(*) AS count FROM intervention_attempts WHERE intervention_session_id = $1`, [params.sessionId]);
    const attemptNumber = Number(countResult.rows[0].count) + 1;
    const interventionAttemptId = randomUUID();

    const { evidenceId } = await writeInterventionEvidence({
      studentId: params.studentId,
      conceptId: params.conceptId,
      subjectId: params.subjectId,
      interventionSessionId: params.sessionId,
      interventionAttemptId,
      interventionType: session.interventionType as Exclude<InterventionType, 'PROVE'>,
      result: params.result,
      scorePercent: params.scorePercent,
      difficulty: params.difficulty,
      skillId: params.skillId,
      framework: session.frameworkContext,
      commandTermId: params.commandTermId,
      questionType: params.questionType,
      reasoningRequirement: params.reasoningRequirement,
      assistanceLevel: (session.assistanceLevel ?? 'NONE') as AssistanceLevel,
      hintsUsed: params.hintsUsed,
      timing: params.timing,
      diagnosisId: session.diagnosisId,
      attemptNumber,
    });

    const attemptResult = await lockClient.query(
      `
      INSERT INTO intervention_attempts (id, intervention_session_id, attempt_number, evidence_id, outcome, feedback)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [interventionAttemptId, params.sessionId, attemptNumber, evidenceId, params.result, JSON.stringify(params.feedback)]
    );
    await lockClient.query('COMMIT');
    return toAttempt(attemptResult.rows[0]);
  } catch (err) {
    await lockClient.query('ROLLBACK');
    throw err;
  } finally {
    lockClient.release();
  }
}
