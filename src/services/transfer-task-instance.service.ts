/**
 * Phase 7 -- Step 7D1: the trusted Transfer task registry.
 *
 * /transfer/generate persists ONE row per served task (keyed by the
 * server-minted transferTaskId); /transfer/submit loads it by id and
 * trusts ONLY the persisted metadata -- the browser is never
 * authoritative for distance / modality / novelty dimensions / target
 * concepts / context domain / task family / novelty_validation_passed.
 *
 * Read-only for learner state. No raw prompt, no answer, no feedback
 * stored here.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { TransferDistance, TransferModality, NoveltyDimension } from '@/lib/transfer-policy';
import { buildOperationKey } from '@/lib/algorithms/evidence-idempotency';
import { launchLockId } from '@/services/activity-launch-lock.service';

export interface TransferTaskInstance {
  id: string; // == transferTaskId
  studentId: string;
  conceptId: string;
  subjectId: string | null;
  transferDistance: TransferDistance;
  transferModality: TransferModality;
  noveltyDimensions: NoveltyDimension[];
  targetConceptIds: string[];
  contextDomain: string | null;
  taskFamilyId: string;
  promptFingerprint: string;
  promptExactHash: string;
  generatorVersion: string | null;
  generatorPromptVersion: string;
  noveltyValidationPassed: boolean;
  createdAt: string;
}

export interface PersistTransferTaskInstanceInput {
  id: string;
  studentId: string;
  conceptId: string;
  subjectId?: string | null;
  transferDistance: TransferDistance;
  transferModality: TransferModality;
  noveltyDimensions: NoveltyDimension[];
  targetConceptIds: string[];
  contextDomain: string | null;
  taskFamilyId: string;
  promptFingerprint: string;
  promptExactHash: string;
  generatorVersion?: string | null;
  generatorPromptVersion: string;
  /** 7D1 always false -- only 7D2's deterministic validator ever writes true. */
  noveltyValidationPassed: boolean;
}

export async function persistTransferTaskInstance(
  input: PersistTransferTaskInstanceInput,
  client: DbExecutor = db,
): Promise<void> {
  await client.query(
    `INSERT INTO transfer_task_instances (
       id, student_id, concept_id, subject_id,
       transfer_distance, transfer_modality, novelty_dimensions, target_concept_ids, context_domain,
       task_family_id, prompt_fingerprint, prompt_exact_hash,
       generator_version, generator_prompt_version, novelty_validation_passed
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO NOTHING`,
    [
      input.id,
      input.studentId,
      input.conceptId,
      input.subjectId ?? null,
      input.transferDistance,
      input.transferModality,
      input.noveltyDimensions,
      input.targetConceptIds,
      input.contextDomain,
      input.taskFamilyId,
      input.promptFingerprint,
      input.promptExactHash,
      input.generatorVersion ?? null,
      input.generatorPromptVersion,
      input.noveltyValidationPassed,
    ],
  );
}

