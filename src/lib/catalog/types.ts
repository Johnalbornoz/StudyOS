/**
 * F4 -- canonical academic catalog types. See
 * docs/implementation/f4/F4_CANONICAL_CATALOG_MODEL.md for the full
 * schema rationale. "Canonical" here means shared, cross-student academic
 * identity -- unrelated to "Canonical V2" (the pedagogical-engine/decision
 * progression authority), which this module never imports from or writes to.
 */

export type CatalogStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'DEPRECATED';

export type SkillType = 'TRANSVERSAL' | 'DISCIPLINE_SPECIFIC';

export type ContextCode = 'FAMILIAR' | 'ALTERED' | 'REAL_WORLD' | 'UNFAMILIAR' | 'CROSS_DOMAIN';

export type MappingStatus = 'MATCHED' | 'PROPOSED' | 'AMBIGUOUS' | 'UNRESOLVED';

export type MappingMethod = 'EXACT_LABEL_MATCH' | 'MANUAL_REVIEW' | 'SEED_FIXTURE';

export interface CanonicalSubject {
  id: string;
  name: string;
  status: CatalogStatus;
}

export interface CanonicalConcept {
  id: string;
  canonicalSubjectId: string;
  name: string;
  description: string | null;
  level: string | null;
  status: CatalogStatus;
}

export interface Skill {
  id: string;
  name: string;
  skillType: SkillType;
  description: string | null;
  status: CatalogStatus;
}

export interface Competency {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sequence: number | null;
  status: CatalogStatus;
}

export interface Context {
  id: string;
  code: ContextCode;
  name: string;
  description: string | null;
  sequence: number | null;
}

export interface ConceptCatalogMapping {
  id: string;
  learnerConceptId: string;
  canonicalConceptId: string | null;
  status: MappingStatus;
  mappingMethod: MappingMethod | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface ConceptCatalogMappingCandidate {
  id: string;
  mappingId: string;
  canonicalConceptId: string;
  confidence: number | null;
  rationale: string | null;
}
