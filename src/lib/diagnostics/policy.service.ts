/**
 * F8 -- versioned diagnostic policy, exactly mirroring F5's
 * aggregation_policy_versions idiom (policy.service.ts): at most one
 * ACTIVE row (partial unique index), append-only, never edited.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { DiagnosticPolicyRules, DiagnosticPolicyVersion } from './types';

function toPolicy(row: {
  id: string;
  version: number;
  rules: DiagnosticPolicyRules;
  status: 'ACTIVE' | 'RETIRED';
  effective_from: string;
  created_at: string;
}): DiagnosticPolicyVersion {
  return {
    id: row.id,
    version: row.version,
    rules: row.rules,
    status: row.status,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  };
}

export async function getActiveDiagnosticPolicy(client: DbExecutor = db): Promise<DiagnosticPolicyVersion> {
  const result = await client.query(`SELECT * FROM diagnostic_policy_versions WHERE status = 'ACTIVE' LIMIT 1`);
  if (result.rows.length === 0) {
    throw new Error('No ACTIVE diagnostic_policy_versions row exists -- seed data missing');
  }
  return toPolicy(result.rows[0]);
}

export async function getDiagnosticPolicyById(id: string, client: DbExecutor = db): Promise<DiagnosticPolicyVersion | null> {
  const result = await client.query(`SELECT * FROM diagnostic_policy_versions WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return toPolicy(result.rows[0]);
}

export async function createDiagnosticPolicyVersion(rules: DiagnosticPolicyRules): Promise<DiagnosticPolicyVersion> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT COALESCE(MAX(version), 0) AS max_version FROM diagnostic_policy_versions`);
    const nextVersion = Number(current.rows[0].max_version) + 1;
    await client.query(`UPDATE diagnostic_policy_versions SET status = 'RETIRED' WHERE status = 'ACTIVE'`);
    const inserted = await client.query(
      `INSERT INTO diagnostic_policy_versions (version, rules, status) VALUES ($1, $2, 'ACTIVE') RETURNING *`,
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
