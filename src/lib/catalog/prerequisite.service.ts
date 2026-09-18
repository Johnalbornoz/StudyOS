/**
 * F4 -- canonical-level prerequisite graph. Distinct from, and never
 * reads from or writes to, the existing per-student concept_relationships
 * table (task 13). Self-referencing many-to-many on canonical_concepts,
 * kept acyclic by an application-level check before every insert -- see
 * docs/implementation/f4/F4_SKILL_COMPETENCY_GRAPH.md for the algorithm.
 */
import { db } from '@/lib/db';
import type { CanonicalConcept } from './types';

export class PrerequisiteCycleError extends Error {
  constructor(
    public prerequisiteConceptId: string,
    public conceptId: string
  ) {
    super(`Adding ${prerequisiteConceptId} as a prerequisite of ${conceptId} would create a cycle`);
  }
}

/**
 * True if `conceptId` is already reachable by following prerequisite
 * edges forward from `prerequisiteConceptId` -- i.e. `conceptId` is
 * already, transitively, a prerequisite of `prerequisiteConceptId`. If
 * so, the proposed edge (prerequisiteConceptId -> concept_id) would close
 * a cycle.
 */
async function wouldCreateCycle(prerequisiteConceptId: string, conceptId: string): Promise<boolean> {
  if (prerequisiteConceptId === conceptId) return true;
  const result = await db.query(
    `
    WITH RECURSIVE reachable AS (
      SELECT concept_id AS id FROM canonical_concept_prerequisites
      WHERE prerequisite_concept_id = $1
      UNION
      SELECT p.concept_id FROM canonical_concept_prerequisites p
      JOIN reachable r ON p.prerequisite_concept_id = r.id
    )
    SELECT 1 FROM reachable WHERE id = $2
    `,
    [conceptId, prerequisiteConceptId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addCanonicalPrerequisite(prerequisiteConceptId: string, conceptId: string): Promise<void> {
  if (await wouldCreateCycle(prerequisiteConceptId, conceptId)) {
    throw new PrerequisiteCycleError(prerequisiteConceptId, conceptId);
  }
  await db.query(
    `INSERT INTO canonical_concept_prerequisites (prerequisite_concept_id, concept_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [prerequisiteConceptId, conceptId]
  );
}

export async function getPrerequisitesFor(conceptId: string): Promise<CanonicalConcept[]> {
  const result = await db.query(
    `SELECT cc.id, cc.canonical_subject_id, cc.name, cc.description, cc.level, cc.status
     FROM canonical_concepts cc
     JOIN canonical_concept_prerequisites p ON p.prerequisite_concept_id = cc.id
     WHERE p.concept_id = $1 ORDER BY cc.name`,
    [conceptId]
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    canonicalSubjectId: r.canonical_subject_id,
    name: r.name,
    description: r.description,
    level: r.level,
    status: r.status,
  }));
}
