/**
 * L4-R1 -- platform-admin authorization resolves the VERIFIED PRIMARY email.
 *
 * Clerk does not guarantee that emailAddresses[0] is the primary address
 * (validated manually on Stage: an unverified secondary sat at index 0 while
 * the verified primary was elsewhere). These tests pin the resolution rule,
 * one migrated route end to end, and -- by reading the source tree -- that no
 * admin route or admin page can fall back to index 0 again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const currentUserMock = vi.fn();
const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  currentUser: () => currentUserMock(),
  auth: () => authMock(),
  clerkClient: vi.fn(),
}));

const adminForceDeleteConceptMock = vi.fn();
vi.mock('@/services/admin.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/admin.service')>()),
  adminForceDeleteConcept: (...a: any[]) => adminForceDeleteConceptMock(...a),
}));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() } }));

import { resolveVerifiedPrimaryEmail, isAllowlistedAdminUser } from '@/lib/admin/admin-identity';
import { DELETE as deleteConcept } from '@/app/api/admin/concepts/[id]/route';

const ADMIN = 'john@jalbornoz.com';
const OTHER = 'someone-else@example.com';
const PROD_ENV = { CLERK_SECRET_KEY: 'sk_live_x', VERCEL: '1', VERCEL_ENV: 'production' };

const entry = (id: string, emailAddress: string, status: string | null = 'verified') => ({
  id,
  emailAddress,
  verification: status === null ? null : { status },
});

describe('resolveVerifiedPrimaryEmail / isAllowlistedAdminUser', () => {
  it('primary at index 0 => works', () => {
    const user = { primaryEmailAddressId: 'e1', emailAddresses: [entry('e1', ADMIN)] };
    expect(resolveVerifiedPrimaryEmail(user)).toBe(ADMIN);
    expect(isAllowlistedAdminUser(user, PROD_ENV)).toBe(true);
  });

  it('unverified secondary at index 0 + verified primary at index 1 => the primary governs', () => {
    // The exact shape observed on Stage. An allowlisted address parked at index 0 grants nothing...
    const attacker = { primaryEmailAddressId: 'e2', emailAddresses: [entry('e1', ADMIN, 'unverified'), entry('e2', OTHER)] };
    expect(resolveVerifiedPrimaryEmail(attacker)).toBe(OTHER);
    expect(isAllowlistedAdminUser(attacker, PROD_ENV)).toBe(false);
    // ...and a real admin is not locked out by an unrelated address at index 0.
    const admin = { primaryEmailAddressId: 'e2', emailAddresses: [entry('e1', OTHER, 'unverified'), entry('e2', ADMIN)] };
    expect(resolveVerifiedPrimaryEmail(admin)).toBe(ADMIN);
    expect(isAllowlistedAdminUser(admin, PROD_ENV)).toBe(true);
  });

  it('verified secondary at index 0 + verified primary at index 1 => the primary governs', () => {
    const attacker = { primaryEmailAddressId: 'e2', emailAddresses: [entry('e1', ADMIN), entry('e2', OTHER)] };
    expect(resolveVerifiedPrimaryEmail(attacker)).toBe(OTHER);
    expect(isAllowlistedAdminUser(attacker, PROD_ENV)).toBe(false);
    const admin = { primaryEmailAddressId: 'e2', emailAddresses: [entry('e1', OTHER), entry('e2', ADMIN)] };
    expect(isAllowlistedAdminUser(admin, PROD_ENV)).toBe(true);
  });

  it('unresolved primary id => deny (never a fallback to index 0)', () => {
    for (const primaryEmailAddressId of [null, undefined, '', 'e-missing']) {
      const user = { primaryEmailAddressId, emailAddresses: [entry('e1', ADMIN)] };
      expect(resolveVerifiedPrimaryEmail(user)).toBeNull();
      expect(isAllowlistedAdminUser(user, PROD_ENV)).toBe(false);
    }
    expect(isAllowlistedAdminUser(null, PROD_ENV)).toBe(false);
    expect(isAllowlistedAdminUser({ primaryEmailAddressId: 'e1', emailAddresses: [] }, PROD_ENV)).toBe(false);
    expect(isAllowlistedAdminUser({ primaryEmailAddressId: 'e1' }, PROD_ENV)).toBe(false);
  });

  it('unverified primary => deny', () => {
    for (const status of ['unverified', 'expired', 'failed', 'transferable', null]) {
      const user = { primaryEmailAddressId: 'e1', emailAddresses: [entry('e1', ADMIN, status)] };
      expect(resolveVerifiedPrimaryEmail(user)).toBeNull();
      expect(isAllowlistedAdminUser(user, PROD_ENV)).toBe(false);
    }
  });

  it('non-allowlisted primary => deny', () => {
    expect(isAllowlistedAdminUser({ primaryEmailAddressId: 'e1', emailAddresses: [entry('e1', OTHER)] }, PROD_ENV)).toBe(false);
  });

  it('allowlisted verified primary => allow, canonicalized (trim + lowercase)', () => {
    const user = { primaryEmailAddressId: 'e1', emailAddresses: [entry('e1', '  John@JAlbornoz.com ')] };
    expect(resolveVerifiedPrimaryEmail(user)).toBe(ADMIN);
    expect(isAllowlistedAdminUser(user, PROD_ENV)).toBe(true);
  });
});

describe('a migrated admin route (DELETE /api/admin/concepts/[id])', () => {
  const call = () => deleteConcept({} as any, { params: Promise.resolve({ id: 'c-1' }) });
  beforeEach(() => {
    adminForceDeleteConceptMock.mockReset().mockResolvedValue(undefined);
    authMock.mockReset().mockResolvedValue({ userId: 'clerk-1' });
  });

  it('denies an account whose only link to the allowlist is a secondary address at index 0', async () => {
    currentUserMock.mockResolvedValue({ id: 'clerk-1', primaryEmailAddressId: 'e2', emailAddresses: [entry('e1', ADMIN, 'unverified'), entry('e2', OTHER)] });
    const res: any = await call();
    expect(res.status).toBe(403);
    expect(adminForceDeleteConceptMock).not.toHaveBeenCalled();
  });

  it('denies an unverified allowlisted primary and an anonymous caller', async () => {
    currentUserMock.mockResolvedValue({ id: 'clerk-1', primaryEmailAddressId: 'e1', emailAddresses: [entry('e1', ADMIN, 'unverified')] });
    expect(((await call()) as any).status).toBe(403);
    currentUserMock.mockResolvedValue(null);
    expect(((await call()) as any).status).toBe(403);
    expect(adminForceDeleteConceptMock).not.toHaveBeenCalled();
  });

  it('allows the verified allowlisted primary wherever it sits in the list', async () => {
    currentUserMock.mockResolvedValue({ id: 'clerk-1', primaryEmailAddressId: 'e2', emailAddresses: [entry('e1', OTHER, 'unverified'), entry('e2', ADMIN)] });
    const res: any = await call();
    expect(res.status).toBe(200);
    expect(adminForceDeleteConceptMock).toHaveBeenCalledWith('c-1');
  });
});

// ---------------------------------------------------------------------
// Source guards: route coverage of the one helper.
// ---------------------------------------------------------------------
const ROOT = join(__dirname, '..', '..');
function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, match) : match(name) ? [full] : [];
  });
}
/** Code only: block and line comments removed, so prose may still name the old pattern. */
const code = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const rel = (file: string) => file.slice(ROOT.length + 1);

