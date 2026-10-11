/**
 * Q1 PILOT_ELIGIBLE -- the conditions this layer can decide from stored facts (pure, no IO).
 *
 * A reviewed-bank item is PILOT_ELIGIBLE only when all twelve Q1-I2 conditions hold. This module evaluates the
 * ones whose facts the coverage contract carries, and names the rest as not evaluated here, so nothing reads a
 * partial result as the whole verdict:
 *
 *   evaluated   1 lifecycle / current version, 2 human review, 7 stimulus and assets, 8 reuse rights
 *               (all through `evaluateQuestionEligibility`, the one delivery rule),
 *               4 exactly one PRIMARY concept, 5 one official Domain and one Topic, 9 provenance
 *   elsewhere   3 reviewer qualification (enforced by the database when the review is recorded),
 *               6 response format and 12 blueprint cell (B2, against a published variant),
 *               10 originality check and 11 pool membership (Question Bank facts not on this contract)
 *
 * Condition 5 is decided from the stored link only: item version -> ONE node, which must be an active Topic
 * whose direct parent is an active official Domain, in the published structure version of the item's own
 * objective (and inside the request's curriculum scope, when one is given). A Domain or Topic is never
 * inferred from a name, and the text or code of a legacy objective is never a substitute. An item with no
 * link does not satisfy it.
 */
import { directEvidenceConceptId, type QuestionCoverage } from './question-coverage';
import { evaluateQuestionEligibility, type IneligibilityReason, type QuestionEligibilityRequest } from './question-eligibility';

export const CURRICULUM_TOPIC_NODE_TYPE = 'TOPIC' as const;
export const CURRICULUM_DOMAIN_NODE_TYPE = 'DOMAIN' as const;
/** `structure_nodes.source` of a Domain the exam's own specification defines. */
export const OFFICIAL_NODE_SOURCE = 'OFFICIAL' as const;
const CURRENT_STRUCTURE_VERSION_STATUS = 'PUBLISHED';
const ACTIVE_NODE_STATUS = 'ACTIVE';

export type CurriculumTraceReason =
  | 'TOPIC_LINK_MISSING'
  | 'LINKED_NODE_NOT_A_TOPIC'
  | 'TOPIC_NOT_ACTIVE'
  | 'TOPIC_WITHOUT_DOMAIN'
  | 'DOMAIN_NOT_OFFICIAL'
  | 'DOMAIN_NOT_ACTIVE'
  | 'TOPIC_OUTSIDE_ITEM_CURRICULUM'
  | 'STRUCTURE_VERSION_NOT_CURRENT'
  | 'TOPIC_OUTSIDE_REQUEST_CURRICULUM';

export type CurriculumTraceVerdict = { satisfied: true; topicNodeId: string; domainNodeId: string; structureVersionId: string } | { satisfied: false; reasons: CurriculumTraceReason[] };

/** Condition 5: exactly one official Domain and exactly one Topic, from the stored link. */
export function curriculumTraceVerdict(coverage: QuestionCoverage, scope?: { structureVersionIds?: readonly string[] | null }): CurriculumTraceVerdict {
  const t = coverage.curriculumTrace;
  if (!t) return { satisfied: false, reasons: ['TOPIC_LINK_MISSING'] };
  const reasons: CurriculumTraceReason[] = [];
  if (t.nodeType !== CURRICULUM_TOPIC_NODE_TYPE) reasons.push('LINKED_NODE_NOT_A_TOPIC');
  if (t.nodeStatus !== ACTIVE_NODE_STATUS) reasons.push('TOPIC_NOT_ACTIVE');
  if (!t.parent || t.parent.nodeType !== CURRICULUM_DOMAIN_NODE_TYPE) reasons.push('TOPIC_WITHOUT_DOMAIN');
  else {
    if (t.parent.source !== OFFICIAL_NODE_SOURCE) reasons.push('DOMAIN_NOT_OFFICIAL');
    if (t.parent.status !== ACTIVE_NODE_STATUS) reasons.push('DOMAIN_NOT_ACTIVE');
  }
  if (!t.inObjectiveStructureVersion) reasons.push('TOPIC_OUTSIDE_ITEM_CURRICULUM');
  if (t.structureVersionStatus !== CURRENT_STRUCTURE_VERSION_STATUS) reasons.push('STRUCTURE_VERSION_NOT_CURRENT');
  const wanted = scope?.structureVersionIds ?? null;
  if (wanted && wanted.length > 0 && !wanted.includes(t.structureVersionId)) reasons.push('TOPIC_OUTSIDE_REQUEST_CURRICULUM');
  return reasons.length === 0 && t.parent ? { satisfied: true, topicNodeId: t.nodeId, domainNodeId: t.parent.nodeId, structureVersionId: t.structureVersionId } : { satisfied: false, reasons };
}

export const PILOT_CONDITIONS_EVALUATED = ['DELIVERY_RULE_AND_RIGHTS', 'HUMAN_REVIEW', 'ONE_PRIMARY_CONCEPT', 'ONE_DOMAIN_ONE_TOPIC', 'PROVENANCE'] as const;
export const PILOT_CONDITIONS_NOT_EVALUATED_HERE = ['REVIEWER_QUALIFICATION', 'RESPONSE_FORMAT', 'ORIGINALITY_CHECK', 'POOL_MEMBERSHIP', 'BLUEPRINT_CELL'] as const;

export type PilotIneligibilityReason = IneligibilityReason | CurriculumTraceReason | 'NOT_HUMAN_REVIEWED' | 'PRIMARY_CONCEPT_MISSING' | 'PROVENANCE_NOT_ELIGIBLE';

export interface PilotEligibility {
  /** True only for the conditions listed in `evaluated`. It is never the full PILOT_ELIGIBLE verdict on its own. */
  evaluatedConditionsHold: boolean;
  reasons: PilotIneligibilityReason[];
  curriculum: CurriculumTraceVerdict;
  primaryConceptId: string | null;
  evaluated: typeof PILOT_CONDITIONS_EVALUATED;
  notEvaluatedHere: typeof PILOT_CONDITIONS_NOT_EVALUATED_HERE;
}

const ELIGIBLE_PROVENANCE: ReadonlySet<string> = new Set(['OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'STUDYUS_AUTHORED']);

export function evaluatePilotEligibility(coverage: QuestionCoverage, request: QuestionEligibilityRequest): PilotEligibility {
  const reasons: PilotIneligibilityReason[] = [];
  const base = evaluateQuestionEligibility(coverage, { ...request, audience: 'STUDENT' });
  if (!base.eligible) reasons.push(...base.reasons);
  if (!(coverage.review.humanReviewed.state === 'KNOWN' && coverage.review.humanReviewed.value)) reasons.push('NOT_HUMAN_REVIEWED');
  const primaryConceptId = directEvidenceConceptId(coverage);
  if (!primaryConceptId) reasons.push('PRIMARY_CONCEPT_MISSING');
  const curriculum = curriculumTraceVerdict(coverage, { structureVersionIds: request.structureVersionIds });
  if (!curriculum.satisfied) reasons.push(...curriculum.reasons);
  if (!ELIGIBLE_PROVENANCE.has(coverage.provenance)) reasons.push('PROVENANCE_NOT_ELIGIBLE');
  const unique = [...new Set(reasons)];
  return { evaluatedConditionsHold: unique.length === 0, reasons: unique, curriculum, primaryConceptId, evaluated: PILOT_CONDITIONS_EVALUATED, notEvaluatedHere: PILOT_CONDITIONS_NOT_EVALUATED_HERE };
}
