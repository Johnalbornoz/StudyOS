import { db } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import type { SelfServiceRole } from './types';
import { recordAdminAction } from '@/lib/admin/audit';

/**
 * F1 -- THE one place a public/authenticated caller may assign a role
 * to themselves. `role`'s TYPE is `SelfServiceRole` (STUDENT | PARENT |
 * TEACHER only) -- INSTITUTION_ADMIN and STUDYUS_ADMIN are not values
 * this parameter's type can hold, so a privilege-escalation attempt
 * against this function is a compile-time error for any internal
 * caller, not merely a runtime rejection. The API route that exposes
 * this to the network (`/api/identity/roles/select`) independently
 * re-validates with a Zod enum restricted to the same 3 values before
 * ever reaching this function -- defense in depth, never a single
 * point of trust for an untyped network payload (see
 * F1_AUTHORIZATION_BOUNDARY.md).
 *
 * Idempotent: assigning a role the user already holds is a no-op
 * (ON CONFLICT DO NOTHING) -- never an error, never a duplicate grant
 * (outcome 'ALREADY_ACTIVE').
 *
 * STUDENT is special-cased to also ensure the legacy `students` row
 * exists (`getOrCreateStudentId`, unmodified, existing function) so a
 * newly self-selecting Student gets the exact same downstream
 * behavior (subjects, quizzes, mastery, Canonical V2) a pre-F1 signup
 * already got automatically from the Clerk webhook.
 */
export type SelfServiceRoleOutcome = 'GRANTED' | 'ALREADY_ACTIVE' | 'REVOKED';

/**
 * Foundation (multi-role contract, ADR-F01): roles are additive -- holding
 * any role (including STUDYUS_ADMIN) never prevents self-selecting another
 * self-service role. Two refinements over F1:
 *  - a role an administrator REVOKED is never silently re-granted (and no
 *    `students` row is provisioned for it): the outcome is 'REVOKED' and the
 *    route answers 409 instead of a misleading 200;
 *  - a real new grant is audited through the existing admin_audit_log
 *    (ROLE_ADDED, actor = the user themself, reason SELF_SERVICE) -- no
 *    second audit ecosystem. Audit is a record, never a gate: a failed audit
 *    write is logged, it never undoes the grant.
 */
export async function assignSelfServiceRole(
  clerkUserId: string,
  userId: string,
  role: SelfServiceRole
): Promise<SelfServiceRoleOutcome> {
  const inserted = await db.query(
    `INSERT INTO user_roles (user_id, role, status, granted_via)
     VALUES ($1, $2, 'ACTIVE', 'SELF_REGISTRATION')
     ON CONFLICT (user_id, role) DO NOTHING
     RETURNING id`,
    [userId, role]
  );
  let outcome: SelfServiceRoleOutcome = 'ALREADY_ACTIVE';
  if ((inserted.rows?.length ?? 0) > 0) {
    outcome = 'GRANTED';
  } else {
    const existing = await db.query(`SELECT status FROM user_roles WHERE user_id = $1 AND role = $2`, [userId, role]);
    if (existing.rows?.[0]?.status === 'REVOKED') return 'REVOKED';
  }

  if (role === 'STUDENT') {
    await getOrCreateStudentId(clerkUserId);
  }

  if (outcome === 'GRANTED') {
    try {
      await recordAdminAction({
        actorUserId: userId,
        action: 'ROLE_ADDED',
        targetType: 'ROLE',
        targetId: userId,
        newState: { role, status: 'ACTIVE', grantedVia: 'SELF_REGISTRATION' },
        reason: 'SELF_SERVICE',
      });
    } catch (error) {
      console.error('[identity] role grant audit write failed', error instanceof Error ? error.message : error);
    }
  }
  return outcome;
}
