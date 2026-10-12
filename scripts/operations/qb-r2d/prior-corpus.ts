/**
 * QB-R2D -- earlier StudyUs pilot drafts as an originality corpus (read only; file IO, no network).
 * The QB-R2B and QB-R2C pilot batches are StudyUs's own drafts: the new items must not repeat them.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { GenerationBatchSchema } from '@/lib/exam-core/question-bank/production/generation-contract';
import type { ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { comparableText } from '@/lib/exam-core/question-bank/production/validated-candidate';

export const PRIOR_PILOT_BATCHES = [['qb-r2b', 'docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json'], ['qb-r2c', 'docs/exams/question-bank/pilots/qb-r2c/pilot-v2-batch.json']] as const;

export function priorPilotCorpus(root: string = process.cwd()): ComparisonEntry[] {
  return PRIOR_PILOT_BATCHES.flatMap(([name, path]) => GenerationBatchSchema.parse(JSON.parse(readFileSync(join(root, path), 'utf8'))).candidates.map((c) => ({ source: 'GENERATION_BATCH_SIBLING' as const, key: `${name}:${c.candidateKey}`, comparisonPermitted: true, text: comparableText(c) })));
}
