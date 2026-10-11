/**
 * QB-R2A -- dry-run projection of the twelve PILOT_ELIGIBLE conditions for a draft or review package (pure, no IO).
 *
 * It answers "where does this stand, and what is in the way?" before anything is in the Question Bank. It is
 * a projection from declared facts, not the eligibility verdict: the verdict is computed on the ingested item
 * version from stored facts (`evaluatePilotEligibility` and the database rules). It reads and writes nothing.
 *
 * Each condition is one of:
 *   SATISFIED            the fact holds
 *   UNSATISFIED          the fact is known not to hold, and the package itself can fix it
 *   BLOCKED              it cannot hold yet for a reason outside the package (no qualified reviewer, a draft
 *                        structure version, no published blueprint variant, ...)
 *   NOT_YET_APPLICABLE   it belongs to a later stage than the one the package is at
 */
export const PILOT_CONDITIONS = [
  { n: 1, key: 'ACTIVE_CURRENT_VERSION', label: 'Active or calibrated, current version, not retired' },
  { n: 2, key: 'HUMAN_REVIEW_APPROVED', label: 'Approving human review' },
  { n: 3, key: 'QUALIFIED_INDEPENDENT_REVIEWER', label: 'Reviewer qualified for subject and exam family, not the author' },
  { n: 4, key: 'ONE_PRIMARY_CONCEPT', label: 'Exactly one reviewed PRIMARY concept' },
  { n: 5, key: 'ONE_DOMAIN_ONE_TOPIC', label: 'One official Domain and one certified Topic' },
  { n: 6, key: 'RESPONSE_FORMAT_ALLOWED', label: 'Response format allowed by the section' },
  { n: 7, key: 'STIMULUS_AND_ASSETS_ELIGIBLE', label: 'Stimulus and assets reviewed and eligible' },
  { n: 8, key: 'REUSE_RIGHTS_ESTABLISHED', label: 'Reuse rights established for item, stimulus, assets' },
  { n: 9, key: 'PROVENANCE_COMPLETE', label: 'Provenance complete' },
  { n: 10, key: 'ORIGINALITY_RECORDED', label: 'Originality check recorded and accepted' },
  { n: 11, key: 'ONE_POOL', label: 'Assigned to exactly one pool' },
  { n: 12, key: 'BLUEPRINT_CELL', label: 'Fits a cell of a published blueprint' },
] as const;
export type PilotConditionKey = (typeof PILOT_CONDITIONS)[number]['key'];
export type ProjectionState = 'SATISFIED' | 'UNSATISFIED' | 'BLOCKED' | 'NOT_YET_APPLICABLE';

export const PRODUCTION_STAGES = ['DRAFT', 'STRUCTURALLY_VALID', 'ORIGINALITY_CHECKED', 'INGESTED_UNDER_REVIEW', 'REVIEWED', 'RIGHTS_VALIDATED', 'POOL_ASSIGNED'] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];
const at = (stage: ProductionStage, needed: ProductionStage): boolean => PRODUCTION_STAGES.indexOf(stage) >= PRODUCTION_STAGES.indexOf(needed);

