/**
 * STUDYUS PHASE 7 -- TRANSFER & DEEP LEARNING
 * Step 7C3: Historical Transfer State backfill.
 *
 * concept_transfer_state (7C1 schema, 7C2 projector) is a deterministic
 * projection from canonical TRANSFER learning_evidence, kept current
 * going forward by mastery.service.ts::updateMastery. Any TRANSFER
 * evidence written before that hook existed leaves a (student, concept)
 * pair with no concept_transfer_state row. This service finds those
 * pairs and projects them using the EXACT SAME canonical
 * replay/projector path the live hook uses
 * (projectConceptTransferState / replayTransferState) -- never a second
 * Transfer formula.
 *
 * Mirrors memory-backfill.service.ts exactly: keyset cursor over
 * (student_id, concept_id) ASC, backfill_runs for the audit trail
 * (kind = 'TRANSFER_STATE', zero migration -- `kind` is a plain text
 * column), BackfillOptions/Result/Metrics, and dryRun DEFAULTS TO TRUE
 * (a caller must explicitly pass `dryRun: false` to write).
 *
 * WRITE mode touches concept_transfer_state ONLY. It never touches
 * learning_evidence, mastery_records, concept_knowledge_state,
 * concept_memory_state, or decision_events, and never calls
 * updateMastery. Historical evidence is immutable -- no synthetic
 * novelty metadata is ever written.
 *
 * Concurrency: each pair is written in its own transaction that (a)
 * ensures the concept_transfer_state row exists, (b) takes SELECT ...
 * FOR UPDATE on it, then (c) re-reads the FULL canonical TRANSFER
 * history and replays inside that same transaction. A concurrent live
 * projector's UPSERT on the same pair blocks on the row lock until the
 * backfill transaction commits, then writes its own state derived from
 * its own full-history read -- so a live write can never be regressed
 * by a stale backfill replay (7C3 steps 25/26/32).
 */
import { db, type DbExecutor } from '@/lib/db';
import {
  replayTransferState,
  transferReplayResultEquals,
  toProjectionEvidence,
  type RawTransferEvidenceRow,
  type TransferReplayResult,
} from '@/lib/algorithms/transfer-model';
import { TRANSFER_POLICY_VERSION, type TransferDepth, type TransferDistance } from '@/lib/transfer-policy';
import { computeTransferScore, type TransferEvidenceRow } from '@/lib/algorithms/transfer-score';

const DEFAULT_BATCH_SIZE = 100;

export interface TransferBackfillMetrics {
  pairsScanned: number;
  studentsScanned: number;
  totalEvidenceRows: number;
  invalidEvidenceRows: number;
  proposedInserts: number; // dry-run: pairs with no existing row
  proposedUpdates: number; // dry-run: existing row differs semantically
  semanticNoops: number; // existing row already equals the replay
  rowsWritten: number; // WRITE mode only -- inserts + updates actually performed
  failedPairs: number;
  scoreMismatches: number; // replay score != computeTransferScore for the same rows (must be 0)
  depthCounts: Record<TransferDepth, number>;
  policyVersionCounts: Record<string, number>;
  midSuccessCountTotal: number;
  farSuccessCountTotal: number;
  nonEmptyNoveltyStateRows: number;
  durationMs: number;
}

export interface TransferBackfillOptions {
  studentId?: string;
  /** Defaults to true (DRY_RUN). A caller must deliberately pass false to write. */
  dryRun?: boolean;
  batchSize?: number;
  runId?: string; // resume an existing run's cursor
}

export interface TransferBackfillResult {
  runId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  dryRun: boolean;
  metrics: TransferBackfillMetrics;
  done: boolean;
}

interface CandidatePair {
  studentId: string;
  conceptId: string;
}

const HISTORY_QUERY = `
  SELECT id, timestamp, result, metadata
  FROM learning_evidence
  WHERE student_id = $1 AND concept_id = $2 AND source_type = 'TRANSFER'
  ORDER BY timestamp ASC, id ASC
`;

function emptyDepthCounts(): Record<TransferDepth, number> {
  return { NONE: 0, NEAR_DEMONSTRATED: 0, GENERALIZED: 0, ROBUST: 0 };
}

