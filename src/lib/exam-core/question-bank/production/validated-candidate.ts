/**
 * ValidatedQuestionCandidate: a candidate together with what the AUTOMATED gates found (pure, no IO).
 *
 *   RequirementCell -> GenerationRequest -> QuestionCandidate -> ValidatedQuestionCandidate -> HumanReviewPackage
 *
 * Two gates run here: structural validation and the originality gate. Their verdict decides whether the
 * candidate goes to a reviewer, back to generation, or nowhere. Neither gate judges whether the answer is
 * right, the distractors fair or the concept truly the one required: that is the human review, which this
 * object does not contain and never implies.
 */
import type { CandidateStimulus, QuestionCandidate } from './generation-contract';
import { evaluateOriginality, type ComparisonEntry, type OriginalityGateResult, type OriginalityThresholds } from './originality-gate';
import type { RequirementCell } from './requirement-cell';
import { validateCandidateStructure, type StructuralContext, type StructuralValidation } from './structural-validation';

export const AUTOMATED_STATUSES = ['READY_FOR_HUMAN_REVIEW', 'NEEDS_HUMAN_ORIGINALITY_DECISION', 'NEEDS_REGENERATION', 'REJECTED'] as const;
export type AutomatedStatus = (typeof AUTOMATED_STATUSES)[number];

export interface ValidatedQuestionCandidate {
  candidate: QuestionCandidate;
  cellKey: string;
  structural: StructuralValidation;
  originality: OriginalityGateResult;
  status: AutomatedStatus;
  /** Always false: the automated gates are not a review. */
  humanReviewed: false;
}

/** The text the originality gate compares: stem and options. A shared stimulus is compared once, as its own entry. */
export const comparableText = (c: Pick<QuestionCandidate, 'stem' | 'options'>): string => [c.stem, ...c.options.map((o) => o.text)].join(' \n ');

export function validateQuestionCandidate(p: { candidate: QuestionCandidate; cell: RequirementCell; structuralContext?: StructuralContext; corpus: readonly ComparisonEntry[]; templateFingerprint?: string | null; thresholds?: OriginalityThresholds }): ValidatedQuestionCandidate {
  const structural = validateCandidateStructure(p.candidate, p.cell, p.structuralContext);
  const originality = evaluateOriginality({ text: comparableText(p.candidate), templateFingerprint: p.templateFingerprint ?? null }, p.corpus, p.thresholds);
  const status: AutomatedStatus =
    originality.outcome === 'REJECT_TEXTUAL_SIMILARITY' ? 'REJECTED'
    : structural.outcome === 'FAIL' ? 'NEEDS_REGENERATION'
    : originality.outcome === 'REVIEW_STRUCTURAL_SIMILARITY' ? 'NEEDS_HUMAN_ORIGINALITY_DECISION'
    : 'READY_FOR_HUMAN_REVIEW';
  return { candidate: p.candidate, cellKey: p.cell.cellKey, structural, originality, status, humanReviewed: false };
}

/** The batch siblings of a candidate, as comparison entries. Comparing StudyUs's own drafts is always permitted. */
export function siblingCorpus(candidate: QuestionCandidate, batch: readonly QuestionCandidate[]): ComparisonEntry[] {
  return batch.filter((c) => c.candidateKey !== candidate.candidateKey).map((c) => ({ source: 'GENERATION_BATCH_SIBLING' as const, key: c.candidateKey, comparisonPermitted: true, text: comparableText(c) }));
}

export const stimulusOf = (candidate: QuestionCandidate, stimuli: readonly CandidateStimulus[]): CandidateStimulus | null => (candidate.stimulusKey === null ? null : stimuli.find((s) => s.stimulusKey === candidate.stimulusKey) ?? null);
