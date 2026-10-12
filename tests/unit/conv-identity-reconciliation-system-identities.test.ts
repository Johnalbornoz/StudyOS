/**
 * Clerk <-> StudyUs reconciliation: one semantics on every admin surface.
 *
 * A technical identity (`users.is_system`) exists in StudyUs only, by design. It is never a missing Clerk
 * user, an inconsistency, an orphan, a pending reconciliation action or a "test account" finding -- on the
 * Overview (detectIdentityInconsistencies) and in the Requests inbox (detectSyncErrors, GET /api/admin/requests) alike.
 * A real account missing from Clerk, and a Clerk identity missing from StudyUs, are still detected.
 *
 * The database below is a small world that honours `NOT is_system` in the SQL it is given: a query that
 * forgets the predicate gets the system identities back, and the assertions fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ADMIN = { id: '77235ed8-0000-4000-8000-000000000001', clerk_id: 'user_admin', email: 'operator@studyus.test', status: 'ACTIVE', is_system: false, is_test: false, created_at: new Date('2026-09-01') };
const EDITOR = { id: '4231ca8e-0000-4000-8000-000000000002', clerk_id: 'dev_seed_catalog_editor', email: 'catalog-editor@studyos-dev.test', status: 'ACTIVE', is_system: true, is_test: true, created_at: new Date('2026-09-02') };
const REVIEWER = { id: '4e6546d7-0000-4000-8000-000000000003', clerk_id: 'dev_seed_catalog_reviewer', email: 'catalog-reviewer@studyos-dev.test', status: 'ACTIVE', is_system: true, is_test: true, created_at: new Date('2026-09-03') };
const LOST = { id: 'aaaaaaaa-0000-4000-8000-000000000004', clerk_id: 'user_lost', email: 'lost@example.com', status: 'ACTIVE', is_system: false, is_test: false, created_at: new Date('2026-09-04') };

const h = vi.hoisted(() => ({ users: [] as any[], clerk: [] as any[], clerkDown: false, sql: [] as string[] }));

vi.mock('@/lib/db', () => {
  const query = async (sql: string, params: any[] = []) => {
    h.sql.push(sql);
    if (!/\bFROM users\b/.test(sql)) return { rows: [] };
    let rows = h.users;
    if (/NOT (u\.)?is_system/.test(sql)) rows = rows.filter((u) => !u.is_system);
    if (/u\.id = ANY\(\$1::uuid\[\]\)/.test(sql)) rows = rows.filter((u) => (params[0] as string[]).includes(u.id));
    return { rows: rows.map((u) => ({ ...u, name: null, roles: u === ADMIN ? ['STUDYUS_ADMIN'] : [] })) };
  };
  return { db: { query, connect: vi.fn() }, query };
});
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: {
      getUserList: async () => {
        if (h.clerkDown) throw new Error('clerk unreachable');
        return { data: h.clerk.map((c) => ({ id: c.id, emailAddresses: [{ id: 'e1', emailAddress: c.email }], primaryEmailAddressId: 'e1', createdAt: Date.parse('2026-09-01') })) };
      },
      // the previous inbox probed each account one by one; a system identity then looked "missing"
      getUser: async (id: string) => {
        if (h.clerkDown || !h.clerk.some((c) => c.id === id)) throw new Error('not found');
        return { id };
      },
    },
  }),
  auth: vi.fn(async () => ({ userId: 'user_admin' })),
  currentUser: vi.fn(async () => null),
}));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: vi.fn(async () => {}) }));
vi.mock('@/lib/admin/route-guard', () => ({ guardAdminUsersRoute: async () => ({ admin: { actor: { id: ADMIN.id } } }) }));
vi.mock('@/services/institution.service', () => ({ listAllPendingMembershipsAcrossInstitutions: async () => [], inviteInstitutionAdmin: vi.fn() }));

import { detectIdentityInconsistencies } from '@/services/identity-reconciliation.service';
import { detectSyncErrors } from '@/services/user-admin.service';
import { GET as requestsGET } from '@/app/api/admin/requests/route';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const inbox = async () => (await ((await (requestsGET as any)({} as any)) as any).json()).data;

beforeEach(() => {
  h.users = [ADMIN, EDITOR, REVIEWER];
  h.clerk = [{ id: 'user_admin', email: 'operator@studyus.test' }];
  h.clerkDown = false;
  h.sql = [];
});

describe('the DEV state after the reset: one Admin in both, two system identities in StudyUs only', () => {
  it('1 + 4. system identities are not inconsistencies; the Admin is matched (Overview)', async () => {
    const report = await detectIdentityInconsistencies();
    expect(report).toMatchObject({ clerkReachable: true, humanDbUsers: 1, clerkUsers: 1, items: [] });
  });

  it('1 + 6. system identities are not listed, and so never labelled a test account (Requests)', async () => {
    const result = await detectSyncErrors(50);
    expect(result).toEqual({ usersWithoutClerkMatch: [], accounts: [], clerkReachable: true });
    const data = await inbox();
    expect(data.syncErrors).toEqual([]);
    expect(data.syncAccounts).toEqual([]);
    expect(data.syncVerified).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/catalog-(editor|reviewer)|studyos-dev\.test/);
  });
});

describe('real inconsistencies are still detected', () => {
  it('2. an ACTIVE non-system account with no Clerk user is an inconsistency, on both surfaces', async () => {
    h.users = [ADMIN, EDITOR, REVIEWER, LOST];
    const report = await detectIdentityInconsistencies();
    expect(report.items).toEqual([expect.objectContaining({ kind: 'DB_WITHOUT_CLERK', userId: LOST.id, status: 'ACTIVE' })]);
    const result = await detectSyncErrors(50);
    expect(result.usersWithoutClerkMatch).toEqual([LOST.id]);
    expect(result.accounts).toEqual([expect.objectContaining({ userId: LOST.id, email: 'lost@example.com', status: 'ACTIVE', isTest: false })]);
  });

  it('3. a Clerk user with no StudyUs account is an inconsistency (Overview); the inbox lists StudyUs accounts only', async () => {
    h.clerk = [...h.clerk, { id: 'user_stray', email: 'stray@example.com' }];
    const report = await detectIdentityInconsistencies();
    expect(report.items).toEqual([expect.objectContaining({ kind: 'CLERK_WITHOUT_DB', userId: null })]);
    expect((await detectSyncErrors(50)).usersWithoutClerkMatch).toEqual([]);
  });
});

describe('5. the Overview and the Requests inbox cannot disagree', () => {
  it('for any mix of accounts, the inbox lists exactly the Overview\'s StudyUs-without-Clerk accounts', async () => {
    const worlds: Array<{ users: any[]; clerk: any[] }> = [
      { users: [ADMIN, EDITOR, REVIEWER], clerk: [{ id: 'user_admin', email: 'a' }] },
      { users: [ADMIN, EDITOR, REVIEWER, LOST], clerk: [{ id: 'user_admin', email: 'a' }] },
      { users: [ADMIN, EDITOR, REVIEWER, LOST], clerk: [{ id: 'user_admin', email: 'a' }, { id: 'user_lost', email: 'l' }, { id: 'user_stray', email: 's' }] },
      { users: [EDITOR, REVIEWER], clerk: [] },
      { users: [ADMIN, LOST], clerk: [] },
    ];
    for (const w of worlds) {
      h.users = w.users; h.clerk = w.clerk;
      const overview = (await detectIdentityInconsistencies()).items.filter((i) => i.kind === 'DB_WITHOUT_CLERK').map((i) => i.userId).sort();
      const requests = [...(await detectSyncErrors(50)).usersWithoutClerkMatch].sort();
      expect(requests).toEqual(overview);
      expect(requests).not.toContain(EDITOR.id);
      expect(requests).not.toContain(REVIEWER.id);
    }
  });

  it('the inbox has no detector of its own: it calls the canonical reconciliation and probes no account one by one', () => {
    const svc = read('src/services/user-admin.service.ts');
    const fn = svc.slice(svc.indexOf('export async function detectSyncErrors('), svc.indexOf('export async function reconcileSyncError('));
    expect(fn).toMatch(/await detectIdentityInconsistencies\(\)/);
    expect(fn).not.toMatch(/users\.getUser\(/);
    expect(fn).not.toMatch(/SELECT id, clerk_id FROM users/);
    expect(fn).toMatch(/AND NOT u\.is_system/);
    // the rule is the explicit flag, not an email domain or a Clerk id prefix
    expect(fn).not.toMatch(/studyos-dev\.test|system:|dev_seed/);
    expect(read('src/services/identity-reconciliation.service.ts')).toMatch(/FROM users WHERE NOT is_system/);
  });

  it('every query the two surfaces send for accounts excludes system identities', async () => {
    h.users = [ADMIN, EDITOR, REVIEWER, LOST];
    await detectIdentityInconsistencies();
    await detectSyncErrors(50);
    const userQueries = h.sql.filter((s) => /\bFROM users\b/.test(s));
    expect(userQueries.length).toBeGreaterThan(0);
    for (const s of userQueries) expect(s).toMatch(/NOT (u\.)?is_system/);
  });
});

describe('Clerk unreachable is "not verified", never "everything is missing" and never "0 inconsistencies"', () => {
  it('neither surface reports an account as missing, and both say the check did not run', async () => {
    h.users = [ADMIN, EDITOR, REVIEWER, LOST];
    h.clerkDown = true;
    expect(await detectIdentityInconsistencies()).toMatchObject({ clerkReachable: false, items: [] });
    expect(await detectSyncErrors(50)).toEqual({ usersWithoutClerkMatch: [], accounts: [], clerkReachable: false });
    expect((await inbox()).syncVerified).toBe(false);
    expect(read('src/app/dashboard/admin/requests/RequestsInbox.tsx')).toMatch(/data\.syncVerified === false \?/);
  });
});
