/**
 * Track A -- resolves WHO an account is (display name + email) for admin and
 * institution review screens, server-side only. Callers pass user ids they
 * have ALREADY authorized the viewer to see (e.g. pending memberships of the
 * viewer's own institution); this module never decides access and never
 * accepts identity data from the client.
 *
 * Name sources, in order: the account's own StudyUs records (student name,
 * profile full name), then its Clerk profile (teachers have no StudyUs
 * profile row), else null -- the UI then shows the email alone. A Clerk
 * failure never blocks rendering.
 */
import { clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

export interface DisplayIdentity {
  name: string | null;
  email: string | null;
}

export async function resolveDisplayIdentities(userIds: readonly string[]): Promise<Map<string, DisplayIdentity>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, DisplayIdentity>();
  if (ids.length === 0) return out;

  const rows = await db.query(
    `SELECT u.id, u.email, u.clerk_id,
            NULLIF(TRIM(COALESCE(
              (SELECT s.name FROM students s WHERE s.user_id = u.id ORDER BY s.created_at ASC NULLS LAST LIMIT 1),
              (SELECT p.full_name FROM profiles p WHERE p.user_id = u.id AND p.full_name IS NOT NULL ORDER BY p.created_at ASC LIMIT 1)
            )), '') AS name
     FROM users u WHERE u.id = ANY($1::uuid[])`,
    [ids]
  );
  const missingName: Array<{ id: string; clerkId: string }> = [];
  for (const r of rows.rows) {
    out.set(r.id, { name: r.name ?? null, email: r.email ?? null });
    if (!r.name && r.clerk_id) missingName.push({ id: r.id, clerkId: r.clerk_id });
  }

  if (missingName.length > 0) {
    try {
      const client = await clerkClient();
      const list = await client.users.getUserList({ userId: missingName.map((m) => m.clerkId), limit: missingName.length });
      const byClerk = new Map(list.data.map((u: any) => [u.id, u]));
      for (const m of missingName) {
        const u: any = byClerk.get(m.clerkId);
        const name = u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '';
        const prev = out.get(m.id)!;
        out.set(m.id, {
          name: name || null,
          email: prev.email ?? u?.primaryEmailAddress?.emailAddress ?? u?.emailAddresses?.[0]?.emailAddress ?? null,
        });
      }
    } catch (error) {
      console.error('[display-identity] Clerk lookup failed; showing email only', (error as Error)?.message);
    }
  }
  return out;
}

/** "Nombre · email", or the email alone when there is no name (never an internal id). */
export function formatIdentity(identity: DisplayIdentity | undefined, fallback = '—'): string {
  if (!identity) return fallback;
  if (identity.name && identity.email) return `${identity.name} · ${identity.email}`;
  return identity.name ?? identity.email ?? fallback;
}
