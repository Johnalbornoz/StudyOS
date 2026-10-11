import { db } from '@/lib/db';
import type { Role } from './types';

/**
 * L10 SF-1 / SF-2 -- the shared predicates every API guard composes.
 *
 * SF-1: a relationship, ownership or membership row is never sufficient on
 * its own. The actor's ACCOUNT must be ACTIVE (`users.status`) and the ROLE
 * for the surface being entered must be ACTIVE (`user_roles.status`). Both
 * are read from the database on every call, so an administrator's
 * revocation or suspension takes effect on the next request -- no token,
 * session claim or cache carries authorization.
 *
 * SF-2: "this account owns this learner" has ONE definition
 * (`STUDENT_OWNER_MATCH_SQL`), used by the learning family (which used to
 * resolve by `students.clerk_id`) and the exam family (which used to resolve
 * by `students.user_id`). The canonical link is `students.user_id`; a row
 * whose link was never backfilled falls back to the same Clerk identity, so
 * both families always return the same learner.
 *
 * These are SQL fragments, not a second authorization model: each guard
 * keeps its own relationship query and adds the fragment to it, so the
 * check costs no extra round trip.
 */

/** Join condition between `students s` and `users u`. */
export const STUDENT_OWNER_MATCH_SQL = `(s.user_id = u.id OR (s.user_id IS NULL AND s.clerk_id = u.clerk_id))`;

const ROLE_LITERALS: Record<Role, string> = {
  STUDENT: `'STUDENT'`,
  PARENT: `'PARENT'`,
  TEACHER: `'TEACHER'`,
  INSTITUTION_ADMIN: `'INSTITUTION_ADMIN'`,
  STUDYUS_ADMIN: `'STUDYUS_ADMIN'`,
};

/**
 * `userIdExpr` is a SQL expression yielding a `users.id` (a bind parameter
 * such as `$1`, or a column such as `u.id`) -- always written by the guard
 * itself, never taken from a request. `role` is typed, and is emitted from a
 * fixed literal table.
 */
export function activeRoleSql(userIdExpr: string, role: Role): string {
  return `EXISTS (
    SELECT 1 FROM users au
    JOIN user_roles ar ON ar.user_id = au.id
    WHERE au.id = ${userIdExpr} AND au.status = 'ACTIVE' AND NOT au.is_system
      AND ar.role = ${ROLE_LITERALS[role]} AND ar.status = 'ACTIVE'
  )`;
}

export interface OwnedStudent {
  studentId: string;
  userId: string;
  /** The account is ACTIVE and holds an ACTIVE STUDENT role. */
  accessActive: boolean;
}

/**
 * SF-2 -- THE resolver for "the learner behind this account". Returns the
 * learner even when access is not active (so a caller can tell "no learner"
 * from "learner, but revoked/suspended"); callers that authorize must read
 * `accessActive`.
 */
export async function resolveOwnedStudent(by: { clerkId: string } | { userId: string }): Promise<OwnedStudent | null> {
  const where = 'clerkId' in by ? 'u.clerk_id = $1' : 'u.id = $1';
  const value = 'clerkId' in by ? by.clerkId : by.userId;
  const result = await db.query(
    `SELECT s.id AS student_id, u.id AS user_id, ${activeRoleSql('u.id', 'STUDENT')} AS access_active
     FROM users u
     JOIN students s ON ${STUDENT_OWNER_MATCH_SQL}
     WHERE ${where} AND NOT u.is_system
     ORDER BY (s.user_id IS NOT NULL) DESC, s.created_at
     LIMIT 1`,
    [value]
  );
  const row = result.rows?.[0];
  if (!row) return null;
  return { studentId: row.student_id, userId: row.user_id, accessActive: row.access_active === true };
}
