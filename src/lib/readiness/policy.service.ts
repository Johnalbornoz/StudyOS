/**
 * F9 -- versioned readiness policy, exactly mirroring F5/F8's own
 * aggregation-policy idiom.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { ReadinessPolicyRules, ReadinessPolicyVersion } from './types';

function toPolicy(row: any): ReadinessPolicyVersion {
  return { id: row.id, version: row.version, rules: row.rules, status: row.status, effectiveFrom: row.effective_from, createdAt: row.created_at };
}

export async function getActiveReadinessPolicy(client: DbExecutor = db): Promise<ReadinessPolicyVersion> {
  const result = await client.query(`SELECT * FROM readiness_policy_versions WHERE status = 'ACTIVE' LIMIT 1`);
  if (result.rows.length === 0) throw new Error('No ACTIVE readiness_policy_versions row exists -- seed data missing');
  return toPolicy(result.rows[0]);
}

export async function getReadinessPolicyById(id: string, client: DbExecutor = db): Promise<ReadinessPolicyVersion | null> {
  const result = await client.query(`SELECT * FROM readiness_policy_versions WHERE id = $1`, [id]);
  return result.rows.length === 0 ? null : toPolicy(result.rows[0]);
}

export async function createReadinessPolicyVersion(rules: ReadinessPolicyRules): Promise<ReadinessPolicyVersion> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT COALESCE(MAX(version), 0) AS max_version FROM readiness_policy_versions`);
    const nextVersion = Number(current.rows[0].max_version) + 1;
    await client.query(`UPDATE readiness_policy_versions SET status = 'RETIRED' WHERE status = 'ACTIVE'`);
    const inserted = await client.query(
      `INSERT INTO readiness_policy_versions (version, rules, status) VALUES ($1, $2, 'ACTIVE') RETURNING *`,
      [nextVersion, JSON.stringify(rules)]
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
