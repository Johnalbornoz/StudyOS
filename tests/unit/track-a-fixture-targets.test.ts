import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Track A fixtures -- explicit provisioning targets. The DEV guard is unchanged (no flag = DEV); a non-DEV target
 * needs an explicit --target, the allowlisted database fingerprint AND a recorded Clerk instance. Nothing is run.
 */
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('@clerk/backend', () => ({ createClerkClient: vi.fn(() => ({})) }));

import { FIXTURE_TARGETS, assertDev, assertTarget, parseFixtureTarget, DEV_FP } from '../../scripts/operations/track-a-fixtures';

const pk = (host: string) => `pk_test_${Buffer.from(`${host}$`).toString('base64')}`;
// Hosts / database names are chosen so that their fingerprints are NOT any allowlisted one.
const env = (url: string, host: string, secret = 'sk_test_x') => {
  vi.stubEnv('DATABASE_URL', url);
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', pk(host));
  vi.stubEnv('CLERK_SECRET_KEY', secret);
};
afterEach(() => vi.unstubAllEnvs());

describe('track-a fixture targets', () => {
  it('no flag = DEV; explicit names only; unknown refuses', () => {
    expect(parseFixtureTarget(['provision'])).toBe('DEV');
    expect(parseFixtureTarget(['provision', '--target', 'PILOT_CANDIDATE_20261015'])).toBe('PILOT_CANDIDATE_20261015');
    expect(parseFixtureTarget(['tokens', 'f.json', '--target=PILOT_CANDIDATE_20261015'])).toBe('PILOT_CANDIDATE_20261015');
    expect(() => parseFixtureTarget(['provision', '--target', 'PRODUCTION'])).toThrow(/REFUSING/);
    expect(() => parseFixtureTarget(['provision', '--target'])).toThrow(/REFUSING/);
  });

  it('the allowlist is exactly DEV + the pilot candidate fingerprint; DEV keeps its instance', () => {
    expect(Object.keys(FIXTURE_TARGETS).sort()).toEqual(['DEV', 'PILOT_CANDIDATE_20261015']);
    expect(FIXTURE_TARGETS.DEV).toEqual({ dbFingerprint: DEV_FP, clerkInstance: 'shining-impala-8101.clerk.accounts.dev' });
    expect(FIXTURE_TARGETS.PILOT_CANDIDATE_20261015.dbFingerprint).toBe('4baac799b9bd2a6a');
  });

  it('DEV guard unchanged: a non-DEV database refuses with or without the target machinery', () => {
    env('postgres://u:p@not-dev.example/db', 'shining-impala-8101.clerk.accounts.dev');
    expect(() => assertDev()).toThrow(/database is not DEV/);
    expect(() => assertTarget('DEV')).toThrow(/database is not DEV/);
  });

  it('the candidate target refuses on another database, and refuses while its Clerk instance is not recorded', () => {
    env('postgres://u:p@not-candidate.example/db', 'shining-impala-8101.clerk.accounts.dev');
    expect(() => assertTarget('PILOT_CANDIDATE_20261015')).toThrow(/database is not PILOT_CANDIDATE_20261015/);
    expect(FIXTURE_TARGETS.PILOT_CANDIDATE_20261015.clerkInstance).toBeNull();
  });

  it('an unknown target always refuses', () => {
    expect(() => assertTarget('PREVIEW')).toThrow(/unknown fixture target/);
  });
});
