/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6F: Historical Memory State backfill.
 *
 * Concept Memory State (Phase 6, Step 6E) is a deterministic projection
 * from learning_evidence -- it is kept current going forward via
 * mastery.service.ts::updateMastery, but any evidence written BEFORE
 * that hook existed leaves a (student, concept) pair with no
 * concept_memory_state row at all. This service finds those pairs and
 * projects them using the EXACT SAME canonical read/normalize/replay
 * path the live projector uses (computeMemoryProjection /
 * projectConceptMemoryState from memory-projector.service.ts) -- never
 * a second, parallel memory formula.
 *
 * Mirrors the shape of knowledge-state-backfill.service.ts (keyset
 * cursor over (student_id, concept_id) ASC, backfill_runs for the
 * audit trail, BackfillOptions/BackfillResult/BackfillMetrics), with
 * one deliberate divergence: this service's dryRun option DEFAULTS TO
 * TRUE. A caller must explicitly pass `dryRun: false` to write.
 *
 * WRITE mode touches concept_memory_state ONLY (via
 * projectConceptMemoryState) -- it never touches learning_evidence,
 * mastery_records, concept_knowledge_state, or validation_cycles, and
 * never calls updateMastery.
 *
 * Backfill reconstructs CURRENT state from evidence that was never
 * live-observed as it happened, so it must never fabricate a
 * MEMORY_ANCHOR_ESTABLISHED / QUALIFIED_RETENTION_* decision_events row
 * implying a transition occurred at backfill time -- every WRITE-mode
 * call passes `{ skipAudit: true }`. The single aggregate audit trail
 * for a backfill invocation is its own backfill_runs row (kind =
 * 'MEMORY_STATE'), reusing the existing table at zero migration cost --
 * no per-concept decision_events are ever emitted by this service.
 */

import { db, type DbExecutor } from '@/lib/db';
import { computeMemoryProjection, projectConceptMemoryState } from './memory-projector.service';
import { MEMORY_POLICY_V1, type MemoryPolicyV1, type MemoryStatus } from '@/lib/memory-policy';

export interface BackfillMetrics {
  pairsScanned: number;
  studentsScanned: number;
  totalEvidenceRows: number;
  validEvidenceRows: number;
  invalidEvidenceRows: number;
  invalidReasonCounts: Record<string, number>;
  anchorsEstablished: number;
  statusCounts: Record<MemoryStatus, number>;
  rowsWritten: number; // WRITE mode only -- inserts + updates actually performed. Always 0 in dry-run.
  errors: number;
  durationMs: number;
}

export interface BackfillOptions {
  studentId?: string;
  /** Defaults to true (DRY_RUN). A caller must deliberately pass false to write. No environment heuristic ever flips this. */
  dryRun?: boolean;
  batchSize?: number;
  runId?: string; // resume an existing run's cursor; omit to start a new run
  policy?: MemoryPolicyV1;
}

export interface BackfillResult {
  runId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  dryRun: boolean;
  metrics: BackfillMetrics;
  done: boolean; // true once every candidate pair (as of when this batch call ran) has been processed
}

interface CandidatePair {
  studentId: string;
  conceptId: string;
}

const DEFAULT_BATCH_SIZE = 500;

function emptyStatusCounts(): Record<MemoryStatus, number> {
  return {
    NOT_ESTABLISHED: 0,
    WAITING_FOR_RETENTION: 0,
    DEVELOPING: 0,
    STABLE: 0,
    AT_RISK: 0,
  };
}

function emptyMetrics(): BackfillMetrics {
  return {
    pairsScanned: 0,
    studentsScanned: 0,
    totalEvidenceRows: 0,
    validEvidenceRows: 0,
    invalidEvidenceRows: 0,
    invalidReasonCounts: {},
    anchorsEstablished: 0,
    statusCounts: emptyStatusCounts(),
    rowsWritten: 0,
    errors: 0,
    durationMs: 0,
  };
}

async function findCandidates(
  client: DbExecutor,
  studentFilter: string | null,
  cursor: { studentId: string; conceptId: string } | null,
  limit: number
): Promise<CandidatePair[]> {
  const result = await client.query(
    `
    SELECT DISTINCT student_id, concept_id
    FROM learning_evidence
    WHERE ($1::uuid IS NULL OR student_id = $1::uuid)
      AND ($3::uuid IS NULL OR (student_id, concept_id) > ($3::uuid, $4::uuid))
    ORDER BY student_id, concept_id
    LIMIT $2
    `,
    [studentFilter, limit, cursor?.studentId ?? null, cursor?.conceptId ?? null]
  );
  return result.rows.map((r) => ({ studentId: r.student_id, conceptId: r.concept_id }));
}

async function createRun(client: DbExecutor, studentFilter: string | null, dryRun: boolean): Promise<string> {
  const result = await client.query(
    `INSERT INTO backfill_runs (kind, status, dry_run, student_filter, metrics)
     VALUES ('MEMORY_STATE', 'RUNNING', $1, $2, $3) RETURNING id`,
    [dryRun, studentFilter, JSON.stringify(emptyMetrics())]
  );
  return result.rows[0].id;
}

