/**
 * Phase 7 (7C2): the ONE pure implementation of the demonstrated
 * Transfer score.
 *
 * Extracted verbatim from src/services/transfer.service.ts so both the
 * legacy caller (transfer.service.ts re-exports these) and the Phase 7
 * projector (src/lib/algorithms/transfer-model.ts) call the SAME
 * function. NO numerical semantic change: distance weights NEAR 0.7 /
 * MID 1.0 / FAR 1.3, assisted discount x0.6, last-10 window,
 * null-safe (never 0 with no evidence).
 *
 * Pure -- no DB, no AI, no clock beyond the timestamp values passed in.
 */
import type { TransferDistance } from '@/services/transfer.service';

export interface TransferEvidenceRow {
  transferDistance: TransferDistance;
  result: 'correct' | 'partial' | 'incorrect';
  assisted: boolean;
  timestamp: string | Date;
}

const DISTANCE_WEIGHT: Record<TransferDistance, number> = { NEAR: 0.7, MID: 1.0, FAR: 1.3 };
const RESULT_VALUE: Record<TransferEvidenceRow['result'], number> = { correct: 100, partial: 50, incorrect: 0 };

/**
 * Deterministic, null-safe (never 0 with no evidence). Averages
 * distance-weighted, assistance-discounted results over the last 10
 * transfer attempts -- a MID/FAR success counts for more than a NEAR
 * one, and an assisted success counts for less than an independent one,
 * without needing a separate Independent-Transfer dimension yet.
 */
export function computeTransferScore(rows: TransferEvidenceRow[]): number | null {
  if (rows.length === 0) return null;
  const recent = [...rows]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  let weightedSum = 0;
  let weightTotal = 0;
  for (const row of recent) {
    const weight = DISTANCE_WEIGHT[row.transferDistance] * (row.assisted ? 0.6 : 1.0);
    weightedSum += RESULT_VALUE[row.result] * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return null;
  return Math.round(weightedSum / weightTotal);
}
