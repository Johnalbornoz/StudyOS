/**
 * Phase 7 -- Step 7G1: derived deep-learning metrics.
 *
 * Five read-only DERIVATIONS from canonical `concept_transfer_state`
 * (plus the distinct novelty dimensions demonstrated). They are NOT new
 * Knowledge State dimensions, NOT persisted, and NOT consumed by any
 * decision -- they are a lens on transfer state for a future
 * reporting / EVALUATE surface (7G3). Every metric is a small
 * deterministic ordinal 0-3.
 *
 *   recognition     notices WHEN the concept applies (any qualified transfer success)
 *   generalization  applies it beyond the first context (demonstrated transfer depth)
 *   connection      links it to other ideas (CONCEPT_COMBINATION novelty + FAR successes)
 *   adaptation      adjusts the approach for a new situation (STRATEGY / DATA_PRESENTATION
 *                   / REPRESENTATION novelty + MID/FAR successes)
 *   justification   can defend the reasoning, not just the answer -- conservatively
 *                   proxied from the rolling demonstrated transfer score until a
 *                   dedicated justification signal exists (7G3 EVALUATE extension)
 *
 * PURE. No DB, no AI, no clock.
 */
import type { TransferDepth, NoveltyDimension } from '@/lib/transfer-policy';

export interface DeepLearningInput {
  transferDepth: TransferDepth;
  nearTransferSuccessCount: number;
  midTransferSuccessCount: number;
  farTransferSuccessCount: number;
  distinctNoveltyDimensionsOk: readonly NoveltyDimension[];
  demonstratedTransferScore: number | null;
}

export type DeepLearningMetric = 'recognition' | 'generalization' | 'connection' | 'adaptation' | 'justification';

export type DeepLearningProfile = Record<DeepLearningMetric, 0 | 1 | 2 | 3> & {
  /** Weakest-link summary -- deep learning is only as strong as its thinnest strand. */
  overall: 0 | 1 | 2 | 3;
};

const DEPTH_RANK: Record<TransferDepth, 0 | 1 | 2 | 3> = {
  NONE: 0,
  NEAR_DEMONSTRATED: 1,
  GENERALIZED: 2,
  ROBUST: 3,
};

function clamp03(n: number): 0 | 1 | 2 | 3 {
  return (n < 0 ? 0 : n > 3 ? 3 : Math.floor(n)) as 0 | 1 | 2 | 3;
}

export function deriveDeepLearningProfile(input: DeepLearningInput): DeepLearningProfile {
  const dims = new Set(input.distinctNoveltyDimensionsOk);
  const successes = input.nearTransferSuccessCount + input.midTransferSuccessCount + input.farTransferSuccessCount;
  const midFar = input.midTransferSuccessCount + input.farTransferSuccessCount;

  const recognition = clamp03(successes);
  const generalization = DEPTH_RANK[input.transferDepth];

  let connection = 0;
  if (dims.has('CONCEPT_COMBINATION')) connection = 1 + Math.min(2, input.farTransferSuccessCount);

  const adaptationDims = ['STRATEGY', 'DATA_PRESENTATION', 'REPRESENTATION'].filter((d) => dims.has(d as NoveltyDimension)).length;
  const adaptation = clamp03(adaptationDims > 0 ? adaptationDims + Math.min(1, midFar) : 0);

  const score = input.demonstratedTransferScore;
  const justification = score === null ? 0 : score >= 80 ? 3 : score >= 60 ? 2 : score >= 40 ? 1 : 0;

  const metrics = {
    recognition,
    generalization,
    connection: clamp03(connection),
    adaptation,
    justification,
  } as const;

  const overall = Math.min(...Object.values(metrics)) as 0 | 1 | 2 | 3;
  return { ...metrics, overall };
}
