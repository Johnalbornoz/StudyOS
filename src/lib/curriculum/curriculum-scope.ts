/**
 * B1 -- CurriculumScope: the one canonical, version-aware read contract of "what is to be learned and how it
 * is organised" for ONE structure version (pure types + builders, no IO).
 *
 *   organization -> programme -> qualification -> subject -> structure version
 *     -> nodes (hierarchy of THIS version) -> learning objectives -> canonical concepts
 *
 * Identity rules it encodes:
 *   - A canonical concept does NOT belong to a topic. Its place in a hierarchy exists only inside a structure
 *     version, through the objectives that map to it: `objectiveConcepts` is many-to-many, so one concept may
 *     sit under several nodes of this version and under different nodes of another version.
 *   - Node membership is therefore always asked of a scope (`nodesOfConcept(scope, ...)`), never of a concept.
 *   - A node an exam configuration bootstrapped (`EXAM_SECTION`) is an ASSESSMENT grouping that lives in the
 *     curriculum tables; it is reported as such and is not presented as curriculum hierarchy.
 *
 * Owner: the Curriculum Authority. It holds no learner state, no item counts and no exam structure.
 */

export const CURRICULUM_SCOPE_VERSION = 1 as const;

export type ObjectiveConceptRelation = 'FULL' | 'PARTIAL' | 'PREREQUISITE' | 'SUPPORTING';

/** Relations that say "this objective teaches / assesses this concept" (the existing curriculum read uses the same two). */
export const COVERING_RELATIONS: readonly ObjectiveConceptRelation[] = ['FULL', 'PARTIAL'];

export type ScopeNodeOrigin = 'CURRICULUM_HIERARCHY' | 'BOOTSTRAP_ASSESSMENT_SECTION';

export interface ScopeNode {
  id: string;
  parentId: string | null;
  nodeType: string;
  code: string | null;
  label: string;
  orderIndex: number;
  origin: ScopeNodeOrigin;
}

export interface ScopeObjective {
  id: string;
  nodeId: string;
  code: string | null;
  description: string;
}

export interface ScopeObjectiveConcept {
  learningObjectiveId: string;
  canonicalConceptId: string;
  relationType: ObjectiveConceptRelation;
}

export interface ScopeConcept {
  id: string;
  name: string;
  canonicalSubjectId: string;
}

export interface CurriculumScopeHeader {
  organization: { id: string; name: string } | null;
  programme: { id: string; name: string; type: string | null } | null;
  qualification: { id: string; name: string } | null;
  subject: { academicSubjectId: string; name: string; level: string | null; canonicalSubjectId: string | null };
  structureVersion: { id: string; label: string; status: string };
}

export interface CurriculumScope extends CurriculumScopeHeader {
  v: typeof CURRICULUM_SCOPE_VERSION;
  nodes: ScopeNode[];
  learningObjectives: ScopeObjective[];
  /** Learning Objective <-> Canonical Concept, many-to-many, PUBLISHED mappings of this version's objectives only. */
  objectiveConcepts: ScopeObjectiveConcept[];
  /** Distinct canonical concepts reachable in this version. */
  canonicalConcepts: ScopeConcept[];
}

/** A scope by reference: what another contract stores instead of a copy of the curriculum. */
export interface CurriculumScopeRef {
  structureVersionId: string;
  academicSubjectId: string;
}

export const nodeOriginOf = (nodeType: string): ScopeNodeOrigin => (nodeType === 'EXAM_SECTION' ? 'BOOTSTRAP_ASSESSMENT_SECTION' : 'CURRICULUM_HIERARCHY');

