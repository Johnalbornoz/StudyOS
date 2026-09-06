import { describe, it, expect } from 'vitest';
import { buildDeploymentVersion, type DeploymentVersion } from '@/lib/deployment-version';

/**
 * Deployment provenance endpoint (Step 6L-C1-R1 hardening).
 *
 * These cover the pure payload builder behind GET /api/version. The
 * route handler itself is a one-liner (`NextResponse.json(
 * buildDeploymentVersion(process.env))`), so proving the builder is
 * correct and closed proves the endpoint is.
 */

const ALLOWED_KEYS = ['commitSha', 'environment', 'buildTime'].sort();

describe('buildDeploymentVersion', () => {
  it('A. returns ONLY the three allowed fields, nothing else', () => {
    const out = buildDeploymentVersion({
      VERCEL_GIT_COMMIT_SHA: 'abc123',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_AUTHOR_DATE: '2026-09-05T19:08:48.000Z',
    });
    expect(Object.keys(out).sort()).toEqual(ALLOWED_KEYS);
  });

  it('B. uses the deployment env values when present', () => {
    const out = buildDeploymentVersion({
      VERCEL_GIT_COMMIT_SHA: 'ff904948c3a19ee355eeda62f2721af4639af099',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_AUTHOR_DATE: '2026-09-05T19:08:48.000Z',
    });
    expect(out).toEqual<DeploymentVersion>({
      commitSha: 'ff904948c3a19ee355eeda62f2721af4639af099',
      environment: 'production',
      buildTime: '2026-09-05T19:08:48.000Z',
    });
  });

  it('B2. normalizes preview / development, and falls back to development for anything unrecognized', () => {
    expect(buildDeploymentVersion({ VERCEL_ENV: 'preview' }).environment).toBe('preview');
    expect(buildDeploymentVersion({ VERCEL_ENV: 'development' }).environment).toBe('development');
    expect(buildDeploymentVersion({ VERCEL_ENV: 'staging' }).environment).toBe('development');
    expect(buildDeploymentVersion({}).environment).toBe('development');
  });

  it('C. never exposes an unrelated environment variable', () => {
    const out = buildDeploymentVersion({
      VERCEL_GIT_COMMIT_SHA: 'abc123',
      VERCEL_ENV: 'production',
      // realistic sensitive neighbors that must never surface
      DATABASE_URL: 'postgres://user:pw@host/db',
      CLERK_SECRET_KEY: 'sk_test_shhh',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      VERCEL_OIDC_TOKEN: 'eyJ.secret.token',
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('sk_test_shhh');
    expect(serialized).not.toContain('sk-ant-secret');
    expect(serialized).not.toContain('eyJ.secret.token');
    expect(Object.keys(out).sort()).toEqual(ALLOWED_KEYS);
  });

  it('D. handles an absent commit SHA (and absent buildTime) safely -- null, never undefined, never a throw', () => {
    const out = buildDeploymentVersion({ VERCEL_ENV: 'development' });
    expect(out).toEqual<DeploymentVersion>({ commitSha: null, environment: 'development', buildTime: null });
    // empty string is treated as absent, not echoed back
    const out2 = buildDeploymentVersion({ VERCEL_GIT_COMMIT_SHA: '', VERCEL_GIT_COMMIT_AUTHOR_DATE: '' });
    expect(out2.commitSha).toBeNull();
    expect(out2.buildTime).toBeNull();
  });

  it('E. is pure -- no DB/network/AI import in the module, no process.env read of its own', async () => {
    const raw = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/lib/deployment-version.ts', import.meta.url), 'utf-8')
    );
    // Strip comments before matching -- the module's own doc comment
    // legitimately mentions `process.env` in prose.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/from '@\/lib\/db'|from ['"]pg['"]|drizzle/);
    expect(code).not.toMatch(/executeAI|@\/lib\/ai/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    // the builder must receive env as an argument, never reach for the global itself
    expect(code).not.toMatch(/process\s*\.\s*env/);
  });
});
