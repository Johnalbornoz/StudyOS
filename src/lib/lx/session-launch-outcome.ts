/**
 * How StartSessionButton reacts to POST /api/learning/session/start.
 * Pure, so the CTA/API contract is testable: a licence refusal is a
 * distinct, explained state ("activate a licence"), never the generic
 * "try again" -- retrying cannot succeed until the licence changes.
 */
export type SessionLaunchOutcome =
  | { kind: 'LAUNCH'; target: string }
  | { kind: 'LICENSE_REQUIRED' }
  | { kind: 'UNAVAILABLE' };

export function classifySessionLaunch(status: number, body: unknown): SessionLaunchOutcome {
  const b = (body ?? {}) as { error?: unknown; data?: { session?: { launchStatus?: unknown; launchTarget?: unknown } } };
  if (status === 403 && b.error === 'ENTITLEMENT_REQUIRED') return { kind: 'LICENSE_REQUIRED' };
  const session = b.data?.session;
  if (status >= 200 && status < 300 && session?.launchStatus === 'READY' && typeof session.launchTarget === 'string' && session.launchTarget.length > 0) {
    return { kind: 'LAUNCH', target: session.launchTarget };
  }
  return { kind: 'UNAVAILABLE' };
}

/** Where the licence CTA leads (existing billing page). */
export const LICENSE_CTA_PATH = '/dashboard/billing';
