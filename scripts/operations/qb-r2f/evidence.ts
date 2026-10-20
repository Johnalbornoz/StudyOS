/**
 * QB-R2F -- what the next run reads of earlier runs (read only; file IO, no network). Nothing of QB-R2D or QB-R2E is written.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { SpecificationBatchSchema, type SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { priorPilotCorpus } from '../qb-r2d/prior-corpus';

export interface R2fEvidence { priorCandidates: readonly SpecificationCandidate[]; pilotCorpus: readonly ComparisonEntry[] }
const R2D = 'docs/exams/question-bank/pilots/qb-r2d';
const R2E = 'docs/exams/question-bank/pilots/qb-r2e';
/** Every candidate QB-R2D and QB-R2E produced, QB-R2D first, in stored order. */
export function priorCandidates(root: string = process.cwd()): SpecificationCandidate[] {
  const r2d = SpecificationBatchSchema.parse(JSON.parse(readFileSync(join(root, R2D, 'generated-batch.json'), 'utf8'))).candidates;
  const r2e = SpecificationBatchSchema.parse((JSON.parse(readFileSync(join(root, R2E, 'generated-batch.json'), 'utf8')) as { batch: unknown }).batch).candidates;
  return [...r2d, ...r2e];
}
/** The spend of QB-R2D and QB-R2E on the assumed guard basis, recomputed from their ledger entries. */
export function priorSpendUsdGuardBasis(root: string = process.cwd()): { r2d: number; r2e: number; total: number } {
  const sum = (dir: string) => (JSON.parse(readFileSync(join(root, dir, 'spend-ledger.json'), 'utf8')) as { entries: Array<{ costUsdGuardBasis: number }> }).entries.reduce((n, e) => n + e.costUsdGuardBasis, 0);
  const r2d = sum(R2D), r2e = sum(R2E);
  return { r2d, r2e, total: r2d + r2e };
}
export const loadR2fEvidence = (root: string = process.cwd()): R2fEvidence => ({ priorCandidates: priorCandidates(root), pilotCorpus: priorPilotCorpus(root) });
