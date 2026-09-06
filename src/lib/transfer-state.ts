/**
 * Phase 7 -- Step 7C1: pure type mirror of the canonical
 * `concept_transfer_state` table (database/migrations/
 * 20260907_1400_phase7_transfer_state.sql).
 *
 * TYPE ONLY. No DB, no service behavior, no projector. Fields mirror
 * the migration exactly so the 7C2 projector and the 7E Phase 4 reader
 * have one shared shape to build against. `transfer_depth` /
 * `last_successful_transfer_distance` reuse the canonical unions from
 * transfer-policy.ts rather than redefining them.
 */
import type { TransferDepth, TransferDistance, NoveltyDimension } from '@/lib/transfer-policy';

/**
 * One row of `concept_transfer_state` -- the canonical persisted Phase
 * 7 transfer-depth state for a (student, concept). No row exists until
 * the 7C2 projector / 7C3 backfill writes one; a caller must treat a
 * missing row as `NONE` depth with all counts 0.
 */
export interface ConceptTransferStateRow {
  id: string;
  studentId: string;
  conceptId: string;

  /** Advisory mirror of computeTransferScore at projection time; NULL before the first qualifying attempt. */
  demonstratedTransferScore: number | null;

  nearTransferSuccessCount: number;
  midTransferSuccessCount: number;
  farTransferSuccessCount: number;

  /** Distinct NoveltyDimension values demonstrated in a qualifying SUCCESS. Empty until 7D structured metadata exists. */
  distinctNoveltyDimensionsOk: NoveltyDimension[];

  lastSuccessfulTransferAt: string | null;
  lastSuccessfulTransferDistance: TransferDistance | null;

  transferDepth: TransferDepth;

  policyVersion: number;

  createdAt: string;
  updatedAt: string;
}

/** Column list of `concept_transfer_state`, in migration order -- for a future projector's SELECT/INSERT. */
export const CONCEPT_TRANSFER_STATE_COLUMNS = [
  'id',
  'student_id',
  'concept_id',
  'demonstrated_transfer_score',
  'near_transfer_success_count',
  'mid_transfer_success_count',
  'far_transfer_success_count',
  'distinct_novelty_dimensions_ok',
  'last_successful_transfer_at',
  'last_successful_transfer_distance',
  'transfer_depth',
  'policy_version',
  'created_at',
  'updated_at',
] as const;
