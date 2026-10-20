/**
 * QB-R2E -- what the fresh run reads of earlier runs (read only; file IO, no network). Nothing of QB-R2D is written.
 *
 *   - the QB-R2D candidates: the fresh items must not repeat their wording or their parameter sets;
 *   - the parameter sets QB-R2D used, by construct: the fresh prompts say which sets not to reuse;
 *   - the QB-R2D spend, from its ledger: the cumulative cap counts it;
 *   - the QB-R2B and QB-R2C pilot drafts, as before.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { SpecificationBatchSchema, type SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { priorPilotCorpus } from '../qb-r2d/prior-corpus';

const R2D = 'docs/exams/question-bank/pilots/qb-r2d';
export function r2dCandidates(root: string = process.cwd()): SpecificationCandidate[] {
  return SpecificationBatchSchema.parse(JSON.parse(readFileSync(join(root, R2D, 'generated-batch.json'), 'utf8'))).candidates;
}
/** Every parameter set QB-R2D used, by construct, in a stable order and without repeats. */
export function r2dParameterSets(root: string = process.cwd()): Record<string, Array<Record<string, number>>> {
  const out: Record<string, Array<Record<string, number>>> = {};
  const seen = new Set<string>();
  for (const c of r2dCandidates(root)) {
    const { construct, parameters } = c.content.declaredModel;
    const key = `${construct}|${JSON.stringify(Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : 1)))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (out[construct] ??= []).push(Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : 1))));
  }
  return out;
}
/** QB-R2D's spend on the assumed guard basis, recomputed from its ledger entries (not read from its totals). */
export function r2dSpendUsdGuardBasis(root: string = process.cwd()): number {
  const ledger = JSON.parse(readFileSync(join(root, R2D, 'spend-ledger.json'), 'utf8')) as { entries: Array<{ costUsdGuardBasis: number }> };
  return ledger.entries.reduce((n, e) => n + e.costUsdGuardBasis, 0);
}
export const pilotCorpus = (root: string = process.cwd()): ComparisonEntry[] => priorPilotCorpus(root);
