/**
 * QUESTION FACTORY CANARY 250 -- the spend projection, measured offline (file IO, no network). FROZEN.
 *
 * Generation prompts are rendered for all 250 slots: their sizes are exact. Review requests cannot be rendered
 * before there are candidates, so their size is measured on STAND-INS: the 22 stored QB-R2E candidates, put through
 * the same redaction and the same request builder with their own specifications and revision-4 results. The
 * stand-ins are used to MEASURE A SIZE. They are not canary items, they are sent nowhere, and nothing is scored.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SpecificationBatchSchema } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { validateSpecificationCandidateR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { buildR2eSelection } from '../qb-r2e/selection';
import { projectSpend, type Projection } from './budget';
import { canaryManifest, loadCanaryEvidence } from './evidence';
import { planGeneration } from './pipeline';
import { buildReviewInput, renderReviewRequest, type RenderedReview } from './reviewer';

export const REVIEW_STAND_INS = 'the 22 stored QB-R2E candidates (size measurement only)' as const;
/** The review requests of the stand-ins, in stored order. */
export function standInReviewRequests(root: string = process.cwd()): Array<RenderedReview & { unitKey: string }> {
  const batch = SpecificationBatchSchema.parse((JSON.parse(readFileSync(join(root, 'docs/exams/question-bank/pilots/qb-r2e/generated-batch.json'), 'utf8')) as { batch: unknown }).batch);
  const specs = new Map(buildR2eSelection().map((s) => [s.specification.specificationId, s.specification]));
  return batch.candidates.map((candidate) => {
    const specification = specs.get(candidate.specificationId)!;
    const stimulus = candidate.stimulusKey ? batch.stimuli.find((s) => s.stimulusKey === candidate.stimulusKey) ?? null : null;
    const validation = validateSpecificationCandidateR4({ candidate, specification, stimulus, siblings: batch.candidates });
    return { unitKey: candidate.unitKey, ...renderReviewRequest(buildReviewInput({ slotId: 'stand-in', specification, candidate, stimulus, validation })) };
  });
}
export const standInReviewCharacters = (root: string = process.cwd()): number[] => standInReviewRequests(root).map((r) => r.system.length + r.user.length);
export function generationPromptCharacters(root: string, model: string): number[] {
  const evidence = loadCanaryEvidence(root);
  return canaryManifest(root).slots.map((slot) => { const p = planGeneration(slot, model, evidence); return p.system.length + p.user.length; });
}
export function canaryProjection(root: string, model: string): Projection {
  return projectSpend({ priorUsd: loadCanaryEvidence(root).priorSpendUsd.total, generationPromptCharacters: generationPromptCharacters(root, model), reviewPromptCharacters: standInReviewCharacters(root), reviewMeasuredOn: REVIEW_STAND_INS });
}
if (process.argv[1] && /qb-canary-250[\\/]projection\.ts$/.test(process.argv[1])) console.log(JSON.stringify(canaryProjection(process.cwd(), 'gpt-5.6-luna'), null, 1));