function emptyMetrics(): TransferBackfillMetrics {
  return {
    pairsScanned: 0,
    studentsScanned: 0,
    totalEvidenceRows: 0,
    invalidEvidenceRows: 0,
    proposedInserts: 0,
    proposedUpdates: 0,
    semanticNoops: 0,
    rowsWritten: 0,
    failedPairs: 0,
    scoreMismatches: 0,
    depthCounts: emptyDepthCounts(),
    policyVersionCounts: {},
    midSuccessCountTotal: 0,
    farSuccessCountTotal: 0,
    nonEmptyNoveltyStateRows: 0,
    durationMs: 0,
  };
}

/** Deterministic keyset discovery of distinct historical TRANSFER pairs. */
async function findCandidates(
  client: DbExecutor,
  studentFilter: string | null,
  cursor: { studentId: string; conceptId: string } | null,
  limit: number,
): Promise<CandidatePair[]> {
  const result = await client.query(
    `
    SELECT DISTINCT student_id, concept_id
    FROM learning_evidence
    WHERE source_type = 'TRANSFER'
      AND ($1::uuid IS NULL OR student_id = $1::uuid)
      AND ($3::uuid IS NULL OR (student_id, concept_id) > ($3::uuid, $4::uuid))
    ORDER BY student_id ASC, concept_id ASC
    LIMIT $2
    `,
    [studentFilter, limit, cursor?.studentId ?? null, cursor?.conceptId ?? null],
  );
  return result.rows.map((r) => ({ studentId: r.student_id, conceptId: r.concept_id }));
}

async function createRun(client: DbExecutor, studentFilter: string | null, dryRun: boolean): Promise<string> {
  const result = await client.query(
    `INSERT INTO backfill_runs (kind, status, dry_run, student_filter, metrics)
     VALUES ('TRANSFER_STATE', 'RUNNING', $1, $2, $3) RETURNING id`,
    [dryRun, studentFilter, JSON.stringify(emptyMetrics())],
  );
  return result.rows[0].id;
}

function persistedToResult(row: Record<string, any>): TransferReplayResult {
  return {
    demonstratedTransferScore: row.demonstrated_transfer_score === null ? null : Number(row.demonstrated_transfer_score),
    nearTransferSuccessCount: Number(row.near_transfer_success_count),
    midTransferSuccessCount: Number(row.mid_transfer_success_count),
    farTransferSuccessCount: Number(row.far_transfer_success_count),
    distinctNoveltyDimensionsOk: Array.isArray(row.distinct_novelty_dimensions_ok) ? row.distinct_novelty_dimensions_ok : [],
    lastSuccessfulTransferAt:
      row.last_successful_transfer_at === null
        ? null
        : row.last_successful_transfer_at instanceof Date
          ? row.last_successful_transfer_at.toISOString()
          : String(row.last_successful_transfer_at),
    lastSuccessfulTransferDistance: row.last_successful_transfer_distance ?? null,
    transferDepth: row.transfer_depth,
    policyVersion: Number(row.policy_version),
  };
}

const STATE_SELECT = `
  SELECT demonstrated_transfer_score, near_transfer_success_count, mid_transfer_success_count,
         far_transfer_success_count, distinct_novelty_dimensions_ok, last_successful_transfer_at,
         last_successful_transfer_distance, transfer_depth, policy_version
  FROM concept_transfer_state
`;

const UPSERT_INSERT_ONLY = `
  INSERT INTO concept_transfer_state (
    student_id, concept_id, demonstrated_transfer_score,
    near_transfer_success_count, mid_transfer_success_count, far_transfer_success_count,
    distinct_novelty_dimensions_ok, last_successful_transfer_at, last_successful_transfer_distance,
    transfer_depth, policy_version, updated_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
`;

const UPSERT = `
  ${UPSERT_INSERT_ONLY}
  ON CONFLICT (student_id, concept_id) DO UPDATE SET
    demonstrated_transfer_score      = EXCLUDED.demonstrated_transfer_score,
    near_transfer_success_count      = EXCLUDED.near_transfer_success_count,
    mid_transfer_success_count       = EXCLUDED.mid_transfer_success_count,
    far_transfer_success_count       = EXCLUDED.far_transfer_success_count,
    distinct_novelty_dimensions_ok   = EXCLUDED.distinct_novelty_dimensions_ok,
    last_successful_transfer_at       = EXCLUDED.last_successful_transfer_at,
    last_successful_transfer_distance = EXCLUDED.last_successful_transfer_distance,
    transfer_depth                   = EXCLUDED.transfer_depth,
    policy_version                   = EXCLUDED.policy_version,
    updated_at                       = NOW()
`;

