/**
 * F8 -- versioned intervention-selection policy, same idiom as
 * diagnostic policy versioning (task §13/AC-F8-09).
 */
import { db, type DbExecutor } from '@/lib/db';
import type { InterventionPolicyRules, InterventionPolicyVersion } from './types';

function toPolicy(row: {
  id: string;
  version: number;
  rules: InterventionPolicyRules;
  status: 'ACTIVE' | 'RETIRED';
  effective_from: string;
  created_at: string;
}): InterventionPolicyVersion {
  return {
    id: row.id,
    version: row.version,
    rules: row.rules,
    status: row.status,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  };
}

export async function getActiveInterventionPolicy(client: DbExecutor = db): Promise<InterventionPolicyVersion> {
  const result = await client.query(`SELECT * FROM intervention_policy_versions WHERE status = 'ACTIVE' LIMIT 1`);
  if (result.rows.length === 0) {
    throw new Error('No ACTIVE intervention_policy_versions row exists -- seed data missing');
  }
  return toPolicy(result.rows[0]);
}

export async function getInterventionPolicyById(id: string, client: DbExecutor = db): Promise<InterventionPolicyVersion | null> {
  const result = await client.query(`SELECT * FROM intervention_policy_versions WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return toPolicy(result.rows[0]);
}

export async function createInterventionPolicyVersion(rules: InterventionPolicyRules): Promise<InterventionPolicyVersion> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT COALESCE(MAX(version), 0) AS max_version FROM intervention_policy_versions`);
    const nextVersion = Number(current.rows[0].max_version) + 1;
    await client.query(`UPDATE intervention_policy_versions SET status = 'RETIRED' WHERE status = 'ACTIVE'`);
    const inserted = await client.query(
      `INSERT INTO intervention_policy_versions (version, rules, status) VALUES ($1, $2, 'ACTIVE') RETURNING *`,
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
