/**
 * The package a qualified subject-matter reviewer receives (pure, no IO).
 *
 *   RequirementCell -> GenerationRequest -> QuestionCandidate -> ValidatedQuestionCandidate -> HumanReviewPackage
 *
 * Everything the reviewer needs on one object: the question with its stimulus, answer and rationale, where it
 * sits (Domain, Topic), the PRIMARY concept it was written for and the SUPPORTING ones the author proposes,
 * format, difficulty, provenance, the references consulted, what the automated gates found, the rights status
 * and the intended pool; plus what the reviewer may do. Building a package reviews nothing, and no action can
 * be carried out until a human reviewer holds a qualification for the item's subject and exam family.
 */
import type { CandidateStimulus } from './generation-contract';
import type { ReferenceIntelligencePack } from './reference-pack';
import type { RequirementCell } from './requirement-cell';
import type { RightsGateVerdict } from './rights-gate';
import { stimulusOf, type ValidatedQuestionCandidate } from './validated-candidate';

export const REVIEWER_ACTIONS = ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'CORRECT_ATTRIBUTION'] as const;
export type ReviewerAction = (typeof REVIEWER_ACTIONS)[number];
/** How each action is recorded when it can be: the existing review decisions and the governed attribution writer. */
export const ACTION_RECORDED_AS: Record<ReviewerAction, string> = { APPROVE: 'review decision APPROVED', REJECT: 'review decision REJECTED', REQUEST_REVISION: 'review decision CORRECTION_REQUESTED', CORRECT_ATTRIBUTION: 'the governed attribution writer (setItemAttribution)' };
export const REVIEW_STATUSES = ['BLOCKED_NO_QUALIFIED_REVIEWER', 'BLOCKED_NOT_INGESTED', 'BLOCKED_AUTOMATED_GATES', 'AWAITING_HUMAN_REVIEW'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface HumanReviewPackage {
  candidateKey: string;
  cellKey: string;
  question: { stem: string; options: Array<{ id: string; text: string }>; responseFormat: string; language: string; marks: number };
  stimulus: CandidateStimulus | null;
  answer: { answerKey: string; rationale: string; distractorRationales: Record<string, string> };
  curriculum: { examFamily: string; sectionCode: string; domainNodeCode: string; topicNodeCode: string; curriculumCurrentness: string };
  /** PRIMARY is the cell's target; SUPPORTING is the author's proposal. Neither is attribution until the reviewer sets it. */
  attribution: { targetPrimaryConcept: { stableId: string; canonicalSubject: string; canonicalName: string }; proposedSupportingConceptStableIds: string[]; status: 'TARGET_AND_PROPOSAL__NOT_REVIEWED' };
  difficultyBand: string;
  difficultyBasis: string;
  provenance: { class: string; lineage: ValidatedQuestionCandidate['candidate']['lineage'] };
  referenceSources: Array<{ sourceKey: string; sourceType: string; title: string; permittedUse: string; accessStatus: string }>;
  automatedGates: { status: string; structural: { outcome: string; issues: string[] }; originality: { outcome: string; maxSimilarity: number; closest: string | null; needsHumanDecision: boolean }; isHumanReview: false };
  rights: { status: 'ESTABLISHABLE' | 'NOT_ESTABLISHABLE' | 'NOT_EVALUATED'; supportedReuseRights: string | null; blockers: string[] };
  intendedPool: string;
  availableActions: readonly ReviewerAction[];
  approvalPrerequisites: readonly string[];
  reviewStatus: ReviewStatus;
}

export function buildHumanReviewPackage(p: { validated: ValidatedQuestionCandidate; cell: RequirementCell; stimuli: readonly CandidateStimulus[]; references: ReferenceIntelligencePack; rights: RightsGateVerdict | null; ingested: boolean; qualifiedReviewerAvailable: boolean }): HumanReviewPackage {
  const { validated: v, cell } = p;
  const c = v.candidate;
  const gatesOk = v.status === 'READY_FOR_HUMAN_REVIEW' || v.status === 'NEEDS_HUMAN_ORIGINALITY_DECISION';
  const reviewStatus: ReviewStatus = !gatesOk ? 'BLOCKED_AUTOMATED_GATES' : !p.qualifiedReviewerAvailable ? 'BLOCKED_NO_QUALIFIED_REVIEWER' : !p.ingested ? 'BLOCKED_NOT_INGESTED' : 'AWAITING_HUMAN_REVIEW';
  return {
    candidateKey: c.candidateKey,
    cellKey: cell.cellKey,
    question: { stem: c.stem, options: c.options.map((o) => ({ id: o.id, text: o.text })), responseFormat: c.responseFormat, language: c.language, marks: c.marks },
    stimulus: stimulusOf(c, p.stimuli),
    answer: { answerKey: c.answerKey, rationale: c.rationale, distractorRationales: { ...c.distractorRationales } },
    curriculum: { examFamily: cell.examFamily, sectionCode: cell.sectionCode, domainNodeCode: cell.domainNodeCode, topicNodeCode: cell.topicNodeCode, curriculumCurrentness: cell.curriculumCurrentness },
    attribution: { targetPrimaryConcept: { ...cell.primaryConcept }, proposedSupportingConceptStableIds: [...c.proposedSupportingConceptStableIds], status: 'TARGET_AND_PROPOSAL__NOT_REVIEWED' },
    difficultyBand: c.difficultyBand,
    difficultyBasis: cell.difficultyBasis,
    provenance: { class: c.provenance, lineage: c.lineage },
    referenceSources: p.references.sources.map((s) => ({ sourceKey: s.sourceKey, sourceType: s.sourceType, title: s.title, permittedUse: s.permittedUse, accessStatus: s.accessStatus })),
    automatedGates: {
      status: v.status, structural: { outcome: v.structural.outcome, issues: v.structural.issues.map((i) => `${i.check}:${i.code}`) },
      originality: { outcome: v.originality.outcome, maxSimilarity: v.originality.maxSimilarity, closest: v.originality.closest ? `${v.originality.closest.source}:${v.originality.closest.key}` : null, needsHumanDecision: v.originality.record.disposition === null },
      isHumanReview: false,
    },
    rights: p.rights ? { status: p.rights.deliverable ? 'ESTABLISHABLE' : 'NOT_ESTABLISHABLE', supportedReuseRights: p.rights.deliverable ? p.rights.supportedReuseRights : null, blockers: [...p.rights.blockers] } : { status: 'NOT_EVALUATED', supportedReuseRights: null, blockers: [] },
    intendedPool: cell.intendedPool,
    availableActions: REVIEWER_ACTIONS,
    approvalPrerequisites: ['The item version is ingested and under review', 'The reviewer sets exactly one PRIMARY concept (and any SUPPORTING ones)', "The reviewer holds a qualification for that concept's subject and the exam family, and is not the author"],
    reviewStatus,
  };
}
