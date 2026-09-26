/**
 * A01-LOGIC-02 -- Clerk ↔ StudyOS identity reconciliation.
 *
 * Detects, in BOTH directions:
 *   - DB_WITHOUT_CLERK: a human `users` row whose `clerk_id` has no Clerk
 *     account (the person can never sign in; any data hanging off the
 *     row is orphaned);
 *   - CLERK_WITHOUT_DB: a Clerk account with no `users` row (signed up
 *     but never reached the app, or its StudyOS row was removed).
 *
 * Detection only: nothing here deletes, links or repairs an identity.
 * Technical identities (`users.is_system`) have no Clerk account by
 * design and are excluded. Emails are masked before leaving the server.
 */
import { clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { maskEmail } from '@/lib/admin/mask';

export type IdentityInconsistencyKind = 'DB_WITHOUT_CLERK' | 'CLERK_WITHOUT_DB';

export interface IdentityInconsistency {
  kind: IdentityInconsistencyKind;
  /** StudyOS user id -- present for DB_WITHOUT_CLERK only. */
  userId: string | null;
  emailMasked: string;
  /** StudyOS account status for DB_WITHOUT_CLERK; null for CLERK_WITHOUT_DB. */
  status: string | null;
  createdAt: string | null;
}

export interface DbIdentity {
  id: string;
  clerkId: string;
  email: string | null;
  status: string;
  createdAt: string | null;
}

export interface ClerkIdentity {
  id: string;
  email: string | null;
  createdAt: string | null;
}

/** Pure: the set difference in both directions, keyed by Clerk user id. */
export function classifyIdentityInconsistencies(dbUsers: DbIdentity[], clerkUsers: ClerkIdentity[]): IdentityInconsistency[] {
  const clerkIds = new Set(clerkUsers.map((c) => c.id));
  const dbClerkIds = new Set(dbUsers.map((u) => u.clerkId));

  const dbWithoutClerk: IdentityInconsistency[] = dbUsers
    .filter((u) => !clerkIds.has(u.clerkId))
    .map((u) => ({ kind: 'DB_WITHOUT_CLERK', userId: u.id, emailMasked: maskEmail(u.email), status: u.status, createdAt: u.createdAt }));

  const clerkWithoutDb: IdentityInconsistency[] = clerkUsers
    .filter((c) => !dbClerkIds.has(c.id))
    .map((c) => ({ kind: 'CLERK_WITHOUT_DB', userId: null, emailMasked: maskEmail(c.email), status: null, createdAt: c.createdAt }));

  return [...dbWithoutClerk, ...clerkWithoutDb];
}

const CLERK_PAGE_SIZE = 500;
const CLERK_MAX_PAGES = 20;

async function listAllClerkIdentities(): Promise<ClerkIdentity[]> {
  const client = await clerkClient();
  const out: ClerkIdentity[] = [];
  for (let page = 0; page < CLERK_MAX_PAGES; page++) {
    const result = await client.users.getUserList({ limit: CLERK_PAGE_SIZE, offset: page * CLERK_PAGE_SIZE });
    for (const u of result.data) {
      const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses[0];
      out.push({ id: u.id, email: primary?.emailAddress ?? null, createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null });
    }
    if (result.data.length < CLERK_PAGE_SIZE) break;
  }
  return out;
}

async function listHumanDbIdentities(): Promise<DbIdentity[]> {
  const result = await db.query(
    `SELECT id, clerk_id, email, status, created_at FROM users WHERE NOT is_system ORDER BY created_at ASC`
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    clerkId: r.clerk_id,
    email: r.email,
    status: r.status,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));
}

export interface IdentityReconciliationReport {
  /** false when Clerk could not be reached -- the result is then unverified, never "0 inconsistencies". */
  clerkReachable: boolean;
  humanDbUsers: number;
  clerkUsers: number | null;
  items: IdentityInconsistency[];
}

export async function detectIdentityInconsistencies(): Promise<IdentityReconciliationReport> {
  const dbUsers = await listHumanDbIdentities();
  let clerkUsers: ClerkIdentity[];
  try {
    clerkUsers = await listAllClerkIdentities();
  } catch {
    return { clerkReachable: false, humanDbUsers: dbUsers.length, clerkUsers: null, items: [] };
  }
  return {
    clerkReachable: true,
    humanDbUsers: dbUsers.length,
    clerkUsers: clerkUsers.length,
    items: classifyIdentityInconsistencies(dbUsers, clerkUsers),
  };
}

/** Clerk ids (from `candidates`) that no longer exist in Clerk; null when Clerk is unreachable. */
export async function findClerkIdsMissingInClerk(candidates: string[]): Promise<Set<string> | null> {
  if (candidates.length === 0) return new Set();
  try {
    const client = await clerkClient();
    const result = await client.users.getUserList({ userId: candidates, limit: candidates.length });
    const present = new Set(result.data.map((u) => u.id));
    return new Set(candidates.filter((id) => !present.has(id)));
  } catch {
    return null;
  }
}
