/**
 * L10 SF-1 (L4-12, CR-L4-08) -- the database account status as an API gate.
 *
 * Until now `users.status` was read by the dashboard layout only. On the API
 * a suspension worked solely through the Clerk ban; if the ban was missing
 * (a partial failure in `suspendUser`, a ban lifted in the Clerk dashboard,
 * a manual edit) every non-admin API kept working for a SUSPENDED account.
 *
 * API routes authenticate through four different entry points (`verifyAuth`,
 * `requireActor`, `auth()` directly, and per-area helpers), so there is no
 * single helper every route passes through. The proxy is the one place
 * every request does pass, and it already runs on the Node.js runtime with
 * database access (the Student onboarding gate). The gate therefore lives
 * there: one indexed read per authenticated API request.
 *
 *  - Not ACTIVE  => 403 ACCOUNT_NOT_ACTIVE, before the route runs.
 *  - No row yet  => let through (a new account is provisioned by the first
 *                   identity-aware route; there is nothing to suspend).
 *  - Lookup fails => 503 ACCOUNT_STATUS_UNAVAILABLE. Fails CLOSED: a request
 *                   whose account status cannot be read is not served.
 *
 * The shared guards (`requireActor`, `requireStudentId`, the SQL predicates
 * in ./access-predicates) check the same status again, so a route is still
 * protected if it is ever reached without the proxy.
 */
import { db } from '@/lib/db';

/** Not behind a user session: webhooks are signature/secret-verified, internal routes require CRON_SECRET, health/version are public. */
const UNGATED_API_PREFIXES = ['/api/webhooks', '/api/internal', '/api/health', '/api/version'];

export function isAccountGatedApiPath(pathname: string): boolean {
  if (!(pathname === '/api' || pathname.startsWith('/api/'))) return false;
  return !UNGATED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type AccountGateDecision = { allow: true } | { allow: false; status: 403 | 503; error: 'ACCOUNT_NOT_ACTIVE' | 'ACCOUNT_STATUS_UNAVAILABLE' };

export function decideAccountGate(accountStatus: string | null | undefined): AccountGateDecision {
  if (accountStatus === null || accountStatus === undefined) return { allow: true };
  if (accountStatus === 'ACTIVE') return { allow: true };
  return { allow: false, status: 403, error: 'ACCOUNT_NOT_ACTIVE' };
}

/** The stored status of this Clerk identity's account, or null when no account row exists yet. Read-only. */
export async function loadAccountStatus(clerkUserId: string): Promise<string | null> {
  const result = await db.query(`SELECT status FROM users WHERE clerk_id = $1 AND NOT is_system LIMIT 1`, [clerkUserId]);
  return result.rows?.[0]?.status ?? null;
}

export async function evaluateAccountGate(clerkUserId: string): Promise<AccountGateDecision> {
  try {
    return decideAccountGate(await loadAccountStatus(clerkUserId));
  } catch (error) {
    console.error('[proxy] account status lookup failed', error instanceof Error ? error.message : error);
    return { allow: false, status: 503, error: 'ACCOUNT_STATUS_UNAVAILABLE' };
  }
}
