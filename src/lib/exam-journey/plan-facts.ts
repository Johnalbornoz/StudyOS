/**
 * Student Exam Journey -- preparation plan -> learning facts (pure).
 *
 * Exam evidence is exam-specific: another exam's result on a shared concept is
 * context for THIS target, never readiness.
 *
 * G6 (fixed in the plan, exam-core/evidence-scope.ts): the plan is built from
 * THIS target's exam scope -- another target's results and knowledge resting
 * only on another target's (or unscoped legacy) attempt evidence leave a
 * requirement NO_EVIDENCE, so they can neither make this target look ready nor
 * skip its diagnostic. What remains is reported, never hidden:
 *   - `otherExamOnlyRequirements`: requirements with NO evidence for this target
 *     but another exam's evidence on their concepts (context);
 *   - `crossExamEvidenceConcepts`: concepts whose knowledge THIS target uses but
 *     which also include another exam's attempt evidence (one longitudinal
 *     Knowledge State per concept; capped below "already strong" by the plan).
 */
import type { PlannedRequirement, PreparationPlan } from '@/lib/exam-core/objectives/preparation-plan';
import type { LearningEvidenceFacts } from './types';

/** A requirement with no evidence for THIS target whose concepts carry another exam's evidence (result or attempt evidence). */
export function isOtherExamOnly(r: PlannedRequirement): boolean {
  if (r.ownEvidence || r.concepts.some((c) => c.label !== 'NO_EVIDENCE')) return false;
  return r.concepts.some((c) => (c.examEvidence && !c.examEvidence.sameExam) || (c.learner?.examScope?.outOfScopeExamEvidence ?? 0) > 0);
}

/** A concept whose knowledge this target uses although it also rests partly on another exam's attempts. */
const blendsOtherExam = (c: PlannedRequirement['concepts'][number]) => c.label !== 'NO_EVIDENCE' && (c.learner?.examScope?.outOfScopeExamEvidence ?? 0) > 0;

export function learningFactsFromPlan(plan: PreparationPlan, lastMappedLearningEvidenceAt: string | null): LearningEvidenceFacts {
  const mapped = plan.requirements.filter((r) => r.status !== 'NOT_YET_MAPPED');
  const otherOnly = mapped.filter(isOtherExamOnly);
  const own = mapped.filter((r) => !isOtherExamOnly(r));
  const mappedWeight = mapped.reduce((a, r) => a + r.weight, 0);
  const readyWeight = own.filter((r) => r.status === 'ALREADY_STRONG' || r.status === 'NEEDS_CONFIRMATION').reduce((a, r) => a + r.weight, 0);
  const crossExamConcepts = new Set(plan.requirements.flatMap((r) => r.concepts.filter(blendsOtherExam).map((c) => c.canonicalConceptId)));
  const top = plan.recommendations[0] ?? null;
  return {
    mappedRequirements: mapped.length,
    mappedWithEvidence: own.filter((r) => r.status !== 'NO_EVIDENCE').length,
    counts: plan.counts,
    weightedReadyShare: mappedWeight > 0 ? readyWeight / mappedWeight : null,
    topRecommendation: top ? { action: top.recommendation.action, band: top.priority.band } : null,
    lastMappedLearningEvidenceAt,
    crossExamEvidenceConcepts: crossExamConcepts.size,
    otherExamOnlyRequirements: otherOnly.length,
  };
}
