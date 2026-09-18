/**
 * F6 -- editorial grants (task 14/32). A separate, narrow permission
 * table -- never an addition to F1's platform Role enum. Holding
 * TEACHER/INSTITUTION_ADMIN confers ZERO editorial capability; every
 * check here queries curriculum_editorial_grants directly, never
 * user_roles. Fails closed on any error, same discipline as F2's
 * src/lib/authorization functions.
 */
import { db } from '@/lib/db';
import type { EditorialRole } from './types';

export async function grantEditorialRole(userId: string, role: EditorialRole, grantedBy: string): Promise<void> {
  await db.query(
    `INSERT INTO curriculum_editorial_grants (user_id, grant_role, status, granted_by, granted_at) VALUES ($1, $2, 'ACTIVE', $3, now())`,
    [userId, role, grantedBy]
  );
}

export async function revokeEditorialRole(userId: string, role: EditorialRole): Promise<void> {
  await db.query(
    `UPDATE curriculum_editorial_grants SET status = 'REVOKED', revoked_at = now() WHERE user_id = $1 AND grant_role = $2 AND status = 'ACTIVE'`,
    [userId, role]
  );
}

export async function hasEditorialRole(userId: string, role: EditorialRole): Promise<boolean> {
  try {
    const result = await db.query(
      `SELECT 1 FROM curriculum_editorial_grants WHERE user_id = $1 AND grant_role = $2 AND status = 'ACTIVE' LIMIT 1`,
      [userId, role]
    );
    return (result.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}
