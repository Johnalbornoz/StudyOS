/**
 * Curriculum convergence certification helper -- EPHEMERAL DATABASE ONLY (127.0.0.1).
 *
 * Puts the throwaway catalogue in the state a database is in BEFORE the certified PAA catalogue is loaded
 * (the state of Preview): the certified concepts that only PAA objectives use are removed with their labels
 * and mappings, and the reviewed aliases with them. The certification then loads the catalogue again through
 * the governed runner and compares the result with the state before this step.
 */
import { Client } from 'pg';
import { PAA_CERTIFIED_CONCEPTS } from '@/lib/curriculum/paa/paa-certified-concepts';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1') throw new Error('REFUSING: this helper only runs on an ephemeral local database');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const ids = (await client.query(
      `SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
        WHERE lower(cs.name) || '/' || lower(cc.name) = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM objective_concept_mappings m JOIN learning_objectives lo ON lo.id = m.learning_objective_id WHERE m.canonical_concept_id = cc.id AND (lo.code IS NULL OR lo.code NOT LIKE 'paa.%'))
          AND NOT EXISTS (SELECT 1 FROM concept_catalog_mapping lm WHERE lm.canonical_concept_id = cc.id)`,
      [PAA_CERTIFIED_CONCEPTS.map((c) => `${c.canonicalSubject}/${c.canonicalName}`.toLowerCase())]
    )).rows.map((r) => r.id as string);
    await client.query(`DELETE FROM canonical_concept_aliases WHERE canonical_concept_id = ANY($1::uuid[])`, [ids]);
    const maps = await client.query(`DELETE FROM objective_concept_mappings WHERE canonical_concept_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM canonical_concept_localizations WHERE canonical_concept_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM canonical_concept_prerequisites WHERE concept_id = ANY($1::uuid[]) OR prerequisite_concept_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM canonical_concepts WHERE id = ANY($1::uuid[])`, [ids]);
    await client.query('COMMIT');
    console.log(`unloaded certified_concepts=${ids.length} mappings=${maps.rowCount}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
