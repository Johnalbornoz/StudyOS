import { db } from '@/lib/db';

/**
 * L10 SF-8 -- the carrier for PARENT and TEACHER onboarding
 * (`user_role_onboarding`, migration 20261120_1300). The screens are built
 * by the role lanes (PA-4, TE-5); they read and write onboarding state only
 * through these functions.
 *
 * Decision D-4 (which fields each role fills in) is not ruled. `profile` is
 * therefore an opaque JSON object here: this module stores it and reports
 * completion; validating its shape belongs to whoever implements D-4.
 *
 * `userId` is always the canonical `users.id` the caller resolved from the
 * authenticated session -- never a client-supplied id.
 */
export type OnboardingRole = 'PARENT' | 'TEACHER';

export interface RoleOnboardingState {
  role: OnboardingRole;
  started: boolean;
  completed: boolean;
  completedAt: string | null;
  profile: Record<string, unknown>;
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

export async function getRoleOnboarding(userId: string, role: OnboardingRole): Promise<RoleOnboardingState> {
  const result = await db.query(`SELECT profile, completed_at FROM user_role_onboarding WHERE user_id = $1 AND role = $2`, [userId, role]);
  const row = result.rows?.[0];
  if (!row) return { role, started: false, completed: false, completedAt: null, profile: {} };
  return { role, started: true, completed: row.completed_at !== null && row.completed_at !== undefined, completedAt: iso(row.completed_at), profile: row.profile ?? {} };
}

/** Saves progress without completing. Never clears a completion already recorded. */
export async function saveRoleOnboardingProfile(userId: string, role: OnboardingRole, profile: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO user_role_onboarding (user_id, role, profile) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, role) DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()`,
    [userId, role, JSON.stringify(profile ?? {})]
  );
}

/**
 * Marks the role's onboarding complete, once. Requires the account to hold
 * that role ACTIVE (onboarding for a role the account does not hold is
 * refused). Idempotent: completing again keeps the original `completed_at`.
 * Returns false when refused.
 */
export async function completeRoleOnboarding(userId: string, role: OnboardingRole, profile?: Record<string, unknown>): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO user_role_onboarding (user_id, role, profile, completed_at)
     SELECT $1, $2, $3::jsonb, NOW()
     WHERE EXISTS (SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
                   WHERE r.user_id = $1 AND r.role = $2 AND r.status = 'ACTIVE' AND u.status = 'ACTIVE')
     ON CONFLICT (user_id, role) DO UPDATE
       SET profile = CASE WHEN $4::boolean THEN EXCLUDED.profile ELSE user_role_onboarding.profile END,
           completed_at = COALESCE(user_role_onboarding.completed_at, NOW()),
           updated_at = NOW()
     RETURNING user_id`,
    [userId, role, JSON.stringify(profile ?? {}), profile !== undefined]
  );
  return (result.rows?.length ?? 0) > 0;
}
