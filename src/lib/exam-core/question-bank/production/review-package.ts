/**
 * QB-R2A -- the package a qualified subject-matter reviewer receives (pure, no IO).
 *
 * Everything the reviewer needs on one object: the question with its answer and rationale, where it sits
 * (Domain, Topic), what the author says it is about (PRIMARY / SUPPORTING -- a proposal the reviewer may
 * correct), format, difficulty, provenance, the references consulted, the originality result, the rights
 * status and the intended pool; plus what the reviewer may do. Building a package reviews nothing, and no
 * action can be carried out until a human reviewer holds a qualification for the item's subject and family.
 */
import type { ReferenceIntelligencePack } from './draft-package';
import type { GeneratedCandidate } from './generation-contract';
import type { OriginalityGateResult } from './originality-gate';
import type { RequirementCell } from './requirement-cell';
import type { RightsGateVerdict } from './rights-gate';
import type { StructuralValidation } from './structural-validation';

export const REVIEWER_ACTIONS = ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'CORRECT_ATTRIBUTION'] as const;
export type ReviewerAction = (typeof REVIEWER_ACTIONS)[number];
/** How each action is recorded when it can be: the existing review decisions and the governed attribution writer. */
export const ACTION_RECORDED_AS: Record<ReviewerAction, string> = { APPROVE: 'review decision APPROVED', REJECT: 'review decision REJECTED', REQUEST_REVISION: 'review decision CORRECTION_REQUESTED', CORRECT_ATTRIBUTION: 'the governed attribution writer (setItemAttribution)' };

export interface HumanReviewPackage {
  candidateKey: string;
  cellKey: string;
  question: { stem: string; options: Array<{ id: string; text: string }>; responseFormat: string; language: string; marks: number };
  answer: { answerKey: string; rationale: string };
  curriculum: { examFamily: string; sectionCode: string; domainNodeCode: string; topicNodeCode: string };
  /** The author's proposal. It is not attribution until the reviewer sets it. */
  proposedAttribution: { primaryConceptId: string; supportingConceptIds: string[]; status: 'PROPOSED_BY_AUTHOR' };
  difficultyBand: string;
  provenance: { class: string; lineage: GeneratedCandidate['lineage'] };
  referenceSources: Array<{ sourceKey: string; sourceType: string; title: string; permittedUse: string; accessStatus: string }>;
  structuralValidation: { outcome: string; issues: string[]; isHumanReview: false };
  originality: { outcome: string; maxSimilarity: number; closest: string | null; needsHumanDecision: boolean } | null;
  rights: { status: 'ESTABLISHABLE' | 'NOT_ESTABLISHABLE' | 'NOT_EVALUATED'; supportedReuseRights: string | null; blockers: string[] };
  intendedPool: string;
  stimulus: GeneratedCandidate['stimulus'];
  assets: GeneratedCandidate['assets'];
  availableActions: readonly ReviewerAction[];
  /** Approval needs attribution first, then a qualified reviewer. Stated on the package so no reviewer is surprised. */
  approvalPrerequisites: readonly string[];
}

export function buildHumanReviewPackage(p: { candidate: GeneratedCandidate; cell: RequirementCell; references: ReferenceIntelligencePack; structural: StructuralValidation; originality: OriginalityGateResult | null; rights: RightsGateVerdict | null }): HumanReviewPackage {
  const { candidate: c, cell } = p;
  return {
    candidateKey: c.candidateKey,
    cellKey: cell.cellKey,
    question: { stem: c.stem, options: c.options.map((o) => ({ id: o.id, text: o.text })), responseFormat: c.responseFormat, language: c.language, marks: c.marks },
    answer: { answerKey: c.answerKey, rationale: c.rationale },
    curriculum: { examFamily: cell.examFamily, sectionCode: cell.sectionCode, domainNodeCode: cell.domainNodeCode, topicNodeCode: cell.topicNodeCode },
    proposedAttribution: { primaryConceptId: c.primaryConceptId, supportingConceptIds: [...c.supportingConceptIds], status: 'PROPOSED_BY_AUTHOR' },
    difficultyBand: c.difficultyBand,
    provenance: { class: c.provenance, lineage: c.lineage },
    referenceSources: p.references.sources.map((s) => ({ sourceKey: s.sourceKey, sourceType: s.sourceType, title: s.title, permittedUse: s.permittedUse, accessStatus: s.accessStatus })),
    structuralValidation: { outcome: p.structural.outcome, issues: p.structural.issues.map((i) => `${i.check}:${i.code}`), isHumanReview: false },
    originality: p.originality ? { outcome: p.originality.outcome, maxSimilarity: p.originality.maxSimilarity, closest: p.originality.closest ? `${p.originality.closest.source}:${p.originality.closest.key}` : null, needsHumanDecision: p.originality.record.disposition === null } : null,
    rights: p.rights ? { status: p.rights.deliverable ? 'ESTABLISHABLE' : 'NOT_ESTABLISHABLE', supportedReuseRights: p.rights.deliverable ? p.rights.supportedReuseRights : null, blockers: [...p.rights.blockers] } : { status: 'NOT_EVALUATED', supportedReuseRights: null, blockers: [] },
    intendedPool: cell.intendedPool,
    stimulus: c.stimulus,
    assets: c.assets,
    availableActions: REVIEWER_ACTIONS,
    approvalPrerequisites: ['The item version is ingested and under review', 'The reviewer sets exactly one PRIMARY concept (and any SUPPORTING ones)', 'The reviewer holds a qualification for that concept\'s subject and the exam family, and is not the author'],
  };
}

export type ReviewExecutionBlocker = 'NO_QUALIFIED_REVIEWER' | 'NOT_INGESTED' | 'STRUCTURAL_VALIDATION_FAILED';

/** May a real review be carried out on this package now? In this phase the answer is no: no reviewer is qualified. */
export function reviewExecutionBlockers(p: { pkg: HumanReviewPackage; ingested: boolean; qualifiedReviewerAvailable: boolean }): ReviewExecutionBlocker[] {
  const out: ReviewExecutionBlocker[] = [];
  if (!p.qualifiedReviewerAvailable) out.push('NO_QUALIFIED_REVIEWER');
  if (!p.ingested) out.push('NOT_INGESTED');
  if (p.pkg.structuralValidation.outcome !== 'PASS') out.push('STRUCTURAL_VALIDATION_FAILED');
  return out;
}
