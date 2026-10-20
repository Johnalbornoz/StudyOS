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
import type { DbExecutor } from '@/lib/db';
import type { ConceptCatalogMapping, ConceptCatalogMappingCandidate } from './types';
import { decideCatalogResolution, type CatalogResolution } from './catalog-resolution';

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

/** Ground A: canonical concepts of the same-named canonical subject whose NAME is the label. */
const EXACT_SQL = `SELECT cc.id FROM canonical_concepts cc
       JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
       WHERE lower(trim(cs.name)) = lower(trim($1)) AND lower(trim(cc.name)) = lower(trim($2))`;

/** Ground B: ACTIVE reviewed aliases of the same-named canonical subject that carry the label (never another subject). */
const ALIAS_SQL = `SELECT a.id AS alias_id, a.canonical_concept_id FROM canonical_concept_aliases a
       JOIN canonical_subjects cs ON cs.id = a.canonical_subject_id
       JOIN canonical_concepts cc ON cc.id = a.canonical_concept_id AND cc.status = 'ACTIVE'
       WHERE a.status = 'ACTIVE' AND lower(trim(cs.name)) = lower(trim($1)) AND a.normalized_label = lower(btrim($2))`;

async function reviewedAliasesFor(client: DbExecutor, subjectName: string, label: string): Promise<Array<{ aliasId: string; canonicalConceptId: string }>> {
  const r = await client.query(ALIAS_SQL, [subjectName, label]);
  return r.rows.map((x: any) => ({ aliasId: x.alias_id as string, canonicalConceptId: x.canonical_concept_id as string }));
}

/** The one label a learner concept is resolved by, and its subject's name (the same pair the first resolution used). */
async function resolutionInputs(client: DbExecutor, learnerConceptId: string): Promise<{ subjectName: string; label: string | null } | null> {
  const conceptRow = await client.query(`SELECT s.name AS subject_name FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1`, [learnerConceptId]);
  if (conceptRow.rows.length === 0) return null;
  const labelRow = await client.query(`SELECT label FROM concept_localizations WHERE concept_id = $1 ORDER BY (language = 'en') DESC, created_at ASC LIMIT 1`, [learnerConceptId]);
  return { subjectName: conceptRow.rows[0].subject_name as string, label: (labelRow.rows[0]?.label as string | undefined) ?? null };
}

export interface CatalogReresolution {
  learnerConceptId: string;
  before: string | null;
  after: string | null;
  resolution: CatalogResolution | null;
  changed: boolean;
}

/**
 * Curriculum convergence -- re-run the resolution of a learner concept that is UNRESOLVED, after the catalogue
 * gained a concept or a reviewed alias. Same two grounds as the first resolution (catalog-resolution.ts) and
 * nothing else. Only an UNRESOLVED row is ever changed, and only to a single MATCHED target; an ambiguous or
 * still-unresolved outcome writes nothing. The Student's concept, its subject and its evidence are not touched.
 */
export async function reresolveUnresolvedCatalogMapping(learnerConceptId: string, client: DbExecutor = db): Promise<CatalogReresolution> {
  const row = (await client.query(`SELECT id, status FROM concept_catalog_mapping WHERE learner_concept_id = $1`, [learnerConceptId])).rows[0];
  const before: string | null = row?.status ?? null;
  if (!row || row.status !== 'UNRESOLVED') return { learnerConceptId, before, after: before, resolution: null, changed: false };
  const inputs = await resolutionInputs(client, learnerConceptId);
  if (!inputs?.label) return { learnerConceptId, before, after: before, resolution: null, changed: false };
  const exact = (await client.query(EXACT_SQL, [inputs.subjectName, inputs.label])).rows.map((x: any) => x.id as string);
  const resolution = decideCatalogResolution(exact, exact.length === 0 ? await reviewedAliasesFor(client, inputs.subjectName, inputs.label) : []);
  if (resolution.status !== 'MATCHED') return { learnerConceptId, before, after: before, resolution, changed: false };
  const updated = await client.query(
    `UPDATE concept_catalog_mapping
        SET canonical_concept_id = $2, status = 'MATCHED', mapping_method = $3, resolved_alias_id = $4, updated_at = now()
      WHERE id = $1 AND status = 'UNRESOLVED'`,
    [row.id, resolution.canonicalConceptId, resolution.method, resolution.aliasId]
  );
  if ((updated.rowCount ?? 0) !== 1) return { learnerConceptId, before, after: before, resolution, changed: false };
  await client.query(
    `INSERT INTO concept_catalog_mapping_candidates (mapping_id, canonical_concept_id, confidence, rationale) VALUES ($1, $2, 1.0, $3)`,
    [row.id, resolution.canonicalConceptId, resolution.method === 'REVIEWED_ALIAS' ? `reviewed alias ${resolution.aliasId} (re-resolution)` : 'exact label match within same-named canonical subject (re-resolution)']
  );
  return { learnerConceptId, before, after: 'MATCHED', resolution, changed: true };
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
  // Ground B (reviewed alias), read before the transaction: a database without the alias table simply has no alias.
  const aliases = label ? await reviewedAliasesFor(db, subjectName, label).catch(() => []) : [];

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

    const viaAlias = candidates.rows.length === 0 ? decideCatalogResolution([], aliases) : null;
    if (viaAlias?.status === 'MATCHED' && viaAlias.method === 'REVIEWED_ALIAS') {
      // No canonical concept carries the label; ONE reviewed alias of this subject does: an explicit, reviewed correspondence.
      await client.query(
        `INSERT INTO concept_catalog_mapping (id, learner_concept_id, canonical_concept_id, status, mapping_method, resolved_alias_id)
         VALUES ($1, $2, $3, 'MATCHED', 'REVIEWED_ALIAS', $4)`,
        [mappingId, learnerConceptId, viaAlias.canonicalConceptId, viaAlias.aliasId]
      );
      await client.query(
        `INSERT INTO concept_catalog_mapping_candidates (mapping_id, canonical_concept_id, confidence, rationale) VALUES ($1, $2, 1.0, $3)`,
        [mappingId, viaAlias.canonicalConceptId, `reviewed alias ${viaAlias.aliasId}`]
      );
    } else if (candidates.rows.length === 0) {
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
