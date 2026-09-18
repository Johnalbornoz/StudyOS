/**
 * F6 -- versioned academic structure and curriculum mapping. Canonical
 * knowledge (F4's canonical_concepts/skills/competencies) is never
 * duplicated here -- every mapping type below only ever references those
 * existing ids. See docs/implementation/f6/F6_TARGET_ACADEMIC_STRUCTURE.md.
 * Nothing here has a studentId -- this is canonical/framework-scoped
 * data (INV-F6-15), never learner state.
 */

export type CatalogStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type ProgrammeType = 'CURRICULUM' | 'ASSESSMENT_FRAMEWORK' | 'ADMISSION_EXAM';
export type StructureVersionStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'RETIRED';
export type RelationType = 'FULL' | 'PARTIAL' | 'PREREQUISITE' | 'SUPPORTING';
export type MappingProvenance = 'MANUAL' | 'AI_SUGGESTED';
export type WorkflowStatus = 'DRAFT' | 'PROPOSED' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'RETIRED';
export type EditorialRole = 'EDITOR' | 'REVIEWER' | 'PUBLISHER';
export type ResourceType = 'TEXTBOOK' | 'PRACTICE_SET' | 'VIDEO' | 'ARTICLE' | 'OTHER';

export interface AcademicOrganization {
  id: string;
  name: string;
  status: CatalogStatus;
}

export interface AcademicProgramme {
  id: string;
  organizationId: string;
  name: string;
  programmeType: ProgrammeType;
  stage: string | null;
  status: CatalogStatus;
}

export interface AcademicQualification {
  id: string;
  programmeId: string;
  name: string;
  status: CatalogStatus;
}

export interface AcademicSubject {
  id: string;
  programmeId: string;
  qualificationId: string | null;
  name: string;
  level: string | null;
  status: CatalogStatus;
}

export interface StructureVersion {
  id: string;
  academicSubjectId: string;
  versionLabel: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: StructureVersionStatus;
  sourceLocator: string | null;
}

export interface StructureNode {
  id: string;
  structureVersionId: string;
  parentId: string | null;
  nodeType: string;
  sourceLabel: string;
  code: string | null;
  orderIndex: number;
  description: string | null;
  status: 'ACTIVE' | 'RETIRED';
}

export interface LearningObjective {
  id: string;
  structureNodeId: string;
  code: string | null;
  description: string;
  status: 'ACTIVE' | 'RETIRED';
}

export interface MappingRecord {
  id: string;
  learningObjectiveId: string;
  targetId: string; // canonicalConceptId | skillId | competencyId
  relationType: RelationType;
  scope: string | null;
  level: string | null;
  rationale: string | null;
  provenance: MappingProvenance;
  confidence: number | null;
  status: WorkflowStatus;
  mappingGroupId: string;
  version: number;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
}

export type MappingTargetTable = 'objective_concept_mappings' | 'objective_skill_mappings' | 'objective_competency_mappings';
export type MappingTargetColumn = 'canonical_concept_id' | 'skill_id' | 'competency_id';

export interface AcademicResource {
  id: string;
  title: string;
  resourceType: ResourceType;
  description: string | null;
  sourceLocator: string | null;
  status: WorkflowStatus;
  resourceGroupId: string;
  version: number;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
}

export interface CoveragePolicyVersion {
  id: string;
  version: number;
  rules: { countedMappingStatuses: string[]; fullCoverageRelationTypes: string[]; partialCoverageRelationTypes: string[] };
  status: 'ACTIVE' | 'RETIRED';
}

export interface MappingCoverageResult {
  total: number;
  fullyMappedCount: number;
  partiallyMappedCount: number;
  unmappedCount: number;
  policyVersion: number;
}

export interface ContentCoverageResult {
  total: number;
  withApprovedResourceCount: number;
  policyVersion: number;
}
