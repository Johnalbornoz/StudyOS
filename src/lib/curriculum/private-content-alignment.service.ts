/**
 * F6 -- proves task 19/INV-F6-12: a learner's private content may
 * reference a canonical concept and even a framework objective without
 * becoming shared/public. This is a pure analytical READ join
 * (content_chunks -> F4 concept_catalog_mapping -> F6 objective_concept_mappings)
 * -- it never changes who can read the underlying content_sources/
 * content_chunks row. Existing access control (verifyContentSourceAccess,
 * F0-S) remains the only visibility gate; callers must still check it
 * themselves before exposing anything else about the chunk.
 */
import { db } from '@/lib/db';

export interface ObjectiveAlignment {
  learningObjectiveId: string;
  canonicalConceptId: string;
  relationType: string;
}

/** Read-only. Never exposes which student owns the chunk -- caller must already hold that context and its own authorization check. */
export async function getObjectiveAlignmentForContentChunk(contentChunkId: string): Promise<ObjectiveAlignment[]> {
  const result = await db.query(
    `
    SELECT DISTINCT ocm.learning_objective_id, ocm.canonical_concept_id, ocm.relation_type
    FROM content_chunks cc
    CROSS JOIN LATERAL unnest(cc.concept_mappings) AS learner_concept_id
    JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = learner_concept_id AND ccm.status = 'MATCHED'
    JOIN objective_concept_mappings ocm ON ocm.canonical_concept_id = ccm.canonical_concept_id AND ocm.status = 'PUBLISHED'
    WHERE cc.id = $1
    `,
    [contentChunkId]
  );
  return result.rows.map((r: any) => ({ learningObjectiveId: r.learning_objective_id, canonicalConceptId: r.canonical_concept_id, relationType: r.relation_type }));
}
