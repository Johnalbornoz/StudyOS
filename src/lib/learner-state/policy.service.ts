/**
 * F5 -- aggregation policy versioning (task 15, INV-F5-15/16). Exactly one
 * ACTIVE version per dimension at a time; a new version retires the old
 * one in the same transaction, never edits `rules` on an existing row.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { AggregationPolicyVersion, StateDimension } from './types';

function toPolicy(r: any): AggregationPolicyVersion {
  return { id: r.id, dimension: r.dimension, version: r.version, rules: r.rules, status: r.status };
}

export async function getActivePolicy(dimension: StateDimension, client: DbExecutor = db): Promise<AggregationPolicyVersion> {
  const result = await client.query(
    `SELECT id, dimension, version, rules, status FROM aggregation_policy_versions WHERE dimension = $1 AND status = 'ACTIVE'`,
    [dimension]
  );
  if (result.rows.length === 0) {
    throw new Error(`No ACTIVE aggregation policy version for dimension ${dimension}`);
  }
  return toPolicy(result.rows[0]);
}

export async function getPolicyById(policyVersionId: string, client: DbExecutor = db): Promise<AggregationPolicyVersion | null> {
  const result = await client.query(
    `SELECT id, dimension, version, rules, status FROM aggregation_policy_versions WHERE id = $1`,
    [policyVersionId]
  );
  return result.rows.length === 0 ? null : toPolicy(result.rows[0]);
}

/** Creates a new ACTIVE version and retires the previous one, atomically. Never edits `rules` in place. */
export async function createPolicyVersion(dimension: StateDimension, rules: Record<string, unknown>): Promise<AggregationPolicyVersion> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const maxVersion = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM aggregation_policy_versions WHERE dimension = $1`,
      [dimension]
    );
    const nextVersion = Number(maxVersion.rows[0].max_version) + 1;
    await client.query(`UPDATE aggregation_policy_versions SET status = 'RETIRED' WHERE dimension = $1 AND status = 'ACTIVE'`, [dimension]);
    const inserted = await client.query(
      `INSERT INTO aggregation_policy_versions (dimension, version, rules, status) VALUES ($1, $2, $3, 'ACTIVE')
       RETURNING id, dimension, version, rules, status`,
      [dimension, nextVersion, JSON.stringify(rules)]
    );
    await client.query('COMMIT');
    return toPolicy(inserted.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
