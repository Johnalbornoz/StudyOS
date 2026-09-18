/**
 * F4 -- the correspondence layer between existing per-student concepts
 * and the canonical catalog (task 7). Every existing concept gets exactly
 * one row here (enforced by concept_catalog_mapping.learner_concept_id
 * UNIQUE). Never merges by name alone across an ambiguous candidate set
 * (INV-F4-04) -- see docs/implementation/f4/F4_CANONICAL_CATALOG_MIGRATION_SPEC.md
 * for the exact algorithm, mirrored here for concepts created AFTER the
 * migration's one-time backfill (task 18's "content creation flow"
 * contract).
 */
import { db } from '@/lib/db';
import type { ConceptCatalogMapping, ConceptCatalogMappingCandidate } from './types';

function toMapping(r: any): ConceptCatalogMapping {
  return {
    id: r.id,
    learnerConceptId: r.learner_concept_id,
    canonicalConceptId: r.canonical_concept_id,
    status: r.status,
    mappingMethod: r.mapping_method,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
  };
}

export async function getMappingForConcept(learnerConceptId: string): Promise<ConceptCatalogMapping | null> {
  const result = await db.query(
    `SELECT id, learner_concept_id, canonical_concept_id, status, mapping_method, reviewed_by, reviewed_at
     FROM concept_catalog_mapping WHERE learner_concept_id = $1`,
    [learnerConceptId]
  );
  return result.rows.length === 0 ? null : toMapping(result.rows[0]);
}

export async function getCandidatesForMapping(mappingId: string): Promise<ConceptCatalogMappingCandidate[]> {
  const result = await db.query(
    `SELECT id, mapping_id, canonical_concept_id, confidence, rationale
     FROM concept_catalog_mapping_candidates WHERE mapping_id = $1 ORDER BY confidence DESC NULLS LAST`,
    [mappingId]
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    mappingId: r.mapping_id,
    canonicalConceptId: r.canonical_concept_id,
    confidence: r.confidence,
    rationale: r.rationale,
  }));
}

export async function listMappingsByStatus(status: 'AMBIGUOUS' | 'UNRESOLVED' | 'PROPOSED'): Promise<ConceptCatalogMapping[]> {
  const result = await db.query(
    `SELECT id, learner_concept_id, canonical_concept_id, status, mapping_method, reviewed_by, reviewed_at
     FROM concept_catalog_mapping WHERE status = $1 ORDER BY created_at`,
    [status]
  );
  return result.rows.map(toMapping);
}

/**
 * Task 18 -- called when a new learner concept is created (AI extraction
 * or manual entry), AFTER the concept row itself already exists. Never
 * blocks or fails concept creation: callers must treat this as best-effort
 * (the migration's own backfill will pick up anything missed). Runs the
 * exact same zero/one/many-candidate algorithm as the migration backfill.
 */
export async function ensureCatalogMapping(learnerConceptId: string): Promise<ConceptCatalogMapping> {
  const existing = await getMappingForConcept(learnerConceptId);
  if (existing) return existing;

  const conceptRow = await db.query(
    `SELECT s.name AS subject_name
     FROM concepts c JOIN subjects s ON s.id = c.subject_id
     WHERE c.id = $1`,
    [learnerConceptId]
  );
  if (conceptRow.rows.length === 0) {
    throw new Error(`ensureCatalogMapping: concept ${learnerConceptId} does not exist`);
  }
  const subjectName: string = conceptRow.rows[0].subject_name;

  const labelRow = await db.query(
    `SELECT label FROM concept_localizations WHERE concept_id = $1 ORDER BY (language = 'en') DESC, created_at ASC LIMIT 1`,
    [learnerConceptId]
  );
  const label: string | null = labelRow.rows[0]?.label ?? null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const mappingId = (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id;

    if (!label) {
      await client.query(
        `INSERT INTO concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method)
         VALUES ($1, $2, NULL, 'UNRESOLVED', NULL)`,
        [mappingId, learnerConceptId]
      );
      await client.query('COMMIT');
      return (await getMappingForConcept(learnerConceptId))!;
    }

    const candidates = await client.query(
      `SELECT cc.id FROM canonical_concepts cc
       JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
       WHERE lower(trim(cs.name)) = lower(trim($1)) AND lower(trim(cc.name)) = lower(trim($2))`,
      [subjectName, label]
    );

    if (candidates.rows.length === 0) {
      await client.query(
        `INSERT INTO concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method)
         VALUES ($1, $2, NULL, 'UNRESOLVED', NULL)`,
        [mappingId, learnerConceptId]
      );
    } else if (candidates.rows.length === 1) {
      const canonicalId = candidates.rows[0].id;
      await client.query(
        `INSERT INTO concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method)
         VALUES ($1, $2, $3, 'MATCHED', 'EXACT_LABEL_MATCH')`,
        [mappingId, learnerConceptId, canonicalId]
      );
      await client.query(
        `INSERT INTO concept_catalog_mapping_candidates (mapping_id, canonical_concept_id, confidence, rationale)
         VALUES ($1, $2, 1.0, 'exact label match within same-named canonical subject')`,
        [mappingId, canonicalId]
      );
    } else {
      await client.query(
        `INSERT INTO concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method)
         VALUES ($1, $2, NULL, 'AMBIGUOUS', NULL)`,
        [mappingId, learnerConceptId]
      );
      for (const row of candidates.rows) {
        await client.query(
          `INSERT INTO concept_catalog_mapping_candidates (mapping_id, canonical_concept_id, confidence, rationale)
           VALUES ($1, $2, 0.5, 'exact label match but multiple canonical concepts share this name -- never auto-picked')`,
          [mappingId, row.id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return (await getMappingForConcept(learnerConceptId))!;
}

/**
 * Manual review confirmation (task 7's "reviewed/confirmed canonical
 * concept" state). Never called automatically -- always an explicit human
 * action recording who confirmed it and when.
 */
export async function confirmMapping(mappingId: string, canonicalConceptId: string, reviewedBy: string): Promise<void> {
  await db.query(
    `UPDATE concept_catalog_mapping
     SET canonical_concept_id = $2, status = 'MATCHED', mapping_method = 'MANUAL_REVIEW', reviewed_by = $3, reviewed_at = now(), updated_at = now()
     WHERE id = $1`,
    [mappingId, canonicalConceptId, reviewedBy]
  );
}