/** Facts about one package. `null` = not known / not done yet. Every field is declared by the caller; none is looked up. */
export interface ProjectionInput {
  stage: ProductionStage;
  /** Environment facts that are outside any single package. */
  environment: { qualifiedReviewerAvailable: boolean; structureVersionPublished: boolean; publishedBlueprintVariantForPool: boolean };
  /** From the requirement cell: the Topic's structure version awaits the PAA cutover. */
  curriculumCurrentness?: 'CURRENT' | 'CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER';
  lifecycleDeliverable: boolean | null;
  humanReviewDecision: 'APPROVED' | 'REJECTED' | 'CORRECTION_REQUESTED' | null;
  reviewerIsAuthor: boolean | null;
  /** Number of REVIEWED PRIMARY concepts on the ingested version. The package's intended concept does not count. */
  reviewedPrimaryConcepts: number | null;
  topicLinked: boolean | null;
  topicUnderOfficialDomain: boolean | null;
  responseFormatAllowedBySection: boolean | null;
  stimulusRequired: boolean;
  stimulusAndAssetsEligible: boolean | null;
  rightsEstablishedForAll: boolean | null;
  provenance: string | null;
  lineagePresent: boolean;
  originality: { result: 'CLEAR' | 'SIMILAR' | 'MATCH'; disposition: 'ACCEPTED' | 'REWRITE_REQUIRED' | 'REJECTED' | null } | null;
  activePools: number | null;
  /** A per-concept pool (practice, diagnostic, verification) is not assembled by a blueprint. */
  blueprintRequired: boolean;
  fitsBlueprintCell: boolean | null;
}

export interface ConditionProjection {
  n: number;
  key: PilotConditionKey;
  label: string;
  state: ProjectionState;
  reason: string;
}

export interface PilotProjection {
  conditions: ConditionProjection[];
  counts: Record<ProjectionState, number>;
  /** True only when all twelve are SATISFIED. A projection; never the stored verdict. */
  projectedPilotEligible: boolean;
  isStoredVerdict: false;
}

