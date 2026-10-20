/**
 * EA-1 -- what a question INSTANCE carries about where it came from, and the carriers later stages will need
 * (pure contracts; the two carriers for B2 and B3 are TYPES ONLY and implement no rule).
 *
 * 1. ADAPTATION LINEAGE. An instance generated from an adaptation specification records the family, the system
 *    and component profile, the discipline policy, the specification, the use class and the run. A HUMAN-AUTHORED
 *    instance may record its task family too, with no generation field. LEGACY AND FIXED CONTENT HAS NONE: every item written
 *    before task families, every item written without one, and every official or licensed item is valid with no
 *    adaptation lineage at all (the persisted equivalent is `task_family_id IS NULL`). Nothing may require it.
 *
 * 2. USE CLASS AND INSTANCE CLASS. Content is produced either as DEV_TEST_CONTENT (non-certifying UX content) or
 *    for EVIDENCE_BEARING use. A DYNAMIC instance is produced for one use and has not been through the promotion
 *    path; a CERTIFIED_FROZEN instance has, and is immutable. Which class a purpose accepts for which use is a
 *    contract here (`instancePolicyFor`); it grants nothing. In particular it grants no reuse right, no review and no pool membership: those stay with the
 *    rights gate, the human review and the pool assignment, unchanged, and `PROMOTION_PATH` only NAMES them.
 *
 * 3. INDEPENDENCE CARRIER (types only). Two instances of one ASSESSMENT task family are not automatically two
 *    independent pieces of evidence. (The transfer engine has its own TransferTaskFamily -- a derived hash on a
 *    learner's transfer task; the two are not merged here and their reconciliation is deferred to B3.) B2 (selection) and B3 (evidence) will need to see the relationship. This module defines what
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
/**
 * What content is produced FOR.
 *   DEV_TEST_CONTENT    non-certifying content for development and UX testing. It is never evidence, never enters a
 *                       certified pool and certifies nothing. A DRAFT or UNREVIEWED task family may produce only this.
 *   EVIDENCE_BEARING    content meant for real assessment use: its responses may become evidence, and for every
 *                       purpose but practice it must be a frozen certified instance.
 * The two are different USES, not two qualities of the same thing: dev-test content is not "weaker evidence".
 */
export const CONTENT_USE_CLASSES = ['DEV_TEST_CONTENT', 'EVIDENCE_BEARING'] as const;
export type ContentUseClass = (typeof CONTENT_USE_CLASSES)[number];

/**
 * The adaptation lineage of a GENERATED instance. Absent on legacy, fixed, official and licensed content.
 * `componentProfile` is null when the specification targeted the system profile only (generic practice).
 */
export const AdaptationLineageSchema = z.strictObject({
  taskFamily: VERSIONED,
  systemProfile: VERSIONED,
  componentProfile: VERSIONED.nullable(),
  disciplinePolicy: VERSIONED,
  adaptationSpecificationId: SHA256,
  /** The specification's invariant hash: equal for every instance of the family, whatever the system. */
  invariantHash: SHA256,
  /** What the specification was produced for. Dev-test content says so on every instance. */
  contentUseClass: z.enum(CONTENT_USE_CLASSES),
  /** The generation run that produced the instance. */
  generationRunId: ID,
  /** EA-1A, optional: the learning approach the specification was produced under. Absent = STANDARD (or none): recorded by absence. */
  learningApproach: VERSIONED.optional(),
});
export type AdaptationLineage = z.infer<typeof AdaptationLineageSchema>;

/**
 * The task-family lineage of a HUMAN-AUTHORED instance. Authorship (who wrote it) and task-family lineage (which
 * way of asking it is an instance of) are separate dimensions: a person may write an instance of a family, with or
 * without a specification to follow. It carries NO generation field -- no run, no prompt, no provider -- so the
 * rule that authored content has no generation lineage is untouched. Optional, and never backfilled.
 */
export const AuthoredFamilyLineageSchema = z.strictObject({
  taskFamily: VERSIONED,
  /** The family's invariant hash the author wrote against. */
  invariantHash: SHA256,
  /** The specification followed, with its profiles, when there was one; all null when the author worked from the family alone. */
  adaptationSpecificationId: SHA256.nullable(),
  systemProfile: VERSIONED.nullable(),
  componentProfile: VERSIONED.nullable(),
  contentUseClass: z.enum(CONTENT_USE_CLASSES),
});
export type AuthoredFamilyLineage = z.infer<typeof AuthoredFamilyLineageSchema>;

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

