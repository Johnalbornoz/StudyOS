/**
 * Phase 7 -- Step 7B2: deterministic structural-duplicate (anti-
 * memorization) guard for Transfer tasks.
 *
 * This answers ONLY: "has this learner already seen essentially this
 * same STRUCTURAL prompt for this concept, recently?" -- by comparing
 * the 7B1 promptFingerprint (SHA-256 of the structurally-normalized
 * prompt) against a bounded window of the learner's recent canonical
 * TRANSFER evidence for the concept.
 *
 * It does NOT certify pedagogical novelty, NoveltyDimension coverage,
 * or NEAR/MID/FAR correctness -- an unseen fingerprint is NECESSARY
 * but NOT SUFFICIENT for full Phase 7 transfer qualification
 * (qualifiesAsTransferEvidence / validateTransferDistanceNovelty in
 * transfer-policy.ts stay defined but not yet runtime-authoritative;
 * that is 7D). Nothing here reads or writes Mastery / Knowledge State /
 * memory / decision state, and no schema or task table is introduced.
 */
import { db, type DbExecutor } from '@/lib/db';

/**
 * How many of the learner's most-recent TRANSFER evidence rows for a
 * concept are scanned for a structural-fingerprint collision. An
 * OPERATIONAL anti-repeat bound -- NOT pedagogy policy, not
 * frontend-configurable, not environment-driven. Kept small: it is a
 * bounded recent-row scan (mirrors getTransferScore's own LIMIT 10
 * read), never an unbounded history scan and never a
 * `metadata->>'promptFingerprint'` filter.
 */
export const TRANSFER_DUPLICATE_LOOKBACK = 20;

/** Canonical fingerprint shape: lowercase 64-hex SHA-256 (see transfer-task-identity.ts). */
const CANONICAL_FINGERPRINT = /^[0-9a-f]{64}$/;

export interface RecentTransferFingerprint {
  promptFingerprint: string;
  transferTaskId: string | null;
  transferDistance: string | null;
  timestamp: string | Date;
}

/**
 * One bounded query. Legacy rows whose metadata has no fingerprint (or
 * a malformed one) are simply dropped from the result -- they never
 * crash generation and never falsely trigger a duplicate.
 */
export async function getRecentTransferFingerprints(
  studentId: string,
  conceptId: string,
  limit: number = TRANSFER_DUPLICATE_LOOKBACK,
  client: DbExecutor = db,
): Promise<RecentTransferFingerprint[]> {
  const result = await client.query(
    `SELECT metadata, timestamp FROM learning_evidence
     WHERE student_id = $1 AND concept_id = $2 AND source_type = 'TRANSFER'
     ORDER BY timestamp DESC
     LIMIT $3`,
    [studentId, conceptId, Math.max(1, Math.floor(limit))],
  );

  const out: RecentTransferFingerprint[] = [];
  for (const row of result.rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const fp = typeof meta.promptFingerprint === 'string' ? meta.promptFingerprint : null;
    if (!fp || !CANONICAL_FINGERPRINT.test(fp)) continue; // ignore legacy / malformed
    out.push({
      promptFingerprint: fp,
      transferTaskId: typeof meta.transferTaskId === 'string' ? meta.transferTaskId : null,
      transferDistance: typeof meta.transferDistance === 'string' ? meta.transferDistance : null,
      timestamp: row.timestamp,
    });
  }
  return out;
}

export interface DuplicateFingerprintCheckInput {
  candidateFingerprint: string;
  recentFingerprints: readonly RecentTransferFingerprint[];
  /**
   * Rows whose `transferTaskId` equals this are IGNORED. Used at
   * submit time so an idempotent resubmission / transport retry of the
   * SAME task's own evidence is never mistaken for a different-task
   * structural duplicate.
   */
  excludeTransferTaskId?: string | null;
}

export interface DuplicateFingerprintCheckResult {
  duplicate: boolean;
  matchedTransferTaskId?: string;
}

/**
 * Pure. Exact fingerprint equality only -- no AI, no embeddings, no
 * fuzzy/lexical thresholds. The 7B1 normalizer already folds numeric
 * substitutions, case, whitespace and selected punctuation, so exact
 * match is the whole structural contract.
 */
export function isDuplicateTransferFingerprint(
  input: DuplicateFingerprintCheckInput,
): DuplicateFingerprintCheckResult {
  if (!CANONICAL_FINGERPRINT.test(input.candidateFingerprint)) return { duplicate: false };
  for (const row of input.recentFingerprints) {
    if (input.excludeTransferTaskId && row.transferTaskId === input.excludeTransferTaskId) continue;
    if (row.promptFingerprint === input.candidateFingerprint) {
      return row.transferTaskId ? { duplicate: true, matchedTransferTaskId: row.transferTaskId } : { duplicate: true };
    }
  }
  return { duplicate: false };
}

export type TransferNoveltyGuardResult =
  | { eligible: true; status: 'UNSEEN_FINGERPRINT' }
  | { eligible: false; status: 'RECENT_DUPLICATE'; matchedTransferTaskId?: string };

/**
 * `UNSEEN_FINGERPRINT` means ONLY "no matching structural fingerprint
 * in the recent bounded history" -- never "certified novel" and never
 * "NEAR/MID/FAR validated".
 */
export function evaluateTransferNoveltyGuard(input: DuplicateFingerprintCheckInput): TransferNoveltyGuardResult {
  const check = isDuplicateTransferFingerprint(input);
  if (!check.duplicate) return { eligible: true, status: 'UNSEEN_FINGERPRINT' };
  return check.matchedTransferTaskId
    ? { eligible: false, status: 'RECENT_DUPLICATE', matchedTransferTaskId: check.matchedTransferTaskId }
    : { eligible: false, status: 'RECENT_DUPLICATE' };
}
