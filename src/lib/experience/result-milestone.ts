/**
 * UX-2 -- which achievement a legacy independent check may celebrate.
 *
 * The results screen used to derive "PROVED" / "RETAINED" from the score
 * tier (`messageKey !== 'keep_going'`, i.e. any score >= 50%) -- a UI-side
 * pass rule that contradicted the engine (Canonical V2 requires 80%, and
 * legacy sufficiency is an evidence count, not a score). A milestone is
 * now shown ONLY when the server already reported the requirement as met:
 *
 *   PROVED   <- `proveSufficiency.sufficient` (the canonical independent-
 *               evidence gap re-read after this attempt was written)
 *   RETAINED <- the canonical RETAIN requirement is SATISFIED in
 *               `canonicalResults.requirements`, and the attempt was not
 *               too soon to count (`retentionCheckQualified !== false`)
 *
 * No score, count or threshold is read here.
 */
import type { MilestoneType } from '@/lib/lx/progression-milestones';

export interface ResultMilestoneInput {
  quizMode: string;
  proveSufficiency?: { sufficient?: boolean } | null;
  retentionCheckQualified?: boolean;
  canonicalResults?: { requirements?: unknown } | null;
}

function requirementSatisfied(requirements: unknown, stage: string): boolean {
  if (!Array.isArray(requirements)) return false;
  return requirements.some((r) => !!r && typeof r === 'object' && (r as { stage?: unknown }).stage === stage && (r as { status?: unknown }).status === 'SATISFIED');
}

export function resolveResultMilestone(input: ResultMilestoneInput): MilestoneType | null {
  if (input.quizMode === 'quick_check') {
    return input.proveSufficiency?.sufficient === true ? 'PROVED' : null;
  }
  if (input.quizMode === 'retention_check') {
    if (input.retentionCheckQualified === false) return null;
    return requirementSatisfied(input.canonicalResults?.requirements, 'RETAIN') ? 'RETAINED' : null;
  }
  return null;
}
