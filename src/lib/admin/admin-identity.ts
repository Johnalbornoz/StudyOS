/**
 * L4-R1 -- THE one place a Clerk user is turned into "the email this account
 * is authorized by" for platform-admin decisions.
 *
 * Clerk does not guarantee that `emailAddresses[0]` is the primary address:
 * a later-added, unverified secondary address can sit at index 0 while the
 * verified primary sits elsewhere. So the email is resolved strictly:
 *
 *   primaryEmailAddressId -> the emailAddresses entry with that exact id
 *   -> its verification status must be 'verified' -> trim + lowercase.
 *
 * Never index 0, never a secondary address, never an unverified one. Any
 * step that does not resolve yields null, and null is never an admin.
 *
 * This does not replace the allowlist (`isAdminEmail`) or the canonical
 * STUDYUS_ADMIN gate (`requireStudyUSAdmin`); it only decides WHICH email
 * those checks are allowed to look at.
 */
import { isAdminEmail } from '@/services/admin.service';

/** The subset of a Clerk backend `User` this module reads (structural, so tests need no Clerk object). */
export interface ClerkEmailIdentity {
  primaryEmailAddressId?: string | null;
  emailAddresses?: ReadonlyArray<{
    id?: string | null;
    emailAddress?: string | null;
    verification?: { status?: string | null } | null;
  }> | null;
}

export function resolveVerifiedPrimaryEmail(user: ClerkEmailIdentity | null | undefined): string | null {
  const primaryId = user?.primaryEmailAddressId;
  if (!primaryId) return null;
  const primary = (user?.emailAddresses ?? []).find((e) => e?.id === primaryId);
  if (!primary) return null;
  if (primary.verification?.status !== 'verified') return null;
  const email = (primary.emailAddress ?? '').trim().toLowerCase();
  return email || null;
}

/** True only for a Clerk user whose VERIFIED PRIMARY email is on the platform-admin allowlist. */
export function isAllowlistedAdminUser(user: ClerkEmailIdentity | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return isAdminEmail(resolveVerifiedPrimaryEmail(user), env);
}
