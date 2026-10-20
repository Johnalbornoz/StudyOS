/**
 * B1 -- Canonical Concept Identity (pure rules, no IO).
 *
 * Canonical identity is `canonical_concepts.id`. A learner concept (`concepts.id`) is the Student's own
 * INSTANCE: it carries state and evidence, and it relates to a canonical concept only through an explicit,
 * stored link (`concept_catalog_mapping`, status MATCHED). This module classifies that link; it never
 * derives one.
 *
 * Label matching is NOT a canonical relationship. A MATCHED row whose only basis is an exact label match is
 * reported as TRANSITIONAL: it stays readable (nothing historical breaks), and every canonical consumer can
 * tell it apart from a link that states a fact (the concept was created from that canonical concept, a
 * teacher assigned it, a reviewer confirmed it).
 *
 * A learner concept with no MATCHED link is PERSONAL: it keeps its state and evidence and is simply outside
 * curriculum coverage. Nothing here manufactures a link to raise coverage.
 */

/** `concept_catalog_mapping.mapping_method` values (20260922 + 20261018_1300 / _1400 + 20261122_1100). */
export type MappingMethod = 'EXACT_LABEL_MATCH' | 'MANUAL_REVIEW' | 'SEED_FIXTURE' | 'TEACHER_ASSIGNMENT' | 'PLAN_ENROLLMENT' | 'REVIEWED_ALIAS';

/** Why a link is canonical. */
export type CanonicalLinkBasis =
  /** The learner concept was created from this canonical concept (its key encodes the canonical id, or it was enrolled / assigned). */
  | 'CREATED_FROM_CANONICAL'
  /** A reviewer confirmed the correspondence. */
  | 'REVIEWED'
  /** Curated seed data. */
  | 'SEEDED';

export type ConceptIdentity =
  | { status: 'CANONICAL'; learnerConceptId: string; canonicalConceptId: string; basis: CanonicalLinkBasis }
  /** MATCHED by exact label only, never confirmed: usable for compatibility, not an authority. */
  | { status: 'TRANSITIONAL'; learnerConceptId: string; canonicalConceptId: string; basis: 'LABEL_MATCH' }
  /** No MATCHED link: the Student's personal concept. `mappingStatus` says what the correspondence layer holds. */
  | { status: 'UNRESOLVED'; learnerConceptId: string; canonicalConceptId: null; mappingStatus: 'UNRESOLVED' | 'AMBIGUOUS' | 'PROPOSED' | 'NO_MAPPING_ROW' };

export interface ConceptLinkFacts {
  learnerConceptId: string;
  /** `concepts.canonical_id`: a free-text key, NOT an identity -- read only for the two "created from canonical" key shapes. */
  conceptKey: string | null;
  /** null when the concept has no row in the correspondence layer. */
  mappingStatus: 'MATCHED' | 'PROPOSED' | 'AMBIGUOUS' | 'UNRESOLVED' | null;
  canonicalConceptId: string | null;
  mappingMethod: string | null;
  reviewed: boolean;
}

const uuidHex = (id: string) => id.replace(/-/g, '').toUpperCase();

/**
 * Does the learner concept's own key state that it was created from this canonical concept? Two key shapes
 * exist (both written at creation, both deterministic): `CANON_<HEX>` (plan enrolment) and `catalog:<uuid>`
 * (exam bridge). Anything else says nothing.
 */
export function keyNamesCanonicalConcept(conceptKey: string | null | undefined, canonicalConceptId: string): boolean {
  if (!conceptKey) return false;
  return conceptKey === `CANON_${uuidHex(canonicalConceptId)}` || conceptKey.toLowerCase() === `catalog:${canonicalConceptId.toLowerCase()}`;
}