const INDEX_ZERO = /emailAddresses\s*(\?\.)?\s*\[\s*0\s*\]/;
const adminRoutes = walk(join(ROOT, 'src/app/api/admin'), (n) => n === 'route.ts');
const adminPages = walk(join(ROOT, 'src/app/dashboard/admin'), (n) => n === 'page.tsx');
const adminLib = walk(join(ROOT, 'src/lib/admin'), (n) => n.endsWith('.ts'));

describe('ADMIN_ROUTE_HELPER_COVERAGE', () => {
  it('every /api/admin route authorizes through the canonical guard or the verified-primary helper', () => {
    const strong = adminRoutes.filter((f) => /guardAdminUsersRoute\(/.test(code(f)));
    const helper = adminRoutes.filter((f) => /isAllowlistedAdminUser\(/.test(code(f)));
    const uncovered = adminRoutes.filter((f) => !strong.includes(f) && !helper.includes(f)).map(rel);
    expect(uncovered).toEqual([]);
    // L10 SF-7 added one route on the canonical guard (admin/parent-relationships/end): 52 + 36 = 88.
    expect(adminRoutes.length).toBe(88);
    expect(strong.length).toBe(52);
    expect(helper.length).toBe(36);
  });

  it('no admin route, admin page or admin library reads emailAddresses[0] or calls isAdminEmail directly', () => {
    const allowedDirect = ['src/lib/admin/admin-identity.ts', 'src/lib/admin/authorization.ts'];
    const indexZero = [...adminRoutes, ...adminPages, ...adminLib].filter((f) => INDEX_ZERO.test(code(f))).map(rel);
    expect(indexZero).toEqual([]);
    const direct = [...adminRoutes, ...adminPages, ...adminLib]
      .filter((f) => /\bisAdminEmail\(/.test(code(f)))
      .map(rel)
      .filter((f) => !allowedDirect.includes(f));
    expect(direct).toEqual([]);
  });

  it('the canonical STUDYUS_ADMIN gate, the dashboard shell and workspace entry feed the allowlist the verified primary only', () => {
    const authorization = code(join(ROOT, 'src/lib/admin/authorization.ts'));
    expect(authorization).toContain('const email = resolveVerifiedPrimaryEmail(user);');
    expect(authorization).not.toMatch(/primaryEmailAddress\?\.emailAddress/);
    const layout = code(join(ROOT, 'src/app/dashboard/layout.tsx'));
    expect(layout).toContain('bootstrapStudyUSAdminIfEligible(canonicalUser, resolveVerifiedPrimaryEmail(user))');
    expect(layout).toContain('isAllowlistedAdminUser(user)');
    expect(layout).not.toMatch(/\bisAdminEmail\(/);
    expect(code(join(ROOT, 'src/lib/identity/workspace-entry.ts'))).toContain('bootstrapStudyUSAdminIfEligible(canonical, resolveVerifiedPrimaryEmail(user))');
    expect(code(join(ROOT, 'src/app/dashboard/admin/[studentId]/page.tsx'))).toContain('isAllowlistedAdminUser(user)');
  });
});
