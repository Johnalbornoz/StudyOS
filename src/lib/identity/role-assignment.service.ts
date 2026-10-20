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
export type SelfServiceRoleOutcome = 'GRANTED' | 'ALREADY_ACTIVE' | 'REVOKED' | 'PERSONA_EXISTS';

/**
 * Track A product amendment (2026-10-01): ONE primary persona per account.
 *
 *  - An account with no persona may select exactly one (STUDENT / PARENT /
 *    TEACHER). Holding a CAPABILITY (INSTITUTION_ADMIN, STUDYUS_ADMIN) does
 *    not count -- a capability-only account can still choose its persona.
 *  - Re-selecting the persona the account already holds is a no-op
 *    ('ALREADY_ACTIVE').
 *  - Selecting a DIFFERENT persona is refused ('PERSONA_EXISTS') -- never an
 *    additive second persona. Changing persona is a deliberate
 *    account-management flow, not self-service.
 *  - A persona an administrator REVOKED is never re-granted ('REVOKED'), and
 *    a revoked persona still counts as the account's persona (it cannot be
 *    replaced by self-service either).
 * The check and the write run in one transaction serialized on the user's
 * row (SELECT ... FOR UPDATE), so two concurrent selections cannot both win.
 * A real grant is audited (ROLE_ADDED, SELF_SERVICE) -- audit is a record,
 * never a gate.
 */
export async function assignSelfServiceRole(
  clerkUserId: string,
  userId: string,
  role: SelfServiceRole
): Promise<SelfServiceRoleOutcome> {
  const client = await db.connect();
  let outcome: SelfServiceRoleOutcome;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const personas = await client.query(
      `SELECT role, status FROM user_roles WHERE user_id = $1 AND role IN ('STUDENT', 'PARENT', 'TEACHER')`,
      [userId]
    );
    const same = personas.rows.find((r: any) => r.role === role);
    if (same?.status === 'REVOKED') outcome = 'REVOKED';
    else if (same?.status === 'ACTIVE') outcome = 'ALREADY_ACTIVE';
    else if (personas.rows.length > 0) outcome = 'PERSONA_EXISTS';
    else {
      await client.query(
        `INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, $2, 'ACTIVE', 'SELF_REGISTRATION')
         ON CONFLICT (user_id, role) DO NOTHING`,
        [userId, role]
      );
      outcome = 'GRANTED';
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (outcome === 'REVOKED' || outcome === 'PERSONA_EXISTS') return outcome;

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
