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
import { resolveVerifiedPrimaryEmail, type ClerkEmailIdentity } from '@/lib/identity/verified-email';

// L10 SF-6: the resolver itself lives in src/lib/identity/verified-email.ts (one
// rule for admin decisions and for invitation matching). Re-exported so every
// existing admin import keeps working.
export { resolveVerifiedPrimaryEmail, type ClerkEmailIdentity };

/** True only for a Clerk user whose VERIFIED PRIMARY email is on the platform-admin allowlist. */
export function isAllowlistedAdminUser(user: ClerkEmailIdentity | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return isAdminEmail(resolveVerifiedPrimaryEmail(user), env);
}
