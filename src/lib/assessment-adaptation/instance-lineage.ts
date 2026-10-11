/**
 * EA-1 -- what a question INSTANCE carries about where it came from, and the carriers later stages will need
 * (pure contracts; the two carriers for B2 and B3 are TYPES ONLY and implement no rule).
 *
 * 1. ADAPTATION LINEAGE. An instance generated from an adaptation specification records the family, the profile,
 *    the discipline policy, the specification and the run. LEGACY AND FIXED CONTENT HAS NONE: every item written
 *    before task families, every item written without one, and every official or licensed item is valid with no
 *    adaptation lineage at all (the persisted equivalent is `task_family_id IS NULL`). Nothing may require it.
 *
 * 2. INSTANCE CLASS. A DYNAMIC instance is produced for one use and has not been through the promotion path; a
 *    CERTIFIED_FROZEN instance has, and is immutable. Which class a purpose needs is a contract here; it grants
 *    nothing. In particular it grants no reuse right, no review and no pool membership: those stay with the
 *    rights gate, the human review and the pool assignment, unchanged, and `PROMOTION_PATH` only NAMES them.
 *
 * 3. INDEPENDENCE CARRIER (types only). Two instances of one family are not automatically two independent pieces
 *    of evidence. B2 (selection) and B3 (evidence) will need to see the relationship. This module defines what
 *    they will be able to see. It defines no rule about what the relationship means.
 *
 * 4. EVIDENCE FACETS (types only). The dimensions along which B3 could later describe what a response is evidence
 *    of. Named "facets" because B1 already has `EVIDENCE_DIMENSIONS` (the journey dimension an activity is run
 *    for), which is another thing.
 */
import { z } from 'zod';

const ID = z.string().trim().min(1).max(200);
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const VERSIONED = z.strictObject({ id: ID, version: ID });

// ------------------------------------------------------------------------------------------------ 1. lineage
/** The adaptation lineage of an instance. Absent on legacy, fixed, official and licensed content. */
export const AdaptationLineageSchema = z.strictObject({
  taskFamily: VERSIONED,
  assessmentProfile: VERSIONED,
  disciplinePolicy: VERSIONED,
  adaptationSpecificationId: SHA256,
  /** The specification's invariant hash: equal for every instance of the family, whatever the system. */
  invariantHash: SHA256,
  /** The generation run that produced the instance. */
  generationRunId: ID,
});
export type AdaptationLineage = z.infer<typeof AdaptationLineageSchema>;

// ------------------------------------------------------------------------------------------------ 2. instance class
export const INSTANCE_CLASSES = ['DYNAMIC', 'CERTIFIED_FROZEN'] as const;
export type InstanceClass = (typeof INSTANCE_CLASSES)[number];

/**
 * The six pools, restated the way `requirement-cell.ts` restates them (`PRODUCTION_POOLS`): the adaptation engine
 * imports neither the Production OS nor the selection engine. A test keeps the three lists identical.
 */
export const ADAPTATION_POOLS = ['PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2'] as const;
export type AdaptationPool = (typeof ADAPTATION_POOLS)[number];
/** Uses that are not a pool of the pilot. */
export const NON_POOL_PURPOSES = ['LOW_STAKES_REINFORCEMENT', 'BENCHMARK', 'CALIBRATION', 'PILOT_CERTIFICATION'] as const;
export const INSTANCE_PURPOSES = [...ADAPTATION_POOLS, ...NON_POOL_PURPOSES] as const;
export type InstancePurpose = (typeof INSTANCE_PURPOSES)[number];

export interface InstanceClassRequirement {
  purpose: InstancePurpose;
  minimumClass: InstanceClass;
  /** BRIEF: fixed by the EA-1 brief. CONSERVATIVE_DEFAULT: the brief is silent; the stricter class is taken until someone decides. */
  basis: 'BRIEF' | 'CONSERVATIVE_DEFAULT';
  reason: string;
}

