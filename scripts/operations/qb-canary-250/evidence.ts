/**
 * QUESTION FACTORY CANARY 250 -- what the canary reads of earlier runs (read only; file IO, no network). FROZEN.
 * Nothing of QB-R2D, QB-R2E or QB-R2F is written.
 */
import { storedR2dSelection } from '../qb-r2d/stored-selection';
import { buildR2eSelection } from '../qb-r2e/selection';
import { loadR2fEvidence, priorSpendUsdGuardBasis, type R2fEvidence } from '../qb-r2f/evidence';
import { buildR2fSelection } from '../qb-r2f/selection';
import { buildCanaryManifest, type CanaryManifest, type PriorUse } from './manifest';

export interface CanaryEvidence extends R2fEvidence { priorUse: PriorUse; priorSpendUsd: { r2d: number; r2e: number; total: number } }
export function loadCanaryEvidence(root: string = process.cwd()): CanaryEvidence {
  const base = loadR2fEvidence(root);
  // QB-R2F's twenty specifications were never generated from; they are excluded all the same, so that run stays available unchanged
  const specificationIds = new Set<string>([...storedR2dSelection(root).map((s) => s.specification.specificationId), ...buildR2eSelection().map((s) => s.specification.specificationId), ...buildR2fSelection().map((s) => s.specification.specificationId)]);
  return { ...base, priorUse: { specificationIds, candidates: base.priorCandidates }, priorSpendUsd: priorSpendUsdGuardBasis(root) };
}
let cached: { root: string; manifest: CanaryManifest } | null = null;
/** The manifest, built once per process. */
export function canaryManifest(root: string = process.cwd()): CanaryManifest {
  if (!cached || cached.root !== root) cached = { root, manifest: buildCanaryManifest(loadCanaryEvidence(root).priorUse) };
  return cached.manifest;
}
