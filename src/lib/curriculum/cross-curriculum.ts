/**
 * B0-U -- reading SEVERAL curricula through the one knowledge graph (pure, no IO).
 *
 * Curricula never map to each other. Each maps its learning expectations to the same canonical concepts,
 * skills and competencies (`objective_concept_mappings` / `objective_skill_mappings` /
 * `objective_competency_mappings`), so the knowledge graph is the only hub:
 *
 *   expectation (curriculum A) --> concept <-- expectation (curriculum B)
 *
 * Everything here is DERIVED from those mappings. An alignment between two expectations is "they map to
 * the same concept", with both relations kept visible -- never an authored equivalence, and no second
 * mapping system.
 *
 * The same holds for mastery: a node, a unit or a subject has no state of its own. What can be said about
 * one is an aggregation of the state of the concepts under it (`deriveNodeState`), computed on read.
 */
import { conceptsOfObjective, type CurriculumScope, type ObjectiveConceptRelation } from './curriculum-scope';
import { subtreeOf } from './curriculum-framework';

export interface ExpectationRef {
  structureVersionId: string;
  learningObjectiveId: string;
}

export interface ConceptExpectation extends ExpectationRef {
  relationType: ObjectiveConceptRelation;
}

/** Every expectation, in any of the given curricula, that maps to the concept. The concept is one row; nothing is copied. */
export function expectationsOfConceptAcross(scopes: readonly CurriculumScope[], canonicalConceptId: string): ConceptExpectation[] {
  const out: ConceptExpectation[] = [];
  for (const scope of scopes) {
    for (const m of scope.objectiveConcepts) {
      if (m.canonicalConceptId === canonicalConceptId) out.push({ structureVersionId: scope.structureVersion.id, learningObjectiveId: m.learningObjectiveId, relationType: m.relationType });
    }
  }
  return out.sort((a, b) => a.structureVersionId.localeCompare(b.structureVersionId) || a.learningObjectiveId.localeCompare(b.learningObjectiveId) || a.relationType.localeCompare(b.relationType));
}

/** Canonical concepts both curricula reach. */
export function sharedConcepts(a: CurriculumScope, b: CurriculumScope): string[] {
  const inB = new Set(b.canonicalConcepts.map((c) => c.id));
  return a.canonicalConcepts.map((c) => c.id).filter((id) => inB.has(id)).sort();
}

export interface DerivedAlignment {
  from: ExpectationRef;
  to: ExpectationRef;
  viaCanonicalConceptId: string;
  /** The relation each side declares to the shared concept. Both are needed to judge how close the two are. */
  relations: { from: ObjectiveConceptRelation; to: ObjectiveConceptRelation };
}

/** Expectations of `a` and `b` that meet on a concept. Derived; an absence means "no shared concept mapped", not "unrelated". */
export function alignExpectations(a: CurriculumScope, b: CurriculumScope): DerivedAlignment[] {
  const out: DerivedAlignment[] = [];
  for (const ma of a.objectiveConcepts) {
    for (const mb of b.objectiveConcepts) {
      if (ma.canonicalConceptId !== mb.canonicalConceptId) continue;
      out.push({
        from: { structureVersionId: a.structureVersion.id, learningObjectiveId: ma.learningObjectiveId },
        to: { structureVersionId: b.structureVersion.id, learningObjectiveId: mb.learningObjectiveId },
        viaCanonicalConceptId: ma.canonicalConceptId,
        relations: { from: ma.relationType, to: mb.relationType },
      });
    }
  }
  return out.sort(
    (x, y) => x.from.learningObjectiveId.localeCompare(y.from.learningObjectiveId) || x.to.learningObjectiveId.localeCompare(y.to.learningObjectiveId) || x.viaCanonicalConceptId.localeCompare(y.viaCanonicalConceptId)
  );
}

/** Canonical concepts under a node and everything below it, in this version. */
export function conceptsUnderNode(scope: CurriculumScope, nodeId: string, relations?: readonly ObjectiveConceptRelation[]): string[] {
  const nodes = new Set(subtreeOf(scope, nodeId));
  const out = new Set<string>();
  for (const o of scope.learningObjectives) if (nodes.has(o.nodeId)) for (const c of conceptsOfObjective(scope, o.id, relations)) out.add(c);
  return [...out].sort();
}

