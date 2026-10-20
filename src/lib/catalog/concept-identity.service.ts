/**
 * B1 -- Canonical Concept Identity: the read boundary over `concept_catalog_mapping`, and the one explicit
 * write used when a learner concept is created FROM a canonical concept.
 *
 * Reads never match labels and never write. Historical learning evidence stays keyed on the learner concept;
 * its canonical identity is resolved here, at read time, through the stored link.
 */
import { db, type DbExecutor } from '@/lib/db';
import { classifyConceptIdentity, type ConceptIdentity, type ConceptLinkFacts } from './concept-identity';

const LINK_SELECT = `SELECT c.id AS learner_concept_id, c.canonical_id AS concept_key, m.status AS mapping_status, m.canonical_concept_id, m.mapping_method, (m.reviewed_by IS NOT NULL) AS reviewed
       FROM concepts c
       LEFT JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id`;

function toFacts(r: any): ConceptLinkFacts {
  return {
    learnerConceptId: r.learner_concept_id,
    conceptKey: r.concept_key ?? null,
    mappingStatus: r.mapping_status ?? null,
    canonicalConceptId: r.canonical_concept_id ?? null,
    mappingMethod: r.mapping_method ?? null,
    reviewed: r.reviewed === true,
  };
}

/** Identity of each learner concept asked for. A concept id that does not exist is absent from the map. */
export async function resolveConceptIdentities(learnerConceptIds: readonly string[], client: DbExecutor = db): Promise<Map<string, ConceptIdentity>> {
  const out = new Map<string, ConceptIdentity>();
  if (learnerConceptIds.length === 0) return out;
  const r = await client.query(`${LINK_SELECT} WHERE c.id = ANY($1::uuid[])`, [[...new Set(learnerConceptIds)]]);
  for (const row of r.rows) out.set(row.learner_concept_id, classifyConceptIdentity(toFacts(row)));
  return out;
}

export async function resolveConceptIdentity(learnerConceptId: string, client: DbExecutor = db): Promise<ConceptIdentity | null> {
  return (await resolveConceptIdentities([learnerConceptId], client)).get(learnerConceptId) ?? null;
}

/** Identity of every concept of the Student's non-archived subjects (the Student -> learner concept -> canonical concept chain). */
export async function resolveStudentConceptIdentities(studentId: string, client: DbExecutor = db): Promise<ConceptIdentity[]> {
  const r = await client.query(`${LINK_SELECT} JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1 AND s.status <> 'archived' ORDER BY c.created_at, c.id`, [studentId]);
  return r.rows.map((row: any) => classifyConceptIdentity(toFacts(row)));
}

/**
 * The explicit link of a learner concept that was just created FROM `canonicalConceptId`. The method is the
 * one the plan-enrolment path already writes for the same fact (`PLAN_ENROLLMENT`: a learner-side concept
 * created from the catalogue); no label is read. An existing row for the concept is left as it is.
 */
export async function linkLearnerConceptCreatedFromCanonical(learnerConceptId: string, canonicalConceptId: string, client: DbExecutor = db): Promise<void> {
  await client.query(
    `INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method)
     VALUES ($1, $2, 'MATCHED', 'PLAN_ENROLLMENT')
     ON CONFLICT (learner_concept_id) DO NOTHING`,
    [learnerConceptId, canonicalConceptId]
  );
  const linked = await client.query(`SELECT canonical_concept_id FROM concept_catalog_mapping WHERE learner_concept_id = $1`, [learnerConceptId]);
  // A pre-existing row pointing elsewhere is never overwritten silently.
  if (linked.rows[0]?.canonical_concept_id !== canonicalConceptId) throw new Error('CATALOG_MAPPING_MISMATCH');
}