export interface InstancePolicy {
  purpose: InstancePurpose;
  useClass: ContentUseClass;
  /** Is this use permitted for this purpose at all? false = no instance of any class: the adaptation is refused by name. */
  permitted: boolean;
  /** The instance classes this purpose accepts for this use. Empty when the use is not permitted. */
  allowedClasses: readonly InstanceClass[];
  /** The least of them; null when the use is not permitted. */
  minimumClass: InstanceClass | null;
  /**
   * USER_DECISION: locked by the user (2026-10-11, and the EA-1A rulings). BRIEF: fixed by the EA-1 brief and not
   * revisited. CONSERVATIVE_READING: the rulings do not name the purpose; the stricter rule of its nearest
   * neighbour is taken and flagged.
   */
  basis: 'USER_DECISION' | 'BRIEF' | 'CONSERVATIVE_READING';
  reason: string;
}

const BOTH: readonly InstanceClass[] = ['DYNAMIC', 'CERTIFIED_FROZEN'];
const FROZEN: readonly InstanceClass[] = ['CERTIFIED_FROZEN'];
const NONE: readonly InstanceClass[] = [];
type Rule = Pick<InstancePolicy, 'allowedClasses' | 'basis' | 'reason'>;
/** Evidence-bearing (real assessment) use, per purpose. */
const EVIDENCE_BEARING_RULES: Record<InstancePurpose, Rule> = {
  PRACTICE: { allowedClasses: BOTH, basis: 'USER_DECISION', reason: 'Practice: dynamic instances allowed, frozen certified instances allowed.' },
  LOW_STAKES_REINFORCEMENT: { allowedClasses: BOTH, basis: 'BRIEF', reason: 'Low-stakes reinforcement may use dynamic instances, subject to governance.' },
  DIAGNOSTIC: { allowedClasses: FROZEN, basis: 'USER_DECISION', reason: 'Evidence-bearing Stage / Production use of a Diagnostic requires frozen certified instances.' },
  VERIFICATION: { allowedClasses: FROZEN, basis: 'USER_DECISION', reason: 'Evidence-bearing Stage / Production use of a Verification requires frozen certified instances.' },
  REDUCED_MOCK: { allowedClasses: FROZEN, basis: 'USER_DECISION', reason: 'A Reduced Mock is frozen certified content only.' },
  FULL_MOCK_1: { allowedClasses: FROZEN, basis: 'USER_DECISION', reason: 'A Full Mock is frozen certified content only.' },
  FULL_MOCK_2: { allowedClasses: FROZEN, basis: 'USER_DECISION', reason: 'A Full Mock is frozen certified content only.' },
  BENCHMARK: { allowedClasses: FROZEN, basis: 'BRIEF', reason: 'A benchmark compares learners on the same content.' },
  CALIBRATION: { allowedClasses: FROZEN, basis: 'BRIEF', reason: 'Calibration measures one fixed item; a changing instance has no facility to measure.' },
  PILOT_CERTIFICATION: { allowedClasses: FROZEN, basis: 'BRIEF', reason: 'Pilot certification certifies specific content.' },
};
/**
 * Dev-test use (EA-1A, locked -- this replaces the earlier reading that allowed it everywhere).
 *   PRACTICE, LOW_STAKES_REINFORCEMENT   dev-test content allowed.
 *   DIAGNOSTIC, VERIFICATION             dynamic dev-test content allowed ONLY in non-evidence test execution --
 *                                        which is what DEV_TEST_CONTENT is: it never bears evidence.
 *   REDUCED_MOCK, FULL_MOCK_1/2          NOT ACCEPTED. A protected mock pool takes frozen certified content only;
 *                                        there is no dev-test mock.
 *   BENCHMARK, CALIBRATION, PILOT_CERTIFICATION   not named by the rulings; they certify or compare on fixed
 *                                        content like the mock pools, so dev-test content is refused there too
 *                                        (CONSERVATIVE_READING).
 */
const DEV_TEST_RULES: Record<InstancePurpose, Rule> = {
  PRACTICE: { allowedClasses: BOTH, basis: 'USER_DECISION', reason: 'Dev-test practice content: non-certifying, never evidence.' },
  LOW_STAKES_REINFORCEMENT: { allowedClasses: BOTH, basis: 'BRIEF', reason: 'Dev-test reinforcement content: non-certifying, never evidence.' },
  DIAGNOSTIC: { allowedClasses: BOTH, basis: 'USER_DECISION', reason: 'Dynamic dev-test content only in non-evidence test execution of a Diagnostic.' },
  VERIFICATION: { allowedClasses: BOTH, basis: 'USER_DECISION', reason: 'Dynamic dev-test content only in non-evidence test execution of a Verification.' },
  REDUCED_MOCK: { allowedClasses: NONE, basis: 'USER_DECISION', reason: 'A protected mock pool does not accept DEV_TEST_CONTENT: frozen certified content only.' },
  FULL_MOCK_1: { allowedClasses: NONE, basis: 'USER_DECISION', reason: 'A protected mock pool does not accept DEV_TEST_CONTENT: frozen certified content only.' },
  FULL_MOCK_2: { allowedClasses: NONE, basis: 'USER_DECISION', reason: 'A protected mock pool does not accept DEV_TEST_CONTENT: frozen certified content only.' },
  BENCHMARK: { allowedClasses: NONE, basis: 'CONSERVATIVE_READING', reason: 'A benchmark compares learners on fixed certified content; dev-test content is refused like in a mock pool.' },
  CALIBRATION: { allowedClasses: NONE, basis: 'CONSERVATIVE_READING', reason: 'Calibration measures certified items; dev-test content is refused like in a mock pool.' },
  PILOT_CERTIFICATION: { allowedClasses: NONE, basis: 'CONSERVATIVE_READING', reason: 'Pilot certification certifies content; dev-test content certifies nothing.' },
};
/** The pools whose content is protected: they take frozen certified content only, and never DEV_TEST_CONTENT. */
export const PROTECTED_MOCK_POOLS: readonly AdaptationPool[] = ['REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2'];

