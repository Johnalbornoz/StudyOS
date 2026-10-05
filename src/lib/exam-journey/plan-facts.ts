/**
 * Student Exam Journey -- preparation plan -> learning facts (pure).
 *
 * Exam evidence is exam-specific: another exam's result on a shared concept is
 * context for THIS target ("confirm in this exam's format"), never readiness.
 * The plan already marks such a requirement NEEDS_CONFIRMATION; here it is kept
 * OUT of the ready share and of the evidence coverage, so another exam can never
 * make this target look ready, nor skip its diagnostic.
 *
 * G6 (reported, not fixed here): the shared learner state of a concept may itself
 * include another exam's simulation evidence (legacy knowledge-state scoring
 * counts EXAM_SIMULATION). That cannot be separated from the plan; it is counted
 * in `crossExamEvidenceConcepts` so the resolver flags the risk.
 */
import type { PlannedRequirement, PreparationPlan } from '@/lib/exam-core/objectives/preparation-plan';
import type { LearningEvidenceFacts } from './types';

/** A requirement whose ONLY evidence is another exam's result (no own exam evidence, no learner evidence). */
export function isOtherExamOnly(r: PlannedRequirement): boolean {
  if (r.status !== 'NEEDS_CONFIRMATION' || r.ownEvidence) return false;
  const otherExam = r.concepts.some((c) => c.examEvidence && !c.examEvidence.sameExam);
  return otherExam && r.concepts.every((c) => c.label === 'NO_EVIDENCE');
}

export function learningFactsFromPlan(plan: PreparationPlan, lastMappedLearningEvidenceAt: string | null): LearningEvidenceFacts {
  const mapped = plan.requirements.filter((r) => r.status !== 'NOT_YET_MAPPED');
  const otherOnly = mapped.filter(isOtherExamOnly);
  const own = mapped.filter((r) => !isOtherExamOnly(r));
  const mappedWeight = mapped.reduce((a, r) => a + r.weight, 0);
  const readyWeight = own.filter((r) => r.status === 'ALREADY_STRONG' || r.status === 'NEEDS_CONFIRMATION').reduce((a, r) => a + r.weight, 0);
  const crossExamConcepts = new Set(plan.requirements.flatMap((r) => r.concepts.filter((c) => c.examEvidence && !c.examEvidence.sameExam).map((c) => c.canonicalConceptId)));
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