export function projectPilotEligibility(i: ProjectionInput): PilotProjection {
  const s = (state: ProjectionState, reason: string) => ({ state, reason });
  const later = (needed: ProductionStage) => s('NOT_YET_APPLICABLE', `decided at ${needed}`);
  const decide: Record<PilotConditionKey, () => { state: ProjectionState; reason: string }> = {
    ACTIVE_CURRENT_VERSION: () => (!at(i.stage, 'REVIEWED') ? later('REVIEWED') : i.lifecycleDeliverable ? s('SATISFIED', 'version is active and current') : s('UNSATISFIED', 'version is not active / current')),
    HUMAN_REVIEW_APPROVED: () =>
      !at(i.stage, 'INGESTED_UNDER_REVIEW') ? later('INGESTED_UNDER_REVIEW')
      : i.humanReviewDecision === 'APPROVED' ? s('SATISFIED', 'approving review recorded')
      : i.humanReviewDecision ? s('UNSATISFIED', `review decision is ${i.humanReviewDecision}`)
      : !i.environment.qualifiedReviewerAvailable ? s('BLOCKED', 'no qualified human reviewer exists')
      : s('UNSATISFIED', 'not reviewed yet'),
    QUALIFIED_INDEPENDENT_REVIEWER: () =>
      !at(i.stage, 'INGESTED_UNDER_REVIEW') ? later('INGESTED_UNDER_REVIEW')
      : !i.environment.qualifiedReviewerAvailable ? s('BLOCKED', 'no reviewer qualification has been granted for this subject and exam family')
      : i.reviewerIsAuthor ? s('UNSATISFIED', 'the reviewer is the author')
      : i.humanReviewDecision === 'APPROVED' ? s('SATISFIED', 'approved by a qualified, independent reviewer (the database refuses any other approval)')
      : s('UNSATISFIED', 'no approving review yet'),
    ONE_PRIMARY_CONCEPT: () =>
      !at(i.stage, 'INGESTED_UNDER_REVIEW') ? later('INGESTED_UNDER_REVIEW')
      : i.reviewedPrimaryConcepts === 1 ? s('SATISFIED', 'one reviewed PRIMARY concept')
      : !i.environment.qualifiedReviewerAvailable ? s('BLOCKED', 'attribution is set by a qualified reviewer; none exists')
      : s('UNSATISFIED', `${i.reviewedPrimaryConcepts ?? 0} reviewed PRIMARY concepts`),
    ONE_DOMAIN_ONE_TOPIC: () =>
      // known from the cell at any stage: the Topic's structure version is not the published one
      i.curriculumCurrentness === 'CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER' ? s('BLOCKED', 'CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER: the Topic\'s structure version is a draft')
      : !at(i.stage, 'INGESTED_UNDER_REVIEW') ? later('INGESTED_UNDER_REVIEW')
      : !i.topicLinked ? s('UNSATISFIED', 'the version has no Topic link')
      : !i.topicUnderOfficialDomain ? s('UNSATISFIED', 'the linked Topic is not under an official Domain')
      : !i.environment.structureVersionPublished ? s('BLOCKED', 'the structure version of the Topic is not published')
      : s('SATISFIED', 'one Topic under one official Domain, in a published structure version'),
    RESPONSE_FORMAT_ALLOWED: () => (i.responseFormatAllowedBySection === null ? s('BLOCKED', 'the section has no persisted response-format requirement to check against') : i.responseFormatAllowedBySection ? s('SATISFIED', 'format allowed by the section') : s('UNSATISFIED', 'format not allowed by the section')),
    STIMULUS_AND_ASSETS_ELIGIBLE: () =>
      !i.stimulusRequired && i.stimulusAndAssetsEligible === null ? s('SATISFIED', 'no stimulus or asset is required')
      : !at(i.stage, 'REVIEWED') ? later('REVIEWED')
      : i.stimulusAndAssetsEligible ? s('SATISFIED', 'stimulus and assets are approved, active and current')
      : s('UNSATISFIED', 'a stimulus or an asset is not eligible'),
    REUSE_RIGHTS_ESTABLISHED: () => (!at(i.stage, 'RIGHTS_VALIDATED') ? later('RIGHTS_VALIDATED') : i.rightsEstablishedForAll ? s('SATISFIED', 'established reuse rights on the item and everything it uses') : s('UNSATISFIED', 'a reuse right is missing')),
    PROVENANCE_COMPLETE: () =>
      i.provenance === 'FIXTURE' || !i.provenance ? s('UNSATISFIED', 'no eligible provenance')
      : !i.lineagePresent ? s('UNSATISFIED', 'authorship / generation lineage is missing')
      : s('SATISFIED', `${i.provenance} with its lineage`),
    ORIGINALITY_RECORDED: () =>
      !at(i.stage, 'ORIGINALITY_CHECKED') ? later('ORIGINALITY_CHECKED')
      : !i.originality ? s('UNSATISFIED', 'no originality check')
      : i.originality.disposition === 'ACCEPTED' ? s('SATISFIED', `${i.originality.result}, accepted`)
      : i.originality.disposition === null ? s('UNSATISFIED', 'similar to other material: a person must decide')
      : s('UNSATISFIED', `originality disposition is ${i.originality.disposition}`),
    ONE_POOL: () => (!at(i.stage, 'POOL_ASSIGNED') ? later('POOL_ASSIGNED') : i.activePools === 1 ? s('SATISFIED', 'in exactly one pool') : s('UNSATISFIED', `${i.activePools ?? 0} active pools`)),
    BLUEPRINT_CELL: () =>
      !i.blueprintRequired ? s('SATISFIED', 'a per-concept pool is not assembled by a blueprint')
      : !i.environment.publishedBlueprintVariantForPool ? s('BLOCKED', 'no published blueprint variant exists for this pool')
      : i.fitsBlueprintCell ? s('SATISFIED', 'fits a cell of the published variant')
      : s('UNSATISFIED', 'fits no cell of the published variant'),
  };
  const conditions = PILOT_CONDITIONS.map((c) => ({ n: c.n, key: c.key, label: c.label, ...decide[c.key]() }));
  const counts: Record<ProjectionState, number> = { SATISFIED: 0, UNSATISFIED: 0, BLOCKED: 0, NOT_YET_APPLICABLE: 0 };
  for (const c of conditions) counts[c.state] += 1;
  return { conditions, counts, projectedPilotEligible: counts.SATISFIED === conditions.length, isStoredVerdict: false };
}