function upsertParams(pair: CandidatePair, r: TransferReplayResult): unknown[] {
  return [
    pair.studentId,
    pair.conceptId,
    r.demonstratedTransferScore,
    r.nearTransferSuccessCount,
    r.midTransferSuccessCount,
    r.farTransferSuccessCount,
    r.distinctNoveltyDimensionsOk,
    r.lastSuccessfulTransferAt,
    r.lastSuccessfulTransferDistance,
    r.transferDepth,
    r.policyVersion,
  ];
}

const VALID_DISTANCE = new Set<TransferDistance>(['NEAR', 'MID', 'FAR']);

/**
 * The exact input getTransferScore builds for computeTransferScore --
 * an independent cross-check that the replay's demonstrated score has
 * not drifted from the certified Phase 2 source (7C3 steps 16/33).
 */
function crossCheckScore(rows: RawTransferEvidenceRow[]): number | null {
  const scoreRows: TransferEvidenceRow[] = rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const d = meta.transferDistance as TransferDistance | undefined;
    return {
      transferDistance: d && VALID_DISTANCE.has(d) ? d : 'NEAR',
      result: r.result === 'correct' ? 'correct' : r.result === 'partial' ? 'partial' : 'incorrect',
      assisted: meta.assisted === true,
      timestamp: r.timestamp,
    };
  });
  return computeTransferScore(scoreRows);
}

async function replayFromClient(client: DbExecutor, studentId: string, conceptId: string) {
  const historyRes = await client.query(HISTORY_QUERY, [studentId, conceptId]);
  const rows = historyRes.rows as RawTransferEvidenceRow[];
  let invalid = 0;
  const evidence = rows.map((r) => {
    // currentEvidenceId = null: every row conservative-historical, none strict.
    try {
      return toProjectionEvidence(r, { conceptId, isCurrent: false });
    } catch {
      invalid += 1;
      return null;
    }
  });
  const usable = evidence.filter((e): e is NonNullable<typeof e> => e !== null);
  return { replayed: replayTransferState(usable), totalRows: rows.length, invalidRows: invalid, rawRows: rows };
}

function accumulate(metrics: TransferBackfillMetrics, r: TransferReplayResult): void {
  metrics.depthCounts[r.transferDepth] += 1;
  const pv = String(r.policyVersion);
  metrics.policyVersionCounts[pv] = (metrics.policyVersionCounts[pv] ?? 0) + 1;
  metrics.midSuccessCountTotal += r.midTransferSuccessCount;
  metrics.farSuccessCountTotal += r.farTransferSuccessCount;
  if (r.distinctNoveltyDimensionsOk.length > 0) metrics.nonEmptyNoveltyStateRows += 1;
}

/**
 * Processes up to `batchSize` candidate (student, concept) pairs. Call
 * repeatedly (passing back `runId`) until `done` is true.
 *
 * DRY_RUN (default): pool reads only -- history + existing row + replay
 * + classify. ZERO writes to concept_transfer_state (the RUNNING
 * backfill_runs row is the only administrative write, matching
 * memory-backfill.service.ts).
 *
 * WRITE: per-pair transaction -> ensure row -> FOR UPDATE lock ->
 * re-read full history -> replay -> UPDATE only if semantically
 * different -> COMMIT.
 */
