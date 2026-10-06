/**
 * Human Agency P0-3 -- the server-side authority for an Explain & Defend
 * task's grading rubric.
 *
 * generate  -> createExplainTask(): persists prompt + expectedElements +
 *              concept label under the server-minted activityId and
 *              returns only what the Student may see (the prompt).
 * submit    -> loadExplainTaskForSubmission(): the ONLY source of the
 *              rubric used to grade and update mastery. The browser never
 *              receives the rubric and can never send one back
 *              (CLIENT_RUBRIC_FIELDS are rejected at the route).
 *
 * Mirrors transfer_task_instances (Phase 7D1). Table:
 * database/migrations/20261105_1000_explain_defend_task_instances.sql.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { ExplainActivityType } from './explain-defend.service';

/** Bump when the rubric shape or its grading semantics change: older tasks are then refused at submit. */
export const EXPLAIN_RUBRIC_VERSION = 'explain-defend-rubric-v1';
export const EXPLAIN_TASK_TTL_HOURS = 24;

/** Body fields that would let a client author or alter the grading criteria. Their mere presence is rejected. */
export const CLIENT_RUBRIC_FIELDS = ['prompt', 'expectedElements', 'conceptLabel', 'rubric', 'rubricVersion'] as const;

export interface ExplainTask {
  id: string;
  studentId: string;
  subjectId: string;
  conceptId: string;
  conceptLabel: string;
  activityType: ExplainActivityType;
  language: string;
  prompt: string;
  expectedElements: string[];
  rubricVersion: string;
  isExpired: boolean;
  consumedAt: Date | null;
}

export type ExplainTaskLoad =
  | { ok: true; task: ExplainTask }
  | { ok: false; code: 'TASK_NOT_FOUND' | 'TASK_EXPIRED' | 'RUBRIC_VERSION_MISMATCH' | 'TASK_MISMATCH' };

export function clientRubricFieldsPresent(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  return CLIENT_RUBRIC_FIELDS.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
}

/**
 * Pure decision over a loaded row. Ownership mismatch is indistinguishable
 * from "not found" (RR-08 convention: never confirm another Student's id).
 */
export function classifyExplainTask(
  task: ExplainTask | null,
  expect: { studentId: string; subjectId?: string; conceptId?: string; currentRubricVersion?: string },
): ExplainTaskLoad {
  if (!task || task.studentId !== expect.studentId) return { ok: false, code: 'TASK_NOT_FOUND' };
  if (task.isExpired) return { ok: false, code: 'TASK_EXPIRED' };
  if (task.rubricVersion !== (expect.currentRubricVersion ?? EXPLAIN_RUBRIC_VERSION)) return { ok: false, code: 'RUBRIC_VERSION_MISMATCH' };
  if ((expect.subjectId && expect.subjectId !== task.subjectId) || (expect.conceptId && expect.conceptId !== task.conceptId)) {
    return { ok: false, code: 'TASK_MISMATCH' };
  }
  return { ok: true, task };
}

export async function createExplainTask(
  input: {
    id: string;
    studentId: string;
    subjectId: string;
    conceptId: string;
    conceptLabel: string;
    activityType: ExplainActivityType;
    language: string;
    prompt: string;
    expectedElements: string[];
    generatorPromptId: string;
    generatorPromptVersion: string;
  },
  client: DbExecutor = db,
): Promise<void> {
  await client.query(
    `INSERT INTO explain_defend_task_instances
       (id, student_id, subject_id, concept_id, concept_label, activity_type, language, prompt, expected_elements,
        rubric_version, generator_prompt_id, generator_prompt_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, now() + make_interval(hours => $13))`,
    [
      input.id, input.studentId, input.subjectId, input.conceptId, input.conceptLabel.slice(0, 300), input.activityType,
      input.language, input.prompt, JSON.stringify(input.expectedElements), EXPLAIN_RUBRIC_VERSION,
      input.generatorPromptId, input.generatorPromptVersion, EXPLAIN_TASK_TTL_HOURS,
    ],
  );
}

export async function loadExplainTaskForSubmission(
  activityId: string,
  expect: { studentId: string; subjectId?: string; conceptId?: string },
  client: DbExecutor = db,
): Promise<ExplainTaskLoad> {
  const r = await client.query(
    `SELECT id, student_id, subject_id, concept_id, concept_label, activity_type, language, prompt, expected_elements,
            rubric_version, consumed_at, (now() >= expires_at) AS is_expired
       FROM explain_defend_task_instances WHERE id = $1`,
    [activityId],
  );
  const row = r.rows[0];
  const task: ExplainTask | null = row
    ? {
        id: row.id,
        studentId: row.student_id,
        subjectId: row.subject_id,
        conceptId: row.concept_id,
        conceptLabel: row.concept_label,
        activityType: row.activity_type,
        language: row.language,
        prompt: row.prompt,
        expectedElements: Array.isArray(row.expected_elements) ? row.expected_elements.map(String) : [],
        rubricVersion: row.rubric_version,
        isExpired: row.is_expired === true,
        consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
      }
    : null;
  return classifyExplainTask(task, expect);
}

/** First successful evidence write wins; later idempotent retries leave it unchanged. */
export async function markExplainTaskConsumed(activityId: string, client: DbExecutor = db): Promise<void> {
  await client.query(`UPDATE explain_defend_task_instances SET consumed_at = COALESCE(consumed_at, now()) WHERE id = $1`, [activityId]);
}