/**
 * The expectations of ANOTHER curriculum that a node of this one meets, through shared concepts. This is how
 * a school's unit or session relates to the official expectations without either structure owning the other.
 */
export function expectationsMetByNode(scope: CurriculumScope, nodeId: string, other: CurriculumScope): Array<ConceptExpectation & { viaCanonicalConceptId: string }> {
  const concepts = new Set(conceptsUnderNode(scope, nodeId));
  const out: Array<ConceptExpectation & { viaCanonicalConceptId: string }> = [];
  const seen = new Set<string>();
  for (const m of other.objectiveConcepts) {
    if (!concepts.has(m.canonicalConceptId)) continue;
    const key = `${m.learningObjectiveId}:${m.canonicalConceptId}:${m.relationType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // the other side's own relation to the shared concept is kept: FULL and SUPPORTING are not the same closeness
    out.push({ structureVersionId: other.structureVersion.id, learningObjectiveId: m.learningObjectiveId, relationType: m.relationType, viaCanonicalConceptId: m.canonicalConceptId });
  }
  return out.sort((a, b) => a.learningObjectiveId.localeCompare(b.learningObjectiveId) || a.viaCanonicalConceptId.localeCompare(b.viaCanonicalConceptId));
}

/* ------------------------------------------------------------------ */
/* Skills and competencies of an expectation                            */
/* ------------------------------------------------------------------ */

/** PUBLISHED rows of `objective_skill_mappings` / `objective_competency_mappings` for a set of expectations. */
export interface ExpectationCapabilityMappings {
  objectiveSkills: ReadonlyArray<{ learningObjectiveId: string; skillId: string; relationType: ObjectiveConceptRelation }>;
  objectiveCompetencies: ReadonlyArray<{ learningObjectiveId: string; competencyId: string; relationType: ObjectiveConceptRelation }>;
}

export interface ExpectationKnowledge {
  learningObjectiveId: string;
  canonicalConceptIds: string[];
  skillIds: string[];
  competencyIds: string[];
}

/** What one expectation points at in the knowledge graph: 0..N concepts, skills and competencies. */
export function knowledgeOfExpectation(scope: CurriculumScope, capabilities: ExpectationCapabilityMappings, learningObjectiveId: string): ExpectationKnowledge {
  const uniq = (list: string[]) => [...new Set(list)].sort();
  return {
    learningObjectiveId,
    // every declared relation, not only the covering ones: a prerequisite or supporting concept is still a link
    canonicalConceptIds: uniq(scope.objectiveConcepts.filter((m) => m.learningObjectiveId === learningObjectiveId).map((m) => m.canonicalConceptId)),
    skillIds: uniq(capabilities.objectiveSkills.filter((m) => m.learningObjectiveId === learningObjectiveId).map((m) => m.skillId)),
    competencyIds: uniq(capabilities.objectiveCompetencies.filter((m) => m.learningObjectiveId === learningObjectiveId).map((m) => m.competencyId)),
  };
}

/* ------------------------------------------------------------------ */
/* Derived state of a curriculum node                                   */
/* ------------------------------------------------------------------ */

export interface DerivedNodeState<S extends string> {
  nodeId: string;
  canonicalConceptIds: string[];
  /** Concepts per state value of the knowledge state given. */
  byState: Partial<Record<S, string[]>>;
  /** Concepts under the node the Student has no state for. Reported; never counted as any state. */
  withoutState: string[];
}

/**
 * What can be said about a node (a topic, a unit, a session, a whole subject root) for one Student: the
 * state of each concept under it, grouped. It is computed from the Student's concept states -- keyed by
 * CANONICAL concept -- on every read. It is not a mastery value, it is not stored, and it has no formula.
 */
export function deriveNodeState<S extends string>(scope: CurriculumScope, nodeId: string, stateByCanonicalConcept: ReadonlyMap<string, S>): DerivedNodeState<S> {
  const canonicalConceptIds = conceptsUnderNode(scope, nodeId);
  const byState: Partial<Record<S, string[]>> = {};
  const withoutState: string[] = [];
  for (const id of canonicalConceptIds) {
    const state = stateByCanonicalConcept.get(id);
    if (state === undefined) withoutState.push(id);
    else byState[state] = [...(byState[state] ?? []), id];
  }
  return { nodeId, canonicalConceptIds, byState, withoutState };
}