/** What an instance may be for a purpose and a use. Pure and total over the known purposes and uses; anything unknown is an error, never a default. */
export function instancePolicyFor(purpose: string, useClass: string): InstancePolicy {
  if (!(INSTANCE_PURPOSES as readonly string[]).includes(purpose)) throw new Error(`UNKNOWN_INSTANCE_PURPOSE: ${purpose}`);
  if (!(CONTENT_USE_CLASSES as readonly string[]).includes(useClass)) throw new Error(`UNKNOWN_CONTENT_USE_CLASS: ${useClass}`);
  const rule = (useClass === 'DEV_TEST_CONTENT' ? DEV_TEST_RULES : EVIDENCE_BEARING_RULES)[purpose as InstancePurpose];
  return { purpose: purpose as InstancePurpose, useClass: useClass as ContentUseClass, ...rule, permitted: rule.allowedClasses.length > 0, minimumClass: rule.allowedClasses.length === 0 ? null : rule.allowedClasses.includes('DYNAMIC') ? 'DYNAMIC' : 'CERTIFIED_FROZEN' };
}
/** May an instance of this class be used for this purpose and this use? */
export const instanceClassSatisfies = (actual: InstanceClass, purpose: string, useClass: string): boolean => instancePolicyFor(purpose, useClass).allowedClasses.includes(actual);
/** Can a response to content of this use class ever become evidence? Dev-test content never can. */
export const mayBearEvidence = (useClass: ContentUseClass): boolean => useClass === 'EVIDENCE_BEARING';

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
export const NOT_ESTABLISHED_BY_ADAPTATION = ['REUSE_RIGHTS', 'ORIGINALITY', 'HUMAN_REVIEW', 'PRIMARY_ATTRIBUTION', 'POOL_MEMBERSHIP', 'INSTANCE_CERTIFICATION', 'EVIDENCE_INDEPENDENCE', 'REVIEWER_QUALIFICATION', 'CONCEPT_CERTIFICATION'] as const;

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
  /** The ASSESSMENT task family the instance is of (generated or authored); null = legacy or fixed content. Not the transfer engine's family hash. */
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
export const ADAPTATION_EVIDENCE_FACETS = ['KNOWLEDGE', 'SKILL', 'COMPETENCY', 'CONTEXT', 'INDEPENDENCE', 'TRANSFER', 'LEARNING_APPROACH', 'ASSESSMENT_PROFILE', 'RETENTION'] as const;
export type AdaptationEvidenceFacet = (typeof ADAPTATION_EVIDENCE_FACETS)[number];

/** What an instance's lineage could later tell B3 on each facet. A shape for a future contract; unused by any engine. */
export interface EvidenceFacetCarrier {
  KNOWLEDGE: { primaryConceptStableId: string } | null;
  SKILL: { skills: string[] } | null;
  COMPETENCY: { catalogueCompetencies: string[]; systemCompetencies: string[] } | null;
  CONTEXT: { kind: string } | null;
  TRANSFER: { expectation: string } | null;
  ASSESSMENT_PROFILE: { profileId: string; version: string } | null;
  /**
   * EA-1A: the approach the content was produced under, the transversal competencies it emphasised, how the learner
   * took part and what that can be evidence of. null = STANDARD / none. A collaborative activity yields a group
   * artefact: it is never individual evidence by itself. B3 decides what any of this is worth; nothing here does.
   */
  LEARNING_APPROACH: { approachId: string; version: string; transversalCompetencyCodes: string[]; participationMode: 'INDIVIDUAL' | 'COLLABORATIVE'; evidenceYield: 'INDIVIDUAL_EVIDENCE' | 'GROUP_ARTEFACT_ONLY' } | null;
  INDEPENDENCE: InstanceIndependenceCarrier | null;
  /** Retention is a fact about WHEN evidence was produced, which no specification knows. Always null here. */
  RETENTION: null;
}