/** The identity of one learner concept, from its stored link. Pure. */
export function classifyConceptIdentity(f: ConceptLinkFacts): ConceptIdentity {
  if (f.mappingStatus !== 'MATCHED' || !f.canonicalConceptId) {
    return { status: 'UNRESOLVED', learnerConceptId: f.learnerConceptId, canonicalConceptId: null, mappingStatus: f.mappingStatus === null || f.mappingStatus === 'MATCHED' ? 'NO_MAPPING_ROW' : f.mappingStatus };
  }
  const base = { learnerConceptId: f.learnerConceptId, canonicalConceptId: f.canonicalConceptId };
  // MANUAL_REVIEW: a reviewer confirmed this row. REVIEWED_ALIAS: a reviewer stated that this label means this concept
  // (canonical_concept_aliases, 20261122_1100) -- reviewed either way, never a similarity.
  if (f.reviewed || f.mappingMethod === 'MANUAL_REVIEW' || f.mappingMethod === 'REVIEWED_ALIAS') return { status: 'CANONICAL', ...base, basis: 'REVIEWED' };
  if (f.mappingMethod === 'PLAN_ENROLLMENT' || f.mappingMethod === 'TEACHER_ASSIGNMENT') return { status: 'CANONICAL', ...base, basis: 'CREATED_FROM_CANONICAL' };
  // The key was written when the concept was created from the catalogue: a fact, whatever method the row carries.
  if (keyNamesCanonicalConcept(f.conceptKey, f.canonicalConceptId)) return { status: 'CANONICAL', ...base, basis: 'CREATED_FROM_CANONICAL' };
  if (f.mappingMethod === 'SEED_FIXTURE') return { status: 'CANONICAL', ...base, basis: 'SEEDED' };
  // EXACT_LABEL_MATCH (or a legacy row with no method): a similarity, not a statement of identity.
  return { status: 'TRANSITIONAL', ...base, basis: 'LABEL_MATCH' };
}

/**
 * B1-C -- the consumption rule (frozen):
 *
 *   CANONICAL     -> a valid canonical concept identity
 *   TRANSITIONAL  -> NOT valid for assessment planning: it behaves as unresolved
 *   UNRESOLVED    -> NOT valid for assessment planning
 *
 * Every consequential assessment use (question coverage, eligibility, blueprint requirements and solver
 * inputs, readiness, exam-gap mapping, evidence attribution, cross-domain mastery inference) asks THIS
 * function. When it returns null the caller has no canonical concept and must report an unresolved /
 * insufficient-coverage state; it never guesses.
 */
export function canonicalConceptIdForAssessment(identity: ConceptIdentity | null | undefined): string | null {
  return identity?.status === 'CANONICAL' ? identity.canonicalConceptId : null;
}

export const isUsableForAssessmentPlanning = (identity: ConceptIdentity | null | undefined): boolean => canonicalConceptIdForAssessment(identity) !== null;

/** Same rule, under the name B1 introduced it with. */
export const authoritativeCanonicalConceptId = canonicalConceptIdForAssessment;

/**
 * LEGACY DISPLAY / COMPATIBILITY ONLY -- the id a pre-B1 reader of `status = 'MATCHED'` sees (CANONICAL or
 * TRANSITIONAL). It must never feed an assessment decision; use `canonicalConceptIdForAssessment`.
 */
export function legacyMatchedCanonicalConceptId(identity: ConceptIdentity): string | null {
  return identity.status === 'UNRESOLVED' ? null : identity.canonicalConceptId;
}

/**
 * Deferred data-governance capability (NOT implemented): the lifecycle that would let an automatically
 * discovered correspondence become canonical --
 *
 *   AUTO DISCOVERY -> PROPOSED -> REVIEW / CONFIRMATION -> CANONICAL
 *
 * Today `ensureCatalogMapping` still stores an exact-label match as MATCHED for a Student's extracted
 * concept (kept for backward compatibility); such a link is TRANSITIONAL here and stays so until a
 * confirmation workflow exists. B2 does not need that workflow as long as it refuses TRANSITIONAL links.
 */
export const MAPPING_LIFECYCLE_DEFERRED = ['AUTO_DISCOVERY', 'PROPOSED', 'REVIEW_CONFIRMATION', 'CANONICAL'] as const;

export interface ConceptIdentitySummary {
  total: number;
  canonical: number;
  transitional: number;
  unresolved: number;
}

export function summarizeConceptIdentities(identities: readonly ConceptIdentity[]): ConceptIdentitySummary {
  const out: ConceptIdentitySummary = { total: identities.length, canonical: 0, transitional: 0, unresolved: 0 };
  for (const i of identities) {
    if (i.status === 'CANONICAL') out.canonical += 1;
    else if (i.status === 'TRANSITIONAL') out.transitional += 1;
    else out.unresolved += 1;
  }
  return out;
}
