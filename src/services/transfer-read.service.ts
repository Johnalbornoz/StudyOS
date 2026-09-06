/**
 * Phase 7 -- Step 7E1: the Phase 4 read boundary for canonical
 * transfer state.
 *
 * ONE batched read of `concept_transfer_state` for a student, mapped
 * into advisory `Phase4TransferSignal`s. Phase 4 keeps full authority
 * over WHAT the learner does next -- these signals are inputs it may
 * weigh, never a decision. A student with no `concept_transfer_state`
 * row for a concept produces no signal for it (empty Map), so the
 * learning decision for such a student is byte-identical to before
 * this boundary existed.
 *
 * Read-only. No projection, no write, no AI, no clock. Never exposes
 * raw learning_evidence or prompt/answer content -- only the already-
 * projected row's derived booleans.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { TransferDepth, TransferDistance, NoveltyDimension } from '@/lib/transfer-policy';
import { TRANSFER_FRAGILE_SCORE_THRESHOLD } from '@/lib/adaptive-learning-policy';

export interface Phase4TransferSignal {
  readonly conceptId: string;
  readonly transferDepth: TransferDepth;
  readonly nearTransferSuccessCount: number;
  readonly midTransferSuccessCount: number;
  readonly farTransferSuccessCount: number;
  readonly demonstratedTransferScore: number | null;
  readonly lastSuccessfulTransferAt: string | null;
  readonly lastSuccessfulTransferDistance: TransferDistance | null;
  readonly distinctNoveltyDimensionsOk: NoveltyDimension[];
  readonly policyVersion: number;

  /** transfer has been engaged for this concept but no depth is established yet. */
  readonly nearTransferGap: boolean;
  /** near transfer is demonstrated, but far / generalized transfer is not. */
  readonly farTransferGap: boolean;
  /** transfer was demonstrated at some point, but the current rolling transfer score is weak. */
  readonly transferFragile: boolean;
}

const TRANSFER_STATE_COLUMNS = `
  concept_id, transfer_depth,
  near_transfer_success_count, mid_transfer_success_count, far_transfer_success_count,
  demonstrated_transfer_score, last_successful_transfer_at, last_successful_transfer_distance,
  distinct_novelty_dimensions_ok, policy_version
`;

function rowToPhase4TransferSignal(row: Record<string, any>): Phase4TransferSignal {
  const transferDepth = row.transfer_depth as TransferDepth;
  const near = Number(row.near_transfer_success_count);
  const mid = Number(row.mid_transfer_success_count);
  const far = Number(row.far_transfer_success_count);
  const demonstratedTransferScore =
    row.demonstrated_transfer_score === null || row.demonstrated_transfer_score === undefined
      ? null
      : Number(row.demonstrated_transfer_score);

  // Deterministic, monotonic-independent derivations from the persisted
  // row alone. `transferDepth` is monotonic; `transferFragile` is the
  // deliberately non-monotonic "shows it, but shaky right now" read.
  const nearTransferGap = transferDepth === 'NONE';
  const farTransferGap = transferDepth === 'NEAR_DEMONSTRATED' && far === 0;
  const transferFragile =
    transferDepth !== 'NONE' &&
    demonstratedTransferScore !== null &&
    demonstratedTransferScore < TRANSFER_FRAGILE_SCORE_THRESHOLD;

  return {
    conceptId: row.concept_id,
    transferDepth,
    nearTransferSuccessCount: near,
    midTransferSuccessCount: mid,
    farTransferSuccessCount: far,
    demonstratedTransferScore,
    lastSuccessfulTransferAt:
      row.last_successful_transfer_at instanceof Date
        ? row.last_successful_transfer_at.toISOString()
        : row.last_successful_transfer_at ?? null,
    lastSuccessfulTransferDistance: row.last_successful_transfer_distance ?? null,
    distinctNoveltyDimensionsOk: Array.isArray(row.distinct_novelty_dimensions_ok) ? row.distinct_novelty_dimensions_ok : [],
    policyVersion: Number(row.policy_version),
    nearTransferGap,
    farTransferGap,
    transferFragile,
  };
}

/**
 * ONE batched read for the whole student. A concept with no
 * `concept_transfer_state` row is simply absent from the Map -- callers
 * MUST treat "absent" as "no transfer signal", never as a zeroed
 * signal.
 */
export async function getPhase4TransferSignalsForStudent(
  client: DbExecutor = db,
  studentId: string,
): Promise<Map<string, Phase4TransferSignal>> {
  const result = await client.query(
    `SELECT ${TRANSFER_STATE_COLUMNS} FROM concept_transfer_state WHERE student_id = $1`,
    [studentId],
  );
  const signals = new Map<string, Phase4TransferSignal>();
  for (const row of result.rows) {
    signals.set(row.concept_id, rowToPhase4TransferSignal(row));
  }
  return signals;
}