export async function runTransferStateBackfill(options: TransferBackfillOptions = {}): Promise<TransferBackfillResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? true;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const studentFilter = options.studentId ?? null;
  const pool: DbExecutor = db;

  let runId = options.runId ?? null;
  let cursor: { studentId: string; conceptId: string } | null = null;
  let metrics = emptyMetrics();

  if (runId) {
    const existing = await pool.query(
      `SELECT metrics, cursor_student_id, cursor_concept_id, status FROM backfill_runs WHERE id = $1`,
      [runId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('BACKFILL_RUN_NOT_FOUND');
    metrics = { ...emptyMetrics(), ...row.metrics, depthCounts: { ...emptyDepthCounts(), ...(row.metrics?.depthCounts ?? {}) } };
    cursor = row.cursor_student_id ? { studentId: row.cursor_student_id, conceptId: row.cursor_concept_id } : null;
  } else {
    runId = await createRun(pool, studentFilter, dryRun);
  }

  let candidates: CandidatePair[] = [];
  try {
    candidates = await findCandidates(pool, studentFilter, cursor, batchSize);
  } catch (error) {
    await pool.query(`UPDATE backfill_runs SET status = 'FAILED', error = $2, completed_at = NOW() WHERE id = $1`, [runId, String(error)]);
    throw error;
  }

  const scannedStudents = new Set<string>();
  let lastPair: CandidatePair | null = null;

  for (const pair of candidates) {
    scannedStudents.add(pair.studentId);
    metrics.pairsScanned += 1;
    lastPair = pair;

    try {
      if (dryRun) {
        const { replayed, totalRows, invalidRows, rawRows } = await replayFromClient(pool, pair.studentId, pair.conceptId);
        metrics.totalEvidenceRows += totalRows;
        metrics.invalidEvidenceRows += invalidRows;

        // cross-check the demonstrated score against the certified scorer
        if (crossCheckScore(rawRows) !== replayed.demonstratedTransferScore) metrics.scoreMismatches += 1;

        const existingRes = await pool.query(`${STATE_SELECT} WHERE student_id = $1 AND concept_id = $2`, [pair.studentId, pair.conceptId]);
        if (!existingRes.rows[0]) metrics.proposedInserts += 1;
        else if (transferReplayResultEquals(persistedToResult(existingRes.rows[0]), replayed)) metrics.semanticNoops += 1;
        else metrics.proposedUpdates += 1;

        accumulate(metrics, replayed);
      } else {
        const conn = await db.connect();
        try {
          await conn.query('BEGIN');

          // First-pass replay (may be a hair stale vs. a concurrent
          // live write -- reconciled after the lock below).
          const first = await replayFromClient(conn, pair.studentId, pair.conceptId);

          // Ensure a row exists so we have something to lock. RETURNING
          // tells us whether WE inserted it (a genuine new projection)
          // or it already existed.
          const insertRes = await conn.query(
            `${UPSERT_INSERT_ONLY} ON CONFLICT (student_id, concept_id) DO NOTHING RETURNING student_id`,
            upsertParams(pair, first.replayed),
          );
          const inserted = (insertRes.rowCount ?? 0) > 0;

          // Take the row lock. A concurrent live projector's UPSERT on
          // this pair now blocks until we COMMIT.
          const lockedRes = await conn.query(`${STATE_SELECT} WHERE student_id = $1 AND concept_id = $2 FOR UPDATE`, [
            pair.studentId,
            pair.conceptId,
          ]);
          const existing = lockedRes.rows[0] ? persistedToResult(lockedRes.rows[0]) : null;

          // Re-replay under the lock: now sees everything committed
          // before we acquired it.
          const { replayed, totalRows, invalidRows, rawRows } = await replayFromClient(conn, pair.studentId, pair.conceptId);
          metrics.totalEvidenceRows += totalRows;
          metrics.invalidEvidenceRows += invalidRows;
          if (crossCheckScore(rawRows) !== replayed.demonstratedTransferScore) metrics.scoreMismatches += 1;

          if (inserted) {
            // We wrote `first.replayed` above; correct it only if the
            // re-read produced a different state.
            if (!transferReplayResultEquals(first.replayed, replayed)) {
              await conn.query(UPSERT, upsertParams(pair, replayed));
            }
            metrics.rowsWritten += 1;
          } else if (existing && transferReplayResultEquals(existing, replayed)) {
            metrics.semanticNoops += 1;
          } else {
            await conn.query(UPSERT, upsertParams(pair, replayed));
            metrics.rowsWritten += 1;
          }

          await conn.query('COMMIT');
          accumulate(metrics, replayed);
        } catch (err) {
          await conn.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          conn.release();
        }
      }
    } catch (error) {
      metrics.failedPairs += 1;
      // Never logs evidence content -- only which pair failed.
      console.error(`Transfer State backfill failed for student=${pair.studentId} concept=${pair.conceptId}:`, error);
    }
  }

  metrics.studentsScanned += scannedStudents.size;
  metrics.durationMs += Date.now() - startedAt;
  const done = candidates.length < batchSize;

  await pool.query(
    `UPDATE backfill_runs SET metrics = $2, cursor_student_id = $3, cursor_concept_id = $4, status = $5, completed_at = $6 WHERE id = $1`,
    [
      runId,
      JSON.stringify(metrics),
      lastPair?.studentId ?? null,
      lastPair?.conceptId ?? null,
      done ? 'COMPLETED' : 'RUNNING',
      done ? new Date() : null,
    ],
  );

  return { runId, status: done ? 'COMPLETED' : 'RUNNING', dryRun, metrics, done };
}

export async function getTransferBackfillRun(runId: string) {
  const result = await db.query(`SELECT * FROM backfill_runs WHERE id = $1`, [runId]);
  return result.rows[0] ?? null;
}