const REQUIREMENTS: Record<InstancePurpose, Omit<InstanceClassRequirement, 'purpose'>> = {
  PRACTICE: { minimumClass: 'DYNAMIC', basis: 'BRIEF', reason: 'Practice may use dynamic instances, subject to governance.' },
  LOW_STAKES_REINFORCEMENT: { minimumClass: 'DYNAMIC', basis: 'BRIEF', reason: 'Low-stakes reinforcement may use dynamic instances, subject to governance.' },
  DIAGNOSTIC: { minimumClass: 'CERTIFIED_FROZEN', basis: 'CONSERVATIVE_DEFAULT', reason: 'A protected pool whose content must reach a Student unseen; the brief does not name it, so the stricter class holds.' },
  VERIFICATION: { minimumClass: 'CERTIFIED_FROZEN', basis: 'CONSERVATIVE_DEFAULT', reason: 'A protected pool whose content must reach a Student unseen; the brief does not name it, so the stricter class holds.' },
  REDUCED_MOCK: { minimumClass: 'CERTIFIED_FROZEN', basis: 'BRIEF', reason: 'A Reduced Mock is a frozen form.' },
  FULL_MOCK_1: { minimumClass: 'CERTIFIED_FROZEN', basis: 'BRIEF', reason: 'A Full Mock is a frozen form.' },
  FULL_MOCK_2: { minimumClass: 'CERTIFIED_FROZEN', basis: 'BRIEF', reason: 'A Full Mock is a frozen form.' },
  BENCHMARK: { minimumClass: 'CERTIFIED_FROZEN', basis: 'BRIEF', reason: 'A benchmark compares learners on the same content.' },
  CALIBRATION: { minimumClass: 'CERTIFIED_FROZEN', basis: 'BRIEF', reason: 'Calibration measures one fixed item; a changing instance has no facility to measure.' },
  PILOT_CERTIFICATION: { minimumClass: 'CERTIFIED_FROZEN', basis: 'BRIEF', reason: 'Pilot certification certifies specific content.' },
};

/** The least an instance must be for a purpose. Pure, total over the known purposes; an unknown purpose is an error, never a default. */
export function minimumInstanceClassFor(purpose: string): InstanceClassRequirement {
  if (!(INSTANCE_PURPOSES as readonly string[]).includes(purpose)) throw new Error(`UNKNOWN_INSTANCE_PURPOSE: ${purpose}`);
  return { purpose: purpose as InstancePurpose, ...REQUIREMENTS[purpose as InstancePurpose] };
}
export const instanceClassSatisfies = (actual: InstanceClass, purpose: string): boolean => actual === 'CERTIFIED_FROZEN' || minimumInstanceClassFor(purpose).minimumClass === 'DYNAMIC';

/**
 * How a generated instance becomes CERTIFIED_FROZEN. A DESCRIPTION of gates that already exist, in the order they
 * apply, each with its owner. This list adds no gate, removes none and decides nothing: an instance that came
 * from an adaptation specification goes through exactly the gates any other candidate does.
 */
export const PROMOTION_PATH = [
  { step: 'AUTOMATED_VALIDATION', gate: 'structural validation and the independent validators', owner: 'Question Bank (Production OS)', establishes: 'the candidate is well formed for its cell' },
  { step: 'ORIGINALITY', gate: 'the originality gate, with a human decision where it asks for one', owner: 'Question Bank (Production OS)', establishes: 'no textual similarity to compared content' },
  { step: 'RIGHTS', gate: 'the rights gate: person-verified evidence, on the ingested content', owner: 'Question Bank (rights record)', establishes: 'an established reuse right; never implied by provenance, by a family or by a specification' },
  { step: 'HUMAN_REVIEW', gate: 'approval by a qualified reviewer who is not the author', owner: 'Question Bank (review authority)', establishes: 'the content is correct and fit' },
  { step: 'ATTRIBUTION', gate: 'the reviewer sets exactly one PRIMARY concept through the governed attribution writer', owner: 'Question Bank (attribution)', establishes: 'what the item is direct evidence of' },
  { step: 'POOL_ASSIGNMENT', gate: 'pool assignment after review, rights and originality', owner: 'Question Bank (pool membership)', establishes: 'what the content is reserved for' },
] as const;
/** What neither a task family nor an adaptation specification establishes. Each stays with the gate that owns it. */
export const NOT_ESTABLISHED_BY_ADAPTATION = ['REUSE_RIGHTS', 'ORIGINALITY', 'HUMAN_REVIEW', 'PRIMARY_ATTRIBUTION', 'POOL_MEMBERSHIP', 'INSTANCE_CERTIFICATION', 'EVIDENCE_INDEPENDENCE'] as const;

