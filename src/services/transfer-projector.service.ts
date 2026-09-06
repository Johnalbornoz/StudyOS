/**
 * Phase 7 -- Step 7C2: the canonical Transfer state projector.
 *
 * Consumes canonical TRANSFER `learning_evidence` and maintains
 * `concept_transfer_state` for one (student, concept). Runs ONLY
 * inside `mastery.service.ts::updateMastery`'s transaction, ONLY on an
 * accepted (non-duplicate) evidence write whose `sourceType ===
 * 'TRANSFER'`. Never on a read/render path. Never opens its own
 * transaction; the caller's `client` is passed in and a throw here
 * rolls back the whole `updateMastery` transaction.
 *
 * Deterministic + replayable: it replays the FULL canonical TRANSFER
 * history (pure `replayTransferState`), so the persisted row is a
 * function of the evidence alone, not of call order or previous state.
 * A semantic no-op (replayed state == persisted state) writes nothing.
 *
 * No Knowledge State / Mastery / MemoryPolicy / Phase 4 / Phase 5
 * change: `concept_transfer_state.demonstrated_transfer_score` is an
 * advisory mirror; Knowledge State's `transfer` dimension still comes
 * from `getTransferScore` (7C2 does not wire this in).
 */
import { type DbExecutor } from '@/lib/db';
import {
  replayTransferState,
  transferReplayResultEquals,
  toProjectionEvidence,
  type RawTransferEvidenceRow,
  type TransferReplayResult,
} from '@/lib/algorithms/transfer-model';

/** Full canonical history -- no LIMIT (needed for exact counts / depth / distinct dims). */
const HISTORY_QUERY = `
  SELECT id, timestamp, result, metadata
  FROM learning_evidence
  WHERE student_id = $1 AND concept_id = $2 AND source_type = 'TRANSFER'
  ORDER BY timestamp ASC, id ASC
`;

const STATE_QUERY = `
  SELECT demonstrated_transfer_score, near_transfer_success_count, mid_transfer_success_count,
         far_transfer_success_count, distinct_novelty_dimensions_ok, last_successful_transfer_at,
         last_successful_transfer_distance, transfer_depth, policy_version
  FROM concept_transfer_state
  WHERE student_id = $1 AND concept_id = $2
`;

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

export interface TransferProjectionResult {
  state: TransferReplayResult;
  stateChanged: boolean;
}

/**
 * Project `concept_transfer_state` for one (student, concept) from the
 * full canonical TRANSFER evidence history.
 *
 * @param currentEvidenceId  the id of the row `updateMastery` just
 *   inserted -- held to the post-7C1 canonical-route contract by
 *   `toProjectionEvidence` (a violation throws and rolls the
 *   transaction back). Historical rows are normalized conservatively.
 *   Pass `null` (7C3 historical backfill) when there is no "current"
 *   row: every row is then normalized under the conservative
 *   historical rules and none is held to the live-writer contract.
 */
export async function projectConceptTransferState(
  client: DbExecutor,
  studentId: string,
  conceptId: string,
  currentEvidenceId: string | null,
): Promise<TransferProjectionResult> {
  const historyRes = await client.query(HISTORY_QUERY, [studentId, conceptId]);
  const rows = historyRes.rows as RawTransferEvidenceRow[];

  const evidence = rows.map((r) =>
    toProjectionEvidence(r, { conceptId, isCurrent: currentEvidenceId !== null && r.id === currentEvidenceId }),
  );
  const replayed = replayTransferState(evidence);

  const stateRes = await client.query(STATE_QUERY, [studentId, conceptId]);
  const existing = stateRes.rows[0] ? persistedToResult(stateRes.rows[0]) : null;

  if (existing && transferReplayResultEquals(existing, replayed)) {
    return { state: replayed, stateChanged: false };
  }

  await client.query(
    `
    INSERT INTO concept_transfer_state (
      student_id, concept_id, demonstrated_transfer_score,
      near_transfer_success_count, mid_transfer_success_count, far_transfer_success_count,
      distinct_novelty_dimensions_ok, last_successful_transfer_at, last_successful_transfer_distance,
      transfer_depth, policy_version, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
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
    `,
    [
      studentId,
      conceptId,
      replayed.demonstratedTransferScore,
      replayed.nearTransferSuccessCount,
      replayed.midTransferSuccessCount,
      replayed.farTransferSuccessCount,
      replayed.distinctNoveltyDimensionsOk,
      replayed.lastSuccessfulTransferAt,
      replayed.lastSuccessfulTransferDistance,
      replayed.transferDepth,
      replayed.policyVersion,
    ],
  );

  return { state: replayed, stateChanged: true };
}
