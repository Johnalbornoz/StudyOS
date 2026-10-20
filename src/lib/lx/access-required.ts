/**
 * L6 / CR-L11-02 -- how a Student instructional surface recognises the
 * licence gate.
 *
 * The server is the only authority (L11's shared gate in
 * `src/lib/entitlements/learning-gate.ts`). A surface never decides access
 * itself and never blocks a request up front: it sends the request as it
 * always did and, only when the answer is exactly
 *
 *     403  { "error": "ENTITLEMENT_REQUIRED" }
 *
 * shows the access-required state (`AccessRequiredNotice`) instead of its
 * generic error. Every other answer -- another 403, a 423, a 5xx, a network
 * failure, a success -- keeps the surface's existing behaviour. That is also
 * what lets an attempt the server still allows (one started while access was
 * valid) continue normally.
 */
import { LICENSE_CTA_PATH } from '@/lib/lx/session-launch-outcome';

export function isEntitlementRequired(status: number | null | undefined, body: unknown): boolean {
  if (status !== 403 || !body || typeof body !== 'object') return false;
  return (body as { error?: unknown }).error === 'ENTITLEMENT_REQUIRED';
}

/** For surfaces that otherwise ignore the body of a failed response. Never throws. */
export async function responseIsEntitlementRequired(res: { status: number; json: () => Promise<unknown> }): Promise<boolean> {
  if (res.status !== 403) return false;
  const body = await res.json().catch(() => null);
  return isEntitlementRequired(res.status, body);
}

/** Where the Student sees their own access: the existing billing page, same destination as the session-launch licence state. */
export const ACCESS_CTA_PATH = LICENSE_CTA_PATH;