function rowToInstance(row: Record<string, any>): TransferTaskInstance {
  return {
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    subjectId: row.subject_id ?? null,
    transferDistance: row.transfer_distance,
    transferModality: row.transfer_modality,
    noveltyDimensions: Array.isArray(row.novelty_dimensions) ? row.novelty_dimensions : [],
    targetConceptIds: Array.isArray(row.target_concept_ids) ? row.target_concept_ids : [],
    contextDomain: row.context_domain ?? null,
    taskFamilyId: row.task_family_id,
    promptFingerprint: row.prompt_fingerprint,
    promptExactHash: row.prompt_exact_hash,
    generatorVersion: row.generator_version ?? null,
    generatorPromptVersion: row.generator_prompt_version,
    noveltyValidationPassed: row.novelty_validation_passed === true,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Load a persisted task instance by id (== transferTaskId). Null if unknown. */
export async function loadTransferTaskInstance(id: string, client: DbExecutor = db): Promise<TransferTaskInstance | null> {
  const res = await client.query(`SELECT * FROM transfer_task_instances WHERE id = $1`, [id]);
  return res.rows[0] ? rowToInstance(res.rows[0]) : null;
}

/**
 * Phase 7 (7D2): ONE batched existence check for a set of target
 * concept ids -- never a per-id query. Returns the subset that resolves
 * to a real concept row. The 7D2 certifier requires every requested
 * target concept to appear in this result. Empty input -> empty result,
 * no query.
 */
export async function resolveKnownConceptIds(
  ids: readonly string[],
  client: DbExecutor = db,
): Promise<string[]> {
  const unique = [...new Set(ids)].filter((x) => typeof x === 'string' && x.length > 0);
  if (unique.length === 0) return [];
  const res = await client.query(`SELECT id FROM concepts WHERE id = ANY($1::uuid[])`, [unique]);
  return res.rows.map((r) => r.id);
}

/**
 * Recent registry rows for one (student, concept) -- the trusted
 * source for the 7B2 structural-duplicate scan going forward. Bounded.
 */
export async function getRecentTransferTaskFingerprints(
  studentId: string,
  conceptId: string,
  limit: number,
  client: DbExecutor = db,
): Promise<Array<{ transferTaskId: string; promptFingerprint: string }>> {
  const res = await client.query(
    `SELECT id, prompt_fingerprint FROM transfer_task_instances
     WHERE student_id = $1 AND concept_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [studentId, conceptId, Math.max(1, Math.floor(limit))],
  );
  return res.rows.map((r) => ({ transferTaskId: r.id, promptFingerprint: r.prompt_fingerprint }));
}

/**
 * CR-L11-06 -- has this Transfer task already been answered and graded?
 *
 * The proof is state that already exists: a graded submission is applied
 * through `updateMastery` with the identity `TRANSFER :: <transferTaskId> ::
 * <conceptId>`, and that call claims `learning_evidence.operation_key` under
 * a unique index before anything else is written. One row with that key is
 * therefore exactly "this task was graded once" -- no marker column and no
 * schema change are needed. A submission that failed before the evidence was
 * written (a grading error) leaves no row, so the Student can still answer.
 *
 * The caller checks this BEFORE grading and refuses a repeat, so the AI
 * grader is not invoked again for a task that already has its answer.
 * It deliberately does not swallow errors: if the state cannot be read the
 * submission must not proceed to a paid grading call.
 *
 * On its own this closes the sequential repeat only. The concurrent case --
 * two FIRST submissions at the same instant, both reading "not graded" -- is
 * closed by `runTransferSubmissionExclusively` below, which is what the
 * submit route calls.
 */
export async function isTransferTaskAlreadyGraded(transferTaskId: string, conceptId: string, client: DbExecutor = db): Promise<boolean> {
  const operationKey = buildOperationKey({ operationType: 'TRANSFER', operationId: transferTaskId, conceptId });
  const result = await client.query(`SELECT 1 FROM learning_evidence WHERE operation_key = $1 LIMIT 1`, [operationKey]);
  return (result.rows?.length ?? 0) > 0;
}

export type TransferSubmissionOutcome<T> =
  | { outcome: 'COMPLETED'; value: T }
  /** The task already has its graded answer. */
  | { outcome: 'ALREADY_ANSWERED' }
  /** Another request holds the claim on this task right now (it is being graded). */
  | { outcome: 'IN_PROGRESS' };

/** The advisory-lock key of one Transfer task's submission (same identity as its evidence operation key). */
export function transferSubmissionLockKey(transferTaskId: string, conceptId: string): string {
  return `transfer-submit:${buildOperationKey({ operationType: 'TRANSFER', operationId: transferTaskId, conceptId })}`;
}

/**
 * CR-L11-06 / L10-R2 -- Transfer CONCURRENT exactly-once.
 *
 * Runs `gradeAndRecord` (the AI grading call and the evidence write) at most
 * once per Transfer task, also when two submissions arrive together.
 *
 * The exclusive claim is existing transactional state, not a new column: a
 * TRANSACTION-scoped advisory lock on a dedicated connection -- the same
 * mechanism, with the same reasoning, as the activity launch lock
 * (src/services/activity-launch-lock.service.ts: a transaction is pinned to
 * one server connection even behind Neon's transaction pooler, and the lock
 * ends with the transaction; a session-level lock is not safe there).
 *
 *   1. BEGIN, then `pg_try_advisory_xact_lock(task key)` -- it never waits.
 *      Not obtained => another request is grading this task: IN_PROGRESS.
 *   2. Holding the claim, read the persisted answer state
 *      (`isTransferTaskAlreadyGraded`). Graded => ALREADY_ANSWERED.
 *   3. Still holding it, run `gradeAndRecord`. The evidence it writes is
 *      committed on its own connection before the claim is released, so any
 *      request that obtains the claim afterwards sees it in step 2.
 *   4. End the transaction (the claim is released), whatever happened.
 *
 * Why this is exactly-once: a request can only reach the grader while it
 * holds the claim and after it has seen "not graded"; a second request
 * either cannot get the claim (the first still holds it) or gets it after
 * the first has written its evidence.
 *
 * Crash / retry: nothing is persisted by the claim itself. If the process
 * dies, or grading throws, the transaction ends and the lock goes with it;
 * no evidence was written, so the task is still OPEN and can be answered.
 * There is no lease to expire and nothing to clean up.
 *
 * Cost: one pooled connection is held, idle in a transaction, for the
 * duration of one grading call.
 */
export async function runTransferSubmissionExclusively<T>(transferTaskId: string, conceptId: string, gradeAndRecord: () => Promise<T>): Promise<TransferSubmissionOutcome<T>> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query(`SELECT pg_try_advisory_xact_lock($1::bigint) AS locked`, [launchLockId(transferSubmissionLockKey(transferTaskId, conceptId))]);
    if (claim.rows?.[0]?.locked !== true) return { outcome: 'IN_PROGRESS' };
    if (await isTransferTaskAlreadyGraded(transferTaskId, conceptId)) return { outcome: 'ALREADY_ANSWERED' };
    return { outcome: 'COMPLETED', value: await gradeAndRecord() };
  } finally {
    // Nothing was written on this connection; ending the transaction is what releases the claim.
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