// ------------------------------------------------------------------------------------------------ 3. independence carrier (TYPES ONLY)
/** How two instances of content are related through their families. A description; no rule reads it yet. */
export type SiblingRelationship =
  /** Same family, same specification, different parameterisation. */
  | 'SAME_FAMILY_SAME_SPECIFICATION'
  /** Same family, adapted for different systems. */
  | 'SAME_FAMILY_DIFFERENT_PROFILE'
  /** Different families of the same variant group (declared near-equivalents). */
  | 'SAME_VARIANT_FAMILY'
  /** Different families that only share the PRIMARY concept. */
  | 'SAME_CONCEPT_ONLY'
  | 'UNRELATED'
  /** One of the two has no adaptation lineage: the relationship cannot be stated from families. */
  | 'UNKNOWN_LEGACY';

/** Whether a learner who met one instance has, in effect, met the other. A description; no rule reads it yet. */
export type ExposureRelationship = 'SAME_INSTANCE' | 'SAME_PARAMETERIZATION' | 'SAME_FAMILY_OTHER_PARAMETERIZATION' | 'NONE' | 'UNKNOWN';

/**
 * What B2 and B3 will be able to read about one instance in order to tell same-family instances apart. Every
 * identity is null for legacy content. THIS TYPE CARRIES FACTS; IT IMPLEMENTS NO INDEPENDENCE RULE.
 */
export interface InstanceIndependenceCarrier {
  /** The family the instance was generated from; null = legacy or fixed content. */
  familyIdentity: { familyId: string; version: string } | null;
  /** Identity of the values the instance fixed inside the family's parameter ranges (a hash of them). */
  parameterizationIdentity: string | null;
  /** A group of families declared to elicit the same evidence in nearly the same way; null when none is declared. */
  variantFamilyIdentity: string | null;
  /** The invariant hash of the instance's specification: equal across systems for one family. */
  invariantHash: string | null;
}
export interface InstancePairRelationship { sibling: SiblingRelationship; exposure: ExposureRelationship }

// ------------------------------------------------------------------------------------------------ 4. evidence facets (TYPES ONLY)
/** Dimensions along which B3 could later describe evidence. Names only: nothing here computes, weighs or writes evidence. */
export const ADAPTATION_EVIDENCE_FACETS = ['KNOWLEDGE', 'SKILL', 'COMPETENCY', 'CONTEXT', 'TRANSFER', 'ASSESSMENT_PROFILE', 'INDEPENDENCE', 'RETENTION'] as const;
export type AdaptationEvidenceFacet = (typeof ADAPTATION_EVIDENCE_FACETS)[number];

/** What an instance's lineage could later tell B3 on each facet. A shape for a future contract; unused by any engine. */
export interface EvidenceFacetCarrier {
  KNOWLEDGE: { primaryConceptStableId: string } | null;
  SKILL: { skills: string[] } | null;
  COMPETENCY: { catalogueCompetencies: string[]; systemCompetencies: string[] } | null;
  CONTEXT: { kind: string } | null;
  TRANSFER: { expectation: string } | null;
  ASSESSMENT_PROFILE: { profileId: string; version: string } | null;
  INDEPENDENCE: InstanceIndependenceCarrier | null;
  /** Retention is a fact about WHEN evidence was produced, which no specification knows. Always null here. */
  RETENTION: null;
}