export function buildCurriculumScope(
  header: CurriculumScopeHeader,
  rows: {
    nodes: Array<{ id: string; parent_id: string | null; node_type: string; code: string | null; label: string | null; order_index: number | null }>;
    objectives: Array<{ id: string; structure_node_id: string; code: string | null; description: string | null }>;
    mappings: Array<{ learning_objective_id: string; canonical_concept_id: string; relation_type: string }>;
    concepts: Array<{ id: string; name: string; canonical_subject_id: string }>;
  }
): CurriculumScope {
  const nodes: ScopeNode[] = rows.nodes
    .map((n) => ({ id: n.id, parentId: n.parent_id ?? null, nodeType: n.node_type, code: n.code ?? null, label: n.label ?? n.code ?? '', orderIndex: n.order_index ?? 0, origin: nodeOriginOf(n.node_type) }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const learningObjectives: ScopeObjective[] = rows.objectives
    .filter((o) => nodeIds.has(o.structure_node_id))
    .map((o) => ({ id: o.id, nodeId: o.structure_node_id, code: o.code ?? null, description: o.description ?? '' }))
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '') || a.id.localeCompare(b.id));
  const objectiveIds = new Set(learningObjectives.map((o) => o.id));
  const seen = new Set<string>();
  const objectiveConcepts: ScopeObjectiveConcept[] = [];
  for (const m of rows.mappings) {
    if (!objectiveIds.has(m.learning_objective_id)) continue;
    const k = `${m.learning_objective_id}:${m.canonical_concept_id}:${m.relation_type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    objectiveConcepts.push({ learningObjectiveId: m.learning_objective_id, canonicalConceptId: m.canonical_concept_id, relationType: m.relation_type as ObjectiveConceptRelation });
  }
  const used = new Set(objectiveConcepts.map((m) => m.canonicalConceptId));
  const canonicalConcepts: ScopeConcept[] = rows.concepts
    .filter((c) => used.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, canonicalSubjectId: c.canonical_subject_id }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { v: CURRICULUM_SCOPE_VERSION, ...header, nodes, learningObjectives, objectiveConcepts, canonicalConcepts };
}

export const scopeRef = (scope: CurriculumScope): CurriculumScopeRef => ({ structureVersionId: scope.structureVersion.id, academicSubjectId: scope.subject.academicSubjectId });

const covering = (relations?: readonly ObjectiveConceptRelation[]) => relations ?? COVERING_RELATIONS;

/** Canonical concepts an objective maps to IN THIS VERSION (0..N). */
export function conceptsOfObjective(scope: CurriculumScope, learningObjectiveId: string, relations?: readonly ObjectiveConceptRelation[]): string[] {
  const allow = covering(relations);
  return [...new Set(scope.objectiveConcepts.filter((m) => m.learningObjectiveId === learningObjectiveId && allow.includes(m.relationType)).map((m) => m.canonicalConceptId))];
}

/** Objectives of this version that map to the concept (0..N). */
export function objectivesOfConcept(scope: CurriculumScope, canonicalConceptId: string, relations?: readonly ObjectiveConceptRelation[]): string[] {
  const allow = covering(relations);
  return [...new Set(scope.objectiveConcepts.filter((m) => m.canonicalConceptId === canonicalConceptId && allow.includes(m.relationType)).map((m) => m.learningObjectiveId))];
}

/** Nodes of THIS version under which the concept appears (0..N). Membership is contextual to the scope. */
export function nodesOfConcept(scope: CurriculumScope, canonicalConceptId: string, relations?: readonly ObjectiveConceptRelation[]): string[] {
  const objectiveIds = new Set(objectivesOfConcept(scope, canonicalConceptId, relations));
  return [...new Set(scope.learningObjectives.filter((o) => objectiveIds.has(o.id)).map((o) => o.nodeId))];
}

/** Canonical concepts that appear under a node of this version (through its objectives). */
export function conceptsOfNode(scope: CurriculumScope, nodeId: string, relations?: readonly ObjectiveConceptRelation[]): string[] {
  const out = new Set<string>();
  for (const o of scope.learningObjectives) if (o.nodeId === nodeId) for (const c of conceptsOfObjective(scope, o.id, relations)) out.add(c);
  return [...out];
}

export const scopeContainsObjective = (scope: CurriculumScope, learningObjectiveId: string): boolean => scope.learningObjectives.some((o) => o.id === learningObjectiveId);

export const scopeContainsConcept = (scope: CurriculumScope, canonicalConceptId: string): boolean => scope.canonicalConcepts.some((c) => c.id === canonicalConceptId);

export interface CurriculumScopeGaps {
  /** Objectives of this version with no PUBLISHED covering concept mapping (kept visible, never filled in). */
  objectivesWithoutConcept: string[];
  /** True when every node is a bootstrap assessment section: the version has no curriculum hierarchy yet. */
  hierarchyIsBootstrapOnly: boolean;
}

export function curriculumScopeGaps(scope: CurriculumScope): CurriculumScopeGaps {
  return {
    objectivesWithoutConcept: scope.learningObjectives.filter((o) => conceptsOfObjective(scope, o.id).length === 0).map((o) => o.id),
    hierarchyIsBootstrapOnly: scope.nodes.length > 0 && scope.nodes.every((n) => n.origin === 'BOOTSTRAP_ASSESSMENT_SECTION'),
  };
}
