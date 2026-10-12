/**
 * POST-CANARY -- the frozen Canary, read back (file IO; no network, no key, no transport). Nothing is written here.
 * The candidates and their revision-4 results are DERIVED by the Canary's own frozen pipeline from its run log, so
 * what revision 5 is given is exactly what the Canary scored.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { canaryManifest, loadCanaryEvidence } from '../qb-canary-250/evidence';
import { deriveGeneration, validateBatch, type GenerationResult } from '../qb-canary-250/pipeline';
import { CANARY_DIR, CANARY_FILES } from '../qb-canary-250/report';
import type { AiDecision, ReviewResponse } from '../qb-canary-250/reviewer';
import { RunLog } from '../qb-canary-250/run-log';

export const CANARY_MODEL = 'gpt-5.6-luna' as const;
export interface FrozenReview { slotId: string; state: string; code: string | null; review: ReviewResponse | null; decision: AiDecision | null }
export interface CanaryReadBack { log: RunLog; generation: GenerationResult[]; validations: Map<string, SpecificationItemValidationR4>; reviews: Map<string, FrozenReview>; priorUsd: number }
export const readCanaryJson = <T>(root: string, file: string): T => JSON.parse(readFileSync(join(root, CANARY_DIR, file), 'utf8')) as T;
let cache: { root: string; value: CanaryReadBack } | null = null;
export async function readCanary(root: string = process.cwd()): Promise<CanaryReadBack> {
  if (cache && cache.root === root) return cache.value;
  const evidence = loadCanaryEvidence(root);
  const log = new RunLog(RunLog.parse(readFileSync(join(root, CANARY_DIR, CANARY_FILES.runLog), 'utf8')));
  const generation = await deriveGeneration(canaryManifest(root), log, evidence, CANARY_MODEL);
  const validations = validateBatch(generation, evidence);
  // the AI reviews are FROZEN: they are read from the stored artifact, never recomputed and never re-run
  const reviews = new Map(readCanaryJson<{ reviews: FrozenReview[] }>(root, CANARY_FILES.aiReview).reviews.map((r) => [r.slotId, r]));
  cache = { root, value: { log, generation, validations, reviews, priorUsd: evidence.priorSpendUsd.total } };
  return cache.value;
}
