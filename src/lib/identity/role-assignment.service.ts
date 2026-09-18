import { db } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import type { SelfServiceRole } from './types';

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
 * (ON CONFLICT DO NOTHING) -- never an error, never a duplicate grant.
 *
 * STUDENT is special-cased to also ensure the legacy `students` row
 * exists (`getOrCreateStudentId`, unmodified, existing function) so a
 * newly self-selecting Student gets the exact same downstream
 * behavior (subjects, quizzes, mastery, Canonical V2) a pre-F1 signup
 * already got automatically from the Clerk webhook.
 */
export async function assignSelfServiceRole(
  clerkUserId: string,
  userId: string,
  role: SelfServiceRole
): Promise<void> {
  await db.query(
    `INSERT INTO user_roles (user_id, role, status, granted_via)
     VALUES ($1, $2, 'ACTIVE', 'SELF_REGISTRATION')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [userId, role]
  );

  if (role === 'STUDENT') {
    await getOrCreateStudentId(clerkUserId);
  }
}
