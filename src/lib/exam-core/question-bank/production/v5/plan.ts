/**
 * Question Factory V5 -- from a coverage gap to immutable generation specifications.
 *
 * Generation is allocated by what the bank lacks (readiness.generationAllocation), never split equally between
 * families. Each allocated slot becomes one specification: its bucket, format, tier, marks, command term and
 * cognitive target are fixed here, before anything is authored, and none of it is shown to a learner.
 *
 * Pure and deterministic: the same gap gives the same specifications.
 */
import { GENERATOR_PROFILE_VERSION, profileById, type DifficultyTier, type ItemFormat, type QuestionGenerationProfile } from './generation-profile';
import { GenerationSpecificationSchema, type GenerationSpecification } from './item';
import type { AllocationRow, BlueprintSection } from './readiness';

/** StudyUs policy: 30 % foundational, 50 % standard, 20 % challenge, as a repeating cycle of ten. */
export const TIER_CYCLE: readonly DifficultyTier[] = ['STANDARD', 'FOUNDATIONAL', 'STANDARD', 'CHALLENGE', 'STANDARD', 'FOUNDATIONAL', 'STANDARD', 'FOUNDATIONAL', 'STANDARD', 'CHALLENGE'];
const MARK_POSITION: Record<DifficultyTier, number> = { FOUNDATIONAL: 0.15, STANDARD: 0.45, CHALLENGE: 0.8 };
const SELECTED_TYPES = ['multiple_choice', 'selected_response', 'mcq'];
const fold = (s: string): string => s.toLowerCase();

function formatFor(p: QuestionGenerationProfile, questionType: string | null, i: number): ItemFormat {
  if (questionType && SELECTED_TYPES.includes(fold(questionType)) && p.itemFormats.includes('SELECTED_RESPONSE')) return 'SELECTED_RESPONSE';
  return p.itemFormats[i % p.itemFormats.length];
}
function marksFor(p: QuestionGenerationProfile, format: ItemFormat, tier: DifficultyTier): number {
  if (format === 'SELECTED_RESPONSE' || format === 'MULTI_SELECT') return p.markPolicy.selectedResponseMarks;
  const [lo, hi] = p.markPolicy.constructedMarks;
  // a single short response sits in the lower half of the range; marks follow the work demanded, not the tier label
  const top = format === 'SHORT_RESPONSE' ? Math.max(lo, Math.round(lo + (hi - lo) * 0.35)) : hi;
  return Math.max(format === 'MULTI_PART' ? Math.max(lo, 4) : lo, Math.round(lo + (top - lo) * MARK_POSITION[tier]));
}
function commandTermFor(p: QuestionGenerationProfile, format: ItemFormat, declared: string | null, i: number): string | null {
  if (!p.commandTermPolicy.required || format === 'SELECTED_RESPONSE' || format === 'MULTI_SELECT') return null;
  const allowed = p.commandTermPolicy.allowed;
  const first = declared?.split('/')[0]?.trim() ?? null;
  return first && allowed.map(fold).includes(fold(first)) ? first : allowed[i % allowed.length];
}

export function planSpecifications(sections: readonly BlueprintSection[], allocation: readonly AllocationRow[], limit: number = Number.MAX_SAFE_INTEGER): GenerationSpecification[] {
  const buckets = new Map(sections.flatMap((s) => s.buckets.map((b) => [b.bucketKey, { s, b }] as const)));
  const out: GenerationSpecification[] = [];
  for (const row of allocation) {
    const found = buckets.get(row.bucket);
    const p = profileById(row.profileId);
    if (!found || !p) continue;
    for (let i = 0; i < row.toGenerate && out.length < limit; i += 1) {
      const tier = TIER_CYCLE[(i + found.b.targetIndex) % TIER_CYCLE.length];
      const format = formatFor(p, found.b.questionType, i);
      out.push(GenerationSpecificationSchema.parse({
        v: 1, slotKey: `${row.bucket}/${String(i + 1).padStart(3, '0')}`, profileId: p.profileId, profileVersion: GENERATOR_PROFILE_VERSION, family: p.family, configKey: found.s.configKey, sectionKey: found.s.sectionKey,
        bucket: { objectiveCode: found.b.objectiveCode, targetIndex: found.b.targetIndex }, conceptIds: [], objectiveIds: [found.b.objectiveCode], skillIds: [], competencyIds: [],
        itemFormat: format, intendedDifficulty: tier, intendedMarks: marksFor(p, format, tier), commandTerm: commandTermFor(p, format, found.b.commandTerm, i),
        cognitiveTarget: `${found.b.description.slice(0, 260)} -- ${p.cognitiveModel.requiredMoves[i % p.cognitiveModel.requiredMoves.length]}`.slice(0, 400),
        contextRequirement: p.contextPolicy.requirement, responseExpectation: p.responseLength.slice(0, 400), language: p.language, attempt: 0,
      }));
    }
  }
  return out;
}
