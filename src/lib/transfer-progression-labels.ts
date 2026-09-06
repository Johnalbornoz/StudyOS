/**
 * Phase 7 -- Step 7F1: learner-safe transfer progression labels.
 *
 * The ONLY transfer vocabulary a learner ever sees. It maps the
 * canonical `concept_transfer_state.transfer_depth` to a short,
 * encouraging, plain-language phrase. It deliberately NEVER exposes:
 *   - the raw NEAR / MID / FAR distance names,
 *   - novelty dimensions, task family ids, prompt fingerprints,
 *   - distance weights or demonstrated-transfer scores,
 *   - the transfer policy version or any engine-internal identifier.
 *
 * PURE. No DB, no AI. Takes the already-read depth (null == no
 * concept_transfer_state row yet) and the caller's message table.
 */
import type { TransferDepth } from '@/lib/transfer-policy';
import type { getMessages } from '@/lib/i18n/messages';

type Messages = ReturnType<typeof getMessages>;

const DEPTH_MESSAGE_KEY: Record<TransferDepth, keyof Messages> = {
  NONE: 'conceptDetail.transferDepth.none',
  NEAR_DEMONSTRATED: 'conceptDetail.transferDepth.nearDemonstrated',
  GENERALIZED: 'conceptDetail.transferDepth.generalized',
  ROBUST: 'conceptDetail.transferDepth.robust',
};

/**
 * The learner-facing phrase for a concept's demonstrated transfer
 * progression. `null` depth (no row yet) returns the same phrase as
 * `NONE` -- "not yet applied in a new situation" is true either way,
 * and the distinction is engine-internal.
 */
export function transferDepthLabel(depth: TransferDepth | null, t: Messages): string {
  return t[DEPTH_MESSAGE_KEY[depth ?? 'NONE']];
}

/** True when there is anything encouraging to show (any demonstrated depth). */
export function hasDemonstratedTransfer(depth: TransferDepth | null): boolean {
  return depth === 'NEAR_DEMONSTRATED' || depth === 'GENERALIZED' || depth === 'ROBUST';
}
