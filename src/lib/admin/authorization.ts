/**
 * Fase 2A -- the canonical gate for the global user-administration
 * surface. `STUDYUS_ADMIN` (F1's own declared role) was never actually
 * granted to anyone before this phase -- the only existing admin
 * mechanism was `isAdminEmail` (`src/services/admin.service.ts`), a
 * hardcoded single-entry allowlist with no `user_roles` backing.
 *
 * This module makes `STUDYUS_ADMIN` real without weakening the
 * existing protection: `requireStudyUSAdmin` self-heals exactly once,
 * lazily, ONLY for an account whose email is already on the existing
 * `isAdminEmail` allowlist -- the same trusted source of truth this
 * program has used since before F1, never a new one. Every actual
 * authorization decision this phase makes checks `hasRole(...,
 * 'STUDYUS_ADMIN')`, never `isAdminEmail` alone (INV-ADMIN2A-01) --
 * `isAdminEmail` is consulted only to bootstrap the very first grant,
 * and is also re-checked as a redundant, fail-closed second gate on
 * every call (INV-ADMIN2A-02): if the two ever disagree, access is
 * denied. No self-service path, and no route added by this phase,
 * can grant STUDYUS_ADMIN -- the only way this role is ever created is
 * this bootstrap, which can only ever match the one pre-existing
 * allowlisted email.
 */
import { currentUser } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { isAdminEmail } from '@/services/admin.service';
import { getOrCreateCanonicalUser, hasRole, type CanonicalUser } from '@/lib/identity';

async function bootstrapStudyUSAdminIfEligible(user: CanonicalUser, email: string | null): Promise<void> {
  if (!isAdminEmail(email)) return;
  const already = await hasRole(user.id, 'STUDYUS_ADMIN');
  if (already) return;
  await db.query(
    `INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'STUDYUS_ADMIN', 'ACTIVE', 'BACKFILL')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [user.id]
  );
}

export interface StudyUSAdminContext {
  actor: CanonicalUser;
  email: string | null;
}

/**
 * Resolves the caller as an active STUDYUS_ADMIN, or returns null.
 * Fails closed on every branch: no Clerk session, a suspended/archived
 * account, no active STUDYUS_ADMIN role, or a mismatch with
 * `isAdminEmail` (defense in depth -- this should never happen in
 * practice since only that allowlist can ever cause the role to be
 * granted, but a divergence, e.g. from a future manual DB edit, must
 * deny rather than trust the role row alone).
 */
export async function requireStudyUSAdmin(clerkUserId: string | null | undefined): Promise<StudyUSAdminContext | null> {
  if (!clerkUserId) return null;
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;

  const actor = await getOrCreateCanonicalUser(clerkUserId, email);
  if (actor.status !== 'ACTIVE') return null;

  await bootstrapStudyUSAdminIfEligible(actor, email);

  const [hasAdminRole, allowlisted] = await Promise.all([
    hasRole(actor.id, 'STUDYUS_ADMIN'),
    Promise.resolve(isAdminEmail(email)),
  ]);
  if (!hasAdminRole || !allowlisted) return null;

  return { actor, email };
}

/** Active STUDYUS_ADMIN count -- used to block the last admin from removing their own access. */
export async function countActiveStudyUSAdmins(): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*)::int AS c FROM user_roles WHERE role = 'STUDYUS_ADMIN' AND status = 'ACTIVE'`
  );
  return result.rows[0]?.c ?? 0;
}
