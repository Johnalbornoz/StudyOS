/**
 * THE one place a Clerk user is turned into "the email this account is
 * authorized by". Introduced by L4-R1 for platform-admin decisions
 * (src/lib/admin/admin-identity.ts, which now re-exports it); moved here by
 * L10 SF-6 because invitation matching needs the same rule and must not
 * depend on the admin module.
 *
 * Clerk does not guarantee that `emailAddresses[0]` is the primary address:
 * a later-added, unverified secondary address can sit at index 0 while the
 * verified primary sits elsewhere. So the email is resolved strictly:
 *
 *   primaryEmailAddressId -> the emailAddresses entry with that exact id
 *   -> its verification status must be 'verified' -> trim + lowercase.
 *
 * Never index 0, never a secondary address, never an unverified one. Any
 * step that does not resolve yields null, and null matches nothing.
 */

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