function mergeInvalidReasonCounts(target: Record<string, number>, source: Readonly<Record<string, number>>): void {
  for (const [reason, count] of Object.entries(source)) {
    target[reason] = (target[reason] ?? 0) + count;
  }
}

/**
 * Processes up to `batchSize` candidate (student, concept) pairs and
 * returns the accumulated run state. Call repeatedly (passing back
 * `runId` from the previous call's result) until `done` is true.
 *
 * DRY_RUN (default): calls computeMemoryProjection only -- reads
 * learning_evidence + the existing concept_memory_state row, replays,
 * and diagnoses. Performs ZERO database writes.
 *
 * WRITE: calls projectConceptMemoryState(client, studentId, conceptId,
 * policy, { skipAudit: true }) -- the exact same upsert logic the live
 * Step 6E projector uses, with the historical-fabrication-avoidance
 * flag set. Writes concept_memory_state ONLY.
 */
export async function runMemoryStateBackfill(options: BackfillOptions = {}): Promise<BackfillResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? true;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const studentFilter = options.studentId ?? null;
  const policy = options.policy ?? MEMORY_POLICY_V1;
  const client: DbExecutor = db;

  let runId = options.runId ?? null;
  let cursor: { studentId: string; conceptId: string } | null = null;
  let metrics = emptyMetrics();

  if (runId) {
    const existing = await client.query(
      `SELECT metrics, cursor_student_id, cursor_concept_id, status FROM backfill_runs WHERE id = $1`,
      [runId]
    );
    const row = existing.rows[0];
    if (!row) throw new Error('BACKFILL_RUN_NOT_FOUND');
    metrics = { ...emptyMetrics(), ...row.metrics, statusCounts: { ...emptyStatusCounts(), ...(row.metrics?.statusCounts ?? {}) } };
    cursor = row.cursor_student_id ? { studentId: row.cursor_student_id, conceptId: row.cursor_concept_id } : null;
  } else {
    runId = await createRun(client, studentFilter, dryRun);
  }

  let candidates: CandidatePair[] = [];
  try {
    candidates = await findCandidates(client, studentFilter, cursor, batchSize);
  } catch (error) {
    await client.query(`UPDATE backfill_runs SET status = 'FAILED', error = $2, completed_at = NOW() WHERE id = $1`, [runId, String(error)]);
    throw error;
  }

  const scannedStudents = new Set<string>();
  let lastPair: CandidatePair | null = null;

  for (const pair of candidates) {
    scannedStudents.add(pair.studentId);
    metrics.pairsScanned++;
    lastPair = pair;

    try {
      if (dryRun) {
        const computation = await computeMemoryProjection(client, pair.studentId, pair.conceptId, policy);
        metrics.totalEvidenceRows += computation.diagnostics.totalEvidenceRows;
        metrics.validEvidenceRows += computation.diagnostics.validMemoryEvidenceRows;
        metrics.invalidEvidenceRows += computation.diagnostics.invalidMemoryEvidenceRows;
        mergeInvalidReasonCounts(metrics.invalidReasonCounts, computation.diagnostics.invalidReasonCounts);
        if (computation.detail.state.initialCompetenceAnchorAt !== null) metrics.anchorsEstablished++;
        metrics.statusCounts[computation.detail.state.memoryStatus]++;
      } else {
        const result = await projectConceptMemoryState(client, pair.studentId, pair.conceptId, policy, { skipAudit: true });
        metrics.totalEvidenceRows += result.diagnostics.totalEvidenceRows;
        metrics.validEvidenceRows += result.diagnostics.validMemoryEvidenceRows;
        metrics.invalidEvidenceRows += result.diagnostics.invalidMemoryEvidenceRows;
        mergeInvalidReasonCounts(metrics.invalidReasonCounts, result.diagnostics.invalidReasonCounts);
        if (result.state.initialCompetenceAnchorAt !== null) metrics.anchorsEstablished++;
        metrics.statusCounts[result.state.memoryStatus]++;
        if (result.stateChanged) metrics.rowsWritten++;
      }
    } catch (error) {
      metrics.errors++;
      // Never logs evidence content -- only which pair failed.
      console.error(`Memory State backfill failed for student=${pair.studentId} concept=${pair.conceptId}:`, error);
    }
  }

  metrics.studentsScanned += scannedStudents.size;
  metrics.durationMs += Date.now() - startedAt;
  const done = candidates.length < batchSize;

  await client.query(
    `UPDATE backfill_runs SET
       metrics = $2,
       cursor_student_id = $3,
       cursor_concept_id = $4,
       status = $5,
       completed_at = $6
     WHERE id = $1`,
    [
      runId,
      JSON.stringify(metrics),
      lastPair?.studentId ?? null,
      lastPair?.conceptId ?? null,
      done ? 'COMPLETED' : 'RUNNING',
      done ? new Date() : null,
    ]
  );

  return {
    runId,
    status: done ? 'COMPLETED' : 'RUNNING',
    dryRun,
    metrics,
    done,
  };
}

export async function getMemoryBackfillRun(runId: string) {
  const result = await db.query(`SELECT * FROM backfill_runs WHERE id = $1`, [runId]);
  return result.rows[0] ?? null;
}
